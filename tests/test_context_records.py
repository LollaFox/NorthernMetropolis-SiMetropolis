"""Exact request-local record sharing. All providers are mocked; no real keys."""
import copy
import hashlib
import json
import os
import unittest
from unittest.mock import patch

from backend.ai import DeepSeekProvider, OpenAIProvider, _context_packet
from backend.context_records import (ENCODING, REFERENCE_LEGEND,
                                     decode_context_records, encode_context_records)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def building(identifier="R004", **changes):
    value = {"id": identifier, "type": "residential", "x": 0, "y": 0,
             "status": "complete", "narrative": "邻里 quiet character. " * 80,
             "population": 6250, "occupancy": {"groups": 1, "population": 6250},
             "objectUnit": "development_cluster"}
    value.update(changes)
    return value


def repeated_context(record=None):
    record = building() if record is None else record
    return {"month": "2025-02-01", "step": 2, "target": copy.deepcopy(record),
            "scale": {"unit": "development_cluster", "sources": ["https://example.test/source"]},
            "construction": {"completed": [copy.deepcopy(record)]},
            "towers": [{"towerId": record["id"], "target": copy.deepcopy(record),
                        "neighborhood": [{"x": 0, "y": 0, "dx": 0, "dy": 0,
                                          "status": "complete", "building": copy.deepcopy(record)}],
                        "conditions": {"rentPerPerson": 4000, "profileSpecific": "preserve"},
                        "eligibleActions": ["leave"]}]}


class ContextRecordTests(unittest.TestCase):
    def assert_round_trip(self, original):
        before = canonical(original)
        packet, encoded = encode_context_records(original)
        expanded = decode_context_records(packet, encoded)
        self.assertEqual(canonical(expanded), before)
        self.assertEqual(canonical(original), before)
        return packet, encoded

    def test_exact_building_records_shared_and_distinct_versions_retained(self):
        first = building()
        second = building(population=12500, occupancy={"groups": 2, "population": 12500})
        value = {"records": [copy.deepcopy(first), copy.deepcopy(second)] * 5}
        packet, encoded = self.assert_round_trip(value)
        self.assertTrue(encoded)
        self.assertEqual(len(packet["records"]), 2)
        self.assertEqual({record["population"] for record in packet["records"].values()}, {6250, 12500})
        self.assertTrue(all(key.startswith("R004/v") for key in packet["records"]))
        # Negative control: an ID-only map collapses materially different facts.
        by_id = {record["id"]: record for record in value["records"]}
        wrong = {"records": [by_id[record["id"]] for record in value["records"]]}
        self.assertNotEqual(canonical(wrong), canonical(value))

    def test_unicode_numeric_types_and_order_are_not_collapsed(self):
        variants = [building(population=value) for value in (1, 1.0, True, -0.0, 0.0)]
        original = {"items": [copy.deepcopy(value) for value in variants] * 4}
        packet, encoded = self.assert_round_trip(original)
        self.assertTrue(encoded)
        self.assertEqual(len(packet["records"]), len(variants))
        reordered = {"items": [dict(reversed(list(value.items()))) for value in original["items"]]}
        other, other_encoded = encode_context_records(reordered)
        self.assertEqual(encoded, other_encoded)
        self.assertEqual(canonical(packet), canonical(other))

    def test_nonduplicates_and_uneconomic_duplicates_stay_plain(self):
        for value in ({"items": [building("R1"), building("R2")]},
                      {"items": [{"id": "R1", "type": "park", "x": 0, "y": 0, "status": "complete"}] * 2}):
            packet, encoded = self.assert_round_trip(value)
            self.assertFalse(encoded)
            self.assertEqual(packet, value)

    def test_reserved_shapes_nested_literals_and_ordinary_envelopes_round_trip(self):
        record = building(extra={"$record": "literal-marker-in-table"})
        value = repeated_context(record)
        value["ordinary"] = [{"$record": "R004/v1"}, {"$literal": {"$record": "nested"}},
                             {"$record": {"$literal": {"$record": "deep"}}},
                             {"$literal": {"nested": {"$literal": {"$record": "original"}}}}]
        packet, encoded = self.assert_round_trip(value)
        self.assertTrue(encoded)
        self.assertEqual(packet["context"]["ordinary"][0], {"$literal": value["ordinary"][0]})
        envelope_shaped = {"encoding": ENCODING, "records": {}, "context": {"$record": "ordinary"}}
        self.assertFalse(self.assert_round_trip(envelope_shaped)[1])
        envelope_shaped["context"] = value
        self.assertTrue(self.assert_round_trip(envelope_shaped)[1])

    def test_reference_expansion_and_tables_do_not_alias(self):
        original = repeated_context()
        packet, encoded = self.assert_round_trip(original)
        expanded = decode_context_records(packet, encoded)
        expanded["target"]["occupancy"]["groups"] = 999
        self.assertEqual(expanded["construction"]["completed"][0]["occupancy"]["groups"], 1)
        self.assertEqual(next(iter(packet["records"].values()))["occupancy"]["groups"], 1)
        self.assertEqual(original["target"]["occupancy"]["groups"], 1)

    def test_readable_building_and_cell_name_collisions_stay_distinct(self):
        cell = {"x": 0, "y": 0, "dx": 0, "dy": 0, "status": "empty", "building": None,
                "extra": "unchanged cell facts " * 100}
        record = building("cell(0,0,0,0)")
        packet, encoded = self.assert_round_trip({"items": [cell, record] * 5})
        self.assertTrue(encoded)
        self.assertEqual(len(packet["records"]), 2)
        self.assertEqual(len(set(packet["records"])), 2)

    def test_no_unused_or_overlapping_records_and_bad_references_fail(self):
        record = building()
        cell = {"x": 0, "y": 0, "dx": 0, "dy": 0, "status": "complete", "building": record}
        packet, encoded = self.assert_round_trip({"cells": [cell] * 6})
        self.assertTrue(encoded)
        self.assertEqual(len(packet["records"]), 1)
        self.assertEqual(next(iter(packet["records"].values())), record)
        for corrupted in (dict(packet, context={"$record": "missing"}),
                          dict(packet, context={"$literal": {"not": "reserved"}}),
                          dict(packet, context={})):
            with self.assertRaises(ValueError):
                decode_context_records(corrupted, True)

    def test_deepseek_initial_and_correction_preserve_every_fact_and_measure_wire(self):
        context = repeated_context()
        before = canonical(context)
        bodies = []
        def transport(req, timeout):
            bodies.append(req.data)
            result = {"actions": [], "reason": "x" * 400 if len(bodies) == 1 else "Keep the existing group."}
            return {"choices": [{"finish_reason": "stop", "message": {
                "role": "assistant", "content": json.dumps(result)}}]}
        provider = DeepSeekProvider(api_key="dummy", transport=transport, retries=0)
        self.assertEqual(provider.call("park", context)["actions"], [])
        self.assertEqual(canonical(context), before)
        for body, metric in zip(bodies, provider.metrics):
            payload = json.loads(body)
            packet = json.loads(payload["messages"][1]["content"])
            self.assertEqual(metric["contextEncoding"], ENCODING)
            self.assertIn(REFERENCE_LEGEND, payload["messages"][0]["content"])
            expanded = decode_context_records(packet, True)
            self.assertEqual(canonical(expanded), canonical(_context_packet("park", context)))
            self.assertEqual(expanded["actionEligibility"], {"R004": ["leave"]})
            self.assertEqual(metric["contextSHA256"], hashlib.sha256(before).hexdigest())
            self.assertEqual(metric["contextBytes"], len(before))
            self.assertEqual(metric["inputBytes"], len(body))
            self.assertEqual(metric["userContextBytes"], len(payload["messages"][1]["content"].encode("utf-8")))

    def test_plain_deepseek_and_openai_payloads_do_not_get_a_legend(self):
        context = {"month": "2025-01-01"}
        deepseek = DeepSeekProvider(api_key="dummy", transport=lambda *_: None)
        payload = deepseek.payload("narrator", context)
        self.assertNotIn(REFERENCE_LEGEND, payload["messages"][0]["content"])
        self.assertEqual(json.loads(payload["messages"][1]["content"]), context)
        with patch.dict(os.environ, {"OPENAI_API_KEY": "dummy"}):
            openai = OpenAIProvider(transport=lambda *_: None)
        with patch("backend.ai.encode_context_records", side_effect=AssertionError("OpenAI must stay plain")):
            payload = openai.payload("park", repeated_context())
        self.assertNotIn(REFERENCE_LEGEND, payload["instructions"])
        self.assertEqual(json.loads(payload["input"]), _context_packet("park", repeated_context()))


if __name__ == "__main__":
    unittest.main()

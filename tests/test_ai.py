"""No network calls: exercise strict decisions, fixture semantics and HTTP edges."""

import copy
import hashlib
import io
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib import error

from backend.ai import (DEFAULT_MODEL, DEEPSEEK_ENDPOINT, ENDPOINT,
                        DecisionError, DeepSeekProvider, DualKeyProvider, OfflineProvider,
                        OpenAIProvider, ProviderError, extract_deepseek_output,
                        extract_output, schema_for, validate_decision,
                        validate_resident_eligibility)
from backend.cli import monthly_dates, run
from backend.context_records import decode_context_records
from backend.storage import monthly_state_path, read_json


def response(value, **changes):
    result = {"status": "completed", "output": [{"type": "message", "status": "completed",
               "content": [{"type": "output_text", "text": json.dumps(value)}]}],
              "usage": {"input_tokens": 40, "output_tokens": 12, "total_tokens": 52,
                        "output_tokens_details": {"reasoning_tokens": 4}}}
    result.update(changes)
    return result


def deepseek_response(value, finish_reason="stop"):
    return {"choices": [{"index": 0, "finish_reason": finish_reason,
                         "message": {"role": "assistant", "content": json.dumps(value)}}],
            "usage": {"prompt_tokens": 60, "completion_tokens": 14, "total_tokens": 74,
                      "prompt_cache_hit_tokens": 20, "prompt_cache_miss_tokens": 40,
                      "completion_tokens_details": {"reasoning_tokens": 0}}}


def tower(character="", **conditions):
    facts = {"rentPerPerson": 4000, "expectedEmploymentRate": 1,
             "expectedWage": 15000, "expectedCommute": 2, "nearbyParks": 0,
             "constructionChanges": 0}
    facts.update(conditions)
    return {"towerId": "home-a", "narrative": character, "conditions": facts,
            "eligibleActions": ["move_in"], "neighborhood": []}


class DecisionTests(unittest.TestCase):
    def test_exact_schemas_accept_only_role_fields(self):
        examples = {"narrator": {"character": "Synthetic quiet character."},
                    "firm": {"firmType": "large", "reason": "Cluster."},
                    "budget": {"actions": [{"towerId": "a", "action": "move_in", "reason": "Value."}],
                               "reason": "Practical fit."}}
        for role, example in examples.items():
            self.assertEqual(validate_decision(role, example), example)
            example["population"] = 25
            with self.assertRaises(DecisionError):
                validate_decision(role, example)
        self.assertFalse(schema_for("park")["additionalProperties"])
        self.assertNotIn("number", json.dumps(schema_for("budget")))

    def test_all_resident_roles_and_fixed_actions(self):
        for role in ("budget", "work", "park", "stability"):
            for action in ("move_in", "leave"):
                value = {"actions": [{"towerId": "a", "action": action, "reason": "Fit."}], "reason": "Fit."}
                self.assertEqual(validate_decision(role, value), value)
                value["actions"][0]["quantity"] = 25
                with self.assertRaises(DecisionError):
                    validate_decision(role, value)

    def test_duplicate_conflict_empty_and_oversize_text(self):
        for actions in ([{"towerId": "a", "action": action, "reason": "Fit."}
                         for action in ("leave", "move_in")],
                        [{"towerId": "a", "action": "move_in", "reason": ""}],
                        [{"towerId": "a", "action": "relocate", "reason": "Fit."}]):
            with self.assertRaises(DecisionError):
                validate_decision("park", {"actions": actions, "reason": "Fit."})
        for character in ("", "x" * 901, "\ud800"):
            with self.assertRaises(DecisionError):
                validate_decision("narrator", {"character": character})
        self.assertEqual(validate_decision("work", {"actions": [], "reason": "Wait."})["actions"], [])

    def test_independent_output_copy(self):
        original = {"actions": [], "reason": "Wait."}
        validate_decision("budget", original)["actions"].append({})
        self.assertEqual(original["actions"], [])


class FixtureTests(unittest.TestCase):
    def test_explicit_fixture_label_determinism_and_no_context_mutation(self):
        provider = OfflineProvider()
        context = {"target": {"id": "a", "type": "residential"}, "neighborhood": []}
        before = copy.deepcopy(context)
        first = provider.call("narrator", context)
        self.assertEqual(first, provider.call("narrator", context))
        self.assertIn("Deterministic fixture", first["character"])
        self.assertEqual(context, before)
        self.assertEqual(provider.metrics_summary()["callCount"], 2)
        self.assertFalse(provider.metrics_summary()["usageAvailable"])

    def test_narrative_changes_resident_choice_with_same_numeric_facts(self):
        provider = OfflineProvider()
        quiet = provider.call("park", {"towers": [tower("A tranquil garden temperament.")]})
        busy = provider.call("park", {"towers": [tower("An ambitious working temperament.")]})
        self.assertEqual(len(quiet["actions"]), 1)
        self.assertEqual(busy["actions"], [])

    def test_facts_change_fixture_choice_with_same_narrative(self):
        provider = OfflineProvider()
        rich = provider.call("budget", {"towers": [tower("Practical routines.")]})
        unemployed = provider.call("budget", {"towers": [tower("Practical routines.", expectedEmploymentRate=0, expectedWage=0)]})
        self.assertTrue(rich["actions"])
        self.assertFalse(unemployed["actions"])

    def test_neighborhood_status_and_business_narrative_affect_firm(self):
        provider = OfflineProvider()
        def cell(identity, kind, narrative="", status="complete"):
            return {"dx": identity, "dy": 0, "status": status,
                    "building": {"type": kind, "narrative": narrative,
                                 "population": 25 if kind == "residential" else 0}}
        base = [cell(1, "business"), cell(-1, "residential")]
        self.assertEqual(provider.call("firm", {"neighborhood": base})["firmType"], "small")
        active = copy.deepcopy(base)
        active[0]["building"]["narrative"] = "Ambitious working character."
        self.assertEqual(provider.call("firm", {"neighborhood": active})["firmType"], "large")
        active[0]["status"] = "planned"
        self.assertEqual(provider.call("firm", {"neighborhood": active})["firmType"], "small")

    def test_existing_workers_keep_actual_jobs_when_vacancies_are_empty(self):
        home = tower("An ambitious working character.", expectedEmploymentRate=0,
                     expectedWage=0, expectedCommute=None,
                     employedWorkers=15, averageWage=15000, meanCommute=1)
        home["eligibleActions"] = ["leave"]
        home["occupancy"] = {"ownGroup": {"id": "g"}}
        provider = OfflineProvider()
        self.assertEqual(provider.call("work", {"groupWorkers": 15, "towers": [home]})["actions"], [])
        self.assertEqual(provider.call("budget", {"groupWorkers": 15, "towers": [home]})["actions"], [])

    def test_empty_residential_shell_is_not_nearby_residents(self):
        neighbors = [{"dx": 1, "dy": 0, "status": "complete",
                      "building": {"type": "business"}},
                     {"dx": -1, "dy": 0, "status": "complete",
                      "building": {"type": "residential", "population": 0}}]
        self.assertEqual(OfflineProvider().call("firm", {"neighborhood": neighbors})["firmType"], "large")

    def test_aggregate_group_scale_preserves_per_person_preference(self):
        provider = OfflineProvider()
        home = tower("Practical garden and quiet working character.",
                     expectedEmploymentRate=.5, expectedWage=7500)
        for role in ("budget", "work", "park", "stability"):
            small = provider.call(role, {"groupSize": 25, "groupWorkers": 15, "towers": [home]})
            regional = provider.call(role, {"groupSize": 6250, "groupWorkers": 3750,
                                           "scale": {"unit": "development_cluster"}, "towers": [home]})
            self.assertEqual(regional, small)


class ExtractionTests(unittest.TestCase):
    def test_rest_messages_ignore_reasoning_and_join_output_text(self):
        payload = response({"character": "Quiet."})
        payload["output"].insert(0, {"type": "reasoning", "summary": []})
        self.assertEqual(extract_output(payload), {"character": "Quiet."})
        content = payload["output"][1]["content"]
        content[:] = [{"type": "output_text", "text": '{"character":'},
                      {"type": "output_text", "text": '"Quiet."}'}]
        self.assertEqual(extract_output(payload), {"character": "Quiet."})

    def test_top_level_output_text_and_invalid_json(self):
        self.assertEqual(extract_output({"status": "completed", "output_text": '{"x":1}'}), {"x": 1})
        for text in ('not json', '{"x":1,"x":2}', '{"x":NaN}'):
            with self.assertRaises(DecisionError):
                extract_output({"status": "completed", "output_text": text})

    def test_refusal_incomplete_and_missing_output(self):
        refusal = response({})
        refusal["output"][0]["content"] = [{"type": "refusal", "refusal": "private detail"}]
        for payload in (refusal, response({}, status="incomplete"), {"status": "completed"},
                        response({}, error={"message": "private"})):
            with self.assertRaises(DecisionError) as raised:
                extract_output(payload)
            self.assertNotIn("private", str(raised.exception))


@patch.dict(os.environ, {"OPENAI_API_KEY": "secret-test-key"})
class OpenAITransportTests(unittest.TestCase):
    def test_request_shape_timeout_schema_metrics_and_no_key_persistence(self):
        seen = []
        def transport(req, timeout):
            seen.append((req, timeout))
            return response({"character": "Synthetic quiet social character."})
        provider = OpenAIProvider(transport=transport, timeout=3, retries=0)
        result = provider.call("narrator", {"target": {"id": "a"}})
        req, timeout = seen[0]
        self.assertEqual(req.full_url, ENDPOINT)
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(req.get_header("Authorization"), "Bearer secret-test-key")
        self.assertEqual(timeout, 3)
        body = json.loads(req.data)
        self.assertEqual(body["model"], DEFAULT_MODEL)
        self.assertFalse(body["store"])
        self.assertTrue(body["text"]["format"]["strict"])
        self.assertIn("current facts", body["instructions"])
        self.assertEqual(result["character"], "Synthetic quiet social character.")
        self.assertEqual(provider.metrics[0]["inputBytes"], len(req.data))
        self.assertEqual(provider.metrics[0]["answerTextChars"], len(json.dumps(result)))
        self.assertEqual(provider.metrics_summary()["usage"]["total_tokens"], 52)
        self.assertNotIn("secret-test-key", json.dumps(provider.metrics))

    def test_stdlib_http_response_transport(self):
        body = json.dumps(response({"firmType": "small", "reason": "Residents."})).encode()
        with patch("backend.ai.request.build_opener") as build_opener:
            opener = build_opener.return_value
            opener.open.return_value.__enter__.return_value.read.return_value = body
            value = OpenAIProvider(retries=0).call("firm", {})
            self.assertEqual(value["firmType"], "small")
            self.assertEqual(opener.open.call_args.kwargs["timeout"], 45)
            redirect = build_opener.call_args.args[0]
            self.assertIsNone(redirect.redirect_request(None, None, 302, "Found", {}, "https://other.example"))

    def test_transient_http_retry_counts_each_attempt(self):
        effects = [error.HTTPError(ENDPOINT, 429, "secret-test-key", {}, io.BytesIO(b"private")),
                   response({"actions": [], "reason": "Wait."})]
        pauses = []
        def transport(_req, _timeout):
            value = effects.pop(0)
            if isinstance(value, Exception):
                raise value
            return value
        provider = OpenAIProvider(transport=transport, retries=2, sleep=pauses.append)
        self.assertEqual(provider.call("budget", {})["actions"], [])
        summary = provider.metrics_summary()
        self.assertEqual(summary["callCount"], 1)
        self.assertEqual(summary["attemptCount"], 2)
        self.assertEqual(summary["statuses"], {"http_error": 1, "ok": 1})
        self.assertEqual(pauses, [0.5])

    def test_authentication_failure_does_not_retry_or_expose_body(self):
        def transport(_req, _timeout):
            raise error.HTTPError(ENDPOINT, 401, "secret-test-key", {}, io.BytesIO(b"private response"))
        provider = OpenAIProvider(transport=transport, retries=2, sleep=lambda _: self.fail("Unexpected retry"))
        with self.assertRaises(ProviderError) as raised:
            provider.call("firm", {})
        self.assertEqual(str(raised.exception), "Provider HTTP failure (status 401)")
        self.assertEqual(len(provider.metrics), 1)
        self.assertNotIn("secret-test-key", json.dumps(provider.metrics))

    def test_timeout_retry_exhaustion_and_invalid_output_do_not_succeed(self):
        def timeout(_req, _timeout):
            raise TimeoutError("secret-test-key")
        provider = OpenAIProvider(transport=timeout, retries=1, sleep=lambda _: None)
        with self.assertRaises(ProviderError):
            provider.call("work", {})
        self.assertEqual(provider.metrics_summary()["attemptCount"], 2)
        self.assertEqual(provider.metrics_summary()["successfulCalls"], 0)
        invalid = OpenAIProvider(transport=lambda *_: response({"firmType": "huge", "reason": "Fit."}))
        with self.assertRaises(DecisionError):
            invalid.call("firm", {})
        self.assertEqual(invalid.metrics[0]["status"], "invalid_output")
        self.assertEqual(len(invalid.metrics), 1)

    def test_many_calls_have_no_cumulative_cap(self):
        provider = OpenAIProvider(transport=lambda *_: response({"character": "Quiet."}), retries=0)
        for _ in range(125):
            provider.call("narrator", {})
        self.assertEqual(provider.metrics_summary()["successfulCalls"], 125)

    def test_configuration_validation_and_model_override(self):
        for timeout in (0, -1, float("inf"), float("nan"), True):
            with self.assertRaises(ValueError):
                OpenAIProvider(timeout=timeout)
        for retries in (-1, 6, 1.5, True):
            with self.assertRaises(ValueError):
                OpenAIProvider(retries=retries)
        self.assertEqual(OpenAIProvider(model="explicit-api-model").model, "explicit-api-model")


class StartupAndCalendarTests(unittest.TestCase):
    @patch.dict(os.environ, {}, clear=True)
    def test_offline_needs_no_key_live_requires_explicit_key(self):
        self.assertEqual(OfflineProvider().metrics_summary()["callCount"], 0)
        with self.assertRaises(ProviderError):
            OpenAIProvider()

    def test_month_anchor_clamps_without_drift(self):
        self.assertEqual(list(monthly_dates("2024-01-31", "2024-04-30")),
                         ["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30"])
        with self.assertRaises(ValueError):
            list(monthly_dates("2025-02-01", "2025-01-01"))
        self.assertEqual(list(monthly_dates("9999-12-31", "9999-12-31")), ["9999-12-31"])

    def test_cli_audit_keeps_every_current_month_event(self):
        scenario = {"buildings": [
            {"id": "a", "type": "residential", "x": 0, "y": 0, "completionMonth": 1},
            {"id": "b", "type": "business", "x": 1, "y": 0, "completionMonth": 2}]}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "run"
            summary = run(OfflineProvider(), "2025-01-01", "2025-02-01", scenario, output)
            self.assertEqual(summary["status"], "completed")
            rows = [json.loads(line) for line in (output / "audit.jsonl").read_text().splitlines()]
            for row in rows:
                state = read_json(monthly_state_path(output / "states", row["date"]))
                self.assertEqual(row["events"], state["events"])
                self.assertEqual(row["audit"], state["audit"])
                self.assertTrue(row["events"])
            with self.assertRaises(FileExistsError):
                run(OfflineProvider(), scenario=scenario, output=output)

    def test_cli_failure_preserves_completed_state_and_safe_metrics(self):
        from backend.engine import advance_month
        count = [0]
        def fail_second(*args):
            count[0] += 1
            if count[0] == 2:
                raise RuntimeError("secret-provider-error")
            return advance_month(*args)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "run"
            with patch("backend.engine.advance_month", side_effect=fail_second):
                summary = run(OfflineProvider(), "2025-01-01", "2025-02-01",
                              {"buildings": []}, output)
            self.assertEqual(summary["status"], "failed")
            self.assertEqual(summary["completedMonths"], ["2025-01-01"])
            self.assertTrue(monthly_state_path(output / "states", "2025-01-01").exists())
            self.assertFalse(monthly_state_path(output / "states", "2025-02-01").exists())
            self.assertEqual(json.loads((output / "summary.json").read_text()), summary)
            self.assertNotIn("secret-provider-error", (output / "summary.json").read_text())


class DeepSeekTests(unittest.TestCase):
    def provider(self, transport, **kwargs):
        return DeepSeekProvider(api_key="dummy-deepseek-test-key", transport=transport, **kwargs)

    def test_fixed_endpoint_payload_json_schema_and_usage(self):
        seen = []
        def transport(req, timeout):
            seen.append((req, timeout))
            return deepseek_response({"firmType": "small", "reason": "Resident fit."})
        provider = self.provider(transport)
        result = provider.call("firm", {"target": {"id": "B"}})
        self.assertEqual(result["firmType"], "small")
        req, timeout = seen[0]
        self.assertEqual(req.full_url, DEEPSEEK_ENDPOINT)
        self.assertEqual(timeout, 180)
        self.assertEqual(req.get_header("Authorization"), "Bearer dummy-deepseek-test-key")
        payload = json.loads(req.data)
        self.assertEqual(payload["model"], "deepseek-flash")
        self.assertEqual(payload["thinking"], {"type": "disabled"})
        self.assertEqual(payload["response_format"], {"type": "json_object"})
        self.assertFalse(payload["stream"])
        self.assertEqual(payload["messages"][1]["role"], "user")
        self.assertIn('"additionalProperties":false', payload["messages"][0]["content"])
        self.assertIn("Format example", payload["messages"][0]["content"])
        self.assertIn("at most 400 characters", provider.payload("narrator", {})["messages"][0]["content"])
        summary = provider.metrics_summary()
        self.assertEqual(summary["usage"]["input_tokens"], 60)
        self.assertEqual(summary["usage"]["output_tokens"], 14)
        self.assertEqual(summary["usage"]["input_cache_hit_tokens"], 20)
        self.assertEqual(summary["usage"]["input_cache_miss_tokens"], 40)
        self.assertNotIn("dummy-deepseek-test-key", json.dumps(provider.metrics))

    def test_context_fingerprint_and_request_measurements_are_additive(self):
        seen = []
        context = {"target": {"id": "B001", "name": "中文"}, "month": "2025-04-01", "step": 4}
        original = copy.deepcopy(context)
        value = {"firmType": "small", "reason": "Facts support a small firm."}
        def transport(req, _timeout):
            seen.append(req.data)
            return deepseek_response(value)
        provider = self.provider(transport)
        expected_payload = json.dumps(provider.payload("firm", context), ensure_ascii=False, separators=(",", ":")).encode()
        self.assertEqual(provider.call("firm", context), value)
        self.assertEqual(seen, [expected_payload])
        self.assertEqual(context, original)
        row = provider.metrics[0]
        digest = hashlib.sha256(json.dumps(context, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        self.assertEqual(row["contextSHA256"], digest)
        self.assertEqual(row["contextMonth"], "2025-04-01")
        self.assertEqual(row["contextStep"], 4)
        self.assertEqual(row["contextTargetId"], "B001")
        self.assertEqual(row["contextBytes"], len(json.dumps(context, ensure_ascii=False, separators=(",", ":")).encode()))
        payload = json.loads(seen[0])
        self.assertEqual(row["userContextBytes"], len(payload["messages"][1]["content"].encode()))
        self.assertEqual(row["systemPromptBytes"], len(payload["messages"][0]["content"].encode()))
        self.assertGreater(row["inputBytes"], row["userContextBytes"] + row["systemPromptBytes"])
        reordered = {"step": 4, "month": "2025-04-01", "target": {"name": "中文", "id": "B001"}}
        provider.call("firm", reordered)
        self.assertEqual(provider.metrics[1]["contextSHA256"], digest)

    def test_actual_answer_unicode_whitespace_and_canonical_lengths_are_distinct(self):
        value = {"character": "安静的社区。"}
        raw_text = json.dumps(value, ensure_ascii=False, indent=2)
        returned = deepseek_response(value)
        returned["choices"][0]["message"].update(content=raw_text, reasoning_content="短说明")
        provider = self.provider(lambda *_: returned)
        self.assertEqual(provider.call("narrator", {}), value)
        row = provider.metrics[0]
        canonical = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        self.assertEqual((row["answerTextChars"], row["answerTextBytes"]), (len(raw_text), len(raw_text.encode())))
        self.assertEqual((row["responseJsonChars"], row["responseJsonBytes"]), (len(canonical), len(canonical.encode())))
        self.assertGreater(row["answerTextBytes"], row["responseJsonBytes"])
        self.assertEqual((row["reasoningTextChars"], row["reasoningTextBytes"]), (3, 9))
        self.assertIsNone(row["responseActionCount"])
        self.assertNotIn(value["character"], json.dumps(provider.metrics, ensure_ascii=False))

    def test_invalid_answer_keeps_raw_lengths_http_failure_has_unknown_lengths(self):
        invalid = {"actions": [], "reason": "x" * 400}
        provider = self.provider(lambda *_: deepseek_response(invalid), format_retries=0)
        with self.assertRaises(DecisionError):
            provider.call("budget", {"month": "2025-04-01", "step": 4, "towers": []})
        row = provider.metrics[0]
        self.assertEqual(row["answerTextChars"], len(json.dumps(invalid)))
        self.assertIsNone(row["responseJsonChars"])
        self.assertIsNone(row["responseActionCount"])
        self.assertEqual(row["usage"]["total_tokens"], 74)
        def rejected(*_):
            raise error.HTTPError(DEEPSEEK_ENDPOINT, 402, "private", {}, io.BytesIO())
        provider = self.provider(rejected, retries=0)
        with self.assertRaises(ProviderError):
            provider.call("budget", {})
        for key in ("answerTextChars", "answerTextBytes", "reasoningTextChars", "responseJsonChars", "responseActionCount"):
            self.assertIsNone(provider.metrics[0][key])

    def test_length_measurement_does_not_change_invalid_unicode_or_reasoning_behavior(self):
        returned = deepseek_response({})
        returned["choices"][0]["message"]["content"] = "\ud800"
        provider = self.provider(lambda *_: returned, format_retries=0)
        with self.assertRaises(DecisionError):
            provider.call("narrator", {})
        self.assertEqual(provider.metrics[0]["status"], "invalid_output")
        self.assertEqual(provider.metrics[0]["answerTextChars"], 1)
        self.assertIsNone(provider.metrics[0]["answerTextBytes"])
        returned = deepseek_response({"character": "Quiet."})
        returned["choices"][0]["message"]["reasoning_content"] = "\ud800"
        provider = self.provider(lambda *_: returned)
        self.assertEqual(provider.call("narrator", {}), {"character": "Quiet."})
        self.assertEqual(provider.metrics[0]["reasoningTextChars"], 1)
        self.assertIsNone(provider.metrics[0]["reasoningTextBytes"])

    def test_empty_resident_actions_have_zero_count_and_corrections_keep_fingerprint(self):
        values = [deepseek_response({"actions": [], "reason": "x" * 400}),
                  deepseek_response({"actions": [], "reason": "Wait."})]
        provider = self.provider(lambda *_: values.pop(0))
        provider.call("park", {"month": "2025-04-01", "step": 4, "towers": []})
        first, second = provider.metrics
        self.assertEqual(first["contextSHA256"], second["contextSHA256"])
        self.assertEqual(first["contextBytes"], second["contextBytes"])
        self.assertGreater(second["systemPromptBytes"], first["systemPromptBytes"])
        self.assertIsNone(first["responseActionCount"])
        self.assertEqual(second["responseActionCount"], 0)
        self.assertIsNone(first["responseJsonChars"])
        self.assertGreater(second["responseJsonChars"], 0)

    def test_regional_scale_metadata_retains_aggregate_and_per_person_units(self):
        provider = self.provider(lambda *_: None)
        scale = {"unit": "development_cluster", "referenceHousingCapacity": 2500000,
                 "referenceJobs": 650000}
        context = {"scale": scale, "groupSize": 6250, "groupWorkers": 3750, "towers": []}
        for role in ("narrator", "firm", "budget", "work", "park", "stability"):
            payload = provider.payload(role, context)
            instructions = payload["messages"][0]["content"]
            self.assertIn("aggregate planning cluster", instructions)
            self.assertIn("Wages are per worker", instructions)
            self.assertIn("rent is per resident", instructions)
            self.assertIn("not automatic arrivals", instructions)
            self.assertEqual(json.loads(payload["messages"][1]["content"])["scale"], scale)

    def test_every_role_uses_same_local_exact_validation(self):
        examples = {"narrator": {"character": "Synthetic garden character."},
                    "firm": {"firmType": "large", "reason": "Cluster fit."}}
        examples.update({role: {"actions": [], "reason": "Stay."}
                         for role in ("budget", "work", "park", "stability")})
        for role, value in examples.items():
            provider = self.provider(lambda *_, value=value: deepseek_response(value))
            self.assertEqual(provider.call(role, {}), value)
        extra = self.provider(lambda *_: deepseek_response({"actions": [], "reason": "Stay.", "quantity": 25}))
        with self.assertRaises(DecisionError):
            extra.call("budget", {})
        self.assertEqual(extra.metrics[0]["status"], "invalid_output")

    def test_nonstop_refusal_tools_empty_and_malformed_are_rejected(self):
        cases = [deepseek_response({"character": "Quiet."}, reason)
                 for reason in ("length", "content_filter", "tool_calls", "insufficient_system_resource", "aborted")]
        refusal = deepseek_response({"character": "Quiet."})
        refusal["choices"][0]["message"]["refusal"] = "private refusal"
        cases.append(refusal)
        for text in ("", "not json", '{"character":"a","character":"b"}', '{"x":NaN}'):
            bad = deepseek_response({})
            bad["choices"][0]["message"]["content"] = text
            cases.append(bad)
        for value in cases:
            provider = self.provider(lambda *_, value=value: value, format_retries=0)
            with self.assertRaises(DecisionError) as raised:
                provider.call("narrator", {})
            self.assertEqual(len(provider.metrics), 1)
            self.assertNotIn("private", str(raised.exception))
        with self.assertRaises(DecisionError):
            extract_deepseek_output({"choices": []})

    def test_authentication_failure_does_not_retry_or_save_secret(self):
        def transport(*_):
            raise error.HTTPError(DEEPSEEK_ENDPOINT, 401, "dummy-deepseek-test-key", {}, io.BytesIO(b"private"))
        provider = self.provider(transport, sleep=lambda _: self.fail("auth retried"))
        with self.assertRaises(ProviderError):
            provider.call("firm", {})
        self.assertEqual(provider.metrics[0]["httpStatus"], 401)
        self.assertNotIn("dummy-deepseek-test-key", json.dumps(provider.metrics))

    def test_transient_retry_and_timeout_exhaustion(self):
        attempts = [error.HTTPError(DEEPSEEK_ENDPOINT, 503, "private", {}, io.BytesIO()),
                    deepseek_response({"character": "Quiet."})]
        def transport(*_):
            value = attempts.pop(0)
            if isinstance(value, Exception):
                raise value
            return value
        provider = self.provider(transport, sleep=lambda _: None)
        self.assertEqual(provider.call("narrator", {}), {"character": "Quiet."})
        self.assertEqual(provider.metrics_summary()["attemptCount"], 2)
        def timeout(*_):
            raise TimeoutError("private")
        provider = self.provider(timeout, retries=1, sleep=lambda _: None)
        with self.assertRaises(ProviderError):
            provider.call("work", {})
        self.assertEqual(provider.metrics_summary()["successfulCalls"], 0)
        self.assertEqual(provider.metrics_summary()["attemptCount"], 2)

    def test_environment_explicit_key_and_invalid_config(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ProviderError):
                DeepSeekProvider()
            self.assertEqual(DeepSeekProvider(api_key="dummy").provider, "deepseek")
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "dummy-env"}):
            self.assertEqual(DeepSeekProvider().model, "deepseek-flash")
        for timeout in (0, float("inf"), float("nan"), True):
            with self.assertRaises(ValueError):
                DeepSeekProvider(api_key="dummy", timeout=timeout)

    def test_stdlib_transport_blocks_redirects_and_counts_cache_fallback(self):
        value = deepseek_response({"character": "Quiet."})
        value["usage"].pop("prompt_cache_hit_tokens")
        value["usage"]["prompt_tokens_details"] = {"cached_tokens": 9}
        with patch("backend.ai.request.build_opener") as build:
            build.return_value.open.return_value.__enter__.return_value.read.return_value = json.dumps(value).encode()
            provider = DeepSeekProvider(api_key="dummy")
            provider.call("narrator", {})
            self.assertIsNone(build.call_args.args[0].redirect_request(None, None, 302, "", {}, "https://elsewhere.example"))
            self.assertEqual(provider.metrics_summary()["usage"]["input_cache_hit_tokens"], 9)

    def test_long_reason_gets_one_safe_correction_and_retains_both_attempts(self):
        long_reason = "private-original-response-marker " + "x" * 370
        invalid = {"actions": [], "reason": long_reason}
        with self.assertRaises(DecisionError):
            validate_decision("budget", invalid)
        seen, callbacks = [], []
        def transport(req, _timeout):
            seen.append(json.loads(req.data))
            return deepseek_response(invalid if len(seen) == 1 else {"actions": [], "reason": "Rent and available wages favour waiting."})
        provider = self.provider(transport)
        provider.set_metrics_callback(callbacks.append)
        self.assertEqual(provider.call("budget", {"marker": "original-context"})["actions"], [])
        self.assertEqual(len(seen), 2)
        self.assertIn("at most 160 characters", seen[0]["messages"][0]["content"])
        self.assertIn("FORMAT CORRECTION", seen[1]["messages"][0]["content"])
        self.assertIn("Invalid reason", seen[1]["messages"][0]["content"])
        self.assertEqual(seen[0]["messages"][1], seen[1]["messages"][1])
        self.assertNotIn("private-original-response-marker", json.dumps(seen[1]))
        self.assertNotIn("validationLabel", seen[1])
        self.assertEqual([row["status"] for row in callbacks], ["invalid_output", "ok"])
        self.assertEqual([row["formatCorrection"] for row in callbacks], [0, 1])
        self.assertEqual(callbacks[0]["validationError"], "Invalid reason")
        self.assertEqual(len({row["callId"] for row in callbacks}), 1)
        summary = provider.metrics_summary()
        self.assertEqual((summary["callCount"], summary["attemptCount"], summary["successfulCalls"]), (1, 2, 1))
        self.assertEqual(summary["usage"]["total_tokens"], 148)
        self.assertEqual(summary["inputBytes"], sum(len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()) for value in seen))
        self.assertEqual(invalid["reason"], long_reason)

    def test_format_correction_exhaustion_stays_failed_without_trimming(self):
        provider = self.provider(lambda *_: deepseek_response({"actions": [], "reason": "x" * 400}))
        with self.assertRaises(DecisionError):
            provider.call("stability", {})
        self.assertEqual(provider.metrics_summary()["attemptCount"], 2)
        self.assertEqual(provider.metrics_summary()["successfulCalls"], 0)
        self.assertEqual(provider.metrics_summary()["statuses"], {"invalid_output": 2})
        for value in (-1, 2, 3, 0.5, True):
            with self.assertRaises(ValueError):
                self.provider(lambda *_: {}, format_retries=value)

    def test_correction_stage_retains_its_bounded_transient_retry(self):
        effects = [deepseek_response({"actions": [], "reason": "x" * 400}),
                   error.HTTPError(DEEPSEEK_ENDPOINT, 429, "private", {}, io.BytesIO()),
                   deepseek_response({"actions": [], "reason": "Wait for calmer surroundings."})]
        def transport(*_):
            value = effects.pop(0)
            if isinstance(value, Exception):
                raise value
            return value
        provider = self.provider(transport, retries=1, sleep=lambda _: None)
        self.assertEqual(provider.call("stability", {})["actions"], [])
        self.assertEqual([row["status"] for row in provider.metrics], ["invalid_output", "http_error", "ok"])
        self.assertEqual([row["formatCorrection"] for row in provider.metrics], [0, 1, 1])
        self.assertEqual(provider.metrics_summary()["callCount"], 1)

    def test_refusal_and_filtering_do_not_trigger_correction(self):
        for finish in ("content_filter", "aborted"):
            provider = self.provider(lambda *_, finish=finish: deepseek_response({}, finish))
            with self.assertRaises(DecisionError):
                provider.call("work", {})
            self.assertEqual(len(provider.metrics), 1)
        refused = deepseek_response({"actions": [], "reason": "No."})
        refused["choices"][0]["message"]["refusal"] = "private refusal"
        provider = self.provider(lambda *_: refused)
        with self.assertRaises(DecisionError):
            provider.call("work", {})
        self.assertEqual(len(provider.metrics), 1)

    def test_existing_profile_arrival_is_corrected_using_actual_engine_context(self):
        from backend.engine import _resident_context, advance_month, create_world
        class ResidentSetup:
            def call(self, role, context):
                if role == "narrator":
                    return {"character": "Synthetic quiet garden character."}
                actions = [{"towerId": "R42", "action": "move_in", "reason": "Garden fit."}] if role == "park" and context["step"] == 1 else []
                return {"actions": actions, "reason": "Keep current groups."}
        world = create_world({"buildings": [
            {"id": "R42", "type": "residential", "x": 0, "y": 0, "completionMonth": 1},
            {"id": "R43", "type": "residential", "x": 1, "y": 0, "completionMonth": 2}]})
        for month in ("2025-01-01", "2025-02-01"):
            world = advance_month(world, ResidentSetup(), month)
        before = copy.deepcopy(world)
        context = _resident_context(world, "park")
        by_id = {item["towerId"]: item for item in context["towers"]}
        self.assertEqual(by_id["R42"]["eligibleActions"], ["leave"])
        self.assertEqual(by_id["R43"]["eligibleActions"], ["move_in"])
        valid_action = {"towerId": "R43", "action": "move_in", "reason": "New outside group."}
        invalid = {"actions": [valid_action,
                   {"towerId": "R42", "action": "move_in", "reason": "private-old-response-marker"}],
                   "reason": "Garden preference."}
        # Negative control: the pre-fix schema-only validation accepts this.
        self.assertEqual(validate_decision("park", invalid), invalid)
        with self.assertRaises(DecisionError):
            validate_resident_eligibility("park", invalid, context)
        seen = []
        def transport(req, _timeout):
            seen.append(json.loads(req.data))
            return deepseek_response(invalid if len(seen) == 1 else {"actions": [valid_action], "reason": "Keep R42; add an outside group at R43."})
        provider = self.provider(transport)
        result = provider.call("park", context)
        self.assertEqual(result["actions"], [valid_action])
        self.assertEqual(len(seen), 2)
        self.assertEqual(provider.metrics[0]["validationError"], "Resident action is not eligible in supplied context")
        self.assertEqual([row["status"] for row in provider.metrics], ["invalid_output", "ok"])
        self.assertNotIn("private-old-response-marker", json.dumps(seen[1]))
        packet = json.loads(seen[1]["messages"][1]["content"])
        packet = decode_context_records(packet, provider.metrics[1]["contextEncoding"] == "exact-records-v1")
        self.assertEqual(packet["actionEligibility"],
                         {"R42": ["leave"], "R43": ["move_in"]})
        self.assertIn("eligibleActions", seen[1]["messages"][0]["content"])
        self.assertEqual(world, before)

    def test_ineligible_or_invented_action_rejects_entire_batch_after_correction(self):
        context = {"towers": [{"towerId": "R42", "eligibleActions": ["leave"]},
                              {"towerId": "R43", "eligibleActions": ["move_in"]},
                              {"towerId": "full", "eligibleActions": []}]}
        for bad_action in ({"towerId": "R42", "action": "move_in", "reason": "Already here."},
                           {"towerId": "invented", "action": "move_in", "reason": "Not supplied."},
                           {"towerId": "full", "action": "move_in", "reason": "No slot."},
                           {"towerId": "R43", "action": "leave", "reason": "No own group."}):
            batch = {"actions": [{"towerId": "R43", "action": "move_in", "reason": "Valid."}, bad_action], "reason": "Test."}
            # The leave-at-R43 case uses a separate valid tower to avoid a
            # duplicate-action schema error masking the eligibility failure.
            if bad_action["towerId"] == "R43":
                batch["actions"] = [bad_action]
            provider = self.provider(lambda *_, batch=batch: deepseek_response(batch))
            with self.assertRaises(DecisionError):
                provider.call("park", context)
            self.assertEqual(provider.metrics_summary()["statuses"], {"invalid_output": 2})
            self.assertEqual(provider.metrics_summary()["successfulCalls"], 0)

    def test_menu_is_derived_from_context_without_mutating_or_trusting_injected_menu(self):
        context = {"towers": [{"towerId": "R42", "eligibleActions": ["leave"]},
                              {"towerId": "R43", "eligibleActions": ["move_in"]}],
                   "actionEligibility": {"R42": ["move_in"]}}
        before = copy.deepcopy(context)
        provider = self.provider(lambda *_: None)
        packet = json.loads(provider.payload("park", context)["messages"][1]["content"])
        self.assertEqual(list(packet)[-1], "actionEligibility")
        self.assertEqual(packet["actionEligibility"], {"R42": ["leave"], "R43": ["move_in"]})
        self.assertEqual(context, before)

    def test_eligible_actions_and_omission_remain_allowed(self):
        context = {"towers": [{"towerId": "old", "eligibleActions": ["leave"]},
                              {"towerId": "new", "eligibleActions": ["move_in"]}]}
        for actions in ([], [{"towerId": "old", "action": "leave", "reason": "Exit district."},
                            {"towerId": "new", "action": "move_in", "reason": "Different new group."}]):
            value = {"actions": actions, "reason": "Current eligible choices."}
            self.assertEqual(self.provider(lambda *_, value=value: deepseek_response(value)).call("work", context), value)

    @patch.dict(os.environ, {"OPENAI_API_KEY": "dummy-openai"})
    def test_openai_context_guard_rejects_semantic_error_without_correction(self):
        value = {"actions": [{"towerId": "R42", "action": "move_in", "reason": "Invalid."}], "reason": "Test."}
        provider = OpenAIProvider(transport=lambda *_: response(value), retries=0)
        with self.assertRaises(DecisionError):
            provider.call("park", {"towers": [{"towerId": "R42", "eligibleActions": ["leave"]}]})
        self.assertEqual(provider.metrics_summary()["statuses"], {"invalid_output": 1})


class DualKeyTests(unittest.TestCase):
    def providers(self, transport):
        return [DeepSeekProvider(api_key="dummy-slot-" + str(slot), transport=transport,
                                 retries=0) for slot in (1, 2)]

    def test_sequential_calls_rotate_and_metrics_are_unique_safe_copies(self):
        slots, callbacks = [], []
        def transport(req, _timeout):
            slots.append(req.get_header("Authorization")[-1])
            return deepseek_response({"character": "Quiet."})
        provider = DualKeyProvider(self.providers(transport))
        provider.set_metrics_callback(callbacks.append)
        for _ in range(4):
            provider.call("narrator", {})
        self.assertEqual(slots, ["1", "2", "1", "2"])
        rows = provider.metrics
        self.assertEqual(len({row["callId"] for row in rows}), 4)
        self.assertEqual({row["credentialSlot"] for row in rows}, {1, 2})
        self.assertEqual(len(callbacks), 4)
        self.assertNotIn("dummy-slot", json.dumps(rows))
        rows[0]["status"] = "changed"
        self.assertEqual(provider.metrics_summary()["statuses"], {"ok": 4})
        self.assertEqual(provider.metrics_summary()["usage"]["total_tokens"], 296)

    def test_batch_parallelism_is_bounded_and_result_order_retained(self):
        lock = threading.Lock()
        barrier = threading.Barrier(2)
        active, maximum, per_slot = [0], [0], set()
        def transport(req, _timeout):
            slot = req.get_header("Authorization")[-1]
            context = json.loads(json.loads(req.data)["messages"][1]["content"])
            with lock:
                self.assertNotIn(slot, per_slot)
                per_slot.add(slot)
                active[0] += 1
                maximum[0] = max(maximum[0], active[0])
            barrier.wait(timeout=3)
            time.sleep(.005)
            with lock:
                active[0] -= 1
                per_slot.remove(slot)
            return deepseek_response({"actions": [], "reason": context["marker"]})
        provider = DualKeyProvider(self.providers(transport))
        results = provider.call_batch([(role, {"marker": role}) for role in ("budget", "work", "park", "stability")])
        self.assertEqual([item["reason"] for item in results], ["budget", "work", "park", "stability"])
        self.assertEqual(maximum[0], 2)
        self.assertEqual(provider.metrics_summary()["callCount"], 4)
        for row in provider.metrics:
            expected = hashlib.sha256(json.dumps({"marker": row["role"]}, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            self.assertEqual(row["contextSHA256"], expected)

    def test_one_batch_failure_is_an_item_and_does_not_lose_other_results(self):
        def transport(req, _timeout):
            value = json.loads(json.loads(req.data)["messages"][1]["content"])
            if value.get("fail"):
                raise error.HTTPError(DEEPSEEK_ENDPOINT, 401, "private", {}, io.BytesIO())
            return deepseek_response({"actions": [], "reason": "Stay."})
        provider = DualKeyProvider(self.providers(transport))
        results = provider.call_batch([("budget", {}), ("work", {"fail": True}), ("park", {})])
        self.assertIsInstance(results[1], ProviderError)
        self.assertEqual(results[0]["actions"], [])
        self.assertEqual(results[2]["actions"], [])
        self.assertEqual(provider.call_batch([]), [])
        self.assertIsInstance(provider.call_batch([None])[0], Exception)

    def test_callbacks_cannot_mutate_or_break_decisions(self):
        provider = DualKeyProvider(self.providers(lambda *_: deepseek_response({"character": "Quiet."})))
        def callback(row):
            row["status"] = "mutated"
            raise RuntimeError("private observer failure")
        provider.set_metrics_callback(callback)
        self.assertEqual(provider.call("narrator", {})["character"], "Quiet.")
        self.assertEqual(provider.metrics[0]["status"], "ok")


if __name__ == "__main__":
    unittest.main()

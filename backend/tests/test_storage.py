import copy
import gzip
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from backend import engine
from backend.ai import OfflineProvider
from backend.storage import (FORMAT, STATE_MAGIC, SharedStateStore, StorageError,
                             atomic_write_json, json_bytes, monthly_state_path, read_json)


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)
        self.store = SharedStateStore(self.folder)
        self.block = {"text": "Synthetic narrative repeated with exact facts. " * 100,
                      "nested": [{"fact": index} for index in range(20)]}
        self.value = {"config": copy.deepcopy(self.block), "left": copy.deepcopy(self.block),
                      "right": [copy.deepcopy(self.block)], "month": "2025-01-31"}

    def tearDown(self):
        self.temp.cleanup()

    def pool(self):
        return read_json(self.folder / "shared-objects.json.gz")

    def replace_object(self, transform):
        pool = self.pool()
        digest, envelope = next(iter(pool["objects"].items()))
        transform(envelope, digest)
        # Each corruption fixture deliberately starts with one shared object.
        self.assertEqual(len(pool["objects"]), 1)
        atomic_write_json(self.folder / "shared-objects.json.gz", pool, compress=True)

    def test_exact_tree_roundtrip_reuse_and_independent_mutable_branches(self):
        first = self.store.write("2025-01-31", self.value)
        original = copy.deepcopy(self.value)
        self.value["month"] = "2025-02-28"
        second = self.store.write("2025-02-28", self.value)
        self.assertEqual(self.store.read("2025-01-31"), original)
        restored = self.store.read("2025-02-28")
        self.assertEqual(restored, self.value)
        self.assertEqual(first["newSharedObjects"], 1)
        self.assertEqual(second["newSharedObjects"], 0)
        self.assertGreater(second["reusedSharedObjects"], 0)
        restored["left"]["nested"][0]["fact"] = -100
        self.assertEqual(restored["right"][0]["nested"][0]["fact"], 0)
        self.assertEqual(restored["config"]["nested"][0]["fact"], 0)
        self.assertEqual(self.value["left"]["nested"][0]["fact"], 0)

    def test_literal_reserved_data_and_legacy_plain_and_full_gzip_are_unambiguous(self):
        literal = {"format": FORMAT, "version": 1, "payload": None,
                   "refs": [{"path": [], "hash": "a" * 64}], "sha256": "a" * 64,
                   "other": {"$ref": "not-a-reference", "text": "NMSTATE1\n"}}
        for name, compressed in (("legacy.json", False), ("full.json.gz", True)):
            path = self.folder / name
            atomic_write_json(path, literal, compress=compressed)
            self.assertEqual(read_json(path), literal)
        self.store.write("2025-01-31", {"config": self.block, "literal": literal})
        self.assertEqual(self.store.read("2025-01-31")["literal"], literal)

    def test_complete_current_month_audit_survives_lossless_storage(self):
        world = engine.create_world({"grid": {"width": 3, "height": 3}, "buildings": [
            {"id": "R", "type": "residential", "x": 0, "y": 0, "completionMonth": 1},
            {"id": "B", "type": "business", "x": 1, "y": 0, "completionMonth": 1}]})
        world = engine.advance_month(world, OfflineProvider(), "2025-01-31")
        audit_before = json_bytes(world["audit"])
        self.store.write(world["month"], world)
        restored = self.store.read(world["month"])
        self.assertEqual(restored, world)
        self.assertEqual(json_bytes(restored["audit"]), audit_before)
        engine.assert_invariants(restored)

    def test_nonfinite_constants_and_exponent_overflow_are_rejected(self):
        for raw in (b'{"x":NaN}', b'{"x":Infinity}', b'{"x":1e999}'):
            for suffix, content in ((".json", raw), (".json.gz", gzip.compress(raw))):
                path = self.folder / ("invalid" + suffix)
                path.write_bytes(content)
                with self.assertRaises(StorageError):
                    read_json(path)
                self.assertEqual(path.read_bytes(), content)

    def test_truncated_and_invalid_deflate_fail_without_legacy_fallback(self):
        path = self.folder / "2025-01-31.json.gz"
        legacy = self.folder / "2025-01-31.json"
        legacy.write_bytes(b'{"legacy":true}')
        corrupt = bytearray(gzip.compress(b"{}", mtime=0))
        corrupt[10] = 255
        for content in (bytes(corrupt), gzip.compress(b"{}")[:-4], b"not-gzip"):
            path.write_bytes(content)
            self.assertEqual(monthly_state_path(self.folder, "2025-01-31"), path)
            with self.assertRaises(StorageError):
                read_json(path)
            self.assertEqual(path.read_bytes(), content)
            self.assertEqual(read_json(legacy), {"legacy": True})

    def test_missing_object_and_invalid_pool_fail_cleanly(self):
        self.store.write("2025-01-31", self.value)
        original = self.pool()
        for malformed in ({"format": "nm-shared-pool", "version": 1, "objects": {}},
                          {"format": "nm-shared-pool", "version": True, "objects": {}},
                          {"format": "nm-shared-pool", "version": 1, "objects": {"a" * 64: None}},
                          {"format": "nm-shared-pool", "version": 1, "objects": {"../escape": {}}}):
            atomic_write_json(self.folder / "shared-objects.json.gz", malformed, compress=True)
            with self.assertRaises(StorageError):
                self.store.read("2025-01-31")
        atomic_write_json(self.folder / "shared-objects.json.gz", original, compress=True)
        (self.folder / "shared-objects.json.gz").unlink()
        with self.assertRaises(StorageError):
            self.store.read("2025-01-31")

    def test_hash_mismatch_and_reference_cycles_are_rejected(self):
        self.store.write("2025-01-31", self.value)
        self.replace_object(lambda envelope, digest: envelope["payload"].update(text="changed"))
        with self.assertRaisesRegex(StorageError, "hash mismatch"):
            self.store.read("2025-01-31")
        # Restore a valid object, then inject a cycle. Hash verification cannot
        # be used as a substitute for terminating recursive reference loading.
        fresh = self.folder / "cycle"
        self.folder = fresh
        self.store = SharedStateStore(fresh)
        self.store.write("2025-01-31", self.value)
        def cycle(envelope, digest):
            envelope["payload"] = None
            envelope["refs"] = [{"path": [], "hash": digest}]
        self.replace_object(cycle)
        with self.assertRaisesRegex(StorageError, "Cyclic"):
            self.store.read("2025-01-31")

    def test_root_hash_and_reference_paths_are_validated(self):
        self.store.write("2025-01-31", self.value)
        path = monthly_state_path(self.folder, "2025-01-31")
        raw = gzip.decompress(path.read_bytes())
        envelope = json.loads(raw[len(STATE_MAGIC):])
        for transform in (lambda value: value["payload"].update(month="tampered"),
                          lambda value: value["refs"][0].update(path=["missing"]),
                          lambda value: value["refs"][0].update(hash="../escape"),
                          lambda value: value["refs"].append(copy.deepcopy(value["refs"][0]))):
            malformed = copy.deepcopy(envelope)
            transform(malformed)
            path.write_bytes(gzip.compress(STATE_MAGIC + json_bytes(malformed)))
            with self.assertRaises(StorageError):
                read_json(path)

    def test_corrupt_reused_object_prevents_new_month_publication(self):
        self.store.write("2025-01-31", self.value)
        self.replace_object(lambda envelope, digest: envelope["payload"].update(text="corrupt"))
        corrupted = (self.folder / "shared-objects.json.gz").read_bytes()
        with self.assertRaises(StorageError):
            self.store.write("2025-02-28", self.value)
        self.assertFalse((self.folder / "2025-02-28.json.gz").exists())
        self.assertEqual((self.folder / "shared-objects.json.gz").read_bytes(), corrupted)

    def test_failed_pool_or_root_publication_preserves_previous_readable_month(self):
        self.store.write("2025-01-31", self.value)
        previous = monthly_state_path(self.folder, "2025-01-31").read_bytes()
        changed = copy.deepcopy(self.value)
        changed["config"]["text"] = "Different shared facts. " * 200
        from backend import storage
        publish = storage._atomic_write_bytes
        for target in ("shared-objects.json.gz", "2025-01-31.json.gz"):
            def fail(path, payload):
                if Path(path).name == target:
                    raise OSError("Simulated interruption before atomic publication")
                return publish(path, payload)
            with patch("backend.storage._atomic_write_bytes", side_effect=fail):
                with self.assertRaises(OSError):
                    self.store.write("2025-01-31", changed)
            self.assertEqual(monthly_state_path(self.folder, "2025-01-31").read_bytes(), previous)
            self.assertEqual(self.store.read("2025-01-31"), self.value)

    def test_plain_atomic_writer_leaves_previous_file_on_replace_failure(self):
        path = self.folder / "catalog.json"
        atomic_write_json(path, {"saved": True})
        original = path.read_bytes()
        with patch("backend.storage.os.replace", side_effect=OSError("simulated disk failure")):
            with self.assertRaises(OSError):
                atomic_write_json(path, {"saved": False})
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(list(self.folder.glob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main()

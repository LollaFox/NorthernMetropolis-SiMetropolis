import copy
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest

from sandbox import engine
from sandbox.ai import Provider, DecisionError
from sandbox.service import CityService


class FakeProvider:
    available = True
    provider = "mock"
    model = "mock-only"

    def __init__(self, fail=False):
        self.started = threading.Event()
        self.release = threading.Event()
        self.fail = fail

    def decide(self, actor, packet):
        self.started.set()
        self.release.wait(3)
        if self.fail:
            raise RuntimeError("private provider detail must not leak")
        return ({"actor": actor, "action": "wait", "reason": "Mock check", "message": "Observing public facts",
                 "sourceType": "live"}, {"actor": actor, "usage": {"totalTokens": 12}, "inputBytes": 100})


class ServiceTests(unittest.TestCase):
    def test_history_rewind_branch_isolation_and_intervention(self):
        city = CityService(start=False)
        for _ in range(8):
            city.advance()
        parent = city.active
        preserved = copy.deepcopy(city.branches[parent])
        city.command("seek", {"month": 3})
        self.assertEqual(city.state()["world"], preserved["history"][3])
        city.command("intervention", {"text": "Build affordable housing", "kind": "build_housing"})
        self.assertNotEqual(city.active, parent)
        self.assertEqual(city.branches[parent], preserved)
        self.assertEqual(city.state()["world"]["month"], 3)
        city.command("control", {"playing": True})
        city.advance()
        self.assertEqual(city.state()["world"]["month"], 4)
        self.assertEqual(city.branches[parent], preserved)

    def test_resume_history_creates_a_future_without_erasing_original(self):
        city = CityService(start=False)
        for _ in range(5):
            city.advance()
        parent = city.active
        city.command("seek", {"month": 1})
        city.command("control", {"playing": True, "speed": 8})
        city.advance()
        self.assertEqual(city.state()["parentId"], parent)
        self.assertEqual(city.state()["world"]["month"], 2)
        city.command("switch", {"id": parent})
        self.assertEqual(city.state()["world"]["month"], 5)
        self.assertFalse(city.playing)

    def test_rejected_input_is_atomic_and_pause_freezes(self):
        city = CityService(start=False)
        for action, body in [("control", {"speed": True}), ("control", {"playing": "yes"}),
                             ("seek", {"month": -1}), ("seek", {"month": 99}),
                             ("mode", {"mode": "live"}), ("intervention", {"text": ""}),
                             ("reset", {"seed": True}), ("branch", {"month": 2}),
                             ("branch", {"label": "\ud800"}), ("intervention", {"text": "\ud800"})]:
            before = city.state()
            with self.assertRaises(ValueError, msg=(action, body)):
                city.command(action, body)
            self.assertEqual(city.state(), before)
        city.command("control", {"playing": False})
        city.advance()
        self.assertEqual(city.state()["world"]["month"], 0)

    def test_autosave_restore_preserves_branches_and_starts_paused(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "save.json"
            city = CityService(save_path=path, start=False)
            city.advance()
            city.command("branch", {"month": 0, "label": "Greener future"})
            city.ai.update({"requests": 24, "lifetimeRequests": 24,
                            "attempts": [{"request": 24, "outcome": "queued"}]})
            city.save()
            restored = CityService(save_path=path, start=False)
            self.assertEqual(restored.branches, city.branches)
            self.assertEqual(restored.active, city.active)
            self.assertFalse(restored.playing)
            self.assertEqual(restored.mode, "rules")
            self.assertEqual(restored.ai["requests"], 0)
            self.assertEqual(restored.ai["lifetimeRequests"], 24)
            self.assertEqual(restored.ai["attempts"], city.ai["attempts"])
            self.assertFalse(path.with_suffix(".tmp").exists())

    def test_corrupt_save_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "save.json"
            path.write_text('{"schemaVersion": 99}')
            with self.assertRaises(ValueError):
                CityService(save_path=path, start=False)
            self.assertEqual(path.read_text(), '{"schemaVersion": 99}')

    def wait_for(self, predicate):
        limit = time.monotonic() + 2
        while time.monotonic() < limit:
            if predicate():
                return
            time.sleep(0.02)
        self.fail("Timed out waiting for background state")

    def test_slow_ai_does_not_block_input_and_old_generation_is_discarded(self):
        provider = FakeProvider()
        city = CityService(provider=provider, live_limit=1)
        try:
            city.command("mode", {"mode": "live"})
            self.assertTrue(provider.started.wait(1))
            start = time.monotonic()
            city.command("intervention", {"text": "Protect wetlands", "kind": "build_park"})
            city.command("control", {"playing": False})
            self.assertLess(time.monotonic() - start, 0.2)
            provider.release.set()
            self.wait_for(lambda: len(city.ai["attempts"]) == 1)
            self.assertEqual(city.ai["attempts"][0]["outcome"], "discarded_stale")
            self.assertFalse(city._pending)
            self.assertEqual(city.ai["requests"], 1)
        finally:
            provider.release.set()
            city.close()

    def test_provider_error_is_visible_and_never_silently_becomes_rules(self):
        provider = FakeProvider(fail=True)
        provider.release.set()
        city = CityService(provider=provider, live_limit=1)
        try:
            city.command("mode", {"mode": "live"})
            self.wait_for(lambda: city.ai["status"] == "error")
            self.assertEqual(city.mode, "live")
            self.assertEqual(city.ai["errors"], 1)
            self.assertNotIn("private provider", city.ai["lastError"])
            city.advance()
            self.assertEqual(city.state()["world"]["month"], 1)
            self.assertEqual(city.ai["requests"], 1)
        finally:
            city.close()

    def test_stale_provider_failure_clears_thinking_and_keeps_audit(self):
        provider = FakeProvider(fail=True)
        city = CityService(provider=provider, live_limit=2)
        try:
            city.command("mode", {"mode": "live"})
            self.assertTrue(provider.started.wait(1))
            city.command("control", {"playing": False})
            provider.release.set()
            self.wait_for(lambda: city.ai["errors"] == 1)
            self.assertEqual(city.ai["status"], "ready")
            self.assertEqual(city.ai["attempts"][0]["outcome"], "provider_error")
        finally:
            provider.release.set()
            city.close()

    def test_live_queue_is_applied_and_request_limit_is_observed(self):
        provider = FakeProvider()
        provider.release.set()
        city = CityService(provider=provider, live_limit=1)
        try:
            city.command("mode", {"mode": "live"})
            self.wait_for(lambda: bool(city._pending))
            city.advance()
            self.assertTrue(any(m["sourceType"] == "live" for m in city.state()["world"]["messages"]))
            self.assertEqual(city.ai["attempts"][0]["outcome"], "applied")
            self.wait_for(lambda: city.ai["status"] == "budget_exhausted")
            self.assertEqual(city.ai["requests"], 1)
        finally:
            city.close()


class Transport:
    LLM_PROVIDER = "mock"
    MODEL = "mock"
    REASONING_EFFORT = "none"
    live_available = staticmethod(lambda: True)


class AITests(unittest.TestCase):
    def test_all_role_payloads_are_bounded_and_have_strict_actions(self):
        provider = Provider(Transport())
        world = engine.create_world()
        for actor in ("government", "business", "residents", "energy"):
            payload, size = provider.payload(engine.actor_packet(world, actor))
            self.assertLessEqual(size, 8192)
            self.assertEqual(size, len(json.dumps(payload).encode("utf-8")))
            self.assertEqual(payload["max_output_tokens"], 768)
            self.assertTrue(payload["text"]["format"]["strict"])
            self.assertFalse(payload["store"])

    def test_oversized_packet_fails_before_transport(self):
        with self.assertRaises(DecisionError):
            Provider(Transport()).payload({"allowedActions": ["wait"], "note": "x" * 10000})

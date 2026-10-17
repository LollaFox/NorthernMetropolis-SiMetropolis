import copy
import argparse
import contextlib
import http.client
import json
import io
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from backend.ai import OfflineProvider
from backend.cli import add_pacing_arguments, add_provider_arguments, add_scenario_arguments, configured_provider_factory, configured_scenario, default_run_end
from backend.scenario import northern_metropolis_scenario
from backend.storage import atomic_write_json, read_json
from backend.server import SavedCity, make_server, seed_offline_demo
from backend.service import NarrativeService, ServiceError, schedule, validate_setup


ROOT = Path(__file__).resolve().parents[2]
NODE = Path(os.environ.get("NODE") or shutil.which("node") or
            Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node")
SETUP = {"bounds": {"west": 114, "south": 22.45, "east": 114.2, "north": 22.6},
         "start": "2024-01-31", "end": "2024-05-31", "step": "quarter",
         "policyScope": {"policyId": "test-policy", "tags": ["housing-affordability"]}}
SCENARIO = {"grid": {"width": 3, "height": 3}, "buildings": [
    {"id": "R1", "type": "residential", "x": 0, "y": 0, "completionMonth": 1},
    {"id": "B1", "type": "business", "x": 1, "y": 0, "completionMonth": 1},
    {"id": "P1", "type": "park", "x": 0, "y": 1, "completionMonth": 2},
    {"id": "S1", "type": "station", "x": 2, "y": 1, "completionMonth": 2}]}


def prepare(service, setup=None, prefix="test"):
    review = service.initialize(setup or SETUP, b"%PDF-1.4\nTest\n", "test.pdf", prefix + "_initialize")
    service.confirm(review["initializationId"], {"reviewVersion": review["reviewVersion"]}, prefix + "_confirm")
    body = {"initializationId": review["initializationId"], "reviewVersion": review["reviewVersion"]}
    return review, body


def finish(service, result):
    deadline = time.monotonic() + 20
    while result["status"] in ("queued", "running") and time.monotonic() < deadline:
        time.sleep(.01)
        result = service.job(result["jobId"])
    if result["status"] != "complete":
        raise AssertionError(result)
    return result["result"]


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = NarrativeService(self.temp.name, scenario=SCENARIO, today="2026-10-16")

    def tearDown(self):
        self.service.close()
        self.temp.cleanup()

    def test_pausing_older_saved_run_keeps_its_identity_and_month(self):
        _, first_body = prepare(self.service, prefix="older_replay")
        older = finish(self.service, self.service.simulate(first_body, "older_replay_run"))
        _, next_body = prepare(self.service, prefix="newer_replay")
        newer = finish(self.service, self.service.simulate(next_body, "newer_replay_run"))
        self.assertNotEqual(older["simulationId"], newer["simulationId"])
        city = SavedCity(self.service)
        city.command("switch", {"id": older["simulationId"]})
        city.command("seek", {"month": 1})
        city.command("control", {"playing": True})
        paused = city.command("control", {"playing": False})
        self.assertEqual(paused["id"], older["simulationId"])
        self.assertEqual(paused["world"]["sourceDate"], "2024-02-29")
        self.assertFalse(paused["playing"])

    def test_saved_playback_advances_months_stops_at_end_and_does_not_change_history(self):
        _, body = prepare(self.service, prefix="monthly_replay")
        run = finish(self.service, self.service.simulate(body, "monthly_replay_run"))
        before = self.service.export(run["simulationId"])
        with patch("backend.server.time.monotonic", return_value=100):
            city = SavedCity(self.service)
            city.command("seek", {"month": 0})
            city.command("control", {"playing": True, "speed": 1})
        with patch("backend.server.time.monotonic", return_value=101.7):
            advanced = city.state()
        self.assertEqual(advanced["world"]["sourceDate"], "2024-02-29")
        self.assertTrue(advanced["playing"])
        with patch("backend.server.time.monotonic", return_value=110):
            last = city.state()
        self.assertEqual(last["world"]["sourceDate"], "2024-05-31")
        self.assertFalse(last["playing"])
        self.assertEqual(self.service.export(run["simulationId"]), before)

    def test_schedule_matches_original_month_anchor_and_limits(self):
        self.assertEqual(schedule("2024-01-31", "2024-05-31"),
                         ["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30", "2024-05-31"])
        self.assertEqual(schedule("2024-02-29", "2026-02-28", "year"),
                         ["2024-02-29", "2025-02-28", "2026-02-28"])
        for extra in ({"start": "2026-10-16"}, {"step": []}, {"policyScope": "bad"},
                      {"start": "2024-02-30"}, {"bounds": {"west": True}},
                      {"start": "2000-01-01", "end": "2030-01-01", "step": "month"}):
            with self.assertRaises(ServiceError, msg=extra):
                validate_setup({**SETUP, **extra}, today="2026-10-16")

    def test_history_index_omits_unrun_drafts_and_never_loads_worlds(self):
        self.service.initialize(SETUP, b"%PDF-draft", "draft.pdf", "history_draft")
        self.assertEqual(self.service.list_simulations()["simulations"], [])
        _, body = prepare(self.service, prefix="history_index")
        result = finish(self.service, self.service.simulate(body, "history_index_run"))
        before = copy.deepcopy(self.service.catalog)
        with patch.object(self.service, "_load_world", side_effect=AssertionError("No full export for an index")):
            index = self.service.list_simulations()
        row = index["simulations"][0]
        self.assertEqual(index["schema"], "nm-analysis-history-v1")
        self.assertEqual(row["simulationId"], result["simulationId"])
        self.assertEqual((row["start"], row["end"], row["savedMonths"]), ("2024-01-31", "2024-05-31", 5))
        self.assertEqual(row["status"], "complete")
        self.assertTrue(row["synthetic"])
        self.assertNotIn("monthlyStates", row)
        row["status"] = "changed by caller"
        self.assertEqual(self.service.catalog, before)

    def test_history_index_labels_partial_runs_and_orders_recent_first(self):
        for prefix in ("history_old", "history_new"):
            _, body = prepare(self.service, prefix=prefix)
            result = finish(self.service, self.service.simulate(body, prefix+"_run"))
        identifier = result["simulationId"]
        with self.service.lock:
            self.service.catalog["simulations"][identifier]["months"] = ["2024-01-31"]
            job = next(job for job in self.service.catalog["jobs"].values() if job.get("simulationId") == identifier)
            job["status"] = "failed"
        rows = self.service.list_simulations()["simulations"]
        self.assertEqual(rows[0]["simulationId"], identifier)
        self.assertEqual(rows[0]["status"], "failed")
        self.assertEqual(rows[0]["savedMonths"], 1)
        self.assertGreater(rows[0]["createdOrder"], rows[1]["createdOrder"])

    def test_initialization_semantic_idempotency_and_version_confirmation(self):
        first = self.service.initialize(SETUP, b"%PDF-first", "a.pdf", "same")
        second = self.service.initialize(dict(reversed(list(SETUP.items()))), b"%PDF-first", "renamed.pdf", "same")
        self.assertEqual(first, second)
        with self.assertRaises(ServiceError) as error:
            self.service.initialize(SETUP, b"%PDF-different", "a.pdf", "same")
        self.assertEqual(error.exception.status, 409)
        with self.assertRaises(ServiceError):
            self.service.confirm(first["initializationId"], {"reviewVersion": "wrong"}, "bad_confirm")
        body = {"initializationId": first["initializationId"], "reviewVersion": first["reviewVersion"]}
        with self.assertRaises(ServiceError):
            self.service.simulate(body, "unconfirmed")
        confirmed = self.service.confirm(first["initializationId"], {"reviewVersion": first["reviewVersion"]}, "confirm")
        self.assertTrue(confirmed["confirmed"])
        self.assertEqual(confirmed, self.service.confirm(first["initializationId"], {"reviewVersion": first["reviewVersion"]}, "confirm"))

    def test_review_uses_custom_parameters_and_discloses_policy_override(self):
        custom = NarrativeService(Path(self.temp.name) / "custom", scenario={**SCENARIO, "groupSize": 10, "groupWorkers": 6, "towerGroupSlots": 2})
        try:
            review = custom.initialize(SETUP, b"%PDF-test", "a.pdf", "custom")
            people = next(item["value"] for item in review["items"] if item["id"] == "people")
            self.assertIn("10 residents/group", people)
            self.assertIn("6 potential workers", people)
            self.assertIn("20 resident places", people)
            authority = next(item for item in review["items"] if item["id"] == "authority")
            self.assertIn("instead", authority["value"])
            self.assertTrue(all(item["kind"] == "assumption" for item in review["items"]))
        finally:
            custom.close()

    def test_async_simulation_monthly_save_sparse_output_and_replay(self):
        _, body = prepare(self.service)
        first = self.service.simulate(body, "run")
        result = finish(self.service, first)
        self.assertEqual([f["date"] for f in result["snapshots"]], ["2024-01-31", "2024-04-30"])
        exported = self.service.export(result["simulationId"])
        self.assertEqual([w["month"] for w in exported["monthlyStates"]], schedule(SETUP["start"], SETUP["end"]))
        for world, totals in zip(exported["monthlyStates"], exported["monthlyBuildingTotals"]):
            self.assertEqual(totals["date"], world["month"])
            self.assertEqual(sum(row["actualResidents"] for row in totals["buildings"]), world["metrics"]["population"])
            self.assertEqual(sum(row["offeredJobs"] for row in totals["buildings"]), world["metrics"]["jobCapacity"])
            self.assertEqual(sum(row["filledJobs"] for row in totals["buildings"]), world["metrics"]["filledJobs"])
        self.assertTrue(all(self.service._world_path(result["simulationId"], day).suffix == ".gz" for day in schedule(SETUP["start"], SETUP["end"])))
        self.assertEqual(self.service.simulate(body, "run")["result"], result)
        self.assertEqual(len(self.service.catalog["simulations"]), 1)
        snapshot = self.service.get_snapshot(result["simulationId"], result["snapshots"][-1]["id"])
        self.assertEqual(len(snapshot["height"]["values"]), 1_000_000)
        self.assertEqual(set(snapshot["height"]["values"]), {0})
        self.assertEqual(set(snapshot["pollution"]["values"]), {-1})
        self.assertEqual(len(snapshot["zones"]), 4)
        self.assertTrue(all(zone["boundary"][0] == zone["boundary"][-1] for zone in snapshot["zones"]))
        self.assertEqual(snapshot["mtr"], [])
        self.assertEqual(sum(j["count"] for z in snapshot["zones"] for j in z["jobs"]), exported["monthlyStates"][3]["metrics"]["filledJobs"])
        restored = NarrativeService(self.temp.name, scenario=SCENARIO)
        try:
            self.assertEqual(restored.job(first["jobId"])["result"], result)
            self.assertEqual(restored.export(result["simulationId"]), exported)
        finally:
            restored.close()

    def test_legacy_plain_full_gzip_and_shared_months_export_after_restart(self):
        _, body = prepare(self.service)
        started = self.service.simulate(body, "mixed_storage")
        result = finish(self.service, started)
        simulation_id = result["simulationId"]
        original = self.service.export(simulation_id)
        preserved = {}
        for world in original["monthlyStates"][:2]:
            compressed = self.service._world_path(simulation_id, world["month"])
            legacy = compressed.with_suffix("")
            atomic_write_json(legacy, world)
            compressed.unlink()  # Temporary fixture models an old existing run.
            preserved[legacy] = legacy.read_bytes()
        third = original["monthlyStates"][2]
        full_gzip = self.service._world_path(simulation_id, third["month"])
        atomic_write_json(full_gzip, third, compress=True)
        preserved[full_gzip] = full_gzip.read_bytes()
        self.service.close()
        self.service = NarrativeService(self.temp.name, scenario=SCENARIO,
                                        provider_factory=lambda: (_ for _ in ()).throw(AssertionError("no replay calls")))
        restored = self.service.export(simulation_id)
        self.assertEqual(restored, original)
        self.assertEqual(self.service.simulate(body, "mixed_storage")["result"], result)
        self.assertTrue(all(path.read_bytes() == content for path, content in preserved.items()))

    def test_corrupt_state_returns_clean_error_and_preserves_file(self):
        _, body = prepare(self.service)
        result = finish(self.service, self.service.simulate(body, "corrupt"))
        frame = result["snapshots"][0]
        path = self.service._world_path(result["simulationId"], frame["date"])
        path.write_bytes(b"deliberately corrupted temporary state")
        with self.assertRaises(ServiceError) as error:
            self.service.get_snapshot(result["simulationId"], frame["id"])
        self.assertEqual(error.exception.status, 500)
        self.assertNotIn(str(path), str(error.exception))
        self.assertEqual(path.read_bytes(), b"deliberately corrupted temporary state")

    def test_restart_interrupt_requires_explicit_retry_and_retains_metrics(self):
        class ProcessCrashFixture(OfflineProvider):
            def call(self, role, context):
                if context["step"] == 2:
                    raise SystemExit("Simulate process termination before next monthly checkpoint")
                return super().call(role, context)
        self.service.provider_factory = ProcessCrashFixture
        _, body = prepare(self.service)
        started = self.service.simulate(body, "resume")
        self.service.threads[started["jobId"]].join(5)
        self.assertFalse(self.service.threads[started["jobId"]].is_alive())
        original = self.service.catalog["simulations"][self.service.job(started["jobId"])["simulationId"]]
        self.assertEqual(len(original["months"]), 1)
        prior_attempts = copy.deepcopy(original["providerMetrics"]["attempts"])
        prior_count = original["providerMetrics"]["summary"]["callCount"]
        self.service.close()
        resumed = NarrativeService(self.temp.name, scenario=SCENARIO)
        self.service = resumed
        interrupted = resumed.job(started["jobId"])
        self.assertEqual(interrupted["status"], "failed")
        self.assertTrue(interrupted["recoverable"])
        self.assertEqual(resumed.threads, {})
        final = finish(resumed, resumed.simulate(body, "resume"))
        self.assertEqual(final["simulationId"], started.get("simulationId", interrupted["simulationId"]))
        self.assertEqual(final["providerMetrics"]["attempts"][:len(prior_attempts)], prior_attempts)
        self.assertEqual(final["providerMetrics"]["summary"]["callCount"], prior_count + 17)
        self.assertEqual(len(resumed.export(final["simulationId"])["monthlyStates"]), 5)

    def test_saved_city_year_boundary_display_and_replay(self):
        setup = {**SETUP, "start": "2024-11-30", "end": "2025-02-28", "step": "month"}
        _, body = prepare(self.service, setup)
        run = finish(self.service, self.service.simulate(body, "replay"))
        city = SavedCity(self.service)
        initial = city.state()
        self.assertEqual(initial["world"]["month"], 10)
        self.assertEqual(initial["world"]["sourceDate"], "2024-11-30")
        latest = city.command("switch", {"id": run["simulationId"]})
        self.assertEqual([frame["month"] for frame in latest["timeline"]], [10, 11, 12, 13])
        self.assertEqual(latest["world"]["year"], 2025)
        self.assertEqual(latest["world"]["month"], 13)
        older = city.command("seek", {"month": 11})
        self.assertEqual(older["world"]["sourceDate"], "2024-12-30")
        city.command("control", {"playing": True})
        city.last_tick -= 10
        self.assertEqual(city.state()["world"]["month"], 13)
        self.assertEqual(city.command("switch", {"id": run["simulationId"]})["viewingMonth"], None)
        self.assertIsNone(latest["world"]["metrics"]["airQuality"])
        for action in ("intervention", "branch", "reset"):
            with self.assertRaises(ServiceError):
                city.command(action, {})

    def test_attempt_progress_is_durable_before_month_checkpoint(self):
        gate, release = threading.Event(), threading.Event()
        class ProgressFixture(OfflineProvider):
            def call(self, role, context):
                result = super().call(role, context)
                if role == "narrator":
                    gate.set()
                    release.wait(5)
                return result
        self.service.provider_factory = ProgressFixture
        _, body = prepare(self.service)
        started = self.service.simulate(body, "progress")
        try:
            self.assertTrue(gate.wait(3))
            job = self.service.job(started["jobId"])
            self.assertEqual(job["completedMonths"], 0)
            self.assertGreater(job["progress"]["attemptCount"], 0)
            self.assertEqual(job["progress"]["activeMonth"], SETUP["start"])
            persisted = json.loads(self.service.catalog_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["jobs"][started["jobId"]]["progress"], job["progress"])
        finally:
            release.set()
        finish(self.service, started)

    def test_partial_runtime_failure_retries_same_job_without_reapplying_saved_month(self):
        from backend import engine
        advance = engine.advance_month
        def fail_second_month(world, provider, day):
            if world["step"] == 1:
                raise RuntimeError("private transport detail is never returned")
            return advance(world, provider, day)
        _, body = prepare(self.service)
        with patch("backend.service.engine.advance_month", side_effect=fail_second_month):
            started = self.service.simulate(body, "runtime_retry")
            self.service.threads[started["jobId"]].join(5)
        failed = self.service.job(started["jobId"])
        self.assertEqual(failed["status"], "failed")
        self.assertTrue(failed["recoverable"])
        self.assertNotIn("private", failed["error"])
        first_path = self.service._world_path(failed["simulationId"], SETUP["start"])
        first_bytes = first_path.read_bytes()
        final = finish(self.service, self.service.simulate(body, "runtime_retry"))
        self.assertEqual(final["simulationId"], failed["simulationId"])
        self.assertEqual(first_path.read_bytes(), first_bytes)
        self.assertEqual(len(self.service.export(final["simulationId"])["monthlyStates"]), 5)

    def test_offline_demo_is_idempotent_and_does_not_use_live_factory(self):
        def forbidden():
            raise AssertionError("Startup must never use live provider")
        self.service.provider_factory = forbidden
        simulation_id = seed_offline_demo(self.service)
        self.assertEqual(seed_offline_demo(self.service), simulation_id)
        self.assertEqual(len(self.service.catalog["simulations"]), 1)
        final = self.service.export(simulation_id)["monthlyStates"][-1]
        self.assertEqual(final["step"], 12)


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = NarrativeService(self.temp.name, scenario=SCENARIO, today="2026-10-16")
        self.server = make_server(0, self.service, demo=False)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = "http://127.0.0.1:%s" % self.server.server_port

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(3)
        self.service.close()
        self.temp.cleanup()

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            conn.request(method, path, body, headers or {})
            response = conn.getresponse()
            return response.status, response.read()
        finally:
            conn.close()

    def test_http_serves_unchanged_frontend_bootstrap_and_reports_errors(self):
        status, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertEqual(body, (ROOT / "sandbox/web/index.html").read_bytes())
        status, body = self.request("GET", "/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["world"]["version"], "narrative-display-1")
        self.assertEqual(self.request("GET", "/api/v3/config")[0], 200)
        history_status, history_body = self.request("GET", "/api/v3/simulations")
        self.assertEqual(history_status, 200)
        self.assertEqual(json.loads(history_body)["schema"], "nm-analysis-history-v1")
        self.assertEqual(self.request("GET", "/config")[0], 200)
        self.assertEqual(self.request("GET", "/api/v3/jobs/missing")[0], 404)
        self.assertEqual(self.request("GET", "/", headers={"Host": "evil.example"})[0], 403)
        self.assertEqual(self.request("POST", "/api/v3/simulations", b"{}", {"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("POST", "/api/v3/simulations", b"{}", {"Content-Type": "application/json"})[0], 400)
        self.assertEqual(self.request("GET", "/../../backend/server.py")[0], 404)
        self.assertIn(b"unmodeled", self.request("GET", "/api/model")[1])

    def test_real_frontend_v3session_over_http_and_geometry(self):
        self.assertTrue(NODE.is_file(), "Set NODE to an existing Node runtime, or use the installed bundled runtime; no dependency installation is required")
        completed = subprocess.run([str(NODE), str(Path(__file__).with_name("contract_bridge.mjs")), self.base],
                                   cwd=str(ROOT), capture_output=True, text=True, timeout=30)
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        result = json.loads(completed.stdout)
        self.assertEqual(result["state"], "ready")
        self.assertEqual(result["snapshots"], 2)
        self.assertEqual(result["checks"], 17)

    def test_regional_scale_is_exposed_in_model_and_initialization_review(self):
        self.service.config = northern_metropolis_scenario()
        status, raw = self.request("GET", "/api/model")
        self.assertEqual(status, 200)
        model = json.loads(raw)
        self.assertEqual(model["scale"]["referenceHousingCapacity"], 2_500_000)
        self.assertEqual(model["scale"]["referenceJobs"], 650_000)
        self.assertIn("not measured", " ".join(model["populationAccounting"]))
        review = self.service.initialize(SETUP, b"%PDF-test", "regional.pdf", "regional")
        scale = next(item for item in review["items"] if item["id"] == "regional_scale")
        self.assertIn("development cluster", scale["value"])
        self.assertIn("not forced", scale["value"])


class StartupTests(unittest.TestCase):
    def arguments(self, words):
        parser = argparse.ArgumentParser()
        add_scenario_arguments(parser)
        add_provider_arguments(parser)
        add_pacing_arguments(parser)
        return parser.parse_args(words)

    def test_offline_default_openai_legacy_and_explicit_pacing(self):
        factory = configured_provider_factory(self.arguments([]))
        self.assertIsInstance(factory(), OfflineProvider)
        self.assertEqual(factory.configuration["provider"], "offline")
        with patch("backend.cli.OpenAIProvider") as provider:
            configured_provider_factory(self.arguments(["--live"]))()
            provider.assert_called_once_with(model="gpt-6.1-sol", timeout=45.0, retries=2)
        scenario = configured_scenario(self.arguments(["--residential-starts-per-month", "5", "--construction-months", "2"]))
        homes = [b for b in scenario["buildings"] if b["type"] == "residential"]
        self.assertEqual(sum(b["startMonth"] == 1 for b in homes), 5)
        self.assertEqual(max(b["completionMonth"] for b in homes), 11)
        self.assertTrue(all(b["completionMonth"] - b["startMonth"] == 1 for b in homes))

    def test_regional_preset_defaults_to_full_script_and_rejects_scenario_conflict(self):
        regional = configured_scenario(self.arguments(["--preset", "northern-metropolis"]))
        self.assertEqual(regional, northern_metropolis_scenario())
        self.assertEqual(default_run_end("2025-01-01", regional), "2026-09-01")
        self.assertEqual(default_run_end("2025-01-31", regional), "2026-09-30")
        demo = configured_scenario(self.arguments([]))
        self.assertEqual(configured_scenario(self.arguments(["--preset", "demo"])), demo)
        self.assertEqual(default_run_end("2025-01-01", demo), "2025-12-01")
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            self.arguments(["--scenario", "any.json", "--preset", "northern-metropolis"])

    def test_two_key_files_feed_one_flash_provider_without_public_secrets(self):
        with tempfile.TemporaryDirectory() as folder:
            paths = [Path(folder) / ("credential-%s.key" % index) for index in (1, 2)]
            values = ["dummy-first-credential", "dummy-second-credential"]
            for path, value in zip(paths, values):
                path.write_text(value + "\n", encoding="utf-8")
            words = ["--provider", "deepseek", "--api-key-file", str(paths[0]), "--api-key-file", str(paths[1]), "--timeout", "120"]
            factory = configured_provider_factory(self.arguments(words))
            with patch("backend.ai.DeepSeekProvider") as provider, patch("backend.ai.DualKeyProvider") as dual:
                expected = [object(), object()]
                provider.side_effect = expected
                factory()
                dual.assert_called_once_with(expected)
                self.assertEqual(provider.call_count, 2)
                for call, value in zip(provider.call_args_list, values):
                    self.assertEqual(call.kwargs, {"model": "deepseek-flash", "api_key": value, "timeout": 120.0, "retries": 2})
            public = json.dumps(factory.configuration)
            self.assertTrue(all(value not in public and str(path) not in public for value, path in zip(values, paths)))
            self.assertEqual(factory.configuration["credentialSlots"], 2)
            self.assertFalse(factory.configuration["model"].endswith("pro"))

    def test_startup_rejects_missing_duplicate_or_unrequested_credentials(self):
        with tempfile.TemporaryDirectory() as folder:
            first, second = Path(folder) / "a.key", Path(folder) / "b.key"
            for path in (first, second):
                path.write_text("same-dummy-key", encoding="utf-8")
            cases = [["--provider", "deepseek", "--api-key-file", str(Path(folder) / "missing.key")],
                     ["--provider", "deepseek", "--api-key-file", str(first), "--api-key-file", str(second)],
                     ["--api-key-file", str(first)], ["--provider", "offline", "--live"], ["--timeout", "nan"]]
            for words in cases:
                with self.assertRaises(ValueError, msg=words):
                    configured_provider_factory(self.arguments(words))


if __name__ == "__main__":
    unittest.main()

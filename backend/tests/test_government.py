import copy
import tempfile
import unittest
from pathlib import Path

from backend import ai, hk_minimal
from backend.government_cli import dry_decision, run_layout


class GovernmentTests(unittest.TestCase):
    def test_wait_changes_schedule_and_no_other_roles(self):
        class Provider:
            roles = []
            def call(self, role, context):
                self.roles.append(role)
                return {"startProjects": [], "reason": "Wait."}
            def metrics_summary(self):
                return {"roles": self.roles}
        provider = Provider()
        config = hk_minimal.demo_config()
        config["months"] = 3
        with tempfile.TemporaryDirectory() as folder:
            result = run_layout(config, "mixed", Path(folder) / "run", provider)
            self.assertEqual(provider.roles, ["government"] * 3)
            self.assertTrue(all(b["status"] == "planned" for b in result["buildings"]))
            self.assertTrue(all(row["construction_spending"] == 0 for row in result["monthly"]))

    def test_layouts_fixed_budget_and_completion(self):
        for layout in ("mixed", "segregated"):
            config = hk_minimal.demo_config()
            config["months"] = 24
            before = copy.deepcopy(config)
            result = hk_minimal.run(config, layout, government=dry_decision)
            self.assertEqual(config, before)
            self.assertTrue(all(b["status"] == "complete" for b in result["buildings"]))
            self.assertEqual(sum(r["construction_spending"] for r in result["monthly"]), 150000000)
            self.assertTrue(all(r["closing_project_budget"] >= 0 for r in result["monthly"]))

    def test_invalid_selection_and_budget_fail_before_commit(self):
        for selection in (["UNKNOWN"], ["R01", "R01"], ["B01"]):
            config = hk_minimal.demo_config()
            config["parameters"]["initial_budget"] = 0
            commits = []
            with self.assertRaises(ValueError):
                hk_minimal.run(config, "mixed", government=lambda ctx: {
                    "startProjects": selection, "reason": "Test."}, on_month=commits.append)
            self.assertEqual(commits, [])

    def test_actual_provider_transport_only_government_schema(self):
        requests = []
        def transport(req, timeout):
            requests.append(req)
            return {"choices": [{"finish_reason": "stop", "message": {
                "role": "assistant", "content": '{"startProjects":["B01"],"reason":"Jobs first."}'}}]}
        provider = ai.DeepSeekProvider(api_key="test-placeholder", transport=transport)
        result = provider.call("government", {"step": 1, "eligibleProjects": [{"id": "B01"}]})
        self.assertEqual(result["startProjects"], ["B01"])
        self.assertEqual(len(requests), 1)
        self.assertEqual(provider.metrics[0]["role"], "government")
        self.assertNotIn("government", ai.RESIDENT_ROLES)

    def test_failure_has_no_fallback(self):
        class Broken:
            def call(self, *args):
                raise RuntimeError("offline")
            def metrics_summary(self):
                return {}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "failed"
            with self.assertRaises(RuntimeError):
                run_layout(hk_minimal.demo_config(), "mixed", path, Broken())
            self.assertFalse((path / "result.json").exists())


if __name__ == "__main__":
    unittest.main()

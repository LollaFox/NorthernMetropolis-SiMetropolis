import tempfile
import unittest

from backend.layout_scenarios import layout_scenario
from backend.service import NarrativeService, ServiceError
from backend.tests.test_service import SETUP, finish


class LayoutTests(unittest.TestCase):
    def test_web_selection_runs_and_is_persisted(self):
        with tempfile.TemporaryDirectory() as directory:
            service = NarrativeService(directory)
            original = service.config.copy()
            try:
                for name in ("segregated", "mixed"):
                    setup = {**SETUP, "constructionScenario": name,
                             "start": "2025-01-01", "end": "2026-05-01", "step": "month"}
                    review = service.initialize(setup, b"%PDF-test", "test.pdf", name)
                    self.assertEqual(review, service.initialize(setup, b"%PDF-test", "test.pdf", name))
                    with self.assertRaises(ServiceError):
                        service.initialize({**setup, "constructionScenario": "configured"}, b"%PDF-test", "test.pdf", name)
                    record = service.catalog["initializations"][review["initializationId"]]
                    self.assertEqual(record["scenario"], layout_scenario(name))
                    self.assertIn(layout_scenario(name)["name"], review["items"][0]["value"])
                    service.confirm(review["initializationId"], {"reviewVersion": review["reviewVersion"]}, name + "_confirm")
                    run = finish(service, service.simulate({k: review[k] for k in ("initializationId", "reviewVersion")}, name + "_run"))
                    exported = service.export(run["simulationId"])
                    self.assertEqual(len(exported["monthlyStates"]), 17)
                    snapshot = service.get_snapshot(run["simulationId"], run["snapshots"][-1]["id"])
                    self.assertEqual(len(snapshot["zones"]), 6)
                    self.assertEqual(exported["setup"]["constructionScenario"], name)
                self.assertEqual(service.config, original)
                for value in ("unknown", [], None):
                    with self.assertRaises(ServiceError):
                        service.initialize({**SETUP, "constructionScenario": value}, b"%PDF-test", "a.pdf", "invalid")
            finally:
                service.close()

    def test_only_layout_differs(self):
        a, b = [layout_scenario(n) for n in ("segregated", "mixed")]
        signature = lambda c: sorted((x["id"], x["type"], x["startMonth"], x["completionMonth"]) for x in c["buildings"])
        self.assertEqual(signature(a), signature(b))
        for config, expected in ((a, [{"business"}, {"residential", "park"}]),
                                 (b, [{"business", "residential", "park"}] * 2)):
            zones = [{x["type"] for x in config["buildings"] if (x["x"] < 8) == left} for left in (True, False)]
            self.assertEqual(zones, expected)

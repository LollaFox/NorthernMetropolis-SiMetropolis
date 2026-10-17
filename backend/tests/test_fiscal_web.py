import copy
import tempfile
import unittest
from unittest.mock import Mock

from backend import engine
from backend.service import NarrativeService, ServiceError
from backend.server import SavedCity
from backend.tests.test_service import SETUP, finish


class FiscalWebTests(unittest.TestCase):
    def test_run_snapshot_export_restart_and_idempotency(self):
        with tempfile.TemporaryDirectory() as directory:
            provider=Mock(side_effect=AssertionError('Fiscal mode must not create live provider'))
            service=NarrativeService(directory,provider_factory=provider)
            try:
                for layout in ('segregated','mixed'):
                    setup={**SETUP,'start':'2026-04-01','end':'2027-08-01','step':'month',
                           'constructionScenario':layout,'fiscalEnabled':True}
                    review=service.initialize(setup,b'%PDF-test','a.pdf',layout)
                    self.assertEqual(review['items'][0]['id'],'fiscal_model')
                    service.confirm(review['initializationId'],{'reviewVersion':review['reviewVersion']},layout+'confirm')
                    body={key:review[key] for key in ('initializationId','reviewVersion')}
                    run=finish(service,service.simulate(body,layout+'run'))
                    self.assertEqual(service.simulate(body,layout+'run')['result'],run)
                    exported=service.export(run['simulationId'])
                    self.assertEqual(len(exported['monthlyStates']),17)
                    world=exported['monthlyStates'][-1]
                    engine.assert_invariants(world)
                    self.assertEqual(engine.advance_month(world,None,world['month']),world)
                    bad=copy.deepcopy(world);bad['fiscal']['closing_project_budget']+=1
                    with self.assertRaises(ValueError):engine.assert_invariants(bad)
                    frame=service.get_snapshot(run['simulationId'],run['snapshots'][-1]['id'])
                    self.assertEqual(frame['fiscal'],world['fiscal'])
                    self.assertEqual(sum(z['population'] for z in frame['zones']),frame['fiscal']['population'])
                    self.assertEqual(sum(j['count'] for z in frame['zones'] for j in z['jobs']),frame['fiscal']['local_jobs_filled'])
                    self.assertEqual(len(frame['zones']),7) # six projects plus initial residents
                    totals=exported['monthlyBuildingTotals'][-1]['buildings']
                    self.assertEqual(sum(b['actualResidents'] for b in totals),world['fiscal']['population'])
                    restored=NarrativeService(directory)
                    try:self.assertEqual(restored.export(run['simulationId']),exported)
                    finally:restored.close()
                SavedCity(service).state() # legacy overview must still render
                provider.assert_not_called()
            finally:service.close()

    def test_overrides_and_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            service=NarrativeService(directory)
            try:
                setup={**SETUP,'constructionScenario':'mixed','fiscalEnabled':True,
                       'fiscalParameters':{'initial_budget':0}}
                review=service.initialize(setup,b'%PDF-test','a.pdf','low')
                world=engine.create_world(service.catalog['initializations'][review['initializationId']]['scenario'])
                world=engine.advance_month(world,None,'2026-04-01')
                self.assertEqual(world['fiscal']['construction_spending'],0)
                self.assertTrue(world['events'])
                for extra in ({'constructionScenario':'configured'},{'fiscalParameters':{'wage':-1}},
                              {'fiscalParameters':{'worker_share':2}}, {'fiscalParameters':{'unknown':1}},
                              {'fiscalParameters':{'wage':float('nan')}},{'fiscalEnabled':'yes'},
                              {'fiscalParameters':{'initial_people':1000}}):
                    with self.assertRaises(ServiceError):
                        service.initialize({**setup,**extra},b'%PDF-test','a.pdf','invalid')
            finally:service.close()

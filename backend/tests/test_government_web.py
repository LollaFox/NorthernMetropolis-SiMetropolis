import copy
import tempfile
import unittest
import time
from backend import engine
from backend.government_web import GovernmentTestProvider
from backend.service import NarrativeService, ServiceError
from backend.tests.test_service import SETUP, finish


class GovernmentWebTests(unittest.TestCase):
    def test_saved_decisions_replay_without_api_and_idempotency(self):
        class Provider(GovernmentTestProvider):
            calls = []
            def call(self, role, context):
                self.calls.append((role, context['step']))
                return super().call(role, context)
        def factory():
            return Provider()
        factory.configuration = {'live': True, 'model': 'mock-government'}
        with tempfile.TemporaryDirectory() as folder:
            service = NarrativeService(folder, provider_factory=factory)
            try:
                setup = {**SETUP, 'start':'2025-01-01','end':'2025-03-01','step':'month',
                         'fiscalEnabled':True,'constructionScenario':'mixed','governmentMode':'live'}
                review=service.initialize(setup,b'%PDF-test','test.pdf','initialize')
                service.confirm(review['initializationId'],{'reviewVersion':review['reviewVersion']},'confirm')
                body={key:review[key] for key in ('initializationId','reviewVersion')}
                run=finish(service,service.simulate(body,'run'))
                exported=service.export(run['simulationId'])
                self.assertEqual(Provider.calls,[('government',1),('government',2),('government',3)])
                world=exported['monthlyStates'][-1]
                engine.assert_invariants(world)
                self.assertEqual(len(world['governmentDecisions']),3)
                self.assertEqual(service.simulate(body,'run')['result'],run)
                service.get_snapshot(run['simulationId'],run['snapshots'][-1]['id'])
                saved=NarrativeService(folder)
                try:self.assertEqual(saved.export(run['simulationId']),exported)
                finally:saved.close()
                self.assertEqual(len(Provider.calls),3)
                broken=copy.deepcopy(world);broken['governmentDecisions'][0]['context']['budget']=0
                with self.assertRaises(ValueError):engine.assert_invariants(broken)
            finally:service.close()

    def test_live_requires_configuration(self):
        with tempfile.TemporaryDirectory() as folder:
            service=NarrativeService(folder)
            try:
                with self.assertRaises(ServiceError):
                    service.initialize({**SETUP,'fiscalEnabled':True,'constructionScenario':'mixed',
                                        'governmentMode':'live'},b'%PDF-test','test.pdf','init')
            finally:service.close()

    def test_failed_month_resumes_without_repeating_saved_government_call(self):
        calls=[]
        class Provider(GovernmentTestProvider):
            def call(self,role,context):
                month=context['step'];calls.append(month)
                if month==2 and calls.count(2)==1:raise RuntimeError('Simulated outage')
                return super().call(role,context)
        def factory():return Provider()
        factory.configuration={'live':True,'model':'mock'}
        with tempfile.TemporaryDirectory() as folder:
            service=NarrativeService(folder,provider_factory=factory)
            try:
                setup={**SETUP,'start':'2025-01-01','end':'2025-03-01','step':'month',
                       'fiscalEnabled':True,'constructionScenario':'segregated','governmentMode':'live'}
                review=service.initialize(setup,b'%PDF-test','a.pdf','init')
                service.confirm(review['initializationId'],{'reviewVersion':review['reviewVersion']},'confirm')
                body={k:review[k] for k in ('initializationId','reviewVersion')}
                job=service.simulate(body,'run')
                with self.assertRaises(AssertionError):finish(service,job)
                service.threads[job['jobId']].join(timeout=2)
                self.assertEqual(service.job(job['jobId'])['completedMonths'],1)
                run=finish(service,service.simulate(body,'run'))
                self.assertEqual(calls,[1,2,2,3])
                self.assertEqual(len(service.export(run['simulationId'])['monthlyStates']),3)
            finally:service.close()


if __name__=='__main__':unittest.main()

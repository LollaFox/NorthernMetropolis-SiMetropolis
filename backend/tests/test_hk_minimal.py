import copy
import unittest
from backend.hk_minimal import demo_config, template, run, salary_tax, profits_tax, mpf


class MinimalTests(unittest.TestCase):
    def test_tax_boundaries(self):
        self.assertEqual(mpf(7000),0)
        self.assertEqual(mpf(7100),355)
        self.assertEqual(mpf(40000),1500)
        self.assertEqual(salary_tax(10000),0)
        # 204000 gross - 10200 MPF - 145000 allowance = 48800 at 2%.
        self.assertAlmostEqual(salary_tax(17000)*12,976)
        self.assertEqual(profits_tax(-100),0)
        self.assertAlmostEqual(profits_tax(200000)*12,231000)

    def test_layouts_complete_and_budget_reconciles(self):
        config=demo_config(); before=copy.deepcopy(config)
        for name in ('segregated','mixed'):
            result=run(config,name)
            self.assertEqual(result,run(config,name))
            self.assertEqual(len(result['monthly']),17)
            self.assertEqual({b['status'] for b in result['buildings']},{'complete'})
            opening=config['parameters']['initial_budget']
            for m in result['monthly']:
                self.assertLessEqual(m['employed'],m['labour_force'])
                self.assertLessEqual(m['local_jobs_filled'],m['offered_jobs'])
                self.assertAlmostEqual(m['closing_project_budget'],opening-m['construction_spending']+m['project_tax_allocation']-m['subsidy_paid'])
                opening=m['closing_project_budget']
        self.assertEqual(config,before)

    def test_budget_failure_and_missing_values(self):
        with self.assertRaises(ValueError): run(template(),'mixed')
        config=demo_config();config['parameters']['initial_budget']=0
        result=run(config,'mixed')
        self.assertTrue(result['events'])
        self.assertTrue(all(b['status']=='planned' for b in result['buildings']))
        self.assertTrue(all(m['closing_project_budget']==0 for m in result['monthly']))
        self.assertGreater(result['monthly'][-1]['subsidy_unfunded'],0)

    def test_policy_effective_month(self):
        config=demo_config();config['tax_start_month']=9
        result=run(config,'mixed')
        self.assertTrue(all(m['salaries_tax_accrual']==0 for m in result['monthly'][:8]))
        self.assertGreater(result['monthly'][8]['salaries_tax_accrual'],0)

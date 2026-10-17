"""Standalone fiscal/resident experiment. Not the web engine or a tax return.

Run: python -B -m backend.hk_minimal --demo --output outputs/hk-minimal
All monetary amounts are HKD; tax is annualised monthly accrual, not collection.
"""
import argparse
import copy
import csv
import json
import math
from pathlib import Path

from .layout_scenarios import layout_scenario

SOURCES = {
    "census2021": "https://www.census2021.gov.hk/doc/pub/21c-dcd-factsheets.pdf",
    "vision": "https://www.nm.gov.hk/en/about-nm/vision",
    "salary_tax": "https://www.gov.hk/en/residents/taxes/taxfiling/taxrates/salariesrates.htm",
    "allowance2026": "https://www.ird.gov.hk/eng/faq/budget2026_27.htm",
    "profits_tax": "https://www.ird.gov.hk/eng/faq/2tr.htm",
    "mpf": "https://www.mpfa.org.hk/en/mpf-system/mandatory-contributions/employees",
}


def template():
    # Null means not established, never a factual zero.
    return {
        "schema": "hk-nm-minimal-1", "months": 17,
        "tax_regime": "2026/27 structural rates frozen for all relative months",
        "tax_start_month": 1, "basic_allowance": 145000,
        "observations": {
            "north_2021": {"population": 309631, "under15_share": .108,
                           "participation_15plus": .578, "median_wage": 17000},
            "yuen_long_2021": {"population": 668080, "under15_share": .116,
                               "participation_15plus": .608, "median_wage": 18500},
            "nm_long_term_targets": {"population": 2500000, "jobs": 650000},
        },
        "sources": SOURCES, "checked_on": "2026-10-17",
        "parameters": {key: None for key in (
            "initial_people", "initial_capacity", "worker_share", "wage",
            "rent_per_person", "living_cost_per_person", "initial_budget",
            "housing_capacity", "jobs_per_business", "profit_per_worker",
            "arrival_limit", "exit_limit", "park_preference", "commute_cost_per_cell",
            "residential_cost", "business_cost", "park_cost", "subsidy_per_person",
            "subsidy_start_month", "project_tax_retention")},
        "parameter_evidence": {},
        "limits": [
            "North and Yuen Long administrative districts are not the NM boundary; 2021 is not current data.",
            "Single employed adults, basic allowance and employee MPF only; no family allowances, rent deductions or tax rebates.",
            "Annualised monthly accrual; no actual assessment/payment dates or annual true-up.",
            "Each commercial building is assumed an independent qualifying corporation for two-tier profits tax.",
            "Project budget is a hypothetical appropriation account, not an autonomous NM taxing government.",
            "Profit per worker is net of wages, employer MPF and all operating costs, before profits tax.",
            "Outside economy supplies initial residents' jobs; all eligible workers earn the same configured wage.",
            "No regional forecasting, real parcel geometry or calibrated migration behaviour.",
        ],
    }


def demo_config():
    config = template()
    config["parameters"] = dict(
        initial_people=40, initial_capacity=40, worker_share=.892 * .578, wage=17000,
        rent_per_person=3000, living_cost_per_person=2500, initial_budget=200_000_000,
        housing_capacity=100, jobs_per_business=80, profit_per_worker=3000,
        arrival_limit=10, exit_limit=5, park_preference=100, commute_cost_per_cell=50,
        residential_cost=30_000_000, business_cost=40_000_000, park_cost=5_000_000,
        subsidy_per_person=200, subsidy_start_month=9, project_tax_retention=0,
    )
    config["parameter_evidence"] = {
        key: {"status": "assumption", "note": "Synthetic experiment input; not an official NM standard."}
        for key in config["parameters"]}
    config["parameter_evidence"]["wage"] = {
        "status": "historical_proxy", "source": SOURCES["census2021"], "page": 15,
        "note": "North District 2021 median main employment income; used uniformly without inflation adjustment."}
    config["parameter_evidence"]["worker_share"] = {
        "status": "derived_proxy", "source": SOURCES["census2021"], "page": 15,
        "note": "(1 - under15 share) * participation rate; approximate labour-force share, not employment rate."}
    return config


def mpf(wage):
    return 0 if wage < 7100 else min(wage * .05, 1500)


def salary_tax(wage, allowance=145000):
    net = max(0, 12 * (wage - mpf(wage)))
    remaining = max(0, net - allowance)
    progressive = 0
    for rate in (.02, .06, .10, .14):
        part = min(50000, remaining)
        progressive += part * rate
        remaining -= part
    progressive += remaining * .17
    standard = min(net, 5_000_000) * .15 + max(0, net - 5_000_000) * .16
    return min(progressive, standard) / 12


def profits_tax(monthly_profit):
    annual = max(0, monthly_profit) * 12
    return (min(annual, 2_000_000) * .0825 + max(0, annual - 2_000_000) * .165) / 12


def validate(config):
    p = config["parameters"]
    if set(p) != set(template()["parameters"]):
        raise ValueError("Parameter keys must match the template")
    for key, value in p.items():
        if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
            raise ValueError("Missing/invalid parameter: " + key)
        if not config.get("parameter_evidence", {}).get(key):
            raise ValueError("Missing provenance: " + key)
    for key in ("worker_share", "project_tax_retention"):
        if p[key] > 1:
            raise ValueError(key + " must be 0..1")
    for key in ("initial_people", "initial_capacity", "housing_capacity", "jobs_per_business", "arrival_limit", "exit_limit", "subsidy_start_month"):
        if int(p[key]) != p[key]:
            raise ValueError(key + " must be integer")
    if p["initial_people"] > p["initial_capacity"]:
        raise ValueError("Initial population exceeds initial housing")
    if type(config["months"]) is not int or not 1 <= config["months"] <= 120:
        raise ValueError("months must be 1..120")
    if config["basic_allowance"] != 145000 or config["tax_regime"] != template()["tax_regime"]:
        raise ValueError("This version supports only its documented frozen 2026/27 tax regime")
    if type(config["tax_start_month"]) is not int or config["tax_start_month"] < 1:
        raise ValueError("Invalid tax start")


def run(config, layout, government=None, on_month=None, government_horizon=None):
    validate(config)
    p = config["parameters"]
    buildings = copy.deepcopy(layout_scenario(layout)["buildings"])
    for b in buildings:
        b.update(status="planned", residents=0)
    # Common existing population has external jobs; new housing competes for local jobs.
    base_people = p["initial_people"]
    budget, rows, events = p["initial_budget"], [], []
    previous_subsidy_per_person = 0
    distance = lambda a, b: abs(a["x"]-b["x"]) + abs(a["y"]-b["y"])
    for month in range(1, config["months"] + 1):
        opening, construction = budget, 0
        selected = None
        if government is not None:
            # Completion at the opening frees a slot; normal settlement below
            # still owns the status transition and all fiscal/population values.
            pending = sum(b["status"] == "building" and b["actualCompletion"] > month
                          for b in buildings)
            eligible = [{**copy.deepcopy(b), "cost": p[b["type"] + "_cost"],
                         "durationMonths": b["completionMonth"] - b["startMonth"]}
                        for b in buildings if b["status"] == "planned"]
            context = dict(step=month, layout=layout, horizon=government_horizon or config["months"],
                           budget=budget, currency="HKD", freeConstructionSlots=max(0, 3-pending),
                           eligibleProjects=eligible, buildings=copy.deepcopy(buildings),
                           previousMonth=copy.deepcopy(rows[-1]) if rows else None,
                           parameters=copy.deepcopy(p), limitations=config["limits"],
                           target="Complete the six fixed projects; locations encode the chosen layout.")
            from .ai import validate_decision
            decision = validate_decision("government", government(context))
            selected = decision["startProjects"]
            menu = {b["id"]: b for b in eligible}
            if any(ident not in menu for ident in selected):
                raise ValueError("Government selected an unavailable project")
            if len(selected) > context["freeConstructionSlots"]:
                raise ValueError("Government exceeded construction slots")
            if sum(menu[ident]["cost"] for ident in selected) > budget:
                raise ValueError("Government exceeded available budget")
            events.append(dict(month=month, event="government_decision", decision=decision))
        for b in buildings:
            if b["status"] == "planned" and (b["id"] in selected if selected is not None else b["startMonth"] <= month):
                cost = p[b["type"] + "_cost"]
                if budget >= cost:
                    budget -= cost
                    construction += cost
                    b.update(status="building", actualStart=month,
                             actualCompletion=month+b["completionMonth"]-b["startMonth"])
                else:
                    events.append({"month": month, "id": b["id"], "event": "deferred_insufficient_budget"})
            if b["status"] == "building" and month >= b["actualCompletion"]:
                b["status"] = "complete"
        completed = [b for b in buildings if b["status"] == "complete"]
        homes = [b for b in completed if b["type"] == "residential"]
        firms = [b for b in completed if b["type"] == "business"]
        parks = [b for b in completed if b["type"] == "park"]

        def assign():
            available = {b["id"]: p["jobs_per_business"] for b in firms}
            result = {}
            for home in sorted(homes, key=lambda h:h["id"]):
                wanted, assigned, commute = int(home["residents"] * p["worker_share"]), 0, 0
                for firm in sorted(firms, key=lambda f:(distance(home,f),f["id"])):
                    take = min(wanted-assigned, available[firm["id"]])
                    available[firm["id"]] -= take
                    assigned += take
                    commute += take * distance(home,firm) * p["commute_cost_per_cell"]
                result[home["id"]] = (assigned, commute)
            return result, {k:p["jobs_per_business"]-v for k,v in available.items()}

        tax_per_worker = salary_tax(p["wage"]) if month >= config["tax_start_month"] else 0
        net_wage = p["wage"] - mpf(p["wage"]) - tax_per_worker
        arrivals = departures = 0
        # Decisions use pre-move occupancy and only a hypothetical marginal group.
        for home in sorted(homes, key=lambda h:h["id"]):
            original = home["residents"]
            candidate = min(p["arrival_limit"], p["housing_capacity"]-original)
            home["residents"] += candidate
            jobs, _ = assign()
            workers, commute = jobs[home["id"]]
            n = home["residents"]
            residual = workers*net_wage-commute+n*previous_subsidy_per_person-n*(p["rent_per_person"]+p["living_cost_per_person"])
            park_bonus = sum(p["park_preference"]/(1+distance(home,k)) for k in parks)
            home["residents"] = original
            if n and residual/n + park_bonus >= 0:
                home["residents"] += candidate
                arrivals += candidate
            else:
                left = min(original,p["exit_limit"])
                home["residents"] -= left
                departures += left
        jobs, firm_jobs = assign()
        for home in homes:
            home["employed"], home["commuteCost"] = jobs[home["id"]]
        for firm in firms:
            firm["filledJobs"] = firm_jobs[firm["id"]]
        population = base_people + sum(h["residents"] for h in homes)
        employed = int(base_people*p["worker_share"]) + sum(v[0] for v in jobs.values())
        salary = employed * tax_per_worker
        profit = sum(n*p["profit_per_worker"] for n in firm_jobs.values())
        corporate = sum(profits_tax(n*p["profit_per_worker"]) for n in firm_jobs.values()) if month >= config["tax_start_month"] else 0
        allocated = (salary+corporate) * p["project_tax_retention"]
        budget += allocated
        subsidy_due = population*p["subsidy_per_person"] if month >= p["subsidy_start_month"] else 0
        subsidy = min(budget,subsidy_due)
        budget -= subsidy
        previous_subsidy_per_person = subsidy/population if population else 0
        disposable = employed*net_wage + subsidy
        residual = disposable-population*(p["rent_per_person"]+p["living_cost_per_person"])-sum(v[1] for v in jobs.values())
        assert abs(budget-(opening-construction+allocated-subsidy)) < .01
        assert all(0 <= h["residents"] <= p["housing_capacity"] for h in homes)
        rows.append(dict(month=month, population=population, arrivals=arrivals, departures=departures,
            labour_force=int(base_people*p["worker_share"])+sum(int(h["residents"]*p["worker_share"]) for h in homes),
            employed=employed, local_jobs_filled=sum(firm_jobs.values()), offered_jobs=len(firms)*p["jobs_per_business"],
            salaries_tax_accrual=salary, profits_tax_accrual=corporate,
            firms_after_tax_profit=profit-corporate, disposable_income=disposable,
            residual_after_living_costs=residual, project_tax_allocation=allocated,
            construction_spending=construction, subsidy_paid=subsidy,
            subsidy_unfunded=subsidy_due-subsidy, closing_project_budget=budget))
        if on_month is not None:
            on_month({"layout": layout, "config": copy.deepcopy(config),
                      "monthly": copy.deepcopy(rows), "buildings": copy.deepcopy(buildings),
                      "events": copy.deepcopy(events)})
    return {"layout":layout,"config":config,"monthly":rows,"buildings":buildings,"events":events}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config",type=Path)
    parser.add_argument("--demo",action="store_true",help="Explicitly use labelled assumptions and historical proxies")
    parser.add_argument("--write-template",type=Path)
    parser.add_argument("--output",type=Path,default=Path("outputs/hk-minimal"))
    args = parser.parse_args()
    if args.write_template:
        args.write_template.write_text(json.dumps(template(),ensure_ascii=False,indent=2),encoding="utf-8")
        return
    if bool(args.config) == args.demo:
        parser.error("Choose --config or --demo; no silently invented official baseline")
    config = json.loads(args.config.read_text(encoding="utf-8-sig")) if args.config else demo_config()
    results = [run(config,name) for name in ("segregated","mixed")]
    args.output.mkdir(parents=True,exist_ok=True)
    for result in results:
        stem = args.output/result["layout"]
        stem.with_suffix(".json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
        with stem.with_suffix(".csv").open("w",encoding="utf-8-sig",newline="") as f:
            writer=csv.DictWriter(f,fieldnames=result["monthly"][0]);writer.writeheader();writer.writerows(result["monthly"])
        print(result["layout"],"completed; SYNTHETIC EXPERIMENT, NOT AN OFFICIAL NM FORECAST")


if __name__ == "__main__":
    main()

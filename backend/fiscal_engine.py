"""Versioned fiscal model integrated with the existing job/state/snapshot API.

The small deterministic experiment replays its frozen inputs to the requested
month. No AI/provider calls, no duplicated cash accrual on retries or restart.
"""
import copy
from . import hk_minimal

MODEL = "hk-fiscal-v1"


def configured(setup):
    selected = setup.get("constructionScenario", "configured")
    if selected not in ("segregated", "mixed"):
        raise ValueError("Fiscal mode requires one of the two construction layouts.")
    config = hk_minimal.demo_config()
    overrides = setup.get("fiscalParameters", {})
    if not isinstance(overrides, dict) or set(overrides) - set(config["parameters"]):
        raise ValueError("Unknown fiscal parameter")
    for key, value in overrides.items():
        config["parameters"][key] = value
        config["parameter_evidence"][key] = {"status": "user_assumption", "note": "Entered in web setup; not independently verified."}
    hk_minimal.validate(config)
    # Bound user input before storing/computing large values or numeric overflow.
    if any(value > 1e12 for value in config["parameters"].values()):
        raise ValueError("Fiscal parameters exceed the experiment's numeric limit")
    return {"layout": selected, "settings": config}


def project(config, step, day, anchor, decisions=None, provider=None):
    fiscal = config["fiscal"]
    settings = copy.deepcopy(fiscal["settings"])
    settings["months"] = max(1, step)
    journal = copy.deepcopy(decisions or [])
    mode = fiscal.get("governmentMode", "fixed")
    def decide(context):
        index = context["step"] - 1
        if index < len(journal):
            record = journal[index]
            if record["context"] != context:
                raise ValueError("Government decision context does not match frozen state")
            return copy.deepcopy(record["response"])
        if provider is None:
            raise ValueError("Missing saved government decision")
        answer = provider.call("government", context)
        journal.append({"context": copy.deepcopy(context), "response": copy.deepcopy(answer)})
        return answer
    # The horizon is frozen for every month so replayed contexts are identical.
    horizon = settings.get("governmentHorizon", settings["months"])
    result = hk_minimal.run(settings, fiscal["layout"], government=decide if mode != "fixed" else None,
                            government_horizon=horizon) if step else None
    p = settings["parameters"]
    buildings = copy.deepcopy(result["buildings"] if result else config["buildings"])
    if not step:
        for b in buildings:
            b.update(status="planned", residents=0)
    # Existing residents have a separate visible baseline object, not one of
    # the six new projects. Its footprint is explicitly schematic.
    buildings.append({"id":"BASE", "type":"residential", "x":0,"y":0,
        "startMonth":1,"completionMonth":1,"status":"complete",
        "residents":p["initial_people"],"baseline":True})
    row = result["monthly"][-1] if result else None
    groups = [{"towerId":b["id"],"size":int(b.get("residents",0)),
               "conditions":{"satisfaction":None}} for b in buildings if b.get("residents",0)]
    firms = [{"towerId":b["id"],"jobCapacity":int(p["jobs_per_business"]),
              "filledJobs":int(b.get("filledJobs",0))} for b in buildings
             if b["type"]=="business" and b["status"]=="complete"]
    metrics = {"population":int(row["population"] if row else p["initial_people"]),
               "jobCapacity":sum(f["jobCapacity"] for f in firms),
               "filledJobs":sum(f["filledJobs"] for f in firms),"meanSatisfaction":None,
               "residentialTowers":sum(b["type"]=="residential" and b["status"]=="complete" for b in buildings),
               "monthlyGDP":None,"totalGDP":None}
    state = {"model":MODEL,"schemaVersion":1,"month":day,"step":step,"anchorDay":anchor,
        "config":copy.deepcopy(config),"buildings":buildings,"groups":groups,"firms":firms,
        "metrics":metrics,"fiscal":copy.deepcopy(row),"events":result["events"] if result else [],
        "fiscalLimitations":settings["limits"]}
    if mode != "fixed":
        state["governmentDecisions"] = journal
        state["governmentMode"] = mode
    return state


def create(config):
    hk_minimal.validate(config["fiscal"]["settings"])
    return project(config,0,None,None)


def advance(world, day, provider=None):
    from .engine import _date, _next_month
    validate(world)
    parsed = _date(day)
    if day == world["month"]:
        return copy.deepcopy(world)
    if world["month"] and parsed != _next_month(_date(world["month"]),world["anchorDay"]):
        raise ValueError("Fiscal months must be consecutive")
    if world["step"] >= 120:
        raise ValueError("Fiscal experiments support at most 120 months")
    return project(world["config"],world["step"]+1,day,world["anchorDay"] or parsed.day,
                   world.get("governmentDecisions"), provider)


def validate(world):
    from .engine import _date
    if type(world.get("step")) is not int or not 0 <= world["step"] <= 120:
        raise ValueError("Invalid fiscal step")
    if world["step"]:
        _date(world["month"])
        if type(world["anchorDay"]) is not int or not 1 <= world["anchorDay"] <= 31:
            raise ValueError("Invalid fiscal date anchor")
    elif world["month"] is not None or world["anchorDay"] is not None:
        raise ValueError("Invalid initial fiscal date")
    if world["config"]["fiscal"].get("governmentMode", "fixed") != "fixed":
        if len(world.get("governmentDecisions", [])) != world["step"]:
            raise ValueError("Government decision history is incomplete")
    expected = project(world["config"],world["step"],world["month"],world["anchorDay"],
                       world.get("governmentDecisions"))
    if expected != world:
        raise ValueError("Fiscal saved state does not reconcile with its frozen inputs")


def building_totals(world, identifier):
    if isinstance(identifier,dict): identifier=identifier["id"]
    b = next(b for b in world["buildings"] if b["id"]==identifier)
    p=world["config"]["fiscal"]["settings"]["parameters"]
    planned = (p["initial_capacity"] if b.get("baseline") else p["housing_capacity"]) if b["type"]=="residential" else 0
    offered = p["jobs_per_business"] if b["type"]=="business" and b["status"]=="complete" else 0
    return dict(housingCapacity=planned if b["status"]=="complete" else 0,
        plannedHousingCapacity=planned,actualResidents=b.get("residents",0),offeredJobs=offered,
        filledJobs=b.get("filledJobs",0),vacancies=offered-b.get("filledJobs",0))

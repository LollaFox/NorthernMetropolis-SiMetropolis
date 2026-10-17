"""Pure, deterministic monthly city model. All coefficients are synthetic.

This module has no clock, environment, filesystem, network or provider access.
See MODEL.md or model_document() for units, equations and limitations.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import random
import re
from typing import Any


VERSION = "2.0.0"
START_YEAR = 2026
ACTOR_IDS = ("government", "business", "residents", "energy")
BUILDING_KINDS = ("housing", "office", "industry", "park", "solar", "transit", "civic")
MAX_MESSAGES = 80
MAX_EVENTS = 80
MAX_LEDGER = 120
GRID_POWER = 1800.0
PEOPLE_PER_HOME = 2.35
WORKFORCE_SHARE = 0.48
POLICY_BOUNDS = {
    "housing": (0.0, 1.0), "transit": (0.0, 1.0), "green": (0.0, 1.0),
    "business": (0.0, 1.0), "taxRate": (0.05, 0.30),
}
BUILD_SPECS = {
    "housing": {"costM": 20.0, "months": 6, "capacity": 480, "height": 18.0, "unit": "homes"},
    "office": {"costM": 28.0, "months": 8, "capacity": 650, "height": 26.0, "unit": "jobs"},
    "industry": {"costM": 24.0, "months": 7, "capacity": 520, "height": 12.0, "unit": "jobs"},
    "park": {"costM": 6.0, "months": 3, "capacity": 2600, "height": 0.6, "unit": "green area units"},
    "solar": {"costM": 12.0, "months": 4, "capacity": 320, "height": 2.2, "unit": "power units"},
    "transit": {"costM": 30.0, "months": 9, "capacity": 1800, "height": 3.2, "unit": "commuters"},
    "civic": {"costM": 18.0, "months": 6, "capacity": 180, "height": 8.0, "unit": "jobs"},
}
ROLE_ACTIONS = {
    "government": ("wait", "build_housing", "build_park", "build_transit", "subsidize_housing",
                   "support_business", "raise_tax", "lower_tax"),
    "business": ("wait", "build_housing", "build_office", "build_industry"),
    "residents": ("wait", "build_housing", "build_park"),
    "energy": ("wait", "build_solar"),
}
ACTION_ACTOR = {
    "wait": "government", "build_housing": "government", "build_office": "business",
    "build_industry": "business", "build_park": "government", "build_solar": "energy",
    "build_transit": "government", "subsidize_housing": "government",
    "support_business": "government", "raise_tax": "government", "lower_tax": "government",
}
ACTION_COSTS = {**{"build_" + k: v["costM"] for k, v in BUILD_SPECS.items() if k != "civic"},
                "wait": 0.0, "subsidize_housing": 4.0, "support_business": 6.0,
                "raise_tax": 0.0, "lower_tax": 0.0}
BUILD_LIMITS = {"government": 3, "business": 3, "residents": 1, "energy": 2}
ACTOR_GOALS = {
    "government": "Keep public services funded while expanding homes and access to jobs.",
    "business": "Expand occupied workplaces and retain enough cash for operations.",
    "residents": "Improve housing headroom and green space through a savings-funded cooperative.",
    "energy": "Keep electricity adequate by investing in operating solar capacity.",
}
_GRID = tuple((x, z) for x in range(-44, 45, 8) for z in range(-44, 45, 8)
              if not 15 <= x <= 24)


class ValidationError(ValueError):
    """A state or action violates the public simulation contract."""


def _clip(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _number(value: Any, label: str, low: float = 0.0, high: float = 1e9) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValidationError(f"{label} must be a finite number")
    if not low <= value <= high:
        raise ValidationError(f"{label} must be between {low:g} and {high:g}")
    return value


def _integer(value: Any, label: str, low: int = 0, high: int = 2**53 - 1) -> int:
    if type(value) is not int or not low <= value <= high:
        raise ValidationError(f"{label} must be an integer between {low} and {high}")
    return value


def _text(value: Any, label: str, maximum: int = 1200, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or len(value) > maximum or (not allow_empty and not value.strip()):
        raise ValidationError(f"{label} must be {'a' if allow_empty else 'a nonempty'} string of at most {maximum} characters")
    return value


def _actor(world: dict, actor_id: str) -> dict:
    return next(a for a in world["actors"] if a["id"] == actor_id)


def _complete(world: dict, kind: str) -> list:
    return [b for b in world["buildings"] if b["kind"] == kind and b["progress"] == 1.0]


def _capacity(world: dict, kind: str) -> float:
    return sum(b["capacity"] for b in _complete(world, kind))


def _id(world: dict, name: str) -> str:
    world["counters"][name] += 1
    return name[0] + str(world["counters"][name]).zfill(6)


def _message(world: dict, source: str, text: str, action: str, source_type: str) -> None:
    world["messages"].append({"id": _id(world, "message"), "month": world["month"],
                              "source": source, "text": text[:1200], "action": action,
                              "sourceType": source_type})
    world["messages"] = world["messages"][-MAX_MESSAGES:]


def _event(world: dict, kind: str, title: str, detail: str, x: float = 0, z: float = 0) -> None:
    world["events"].append({"id": _id(world, "event"), "month": world["month"],
                            "type": kind, "title": title, "detail": detail[:1200], "x": x, "z": z})
    world["events"] = world["events"][-MAX_EVENTS:]


def _ledger(world: dict, actor: str, action: str, cost: float, detail: str,
            revenue: float = 0.0) -> None:
    world["ledger"].append({"id": _id(world, "ledger"), "month": world["month"],
                            "actor": actor, "action": action, "costM": round(cost, 6),
                            "revenueM": round(revenue, 6), "detail": detail})
    world["ledger"] = world["ledger"][-MAX_LEDGER:]


def _sync_cash(world: dict) -> None:
    world["metrics"]["treasuryM"] = _actor(world, "government")["cashM"]
    world["metrics"]["businessCashM"] = _actor(world, "business")["cashM"]


def _noise(seed: int, month: int) -> float:
    value = int.from_bytes(hashlib.sha256(f"{seed}:{month}:migration".encode()).digest()[:4], "big")
    return (value / (2**32 - 1) - 0.5) * 0.0008


def create_world(seed: int = 42) -> dict:
    """Create an independently owned, populated 42-building city at month zero."""
    _integer(seed, "seed", -(2**31), 2**31 - 1)
    world = {
        "version": VERSION, "seed": seed, "month": 0, "year": START_YEAR,
        "buildings": [], "metrics": {},
        "policies": {"housing": 0.45, "transit": 0.35, "green": 0.35, "business": 0.45, "taxRate": 0.12},
        "actors": [
            {"id": "government", "name": "District Council", "role": "government", "cashM": 165.0,
             "mood": 70.0, "stance": "balance housing, services and reserves"},
            {"id": "business", "name": "Enterprise Network", "role": "business", "cashM": 112.0,
             "mood": 68.0, "stance": "expand when labour and electricity permit"},
            {"id": "residents", "name": "Resident Cooperative", "role": "residents", "cashM": 22.0,
             "mood": 70.0, "stance": "affordable homes and nearby green space"},
            {"id": "energy", "name": "Clean Power Utility", "role": "energy", "cashM": 45.0,
             "mood": 72.0, "stance": "maintain a power reserve"},
        ],
        "messages": [], "events": [], "objectives": [], "ledger": [],
        "operations": {actor: 1.0 for actor in ACTOR_IDS},
        "counters": {key: 0 for key in ("building", "message", "event", "ledger")},
    }
    rng = random.Random(seed)
    locations = list(_GRID)
    rng.shuffle(locations)
    kinds = ["housing"] * 16 + ["office"] * 8 + ["industry"] * 4 + ["park"] * 6 + ["solar"] * 4 + ["transit"] * 3 + ["civic"]
    for kind, (x, z) in zip(kinds, locations):
        owner = {"office": "business", "industry": "business", "solar": "energy"}.get(kind, "government")
        spec = BUILD_SPECS[kind]
        world["buildings"].append({"id": _id(world, "building"), "kind": kind, "x": x, "z": z,
                                   "height": spec["height"], "progress": 1.0, "capacity": spec["capacity"],
                                   "owner": owner, "createdMonth": 0, "startedMonth": 0,
                                   "constructionMonths": spec["months"], "constructionCostM": 0.0,
                                   "baseCapacity": spec["capacity"], "upgrades": 0})
    world["metrics"] = {"population": 14600, "jobs": 0, "homes": 0, "happiness": 72.0,
                        "airQuality": 78.0, "emissions": 0.0, "treasuryM": 165.0,
                        "businessCashM": 112.0, "powerDemand": 0.0, "powerCapacity": 0.0}
    _refresh_metrics(world, construction_emissions=0.0, move_population=False)
    _message(world, "engine", "Synthetic city initialized. Buildings, resources and policies evolve monthly; this is not a calibrated forecast.", "initialize", "rules")
    _update_objectives(world)
    return validate_world(world)


def _build_spec(action: str, actor_id: str) -> dict:
    spec = dict(BUILD_SPECS[action.removeprefix("build_")])
    if actor_id == "residents" and action == "build_housing":
        spec.update(costM=12.0, capacity=280, height=14.0)
    return spec


def _cost(action: str, actor_id: str) -> float:
    return _build_spec(action, actor_id)["costM"] if action.startswith("build_") else ACTION_COSTS[action]


def _build_target(world: dict, kind: str, actor_id: str) -> tuple:
    occupied = {(b["x"], b["z"]) for b in world["buildings"]}
    free = [loc for loc in _GRID if loc not in occupied]
    if free:
        # Seed-derived tie break; no dependence on Python's randomized hash().
        loc = min(free, key=lambda p: (p[0] * p[0] + p[1] * p[1],
                                      hashlib.sha256(f"{world['seed']}:{world['month']}:{kind}:{p}".encode()).digest()))
        return loc, None
    candidates = [b for b in _complete(world, kind) if b["owner"] == actor_id
                  and b["capacity"] < b["baseCapacity"] * 4]
    if not candidates:
        return None, None
    building = min(candidates, key=lambda b: (b["upgrades"], b["startedMonth"], b["id"]))
    return (building["x"], building["z"]), building


def _action_error(world: dict, actor_id: str, action: str) -> str | None:
    if actor_id not in ACTOR_IDS:
        return "Unknown actor"
    if action not in ROLE_ACTIONS[actor_id]:
        return f"{actor_id} is not allowed to perform {action}"
    if action == "wait":
        return None
    if _actor(world, actor_id)["cashM"] + 1e-8 < _cost(action, actor_id):
        return f"{actor_id} cannot afford {action}"
    if action.startswith("build_"):
        if sum(b["owner"] == actor_id and b["progress"] < 1 for b in world["buildings"]) >= BUILD_LIMITS[actor_id]:
            return f"{actor_id} has reached its concurrent construction limit"
        if _build_target(world, action[6:], actor_id)[0] is None:
            return f"No free site or completed {actor_id} {action[6:]} below the redevelopment density cap"
    if action == "raise_tax" and world["policies"]["taxRate"] >= POLICY_BOUNDS["taxRate"][1]:
        return "Tax rate is already at its upper bound"
    if action == "lower_tax" and world["policies"]["taxRate"] <= POLICY_BOUNDS["taxRate"][0]:
        return "Tax rate is already at its lower bound"
    if action in ("subsidize_housing", "support_business"):
        target = "housing" if action == "subsidize_housing" else "business"
        if world["policies"][target] >= 1.0:
            return f"{target} support is already at its upper bound"
    return None


def _apply_action(world: dict, actor_id: str, action: str, source_type: str,
                  message: str = "", reason: str = "") -> None:
    error = _action_error(world, actor_id, action)
    if error:
        raise ValidationError(error)
    actor = _actor(world, actor_id)
    cost = _cost(action, actor_id)
    actor["cashM"] = round(max(0.0, actor["cashM"] - cost), 6)
    detail = "Held resources for a later decision."
    if action.startswith("build_"):
        kind = action[6:]
        spec = _build_spec(action, actor_id)
        loc, building = _build_target(world, kind, actor_id)
        if building is None:
            building = {"id": _id(world, "building"), "kind": kind, "x": loc[0], "z": loc[1],
                        "height": spec["height"], "progress": 0.0, "capacity": spec["capacity"],
                        "owner": actor_id, "createdMonth": world["month"], "baseCapacity": spec["capacity"], "upgrades": 0}
            world["buildings"].append(building)
            title = f"New {kind} commissioned"
        else:
            building["upgrades"] += 1
            building["capacity"] = min(building["baseCapacity"] * 4,
                                        building["capacity"] + building["baseCapacity"])
            if kind in ("housing", "office", "industry"):
                building["height"] = min(80.0, building["height"] + spec["height"] * 0.45)
            building["progress"] = 0.0
            title = f"Existing {kind} redevelopment commissioned"
        building.update(startedMonth=world["month"], constructionMonths=spec["months"], constructionCostM=cost)
        detail = f"{cost:g}M committed; {building['capacity']:g} {spec['unit']} available after {spec['months']} months. Redevelopment removes the old capacity during works."
        _event(world, "construction", title, detail, *loc)
        policy = {"housing": "housing", "office": "business", "industry": "business", "park": "green",
                  "solar": "green", "transit": "transit"}[kind]
        world["policies"][policy] = round(min(1.0, world["policies"][policy] + 0.08), 6)
    elif action in ("subsidize_housing", "support_business"):
        recipient, policy = ("residents", "housing") if action == "subsidize_housing" else ("business", "business")
        _actor(world, recipient)["cashM"] = round(_actor(world, recipient)["cashM"] + cost, 6)
        world["policies"][policy] = round(min(1.0, world["policies"][policy] + 0.15), 6)
        detail = f"{cost:g}M transferred to {recipient}; {policy} support increased by 0.15, capped at 1."
        _event(world, "policy", "Housing support" if policy == "housing" else "Business support", detail)
    elif action in ("raise_tax", "lower_tax"):
        direction = 0.015 if action == "raise_tax" else -0.015
        world["policies"]["taxRate"] = round(_clip(world["policies"]["taxRate"] + direction, 0.05, 0.30), 6)
        detail = f"Payroll tax rate is now {world['policies']['taxRate']:.1%}."
        _event(world, "policy", "Tax rate adjusted", detail)
    _sync_cash(world)
    if action != "wait":
        _ledger(world, actor_id, action, cost, detail)
    # The attributed model/user statement is retained alongside the actual engine result.
    statement = (message.strip() + " " if message.strip() else "") + ("Reason: " + reason.strip() + ". " if reason.strip() else "")
    _message(world, actor_id, statement + "Executed " + action + ": " + detail, action, source_type)


def _rules_decisions(world: dict) -> list:
    m, p, month = world["metrics"], world["policies"], world["month"]
    choices = []
    if month % 4 == 0:
        if m["treasuryM"] < 25 and p["taxRate"] < 0.20:
            action, reason = "raise_tax", "Public reserves are low"
        elif m["housingPressure"] > 0.86:
            action, reason = "build_housing", "Housing occupancy is approaching capacity"
        elif m["transitCoverage"] < 0.75:
            action, reason = "build_transit", "Commuting demand exceeds transit capacity"
        elif m["greenSpace"] / max(1, m["population"]) < 1.3:
            action, reason = "build_park", "Green space per resident is limited"
        elif p["housing"] < 0.75:
            action, reason = "subsidize_housing", "Use reserves to strengthen cooperative housing demand"
        else:
            action, reason = "wait", "Maintain a public operating reserve"
        choices.append(("government", action, reason))
    if month % 3 == 1:
        if m["housingPressure"] > 0.93:
            action, reason = "build_housing", "Housing limits the local labour pool"
        elif (m["employmentRate"] > 0.92 and m["jobs"] < m["population"] * WORKFORCE_SHARE * 1.15
              and m["powerDemand"] < m["powerCapacity"] * 0.94):
            action = "build_office" if p["green"] >= 0.5 or p["business"] < 0.65 else "build_industry"
            reason = "Labour demand and power headroom support expansion"
        else:
            action, reason = "wait", "Wait for labour demand or electricity headroom"
        choices.append(("business", action, reason))
    if month % 6 == 2:
        if m["housingPressure"] > 0.88:
            action, reason = "build_housing", "Cooperative members need additional homes"
        elif m["greenSpace"] / max(1, m["population"]) < 1.1:
            action, reason = "build_park", "Cooperative savings can fund nearby green space"
        else:
            action, reason = "wait", "Retain household savings"
        choices.append(("residents", action, reason))
    if month % 4 == 3:
        if m["powerDemand"] > m["powerCapacity"] * 0.77:
            action, reason = "build_solar", "Demand is approaching the electricity reserve"
        else:
            action, reason = "wait", "Power reserve is sufficient"
        choices.append(("energy", action, reason))
    result = []
    for actor, action, reason in choices:
        if _action_error(world, actor, action):
            action, reason = "wait", "Resources or construction capacity prevent the preferred investment"
        result.append({"actor": actor, "action": action, "reason": reason, "message": "", "sourceType": "rules"})
    return result


def _validated_decisions(decisions: Any) -> list:
    if not isinstance(decisions, list) or len(decisions) > 4:
        raise ValidationError("decisions must be a list of at most four actor decisions")
    seen = set()
    for decision in decisions:
        if not isinstance(decision, dict) or set(decision) - {"actor", "action", "reason", "message", "sourceType"}:
            raise ValidationError("A decision may contain only actor, action, reason, message and sourceType")
        actor, action = decision.get("actor"), decision.get("action")
        if not isinstance(actor, str) or actor not in ACTOR_IDS or actor in seen:
            raise ValidationError("Each decision must identify a known, unique actor")
        if not isinstance(action, str) or action not in ROLE_ACTIONS[actor]:
            raise ValidationError(f"{actor} is not allowed to perform {action}")
        seen.add(actor)
        _text(decision.get("reason", ""), "reason", 600, True)
        _text(decision.get("message", ""), "message", 600, True)
        if decision.get("sourceType", "live") not in ("rules", "live", "user"):
            raise ValidationError("sourceType must be rules, live or user")
    return copy.deepcopy(decisions)


def _finance(world: dict) -> None:
    m, p = world["metrics"], world["policies"]
    employment = min(m["jobs"], m["population"] * WORKFORCE_SHARE)
    office, industry = _capacity(world, "office"), _capacity(world, "industry")
    activity = min(1.0, employment / max(1.0, office + industry + _capacity(world, "civic")))
    wages = employment * 0.0025
    revenues = {
        "government": wages * p["taxRate"] + m["homes"] * 0.00004 + employment * 0.000015,
        "business": (office * 0.0035 + industry * 0.0050) * activity * (0.9 + p["business"] * 0.2),
        "residents": wages * (1.0 - p["taxRate"]) * 0.08,
        "energy": min(m["powerDemand"], _capacity(world, "solar")) * 0.0025,
    }
    expenses = {
        "government": len(_complete(world, "transit")) * 0.30 + len(_complete(world, "park")) * 0.09
                      + len(_complete(world, "civic")) * 0.20 + min(GRID_POWER, m["powerDemand"]) * 0.00025,
        "business": wages * 0.70 + len(_complete(world, "office")) * 0.55 + len(_complete(world, "industry")) * 0.85,
        "residents": m["population"] * 0.000045,
        "energy": len(_complete(world, "solar")) * 0.15,
    }
    for actor_id in ACTOR_IDS:
        actor = _actor(world, actor_id)
        available = actor["cashM"] + revenues[actor_id]
        paid = min(available, expenses[actor_id])
        world["operations"][actor_id] = round(min(1.0, available / max(0.000001, expenses[actor_id])), 6)
        actor["cashM"] = round(available - paid, 6)
        _ledger(world, actor_id, "monthly_operations", paid,
                f"Operating funding {world['operations'][actor_id]:.0%}; revenue and expenses are synthetic cash flows.", revenues[actor_id])
    _sync_cash(world)


def _current_construction_emissions(world: dict) -> float:
    """Recover this month's incurred work, including completion, for old saves.

    New snapshots retain the value independently of the construction portfolio:
    an instant redevelopment can overwrite a completed asset's start metadata.
    """
    if "constructionEmissions" in world["metrics"]:
        return world["metrics"]["constructionEmissions"]
    return sum(b["constructionCostM"] / b["constructionMonths"] * 40
               for b in world["buildings"]
               if 0 < world["month"] - b["startedMonth"] <= b["constructionMonths"])


def _refresh_metrics(world: dict, construction_emissions: float, move_population: bool = True) -> None:
    m, p, ops = world["metrics"], world["policies"], world["operations"]
    homes = int(_capacity(world, "housing"))
    office, industry, civic = (_capacity(world, k) for k in ("office", "industry", "civic"))
    potential_jobs = (office + industry) * ops["business"] + civic * ops["government"]
    solar = _capacity(world, "solar") * ops["energy"]
    demand = m["population"] * 0.09 + office * 0.09 + industry * 0.30 + civic * 0.10
    power_capacity = GRID_POWER + solar
    adequacy = min(1.0, power_capacity / max(1.0, demand))
    jobs = int(potential_jobs * adequacy)
    employment_rate = min(1.0, jobs / max(1, m["population"] * WORKFORCE_SHARE))
    pressure = m["population"] / max(1.0, homes * PEOPLE_PER_HOME)
    if move_population:
        growth = (0.0025 + p["business"] * 0.003 + p["housing"] * 0.002
                  + (m["happiness"] / 100 - 0.5) * 0.002 + (employment_rate - 0.88) * 0.004
                  - max(0.0, pressure - 0.96) * 0.01 - (1.0 - adequacy) * 0.012
                  + _noise(world["seed"], world["month"]))
        m["population"] = int(_clip(round(m["population"] * (1.0 + _clip(growth, -0.008, 0.009))),
                                    0, math.floor(homes * PEOPLE_PER_HOME)))
    # Recompute after migration, so every displayed quantity belongs to this month.
    population = m["population"]
    demand = population * 0.09 + office * 0.09 + industry * 0.30 + civic * 0.10
    adequacy = min(1.0, power_capacity / max(1.0, demand))
    jobs = int(potential_jobs * adequacy)
    employment_rate = min(1.0, jobs / max(1, population * WORKFORCE_SHARE))
    pressure = population / max(1.0, homes * PEOPLE_PER_HOME)
    transit = _capacity(world, "transit") * ops["government"]
    coverage = min(1.0, transit / max(1.0, population * WORKFORCE_SHARE))
    green = _capacity(world, "park") * ops["government"]
    green_ratio = min(1.0, green / max(1.0, population * 1.4))
    grid_use = min(GRID_POWER, max(0.0, demand - solar))
    emissions = (population * 0.014 + office * ops["business"] * adequacy * 0.03
                 + industry * ops["business"] * adequacy * 0.15 + grid_use * 0.21
                 + population * 0.023 * (1.0 - 0.65 * coverage) + construction_emissions)
    happiness_target = _clip(68 + p["housing"] * 8 + coverage * 10 + green_ratio * 9
                             + employment_rate * 10 - max(0, pressure - 0.75) * 35
                             - (1.0 - adequacy) * 25 - industry / max(1, jobs) * 8 - p["taxRate"] * 15, 0, 100)
    air_target = _clip(92 - emissions / max(150.0, population * 0.04 + 100) * 18 + green_ratio * 12, 0, 100)
    if move_population:
        m["happiness"] = round(m["happiness"] * 0.85 + happiness_target * 0.15, 3)
        m["airQuality"] = round(m["airQuality"] * 0.85 + air_target * 0.15, 3)
    m.update(jobs=jobs, homes=homes, emissions=round(emissions, 3), powerDemand=round(demand, 3),
             powerCapacity=round(power_capacity, 3), employmentRate=round(employment_rate, 6),
             housingPressure=round(pressure, 6), transitCapacity=round(transit, 3),
             transitCoverage=round(coverage, 6), greenSpace=round(green, 3),
             constructionEmissions=construction_emissions)
    _sync_cash(world)
    if move_population:
        for actor in world["actors"]:
            target = m["happiness"] if actor["id"] == "residents" else (55 + employment_rate * 25 if actor["id"] == "business"
                     else 55 + adequacy * 25 if actor["id"] == "energy" else 55 + m["happiness"] * 0.25)
            actor["mood"] = round(_clip(actor["mood"] * 0.85 + target * 0.15, 0, 100), 3)


def _update_objectives(world: dict) -> None:
    targets = [("population", "A district for 20,000 residents", 20000), ("jobs", "11,000 operating jobs", 11000),
               ("homes", "10,000 completed homes", 10000), ("happiness", "Resident wellbeing at 80", 80),
               ("airQuality", "Air quality at 80", 80)]
    previous = {o["id"]: o for o in world["objectives"]}
    objectives = []
    for key, label, target in targets:
        current = world["metrics"][key]
        achieved = bool(previous.get(key, {}).get("achieved", False) or current >= target)
        objectives.append({"id": key, "label": label, "current": current, "target": target, "achieved": achieved})
        if achieved and not previous.get(key, {}).get("achieved", False):
            _event(world, "milestone", label, f"Synthetic milestone reached at month {world['month']}.")
    world["objectives"] = objectives


def step_world(world: dict, decisions: list | None = None) -> dict:
    """Advance one month atomically. None uses rules; [] deliberately uses no rules.

    Supplied decisions are applied in their given order at the opening state.
    Costs, permissions, affordability and construction limits are rechecked for
    each action. Malformed or unauthorized decisions raise atomically. Valid
    catalog proposals blocked by current resources are attributed as rejected;
    construction and economic time still advance.
    """
    result = validate_world(world)
    plans = _rules_decisions(result) if decisions is None else _validated_decisions(decisions)
    for decision in plans:
        error = _action_error(result, decision["actor"], decision["action"])
        if error:
            _message(result, decision["actor"], "Rejected " + decision["action"] + ": " + error
                     + ". Proposal: " + decision.get("message", "") + ". Reason: " + decision.get("reason", ""),
                     "rejected:" + decision["action"], decision.get("sourceType", "live"))
            _event(result, "action_rejected", "Proposal rejected; month continues", error)
            continue
        _apply_action(result, decision["actor"], decision["action"], decision.get("sourceType", "live"),
                      decision.get("message", ""), decision.get("reason", ""))
    result["month"] += 1
    result["year"] = START_YEAR + result["month"] // 12
    construction_emissions = 0.0
    for building in result["buildings"]:
        if building["progress"] < 1:
            construction_emissions += building["constructionCostM"] / building["constructionMonths"] * 40
            building["progress"] = min(1.0, round((result["month"] - building["startedMonth"]) / building["constructionMonths"], 12))
            if building["progress"] == 1:
                _event(result, "completion", f"{building['kind'].capitalize()} now operational",
                       f"{building['capacity']:g} {BUILD_SPECS[building['kind']]['unit']} added after physical construction.",
                       building["x"], building["z"])
    _finance(result)
    _refresh_metrics(result, construction_emissions)
    _update_objectives(result)
    return validate_world(result)


_PHRASES = {
    "build_housing": (r"\b(?:build|add|increase|prioriti[sz]e|expand) (?:(?:more|new|public|affordable) )?(?:housing|homes)\b",
                      r"\b(?:more homes|housing first)\b", "興建住宅", "增加住房", "優先住房"),
    "subsidize_housing": (r"\b(?:subsid(?:i[sz]e|ies) housing|housing subsid(?:y|ies)|affordable housing|rent relief)\b", "房屋補貼", "住房補貼"),
    "support_business": (r"\b(?:support business|business growth|economic growth|stimulate the economy|business friendly)\b", "支持企業", "促進經濟"),
    "build_office": (r"\b(?:build|add|expand) (?:more |new )?offices?\b", r"\bmore offices\b", "興建辦公室"),
    "build_industry": (r"\b(?:build industry|expand industry|industrial growth|more factories|build factories)\b", "發展工業"),
    "build_park": (r"\b(?:build (?:a |more )?parks?|more parks|greener city|(?:expand|add|increase) green space)\b", "增加公園", "興建公園"),
    "build_solar": (r"\b(?:build solar|solar power|renewable energy|clean energy|decarboni[sz]e)\b", "太陽能", "可再生能源"),
    "build_transit": (r"\b(?:build (?:public )?transit|public transport|expand (?:public )?transit|better transit|transit first|rail expansion)\b", "公共交通", "擴展鐵路"),
    "raise_tax": (r"\b(?:raise|increase) (?:the |payroll )?tax(?:es)?\b", "加稅"),
    "lower_tax": (r"\b(?:lower|cut|reduce) (?:the |payroll )?tax(?:es)?\b", "減稅"),
    "wait": (r"^(?:wait|hold|hold spending|pause investment)[.!]?$",),
}


def _parse_action(text: str) -> tuple:
    lower = text.strip().lower()
    if lower in ACTION_ACTOR:
        return lower, ""
    if re.search(r"\b(?:do not|don't|never|avoid|stop|cancel|no)\b|不要|停止|取消", lower):
        return None, "Negated or cancellation proposals are unsupported; no action was executed."
    matches = [action for action, patterns in _PHRASES.items() if any(re.search(pattern, lower) for pattern in patterns)]
    # An explicit construction verb takes precedence over the adjective affordable.
    if "build_housing" in matches and "subsidize_housing" in matches and re.search(r"\b(?:build|add|expand) affordable (?:housing|homes)\b", lower):
        matches.remove("subsidize_housing")
    if len(matches) == 1:
        return matches[0], ""
    if len(matches) > 1:
        return None, "Multiple catalog actions were requested; submit one direction at a time. No action was executed."
    return None, "This proposal is outside the action catalog. No action was executed."


def intervene(world: dict, text: str, kind: str | None = None) -> dict:
    """Apply one catalog-sized user action, or explicitly retain unsupported text."""
    result = validate_world(world)
    _text(text, "text", 1200, allow_empty=kind is not None)
    if kind is not None:
        if not isinstance(kind, str) or kind not in ACTION_ACTOR:
            raise ValidationError("kind must be an exact catalog action ID")
        action, explanation = kind, ""
    else:
        action, explanation = _parse_action(text)
    if action is None:
        _message(result, "user", "Proposal: " + text.strip() + ". " + explanation, "unrecognized", "user")
        _event(result, "proposal_unrecognized", "Proposal recorded; no action executed", explanation)
    else:
        # Preserve incurred current-month work before any asset metadata changes.
        # Newly commissioned projects begin contributing only on the next tick.
        construction_emissions = _current_construction_emissions(result)
        _message(result, "user", "Proposal: " + (text.strip() or action) + ". Fixed engine quantities and costs apply.", action, "user")
        _apply_action(result, ACTION_ACTOR[action], action, "user")
        # Redevelopment can remove existing operating capacity immediately.
        _refresh_metrics(result, construction_emissions, move_population=False)
        result["metrics"]["population"] = min(result["metrics"]["population"], int(result["metrics"]["homes"] * PEOPLE_PER_HOME))
        _refresh_metrics(result, construction_emissions, move_population=False)
        _update_objectives(result)
    return validate_world(result)


def actor_packet(world: dict, actor_id: str) -> dict:
    """Return a bounded current-time packet; rival private actor fields are absent."""
    state = validate_world(world)
    if not isinstance(actor_id, str) or actor_id not in ACTOR_IDS:
        raise ValidationError("Unknown actor")
    public_keys = ("population", "jobs", "homes", "happiness", "airQuality", "emissions", "powerDemand", "powerCapacity",
                   "employmentRate", "housingPressure", "transitCoverage", "greenSpace")
    allowed = [action for action in ROLE_ACTIONS[actor_id] if _action_error(state, actor_id, action) is None]
    catalog = {}
    for action in ROLE_ACTIONS[actor_id]:
        entry = {"costM": _cost(action, actor_id)}
        if action.startswith("build_"):
            spec = _build_spec(action, actor_id)
            entry.update(months=spec["months"], capacity=spec["capacity"], unit=spec["unit"])
            location, target = _build_target(state, action[6:], actor_id)
            entry["mode"] = "new_building" if location and target is None else "redevelopment" if target else "unavailable"
            if target is not None:
                new_capacity = min(target["capacity"] + target["baseCapacity"], target["baseCapacity"] * 4)
                entry.update(targetId=target["id"], oldCapacity=target["capacity"], capacity=new_capacity,
                             addedCapacity=new_capacity - target["capacity"], oldCapacityOfflineDuringWorks=True)
        catalog[action] = entry
    public_messages = [{k: m[k] for k in ("month", "source", "action", "sourceType")} | {"text": m["text"][:240]}
                       for m in state["messages"] if m["source"] not in (actor_id, "user")][-6:]
    proposals = [{"month": m["month"], "action": m["action"], "text": m["text"][:200]}
                 for m in state["messages"] if m["source"] == "user"][-3:]
    own_actor = {key: _actor(state, actor_id)[key] for key in ("id", "name", "role", "cashM", "mood", "stance")}
    own_actor["name"] = own_actor["name"][:80]
    own_actor["stance"] = own_actor["stance"][:160]
    packet = {
        "version": VERSION, "month": state["month"], "year": state["year"],
        "actor": own_actor, "goal": ACTOR_GOALS[actor_id],
        "publicState": {key: state["metrics"][key] for key in public_keys},
        "policies": copy.deepcopy(state["policies"]), "messages": public_messages, "userProposals": proposals,
        "allowedActions": allowed, "actionCatalog": catalog,
        "modelFacts": {"status": "synthetic scenario; not a calibrated forecast", "peoplePerHome": PEOPLE_PER_HOME,
                       "workforceShare": WORKFORCE_SHARE, "importedPowerCapacity": GRID_POWER,
                       "constructionLimit": BUILD_LIMITS[actor_id], "policyScale": "0..1; taxRate 0.05..0.30",
                       "decision": "Choose one allowed action. Engine controls costs, quantities and timing. No future data is available."},
    }
    # Reserve space for the provider's instructions, schema and escaped envelope.
    # Bound escaped Unicode bytes too, rather than counting English characters.
    while len(json.dumps(packet, ensure_ascii=True).encode("utf-8")) > 5200:
        if packet["messages"]:
            packet["messages"].pop(0)
        elif packet["userProposals"]:
            packet["userProposals"].pop(0)
        else:
            raise ValidationError("Actor state cannot fit the bounded packet")
    return packet


def validate_world(world: dict) -> dict:
    """Validate physical/state invariants and return a deep copy, never repair input."""
    if not isinstance(world, dict):
        raise ValidationError("world must be an object")
    required = {"version", "seed", "month", "year", "buildings", "metrics", "policies", "actors", "messages",
                "events", "objectives", "ledger", "operations", "counters"}
    if required - set(world):
        raise ValidationError("World is missing required fields")
    if world["version"] != VERSION:
        raise ValidationError("Unsupported world version")
    _integer(world["seed"], "seed", -(2**31), 2**31 - 1)
    _integer(world["month"], "month")
    if type(world["year"]) is not int or world["year"] != START_YEAR + world["month"] // 12:
        raise ValidationError("year must follow the monthly clock")
    for field in ("metrics", "policies", "operations", "counters"):
        if not isinstance(world[field], dict):
            raise ValidationError(f"{field} must be an object")
    for key, (low, high) in POLICY_BOUNDS.items():
        _number(world["policies"].get(key), f"policies.{key}", low, high)
    if not isinstance(world["actors"], list) or len(world["actors"]) != 4:
        raise ValidationError("Exactly four actors are required")
    actor_ids = []
    for actor in world["actors"]:
        if not isinstance(actor, dict) or actor.get("id") not in ACTOR_IDS or actor.get("role") != actor.get("id"):
            raise ValidationError("Invalid actor identity or role")
        actor_ids.append(actor["id"])
        _number(actor.get("cashM"), "actor.cashM")
        _number(actor.get("mood"), "actor.mood", 0, 100)
        _text(actor.get("name"), "actor.name", 120)
        _text(actor.get("stance"), "actor.stance", 300)
        _number(world["operations"].get(actor["id"]), "operations", 0, 1)
    if set(actor_ids) != set(ACTOR_IDS):
        raise ValidationError("Actor IDs must be unique")
    if not isinstance(world["buildings"], list) or len(world["buildings"]) > len(_GRID):
        raise ValidationError("Buildings must fit the finite city")
    ids, locations = set(), []
    for b in world["buildings"]:
        if not isinstance(b, dict) or b.get("kind") not in BUILDING_KINDS or b.get("owner") not in ACTOR_IDS:
            raise ValidationError("Invalid building kind or owner")
        _text(b.get("id"), "building.id", 80)
        if b["id"] in ids:
            raise ValidationError("Building IDs must be unique")
        ids.add(b["id"])
        x, z = _number(b.get("x"), "building.x", -48, 48), _number(b.get("z"), "building.z", -48, 48)
        if 15 <= x <= 24:
            raise ValidationError("Buildings cannot occupy the river")
        if any(math.hypot(x - px, z - pz) < 6 for px, pz in locations):
            raise ValidationError("Building sites must remain at least six units apart")
        locations.append((x, z))
        _number(b.get("height"), "building.height", 0.1, 80)
        _number(b.get("progress"), "building.progress", 0, 1)
        _number(b.get("capacity"), "building.capacity", 1, 10400)
        _number(b.get("baseCapacity"), "building.baseCapacity", 1, 2600)
        if b["capacity"] > b["baseCapacity"] * 4:
            raise ValidationError("Redevelopment density exceeds four times base capacity")
        for key in ("createdMonth", "startedMonth"):
            _integer(b.get(key), "building." + key, 0, world["month"])
        if b["startedMonth"] < b["createdMonth"]:
            raise ValidationError("Construction cannot precede building creation")
        _integer(b.get("constructionMonths"), "building.constructionMonths", 1, 36)
        _integer(b.get("upgrades"), "building.upgrades")
        _number(b.get("constructionCostM"), "building.constructionCostM", 0, 1000)
    metrics = world["metrics"]
    for key in ("population", "jobs", "homes"):
        _integer(metrics.get(key), "metrics." + key)
    for key in ("happiness", "airQuality"):
        _number(metrics.get(key), "metrics." + key, 0, 100)
    for key in ("emissions", "treasuryM", "businessCashM", "powerDemand", "powerCapacity", "transitCapacity", "greenSpace"):
        _number(metrics.get(key), "metrics." + key)
    if "constructionEmissions" in metrics:
        _number(metrics["constructionEmissions"], "metrics.constructionEmissions")
    for key in ("employmentRate", "housingPressure", "transitCoverage"):
        _number(metrics.get(key), "metrics." + key, 0, 1)
    if metrics["homes"] != int(_capacity(world, "housing")):
        raise ValidationError("Homes must equal completed housing capacity")
    if metrics["population"] > math.floor(metrics["homes"] * PEOPLE_PER_HOME):
        raise ValidationError("Population exceeds physical housing capacity")
    if metrics["jobs"] > sum(_capacity(world, kind) for kind in ("office", "industry", "civic")):
        raise ValidationError("Jobs exceed completed workplace capacity")
    if metrics["powerCapacity"] > GRID_POWER + _capacity(world, "solar") + 0.001:
        raise ValidationError("Power exceeds completed generation capacity")
    if metrics["treasuryM"] != _actor(world, "government")["cashM"] or metrics["businessCashM"] != _actor(world, "business")["cashM"]:
        raise ValidationError("Public cash summaries must match their actor balances")
    for name, limit in (("messages", MAX_MESSAGES), ("events", MAX_EVENTS), ("ledger", MAX_LEDGER)):
        entries = world[name]
        if not isinstance(entries, list) or len(entries) > limit:
            raise ValidationError(f"{name} exceeds bounded retention")
        entry_ids = set()
        for entry in entries:
            if not isinstance(entry, dict):
                raise ValidationError(f"Invalid {name} entry")
            _text(entry.get("id"), name + ".id", 80)
            if entry["id"] in entry_ids:
                raise ValidationError(f"Duplicate {name} ID")
            entry_ids.add(entry["id"])
            _integer(entry.get("month"), name + ".month", 0, world["month"])
            if name == "messages":
                if entry.get("source") not in ACTOR_IDS + ("user", "engine") or entry.get("sourceType") not in ("rules", "live", "user"):
                    raise ValidationError("Invalid message provenance")
                _text(entry.get("text"), "message.text", 1200)
                _text(entry.get("action"), "message.action", 100)
            elif name == "events":
                for key in ("type", "title", "detail"):
                    _text(entry.get(key), "event." + key, 1200)
                _number(entry.get("x"), "event.x", -48, 48)
                _number(entry.get("z"), "event.z", -48, 48)
            else:
                if entry.get("actor") not in ACTOR_IDS:
                    raise ValidationError("Invalid ledger actor")
                _number(entry.get("costM"), "ledger.costM")
                _number(entry.get("revenueM"), "ledger.revenueM")
                _text(entry.get("action"), "ledger.action", 100)
                _text(entry.get("detail"), "ledger.detail", 1200)
    for key in ("building", "message", "event", "ledger"):
        _integer(world["counters"].get(key), "counter." + key)
    if not isinstance(world["objectives"], list) or len(world["objectives"]) > 20:
        raise ValidationError("Invalid objectives")
    for objective in world["objectives"]:
        if not isinstance(objective, dict) or type(objective.get("achieved")) is not bool:
            raise ValidationError("Invalid objective")
        _text(objective.get("id"), "objective.id", 100)
        _text(objective.get("label"), "objective.label", 200)
        _number(objective.get("current"), "objective.current")
        _number(objective.get("target"), "objective.target", 0.01)
    return copy.deepcopy(world)


def model_document() -> dict:
    """Machine-readable model transparency for GET /api/model."""
    return copy.deepcopy({
        "version": VERSION, "status": "Synthetic scenario / model-based projection, not a calibrated forecast.",
        "scope": "A freely developing fictional district inspired by Northern Metropolis themes; no empirical prediction.",
        "units": {"cash": "illustrative HKD million", "time": "one month per step", "emissions": "tCO2e/month",
                  "power": "synthetic normalized units", "greenSpace": "synthetic area units"},
        "policyBounds": POLICY_BOUNDS, "actions": {action: {"actor": ACTION_ACTOR[action], "costM": ACTION_COSTS[action],
                  **({"leadMonths": BUILD_SPECS[action[6:]]["months"], "capacity": BUILD_SPECS[action[6:]]["capacity"],
                      "unit": BUILD_SPECS[action[6:]]["unit"]} if action.startswith("build_") else {})} for action in ACTION_ACTOR},
        "roleActions": ROLE_ACTIONS, "constructionLimits": BUILD_LIMITS,
        "assumptions": ["42 initially completed buildings on an eight-unit grid outside river x=15..24; 132 available sites.",
                        "2.35 people per home; 48% workforce share; fixed imported power capacity of 1,800 units.",
                        "Costs are committed up front; construction takes 3..9 months; incomplete buildings provide no capacity. Incurred construction emissions include the completion month, persist through instant actions, and begin for newly commissioned works on the next tick.",
                        "Residents can construct cooperative housing: 12M, 280 homes, six months. Other housing: 20M, 480 homes.",
                        "At a full city, actors redevelop their own completed buildings up to four times original capacity and height 80. Old capacity is offline throughout works. Further construction is rejected when no site or below-cap asset is available.",
                        "Government subsidies transfer 4M to residents or 6M to business and add 0.15 policy support. Buildings add 0.08 support in their sector. Tax actions change payroll tax by 0.015.",
                        "Operating cash flows are an open economy: external sales and household retained income enter; operating costs exit. No debt or negative cash is permitted. Underfunded operating services lose capacity.",
                        "Rules act on current public state at role-specific monthly cadences. Explicit decision lists suppress all rules; an empty list still advances economics and construction.",
                        "Unsupported, negated and multi-action text is recorded without execution. Catalog action IDs and catalog phrases use fixed quantities; numeric user/model quantities are never trusted.",
                        "Histories retain 80 messages, 80 events and 120 ledger entries; exact snapshot history belongs to the service."],
        "equations": {
            "housing": "homes = sum(completed housing capacity); population <= floor(2.35 * homes); housingPressure = population / (2.35 * homes)",
            "power": "demand = 0.09*population + 0.09*officeJobs + 0.30*industrialJobs + 0.10*civicJobs; capacity = 1800 + completedSolar*energyFunding; adequacy = min(1, capacity/demand)",
            "jobs": "jobs = floor(((officeJobs+industrialJobs)*businessFunding + civicJobs*governmentFunding)*powerAdequacy); employmentRate=min(1,jobs/(0.48*population))",
            "migration": "monthly rate = clip(0.0025+0.003*businessPolicy+0.002*housingPolicy+0.002*(happiness/100-0.5)+0.004*(employmentRate-0.88)-0.01*max(0,housingPressure-0.96)-0.012*(1-powerAdequacy)+seededNoise, -0.008, 0.009); noise in [-0.0004,0.0004]",
            "treasury": "revenue = employed*0.0025*taxRate + homes*0.00004 + employed*0.000015; expenses = 0.30*transitBuildings + 0.09*parks + 0.20*civicBuildings + 0.00025*min(1800,demand)",
            "business": "sales=(0.0035*officeJobs+0.005*industrialJobs)*workplaceOccupancy*(0.9+0.2*businessPolicy); expenses=0.70*wages+0.55*officeBuildings+0.85*industrialBuildings; wages=0.0025*employed",
            "households": "retained income = wages*(1-taxRate)*0.08; expenses=0.000045*population",
            "utility": "revenue=0.0025*min(demand,completedSolar); expenses=0.15*solarBuildings",
            "operations": "paid=min(cash+revenue,expenses); funding=min(1,(cash+revenue)/expenses); cash'=cash+revenue-paid",
            "emissions": "0.014*population + 0.03*operatingOfficeJobs + 0.15*operatingIndustrialJobs + 0.21*gridPowerUsed + 0.023*population*(1-0.65*transitCoverage) + 40*monthlyConstructionSpend",
            "happiness": "target=clip(68+8*housingPolicy+10*transitCoverage+9*greenRatio+10*employmentRate-35*max(0,housingPressure-0.75)-25*(1-powerAdequacy)-8*industrialJobs/max(1,jobs)-15*taxRate,0,100); value'=0.85*value+0.15*target",
            "airQuality": "target=clip(92-18*emissions/max(150,0.04*population+100)+12*greenRatio,0,100); value'=0.85*value+0.15*target; greenRatio=min(1,operatingGreenSpace/(1.4*population))",
        },
        "limitations": ["Synthetic coefficients and aggregates; no calibration, real parcel data, land market or demographic cohorts.",
                        "Imported grid supply and external demand are stylized; no weather disasters or market price dynamics.",
                        "Construction and tax policy are catalog actions, not a general natural-language policy simulator.",
                        "Milestones record the first achievement; current metrics may subsequently decline."],
    })

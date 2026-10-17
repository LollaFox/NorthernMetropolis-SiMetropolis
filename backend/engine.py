"""A deterministic numerical shell around six small narrative AI roles.

The provider supplies prose, firm types and whole-group actions.  This module
alone owns construction, capacity, rent, employment and numerical satisfaction.
All public state is JSON-compatible and advancing never mutates its input.
"""

import calendar
import copy
import datetime
import math

from .scenario import PROFILES, validate_scenario


PROFILE_WEIGHTS = {
    "budget": {"affordability": .65, "work": .20, "parks": .10, "stability": .05},
    "work": {"affordability": .15, "work": .65, "parks": .10, "stability": .10},
    "park": {"affordability": .15, "work": .15, "parks": .60, "stability": .10},
    "stability": {"affordability": .15, "work": .15, "parks": .10, "stability": .60},
}
PROFILE_PREFERENCES = {
    "budget": "Fictional budget profile: sensitive to wages, unemployment and per-person rent.",
    "work": "Fictional work profile: values available jobs, higher wages and shorter commutes.",
    "park": "Fictional park profile: values nearby completed parks and housing quality.",
    "stability": "Fictional stability profile: values settled surroundings; consider recent construction starts and completions.",
}
_UNSET_RESPONSE = object()


def _date(value):
    if not isinstance(value, str):
        raise ValueError("date must be YYYY-MM-DD text")
    try:
        parsed = datetime.date.fromisoformat(value)
    except ValueError:
        raise ValueError("date must be a valid YYYY-MM-DD date") from None
    if parsed.isoformat() != value:
        raise ValueError("date must use YYYY-MM-DD format")
    return parsed


def _next_month(value, anchor_day):
    year = value.year + (value.month == 12)
    month = 1 if value.month == 12 else value.month + 1
    day = min(anchor_day, calendar.monthrange(year, month)[1])
    return datetime.date(year, month, day)


def _empty_metrics():
    return {
        "population": 0, "groups": 0, "residentialTowers": 0,
        "businessTowers": 0, "parks": 0, "stations": 0, "jobCapacity": 0,
        "filledJobs": 0, "vacancies": 0, "unemployedWorkers": 0,
        "monthlyProfit": 0, "monthlyGDP": 0, "totalGDP": 0,
        "meanSatisfaction": None,
        "profiles": {profile: {"population": 0, "groups": 0,
                               "meanSatisfaction": None} for profile in PROFILES},
    }


def create_world(config=None):
    """Create an empty district; no construction or AI runs until step one."""
    normalized = validate_scenario({} if config is None else config)
    if "fiscal" in normalized:
        from . import fiscal_engine
        return fiscal_engine.create(normalized)
    buildings = []
    for scheduled in normalized["buildings"]:
        building = copy.deepcopy(scheduled)
        building.update(status="planned", completedAt=None, narrative=None,
                        firmId=None, conditions=None)
        buildings.append(building)
    world = {
        "schemaVersion": 1, "month": None, "step": 0, "anchorDay": None,
        "config": normalized, "buildings": buildings, "groups": [], "firms": [],
        "nextGroupId": 1, "roleHistory": {profile: [] for profile in PROFILES},
        "constructionHistory": [], "narratives": {}, "events": [], "audit": [],
        "metrics": _empty_metrics(),
    }
    assert_invariants(world)
    return world


def _building_map(world):
    return {building["id"]: building for building in world["buildings"]}


def building_totals(world, building_or_id):
    """Derive current per-object housing and jobs without caching extra state.

    Current capacity counts completed housing only. Planned housing capacity
    describes the full configured residential object, even before completion.
    Job offers require an assigned firm; no future firm type is assumed.
    Counts apply equally to individual-building and aggregate-cluster presets.
    """
    if world.get("model") == "hk-fiscal-v1":
        from . import fiscal_engine
        return fiscal_engine.building_totals(world, building_or_id)
    identifier = (building_or_id.get("id") if isinstance(building_or_id, dict)
                  else building_or_id)
    buildings = _building_map(world)
    if not isinstance(identifier, str) or identifier not in buildings:
        raise ValueError("building_totals requires a known building identifier")
    building = buildings[identifier]
    planned_capacity = (world["config"]["towerGroupSlots"] * world["config"]["groupSize"]
                        if building["type"] == "residential" else 0)
    firm = next((f for f in world["firms"] if f["towerId"] == identifier), None)
    return {
        "housingCapacity": planned_capacity if building["status"] == "complete" else 0,
        "plannedHousingCapacity": planned_capacity,
        "actualResidents": sum(g["size"] for g in world["groups"] if g["towerId"] == identifier),
        "offeredJobs": firm["jobCapacity"] if firm is not None else 0,
        "filledJobs": firm["filledJobs"] if firm is not None else 0,
        "vacancies": firm["vacancies"] if firm is not None else 0,
    }


def _building_facts(world, building):
    facts = {key: copy.deepcopy(building[key]) for key in (
        "id", "type", "x", "y", "startMonth", "completionMonth", "status",
        "completedAt", "narrative", "firmId")}
    facts["objectUnit"] = world["config"].get("scale", {}).get("unit", "building")
    if building["firmId"] is not None:
        facts["firm"] = copy.deepcopy(next(
            firm for firm in world["firms"] if firm["id"] == building["firmId"]))
    if building["type"] == "residential":
        occupants = [g for g in world["groups"] if g["towerId"] == building["id"]]
        facts["population"] = sum(g["size"] for g in occupants)
        facts["occupancy"] = {"groups": len(occupants), "population": facts["population"],
                              "profiles": sorted(g["profile"] for g in occupants)}
        facts["occupied"] = bool(occupants)
        facts["groupSlots"] = world["config"]["towerGroupSlots"]
        facts["populationCapacity"] = (world["config"]["towerGroupSlots"]
                                       * world["config"]["groupSize"])
    if building["type"] == "business":
        facts["occupied"] = building["firmId"] is not None
    return facts


def neighborhood(world, target):
    """Nine ordered cells, including explicit empty and off-map cells.

    ``target`` may be a building dictionary or its stable identifier.  Planned
    objects have no physical contents yet, so their cells remain empty. Active
    construction and completed objects are clearly distinguished.
    """
    if isinstance(target, str):
        target = _building_map(world)[target]
    grid = world["config"]["grid"]
    cells = {(b["x"], b["y"]): b for b in world["buildings"]
             if b["status"] != "planned"}
    result = []
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            x, y = target["x"] + dx, target["y"] + dy
            cell = {"x": x, "y": y, "dx": dx, "dy": dy, "building": None}
            if not (0 <= x < grid["width"] and 0 <= y < grid["height"]):
                cell["status"] = "off_map"
            elif (x, y) not in cells:
                cell["status"] = "empty"
            else:
                building = cells[(x, y)]
                cell["status"] = building["status"]
                cell["building"] = _building_facts(world, building)
            result.append(cell)
    return result


def _construction_context(world):
    latest = world["constructionHistory"][-1] if world["constructionHistory"] else {
        "started": [], "completed": []}
    buildings = _building_map(world)
    return {
        "started": [_building_facts(world, buildings[key]) for key in latest["started"]],
        "completed": [_building_facts(world, buildings[key]) for key in latest["completed"]],
        "active": [_building_facts(world, b) for b in world["buildings"]
                   if b["status"] == "construction"],
        "recent": copy.deepcopy(world["constructionHistory"][-3:]),
    }


def _local_context(world, building):
    return {
        "month": world["month"], "step": world["step"],
        "scale": copy.deepcopy(world["config"].get("scale")),
        "target": _building_facts(world, building),
        "neighborhood": neighborhood(world, building),
        "construction": _construction_context(world),
        "canonicalFacts": {
            "synthetic": True, "currency": "synthetic HKD",
            "units": {"rentPerPerson": "HKD/resident/month", "wage": "HKD/employed worker/month",
                      "startingFunds": "aggregate HKD/firm", "funds": "aggregate HKD/firm",
                      "monthlyProfit": "aggregate HKD/firm/month",
                      "monthlyGDP": "aggregate synthetic HKD/firm/month"},
            "groupSize": world["config"]["groupSize"],
            "groupWorkers": world["config"]["groupWorkers"],
            "towerGroupSlots": world["config"]["towerGroupSlots"],
            "firmPresets": copy.deepcopy(world["config"]["firms"]),
            "sameStepOrdering": "All shells complete first; process by completion month, y, x, id. Only earlier assignments and narratives exist.",
        },
        "instructions": "Use current 3x3 cells and existing narratives. Empty and off-map cells are distinct. Construction is not completed infrastructure. Respect all numerical facts. Social character is synthetic prose, never occupancy or extra infrastructure.",
    }


def _text(value, field, maximum=900):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError("%s must be nonempty text of at most %d characters" % (field, maximum))
    try:
        value.encode("utf-8")
    except UnicodeError:
        raise ValueError("%s must contain valid Unicode" % field) from None
    return value


def _keys(value, required, name):
    if not isinstance(value, dict) or set(value) != set(required):
        raise ValueError("%s must contain exactly %s" % (name, sorted(required)))


def _validate_response(role, response):
    if role == "narrator":
        _keys(response, {"character"}, "narrator response")
        _text(response["character"], "character")
    elif role == "firm":
        _keys(response, {"firmType", "reason"}, "firm response")
        if response["firmType"] not in ("small", "large"):
            raise ValueError("firmType must be small or large")
        _text(response["reason"], "reason", 320)
    elif role in PROFILES:
        _keys(response, {"actions", "reason"}, "resident response")
        _text(response["reason"], "reason", 320)
        if not isinstance(response["actions"], list) or len(response["actions"]) > 400:
            raise ValueError("actions must be a list of at most 400 actions")
        seen = set()
        for action in response["actions"]:
            _keys(action, {"towerId", "action", "reason"}, "resident action")
            _text(action["towerId"], "towerId", 80)
            _text(action["reason"], "action.reason", 320)
            if action["action"] not in ("move_in", "leave"):
                raise ValueError("action must be move_in or leave")
            if action["towerId"] in seen:
                raise ValueError("duplicate or conflicting actions for the same tower")
            seen.add(action["towerId"])
    else:
        raise ValueError("unknown AI role")
    return copy.deepcopy(response)


def _invoke(world, ai, role, context, target_id=None, prepared_response=_UNSET_RESPONSE):
    record = {"month": world["month"], "role": role, "targetId": target_id,
              "context": copy.deepcopy(context), "response": None,
              "status": "ok", "error": None, "outcomes": []}
    world["audit"].append(record)
    try:
        if prepared_response is _UNSET_RESPONSE:
            raw_response = ai.call(role, copy.deepcopy(context))
        elif isinstance(prepared_response, Exception):
            raise prepared_response
        else:
            raw_response = prepared_response
    except Exception as error:
        # Provider messages can contain request URLs or credentials. Retain the
        # failure category, while adapter metrics own safe diagnostic detail.
        record.update(status="provider_error", error="provider raised " + type(error).__name__)
        return None, record
    try:
        response = _validate_response(role, raw_response)
    except (ValueError, TypeError) as error:
        record.update(status="invalid_response", error=str(error))
        return None, record
    record["response"] = response
    return response, record


def _event(world, kind, **fields):
    world["events"].append(dict(month=world["month"], kind=kind, **fields))


def _construct(world, ai):
    started, completed = [], []
    for building in world["buildings"]:
        if building["startMonth"] == world["step"]:
            started.append(building["id"])
            building["status"] = "construction"
            _event(world, "construction_started", buildingId=building["id"])
        if building["completionMonth"] == world["step"]:
            completed.append(building["id"])
            building["status"] = "complete"
            building["completedAt"] = world["month"]
            _event(world, "construction_completed", buildingId=building["id"])
    world["constructionHistory"].append({
        "month": world["month"], "step": world["step"],
        "started": started, "completed": completed,
    })
    for building in world["buildings"]:
        if building["id"] not in completed:
            continue
        if building["type"] == "business":
            context = _local_context(world, building)
            context["instructions"] += " Choose large for a business cluster or small near residents; empty completed shells count as shells, not assigned firms. The choice is yours."
            response, audit = _invoke(world, ai, "firm", context, building["id"])
            firm_type = response["firmType"] if response is not None else "small"
            preset = copy.deepcopy(world["config"]["firms"][firm_type])
            firm = dict(preset, id="F:" + building["id"], towerId=building["id"],
                        type=firm_type, assignedAt=world["month"], assignedStep=world["step"],
                        funds=preset["startingFunds"], filledJobs=0,
                        vacancies=preset["jobCapacity"], monthsAccrued=0)
            building["firmId"] = firm["id"]
            world["firms"].append(firm)
            audit["outcomes"].append({"firmId": firm["id"], "firmType": firm_type,
                                      "recovery": response is None})
            _event(world, "firm_assigned" if response is not None else "firm_recovery",
                   buildingId=building["id"], firmId=firm["id"], firmType=firm_type,
                   reason=response["reason"] if response is not None else
                   "Mandatory immediate occupancy: invalid/unavailable AI recovered with deterministic small firm.")
        if building["type"] == "station":
            continue
        response, audit = _invoke(world, ai, "narrator", _local_context(world, building),
                                  building["id"])
        narrative = response["character"] if response is not None else (
            "Synthetic %s %s at cell (%d, %d), completed %s. Narrative provider unavailable; no invented social character."
            % (building["type"], building["id"], building["x"], building["y"], world["month"]))
        building["narrative"] = narrative
        world["narratives"][building["id"]] = narrative
        audit["outcomes"].append({"buildingId": building["id"], "saved": True,
                                  "recovery": response is None})
        _event(world, "narrative_saved" if response is not None else "narrative_recovery",
               buildingId=building["id"])


def _distance(first, second):
    return math.hypot(first["x"] - second["x"], first["y"] - second["y"])


def _transport(world):
    stations = sum(b["type"] == "station" and b["status"] == "complete"
                   for b in world["buildings"])
    return stations, 1 / (1 + .15 * stations)


def _recent_changes(world, building):
    buildings = _building_map(world)
    changes = 0
    for month in world["constructionHistory"][-3:]:
        # One physical object counts once when start and finish coincide.
        for identifier in set(month["started"] + month["completed"]):
            other = buildings[identifier]
            if abs(other["x"] - building["x"]) <= 1 and abs(other["y"] - building["y"]) <= 1:
                changes += 1
    return changes


def _base_conditions(world, building):
    buildings = _building_map(world)
    parks = sum(b["type"] == "park" and b["status"] == "complete"
                and abs(b["x"] - building["x"]) <= 1
                and abs(b["y"] - building["y"]) <= 1 for b in world["buildings"])
    rent = world["config"]["baseRent"] + sum(
        world["config"]["rentPremium"] / (1 + _distance(building, buildings[f["towerId"]]))
        for f in world["firms"] if f["assignedStep"] < world["step"])
    stations, multiplier = _transport(world)
    return {"rentPerPerson": round(rent, 2), "nearbyParks": parks,
            "housingQuality": min(100, 40 + 20 * parks),
            "stationCount": stations, "transportMultiplier": multiplier,
            "constructionChanges": _recent_changes(world, building)}


def _expected_jobs(world, building):
    """A transparent vacancy estimate, not a promised job reservation."""
    buildings = _building_map(world)
    _, multiplier = _transport(world)
    remaining = world["config"]["groupWorkers"]
    employed = 0
    wages, distance = 0.0, 0.0
    for firm in sorted(world["firms"], key=lambda f: (
            _distance(building, buildings[f["towerId"]]), f["id"])):
        workers = min(remaining, firm["vacancies"])
        employed += workers
        remaining -= workers
        wages += workers * firm["wage"]
        distance += workers * _distance(building, buildings[firm["towerId"]]) * multiplier
        if not remaining:
            break
    total_workers = world["config"]["groupWorkers"]
    return {"expectedEmploymentRate": employed / total_workers,
            "expectedWage": round(wages / total_workers, 2),
            "expectedCommute": round(distance / employed, 4) if employed else None,
            "jobEstimate": "Nearest currently vacant positions; competing arrivals may fill them. Unemployed workers earn zero."}


def _score(profile, conditions, income_per_person, employment_rate, mean_commute):
    rent = conditions["rentPerPerson"]
    affordability = (100 * max(0, 1 - rent / income_per_person)
                     if income_per_person > 0 else (100 if rent == 0 else 0))
    commute_score = 100 / (1 + (mean_commute or 0) / 5)
    work = 100 * employment_rate * .7 + commute_score * employment_rate * .3
    parts = {"affordability": round(affordability, 4), "work": round(work, 4),
             "parks": min(100, 25 + 25 * conditions["nearbyParks"]),
             "stability": max(0, 100 - 18 * conditions["constructionChanges"])}
    score = sum(parts[key] * weight for key, weight in PROFILE_WEIGHTS[profile].items())
    return round(max(0, min(100, score)), 4), parts


def _update_conditions(world):
    """Refresh tower facts and group scores, using current job assignments."""
    buildings = _building_map(world)
    firms = {firm["id"]: firm for firm in world["firms"]}
    _, multiplier = _transport(world)
    for building in world["buildings"]:
        if building["type"] == "residential" and building["status"] == "complete":
            building["conditions"] = _base_conditions(world, building)
    for group in world["groups"]:
        building = buildings[group["towerId"]]
        conditions = copy.deepcopy(building["conditions"])
        employed = sum(a["workers"] for a in group["jobAssignments"])
        payroll = sum(a["workers"] * firms[a["firmId"]]["wage"]
                      for a in group["jobAssignments"])
        commute_sum = sum(a["workers"] * multiplier
                          * _distance(building, buildings[firms[a["firmId"]]["towerId"]])
                          for a in group["jobAssignments"])
        commute = commute_sum / employed if employed else None
        score, parts = _score(group["profile"], conditions, payroll / group["size"],
                              employed / group["workers"], commute)
        conditions.update(employedWorkers=employed, unemployedWorkers=group["workers"] - employed,
                          averageWage=round(payroll / group["workers"], 2),
                          incomePerPerson=round(payroll / group["size"], 2),
                          meanCommute=round(commute, 4) if commute is not None else None,
                          satisfaction=score, satisfactionComponents=parts)
        group["conditions"] = conditions


def _resident_context(world, profile):
    towers = []
    for building in sorted(world["buildings"], key=lambda b: b["id"]):
        if building["type"] != "residential" or building["status"] != "complete":
            continue
        occupants = [g for g in world["groups"] if g["towerId"] == building["id"]]
        own = next((g for g in occupants if g["profile"] == profile), None)
        slots = world["config"]["towerGroupSlots"] - len(occupants)
        conditions = copy.deepcopy(building["conditions"])
        conditions.update(_expected_jobs(world, building))
        if own is not None:
            conditions.update(copy.deepcopy(own["conditions"]))
        else:
            income = (conditions["expectedWage"] * world["config"]["groupWorkers"]
                      / world["config"]["groupSize"])
            conditions["satisfaction"], conditions["satisfactionComponents"] = _score(
                profile, conditions, income, conditions["expectedEmploymentRate"],
                conditions["expectedCommute"])
        towers.append({
            "towerId": building["id"], "target": _building_facts(world, building),
            "narrative": building["narrative"], "neighborhood": neighborhood(world, building),
            "conditions": conditions,
            "occupancy": {"groups": len(occupants),
                          "population": sum(g["size"] for g in occupants),
                          "availableSlots": slots, "ownGroup": copy.deepcopy(own)},
            "eligibleActions": ["leave"] if own is not None else (["move_in"] if slots else []),
        })
    return {
        "month": world["month"], "step": world["step"], "profile": profile,
        "scale": copy.deepcopy(world["config"].get("scale")),
        "preferences": PROFILE_PREFERENCES[profile],
        "groupSize": world["config"]["groupSize"],
        "groupWorkers": world["config"]["groupWorkers"],
        "towerGroupSlots": world["config"]["towerGroupSlots"],
        "towers": towers, "firms": copy.deepcopy(world["firms"]),
        "history": copy.deepcopy(world["roleHistory"][profile][-6:]),
        "construction": _construction_context(world), "city": copy.deepcopy(world["metrics"]),
        "satisfactionModel": {"synthetic": True, "range": [0, 100],
                              "weights": copy.deepcopy(PROFILE_WEIGHTS[profile]),
                              "income": "Group payroll / all residents; unemployed workers earn zero.",
                              "commuteUnits": "Logical-cell Euclidean distance, reduced by citywide station multiplier."},
        "instructions": "Decide whole-group arrivals from outside or departures out of district using current facts, place narratives and retained history. Each action is one fixed group. No action preserves occupancy. Scores are explanatory synthetic facts, not mandatory action thresholds. Only listed eligibleActions are valid; conflicts over remaining slots resolve by rotating profile priority. Vacancy estimates are not job guarantees.",
    }


def _validate_actions(world, profile, response):
    buildings = _building_map(world)
    for action in response["actions"]:
        building = buildings.get(action["towerId"])
        if building is None or building["type"] != "residential" or building["status"] != "complete":
            raise ValueError("action must target a completed residential tower")
        occupants = [g for g in world["groups"] if g["towerId"] == building["id"]]
        own = next((g for g in occupants if g["profile"] == profile), None)
        if action["action"] == "leave" and own is None:
            raise ValueError("profile has no group to withdraw at tower " + building["id"])
        if action["action"] == "move_in":
            if own is not None:
                raise ValueError("profile already occupies tower " + building["id"])
            if len(occupants) >= world["config"]["towerGroupSlots"]:
                raise ValueError("no arrival slot available in pre-decision tower " + building["id"])


def _decide_and_settle(world, ai):
    responses, audits = {}, {}
    contexts = {profile: _resident_context(world, profile) for profile in PROFILES}
    batch_call = getattr(ai, "call_batch", None)
    prepared_responses = None
    invalid_batch = False
    if callable(batch_call):
        # Provider workers receive independent JSON packets, never world/audit
        # references. Applying results and creating audits remain sequential.
        try:
            prepared_responses = batch_call([
                (profile, copy.deepcopy(contexts[profile])) for profile in PROFILES])
        except Exception as error:
            prepared_responses = [error] * len(PROFILES)
        if not isinstance(prepared_responses, list) or len(prepared_responses) != len(PROFILES):
            invalid_batch = True
            prepared_responses = [None] * len(PROFILES)
    for index, profile in enumerate(PROFILES):
        prepared = (_UNSET_RESPONSE if prepared_responses is None
                    else prepared_responses[index])
        response, audit = _invoke(world, ai, profile, contexts[profile],
                                  prepared_response=prepared)
        if invalid_batch:
            audit["error"] = "batch provider must return one result per requested profile"
        if response is not None:
            try:
                _validate_actions(world, profile, response)
            except ValueError as error:
                audit.update(status="invalid_response", error=str(error))
                response = None
        responses[profile], audits[profile] = response, audit
        if response is None:
            _event(world, "resident_decision_rejected", profile=profile, reason=audit["error"])
    # All four roles saw one pre-settlement state. No provider can observe an
    # earlier profile's same-month arrival or departure.
    for profile in PROFILES:
        response = responses[profile]
        if response is None:
            continue
        for action in sorted(response["actions"], key=lambda a: a["towerId"]):
            if action["action"] != "leave":
                continue
            group = next(g for g in world["groups"] if g["profile"] == profile
                         and g["towerId"] == action["towerId"])
            world["groups"].remove(group)
            outcome = dict(action, applied=True, groupId=group["id"], quantity=group["size"])
            audits[profile]["outcomes"].append(outcome)
            _event(world, "residents_left", profile=profile, towerId=group["towerId"],
                   groupId=group["id"], quantity=group["size"],
                   releasedJobs=sum(a["workers"] for a in group["jobAssignments"]),
                   reason=action["reason"])
    rotation = (world["step"] - 1) % len(PROFILES)
    order = PROFILES[rotation:] + PROFILES[:rotation]
    for profile in order:
        response = responses[profile]
        if response is None:
            continue
        for action in sorted(response["actions"], key=lambda a: a["towerId"]):
            if action["action"] != "move_in":
                continue
            occupants = sum(g["towerId"] == action["towerId"] for g in world["groups"])
            if occupants >= world["config"]["towerGroupSlots"]:
                outcome = dict(action, applied=False, error="tower capacity filled by prior competing arrival")
                audits[profile]["outcomes"].append(outcome)
                _event(world, "arrival_capacity_rejected", profile=profile,
                       towerId=action["towerId"], reason=outcome["error"])
                continue
            identifier = "G%06d" % world["nextGroupId"]
            world["nextGroupId"] += 1
            group = {"id": identifier, "profile": profile, "towerId": action["towerId"],
                     "size": world["config"]["groupSize"],
                     "workers": world["config"]["groupWorkers"],
                     "arrivedAt": world["month"], "jobAssignments": [], "conditions": {}}
            world["groups"].append(group)
            audits[profile]["outcomes"].append(dict(action, applied=True,
                                                    groupId=identifier, quantity=group["size"]))
            _event(world, "residents_arrived", profile=profile, towerId=group["towerId"],
                   groupId=identifier, quantity=group["size"], reason=action["reason"])
    for profile in PROFILES:
        audit = audits[profile]
        world["roleHistory"][profile].append({
            "month": world["month"], "status": audit["status"],
            "decision": copy.deepcopy(audit["response"]), "error": audit["error"],
            "outcomes": copy.deepcopy(audit["outcomes"]),
        })


def _allocate_jobs(world):
    """Preserve surviving assignments, then fill nearest vacancies stably."""
    buildings = _building_map(world)
    firms = {firm["id"]: firm for firm in world["firms"]}
    for firm in world["firms"]:
        firm["filledJobs"] = 0
    for group in world["groups"]:
        for assignment in group["jobAssignments"]:
            firms[assignment["firmId"]]["filledJobs"] += assignment["workers"]
    for firm in world["firms"]:
        firm["vacancies"] = firm["jobCapacity"] - firm["filledJobs"]
    # Stable arrival sequence protects old residents' allocations. Ties among
    # workplaces use firm id; jobs do not depend on random number generators.
    for group in sorted(world["groups"], key=lambda g: (g["arrivedAt"], g["id"])):
        remaining = group["workers"] - sum(a["workers"] for a in group["jobAssignments"])
        if not remaining:
            continue
        home = buildings[group["towerId"]]
        assignments = {a["firmId"]: a for a in group["jobAssignments"]}
        for firm in sorted(world["firms"], key=lambda f: (
                _distance(home, buildings[f["towerId"]]), f["id"])):
            workers = min(remaining, firm["vacancies"])
            if not workers:
                continue
            if firm["id"] not in assignments:
                assignments[firm["id"]] = {"firmId": firm["id"], "workers": 0}
                group["jobAssignments"].append(assignments[firm["id"]])
            assignments[firm["id"]]["workers"] += workers
            firm["filledJobs"] += workers
            firm["vacancies"] -= workers
            remaining -= workers
            if not remaining:
                break


def _refresh_metrics(world, accrue=False):
    previous_gdp = world["metrics"]["totalGDP"]
    metrics = _empty_metrics()
    for building in world["buildings"]:
        if building["status"] == "complete":
            key = {"residential": "residentialTowers", "business": "businessTowers",
                   "park": "parks", "station": "stations"}[building["type"]]
            metrics[key] += 1
    metrics["groups"] = len(world["groups"])
    for group in world["groups"]:
        profile = metrics["profiles"][group["profile"]]
        profile["population"] += group["size"]
        profile["groups"] += 1
        metrics["population"] += group["size"]
        metrics["unemployedWorkers"] += group["conditions"]["unemployedWorkers"]
    for profile_name, profile in metrics["profiles"].items():
        if profile["population"]:
            profile["meanSatisfaction"] = round(sum(
                g["size"] * g["conditions"]["satisfaction"] for g in world["groups"]
                if g["profile"] == profile_name) / profile["population"], 4)
    if metrics["population"]:
        metrics["meanSatisfaction"] = round(sum(
            g["size"] * g["conditions"]["satisfaction"] for g in world["groups"])
            / metrics["population"], 4)
    for firm in world["firms"]:
        if accrue:
            firm["funds"] += firm["monthlyProfit"]
            firm["monthsAccrued"] += 1
        for firm_key, metric_key in (("jobCapacity", "jobCapacity"), ("filledJobs", "filledJobs"),
                                     ("vacancies", "vacancies"), ("monthlyProfit", "monthlyProfit"),
                                     ("monthlyGDP", "monthlyGDP")):
            metrics[metric_key] += firm[firm_key]
    metrics["totalGDP"] = previous_gdp + (metrics["monthlyGDP"] if accrue else 0)
    world["metrics"] = metrics


def advance_month(world, ai, date):
    """Advance exactly one anchored calendar month, or safely replay its date.

    A duplicate current date returns an independent copy without calling AI or
    accruing any profit. Earlier dates and skipped internal months are rejected.
    """
    if world.get("model") == "hk-fiscal-v1":
        from . import fiscal_engine
        return fiscal_engine.advance(world, date, ai)
    assert_invariants(world)
    parsed = _date(date)
    if world["month"] == date:
        return copy.deepcopy(world)
    if world["month"] is not None:
        expected = _next_month(_date(world["month"]), world["anchorDay"])
        if parsed != expected:
            raise ValueError("next internal month must be " + expected.isoformat())
    result = copy.deepcopy(world)
    result["month"] = date
    result["step"] += 1
    if result["anchorDay"] is None:
        result["anchorDay"] = parsed.day
    result["events"], result["audit"] = [], []
    _construct(result, ai)
    _update_conditions(result)
    _refresh_metrics(result)
    _decide_and_settle(result, ai)
    _allocate_jobs(result)
    _update_conditions(result)
    _refresh_metrics(result, accrue=True)
    assert_invariants(result)
    return result


def _require(condition, message):
    if not condition:
        raise ValueError("world invariant: " + message)


def _assert_invariants(world):
    """Reject inconsistent persisted/injected state before any advancement."""
    _require(isinstance(world, dict), "world must be an object")
    required = {"schemaVersion", "month", "step", "anchorDay", "config", "buildings",
                "groups", "firms", "nextGroupId", "roleHistory", "constructionHistory",
                "narratives", "events", "audit", "metrics"}
    _require(required <= set(world), "required state fields missing")
    _require(world["schemaVersion"] == 1, "unsupported schema version")
    _require(type(world["step"]) is int and world["step"] >= 0, "invalid step")
    _require(type(world["nextGroupId"]) is int and world["nextGroupId"] >= 1, "invalid group sequence")
    if world["step"] == 0:
        _require(world["month"] is None and world["anchorDay"] is None, "initial date")
    else:
        _date(world["month"])
        _require(type(world["anchorDay"]) is int and 1 <= world["anchorDay"] <= 31, "anchor day")
    config = validate_scenario(world["config"])
    _require(config == world["config"], "configuration is not normalized")
    buildings = _building_map(world)
    _require(len(buildings) == len(world["buildings"]) == len(config["buildings"]), "building count/ids")
    scheduled = {b["id"]: b for b in config["buildings"]}
    for building in world["buildings"]:
        _require(building["id"] in scheduled, "unknown scheduled building")
        _require(all(building[key] == value for key, value in scheduled[building["id"]].items()),
                 "scheduled facts changed")
        expected = ("complete" if building["completionMonth"] <= world["step"] else
                    "construction" if building["startMonth"] <= world["step"] else "planned")
        _require(building["status"] == expected, "construction status")
        if expected == "complete":
            _require(isinstance(building["completedAt"], str), "missing completion date")
            _date(building["completedAt"])
            _require(building["completedAt"] <= world["month"], "completion in future")
            if building["type"] != "station":
                _require(isinstance(building["narrative"], str) and bool(building["narrative"].strip()),
                         "completed narrated object lacks narrative")
                _require(world["narratives"].get(building["id"]) == building["narrative"], "narrative mismatch")
        else:
            _require(building["completedAt"] is None and building["narrative"] is None
                     and building["firmId"] is None, "uncompleted building has completed contents")
        if building["type"] == "station":
            _require(building["narrative"] is None, "station cannot have narrative")
        if building["type"] != "business":
            _require(building["firmId"] is None, "firm in non-business object")
    firms = {f["id"]: f for f in world["firms"]}
    _require(len(firms) == len(world["firms"]), "duplicate firm")
    expected_firms = {b["firmId"] for b in world["buildings"]
                      if b["type"] == "business" and b["status"] == "complete"}
    _require(None not in expected_firms and set(firms) == expected_firms, "one immediate firm per business tower")
    for firm in world["firms"]:
        tower = buildings.get(firm["towerId"])
        _require(tower is not None and tower["firmId"] == firm["id"], "firm/tower mismatch")
        _require(firm["type"] in config["firms"], "unknown firm type")
        _require(all(firm[key] == value for key, value in config["firms"][firm["type"]].items()),
                 "firm preset changed")
        _require(firm["assignedStep"] == tower["completionMonth"], "firm assignment delayed")
        _require(firm["assignedAt"] == tower["completedAt"], "firm date mismatch")
        _require(firm["monthsAccrued"] == world["step"] - firm["assignedStep"] + 1,
                 "firm profit accrual count")
        _require(math.isclose(firm["funds"], firm["startingFunds"]
                             + firm["monthlyProfit"] * firm["monthsAccrued"], rel_tol=1e-10),
                 "firm funds are not fixed profit accrual")
        _require(type(firm["filledJobs"]) is int and type(firm["vacancies"]) is int
                 and 0 <= firm["filledJobs"] <= firm["jobCapacity"]
                 and firm["vacancies"] == firm["jobCapacity"] - firm["filledJobs"], "firm job counts")
    group_ids, occupancy, seen_profiles, filled = set(), {}, set(), {key: 0 for key in firms}
    for group in world["groups"]:
        _require(group["id"] not in group_ids, "duplicate group id")
        group_ids.add(group["id"])
        _require(group["profile"] in PROFILES, "unknown resident profile")
        tower = buildings.get(group["towerId"])
        _require(tower is not None and tower["type"] == "residential" and tower["status"] == "complete",
                 "residents outside completed housing")
        pair = (group["profile"], group["towerId"])
        _require(pair not in seen_profiles, "duplicate profile in tower")
        seen_profiles.add(pair)
        occupancy[group["towerId"]] = occupancy.get(group["towerId"], 0) + 1
        _require(occupancy[group["towerId"]] <= config["towerGroupSlots"], "tower over capacity")
        _require(group["size"] == config["groupSize"] and group["workers"] == config["groupWorkers"],
                 "group quantity changed")
        _date(group["arrivedAt"])
        _require(tower["completedAt"] <= group["arrivedAt"] <= world["month"], "invalid arrival date")
        total, assigned_firms = 0, set()
        for assignment in group["jobAssignments"]:
            identifier, workers = assignment["firmId"], assignment["workers"]
            _require(identifier in firms and identifier not in assigned_firms, "invalid/duplicate workplace")
            _require(type(workers) is int and workers > 0, "assignment must have positive whole workers")
            assigned_firms.add(identifier)
            filled[identifier] += workers
            total += workers
        _require(total <= group["workers"], "workers assigned twice")
        conditions = group["conditions"]
        _require(conditions["employedWorkers"] == total
                 and conditions["unemployedWorkers"] == group["workers"] - total, "group employment mismatch")
        _require((conditions["meanCommute"] is None) == (total == 0), "empty employment commute must be null")
        _require(type(conditions["satisfaction"]) in (int, float)
                 and 0 <= conditions["satisfaction"] <= 100, "satisfaction range")
        _require(conditions["rentPerPerson"] == _base_conditions(world, tower)["rentPerPerson"], "rent timing/value")
    _require(all(filled[key] == firm["filledJobs"] for key, firm in firms.items()), "assigned jobs mismatch")
    _require(set(world["roleHistory"]) == set(PROFILES), "exactly four resident histories")
    _require(all(len(world["roleHistory"][profile]) == world["step"] for profile in PROFILES), "missing decision history")
    _require(len(world["constructionHistory"]) == world["step"], "missing construction history")
    previous_date = None
    for index, history in enumerate(world["constructionHistory"]):
        history_date = _date(history["month"])
        _require(history["step"] == index + 1, "construction history step")
        if previous_date is not None:
            _require(history_date == _next_month(previous_date, world["anchorDay"]), "construction history date")
        else:
            _require(history_date.day == world["anchorDay"], "initial anchor mismatch")
        previous_date = history_date
        _require(history["started"] == [b["id"] for b in world["buildings"] if b["startMonth"] == index + 1],
                 "construction start history")
        _require(history["completed"] == [b["id"] for b in world["buildings"] if b["completionMonth"] == index + 1],
                 "construction completion history")
        for profile in PROFILES:
            _require(world["roleHistory"][profile][index]["month"] == history["month"], "resident history date")
    if previous_date is not None:
        _require(previous_date.isoformat() == world["month"], "current date differs from history")
    narrative_ids = {b["id"] for b in world["buildings"]
                     if b["status"] == "complete" and b["type"] != "station"}
    _require(set(world["narratives"]) == narrative_ids, "unexpected/missing narrative")
    for building in world["buildings"]:
        if building["status"] == "complete":
            _require(building["completedAt"] == world["constructionHistory"][building["completionMonth"] - 1]["month"],
                     "completion date differs from schedule")
    for group in world["groups"]:
        _require(group["id"].startswith("G") and group["id"][1:].isdigit()
                 and 0 < int(group["id"][1:]) < world["nextGroupId"], "group sequence mismatch")
    metrics = world["metrics"]
    _require(metrics["population"] == sum(g["size"] for g in world["groups"]), "population mismatch")
    _require(metrics["groups"] == len(world["groups"]), "group metric mismatch")
    for field in ("jobCapacity", "filledJobs", "vacancies", "monthlyProfit", "monthlyGDP"):
        _require(metrics[field] == sum(f[field] for f in world["firms"]), field + " metric mismatch")
    _require(metrics["totalGDP"] == sum(f["monthlyGDP"] * f["monthsAccrued"] for f in world["firms"]),
             "total GDP mismatch")
    _require(metrics["unemployedWorkers"] == sum(g["conditions"]["unemployedWorkers"] for g in world["groups"]),
             "unemployment metric mismatch")
    _require((metrics["meanSatisfaction"] is None) == (metrics["population"] == 0), "empty score must be null")
    expected_metrics_world = copy.deepcopy(world)
    _update_conditions(expected_metrics_world)
    _refresh_metrics(expected_metrics_world)
    _require(expected_metrics_world["metrics"] == metrics, "derived metrics mismatch")
    _require(expected_metrics_world["groups"] == world["groups"], "derived resident conditions mismatch")
    _require(expected_metrics_world["buildings"] == world["buildings"], "derived tower conditions mismatch")
    return None


def assert_invariants(world):
    """Validate the complete numerical state; malformed records raise ValueError."""
    try:
        if isinstance(world, dict) and world.get("model") == "hk-fiscal-v1":
            from . import fiscal_engine
            return fiscal_engine.validate(world)
        return _assert_invariants(world)
    except (KeyError, TypeError, AttributeError, OverflowError) as error:
        raise ValueError("world invariant: malformed state (" + type(error).__name__ + ")") from None

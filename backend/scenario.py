"""Government scripts and validated numerical parameters for the city engine.

Months are one-based offsets from the first simulation date.  These parameters
are illustrative synthetic HKD amounts, not calibrated economic observations.
"""

import copy
import math
from urllib.parse import urlsplit


BUILDING_TYPES = ("residential", "business", "park", "station")
PROFILES = ("budget", "work", "park", "stability")
FIRM_DEFAULTS = {
    "small": {
        "startingFunds": 1_000_000,
        "monthlyProfit": 50_000,
        "monthlyGDP": 100_000,
        "jobCapacity": 50,
        "wage": 15_000,
    },
    "large": {
        "startingFunds": 5_000_000,
        "monthlyProfit": 200_000,
        "monthlyGDP": 400_000,
        "jobCapacity": 200,
        "wage": 25_000,
    },
}


def default_scenario():
    """Return a fresh 50-home, 12-workplace, 10-park, 4-station script."""
    buildings = []
    # Independent code: a schematic district, without surveyed geography.
    homes = [(x, y) for y in (3, 5, 7, 9, 11) for x in range(3, 13)]
    for index, (x, y) in enumerate(homes):
        completion = 1 + index % 12
        buildings.append({
            "id": "R%02d" % (index + 1), "type": "residential", "x": x,
            "y": y, "startMonth": max(1, completion - 1),
            "completionMonth": completion,
        })
    for index in range(12):
        completion = index + 1
        buildings.append({
            "id": "B%02d" % (index + 1), "type": "business",
            "x": 4 + index % 6, "y": 4 if index < 6 else 8,
            "startMonth": max(1, completion - 1),
            "completionMonth": completion,
        })
    for index in range(10):
        completion = 1 + index
        buildings.append({
            "id": "P%02d" % (index + 1), "type": "park",
            "x": 3 + index % 5 * 2, "y": 6 if index < 5 else 10,
            "startMonth": completion, "completionMonth": completion,
        })
    for index, (x, y) in enumerate(((2, 4), (13, 4), (2, 10), (13, 10))):
        completion = 1 + index * 3
        buildings.append({
            "id": "S%02d" % (index + 1), "type": "station", "x": x,
            "y": y, "startMonth": completion,
            "completionMonth": completion,
        })
    return {
        "name": "Synthetic narrative district",
        "grid": {"width": 20, "height": 20, "cellSizeMeters": 100},
        "groupSize": 25, "groupWorkers": 15, "towerGroupSlots": 4,
        "baseRent": 4000, "rentPremium": 1000,
        "firms": copy.deepcopy(FIRM_DEFAULTS), "buildings": buildings,
    }


def northern_metropolis_scenario():
    """A schematic regional preset; each object is an aggregate planning cluster.

    The official population/jobs figures set reference scale only. Layout,
    construction pace, firm finances and simulated outcomes are synthetic.
    No cell, building or schedule represents a surveyed development project.
    """
    scenario = default_scenario()
    scenario.update(
        name="Synthetic Northern Metropolis regional development clusters",
        grid={"width": 12, "height": 11,
              "cellSizeMeters": math.sqrt(300_000_000 / 132)},
        groupSize=6250, groupWorkers=3750, towerGroupSlots=4,
    )
    # Five separated business groups make both clustering and nearby residents
    # relevant. Round-robin completion order develops all five areas gradually.
    business_blocks = [((1, 1), (2, 1), (1, 2), (2, 2)),
                       ((8, 1), (9, 1), (8, 2), (9, 2)),
                       ((5, 4), (6, 4), (5, 5), (6, 5)),
                       ((9, 7), (10, 7), (9, 8), (10, 8)),
                       ((2, 8), (3, 8), (2, 9), (3, 9))]
    business_cells = [block[index] for index in range(4) for block in business_blocks]
    park_cells = [(0, 3), (4, 1), (7, 3), (11, 4),
                  (0, 7), (4, 7), (7, 9), (11, 10)]
    station_cells = [(0, 0), (11, 0), (0, 10), (11, 8)]
    reserved = set(business_cells + park_cells + station_cells)
    buildings = []
    for index, (x, y) in enumerate(business_cells, 1):
        buildings.append({"id": "B%03d" % index, "type": "business", "x": x, "y": y,
                          "startMonth": max(1, index - 1), "completionMonth": index})
    for index, (x, y) in enumerate(park_cells):
        month = 1 + index * 20 // 7
        buildings.append({"id": "P%03d" % (index + 1), "type": "park", "x": x, "y": y,
                          "startMonth": max(1, month - 1), "completionMonth": month})
    for index, (x, y) in enumerate(station_cells):
        month = 1 + index * 20 // 3
        buildings.append({"id": "S%03d" % (index + 1), "type": "station", "x": x, "y": y,
                          "startMonth": month, "completionMonth": month})
    homes = [(x, y) for y in range(11) for x in range(12) if (x, y) not in reserved]
    for index, (x, y) in enumerate(homes, 1):
        buildings.append({"id": "R%03d" % index, "type": "residential", "x": x, "y": y,
                          "startMonth": 1, "completionMonth": 2})
    scenario["buildings"] = buildings
    for firm_type, job_capacity in (("small", 26000), ("large", 39000)):
        original = FIRM_DEFAULTS[firm_type]
        factor = job_capacity // original["jobCapacity"]
        preset = copy.deepcopy(original)
        for key in ("startingFunds", "monthlyProfit", "monthlyGDP"):
            preset[key] *= factor
        preset["jobCapacity"] = job_capacity
        scenario["firms"][firm_type] = preset
    scenario["scale"] = {
        "unit": "development_cluster",
        "label": "Synthetic aggregate regional development clusters, not literal towers",
        "referenceAreaKm2": 300,
        "referenceHousingCapacity": 2500000,
        "referenceJobs": 650000,
        "nominalJobsPerBusiness": 32500,
        "notes": [
            "All 132 schematic cells are aggregate planning objects, not surveyed buildings, parcels, stations or conservation areas.",
            "100 residential clusters each offer 25000 resident places when completed; actual population depends on independent AI arrivals and departures.",
            "Each resident group is 6250 people with 3750 potential workers; the 60% worker share is an assumption, not observed demographics.",
            "20 business clusters offer 26000 small-firm or 39000 large-firm jobs each; 650000 is the nominal midpoint, with a 520000 to 780000 possible total, not a forced outcome.",
            "Firm funds, profit and GDP scale from the small scenario in direct proportion to job capacity; these financial quantities remain synthetic, not measured regional GDP.",
            "Wages remain synthetic HKD per employed worker per month; residential rent remains synthetic HKD per resident per month.",
            "Unfilled modeled worker capacity is not measured regional unemployment; this sandbox omits other workplaces and labor-market movements.",
            "The grid approximates 300 square kilometres using equal square cells; geography, object proportions and 21 monthly construction steps are illustrative, not official locations or delivery dates.",
        ],
        "sources": [
            {"title": "Northern Metropolis Co-ordination Office: Vision",
             "url": "https://www.nm.gov.hk/en/about-nm/vision",
             "supports": ["referenceHousingCapacity", "referenceJobs"]},
            {"title": "InvestHK: Super-Connector to China and The World",
             "url": "https://www.investhk.gov.hk/en/why-hong-kong/super-connector-to-china-and-the-world/",
             "supports": ["referenceAreaKm2", "referenceHousingCapacity", "referenceJobs"]},
        ],
    }
    return apply_construction_pace(scenario, 5, 2, 1)


def _integer(value, name, minimum=0, maximum=None):
    if type(value) is not int or value < minimum:
        raise ValueError("%s must be an integer >= %s" % (name, minimum))
    if maximum is not None and value > maximum:
        raise ValueError("%s must be <= %s" % (name, maximum))
    return value


def _number(value, name, minimum=0, maximum=1e12):
    if (type(value) not in (int, float) or not minimum <= value <= maximum
            or not math.isfinite(value)):
        raise ValueError("%s must be a finite number between %s and %s" % (name, minimum, maximum))
    return value


def _metadata_text(value, name, maximum):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError("%s must be nonempty text of at most %d characters" % (name, maximum))
    try:
        value.encode("utf-8")
    except UnicodeError:
        raise ValueError(name + " must contain valid Unicode") from None


def _validate_scale(scale):
    fields = {"unit", "label", "referenceAreaKm2", "referenceHousingCapacity",
              "referenceJobs", "nominalJobsPerBusiness", "notes", "sources"}
    if not isinstance(scale, dict) or set(scale) != fields:
        raise ValueError("scale must contain exactly the documented reference/unit fields")
    if scale["unit"] not in ("building", "development_cluster"):
        raise ValueError("scale.unit must be building or development_cluster")
    _metadata_text(scale["label"], "scale.label", 300)
    _number(scale["referenceAreaKm2"], "scale.referenceAreaKm2", .001, 1e6)
    for key in ("referenceHousingCapacity", "referenceJobs", "nominalJobsPerBusiness"):
        _integer(scale[key], "scale." + key, 1, 1_000_000_000)
    if not isinstance(scale["notes"], list) or not 1 <= len(scale["notes"]) <= 20:
        raise ValueError("scale.notes must contain 1 to 20 explanatory strings")
    for note in scale["notes"]:
        _metadata_text(note, "scale.note", 2000)
    if not isinstance(scale["sources"], list) or not 1 <= len(scale["sources"]) <= 10:
        raise ValueError("scale.sources must contain 1 to 10 reference sources")
    supported = {"referenceAreaKm2", "referenceHousingCapacity", "referenceJobs"}
    for source in scale["sources"]:
        if not isinstance(source, dict) or set(source) != {"title", "url", "supports"}:
            raise ValueError("scale source must contain title, url, supports")
        _metadata_text(source["title"], "scale.source.title", 300)
        _metadata_text(source["url"], "scale.source.url", 2048)
        parsed = urlsplit(source["url"])
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or any(c.isspace() for c in source["url"])):
            raise ValueError("scale.source.url must be an HTTPS reference URL")
        if (not isinstance(source["supports"], list) or not source["supports"]
                or any(not isinstance(key, str) or key not in supported for key in source["supports"])
                or len(source["supports"]) != len(set(source["supports"]))):
            raise ValueError("scale.source.supports must list distinct reference field names")


def validate_scenario(config):
    """Normalize a partial JSON configuration, rejecting ambiguous scripts.

    Supplied building lists replace the default script.  Every object owns one
    cell for its whole scheduled lifetime; collisions are rejected before runs.
    """
    if not isinstance(config, dict) or any(not isinstance(key, str) for key in config):
        raise ValueError("scenario must be an object")
    normalized = default_scenario()
    unknown = set(config) - set(normalized) - {"scale", "fiscal"}
    if unknown:
        raise ValueError("unknown scenario fields: %s" % sorted(unknown))
    for key, value in config.items():
        if key not in ("grid", "firms"):
            normalized[key] = copy.deepcopy(value)
    if "scale" in normalized:
        _validate_scale(normalized["scale"])
    grid = config.get("grid", {})
    if not isinstance(grid, dict) or set(grid) - set(normalized["grid"]):
        raise ValueError("grid has unknown fields or is not an object")
    normalized["grid"].update(copy.deepcopy(grid))
    for dimension in ("width", "height"):
        _integer(normalized["grid"][dimension], "grid." + dimension, 1, 100)
    _number(normalized["grid"]["cellSizeMeters"], "grid.cellSizeMeters", 0.001)
    if not isinstance(normalized["name"], str) or not normalized["name"].strip():
        raise ValueError("name must be nonempty text")
    try:
        normalized["name"].encode("utf-8")
    except UnicodeError:
        raise ValueError("name must contain valid Unicode") from None
    _integer(normalized["groupSize"], "groupSize", 1, 10000)
    _integer(normalized["groupWorkers"], "groupWorkers", 1,
             normalized["groupSize"])
    _integer(normalized["towerGroupSlots"], "towerGroupSlots", 1, len(PROFILES))
    for key in ("baseRent", "rentPremium"):
        _number(normalized[key], key)
    supplied_firms = config.get("firms", {})
    if not isinstance(supplied_firms, dict) or set(supplied_firms) - {"small", "large"}:
        raise ValueError("firms must contain small and/or large presets")
    for firm_type, preset in supplied_firms.items():
        if not isinstance(preset, dict) or set(preset) - set(FIRM_DEFAULTS[firm_type]):
            raise ValueError("invalid %s firm preset" % firm_type)
        normalized["firms"][firm_type].update(copy.deepcopy(preset))
    for firm_type, preset in normalized["firms"].items():
        for key in ("startingFunds", "monthlyProfit", "monthlyGDP", "wage"):
            _number(preset[key], "firms.%s.%s" % (firm_type, key))
        _integer(preset["jobCapacity"], "firms.%s.jobCapacity" % firm_type, 1)
    if normalized["firms"]["large"]["wage"] <= normalized["firms"]["small"]["wage"]:
        raise ValueError("large firms must offer a higher wage than small firms")
    if not isinstance(normalized["buildings"], list):
        raise ValueError("buildings must be a list")
    identifiers, cells = set(), set()
    for building in normalized["buildings"]:
        if not isinstance(building, dict):
            raise ValueError("each scheduled building must be an object")
        required = {"id", "type", "x", "y", "completionMonth"}
        if not required <= set(building) or set(building) - required - {"startMonth"}:
            raise ValueError("scheduled building has missing or unknown fields")
        identifier = building["id"]
        if not isinstance(identifier, str) or not identifier.strip() or len(identifier) > 80:
            raise ValueError("building id must be nonempty text of at most 80 characters")
        try:
            identifier.encode("utf-8")
        except UnicodeError:
            raise ValueError("building id must contain valid Unicode") from None
        if identifier in identifiers:
            raise ValueError("duplicate building id: " + identifier)
        identifiers.add(identifier)
        if building["type"] not in BUILDING_TYPES:
            raise ValueError("unknown building type: %s" % building["type"])
        _integer(building["x"], "building.x", 0, normalized["grid"]["width"] - 1)
        _integer(building["y"], "building.y", 0, normalized["grid"]["height"] - 1)
        cell = (building["x"], building["y"])
        if cell in cells:
            raise ValueError("multiple objects scheduled in cell %s" % (cell,))
        cells.add(cell)
        _integer(building["completionMonth"], "completionMonth", 1, 1200)
        building.setdefault("startMonth", building["completionMonth"])
        _integer(building["startMonth"], "startMonth", 1, building["completionMonth"])
    normalized["buildings"].sort(key=lambda b: (
        b["completionMonth"], b["y"], b["x"], b["id"]))
    return normalized


def apply_construction_pace(config, residential_starts_per_month=4,
                            construction_months=2, interval_months=1):
    """Return a validated script with paced residential construction batches.

    Residential IDs determine a stable batch order, independent of the input
    list or old completion dates. Batch zero starts in month one; successive
    batches start ``interval_months`` apart. A duration of two means one month
    under construction, followed by completion in the next month. Nonresidential
    objects, locations and numerical parameters remain exactly as configured.

    The explicit government script changes only when this utility is invoked;
    AI has no control over the selected schedule. Export the returned config to
    retain the actual start and completion dates used by a run.
    """
    _integer(residential_starts_per_month, "residential_starts_per_month", 1)
    _integer(construction_months, "construction_months", 1, 1200)
    _integer(interval_months, "interval_months", 1, 1200)
    paced = validate_scenario(config)
    residences = sorted((b for b in paced["buildings"] if b["type"] == "residential"),
                        key=lambda b: b["id"])
    for index, residence in enumerate(residences):
        start = 1 + index // residential_starts_per_month * interval_months
        residence["startMonth"] = start
        residence["completionMonth"] = start + construction_months - 1
    return validate_scenario(paced)

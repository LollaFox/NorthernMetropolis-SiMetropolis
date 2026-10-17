"""Project canonical narrative state into the unchanged V3 frontend contract.

The raster is a synthetic flat square. Building footprints are zones, never
terrain elevations. Full narratives and bookkeeping stay in saved worlds.
"""
from __future__ import annotations

import math


GRID = 1000
SCHEMA = "nm-v3-draft-1"
LAND = {"residential": 4, "business": 5, "park": 3, "station": 2}
LIMITATIONS = [
    "Exploratory synthetic scenario; not a calibrated policy forecast or measured geography.",
    "The uploaded PDF is retained by digest only; its policy text is not interpreted. The configured construction script overrides the selected policy.",
    "A square schematic grid uses the requested northwest origin; it does not reproduce the selected rectangle's surveyed shape or scale.",
    "Terrain is flat synthetic zero metres. V3 draws footprint zones, not tower meshes or actual building heights.",
    "Road, rail-route, power-line and pollution layers are unmodeled; empty layers mean unavailable, not measured zero.",
    "Station objects affect the citywide commute formula but do not imply measured rail routes or passenger flows.",
    "Satisfaction is a synthetic weighted index; GDP and profit use preset firm coefficients and are not causal policy estimates.",
]


def snapshot(world, setup):
    """Return ordinary JSON arrays and closed integer polygons for V3."""
    grid = world["config"]["grid"]
    width, height = grid["width"], grid["height"]
    land = [1] * (GRID * GRID)
    zones = []
    groups = {}
    for group in world["groups"]:
        groups.setdefault(group["towerId"], []).append(group)
    firms = {firm["towerId"]: firm for firm in world["firms"]}
    for building in world["buildings"]:
        if building["status"] != "complete":
            continue
        x, y = building["x"], building["y"]
        # Fill a small inset footprint while keeping each logical cell distinct.
        x0, x1 = math.floor(x * GRID / width), math.floor((x + 1) * GRID / width)
        y0, y1 = math.floor(y * GRID / height), math.floor((y + 1) * GRID / height)
        inset = max(1, min(x1 - x0, y1 - y0) // 7)
        left, right = min(999, x0 + inset), min(999, max(x0 + inset + 1, x1 - inset - 1))
        top, bottom = min(999, y0 + inset), min(999, max(y0 + inset + 1, y1 - inset - 1))
        for row in range(top, bottom + 1):
            offset = row * GRID
            land[offset + left:offset + right + 1] = [LAND[building["type"]]] * (right - left + 1)
        residents = groups.get(building["id"], [])
        population = sum(g["size"] for g in residents)
        scored = [(g["conditions"].get("satisfaction"), g["size"]) for g in residents]
        satisfaction = (round(sum(score * size for score, size in scored) / population)
                        if population and all(score is not None for score, _ in scored) else None)
        firm = firms.get(building["id"])
        # The frontend sums categories: return filled positions only, never
        # capacity and vacancies as additive "jobs" categories.
        jobs = [{"type": "Filled positions (synthetic)", "count": firm["filledJobs"]}] if firm else []
        zones.append({"name": "Synthetic %s · %s" % (building["type"], building["id"]),
                      "type": building["type"], "population": population,
                      "satisfaction": satisfaction, "jobs": jobs,
                      "boundary": [[left, top], [right, top], [right, bottom], [left, bottom], [left, top]]})
    bounds = setup["bounds"]
    return {"schema": SCHEMA, "date": world["month"],
            "provenance": "synthetic-narrative-city-scenario", "limitations": list(LIMITATIONS),
            "grid": {"width": GRID, "height": GRID, "origin": "north-west", "order": "row-major",
                     "crs": "EPSG:4326", "originLonLat": [bounds["west"], bounds["north"]],
                     "heightUnit": "m", "cellSizeM": grid["cellSizeMeters"] * width / GRID},
            "height": {"dtype": "float32", "values": [0] * (GRID * GRID)},
            "landType": {"dtype": "int16", "values": land},
            "pollution": {"dtype": "int16", "values": [-1] * 20000},
            "roads": [], "mtr": [], "zones": zones, "powerLines": [],
            "scales": {"satisfaction": "Synthetic transparent 0–100 profile-weighted index; null means no resident assessment.",
                       "congestion": "Unavailable: no traffic or passenger-flow model."},
            "metrics": world["metrics"],
            **({"fiscal": world["fiscal"], "fiscalLimitations": world["fiscalLimitations"],
                "provenance": "hk-fiscal-v1-synthetic", "limitations": world["fiscalLimitations"],
                "construction": [{k:b.get(k) for k in ("id","type","status","startMonth","completionMonth","actualStart","actualCompletion")} for b in world["buildings"]]}
               if world.get("model") == "hk-fiscal-v1" else {})}

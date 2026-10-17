"""Offline core smoke checks using a temporary directory, never existing saves.

Run from the integrated project, or pass --source-root to verify an unpacked
release. No HTTP listener, browser, credential file or live provider is used.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import tempfile
import time
from unittest.mock import patch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    source = args.source_root.resolve()
    if not (source / "backend/service.py").is_file():
        parser.error("source-root must contain the backend package")
    sys.path.insert(0, str(source))

    from backend.ai import OfflineProvider
    from backend.cli import add_provider_arguments, configured_provider_factory
    from backend.server import SavedCity
    from backend.service import NarrativeService

    checks = 0

    def check(condition, message):
        nonlocal checks
        if not condition:
            raise AssertionError(message)
        checks += 1

    configuration = argparse.ArgumentParser()
    add_provider_arguments(configuration)
    factory = configured_provider_factory(configuration.parse_args([]))
    check(factory.configuration["provider"] == "offline", "Default provider must be offline")
    check(factory.configuration["credentialSlots"] == 0, "Offline default must not use credentials")
    check(factory.configuration["live"] is False, "Offline default cannot make live calls")

    scenario = {"grid": {"width": 3, "height": 3}, "groupSize": 10, "groupWorkers": 6,
                "towerGroupSlots": 4, "buildings": [
                    {"id": "R1", "type": "residential", "x": 0, "y": 0, "completionMonth": 1},
                    {"id": "B1", "type": "business", "x": 1, "y": 0, "completionMonth": 1},
                    {"id": "P1", "type": "park", "x": 0, "y": 1, "completionMonth": 2},
                    {"id": "S1", "type": "station", "x": 2, "y": 1, "completionMonth": 2}]}
    setup = {"bounds": {"west": 114, "south": 22.45, "east": 114.2, "north": 22.6},
             "start": "2024-11-30", "end": "2025-02-28", "step": "month",
             "policyScope": {"policyId": "offline-core-smoke", "tags": ["housing-affordability"]}}

    def forbidden(*_args, **_kwargs):
        raise AssertionError("A live provider must not be constructed")

    with patch("backend.ai.OpenAIProvider", side_effect=forbidden), patch("backend.ai.DeepSeekProvider", side_effect=forbidden):
        with tempfile.TemporaryDirectory(prefix="nm-backend-core-smoke-") as temporary:
            service = NarrativeService(temporary, provider_factory=OfflineProvider, scenario=scenario, today="2026-10-16")
            try:
                review = service.initialize(setup, b"%PDF-1.4\nSynthetic offline smoke only\n", "smoke.pdf", "smoke_init")
                check(any(item["id"] == "authority" and "instead" in item["value"] for item in review["items"]),
                      "Review must disclose that the configured script controls the run")
                check(any("not interpreted" in item["description"] for item in review["items"]),
                      "PDF parsing limitation must be disclosed")
                service.confirm(review["initializationId"], {"reviewVersion": review["reviewVersion"]}, "smoke_confirm")
                body = {"initializationId": review["initializationId"], "reviewVersion": review["reviewVersion"]}
                job = service.simulate(body, "smoke_run")
                deadline = time.monotonic() + 15
                while job["status"] in ("queued", "running") and time.monotonic() < deadline:
                    time.sleep(.01)
                    job = service.job(job["jobId"])
                check(job["status"] == "complete", "Offline simulation must complete")
                run = job["result"]
                exported = service.export(run["simulationId"])
                dates = [world["month"] for world in exported["monthlyStates"]]
                check(dates == ["2024-11-30", "2024-12-30", "2025-01-30", "2025-02-28"], "Canonical months retain the source day anchor")
                for world, totals in zip(exported["monthlyStates"], exported["monthlyBuildingTotals"]):
                    rows, metrics = totals["buildings"], world["metrics"]
                    check(sum(row["actualResidents"] for row in rows) == metrics["population"], "Resident totals reconcile")
                    check(sum(row["offeredJobs"] for row in rows) == metrics["jobCapacity"], "Offered jobs reconcile")
                    check(sum(row["filledJobs"] for row in rows) == metrics["filledJobs"], "Filled jobs reconcile")
                    check(sum(row["housingCapacity"] for row in rows) >= metrics["population"], "Resident places bound actual population")
                    check(metrics["filledJobs"] + metrics["vacancies"] == metrics["jobCapacity"], "Do not add filled jobs to offered jobs")
                city = SavedCity(service)
                first = city.state()
                check(first["world"]["sourceDate"] == dates[0], "Replay opens first saved canonical date")
                check([frame["month"] for frame in first["timeline"]] == [10, 11, 12, 13], "Legacy month indices remain continuous across years")
                latest = city.command("switch", {"id": run["simulationId"]})
                check(latest["world"]["sourceDate"] == dates[-1], "Switch returns latest saved source date")
                check(latest["world"]["year"] == 2025 and latest["world"]["month"] == 13, "Legacy year and cumulative month have separate meanings")
                check(latest["world"]["metrics"]["homes"] == exported["monthlyBuildingTotals"][-1]["buildings"][0]["housingCapacity"],
                      "Legacy homes is resident places, not housing units")
                check(latest["world"]["metrics"]["airQuality"] is None, "Unmodeled climate remains unavailable")
                older = city.command("seek", {"month": 11})
                check(older["world"]["sourceDate"] == "2024-12-30", "Seek resolves cumulative index to exact canonical date")
                check(service.export(run["simulationId"]) == exported, "Browsing does not alter canonical state or trigger new decisions")
                check(service.simulate(body, "smoke_run")["result"] == run, "Repeated run key reuses completed simulation")
            finally:
                service.close()
            restored = NarrativeService(temporary, provider_factory=forbidden, scenario=scenario)
            try:
                check(restored.export(run["simulationId"]) == exported, "Restart replays persisted states with no provider construction")
                check(restored.simulate(body, "smoke_run")["result"] == run, "Completed idempotent retry after restart invokes no provider")
            finally:
                restored.close()

    print(json.dumps({"status": "passed", "checks": checks, "provider": "offline",
                      "credentials": "not read", "network": "not used", "storage": "temporary directory only",
                      "sourceRoot": str(source), "canonicalDates": dates, "displayMonthIndices": [10, 11, 12, 13]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

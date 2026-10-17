"""Run the narrative city engine and retain monthly state plus call evidence."""

from __future__ import annotations

import argparse
import calendar
from datetime import date
import json
import math
from pathlib import Path
import sys
import threading
import time
import uuid

from .ai import DEFAULT_MODEL, OfflineProvider, OpenAIProvider
from .storage import atomic_write_json, write_monthly_state


def add_provider_arguments(parser):
    parser.add_argument("--provider", choices=("offline", "openai", "deepseek"),
                        help="Provider for this run only; default offline, or OpenAI with legacy --live")
    parser.add_argument("--live", action="store_true", help="Legacy explicit OpenAI mode; equivalent to --provider openai")
    parser.add_argument("--model", help="Model for this run only; default chosen by provider")
    parser.add_argument("--api-key-file", type=Path, action="append", default=[],
                        help="DeepSeek credential file; repeat twice to share one model/run across two keys")
    parser.add_argument("--timeout", type=float, help="Seconds per request; default 180 for DeepSeek, 45 for OpenAI")
    parser.add_argument("--retries", type=int, default=2, help="Retries per transient live request failure")


def configured_provider_factory(args):
    """Read explicitly authorized key files silently at application startup.

    The returned closure holds credentials in memory only. Its public config
    contains no key values or credential paths and may be saved as evidence.
    """
    name = args.provider or ("openai" if args.live else "offline")
    if args.live and name == "offline":
        raise ValueError("--live conflicts with --provider offline")
    paths = args.api_key_file
    if paths and name != "deepseek":
        raise ValueError("--api-key-file is available only with explicit --provider deepseek")
    if len(paths) > 2:
        raise ValueError("Use one or two DeepSeek credential files")
    if type(args.retries) is not int or not 0 <= args.retries <= 5:
        raise ValueError("Retries must be zero through five")
    timeout = args.timeout if args.timeout is not None else (180.0 if name == "deepseek" else 45.0)
    if type(timeout) not in (int, float) or not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("Timeout must be a finite positive number")
    keys = []
    for path in paths:
        try:
            if path.stat().st_size > 8192:
                raise ValueError()
            value = path.read_text(encoding="utf-8").strip()
            if not value or len(value) > 4096 or any(c in value for c in "\r\n\x00"):
                raise ValueError()
        except (OSError, UnicodeError, ValueError):
            raise ValueError("A credential file could not be read as a single nonempty UTF-8 key") from None
        keys.append(value)
    if len(keys) == 2 and keys[0] == keys[1]:
        raise ValueError("Two credential slots require distinct keys")
    if name == "deepseek":
        from .ai import DEFAULT_DEEPSEEK_MODEL
        model = args.model or DEFAULT_DEEPSEEK_MODEL
        def factory():
            from .ai import DeepSeekProvider, DualKeyProvider
            providers = [DeepSeekProvider(model=model, api_key=key, timeout=timeout, retries=args.retries)
                         for key in keys] if keys else [DeepSeekProvider(model=model, timeout=timeout, retries=args.retries)]
            return DualKeyProvider(providers) if len(providers) == 2 else providers[0]
    elif name == "openai":
        model = args.model or DEFAULT_MODEL
        def factory():
            return OpenAIProvider(model=model, timeout=timeout, retries=args.retries)
    else:
        model = "deterministic-fixture"
        factory = OfflineProvider
    # A class default should not be modified with per-run metadata.
    make_provider = lambda: factory()
    make_provider.configuration = {"provider": name, "model": model, "live": name != "offline",
                                   "credentialSlots": len(keys) or (1 if name != "offline" else 0),
                                   "timeout": timeout, "retries": args.retries}
    return make_provider


def add_pacing_arguments(parser):
    parser.add_argument("--residential-starts-per-month", type=int,
                        help="Explicitly replace residential construction dates with paced batches")
    parser.add_argument("--construction-months", type=int,
                        help="Residential duration when applying pacing; default two months")
    parser.add_argument("--construction-interval-months", type=int,
                        help="Months between paced residential batches; default one")


def add_scenario_arguments(parser):
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--scenario", type=Path, help="Government script and parameters in local JSON")
    group.add_argument("--preset", choices=("demo", "northern-metropolis"),
                       help="Explicit scenario preset; default demo, preserving the original script")


def configured_scenario(args):
    from .scenario import apply_construction_pace, default_scenario, northern_metropolis_scenario, validate_scenario
    preset = getattr(args, "preset", None)
    if args.scenario and preset is not None:
        raise ValueError("Choose either --scenario or --preset")
    scenario = (json.loads(Path(args.scenario).read_text(encoding="utf-8")) if args.scenario else
                northern_metropolis_scenario() if preset == "northern-metropolis" else default_scenario())
    scenario = validate_scenario(scenario)
    if any(value is not None for value in (args.residential_starts_per_month, args.construction_months, args.construction_interval_months)):
        scenario = apply_construction_pace(scenario,
            residential_starts_per_month=args.residential_starts_per_month if args.residential_starts_per_month is not None else 4,
            construction_months=args.construction_months if args.construction_months is not None else 2,
            interval_months=args.construction_interval_months if args.construction_interval_months is not None else 1)
    return scenario


def default_run_end(start, scenario):
    """The explicit regional preset covers its full construction script."""
    if scenario.get("scale", {}).get("unit") != "development_cluster":
        return "2025-12-01"
    first = date.fromisoformat(start)
    months = max((building["completionMonth"] for building in scenario["buildings"]), default=1)
    year, month0 = divmod(first.year * 12 + first.month - 1 + months - 1, 12)
    return date(year, month0 + 1, min(first.day, calendar.monthrange(year, month0 + 1)[1])).isoformat()


def monthly_dates(start, end):
    """Calendar-month steps retain the original anchor day after clamping."""
    first = date.fromisoformat(start)
    last = date.fromisoformat(end)
    if last < first:
        raise ValueError("End date must not precede start date")
    offset = 0
    while True:
        absolute = first.year * 12 + first.month - 1 + offset
        year, month0 = divmod(absolute, 12)
        if year > 9999:
            break
        day = min(first.day, calendar.monthrange(year, month0 + 1)[1])
        current = date(year, month0 + 1, day)
        if current > last:
            break
        yield current.isoformat()
        offset += 1


def _save_json(path, value):
    return atomic_write_json(path, value)


def run(provider, start="2025-01-01", end="2025-12-01", scenario=None, output=None):
    """Persist checkpoints after each successful month; never overwrite a run."""
    from .engine import advance_month, assert_invariants, create_world
    from .scenario import default_scenario, validate_scenario
    from .service import building_totals_export

    dates = list(monthly_dates(start, end))
    config = validate_scenario(default_scenario() if scenario is None else scenario)
    destination = Path(output) if output else Path(__file__).parent / ".data" / "cli" / uuid.uuid4().hex
    destination.mkdir(parents=True, exist_ok=False)
    states_dir = destination / "states"
    states_dir.mkdir()
    world = create_world(config)
    _save_json(destination / "scenario.json", config)
    _save_json(destination / "initial.json", world)
    completed = []
    state_storage = {}
    building_totals = []
    started = time.monotonic()
    status = "running"
    failure = None
    writes = threading.RLock()
    progress = {"status": "running", "completedMonths": [], "activeMonth": None}
    def persist_metrics(_row=None):
        with writes:
            _save_json(destination / "calls.json", provider.metrics)
            _save_json(destination / "metrics.json", provider.metrics_summary())
            _save_json(destination / "status.json", {**progress, "completedMonths": list(completed),
                                                     "elapsedMs": round((time.monotonic() - started) * 1000, 3),
                                                     "ai": provider.metrics_summary()})
    if hasattr(provider, "set_metrics_callback"):
        provider.set_metrics_callback(persist_metrics)
    try:
        with (destination / "audit.jsonl").open("w", encoding="utf-8") as audit:
            for month in dates:
                progress["activeMonth"] = month
                persist_metrics()
                world = advance_month(world, provider, month)
                assert_invariants(world)
                state_storage[month] = write_monthly_state(states_dir, month, world)
                completed.append(month)
                building_totals.append(building_totals_export(world))
                atomic_write_json(destination / "building-totals.json.gz",
                                  {"scale": config.get("scale"), "months": building_totals}, compress=True)
                row = {"date": month, "month": world.get("month"),
                       "metrics": world.get("metrics", {}),
                       "events": world.get("events", []),
                       "audit": world.get("audit", []),
                       "roleHistory": world.get("roleHistory", world.get("role_history", {}))}
                audit.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
                audit.flush()
                persist_metrics()
        status = "completed"
    except Exception as exc:
        status = "failed"
        failure = type(exc).__name__
    summary = {"status": status, "sourceType": provider.source_type,
               "provider": provider.provider, "model": provider.model,
               "requestedStart": start, "requestedEnd": end,
               "completedMonths": completed, "elapsedMs": round((time.monotonic() - started) * 1000, 3),
               "metrics": world.get("metrics", {}), "ai": provider.metrics_summary(),
               "scale": config.get("scale"), "stateStorage": state_storage,
               "buildingTotalsFile": "building-totals.json.gz",
               "output": str(destination.resolve()),
               "notice": "Synthetic exploratory scenario; not a validated forecast."}
    if failure:
        summary["failureType"] = failure
    progress["status"] = status
    progress["activeMonth"] = None
    persist_metrics()
    _save_json(destination / "summary.json", summary)
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    add_scenario_arguments(parser)
    parser.add_argument("--start", default="2025-01-01")
    parser.add_argument("--end", help="Default 2025-12-01 for demo; full construction duration for the regional preset")
    parser.add_argument("--output", type=Path, help="New directory for state, audit and metrics")
    add_provider_arguments(parser)
    add_pacing_arguments(parser)
    args = parser.parse_args(argv)
    try:
        scenario = configured_scenario(args)
        provider = configured_provider_factory(args)()
        summary = run(provider, args.start, args.end or default_run_end(args.start, scenario), scenario, args.output)
    except Exception as exc:
        # Provider messages and user paths could include private material. Only
        # expose an error class here; validated run artifacts contain safe fields.
        print(json.dumps({"status": "failed", "failureType": type(exc).__name__}), file=sys.stderr)
        return 1
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary["status"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())

"""Government-only model decisions over the two fixed fiscal layouts."""
import argparse
import csv
import json
from pathlib import Path

from . import hk_minimal
from .cli import add_provider_arguments, configured_provider_factory
from .storage import atomic_write_json


def dry_decision(context):
    """Explicit test fixture, never represented as a model decision."""
    budget = context["budget"]
    chosen = []
    for project in context["eligibleProjects"]:
        if project["cost"] <= budget and len(chosen) < context["freeConstructionSlots"]:
            chosen.append(project["id"])
            budget -= project["cost"]
    return {"startProjects": chosen, "reason": "OFFLINE TEST: start affordable projects in fixed order."}


def run_layout(config, layout, folder, provider=None):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=False)
    mode = "live_government_only" if provider is not None else "offline_test_not_ai"
    audit = []
    def save(name, value):
        atomic_write_json(folder / name, value)
    save("config.json", config)
    def decide(context):
        record = {"context": context, "status": "requesting", "mode": mode}
        audit.append(record)
        save("decisions.json", audit)
        answer = provider.call("government", context) if provider is not None else dry_decision(context)
        record.update(response=answer, status="received_pending_engine_validation")
        save("decisions.json", audit)
        return answer
    def completed(result):
        audit[-1]["status"] = "executed"
        save("decisions.json", audit)
        save("result.json", result)
        save("status.json", {"status": "running", "mode": mode, "completedMonths": len(result["monthly"])})
    save("status.json", {"status": "running", "mode": mode, "completedMonths": 0})
    try:
        result = hk_minimal.run(config, layout, government=decide, on_month=completed)
    except Exception as exc:
        if audit:
            audit[-1]["status"] = "failed_month_not_committed"
            save("decisions.json", audit)
        save("status.json", {"status": "failed", "mode": mode,
                             "errorType": type(exc).__name__,
                             "completedMonths": sum(r["status"] == "executed" for r in audit)})
        raise RuntimeError("Government run failed; inspect status.json and decisions.json. No rule fallback was used.") from None
    finally:
        if provider is not None:
            save("provider-metrics.json", provider.metrics_summary())
    with (folder / "monthly.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=result["monthly"][0])
        writer.writeheader()
        writer.writerows(result["monthly"])
    save("status.json", {"status": "complete", "mode": mode,
                         "completedMonths": len(result["monthly"]),
                         "completedProjects": sum(b["status"] == "complete" for b in result["buildings"]),
                         "plannedProjects": len(result["buildings"])})
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    add_provider_arguments(parser)
    parser.add_argument("--dry-run", action="store_true", help="Explicit offline test, NOT model decisions")
    parser.add_argument("--layout", choices=("segregated", "mixed", "both"), default="both")
    parser.add_argument("--months", type=int, default=24)
    parser.add_argument("--config", type=Path, help="Optional hk_minimal fiscal settings JSON")
    parser.add_argument("--output", type=Path, required=True, help="Use a new output directory per experiment")
    args = parser.parse_args(argv)
    live = (args.provider or ("openai" if args.live else "offline")) != "offline"
    if args.dry_run and (live or args.api_key_file):
        parser.error("--dry-run cannot use a live provider or credentials")
    if not args.dry_run and not live:
        parser.error("Choose --provider deepseek/openai for real calls, or explicitly --dry-run")
    config = json.loads(args.config.read_text(encoding="utf-8-sig")) if args.config else hk_minimal.demo_config()
    config["months"] = args.months
    hk_minimal.validate(config)
    layouts = ("segregated", "mixed") if args.layout == "both" else (args.layout,)
    if any((args.output / layout).exists() for layout in layouts):
        parser.error("Output already exists; use a new directory to preserve previous experiments")
    factory = configured_provider_factory(args) if not args.dry_run else None
    for layout in layouts:
        result = run_layout(config, layout, args.output / layout, factory() if factory else None)
        count = sum(b["status"] == "complete" for b in result["buildings"])
        print(f"{layout}: {args.months} months, {count}/6 projects completed; "
              + ("LIVE government only" if factory else "OFFLINE TEST, NOT AI"))


if __name__ == "__main__":
    main()

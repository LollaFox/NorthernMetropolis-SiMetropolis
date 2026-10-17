"""Explicit paid smoke only. Never discovered by the regular test runner.

The user approved at most six calls for this test flight. This script permits
four, leaving two reserved for an explicitly inspected repair if required.
"""
from pathlib import Path
import json
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from sandbox.ai import Provider
from sandbox.service import CityService


def main():
    provider = Provider()
    if not provider.available:
        raise SystemExit("Existing provider is not available; no call made")
    city = CityService(provider=provider, live_limit=4)
    try:
        city.command("control", {"speed": 2})
        city.command("mode", {"mode": "live"})
        deadline = time.monotonic() + 95
        while time.monotonic() < deadline:
            state = city.state()
            if state["ai"]["status"] == "error":
                break
            if len(state["ai"]["attempts"]) == 4 and not city._pending:
                break
            time.sleep(0.2)
        city.command("control", {"playing": False})
        state = city.state()
        report = {"description": "Actual bounded provider smoke, synthetic city only; not a quality benchmark",
                  "provider": provider.provider, "model": provider.model, "ai": state["ai"],
                  "month": state["world"]["month"], "metrics": state["world"]["metrics"],
                  "liveMessages": [m for m in state["world"]["messages"] if m["sourceType"] == "live"]}
        target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/private/tmp/sandbox-v2-live-smoke.json")
        target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"provider": provider.provider, "model": provider.model,
                          "requests": state["ai"]["requests"], "attempts": len(state["ai"]["attempts"]),
                          "errors": state["ai"]["errors"], "liveMessages": len(report["liveMessages"]),
                          "evidence": str(target)}))
        return 0 if len(state["ai"]["attempts"]) == 4 and state["ai"]["errors"] == 0 and len(report["liveMessages"]) >= 4 else 1
    finally:
        city.close()


if __name__ == "__main__":
    raise SystemExit(main())

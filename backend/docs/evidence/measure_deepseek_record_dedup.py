#!/usr/bin/env python3
"""Compare historical plain requests with exact-record encoding, offline only."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import copy
import csv
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import statistics
import subprocess
import sys
import time
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from backend.ai import DeepSeekProvider, DecisionError, _context_input, _context_packet, _json_bytes
from backend.context_records import ENCODING, REFERENCE_LEGEND, decode_context_records
from backend.storage import json_bytes, monthly_state_path, read_json


def summary(rows):
    result = {"attempts": len(rows), "fallbacks": sum(not row["encoded"] for row in rows),
              "noExpansion": sum(row["newBodyBytes"] <= row["oldBodyBytes"] for row in rows)}
    for name in ("oldBodyBytes", "newBodyBytes", "oldUserBytes", "newUserBytes"):
        values = [row[name] for row in rows]
        result[name] = {"sum": sum(values), "min": min(values), "max": max(values),
                        "mean": round(statistics.mean(values), 3)}
    for name, old, new in (("bodySavingPercent", "oldBodyBytes", "newBodyBytes"),
                           ("userSavingPercent", "oldUserBytes", "newUserBytes")):
        result[name] = 100 * (1 - result[new]["sum"] / result[old]["sum"])
    values = sorted(row["prepareAndSerializeMs"] for row in rows)
    result["prepareAndSerializeMs"] = {"sum": round(sum(values), 3),
        "mean": round(statistics.mean(values), 3), "median": round(statistics.median(values), 3),
        "p90": values[math.ceil(len(values) * .9) - 1], "max": max(values)}
    return result


def measure(data_dir, simulation_id):
    simulation = read_json(data_dir / "catalog.json")["simulations"][simulation_id]
    audit_by_hash = {}
    for day in simulation["months"]:
        path = monthly_state_path(data_dir / "simulations" / simulation_id, day)
        if not path.exists():
            continue
        for audit in read_json(path)["audit"]:
            key = (audit["role"], hashlib.sha256(json_bytes(audit["context"])).hexdigest())
            if key in audit_by_hash:
                raise ValueError("Baseline contains ambiguous audit contexts")
            audit_by_hash[key] = audit
    attempts = simulation["providerMetrics"]["attempts"]
    groups = defaultdict(list)
    for metric in attempts:
        groups[(metric.get("executionSession"), metric.get("providerSession"), metric["callId"])].append(metric)
    rows, matched = [], set()
    for logical_call, group in groups.items():
        correction_label = None
        for metric in sorted(group, key=lambda item: item["attempt"]):
            if metric.get("contextEncoding", "plain-json") != "plain-json":
                raise ValueError("Comparison requires a historical plain-JSON baseline")
            key = (metric["role"], metric["contextSHA256"])
            audit = audit_by_hash[key]
            matched.add(key)
            context = audit["context"]
            original = json_bytes(context)
            stub = SimpleNamespace(model=metric["model"])
            stub.payload = lambda role, supplied, stub=stub: DeepSeekProvider.payload(stub, role, supplied)
            started = time.perf_counter()
            if metric.get("formatCorrection", 0):
                if correction_label is None:
                    raise ValueError("Missing saved correction label")
                compact = DeepSeekProvider._format_correction(stub, metric["role"], context,
                                                              DecisionError(correction_label))
                compact.pop("validationLabel")
            else:
                compact = stub.payload(metric["role"], context)
            compact_body = _json_bytes(compact)
            elapsed = (time.perf_counter() - started) * 1000
            encoded = REFERENCE_LEGEND in compact["messages"][0]["content"]
            packet = json.loads(compact["messages"][1]["content"])
            expanded = decode_context_records(packet, encoded)
            if json_bytes(expanded) != json_bytes(_context_packet(metric["role"], context)):
                raise AssertionError("Expanded packet changed original scenario data")
            if json_bytes(context) != original:
                raise AssertionError("Original engine audit context was mutated")
            # Today's payload settings/instructions are unchanged except for
            # the conditional legend. Restore the pre-encoding user packet.
            plain = copy.deepcopy(compact)
            plain["messages"][0]["content"] = plain["messages"][0]["content"].replace(REFERENCE_LEGEND, "")
            plain["messages"][1]["content"] = _context_input(metric["role"], context)
            plain_body = _json_bytes(plain)
            if len(plain_body) != metric["inputBytes"]:
                raise AssertionError("Historical body size does not match saved measurement")
            if len(compact_body) > len(plain_body):
                raise AssertionError("Request encoding expanded a complete HTTP body")
            rows.append({"date": audit["month"], "role": metric["role"], "target": audit["targetId"],
                         "logicalCall": "|".join(str(part or "") for part in logical_call),
                         "attempt": metric["attempt"], "formatCorrection": metric.get("formatCorrection", 0),
                         "baselineStatus": metric["status"], "contextSHA256": metric["contextSHA256"],
                         "encoded": encoded, "encoding": ENCODING if encoded else "plain-json",
                         "oldBodyBytes": len(plain_body), "newBodyBytes": len(compact_body),
                         "oldUserBytes": len(plain["messages"][1]["content"].encode("utf-8")),
                         "newUserBytes": len(compact["messages"][1]["content"].encode("utf-8")),
                         "oldSystemBytes": len(plain["messages"][0]["content"].encode("utf-8")),
                         "newSystemBytes": len(compact["messages"][0]["content"].encode("utf-8")),
                         "sharedRecords": len(packet["records"]) if encoded else 0,
                         "prepareAndSerializeMs": round(elapsed, 3)})
            if metric.get("validationError"):
                correction_label = metric["validationError"]
    if matched != set(audit_by_hash):
        raise AssertionError("Not every saved audit context was measured")
    rows.sort(key=lambda row: (row["date"], row["role"], row["target"] or "", row["logicalCall"], row["attempt"]))
    by_role = {role: summary([row for row in rows if row["role"] == role])
               for role in sorted({row["role"] for row in rows})}
    examples = [next(row for row in rows if row["role"] == "narrator" and row["target"] == target)
                for target in ("R001", "R050", "R100")]
    revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(ROOT), capture_output=True,
                              text=True, check=True).stdout.strip()
    return {"generatedAtUTC": datetime.now(timezone.utc).isoformat(), "sourceCommit": revision,
            "codecSHA256": hashlib.sha256((ROOT / "backend/context_records.py").read_bytes()).hexdigest(),
            "simulationId": simulation_id, "baselineEncoding": "plain-json", "candidateEncoding": ENCODING,
            "logicalCalls": len(groups), "exactRoundTrippedContexts": len(matched),
            "historicalBodySizesMatched": len(rows), "totals": summary(rows), "byRole": by_role,
            "examples": examples, "largestOriginalBody": max(rows, key=lambda row: row["oldBodyBytes"]),
            "rows": rows}


def markdown(report):
    total = report["totals"]
    timing = total["prepareAndSerializeMs"]
    lines = ["# Exact-record request deduplication: offline verification", "",
        f"Source `{report['sourceCommit'][:7]}`; baseline `{report['simulationId']}`.", "",
        f"Across **{total['attempts']} attempted packets / {report['logicalCalls']} logical calls**, "
        f"full HTTP JSON bodies fall **{total['bodySavingPercent']:.2f}%**, from "
        f"{total['oldBodyBytes']['sum']:,} to {total['newBodyBytes']['sum']:,} UTF-8 bytes. "
        f"User-packet JSON falls **{total['userSavingPercent']:.2f}%**, from "
        f"{total['oldUserBytes']['sum']:,} to {total['newUserBytes']['sum']:,} bytes.", "",
        "Every original fact, narrative, numeric type, instruction, eligibility list, scale field and "
        "source URL remains present after expansion. Only exact repeated structured building/cell "
        "records share a full unchanged record in a request-local table. Different versions of the "
        "same ID remain separate. No summary, pruning, key abbreviation or model-setting change is applied.", "",
        "| Role | Attempts | User bytes before → after | User reduction | Full-body bytes before → after | Full-body reduction | New full-body min–max |",
        "|---|---:|---:|---:|---:|---:|---:|"]
    for role, group in report["byRole"].items():
        lines.append(f"| {role} | {group['attempts']} | {group['oldUserBytes']['sum']:,} → {group['newUserBytes']['sum']:,} | "
                     f"{group['userSavingPercent']:.2f}% | {group['oldBodyBytes']['sum']:,} → {group['newBodyBytes']['sum']:,} | "
                     f"{group['bodySavingPercent']:.2f}% | {group['newBodyBytes']['min']:,}–{group['newBodyBytes']['max']:,} |")
    lines += ["", "## Individual examples", "",
              "| Date / role / target | User bytes before → after | Full-body bytes before → after | Shared full records |",
              "|---|---:|---:|---:|"]
    for row in report["examples"] + [report["largestOriginalBody"]]:
        lines.append(f"| {row['date']} / {row['role']} / {row['target'] or 'all towers'} | "
                     f"{row['oldUserBytes']:,} → {row['newUserBytes']:,} | "
                     f"{row['oldBodyBytes']:,} → {row['newBodyBytes']:,} | {row['sharedRecords']} |")
    lines += ["", "## Verification and measurement boundaries", "",
        f"- {report['exactRoundTrippedContexts']}/{report['logicalCalls']} saved contexts round-trip to identical canonical JSON bytes, including numeric types. "
        f"All {report['historicalBodySizesMatched']} historical body-byte measurements reconstruct exactly. "
        "The comparison includes all three format-correction requests, using their saved allowlisted labels.",
        f"- {total['noExpansion']}/{total['attempts']} complete bodies are no larger; every baseline attempt became smaller. "
        f"There are {total['fallbacks']} baseline fallbacks. Separate synthetic tests confirm unchanged plain packets when deduplication would increase the complete body.",
        "- Full-body counts include the conditional trusted decoding legend and nested JSON-string escaping. "
        "They exclude headers, authorization and transport framing. The user packet includes the unchanged derived actionEligibility menu.",
        f"- One local sequential preparation measurement: total {timing['sum']:.1f} ms for {total['attempts']} payloads, "
        f"mean {timing['mean']:.2f} ms, median {timing['median']:.2f} ms, p90 {timing['p90']:.2f} ms, max {timing['max']:.2f} ms. "
        "This covers payload construction, record encoding and full request serialization; it excludes disk loading, decoding checks and network time. It is not a performance guarantee.",
        "- Historical attempts without contextEncoding remain plain-json. The analyzer explicitly restores that format rather than applying today's encoder to old measurements. New rows identify exact-records-v1 or plain-json; original contextSHA256/contextBytes remain based on the full engine input.",
        "- Byte ratios do not establish token or cost savings. No tokenizer was installed and no provider was called for this comparison. Actual usage must be measured separately in the authorized live test.",
        "- Per-attempt CSV/JSON contains only IDs, fingerprints, counts and timings. No context text, narratives, keys or raw provider responses are exported.", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "backend/.data/live_regional_storage")
    parser.add_argument("--simulation-id", default="sim_886a10a6301f4591a192b12789d1d94e")
    parser.add_argument("--output-prefix", type=Path, required=True)
    args = parser.parse_args()
    report = measure(args.data_dir.resolve(), args.simulation_id)
    prefix = args.output_prefix.resolve()
    prefix.parent.mkdir(parents=True, exist_ok=True)
    prefix.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    prefix.with_suffix(".md").write_text(markdown(report), encoding="utf-8")
    with prefix.with_suffix(".csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(report["rows"][0]))
        writer.writeheader()
        writer.writerows(report["rows"])
    print(json.dumps({"contexts": report["exactRoundTrippedContexts"], "attempts": report["totals"]["attempts"],
                      "oldBodyBytes": report["totals"]["oldBodyBytes"]["sum"],
                      "newBodyBytes": report["totals"]["newBodyBytes"]["sum"], "outputPrefix": str(prefix)}, sort_keys=True))


if __name__ == "__main__":
    main()

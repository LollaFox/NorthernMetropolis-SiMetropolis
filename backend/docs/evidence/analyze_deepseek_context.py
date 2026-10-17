#!/usr/bin/env python3
"""Read-only request accounting from saved metrics and hydrated engine audits.

No provider is constructed; no credentials, network, or raw text are exported.
Run from any directory. Outputs are aggregate JSON, one CSV row per attempt,
and a Markdown report. --self-test runs synthetic accounting checks only.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys
from types import SimpleNamespace
import unittest


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from backend.ai import DeepSeekProvider, DecisionError, RESIDENT_ROLES, _context_input
from backend.context_records import ENCODING, REFERENCE_LEGEND, decode_context_records
from backend.storage import read_json, monthly_state_path


USAGE_FIELDS = ("input_tokens", "output_tokens", "total_tokens",
                "input_cache_hit_tokens", "input_cache_miss_tokens", "reasoning_tokens")
SIZE_FIELDS = ("inputBytes", "contextBytes", "systemPromptBytes", "userContextBytes",
               "answerTextChars", "answerTextBytes", "reasoningTextChars", "reasoningTextBytes",
               "responseJsonChars", "responseJsonBytes", "responseActionCount", "latencyMs")
CATEGORIES = {
    "record_encoding": "Exact-record envelope and reference syntax",
    "shared_record_facts": "Complete shared record facts, excluding narrative text",
    "json_structure": "Root JSON delimiters",
    "narratives": "Place narratives repeated across target, neighborhood and construction facts",
    "neighborhood_facts": "Exact 3×3 cell and neighboring object facts, excluding narrative text",
    "target_facts": "Target object facts, excluding narrative text",
    "resident_conditions": "Per-tower wages, employment, rent, quality, commute and satisfaction",
    "resident_occupancy": "Per-tower occupancy and the profile's existing group",
    "tower_index_eligibility": "Tower IDs and source eligibleActions lists",
    "resident_history": "Previous six profile decisions and outcomes, including their reasons",
    "construction_history": "Recent completed/started construction history, including any nested prose",
    "construction_facts": "Current started/completed/active construction facts, excluding narrative text",
    "firm_facts": "Current firm records, capacities and synthetic financial facts",
    "city_metrics": "Current city-wide numerical metrics",
    "scale_metadata": "Aggregate-cluster scale, references, notes and source metadata",
    "rules_preferences": "Engine instructions, preferences, formula definitions and canonical rules",
    "time_profile": "Month, step, profile and fixed cohort/worker/slot sizes",
    "derived_eligibility_menu": "Provider-added tower ID → allowed actions menu",
    "other_context": "Other supplied context fields",
}


def encoded(value, canonical=False):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=canonical,
                      separators=(",", ":")).encode("utf-8")


def digest(value):
    return hashlib.sha256(encoded(value, True)).hexdigest()


def category(path):
    if not path:
        return "json_structure"
    root = path[0]
    if root == "context":
        return category(path[1:])
    if root == "encoding" or "$record" in path or "$literal" in path:
        return "record_encoding"
    if root == "records":
        return "narratives" if "narrative" in path else "shared_record_facts"
    if root == "history":
        return "resident_history"
    if root == "construction" and len(path) > 1 and path[1] == "recent":
        return "construction_history"
    if root == "scale":
        return "scale_metadata"
    if root in ("instructions", "preferences", "satisfactionModel", "canonicalFacts"):
        return "rules_preferences"
    if root in ("month", "step", "profile", "groupSize", "groupWorkers", "towerGroupSlots"):
        return "time_profile"
    if root == "actionEligibility":
        return "derived_eligibility_menu"
    if "narrative" in path:
        return "narratives"
    if root == "city":
        return "city_metrics"
    if root == "firms":
        return "firm_facts"
    if "neighborhood" in path:
        return "neighborhood_facts"
    if "conditions" in path:
        return "resident_conditions"
    if "occupancy" in path:
        return "resident_occupancy"
    if "target" in path:
        return "target_facts"
    if root == "construction":
        return "construction_facts"
    if "towerId" in path or "eligibleActions" in path:
        return "tower_index_eligibility"
    return "other_context"


def components(value):
    """Allocate each compact JSON byte once, including keys and delimiters."""
    totals = Counter()

    def visit(item, path=()):
        parent = category(path)
        if isinstance(item, dict):
            totals[parent] += 2
            for index, (key, child) in enumerate(item.items()):
                child_path = path + (key,)
                totals[category(child_path)] += len(encoded(key)) + 1 + bool(index)
                visit(child, child_path)
        elif isinstance(item, list):
            totals[parent] += 2
            for index, child in enumerate(item):
                child_path = path + (index,)
                totals[category(child_path)] += bool(index)
                visit(child, child_path)
        else:
            totals[parent] += len(encoded(item))

    visit(value)
    if sum(totals.values()) != len(encoded(value)):
        raise AssertionError("Context component byte accounting is not exhaustive")
    return dict(totals)


def repetition(value):
    """Exact local repetition evidence, not a token or optimization estimate."""
    narrative_occurrences = []
    seen_subtrees = set()
    repeated_bytes = repeated_nodes = 0

    def prose(item):
        if isinstance(item, dict):
            for key, child in item.items():
                if key == "narrative" and isinstance(child, str) and child:
                    narrative_occurrences.append(child)
                prose(child)
        elif isinstance(item, list):
            for child in item:
                prose(child)

    def subtrees(item):
        nonlocal repeated_bytes, repeated_nodes
        if not isinstance(item, (dict, list)):
            return
        raw = encoded(item, True)
        if len(raw) >= 256:
            signature = hashlib.sha256(raw).digest()
            if signature in seen_subtrees:
                repeated_bytes += len(raw)
                repeated_nodes += 1
                return  # Avoid counting nested duplicate bytes a second time.
            seen_subtrees.add(signature)
        for child in item.values() if isinstance(item, dict) else item:
            subtrees(child)

    prose(value)
    subtrees(value)
    all_bytes = sum(len(text.encode("utf-8")) for text in narrative_occurrences)
    unique_bytes = sum(len(text.encode("utf-8")) for text in set(narrative_occurrences))
    return {"narrativeOccurrences": len(narrative_occurrences),
            "uniqueNarratives": len(set(narrative_occurrences)),
            "narrativeTextBytes": all_bytes,
            "repeatedNarrativeTextBytes": all_bytes - unique_bytes,
            "repeatedContainerBytesAtLeast256": repeated_bytes,
            "repeatedContainerOccurrencesAtLeast256": repeated_nodes}


def reconstruct(role, context, model, correction_label=None, context_encoding="plain-json"):
    # Bypass constructors entirely: payload() reads only model, never a key.
    stub = SimpleNamespace(model=model)
    stub.payload = lambda r, c: DeepSeekProvider.payload(stub, r, c)
    payload = stub.payload(role, context)
    if correction_label is not None:
        payload = DeepSeekProvider._format_correction(stub, role, context,
                                                      DecisionError(correction_label))
        if payload is None:
            return None
        payload.pop("validationLabel")
    # Old attempt rows predate encoding metadata and must reconstruct the
    # historical plain payload, even when today's adapter can share records.
    if context_encoding == "plain-json":
        payload["messages"][0]["content"] = payload["messages"][0]["content"].replace(REFERENCE_LEGEND, "")
        payload["messages"][1]["content"] = _context_input(role, context)
    elif context_encoding != ENCODING:
        raise ValueError("Unknown recorded context encoding")
    system = payload["messages"][0]["content"]
    user = payload["messages"][1]["content"]
    packet = json.loads(user)
    is_encoded = REFERENCE_LEGEND in system
    return {"inputBytes": len(encoded(payload)), "systemPromptBytes": len(system.encode("utf-8")),
            "userContextBytes": len(user.encode("utf-8")), "packet": packet,
            "expandedPacket": decode_context_records(packet, is_encoded)}


def distribution(values):
    values = sorted(value for value in values
                    if type(value) in (int, float) and math.isfinite(value))
    if not values:
        return {"n": 0, "sum": None, "min": None, "median": None,
                "mean": None, "p90": None, "max": None}
    return {"n": len(values), "sum": round(sum(values), 3), "min": values[0],
            "median": round(statistics.median(values), 3),
            "mean": round(statistics.mean(values), 3),
            "p90": values[max(0, math.ceil(len(values) * .9) - 1)], "max": values[-1]}


def summarize(rows):
    result = {"attempts": len(rows), "logicalCalls": len({row["logicalCall"] for row in rows}),
              "statuses": dict(Counter(row["status"] for row in rows)),
              "measurements": {field: distribution([row.get(field) for row in rows])
                               for field in SIZE_FIELDS + USAGE_FIELDS},
              "componentBytes": dict(sum((Counter(row.get("componentBytes", {})) for row in rows), Counter()))}
    incoming = result["measurements"]["input_tokens"]["sum"]
    cached = result["measurements"]["input_cache_hit_tokens"]["sum"]
    result["cacheHitShareOfReportedInputTokens"] = cached / incoming if incoming and cached is not None else None
    comparable = [row for row in rows if row.get("sameInputPlainBodyBytes") is not None]
    if comparable:
        plain = sum(row["sameInputPlainBodyBytes"] for row in comparable)
        compact = sum(row["inputBytes"] for row in comparable)
        result["sameInputPlainComparison"] = {"attempts": len(comparable),
            "plainBodyBytes": plain, "actualBodyBytes": compact,
            "bodyReductionPercent": 100 * (1 - compact / plain),
            "plainUserBytes": sum(row["sameInputPlainUserContextBytes"] for row in comparable),
            "actualUserBytes": sum(row["userContextBytes"] if row.get("userContextBytes") is not None
                                   else row["reconstructedUserContextBytes"] for row in comparable),
            "recordedUserByteCoverage": sum(row.get("userContextBytes") is not None for row in comparable)}
    return result


def analyze(data_dir, simulation_id):
    catalog = read_json(data_dir / "catalog.json")
    simulation = catalog["simulations"][simulation_id]
    folder = data_dir / "simulations" / simulation_id
    attempts = simulation.get("providerMetrics", {}).get("attempts", [])
    audit_records = []
    for snapshot in simulation.get("snapshots", []):
        world = read_json(monthly_state_path(folder, snapshot["date"]))
        for audit in world["audit"]:
            context = audit["context"]
            response = audit.get("response")
            response_raw = encoded(response, True) if isinstance(response, dict) else None
            audit_records.append({"audit": audit, "contextSHA256": digest(context),
                                  "contextBytes": len(encoded(context)),
                                  "savedResponseJsonChars": len(response_raw.decode("utf-8")) if response_raw else None,
                                  "savedResponseJsonBytes": len(response_raw) if response_raw else None,
                                  "savedResponseActionCount": len(response["actions"]) if isinstance(response, dict) and isinstance(response.get("actions"), list) else None})
    by_hash = defaultdict(list)
    by_body = defaultdict(list)
    for index, record in enumerate(audit_records):
        audit = record["audit"]
        by_hash[(audit["role"], record["contextSHA256"])].append(index)
        rebuilt = reconstruct(audit["role"], audit["context"], "deepseek-flash")
        record["initialReconstruction"] = rebuilt
        by_body[(audit["role"], rebuilt["inputBytes"])].append(index)

    groups = defaultdict(list)
    for index, metric in enumerate(attempts):
        logical = (metric.get("executionSession"), metric.get("providerSession"), str(metric["callId"]))
        groups[logical].append((index, metric))
    matches, join_counts, used_audits = {}, Counter(), set()
    for logical, group in groups.items():
        first = min(group, key=lambda item: item[1]["attempt"])[1]
        fingerprint = first.get("contextSHA256")
        candidates = by_hash.get((first["role"], fingerprint), []) if fingerprint else []
        method = "exact_fingerprint" if fingerprint else "legacy_unique_size_status_candidate"
        if not fingerprint:
            candidates = by_body.get((first["role"], first["inputBytes"]), [])
            succeeded = any(metric["status"] == "ok" for _, metric in group)
            candidates = [i for i in candidates if isinstance(audit_records[i]["audit"].get("response"), dict) == succeeded]
        if len(candidates) == 1:
            matches[logical] = (candidates[0], method)
            used_audits.add(candidates[0])
        else:
            matches[logical] = (None, "ambiguous" if candidates else "unmatched")
        join_counts[matches[logical][1]] += 1

    rows, mismatches = [], Counter()
    for logical, group in groups.items():
        audit_index, method = matches[logical]
        record = audit_records[audit_index] if audit_index is not None else None
        audit = record["audit"] if record else None
        label = None
        for source_index, metric in sorted(group, key=lambda item: item[1]["attempt"]):
            row = {"sourceRow": source_index, "date": metric.get("contextMonth") or (audit["month"] if audit else None),
                   "role": metric["role"], "target": metric.get("contextTargetId") or (audit.get("targetId") if audit else None),
                   "logicalCall": "|".join(str(value or "") for value in logical),
                   "callId": str(metric["callId"]), "executionSession": metric.get("executionSession"),
                   "providerSession": metric.get("providerSession"), "credentialSlot": metric.get("credentialSlot"),
                   "attempt": metric["attempt"], "formatCorrection": metric.get("formatCorrection", 0),
                   "status": metric["status"], "httpStatus": metric.get("httpStatus"),
                   "provider": metric.get("provider"), "model": metric.get("model"),
                   "contextEncoding": metric.get("contextEncoding", "plain-json"),
                   "joinMethod": method, "auditStatus": audit["status"] if audit else None,
                   "contextSHA256": metric.get("contextSHA256"), "contextStep": metric.get("contextStep"),
                   "contextTowerCount": metric.get("contextTowerCount"),
                   **{field: metric.get(field) for field in SIZE_FIELDS},
                   **{field: metric.get("usage", {}).get(field) for field in USAGE_FIELDS}}
            if record:
                context = audit["context"]
                rebuilt = reconstruct(metric["role"], context, metric.get("model", "deepseek-flash"),
                                      label if metric.get("formatCorrection", 0) else None,
                                      metric.get("contextEncoding", "plain-json"))
                if metric.get("formatCorrection", 0) and label is None:
                    rebuilt = None
                row["auditContextSHA256"] = record["contextSHA256"]
                row["auditContextBytes"] = record["contextBytes"]
                row["savedResponseJsonChars"] = record["savedResponseJsonChars"] if metric["status"] == "ok" else None
                row["savedResponseJsonBytes"] = record["savedResponseJsonBytes"] if metric["status"] == "ok" else None
                row["savedResponseActionCount"] = record["savedResponseActionCount"] if metric["status"] == "ok" else None
                if rebuilt:
                    plain = reconstruct(metric["role"], context, metric.get("model", "deepseek-flash"),
                                        label if metric.get("formatCorrection", 0) else None, "plain-json")
                    row.update(reconstructedInputBytes=rebuilt["inputBytes"],
                               reconstructedSystemPromptBytes=rebuilt["systemPromptBytes"],
                               reconstructedUserContextBytes=rebuilt["userContextBytes"],
                               expandedUserContextBytes=len(encoded(rebuilt["expandedPacket"])),
                               sameInputPlainBodyBytes=plain["inputBytes"],
                               sameInputPlainUserContextBytes=plain["userContextBytes"],
                               componentBytes=components(rebuilt["packet"]),
                               repetition=repetition(rebuilt["packet"]))
                    row["expandedPacketMatchesAuditContext"] = encoded(rebuilt["expandedPacket"], True) == encoded(json.loads(_context_input(metric["role"], context)), True)
                    if not row["expandedPacketMatchesAuditContext"]:
                        mismatches["expandedPacket"] += 1
                    row["requestBodySizeMatchesReconstruction"] = rebuilt["inputBytes"] == metric["inputBytes"]
                    if not row["requestBodySizeMatchesReconstruction"]:
                        mismatches["requestBodyBytes"] += 1
                for key, expected in (("contextSHA256", record["contextSHA256"]),
                                      ("contextBytes", record["contextBytes"]),
                                      ("contextMonth", audit["month"]),
                                      ("contextTargetId", context.get("target", {}).get("id"))):
                    if key in metric and metric[key] != expected:
                        mismatches[key] += 1
                if metric["status"] == "ok":
                    for key in ("responseJsonChars", "responseJsonBytes", "responseActionCount"):
                        saved_key = "savedResponse" + key[len("response"):]
                        if key in metric and metric[key] != record[saved_key]:
                            mismatches[key] += 1
            else:
                row["componentBytes"] = {}
            rows.append(row)
            if metric.get("validationError"):
                label = metric["validationError"]

    rows.sort(key=lambda row: (row.get("date") or "9999", row["role"], row.get("target") or "",
                               row["logicalCall"], row["attempt"]))
    by_role, by_month = defaultdict(list), defaultdict(list)
    for row in rows:
        by_role[row["role"]].append(row)
        by_month[row["date"] or "unmatched"].append(row)
    summary = summarize(rows)
    summary.update({"simulationId": simulation_id, "generatedAtUTC": datetime.now(timezone.utc).isoformat(),
                    "completedMonths": [item["date"] for item in simulation.get("snapshots", [])],
                    "requestedMonths": simulation.get("months", []),
                    "source": {"catalog": str(data_dir / "catalog.json"),
                               "adapterSHA256": hashlib.sha256((ROOT / "backend/ai.py").read_bytes()).hexdigest(),
                               "scriptSHA256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},
                    "joinCoverage": {"logicalCalls": dict(join_counts), "savedAudits": len(audit_records),
                                     "matchedAudits": len(used_audits), "unmatchedAudits": len(audit_records) - len(used_audits)},
                    "consistencyMismatches": dict(mismatches),
                    "componentDefinitions": CATEGORIES,
                    "byRole": {key: summarize(value) for key, value in sorted(by_role.items())},
                    "byMonth": {key: summarize(value) for key, value in sorted(by_month.items())},
                    "repetitionTotals": dict(sum((Counter(row.get("repetition", {})) for row in rows), Counter())),
                    "attemptRows": rows})
    return summary


def number(value, decimals=0):
    return "unknown" if value is None else format(value, ",." + str(decimals) + "f")


def markdown(report):
    m = report["measurements"]
    complete = len(report["completedMonths"])
    lines = ["# DeepSeek request and answer measurements", "",
             f"Simulation `{report['simulationId']}`: **{complete} saved months, {report['logicalCalls']} logical calls, {report['attempts']} HTTP attempts**. Attempt statuses: `{json.dumps(report['statuses'], sort_keys=True)}`.", "",
             f"The provider reported **{number(m['input_tokens']['sum'])} input tokens** and **{number(m['output_tokens']['sum'])} output tokens**. "
             f"Request JSON bodies totaled **{number(m['inputBytes']['sum'] / 1048576, 2)} MiB**. "
             f"Median attempt latency was **{number(m['latencyMs']['median'] / 1000, 2)} s**, with a 90th percentile of **{number(m['latencyMs']['p90'] / 1000, 2)} s**.", "",
             "## By role", "",
             "| Role | Attempts | Input tokens | Mean body KiB | Mean original context KiB | Median answer chars | Median output tokens | Median / p90 seconds |",
             "|---|---:|---:|---:|---:|---:|---:|---:|"]
    for role, group in report["byRole"].items():
        x = group["measurements"]
        lines.append(f"| {role} | {group['attempts']} | {number(x['input_tokens']['sum'])} | "
                     f"{number(x['inputBytes']['mean'] / 1024, 1)} | {number(x['contextBytes']['mean'] / 1024, 1) if x['contextBytes']['mean'] is not None else 'unknown'} | "
                     f"{number(x['answerTextChars']['median'])} | {number(x['output_tokens']['median'])} | "
                     f"{number(x['latencyMs']['median'] / 1000, 2)} / {number(x['latencyMs']['p90'] / 1000, 2)} |")
    packet_total = sum(report["componentBytes"].values())
    lines += ["", "## What the user context contains", "",
              "Bytes below partition compact user-packet JSON exactly, including field names and delimiters. "
              "The packet includes the derived eligibility menu; it excludes the system prompt and outer HTTP JSON escaping. "
              "These are byte shares, not estimated token shares.", "",
              "| Component | MiB sent across attempts | Share |", "|---|---:|---:|"]
    for name, size in sorted(report["componentBytes"].items(), key=lambda item: -item[1]):
        lines.append(f"| {CATEGORIES[name]} | {size / 1048576:.2f} | {size / packet_total:.1%} |")
    lines += ["", "## Growth across months", "",
              "| Month | Attempts | Resident mean packet KiB | Resident mean input tokens | Narrator mean body KiB |",
              "|---|---:|---:|---:|---:|"]
    resident_growth = []
    for month, group in report["byMonth"].items():
        source = [row for row in report["attemptRows"] if (row["date"] or "unmatched") == month]
        residents = [row for row in source if row["role"] in RESIDENT_ROLES]
        narrators = [row for row in source if row["role"] == "narrator"]
        packet = distribution([row.get("userContextBytes", row.get("reconstructedUserContextBytes")) for row in residents])["mean"]
        tokens = distribution([row["input_tokens"] for row in residents])["mean"]
        narrator = distribution([row["inputBytes"] for row in narrators])["mean"]
        if packet is not None:
            resident_growth.append((month, packet))
        lines.append(f"| {month} | {group['attempts']} | {number(packet / 1024, 1) if packet is not None else 'unknown'} | "
                     f"{number(tokens)} | {number(narrator / 1024, 1) if narrator is not None else '—'} |")
    repetition_totals = report["repetitionTotals"]
    lines += ["", "## Interpretation and limits", ""]
    if len(resident_growth) >= 2:
        first, last = resident_growth[0], resident_growth[-1]
        lines.append(f"- The resident packet grew from {first[1] / 1024:.1f} KiB in {first[0]} to {last[1] / 1024:.1f} KiB in {last[0]} ({last[1] / first[1]:.1f}×). The monthly table and component counts show where that growth occurred.")
    share = report["cacheHitShareOfReportedInputTokens"]
    if share is not None:
        lines.append(f"- Reported cache hits covered {share:.1%} of input tokens. The report does not infer prices or spend from token counts.")
    comparison = report.get("sameInputPlainComparison")
    if comparison:
        lines.append(f"- On these exact saved inputs, plain request bodies would total {comparison['plainBodyBytes']:,} bytes; actual bodies total {comparison['actualBodyBytes']:,} bytes ({comparison['bodyReductionPercent']:.2f}% reduction). "
                     f"Plain user packets would total {comparison['plainUserBytes']:,} bytes versus {comparison['actualUserBytes']:,} actual bytes. "
                     "This is a local serialization comparison, not a causal token/cost comparison against another stochastic simulation.")
    lines.append(f"- Exact repeated narrative strings account for {repetition_totals.get('repeatedNarrativeTextBytes', 0) / 1048576:.2f} MiB across packets. A separate top-down scan found {repetition_totals.get('repeatedContainerBytesAtLeast256', 0) / 1048576:.2f} MiB of repeated identical JSON containers of at least 256 bytes. These overlap and must not be added; neither predicts safe context removal or token savings.")
    lines += ["- `inputBytes` is the full UTF-8 HTTP JSON body, including system instructions, schema, example, user JSON, JSON escaping and provider options. It excludes headers, credentials and transport framing. `contextBytes` is the original compact engine-context JSON before the derived eligibility menu. `systemPromptBytes` and `userContextBytes` measure the two message strings; their sum differs from the body size because the body escapes them and adds its own fields.",
              "- `answerTextChars/Bytes` measures actual assistant content returned on each HTTP-success attempt, including whitespace, before local validation. `responseJsonChars/Bytes` measures only validated canonical JSON; saved audit response lengths are a separate cross-check. Unavailable text lengths remain null, including HTTP failures. Explicit reasoning text lengths are separate and otherwise unknown, even with thinking disabled.",
              "- Token counts come from provider usage fields. They include returned invalid answers and format corrections when usage was supplied. No tokenizer estimate is substituted for missing usage. Character and byte counts are not tokens.",
              "- `latencyMs` is client-observed time per attempt, covering request setup, transport, response extraction and validation; it excludes retry backoff and waiting for a free credential slot. Parallel attempt durations cannot be summed to obtain simulation wall time. No separate server generation or time-to-first-token measurement exists.",
              "- Context categories are mutually exclusive; root history and construction-history branches include all their nested prose, while other narrative fields have their own category. Every user-packet byte is allocated once. Exact subtree repetition is structural evidence only: repeated facts may be relevant to distinct spatial decisions.",
              "- New requests join to saved audits by role plus canonical sorted-key context SHA-256. Legacy size/status matches are labeled candidates, never exact. Unmatched or ambiguous rows are retained. Reconstructed sizes do not recover the original JSON member order or raw wire bytes.",
              f"- Linkage: `{json.dumps(report['joinCoverage'], sort_keys=True)}`. Consistency mismatches: `{json.dumps(report['consistencyMismatches'], sort_keys=True)}`.",
              "- This analysis reads local saved artifacts only and constructs no provider, reads no credential, and sends no network request. The analyzer does not modify contexts or decisions; the measured exact-record encoding preserves all original information.", ""]
    return "\n".join(lines)


def write_report(report, prefix):
    prefix.parent.mkdir(parents=True, exist_ok=True)
    prefix.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    prefix.with_suffix(".md").write_text(markdown(report), encoding="utf-8")
    rows = [{key: value for key, value in row.items() if key not in ("componentBytes", "repetition")}
            for row in report["attemptRows"]]
    fields = list(dict.fromkeys(key for row in rows for key in row))
    with prefix.with_suffix(".csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


class AccountingTests(unittest.TestCase):
    def test_partition_unicode_and_nested_categories(self):
        value = {"month": "2025-01-01", "towers": [{"narrative": "邻里", "target": {"x": 1},
                  "neighborhood": [{"building": {"narrative": "邻里", "population": 10}}],
                  "occupancy": {"ownGroup": None}, "eligibleActions": ["move_in"]}],
                 "history": [{"decision": {"reason": "quiet", "narrative": "history"}}]}
        sizes = components(value)
        self.assertEqual(sum(sizes.values()), len(encoded(value)))
        self.assertGreater(sizes["narratives"], 0)
        self.assertGreater(sizes["resident_history"], 0)
        self.assertEqual(repetition(value)["repeatedNarrativeTextBytes"], len("邻里".encode("utf-8")))
        self.assertEqual(digest(value), digest(dict(reversed(list(value.items())))))

    def test_reconstruction_uses_no_constructor_and_correction_changes_only_system(self):
        context = {"month": "2025-01-01", "towers": [{"towerId": "R1", "eligibleActions": ["leave"]}]}
        initial = reconstruct("budget", context, "deepseek-flash")
        correction = reconstruct("budget", context, "deepseek-flash", "Invalid reason")
        self.assertEqual(initial["packet"], correction["packet"])
        self.assertEqual(initial["packet"]["actionEligibility"], {"R1": ["leave"]})
        self.assertGreater(correction["inputBytes"], initial["inputBytes"])
        self.assertEqual(sum(components(initial["packet"]).values()), initial["userContextBytes"])
        self.assertGreater(initial["inputBytes"], initial["userContextBytes"] + initial["systemPromptBytes"])

    def test_missing_is_not_zero_and_percentile_is_nearest_rank(self):
        self.assertIsNone(distribution([None])["sum"])
        self.assertEqual(distribution([0, None])["sum"], 0)
        self.assertEqual(distribution(list(range(1, 11)))["p90"], 9)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "backend/.data/live_regional_storage")
    parser.add_argument("--simulation-id")
    parser.add_argument("--output-prefix", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(AccountingTests))
        return 0 if result.wasSuccessful() else 1
    if not args.simulation_id or not args.output_prefix:
        parser.error("--simulation-id and --output-prefix are required unless --self-test")
    report = analyze(args.data_dir.resolve(), args.simulation_id)
    write_report(report, args.output_prefix.resolve())
    print(json.dumps({"simulationId": report["simulationId"], "months": len(report["completedMonths"]),
                      "attempts": report["attempts"], "joins": report["joinCoverage"],
                      "mismatches": report["consistencyMismatches"], "outputPrefix": str(args.output_prefix)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

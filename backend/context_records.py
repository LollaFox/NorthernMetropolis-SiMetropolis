"""Lossless, request-local sharing of exact repeated city fact records.

There is no cross-request cache, no ID-only merging and no prose rewriting.
The explicit encoded flag keeps ordinary envelope-shaped JSON unambiguous.
"""
from __future__ import annotations

from collections import Counter
import copy
import json


ENCODING = "exact-records-v1"
REFERENCE_LEGEND = (
    " Context encoding exact-records-v1: the user JSON has records and context. "
    "Within context, a sole {$record: key} object means the complete unchanged "
    "JSON record at records[key]; expand each reference independently. Table "
    "values are literal original records, with no encoded references. A sole "
    "{$literal: value} preserves value as literal original data without expansion. "
    "Reference keys such as R004/v1 are not action IDs: use the original id or "
    "towerId values and the unchanged actionEligibility menu."
)


def _bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False,
                      separators=(",", ":")).encode("utf-8")


def _reserved(value):
    return isinstance(value, dict) and len(value) == 1 and bool(set(value) & {"$record", "$literal"})


def _kind(value):
    if not isinstance(value, dict) or _reserved(value):
        return None
    if (isinstance(value.get("id"), str)
            and value.get("type") in ("residential", "business", "park", "station")
            and all(key in value for key in ("x", "y", "status"))):
        return "building"
    if all(key in value for key in ("x", "y", "dx", "dy", "status", "building")):
        return "cell"
    return None


def encode_context_records(value):
    """Return (packet, encoded), sharing repeated complete building/cell records.

    Complete building facts take priority over their containing cells. No
    selected parent/child overlap is permitted, and unused table entries are
    removed. Keep plain JSON if the entire HTTP body, including the decoding
    legend and nested-string escaping, would not become smaller.
    """
    originals, counts, kinds = {}, Counter(), {}

    def scan(item):
        if _reserved(item):
            return  # Preserve this entire literal subtree without interpretation.
        kind = _kind(item)
        if kind:
            key = _bytes(item)
            originals.setdefault(key, item)
            kinds[key] = kind
            counts[key] += 1
        if isinstance(item, dict):
            for name in sorted(item):
                scan(item[name])
        elif isinstance(item, list):
            for child in item:
                scan(child)

    scan(value)
    candidates = {key for key, count in counts.items() if count > 1}
    buildings = {key for key in candidates if kinds[key] == "building"}

    def contains_selected_building(item):
        if _reserved(item):
            return False
        if _kind(item) == "building" and _bytes(item) in buildings:
            return True
        if isinstance(item, dict):
            return any(contains_selected_building(child) for child in item.values())
        if isinstance(item, list):
            return any(contains_selected_building(child) for child in item)
        return False

    candidates = buildings | {key for key in candidates if kinds[key] == "cell"
                              and not contains_selected_building(originals[key])}
    names, versions = {}, Counter()
    for key in sorted(candidates):
        item = originals[key]
        base = item["id"] if kinds[key] == "building" else "cell({},{},{},{})".format(
            item["x"], item["y"], item["dx"], item["dy"])
        versions[base] += 1
        names[key] = base + "/v" + str(versions[base])
    # A record must at least pay for its own entry and every reference.
    candidates = {key for key in candidates
                  if counts[key] * (len(key) - len(_bytes({"$record": names[key]})))
                  > len(key) + len(_bytes(names[key])) + 1}
    used = set()

    def rewrite(item):
        if _reserved(item):
            return {"$literal": copy.deepcopy(item)}
        if _kind(item):
            key = _bytes(item)
            if key in candidates:
                used.add(key)
                return {"$record": names[key]}
        if isinstance(item, dict):
            return {name: rewrite(child) for name, child in item.items()}
        if isinstance(item, list):
            return [rewrite(child) for child in item]
        return copy.deepcopy(item)

    context = rewrite(value)
    if not used:
        return copy.deepcopy(value), False
    packet = {"encoding": ENCODING,
              "records": {names[key]: copy.deepcopy(originals[key]) for key in sorted(used)},
              "context": context}
    # Both providers put the context JSON inside an HTTP-body string. Compare
    # that exact escaped contribution plus the extra system-string characters.
    plain_wire = len(_bytes(_bytes(value).decode("utf-8")))
    compact_wire = len(_bytes(_bytes(packet).decode("utf-8")))
    legend_wire = len(_bytes(REFERENCE_LEGEND)) - 2
    if compact_wire + legend_wire >= plain_wire:
        return copy.deepcopy(value), False
    return packet, True


def decode_context_records(packet, encoded=False):
    """Expand a packet with the explicit flag returned by the encoder.

    Never auto-detect by dictionary shape: ordinary scenario data may contain
    the same keys or resemble an entire encoded envelope.
    """
    if not encoded:
        return copy.deepcopy(packet)
    if (not isinstance(packet, dict) or set(packet) != {"encoding", "records", "context"}
            or packet["encoding"] != ENCODING or not isinstance(packet["records"], dict)):
        raise ValueError("Invalid context record envelope")
    records = packet["records"]
    if any(not isinstance(name, str) or _kind(record) is None for name, record in records.items()):
        raise ValueError("Invalid shared context record")
    used = set()

    def expand(item):
        if _reserved(item):
            if "$literal" in item:
                if not _reserved(item["$literal"]):
                    raise ValueError("Invalid literal context record escape")
                return copy.deepcopy(item["$literal"])
            name = item["$record"]
            if not isinstance(name, str) or name not in records:
                raise ValueError("Missing context record reference")
            used.add(name)
            return copy.deepcopy(records[name])
        if isinstance(item, dict):
            return {name: expand(child) for name, child in item.items()}
        if isinstance(item, list):
            return [expand(child) for child in item]
        return copy.deepcopy(item)

    value = expand(packet["context"])
    if used != set(records):
        raise ValueError("Unused shared context record")
    return value

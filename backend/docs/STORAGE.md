# Saved city state and lossless storage

2026-10-16. The recoverable source baseline before storage optimization is
commit `688a8de`, tagged `before-storage-optimization-20261016`. Existing run
files were not migrated, deleted or rewritten by this change. Runtime data is
outside Git; the source checkpoint is not a backup of runtime files.

## What the original files contain

The original server stores one complete, minified JSON world for every settled
month under `simulations/{simulationId}/{date}.json`. A world contains its date,
construction script/configuration, buildings, groups and job assignments, firms,
resident histories, narratives, events, numerical metrics and complete audit
contexts/responses/outcomes for that month. Provider-attempt metrics,
initializations, confirmation versions, jobs and idempotency records live in a
separate plain `catalog.json`.

Before optimization, the initial twelve-month Flash run's monthly worlds total
**9,172,061 bytes**. Their `audit` fields account for **8,245,563 bytes** (about
89.9%). The largest month, November, is 1,265,702 bytes; its audit is 1,150,057
bytes. Four resident roles' tower-context arrays alone occupy 1,043,117 bytes
in that month. They repeat many canonical tower/neighborhood/narrative facts
because each role receives a complete, independently attributable decision
context. Histories and completed facts also recur across saved months. These
are useful audit records, not disposable logging noise.

The measured catalog is 148,331 bytes. It remains plain JSON for inspectability
and simple atomic job/idempotency updates. No credentials or uploaded PDF text
are stored in monthly worlds; initialization retains a PDF digest and metadata.

## New representation

New runs keep the same logical worlds and full audits, with this layout:

```text
simulations/{simulationId}/
  2025-01-01.json.gz
  2025-02-01.json.gz
  ...
  shared-objects.json.gz
```

Each monthly file is a gzip stream. Its uncompressed bytes start with the
out-of-band marker `NMSTATE1\n`, followed by an envelope:

```json
{
  "format": "nm-json-dag",
  "version": 1,
  "payload": {"config": null, "otherWorldFields": "..."},
  "refs": [{"path": ["config"], "hash": "<64 lowercase hex characters>"}],
  "sha256": "<SHA-256 of the complete logical world's canonical JSON>"
}
```

This example omits actual world fields. References are a separate path table;
dict keys and list indices identify null placeholders. Ordinary user data can
contain keys such as `refs`, `payload`, `hash` or `format` without becoming a
reference. Ordinary legacy JSON cannot begin with the non-JSON byte marker.

The shared gzip file contains `{"format":"nm-shared-pool","version":1,
"objects":{...}}`. Each object key is the SHA-256 of its canonical logical JSON
value, and each value is an envelope with the same payload/ref/hash scheme.
Repeated dict/list subtrees of at least **1,024 canonical JSON bytes** are
factored out; substantial configuration is also retained for later months.
Small values and strings stay inline. Repeated narratives can be shared inside
their enclosing facts/context records without creating a file for each string.
One gzip pool exploits compression across shared records and avoids thousands
of small files. The initial individually compressed object prototype used more
space and was discarded; it was never deployed to runtime data.

Pool entries only accumulate logically: an existing hash keeps its original
content. The pool file is atomically rewritten when entries are added. A writer
flushes and fsyncs the pool, replaces it, then publishes the monthly file with
the same atomic procedure. Directory metadata is synced where supported. Only
after the world is durable does the service expose that month in its plain
catalog. This is a single-writer-per-run format, not a database or concurrent
cross-process scheduler.

Before reusing an object, the writer verifies its current disk representation.
Readers verify object hashes and the hydrated world's hash, reject missing
objects, cycles, invalid/overlapping paths, corrupt gzip/DEFLATE and nonfinite
JSON numbers including exponent overflow such as `1e999`. A repeated mutable
object is copied on hydration so two audit branches cannot accidentally share
one mutable dictionary. A corrupt selected new file never silently falls back
to a different legacy version.

An interruption after pool publication but before monthly/catalog publication
can leave unused shared entries or an unpublished month. They are retained;
there is no automatic garbage collection or deletion. Completed catalogued
months are never reapplied on same-key retry. As before, an interrupted remote
call can have an unknown outcome/usage and may repeat on explicit retry.

## Reading, exporting and CLI output

The public helper reads legacy plain worlds, full gzip JSON snapshots and the
new shared format transparently:

```python
from pathlib import Path
from backend.storage import monthly_state_path, read_json

folder = Path("backend/.data/<run>/simulations/<simulationId>")
world = read_json(monthly_state_path(folder, "2025-01-01"))
```

Keep the shared pool with the monthly files when copying a run. A gzip tool
alone exposes a monthly envelope, not the hydrated world. Existing plain files
remain readable in place; there is no automatic conversion. HTTP snapshot and
export responses still contain ordinary complete JSON values. Full exports
therefore expand the shared representation again; no additional full export
copy is persisted automatically.

`GET /api/v3/simulations/{simulationId}/export` includes canonical
`monthlyStates`, the scenario's optional `scale` metadata and separately
computed `monthlyBuildingTotals`. Each object's row distinguishes planned and
completed resident capacity, actual residents, offered jobs, filled positions
and vacancies. These derived rows are not inserted into every large world.
Capacity/reference targets are not forced occupancy or job outcomes; modeled
workers without allocated positions are not measured regional unemployment.

CLI runs use the same monthly representation under `states/`, including their
own shared pool. `initial.json`, `scenario.json`, calls, metrics, status and
summary remain plain JSON. `building-totals.json.gz` is a small, ordinary gzip
JSON table. For compatibility, `audit.jsonl` also remains plain and duplicates
the audit portions already retained in monthly worlds. Nothing removes that
optional convenience copy automatically; users may choose to remove it
manually after checking their retained run/backup. Server runs do not create
that separate JSONL copy.

## Independent measurements

The engine agent independently reconstructed the unchanged initial twelve live
worlds and a separate 21-month regional **offline fixture** in temporary
directories. Every hydrated JSON value, full audit and engine invariant matched;
SHA-256 hashes of the original run files remained unchanged. These are format
benchmarks, not new live-model results. Gzip level 6 and thresholds 1,024, 4,096
and 8,192 bytes were compared; 1,024 was best among those tested.

| Dataset | Original JSON | Full gzip, all months | Gzip plus sharing, roots + pool | Additional logical reduction | Allocated disk: full gzip → sharing |
| --- | ---: | ---: | ---: | ---: | ---: |
| Initial 12-month live states | 9,172,061 B | 771,397 B | 602,440 B | 21.90% | 802,816 → 634,880 B (20.92%) |
| Regional 21-month offline fixture | 36,936,572 B | 1,602,122 B | 996,565 B | 37.80% | 1,646,592 → 1,036,288 B (37.07%) |

Both totals include the entire shared pool. The new state representation uses
13 files for the initial run and 22 for the regional run. It does not include
catalogs, provider metrics, CLI JSONL duplicates or derived exports in these
state-only comparisons. Filesystem allocation was measured using `st_blocks`,
so the result does not hide per-file allocation overhead.

For all twelve initial months, write/hydrate time was about 0.738/0.336 seconds
with sharing versus 0.108/0.088 seconds for full gzip. For all 21 regional
months, it was 3.342/2.546 versus 0.345/0.315 seconds. Sharing saves space at
the cost of JSON hashing, pool rewrites and hydration. These timings are local
observations, not performance guarantees. New live narratives and occupancy
can change the compression ratio.

Formal coverage includes legacy/full-gzip/shared roundtrips; byte-identical
audits; cross-month reuse; reserved-key and mutable-alias cases; missing/corrupt
objects and hashes; cycles/paths; failure before pool/root publication; preserved
old roots; and mixed-format service export, restart, idempotency and corruption
handling. Independent review also exercised seeded arbitrary JSON shapes and
rejected publishing a new root that would reuse a damaged shared object.

Executed focused verification: `python3 -B -m unittest
backend.tests.test_service backend.tests.test_storage -v` collected and passed
29 tests (18 service/startup/HTTP and 11 storage), with no failures or skips.
A separate temporary-directory regional startup test settled 21 months with
232 offline fixture calls, then closed/recreated the service: every hydrated
monthly SHA-256 and every computed per-object table matched after restart, and
completed same-key replay created no configured live provider. This smoke took
about 18.36 seconds including full-state export, invariant checks and reload.
It performed no live requests and did not read credential files.

# Verification record — 2026-10-16

This first section records the initial offline baseline. Implementation and independent reviews used GPT-6.1 Sol agents, xhigh effort. Lead owned the plan and checked integration. At that baseline no live provider calls, dependency installations, public pushes or frontend edits had occurred. Later live and storage verification is recorded below. Total development-agent token usage/cost is unavailable; no savings/quality comparison is claimed.

## Executed checks

| Command | Collected / passed / failed / skipped |
| --- | --- |
| `python3 -B -m unittest discover -s backend/tests -v` | 40 / 40 / 0 / 0 |
| `python3 -B -m unittest discover -s tests -v` | 24 / 24 / 0 / 0 |
| `/Users/lollafox/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test frontend/sandbox/tests/test_*.mjs` | 343 / 343 / 0 / 0 |
| `python3 -B frontend/sandbox/tests/run_checks.py` | 61 / 61 / 0 / 0 |

**468 test cases passed.** The service suite includes actual loopback HTTP plus the unchanged `V3Session`, validation functions and terrain adapter, with 17 JavaScript assertions inside that integration test (not counted as another 17 test cases). Final core/API suite took 1.715 seconds; final AI suite 0.027 seconds. Test logs are in `evidence/`.

`PYTHONPYCACHEPREFIX=/private/tmp/nm-backend-final-pycache python3 -m compileall -q backend tests` passed. `git diff --exit-code 12f49a1 -- frontend examples scripts` passed. The original handoff's frontend, examples and scripts are byte-for-byte unchanged. No established formatter configuration exists in this handoff; new Python follows its existing style without installing/configuring a formatter.

Initial attempts to bind test HTTP servers in the restricted sandbox failed; the same tests passed with authorized loopback execution. This was an environment limitation, not a passing test. Initial bytecode compilation defaulted to a protected system cache; rerun using a task-local temporary cache passed.

## Default city-scale fixture

Final command: `python3 -B -m backend.cli --output /private/tmp/nm-narrative-final-20261016`.

- Twelve monthly snapshots completed; all state invariants passed.
- 50 residential towers, 12 business towers, 10 parks, 4 stations.
- 4,075 synthetic residents in 163 fixed-size groups; 1,050 filled jobs and 1,395 unemployed potential workers.
- 132 fixture calls, all valid; 7,296,714 total input bytes; 1.581 seconds including state/evidence writes.
- Largest profile context measured separately: 291,274 bytes. This can materially affect live token use and latency. No token estimate or live speed guarantee is claimed.
- All results are deterministic fixture outcomes, not live AI or validated forecasts. Unavailable provider usage is explicitly marked unavailable.

A compact summary is retained in `evidence/offline-summary.json`; detailed audit/states are in the CLI output directory. Two validated examples are in `../examples/`; parks-first changes fixture narratives and firm choices, demonstrating that the context path can alter outcomes. It does not establish that either construction strategy is better.

## Actual browser walkthrough

Used the Codex in-app browser against `http://127.0.0.1:8877/`:

1. Confirmed the unchanged page rendered the saved new-engine city in its existing 3D scene.
2. Configure → Team API, supplied existing `fixture-plan.pdf`, selected January–December 2025 monthly.
3. Start analysis displayed the real initialization review with script authority, PDF handling, quantities and representation limitations.
4. Acknowledged and confirmed. The async run completed; January zone population/job charts appeared.
5. Switched Result month to December. The snapshot date and final 76 object footprints appeared without a frontend exception.
6. Restarted the server with final code and reloaded; the 3D overview still rendered. Browser captured no warning/error logs on final load.

Screenshots: `screenshots/city-overview.jpg`, `screenshots/api-december.jpg`. The overview still includes inherited decorative port labels/flow overlays. The API view is a flat schematic zone map because that renderer has no building-object channel. Full canonical coordinates, narratives and AI audit remain in backend exports.

## Recovery and remaining boundary

Baseline local commit: `12f49a1`; original-file backup: `/private/tmp/nm-handoff-before-backend-20261016.tar.gz`. New implementation is additive under `backend/`, `tests/`, plus task `.gitignore`. Runtime states are ignored and preserved separately. Stop the task's localhost process to end the preview; do not delete the data directory to change source versions.

Completed states and idempotency records survive restart. Same-key retries resume interrupted/failed work and retain observed attempt metrics. Calls interrupted before a checkpoint may have unknown remote outcome/usage and may repeat on explicit retry. One process per data directory is supported; cross-process scheduling is not implemented.

At the initial baseline, live model access, semantic narrative quality, reliability, cost and elapsed runtime awaited the user-provided API key. There is no total live-call cap. Private-research context remains unchanged. See `REVIEW.md` for independent findings and fixes, and `COMPATIBILITY.md` for current UI limits.


## Regional scale and shared storage — 2026-10-16

Pre-storage source recovery: commit `688a8de`, tag `before-storage-optimization-20261016`. Functional regional/storage code under test: `10e1cbd`. Source rollback does not migrate new state files; use the matching reader or expanded exports when reading them. Original runtime data remains untouched.

The regional preset fills 132 aggregate planning sites: 100 residential clusters, 20 businesses, eight parks and four stations. These are schematic clusters, not 100 literal buildings. Residential capacity is 2,500,000 (25,000 per completed cluster). Business capacity depends on model-selected small/large firms (26,000/39,000 offered jobs each). Actual residents and filled jobs are calculated separately for each object. Government construction is staggered across 21 months. Scale targets are eventual development capacity, not guaranteed simulated occupancy or a forecast.

Final focused verification on the functional checkpoint:

| Command | Collected / passed / failed / skipped |
| --- | --- |
| `python3 -B -m unittest discover -s backend/tests -v` | 74 / 74 / 0 / 0 |
| `python3 -B -m unittest discover -s tests -v` | 46 / 46 / 0 / 0 |

All 120 current backend/provider tests passed. Logs: `evidence/regional-storage-backend-tests.log` and `evidence/regional-storage-ai-tests.log`. Compilation with temporary bytecode cache passed. Original frontend, examples and scripts remain unchanged against `12f49a1`. No formatter/dependency installation or public push was performed.

An independent review checked shared-object hashes, corrupt reused objects, cycles and malformed references, finite JSON, atomic publication ordering, legacy reads, and independent hydrated values. A discovered corrupt-reuse issue was fixed before the live run. Independent 21-month fixture restart preserved all states and per-object totals. All 33 independently benchmarked worlds (12 earlier live plus 21 regional fixture) matched losslessly.

Regional fixture benchmark: 36,936,572 bytes expanded JSON; 1,602,122 bytes full gzip; 996,565 bytes pooled gzip including every monthly root and shared pool. Pooling saves 37.80% beyond gzip (37.07% allocated disk space). All-month write/read took about 3.34/2.55 seconds versus 0.35/0.32 for full gzip. These are local measurements, not a general performance guarantee. See `evidence/pooled-storage-benchmark.json` and `STORAGE.md`.

### Fresh live run and provider limitation

A fresh regional run used DeepSeek Flash, two credential slots, and the new storage for January 2025 through September 2026. It reached 21 saved months in approximately 225 seconds (15-second polling resolution). Of 232 attempts, 120 succeeded and 112 returned HTTP 402 after the provider balance was exhausted. DeepSeek documents 402 as insufficient balance: https://api-docs.deepseek.com/quick_start/error_codes/ . Both slots were affected. This is a completed engine run with provider failures, **not a fully successful 21-month live AI run**. Successful requests reported 2,333,243 total tokens; no cost estimate is made.

The earlier smaller 12-month live run had 132 valid provider responses and one engine-rejected resident batch out of 48. The eligibility fix subsequently passed eight live reproductions of that context with zero rejected responses. Fresh regional rejection counts and restart evidence are recorded in `evidence/regional-storage-live.json`.

Independent live-prose review found that some profiles focus on one existing cohort despite multiple eligible arrival sites; work does make multiple arrivals. Park sometimes describes separate departures and arrivals as relocation, although settlement preserves distinct group identities. These are remaining model-reasoning/prose limitations. No minimum population was forced and no generated decision was silently rewritten.


### Actual saved-run restart result

All 21 live-run worlds passed engine invariants and matched the hydrated HTTP export exactly. Per-object totals matched independent engine calculations. After stopping both prior task servers, the regional server restarted at `http://127.0.0.1:8878/` with the same data directory. Every canonical monthly hash, all 22 stored-file hashes, totals, attempt metrics and storage measurements remained identical. Completed same-operation-key replay returned the same result with **zero additional provider calls**, before and after restart. Evidence: `evidence/regional-storage-live.json` and `evidence/regional-storage-live-after-restart.json`.

Verification command after restart:

```sh
python3 -B /private/tmp/nm-regional-state-check.py --base-url http://127.0.0.1:8878 --data-dir backend/.data/live_regional_storage --compare backend/docs/evidence/regional-storage-live.json --output backend/docs/evidence/regional-storage-live-after-restart.json
```

Actual monthly-state storage: **31,815,688 bytes** expanded canonical JSON; **2,005,421 bytes** full gzip; **1,153,237 bytes** pooled gzip, including all monthly roots and the complete shared pool. Pooling saves **42.494%** beyond full gzip, or **41.517%** allocated disk space. Catalog/metrics/evidence are excluded equally from these state-format comparisons.

Of 120 successful live responses, none failed schema or engine decision validation (44 resident batches). The 112 provider errors caused nine small-firm recoveries, 63 explicit fallback narratives and 40 unavailable resident batches with unchanged occupancy. Final actual population is 112,500 against 2,500,000 resident capacity; businesses offer 520,000 jobs with 67,500 filled and 452,500 vacant. These final outcomes are affected by the provider outage. A full-success rerun requires funded provider access; source/storage verification is complete.


## Request inspection milestone

Storage/restart evidence was committed as `a69f5e8` before request inspection began. The user replenished the provider account and authorized a fresh run. Request measurement code is checkpointed at `6fa9e3f`; prompts, engine decisions and provider configuration were not changed by that instrumentation.

Lead verification: `python3 -B -m unittest discover -s backend/tests -v` collected/passed 74, failed/skipped 0 (7.612 seconds); `python3 -B -m unittest discover -s tests -v` collected/passed 51, failed/skipped 0 (0.110 seconds). Logs: `evidence/request-tracking-backend-tests.log` and `evidence/request-tracking-ai-tests.log`. Independent review passed all 51 AI tests and matched 11 engine decisions to 11 logical calls across 12 attempts, including a format correction and simulated HTTP failure. Canonical context fingerprints preserve exact semantic joins despite persisted key ordering and parallel credential slots.

Each attempt now records context fingerprint, month/step/target, original-context bytes, system/user text bytes, complete request-body bytes, actual assistant/reasoning text lengths when present, validated canonical decision lengths/action counts, provider token usage and attempt latency. Missing returned text is null, not zero. Only lengths and linkage metadata are added; raw answer text is not duplicated into metrics. Full validated decision/context audit remains in the saved world.


### Funded request-measurement baseline

The fresh run `sim_886a10a6301f4591a192b12789d1d94e` completed all 21 months on source `6fa9e3f` in 355.476 monitored seconds. All 232 logical decisions were accepted by the engine. There were 235 provider attempts: 232 valid answers and three invalid drafts, each corrected by the existing bounded retry. No provider outage, fallback, or rejected engine action remained. All 21 saved worlds passed independent invariants and per-building reconciliation. Final population: 918,750; offered jobs: 572,000; filled jobs: 551,250; vacancies: 20,750.

Read-only inspection exactly matched all 232 logical calls to saved audit contexts by SHA-256 and accounted for all 235 attempts, including corrected drafts. Reconstructed request byte sizes and accepted canonical answer lengths matched every measurement. Total request bodies: 38,703,226 bytes, comprising 34,582,621 user-packet bytes, 724,706 system-text bytes and 3,395,899 outer JSON/escaping bytes. Provider usage: 9,437,447 input tokens, 17,965 output tokens; 198,272 input tokens reported cached. These are different measures; JSON transport escaping is not additional model-visible text.

The four resident roles used 93.17% of input tokens. Neighborhood facts and place narratives accounted for 78.05% of user-packet bytes. These component counts include repeated records, not distinct city information. Largest request: September park role, 859,026 body bytes, 210,966 input tokens; its actual answer was 966 characters / 238 output tokens, taking 5.78 seconds. Overall actual answer median was 304 characters; attempt latency median 1.45 seconds, p90 3.94 seconds. Summed attempt latency (473.26 seconds) differs from elapsed run time because requests overlap.

Three exact local narration examples:

| Month / target | Request bytes | Input / output tokens | Actual answer characters | Attempt seconds |
| --- | ---: | ---: | ---: | ---: |
| February / B002 | 17,937 | 4,309 / 49 | 257 | 1.116 |
| April / R014 | 18,083 | 4,301 / 65 | 344 | 1.489 |
| June / R022 | 18,993 | 4,576 / 68 | 348 | 1.627 |

For April R014, original city context is 13,542 bytes: construction 6,706; nine-cell neighborhood 3,628; scale metadata 1,844; other fields and punctuation 1,364. System text is 2,765 bytes, request wrapper/options 204, JSON escaping 1,572. There are 25 full object-record occurrences but 15 distinct versions, representing 3,387 duplicated value bytes before reference overhead. Those figures motivated the user's subsequent approval to remove duplicate records only; no metadata removal, summary, truncation or scope restriction was authorized.

## v0.1.0: exact-record compaction and two-month live verification

Source `715ac9f` implements only exact duplicate-record encoding for DeepSeek. Lead verification collected/passed 74 backend tests and 60 provider tests (134 total, zero failed/skipped), using `python3 -B -m unittest discover -s backend/tests -v` and `python3 -B -m unittest discover -s tests -v`. Logs: `evidence/context-dedup-backend-tests.log`, `evidence/context-dedup-ai-tests.log`. Compilation and `git diff --check` passed. No frontend, original examples or original scripts changed against `12f49a1`.

Before the live test, all 232 saved baseline contexts round-tripped exactly and all 235 reconstructed request bodies shrank. Total HTTP JSON bytes fell from 38,703,226 to 17,207,983 (55.539%); user packet bytes from 34,582,621 to 14,598,577 (57.786%). See `evidence/deepseek-record-dedup-offline-20261016.md` and its JSON/CSV. This is offline serialization evidence, not a second 21-month live run or a measured token/cost saving.

The requested January–February 2025 live test completed as `sim_5136e2d4bc2544bdbb75d20f49b3cd11`: 18 logical calls, 18 successful attempts, no correction, fallback or rejected decision. Observed elapsed time was 20.034 seconds. DeepSeek reported 70,077 input tokens and 915 output tokens. Actual request bodies were 291,050 bytes versus 390,062 bytes for the same inputs serialized without deduplication (25.38% reduction). Final residents: 18,750; completed resident capacity: 125,000; jobs offered/filled/vacant: 52,000 / 11,250 / 40,750.

Both saved months passed engine invariants and matched HTTP-exported worlds and independently computed per-object totals. Completed same-key replay added zero calls. Independent review decoded all 18 contexts exactly and checked fingerprints and reference handling. Evidence: `evidence/context-dedup-two-month-live.json`, `evidence/deepseek-record-dedup-two-month-20261016.{md,json,csv}`. The earlier actual 21-month storage restart remains recorded above; no additional restart is claimed for this two-month run.

The release adds bilingual API/government handoff and historical-state reading guides, plus explicit README key-file placement. It packages source and evidence only; credentials and runtime save directories remain outside the archive. Release extraction checks are recorded beside the ZIP. Implementation/review agents used the session-approved GPT-6.1 Sol model; exact agent cost/token totals are unavailable. No comparative model-cost claim is made.

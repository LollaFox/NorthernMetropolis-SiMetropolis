# Independent integration review

2026-10-16. This first section records the initial offline/OpenAI baseline;
the subsequent DeepSeek and runtime review is recorded separately below.
The AI/CLI implementer independently reviewed `engine.py`,
`scenario.py`, `service.py`, `server.py` and `snapshots.py`; changes to those
shared modules remained with their authors. This is a focused correctness and
integration review, not a completed security audit or validation of forecasting
accuracy.

No unresolved blocker was found for the approved default scenario after the
following corrections and verification.

| Finding | Resolution and evidence |
| --- | --- |
| Existing fixture residents considered currently vacant jobs instead of their held assignments. Candidate mean wages were also multiplied by employment twice. | Fixture now uses actual employment, wage and commute for existing groups, expected conditions for candidates, and unemployment-adjusted wage once. Dedicated regressions pass. |
| Empty residential shells could count as nearby residents for firm selection. | Engine contexts expose current population/occupancy; fixture counts inhabited homes. A regression distinguishes empty shells from residents. |
| CLI sliced monthly events using the previous month's event count although engine events reset each month. | CLI saves the complete current events and audit. A two-month real-engine regression compares each audit entry with its immutable saved state. |
| Runtime API failures could leave saved months inaccessible to same-key retry. | API author made failures explicitly recoverable and retained observed attempts. The regression retries the same job after a second-month failure without reapplying the saved month. |
| Restarted sessions could overwrite earlier call totals; calendar projection could wrap at year boundaries; polling repeatedly loaded large saved worlds. | API author preserves prior session totals, tags attempts by execution session, keeps increasing display months, and caches immutable worlds with lightweight run metadata. Restart/chronology tests pass. |

Independent source review confirmed whole-response validation precedes resident
mutation; departures release jobs; arrivals use fixed groups and rotating
profile priority; surviving job assignments remain stable; firms keep their
preset capacities/wages/profit/GDP; rent starts the following month and is
recomputed; narratives and all completed shells have deterministic same-step
ordering. Current facts remain separate from synthetic prose and planned
objects. Station objects are never narrated.

A separate four-month custom-provider probe checked fixed arrivals, three
rejected rivals for a single slot, departure/job release, rent changing from
4000 to 4500 only in the following month, noncompounding rent, fixed firm funds,
explicit small-firm recovery, sanitized provider exceptions, exact nine-cell
contexts, station omission, immutable input and rejection of an invalid batch.
All assertions passed.

Independent service probes checked semantic initialization idempotency across
renamed PDF uploads, HTTP 409 semantics for changed input, confirmation gating,
four internal monthly states with two quarterly outputs, original-day calendar
clamping, sixteen fixture calls, and completed replay after restart with no new
provider creation. A sixteen-month projection probe crossed two year boundaries
with a constant display epoch; snapshot population and filled positions matched
canonical totals.

The local host binds loopback and inherits the existing Host/Origin checks and
static-root containment. PDF bytes are checked and digested, not retained or
sent to AI. In that baseline, explicit live mode read only the environment key; the fixed HTTPS
transport rejects redirects and retains no raw provider failure text. Default
demo generation explicitly selects the offline provider even when new API runs
are configured for live AI. HTTP errors and saved job errors omit raw exception
text. No live request was made during this review.

Exact verification executed by the independent reviewer:

- `python3 -m unittest discover -s tests -p test_ai.py -v`: 24 collected, 24 passed, 0 failed/skipped.
- `python3 -m unittest discover -s backend/tests -p test_engine.py -v`: 30 collected, 30 passed, 0 failed/skipped.
- `python3 -m unittest discover -s backend/tests -p test_service.py -v`: 10 collected, 10 passed, 0 failed/skipped, including actual HTTP and the unchanged frontend's JavaScript contract/session bridge. The initial sandbox attempt could not bind loopback; rerunning with authorized sandbox escalation passed all ten.
- `python3 -m backend.cli --output /private/tmp/nm-narrative-ai-current-20261016`: all twelve months saved, 50 residential towers, 12 business towers, 10 parks and 4 stations; 132 successful fixture calls and 7,296,714 input bytes; approximately 1.44 seconds on this machine. This measures fixture execution only. Evidence is in that directory's states, calls, audit and summary files.

Remaining material limits: one process must own a data directory; a remote call
interrupted before a durable monthly checkpoint may repeat on explicit retry,
and its uncheckpointed usage is unknown. The overview has 132 decorative sites
and cannot honestly express canonical geography or every custom script; V3
provides synthetic footprints rather than tower geometry. Inherited UI labels
and null-to-zero fallbacks remain disclosed in review/model/export responses.
The initial review did not verify live model semantic quality, account access,
reliability, runtime or cost. No model-cost comparison was performed; agent
total usage/cost and exact effort telemetry are unavailable to this reviewer.

## Follow-up: DeepSeek Flash, paced construction and durable progress

2026-10-16. The engine implementer independently reviewed the AI provider/pool
and the API author's startup/progress changes. These reviews used mock
transports and temporary dummy credential files; the reviewer made no live
requests and did not read the supplied credentials. No unresolved blocker was
found for the authorized single-simulation workflow.

- **Two-key pool:** both slots use the same provider/model in one simulation.
  An independent 44-request mock probe observed at most two concurrent
  requests, at most one per slot, 43 successful responses and one deliberately
  isolated error. Results retained input order, errors did not discard other
  decisions, and metrics contained slot/session identifiers rather than keys.
  The initial pool review also passed all 35 AI tests then present.
- **Startup and progress:** credential files are read silently by the explicit
  startup layer, with size/content validation and duplicate-key rejection.
  Public configuration and startup errors omit credential values and paths.
  The local host remains loopback-only; its default demonstration still uses
  `OfflineProvider` even when newly confirmed jobs use live AI. Provider
  callbacks run outside provider locks, then serialize atomic catalog writes
  under the service's reentrant lock. Progress and observed attempts survive
  before the first monthly checkpoint; resume combines previous sessions once.
  Six focused independent startup/progress/restart/demo-guard tests passed.
- **Construction and settlement:** optional residential pacing changes only
  the explicit government script. Five starts per month with a two-month
  duration completes all fifty residential towers by month 11; month 1 has
  construction sites and zero completed residential occupancy. Serial and
  two-slot fixture worlds matched throughout twelve months. Parallelism covers
  four resident decisions prepared from one pre-settlement state; narration,
  firm assignment and settlement ordering remain deterministic.
- **Format correction follow-up:** DeepSeek JSON mode still requires local
  exact-schema validation. One bounded correction can retry malformed or
  overlong decisions using the original context and an allowlisted validation
  label. It never copies the previous model text or raw error into the request,
  trims a failed answer into success, or retries refusals/filtering through
  correction. Tests retain both failed and successful attempts and usage,
  exercise exhausted correction and transient retries, and verify rejection
  after a failed correction.

After these changes, the documentation follow-up reran the current suites:

- `python3 -B -m unittest discover -s tests -p 'test_ai.py' -v`: 39 collected,
  39 passed, 0 failed/skipped.
- `python3 -B -m unittest discover -s backend/tests -v`: 53 collected,
  53 passed, 0 failed/skipped: 39 engine tests and 14 service/startup tests,
  including real loopback HTTP and the unchanged JavaScript client bridge.

The two-request concurrency bound belongs to each provider pool/run; simultaneous
separate jobs are not governed by a global scheduler. The approved live trial
uses one run. There is no cumulative call quota. Key-file paths are not sent to
the provider or saved in run artifacts. Credential values are used only for
provider authorization, and are omitted from scenario bodies and artifacts.

Supplied credentials authenticated in the lead's preflight. Subsequent live
runs and the provider-balance limitation are recorded with final counts,
runtime, usage and assessment in
[`VERIFICATION.md`](VERIFICATION.md). This review does not establish forecast
accuracy or a model-cost comparison; the geographic, display and interrupted
request limitations above remain applicable.


## Regional storage review

The AI implementer independently reviewed the storage implementation and ran
11 storage, 18 service/HTTP and 46 AI tests, plus 60 seeded JSON round trips,
eight malformed/hash/path cases, and interrupted-write continuation probes.
The engine implementer independently compared all 33 benchmark worlds,
including full audit state, and verified original saved-file hashes unchanged.
A corrupt reused-object issue discovered during review was corrected and
regression-tested before checkpoint `10e1cbd`. No storage blocker remained.
The service author verified all 21 regional fixture states and per-building
totals across service recreation with no new provider calls. See
`STORAGE.md` and `VERIFICATION.md` for current evidence and limitations.

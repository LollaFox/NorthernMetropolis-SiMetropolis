# v0.1.0 core verification and integration notes

Verified on **2026-10-16** against the unchanged unpacked source:

`/Users/ww/Documents/Codex/2026-09-23/zhe/work/backend-v0.1.0-2026-10-16/source/northern-metropolis-backend-v0.1.0`

## Verified regressions

| Source suite | Result | Duration | Scope |
| --- | --- | --- | --- |
| `backend/tests` | 74 passed | 5.366 seconds | Narrative model, persisted monthly states, jobs, HTTP bootstrap, real JavaScript V3 session, restart and provider configuration |
| `tests` | 60 passed | 0.068 seconds | Offline fixtures, mocked OpenAI/DeepSeek transport, schema guards, context encoding and metrics |
| Total original release tests | **134 passed** | | These are original-source regression results; integrated-project acceptance is a separate run. |

Both suites ran with bundled Python, bytecode writing disabled, and `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` removed from their process environment. Their transport tests use injected responses and temporary dummy credentials. No real credential file or live provider was used. The HTTP suite needs permission to bind temporary loopback ports; no browser was accessed. Original source files were not edited.

The independent `tools/verify_backend_core.py` smoke check uses an explicit `OfflineProvider`, a small configured scenario and a temporary data directory. It verifies source-date anchors across a year boundary, capacity/job reconciliation, immutable history browsing, idempotency and replay after restart. It never opens existing city saves or listens on a port. `--source-root` selects the unpacked release or integrated project without changing either.

The original-source smoke run passed **38 checks**, with canonical dates `2024-11-30`, `2024-12-30`, `2025-01-30`, `2025-02-28` and legacy display month indices `10`, `11`, `12`, `13`.

## Minimal integration required

1. `backend/server.py` imports `frontend.sandbox.server.Handler`, matching the release archive's nested layout. The existing 8893 project uses `sandbox/server.py`. Prefer the local `sandbox.server.Handler` when available, with a narrowly scoped compatibility fallback for the release layout if desired. Inheriting its `_static` implementation automatically serves **the existing `sandbox/web`** directory; do not copy or replace the archive's frontend over the current interface.
2. Two test fixtures also assume the nested release layout: `backend/tests/test_service.py` reads `frontend/sandbox/web/index.html`, and `backend/tests/contract_bridge.mjs` imports modules from `../../frontend/sandbox/web`. Their integrated copies need a compatible frontend-path resolver. This is a test-layout adjustment, not a reason to replace the original UI.
3. Keep the narrative store separate, for example `backend/.data`. Preserve the original **`sandbox/.data/city.json`**, including backups. The formats are different; the narrative service does not import or overwrite the old city. Use one active narrative process per data directory because storage uses atomic writes and in-process locking, not a cross-process ownership lock.
4. Launch the narrative host explicitly with `--provider offline` for this integration. The default is already offline. Startup demo creation explicitly passes `OfflineProvider` even when another runtime provider is configured. Live providers require an explicit provider choice and credential; importing modules does not start a provider or make a network request. This verification did not enable them.
5. The narrative server owns `/api/state`, `/api/model`, `/api/export`, replay controls and V3 initialization/jobs/snapshots/export. It deliberately rejects the old autonomous interventions, reset and branch operations. Existing local port/housing/school demos remain separate rule-based studies; they should not be presented as effects produced by the new narrative engine.

## Units and time must stay explicit

| Data | Correct interpretation | Integration implication |
| --- | --- | --- |
| `monthlyStates[].month` | Exact ISO source date, retaining the original anchor day | Use for canonical export/history labels. |
| `monthlyStates[].step` | Canonical simulation step | Do not replace with a frontend calendar index. |
| Overview `world.month` | Zero-based cumulative calendar index relative to the run's origin year; can exceed 11 | November-to-February example is 10, 11, 12, 13. |
| Overview `world.year` | Actual selected source-date year | Timeline default-year calculations must derive origin year, avoiding double-counting January after a year boundary. |
| Overview `sourceDate` / `sourceStep` | Exact date and step carried through the legacy projection | Preserve these when displaying or exporting the selected snapshot. |
| Overview `homes` / housing mesh capacity | Available **resident places** | Not flats, households or completed housing units. Existing local housing demo uses housing units and must retain its own units. |
| `actualResidents` / `population` | Settled group members | Do not equate with planned/available housing capacity. |
| `offeredJobs`, `filledJobs`, `vacancies` | Offered capacity, allocated filled positions and remaining capacity | Offered = filled + vacancies. V3 zone jobs expose filled positions only, avoiding double counting. |
| Rent / wages | Synthetic HKD per resident/month; HKD per employed worker/month | Not empirical prices or a calibrated affordability forecast. |
| Regional preset objects | Schematic development clusters, when the regional preset is chosen | Reference capacity is a scenario target, not an actual population result or a surveyed building count. |

`SavedCity` projects at most the existing 132 frontend sites in stable order. This is a decorative projection: visible district labels, distances, mesh heights and capacities are not geographic measurements. Canonical exports retain full monthly state and per-building tables outside this projection.

## Functional boundaries and execution review

- PDF upload checks signature and retains filename/digest/byte count. It **does not interpret policy text** and does not transmit the PDF to an AI service. The initialization review explicitly states that the configured construction scenario overrides the selected policy; retain the review/confirmation step.
- V3 terrain is synthetic flat zero; building footprints are zones. Road/rail/power lines and pollution are unmodeled, with no measured zero implied by empty layers. The inherited overview may show fallbacks for unavailable climate/finance values, so labels must preserve their unavailable status.
- The server binds to `127.0.0.1`; Host and Origin checks restrict local requests. Static file resolution keeps paths inside the current web root. JSON identifiers, dates, finite values, body sizes and confirmed versions are validated. Storage is JSON/gzip with digest validation and atomic writes; no pickle or shell execution is used by the active server.
- Offline startup performs deterministic simulation and writes only its designated narrative data directory. It may seed a labelled demonstration and create monthly state files; use `--no-demo` for an intentionally empty narrative store. The tests and independent smoke check use temporary directories.
- DeepSeek/OpenAI code is present and capable of outbound paid requests **only when explicitly configured**. No live behavior, measured policy prediction or credential validation is claimed by this verification.

The original 134-test release regression passed without a startup blocker. Integration still requires the import/static-root compatibility, isolated data directory and frontend time/unit labels above. Those modifications and the original 8893 host restart belong to the integration owner and must be verified separately.

# Frontend handoff — v0.1.0

Based on actual [v3-api.js](../../../frontend/sandbox/web/v3-api.js), [v3-contract.js](../../../frontend/sandbox/web/v3-contract.js) and [backend routes](../../server.py), not the original proposal. Frontend source is unchanged in this release. [中文版](FRONTEND_HANDOFF_ZH.md).

## API contract

All six established V3 routes are implemented. Schema: `nm-v3-draft-1`.

| Existing frontend API | Request → backend response |
| --- | --- |
| `GET /api/v3/config` | `schema`, `backendConfigured`, `transport`, `tileURL`, `synthetic` |
| `POST /api/v3/initializations` | Multipart `metadata` JSON + `plan` PDF → `initializationId`, `reviewVersion`, `items` |
| `POST /api/v3/initializations/{id}/confirm` | Exactly `{reviewVersion}` → `{confirmed:true,reviewVersion}` |
| `POST /api/v3/simulations` | Exactly `{initializationId,reviewVersion}` → HTTP 202 `{jobId,status}` |
| `GET /api/v3/jobs/{id}` | Durable status, progress, `providerMetrics`; completed job includes `result` with simulation/snapshot IDs |
| `GET /api/v3/simulations/{sid}/snapshots/{frame}` | Existing raster/vector snapshot contract; use returned frame IDs |

Each POST requires its own `Idempotency-Key` (1–100 letters/digits/underscore/hyphen). Retry the same operation with the same payload/key; changed payload with a reused key returns 409. A recoverable failed job resumes through the original simulation POST/key. Completed replay makes no new calls. Setup uses the existing bounds/dates/step contract; start date must precede today. The PDF is signature-checked (20 MB maximum) and hashed, but its text is not interpreted. The configured government JSON determines construction.

**New API to integrate:** `GET /api/v3/simulations/{sid}/export`. Returns `schemaVersion, run, setup, review, scale, monthlyStates, monthlyBuildingTotals`. Each totals entry is `{date,buildings:[...]}`; building rows contain `id,type,x,y,housingCapacity,plannedHousingCapacity,actualResidents,offeredJobs,filledJobs,vacancies`. Join canonical objects by `id`; there is no separate totals endpoint. Cache exports per completed run instead of polling this large response.

| Legacy frontend route | Actual backend support |
| --- | --- |
| `GET /api/state`, `/api/model`, `/api/export`, `/api/health` | Supported; state is a schematic saved-world projection |
| `POST /api/control` with `playing` / `speed` | Saved replay only; speeds 0.5, 1, 2, 4, 8; no AI execution |
| `POST /api/seek` with `{month}` | Exact value from `/api/state.timeline[i].month`, not the array index |
| `POST /api/switch` with `{id}` | Select existing run's latest saved month |
| `POST /api/mode` with `{mode:"rules"}` | Accepted no-op |
| `/api/mode` with live mode; POST `/api/branch`, `/api/intervention`, `/api/reset` | **Unsupported, HTTP 409** |

No HTTP government editor, job cancellation/pause, PDF-policy interpretation, transport/pollution/power forecast or V3 tower-mesh channel. `backendConfigured` does not mean a live provider is available. `/api/state` advertises rules replay even for saved DeepSeek runs; use V3 job/result `providerMetrics` for provider outcomes. Completion alone does not imply every AI attempt succeeded.

Unknown V3 routes and unknown GET `/api/*` routes return 404; unsupported legacy POST operations return 409.

## Frontend changes to make

1. **Expose Team API and saved replay clearly; disable unsupported actions.** [analysis-compact.js](../../../frontend/sandbox/web/analysis-compact.js), [app.js](../../../frontend/sandbox/web/app.js), [index.html](../../../frontend/sandbox/web/index.html), [port-study.css](../../../frontend/sandbox/web/port-study.css): inherited policy/demo panels currently obscure this distinction.
2. **Persist and resume jobs.** [v3-api.js](../../../frontend/sandbox/web/v3-api.js): persist setup, operation keys, initialization/review/job/run IDs across reloads; extend the 120-poll window (the full live baseline took 355 seconds), show monthly progress and failures. “Stop waiting” must not imply server cancellation.
3. **Fix units.** Regional objects are development clusters. Housing capacity counts resident places, not flats; separate actual residents from capacity and offered/filled/vacant jobs. Overview jobs are offered capacity; snapshot zone jobs are filled positions. Use each export's `scale` metadata.
4. **Use canonical export and add object details.** [analysis-compact.js](../../../frontend/sandbox/web/analysis-compact.js) currently exports a client summary. Download the new export and show per-object totals plus planned/construction/complete stages from `monthlyStates`; snapshots omit incomplete objects. Do not derive durable IDs from zone display names.
5. **Show unavailable values honestly.** [app.js](../../../frontend/sandbox/web/app.js) zero-fallbacks can mislabel unmodeled climate/finance/power data. Display “unavailable”; preserve grid coordinates and excluded-land semantics in [v3-map.js](../../../frontend/sandbox/web/v3-map.js). Map positions are schematic.

## Government construction: exact files

**Edit a copy of [backend/examples/northern-metropolis-scenario.json](../../examples/northern-metropolis-scenario.json).** Add examples as `backend/examples/<name>.json`; existing default and parks-first examples are in the same folder. A construction row is:

```json
{"id":"R001","type":"residential","x":1,"y":0,"startMonth":1,"completionMonth":2}
```

Types: `residential`, `business`, `park`, `station`; IDs/cells must be unique. Month 1 is the requested start date; specify start and completion explicitly. Suggested new comparisons: transit-first, business-first, slower housing.

```sh
python3 -B -m backend.cli --scenario backend/examples/<name>.json --start 2025-01-01 --end 2026-09-01
python3 -B -m backend.server --port 8878 --scenario backend/examples/<name>.json --data-dir backend/.data/<name>
```

Replace `<name>` before running. Use `--scenario` or `--preset`, not both. Optional residential pacing flags override residential dates. Loading: [cli.py](../../cli.py) `configured_scenario`; generation/validation/pacing: [scenario.py](../../scenario.py); construction execution: [engine.py](../../engine.py) `_construct` / `advance_month`. Restart with the new script and create a new initialization; existing runs retain their script. AI does not write the government plan. Demolition, tax, subsidy and land-sale examples require engine extensions, not extra JSON fields.

For saved data, use the separate [city-history guide](CITY_HISTORY_EN.md). Key placement is in the root [README](../../../README.md).

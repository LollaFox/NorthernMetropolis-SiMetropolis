# Northern Metropolis · Integrated Policy Sandbox

**H3-round-2-right-ui-2026-10-17** · local integration snapshot, not a new upstream release.

The original English H3 frontend and 3D city (Original material by default, optional White study model) run together with the teammate’s **v0.1.0 narrative backend**. The existing `sandbox/web` remains the UI; `backend/server.py` serves it on the same local origin. No separate frontend build or dependency installation is needed. Python 3.9+ and a browser with WebGL2 are required.

## Start and preview

On macOS, double-click **`start.command`**, or run from this folder:

```sh
python3 -B start_integrated.py
```

Open **http://127.0.0.1:8893/**. Keep the terminal running. The launcher detects an existing narrative server on this port and avoids starting a second one. To check it without changing anything:

```sh
python3 -B start_integrated.py --check
```

The default is explicitly **offline**. No DeepSeek key is read and no paid model request is made. Startup prepares or reuses a saved 21-month synthetic regional example, from **2025-01-01 to 2026-09-01**. The integrated UI opens **Analysis sandbox**. The top-right **Analysis history** opens saved results at their first simulation month; the month is taken from the stored run, not fabricated after today.

## What to try

1. **Analysis history** beside **Analysis sandbox** lists saved backend cities and analyzed local port/housing/school cases, with search and source filters. Opening a backend record uses the original analysis shell. Choose a saved run and **Result month**, or use **← / ▶ / →** to step back, play/pause and step forward. Playback advances one saved month per 1.6 seconds and stops at the end. Manual selection pauses playback. New buildings ease upward over 0.65 seconds; this is a visual transition, not an additional calculation. The canonical date selector also includes intermediate months when API snapshots are quarterly. History browsing makes no new model call.
2. Select a city object, then **Saved object details**, or use the object selector in the result panel. Counts and construction stages are joined by persistent object ID and exact source date.
3. The bottom dashboard shows four source-specific headline values, prior saved-month changes and one selectable chart. The full-period trend axis stays fixed while the month marker changes. **Data & units** opens the exact table. **Evidence** opens mechanisms, evidence limits and selected-object details without duplicating city-wide charts. Uncheckable generated narrative is withheld from the main conclusion; original exports remain intact. **Export study** downloads the complete canonical backend export.
4. **Analysis sandbox → Configure → Analysis mode → Team API** is the fixed server construction script. Explicitly select that purpose, set dates and attach the PDF required by the current API. Save settings, **Review server script**, read/acknowledge the initialization review, then confirm. Selected tags and the PDF do not drive construction. Progress is shown. **Stop waiting** stops client polling only; **Resume analysis** on the main button retrieves the saved operation. A browser reload does not automatically submit a new job.
5. Fresh users start in **Local scenario models**. Choose the study area and tags, optionally **Configure**, then **Start analysis**. The labels **Housing supply** and **School places** name the current capacity models. The compact **Scope & limits** line explains mechanism, units, sources and missing outcomes. The small Tags → Configure → Analyze animation remains an illustrative workflow preview, not an active simulation.

6. After opening results, use **2D analysis** on the right. The compact right entry expands into a dark dock with a full-width light plan. Click an icon-and-text theme button to switch the plan; **Result month** and saved replay arrows update it. Backend themes show construction, residents, resident-place capacity, filled jobs and station objects on the canonical schematic grid. Port maps use assumed links; housing/school maps use one aggregate area marker. **Data & comparison** keeps detailed provenance and limitations collapsed; **Change symbols** opens the reusable eight-mark legend. This adds no model call or geographic data.

## What controls a backend scenario

**The server’s government construction JSON controls construction. Uploaded PDF text is not interpreted. Policy tags are request context and do not rewrite that JSON.** The confirmation review explicitly discloses this. To change the government schedule or location, edit a copy of `backend/examples/northern-metropolis-scenario.json` and start the server with `--scenario` instead of `--preset`, using a new data directory. See [backend guide](backend/README.md) and [teammate API handoff](backend/docs/releases/FRONTEND_HANDOFF_ZH.md).

The regional preset’s 132 objects are **synthetic development clusters**, not actual individual buildings or surveyed projects. Residential capacity is **resident places**, not dwelling units. Actual residents, offered jobs, filled jobs and vacancies remain distinct. Grid and overview locations are schematic. Climate, electricity, observed traffic and school/medical service supply are unavailable in this backend and are not shown as measured zero.

No matched no-policy counterfactual is supplied. Trends and synthetic satisfaction do not establish causal policy effects, real prediction accuracy or GenAI benefit. DeepSeek integration exists in the backend, but was not enabled or live-tested in this merge.


## Navigation

Top right: **Analysis sandbox · Analysis history · Map appearance · Settings · Help**. Map appearance is directly beside Settings. Startup uses **Original material**; White study model remains an option. Material choice is presentation only and resets to Original material on reload. **Evidence** beside the month control opens the concise evidence panel. The bottom dashboard displays charts and headline values directly after an analysis or opening history; the floating panel is closed by default. General settings hold rendering quality, source status, model/data information and Clear view; per-analysis inputs remain in Configure. History browsing never reapplies a local policy or submits a new model run. Local cases stay in browser storage; backend cities stay on the local server. This is a unified index, not cloud synchronization.

## Source map and storage

| Location | Responsibility |
| --- | --- |
| `sandbox/web/index.html`, `app.js` | Original English interface and overview |
| `sandbox/web/backend-workspace.js` | Saved runs/dates, session recovery, export cache and integration |
| `sandbox/web/backend-results.js` | Canonical date/ID joins, units and concise evidence/object details |
| `sandbox/web/analysis-dashboard-model.js`, `analysis-dashboard.js` | Source-specific headline values, chart selection and month synchronization |
| `sandbox/web/plan-analysis-model.js`, `plan-map.js`, `plan-analysis.js`, `plan-analysis.css` | Source-specific SVG plan layers, fixed full-period extents/scales and result-month synchronization |
| `sandbox/web/change-symbols.js` | Eight reusable accessible change marks; no causal or confidence claim |
| `sandbox/web/analysis-capability.js`, `analysis-capability.css` | Compact descriptions of known local adapters and fixed-script limitations; not a server capabilities endpoint |
| `sandbox/web/dashboard-chart.js`, `evidence-gate.js` | Compact charts and conservative presentation review; no independent truth verification |
| `sandbox/web/backend-overview.js` | Backend overview labels, missing values and month mapping |
| `sandbox/web/v3-api.js` | API transport, durable job polling and explicit resume |
| `backend/server.py`, `service.py` | One-origin HTTP service, narrative jobs and history |
| `backend/examples/` | Configurable government scenarios |
| `backend/.data/integrated-offline/` | Current narrative history, created locally and ignored by Git |
| `sandbox/.data/` | Preserved original city save; not migrated or overwritten |

Use one server per data directory. Keep the whole narrative history directory when transferring saved runs; do not edit its individual gzip/shared records. The distributed source ZIP excludes runtime saves, credentials, caches and historical backups. It regenerates the offline demonstration on first start. Original frontend/Three.js notices and teammate source notices are preserved.

## Verification

Right-dock UI checks on **2026-10-17**: **513 JavaScript tests passed**. HTML nesting, 270 unique IDs, 44 root JavaScript modules/imports and 24 served resources passed. Read-only history checks left every saved file unchanged. Relative to the preceding left-dock source ZIP, only index.html and plan-analysis.css changed in product code. The entry and expanded dock are right-aligned at desktop and mobile breakpoints; the indicator and reveal direction follow that placement. Data adapters, materials, calculations and backend code remain unchanged. This is not new browser-layout or GPU acceptance.

Browser automation was blocked by its local-URL policy. No new browser screenshot, GPU/layout acceptance or live DeepSeek quality claim is made. Refresh the original 8893 tab to inspect the result.

This is **round 2 of 3**, scoped by the latest request to materials, plan analysis and change symbols. Policy-to-versioned-plan binding remains unimplemented; the third comparison/evidence round is also pending. See the [current right-dock UI guide](docs/右侧分析栏位置修正_2026-10-17.md) and the [round 2 guide](docs/第二轮_平面分析与符号库说明_2026-10-17.md) and [reusable change-symbol API](docs/变化符号库调用说明.md). The [original three-round plan](docs/三轮改进计划与第一轮说明_2026-10-17.md) is retained as historical guidance, with this guide taking precedence for round 2 scope.

Read the [bottom dashboard and evidence guide](docs/底部数据看板与证据过滤说明_2026-10-16.md), [navigation/history review](docs/导航与分析历史审查_2026-10-16.md), [monthly replay guide](docs/按月回放与API核对_2026-10-16.md), [Chinese merge/usage handoff](docs/前后端合并说明_2026-10-16.md), [current version](CURRENT_VERSION.md), [backend history guide](backend/docs/releases/CITY_HISTORY_ZH.md) and [core verification](docs/backend-core-verification.md). Earlier frontend-only handoff files remain historical references; the implemented backend contract and this integration note take precedence for this version.

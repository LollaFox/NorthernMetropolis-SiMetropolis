# Compatibility review against executable frontend code

Inspected 2026-10-16. Source baseline: `12f49a1`. The handoff proposal is background, not the implementation authority.

| Actual consumer | Observed requirement | Backend response / limitation |
| --- | --- | --- |
| `v3-api.js: V3Session.initialize` | multipart metadata and PDF, stable operation key; validates review | Retain uploaded PDF content digest as supplied evidence, disclose no automatic extraction or policy inference. Government JSON script is authoritative. |
| `v3-api.js: confirm` | same reviewVersion, confirmed true; unresolved items block | Review exposes all chosen synthetic defaults before acknowledgement. |
| `v3-api.js: resolveJob` | queued/running jobId; complete result; failed error; 120 polling iterations | Async jobs and durable status. If UI stops waiting, retry original operation; work is not canceled. |
| `v3-contract.js: schedule/runResponse` | month/quarter/year, original day clamped each target month, at most 240 returned frames | Monthly internal computation; return only dates on requested output schedule. |
| `v3-contract.js: snapshotResponse` | ordinary 1,000,000-element height and land arrays; pollution 4x5000 sentinel; required vector arrays | Project logical synthetic cells into full raster. Flat height is a synthetic surface, not measured elevation. No fabricated pollution or routes. |
| `v3-map.js: V3Map` | hides legacy buildings; terrain sampled every 10 cells; only line/pollution overlays | API result map shows cell zones, not tower meshes. No building object channel exists in this mode. |
| `analysis-compact.js: loadFrame` | zone cards use population, satisfaction, jobs; hardcoded Team API result label | Include synthetic scope in zone names/types and review. Core job categories explicitly show filled positions; capacity/vacancy detail remains in canonical export. |
| `app.js: applyState`, `city.js: update`, `architecture.js` | legacy /api/state uses building kinds housing/office/park/transit, numeric month, world metrics | Backend-only facade can show new engine through existing 3D assets. Canonical grid stays separate from schematic legacy site layout. |
| `app.js: renderInspector/renderAI` | labels housing capacity as Homes; call display uses requests/limit; missing metrics fall back to zero | Describe resident-place capacity and unmodeled finance/climate explicitly in model notes; no invented measured values. No server-side total call cap. |
| `v3_gateway.py` | fixed backend routes; upstream response 48 MB; 25 second upstream timeout | Immediate async response; complete raster comfortably within limit. Backend can serve same assets and routes directly. |

## Reuse assessment

The handoff engine gives construction and investment choices to government/business/resident AI, models variable migration, and includes unrelated energy/economic dynamics. Those behaviors are incompatible and are not imported into the redesigned numerical engine. Its `ai.py` requires a missing `sandbox_v1/server.py`, so it is not a usable provider transport in this package.

Existing request validation, 3D city geometry and local HTTP/static-serving behavior are useful unchanged interfaces. The bundled Three.js MIT notices remain intact. No external code/dependency is added. The owner's previous project license permits private research/collaborator work; this work neither republishes nor relicenses original handoff material.

Older bounded construction and separate port forecast patterns support auditable decisions and explicit source labels, but their actions, budgets, flows and forecast quantities do not define this engine. New backend algorithms are independently implemented from the requested rules. Exact provider implementation is documented in AI notes; configured model capability is distinct from a measured live outcome.

## Acceptance boundary

Offline tests establish engine arithmetic, failure handling, persistence and frontend schema integration. They do not establish AI narrative quality, real provider reliability, geographical accuracy, or predictive validity. The unmodified frontend's own hardcoded policy catalogue, schematic backgrounds and labels remain UI limitations. The backend does not claim that its fixed-GDP growth alone demonstrates a successful policy.

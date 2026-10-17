# Sandbox v2 Wibe test flight
Lead-owned 2026-09-30. User requests working 3D city game and hybrid LLM/rules engine; confirms Northern Metropolis-inspired local/internal prototype, license undecided.
Approved: local Three.js 0.180.0 vendoring (MIT); existing Python/Node/Wibe/Playwright; current lead unable to switch model; explicit GPT-6.1-sol/xhigh implementation and independent Astra/high review; existing provider config reuse by ignored symlink; <=6 live verification requests at <=8192 input bytes and 768 output tokens.
Start: task branch codex/sandbox-v2 based on 05e03ee; original detached worktree 06b73e8 was clean. Existing v1 sources preserved.
Baseline: 43 Python + 37 Node tests pass after loopback permission. First sandboxed Python run blocked server socket; recorded as environment limit, not product failure.
One Wibe task owns new v2 product in this repository. Parallel file ownership inside that task; manual adapter used with real collaboration workers. Independent reviewer evidence retained and CLI review explicitly lead-attested. No claims of automatic reviewer authentication.
Milestones: freeze contract; pure rule engine and 3D UI in parallel; integrate asynchronous live AI and persistent branching; browser/HTTP + invariants; independent review/repairs; Wibe acceptance/integration and final local commit.
Recovery: branch from existing revision, scoped edits, Wibe snapshots plus external backups at safe intervals; no reset/clean. No public release, global tools, license changes, or Wibe source edits.
Agent routing: initial inherited-model read-only tasks interrupted to correct policy after user reminder. Subsequent bounded research gpt-6-luna/high; simulation/UI gpt-6.1-sol/xhigh; independent review gpt-6-astra/high. Root exact model/effort not exposed; token/cost unknown.


## Regional experience revision

The user rejected the generic city presentation and chose a believable Northern Metropolis future. The Three-Body reference calls for an explorable society whose changes are experienced, not only summarized. Lead contract: evidence/region-v21-contract.md. Recovery baseline a014620; checkpoint d388d19 preserves the first stable interface and instancing foundations. Wibe attempt 77c829b2-7ce7-4c5b-8a54-6ec660c8a4e7 uses implementation.frontend@1.1.0 and web.frontend.

This revision maps existing logical parcels into four geographic lenses without changing backend quantities or saved coordinates. It adds regional terrain/wetlands, distinct district architecture, efficient instanced facades, existing/planned transport context, street exploration, day/dusk, projected labels, current-change focus and a more compact interface. File ownership remains disjoint: GPT-6.1-sol/xhigh renderer and geography workers; lead interface and integration; independent Astra/high review. Bounded Luna/high official-source research was inspected by the lead. No new dependencies, provider calls or configuration changes are required.

Success requires current checks: existing 49 Python tests; deterministic mapping and temporal-summary tests; actual browser navigation, rewind/branch/policy/selection/mobile checks; dense-scene measurements; desktop/mobile visual inspection; independent reviewer approval and Wibe verification/acceptance/integration. The old receipts remain historical evidence, not proof of revised behavior. Release is still local/internal, license undecided.


## Folder replacement after review

The user clarified that the reviewed v2 should physically replace the primary `sandbox/` folder in `/Users/lollafox/Gen AI Hackathon`. This relocation starts from reviewed revision `3142a8a` on `codex/sandbox-folder-v2`. The original v1 folder is preserved as `sandbox_v1/`, v2 now occupies `sandbox/`, and the relative `sandbox_v2 -> sandbox` symlink supports earlier v2 module commands. The test-flight records above and files under `evidence/` retain their historical paths.

Canonical launch is `python3 sandbox/server.py --port 8877` or `python3 -m sandbox.server --port 8877` from the repository root. Direct script launch accepts an absolute path from another working directory. Active tests import `sandbox`; regular verification is `python3 sandbox/tests/run_checks.py`, the 20-check geography/renderer suite, and the 22-check canonical browser journey. Focused relocation tests use synthetic mocked configuration and no provider calls.

The existing configuration stays at `sandbox/.env`; ignored `sandbox_v1/.env` points to it, and v2 imports the byte-identical legacy provider transport from `sandbox_v1/`. Current saves and captures use ignored `sandbox/.data/` and `sandbox/.artifacts/`. Existing save/evidence contents, provider settings, security controls, licensing, model behavior and dependencies are preserved. Recovery remains available through the original v1 folder and the reviewed source revision.

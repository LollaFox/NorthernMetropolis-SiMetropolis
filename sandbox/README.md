# Northern Metropolis — sandbox 2.0

A local 3D city game inspired by the Northern Metropolis. Housing, employment, construction, transport, energy and air quality change as the simulation runs. You can intervene, rewind, and branch to explore another future. The primary `sandbox/` directory contains v2. Original v1 remains under `sandbox_v1/`, and the relative `sandbox_v2 -> sandbox` symlink preserves older v2 commands.

## Run

From the repository root:

```sh
python3 sandbox/server.py --port 8877
# Equivalent package command:
python3 -m sandbox.server --port 8877
```

The direct script also works from another directory when supplied its absolute path. The compatibility command `python3 -m sandbox_v2.server --port 8877` still works from the repository root.

Open http://127.0.0.1:8877 . Python 3.9 or newer is sufficient. No package installation, frontend build, external map tiles or CDN is required. Three.js 0.180.0 is vendored with its MIT notice. A browser with WebGL2 is needed for the 3D view.

Choose a district lens—Hung Shui Kiu, San Tin, Kwu Tung or Ta Kwu Ling—to explore the regional scene. **Enter the city** switches to street level: drag to look, use WASD or the arrow keys to move, and select a development to inspect it. **Regional view** returns above the city. Day/dusk changes lighting only; it does not change simulation time. Objectives, society activity and model information are accessible from the header.

The first city runs automatically in **rules mode**. A restored save opens paused. Drag to orbit, scroll to zoom, and click buildings to inspect them. Time controls support pause, 0.5× through 8× speed, and seeking an exact saved month. Resuming or submitting a policy while viewing history creates a new branch and preserves the original future. Use the branch selector to return to it.

The policy box accepts supported city interventions and business strategies. Recognized actions are settled against the current resources and construction rules. Unrecognized prose remains an explicitly labeled proposal for the societal agents; the rules parser does not pretend to understand every possible policy.

## Persistence and recovery

The server saves history and branches atomically to ignored `sandbox/.data/city.json`. Use Export for a separate JSON copy. On restart, live mode is disabled until selected again, while its request ledger remains preserved. Corrupt saves are not overwritten. Run `--no-save` for a temporary world or `--save /path/to/city.json` to use another local save.

The server must keep running for simulation time to advance. Closing the browser does not stop the server's clock; closing the server does. There is no hosted process or background system service. Branch histories are kept in memory and local JSON; very long histories need a future indexed storage design.

The regional renderer shares instanced geometry and locally generated facade textures across developments. A development parcel may contain several visual blocks, with capacity counted only once. The fixed 132 model sites have stable visual addresses across construction, redevelopment, rewind and branch changes. Background towns, trains, streets and terrain provide geographic context without adding economic capacity. Rendering measurements for this revision are recorded separately from the original v2 test flight in evidence/. Hardware GPU performance has not been established.

## AI and rule engines

The rule engine owns all quantities, costs, lead times, capacity, cash and environmental accounting. It is a pure deterministic transformation. Rules mode chooses role actions locally from the same constrained catalog.

Live mode asks four roles—government, business, residents and energy—to choose actions using their own state, public rule-engine observations, user proposals and attributed messages from other roles. The AI worker runs independently of the physical simulation and web requests. It returns proposals, which are revalidated against current state at the next tick. Responses from an old branch or policy generation are discarded; responses older than 24 simulated months are also discarded. There is no silent substitution of rule decisions for failed live decisions.

The provider adapter reuses the existing v1 fixed OpenAI/DeepSeek endpoints and server-side configuration loader. The existing configuration remains at ignored `sandbox/.env`, and ignored `sandbox_v1/.env` points to that same file. The adapter imports the unchanged v1 transport from `sandbox_v1/`; keys are not copied into source, browser state or exports. On another machine, follow the [v1 provider setup instructions](../sandbox_v1/README.md) separately. Without a configured provider the game still works in rules mode.

Each request has at most 8,192 serialized input bytes and 768 output tokens. Requests are sequential, roles rotate, and the server default is a visible **24-request session allowance** (`--live-request-limit`, 0–100). Successful, failed and stale attempts count. An error suspends further AI calls until live mode is selected again; the physical city continues. Reaching the allowance also stops AI calls. Selecting rules mode resumes local autonomous role decisions. The test flight has a separately approved maximum of six live verification requests; normal tests never call a provider.

## Model validity

This is an exploratory scenario model, not an empirically calibrated forecast. Population and coefficients are synthetic. The map is an original compressed Northern Metropolis schematic informed by official planning sources; district lenses are navigation aids rather than official zone boundaries or cadastral coordinates. Existing and planned transport references are visually distinguished. Planning targets do not become completed infrastructure simply because simulation time passes. The Three-Body reference informs experiential discovery and alternative histories; this build does not implement headset VR. More convincing geometry or more LLM roles does not establish predictive accuracy. [MODEL.md](MODEL.md) documents equations, assumptions, units and action costs. Real forecasting needs local datasets, historical calibration, out-of-sample backtests, uncertainty ensembles and expert review. Those have not been completed.

## Verification

```sh
python3 sandbox/tests/run_checks.py
node --test --test-reporter=tap sandbox/tests/test_geography.mjs
python3 -m unittest discover -s sandbox_v1/tests -q
node --test --test-reporter=tap sandbox_v1/tests/test_story.mjs sandbox_v1/tests/test_environment.mjs
```

The first command emits positive normalized test counts for Wibe. The final two commands cover the preserved legacy implementation. HTTP tests need permission to bind an ephemeral loopback port. The browser journey uses the existing Playwright runtime and Chromium, bound through Wibe's local device profile; it launches its own temporary server with live calls disabled. The regional revision passed 49 Python checks, 20 geography/renderer checks and 22 browser checks before its final Wibe gate. Independent Astra review approved the repaired source after reproducing both earlier defects against the pre-fix version. The software WebGL benchmark measured approximately 26 FPS at 42 parcels and 17 FPS at 132 parcels at a 1512 × 982 viewport with adaptive 0.75 pixel ratio; this is not a hardware-GPU performance claim. See [evidence/](evidence/) for observed verification, provider audit and Wibe test-flight results.

The explicit paid smoke script `tests/live_smoke.py` is excluded from test discovery. Do not rerun it casually; its four requests count against the separately approved flight budget.

## Wibe test flight and recovery

Wibe 1.2 composes and pins the project contract, then tracks the manual implementation task, test evidence, independent review and browser integration. Root owns the plan; separately assigned agents implement the model and UI. Wibe's one-active-task-per-repository restriction means parallel implementation is coordinated inside a single Wibe task with disjoint file ownership. Manual CLI review records are lead attestations backed by the independent reviewer output, not authenticated automated-review records.

The original test flight began at `05e03ee` on `codex/sandbox-v2`. The subsequent folder replacement starts from reviewed revision `3142a8a` on `codex/sandbox-folder-v2`. Historical evidence in `evidence/` retains the paths used during those reviews. Original v1 source and exports are preserved under `sandbox_v1/`; run `python3 sandbox_v1/server.py --port 8765` to open v1. Current v2 saves and captures live under ignored `sandbox/.data/` and `sandbox/.artifacts/`; the compatibility symlink reaches those same directories.

Original software in this repository is covered by the [SiMetropolis Decision Sandbox Restricted License](../LICENSE). Use is permitted only to members of the SiMetropolis team in the Inter-University GenAI Hackathon for SDGs and to that competition's judges. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependency provenance. The vendored Three.js files remain under their own MIT notice.

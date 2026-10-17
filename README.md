# Northern Metropolis · Integrated Frontend and Backend Product

This directory is a standalone runnable version. It uses the new frontend from `D:/Metropolis/Front/northern-metropolis-white-model` and brings in the earlier dual-scenario setup, the fiscal and resident model, and the government large-model capability. The source directories stay as they are, so you do not need to switch between two projects.

## Start

On Windows, double-click `start-product.cmd`. That launcher finds Python 3.9 or newer without adding it to PATH. If none is installed, the first launch downloads a private copy into `runtime/` and does not change system settings.

macOS does not support double-click. In Terminal, from this folder, run:

```sh
python3 -B start_product.py
```

The browser opens http://127.0.0.1:8898/ when the server is ready, and Configure opens with the page. Close the terminal to stop the service. Do not start two processes that use the same data directory at the same time.

This sandbox does not run offline. In Configure, choose a government script and enter a DeepSeek API key. The key is sent only to this local server for building narratives and is not saved in the browser. Government decision AI and PDF upload are disabled.

## Using the web app

1. Click Configure, or click Configure analysis before the first run. Both open the same settings.
2. Choose a government script: Default City, Function Zones, or Mixed Zones.
3. Choose how many years to simulate, from 1 to 5. Later years in the five-year script are not run.
4. Enter a DeepSeek API key in the page. A run cannot start without one. The launcher does not read a key file.
5. Save settings, then Start analysis. Review the assumptions and confirm the run.
6. At the bottom, view population, jobs, and construction progress month by month. Each script asks DeepSeek for a narrative on each completed building. Government start-date decisions stay on the fixed schedule.
7. Analysis history opens saved results. Export study downloads the saved run. After a refresh, enter the key again before resuming an unfinished task. Stop waiting does not cancel the backend task.

The DeepSeek key is used for per-building narratives. It is not used to decide when the government starts projects. That government-decision mode is disabled.

## Saving and failures

- `backend/.data/product/`: tasks, history, and full monthly archives for this product. Data from the old project is left unchanged.
- Government inputs and outputs are saved every month. Replay reuses the saved decisions and does not ask the model again.
- If the API errors, a project is illegal, or the budget is exceeded, the task fails and the completed months are kept. You can resume the original task. There is no silent rule-based fallback.
- If the process is killed after the API has already run but before that month is saved, recovery may repeat that call. The request count shown in the UI is not the number of simulated months.
- A successful finish means the selected months have been run. It does not guarantee that every construction target is complete.

## Verification and limits

94 backend tests and 513 frontend tests pass. A real Chrome browser has run the offline government mode for both scenarios: configure, review, 24 months, month switching, fiscal and decision display, and refresh without creating a duplicate task. The live provider path was verified with simulated HTTP responses. A paid online model integration has not been run yet.

The original 3D overview is still a schematic projection. Use the 2D analysis for the exact layout. Results include assumptions and are not a city forecast. There is no automatic side-by-side comparison page. Select two independent results from history and export them to compare. Source and feature notes inherited from the frontend are kept in `docs/FRONTEND_SOURCE_README.md`.

Verification commands:

```powershell
python -B -m unittest discover -s backend/tests -q
$env:PYTHON="python"
node --test sandbox/tests/test_*.mjs
```

Browser check script: `tools/check_product.mjs`. It depends on an existing Playwright installation and Chrome. Use `PLAYWRIGHT_PATH`, `PRODUCT_BASE`, and `PRODUCT_LAYOUT` to set the module, service address, and scenario. This script only runs offline tests.

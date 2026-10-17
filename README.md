# Northern Metropolis · Integrated Frontend and Backend Product

This directory is a standalone runnable version. It uses the new frontend from `D:/Metropolis/Front/northern-metropolis-white-model` and brings in the earlier dual-scenario setup, the fiscal and resident model, and the government large-model capability. The source directories stay as they are, so you do not need to switch between two projects.

## Start

On Windows, double-click `start-product.cmd`, or run:

```powershell
python -B start_product.py
```

Open http://127.0.0.1:8898/ . The default is offline: it does not read a key and does not call an API. Close the terminal to stop the service. Do not start two processes that use the same data directory at the same time.

To use the real government model:

```powershell
python -B start_product.py --live --model deepseek-flash --api-key-file "full path to your DeepSeek key file"
```

You can also set the `DEEPSEEK_API_KEY` environment variable and omit `--api-key-file`. The key is used only on the backend and is never entered in the web page. An existing key file can be referenced directly; there is no need to copy it into this directory. After the online service starts, a call is made only when you select the live government option on the page and confirm the review. Browsing, history replay, and export do not make calls.

## Using the web app

1. Click Configure. Under Analysis mode, select Team API.
2. Choose a functional zone or a mixed layout. Each of the two scenarios has 2 commercial buildings, 2 residential buildings, and 2 parks. Each run is saved on its own.
3. Choose a government mode: Fixed schedule, Government test (an explicitly labeled offline test), or Government AI (the real API). The third option is unavailable when the live backend is not enabled.
4. Check the dates and fiscal parameters. The default is 24 months. A fixed schedule finishes in 17 months. The AI decides when construction starts and does not guarantee that everything finishes inside the window.
5. Check the box to use the selected scenario, then click Use test PDF (placeholder attachment) or upload a PDF. The PDF body is not parsed.
6. Save settings → Review scenario → confirm the assumptions → run.
7. At the bottom, view population, jobs, and construction progress month by month. Click Evidence to see that month’s government decision, reasons, project budget, spending, tax, and project status. The 2D analysis on the right shows the layout on the exact model grid.
8. Analysis history opens saved results. Export study downloads the full history and decisions. After a refresh, an unfinished task can resume waiting with Resume analysis. Stop waiting does not cancel the backend task.

Government AI only decides when scheduled projects start construction. It cannot change location, type, quantity, duration, tax rate, or budget. Residents, firms, commuting, finance, and construction all use rules. When you choose an original server scenario, this product runs it with offline rules and does not call a large model for the other roles.

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

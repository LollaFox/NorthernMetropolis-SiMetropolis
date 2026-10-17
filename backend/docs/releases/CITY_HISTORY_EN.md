# Reading and backing up saved city history

Run commands and Python examples from the project root. City history is runtime data, separate from the source release and Git commits.

## Find the data directory

The server's `--data-dir` selects the history directory. Its default is `backend/.data` beside the backend source. The existing local live runs use **`backend/.data/live_regional_storage`**; that directory and its live histories are **not included in the release package**.

```text
DATA_DIR/
  catalog.json
  simulations/
    sim_<id>/
      2025-01-01.json.gz
      2025-02-01.json.gz
      ...
      shared-objects.json.gz
```

`catalog.json` maps `simulations` IDs to saved `months`, output `snapshots`, initialization IDs and provider metrics. Its `jobs` records show execution status and progress; `initializations` retain setup, review and the selected scenario. A saved month contains the complete logical world, including buildings, groups, firms, metrics, histories and that month's full audit.

## Read a month correctly

New monthly files use gzip plus shared references. Decompressing one file alone reveals a storage envelope, not the complete world. Keep `shared-objects.json.gz` in the same directory and use the supplied reader; it also supports older plain `.json` and full gzip JSON files.

```python
from pathlib import Path
from backend.storage import monthly_state_path, read_json

data_dir = Path("backend/.data/live_regional_storage")  # Or your --data-dir.
catalog = read_json(data_dir / "catalog.json")
for simulation_id, run in catalog["simulations"].items():
    print(simulation_id, run["months"])

simulation_id = "sim_REPLACE_WITH_AN_ID_PRINTED_ABOVE"
day = catalog["simulations"][simulation_id]["months"][0]
folder = data_dir / "simulations" / simulation_id
world = read_json(monthly_state_path(folder, day))
print(world["month"], world["metrics"])
```

Choose an ID with at least one saved month. The reader hydrates references and verifies hashes; missing or corrupt files raise `StorageError` without modifying the files. Do not edit envelopes or the shared pool manually.

## Read through the running server

Use the server's actual port; the default is `8877`, and the existing local live server uses `8878`.

| GET route | Contents |
| --- | --- |
| `/api/v3/simulations/{simulationId}/export` | Ordinary JSON with `setup`, `review`, `run`, `scale`, complete `monthlyStates` and derived `monthlyBuildingTotals`. |
| `/api/v3/simulations/{simulationId}/snapshots/{frameId}` | One display snapshot: flat schematic terrain, completed-object zones and metrics. This is not the full canonical world. |
| `/api/v3/jobs/{jobId}` | Saved job status, progress and provider metrics. |
| `/api/export` | Canonical export of the run currently selected in the overview. Prefer the explicit simulation-ID route for a specific run. |

Take `frameId` from `export.run.snapshots`; do not assume every saved internal month is an output frame. Quarter/year output still settles and saves every month internally. Per-object totals distinguish planned/completed resident capacity, actual residents, offered jobs, filled positions and vacancies.

Reading files or these GET routes does **not** trigger AI calls or advance the simulation. A new simulation or an explicit retry of a recoverable simulation POST can call AI; it is not a history lookup.

## CLI histories and backups

CLI runs default to `backend/.data/cli/<new-id>/`, or a new directory supplied with `--output`. Their monthly files and shared pool are under `states/`. The run root also contains `scenario.json`, `initial.json`, `calls.json`, `metrics.json`, `status.json`, `summary.json`, `building-totals.json.gz` and plain `audit.jsonl`. The JSONL is a compatibility copy of audit information already present in the monthly states.

Stop the server and any CLI writer before making a consistent backup. Copy the **whole selected data directory**, including `catalog.json`, all simulation folders and every shared pool. For a CLI run, copy the whole run directory. A monthly root and its pool are inseparable; copying only `.json.gz` month files loses referenced facts. Keep backups separate from the release package. Git source checkpoints do not back up runtime history.

Restore the whole copy and point the matching backend version at it with `--data-dir`. Use `--no-demo` when opening an existing history without adding the startup offline demo. Further format details: [STORAGE.md](../STORAGE.md).

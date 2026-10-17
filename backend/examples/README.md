# Synthetic scenario examples

These scripts are fictional exploratory scenarios with synthetic cells and HKD parameters. They are not surveyed geography or validated forecasts. Month numbers are one-based offsets from the simulation's first date.

- `default-scenario.json`: 50 residential towers, 12 business towers, 10 parks and 4 stations, staggered over 12 months.
- `parks-first-scenario.json`: the same 76 stable IDs, object types and locations. All 10 parks start and complete in month 1; every residential, business and station schedule remains identical to the default script.
- `northern-metropolis-scenario.json`: a separate regional preset covering every cell of a 12×11 schematic grid. Its 100 residential and 20 business objects are aggregate development clusters, alongside eight schematic parks and four station objects; they are not 120 literal towers or mapped projects. Five residential clusters start per month, with two-month construction, so all 100 complete in month 21.

Provenance: generated locally on 2026-10-16 from `backend.scenario.default_scenario()` and normalized with `validate_scenario()`. The parks-first example is an independent copy with only its name and park start/completion months changed, then revalidated. No external scenario data or third-party code was copied.

From the project root, run either script with the deterministic offline fixture:

```sh
python3 -m backend.cli --scenario backend/examples/default-scenario.json
python3 -m backend.cli --scenario backend/examples/parks-first-scenario.json
```

Each command writes its own run directory beneath `backend/.data/cli/`. Offline results establish reproducibility and state consistency only. Differences in population or synthetic satisfaction reflect fixture rules and do not establish that a construction strategy succeeded. Each assigned firm's GDP contribution is fixed; earlier parks can change local narratives and firm-type choices even though business schedules are identical. Adding completed business towers mechanically adds their assigned firms' GDP contributions.

Residential construction pace is also configurable through `backend.scenario.apply_construction_pace(config, residential_starts_per_month=4, construction_months=2, interval_months=1)`. It assigns residences to batches in stable ID order; each batch starts one selected interval after the previous batch and completes after the selected duration. Calling it with `(config, 5, 2, 1)` starts five residences each month in months 1–10 and completes them in months 2–11. Month 1 has five residential construction sites and no completed homes. Other objects and every location retain their explicit schedules and cells, including the parks-first schedule. The two JSON examples remain unchanged; pacing applies only when requested. Export the returned normalized configuration to retain the precise schedule for a run.

The CLI exposes the same controls and saves the selected schedule as `scenario.json` in its run directory:

```sh
python3 -m backend.cli --scenario backend/examples/default-scenario.json --residential-starts-per-month 5 --construction-months 2 --construction-interval-months 1
```

The regional JSON is generated independently from `backend.scenario.northern_metropolis_scenario()` and validated with the same schema. Each residential cluster offers 25,000 resident places at completion: four profile slots of 6,250 people each, totaling 2.5 million potential resident places. Actual residents still depend on AI decisions. Its 20 business clusters each offer either 26,000 or 39,000 positions, chosen by AI; the 650,000 reference is the midpoint, while possible total capacity ranges from 520,000 to 780,000. Per-object exports distinguish planned housing capacity, completed housing capacity, actual residents, job offers, filled positions and vacancies. The 60% potential-worker assumption does not measure regional unemployment.

Reference scale comes from the official [Northern Metropolis vision](https://www.nm.gov.hk/en/about-nm/vision) (about 2.5 million residents and 650,000 jobs) and [InvestHK](https://www.investhk.gov.hk/en/why-hong-kong/super-connector-to-china-and-the-world/) (about 300 km²). Only these reference magnitudes are sourced: equal square cells, mixed layout, object counts, 21 monthly steps and every financial coefficient are synthetic assumptions. Firm funds, monthly profit and GDP scale proportionally to job capacity from the small preset; wage remains per employed worker and rent per resident. No GDP, occupancy or schedule output is an official estimate. The JSON retains this metadata and source provenance in its optional `scale` object.

# Synthetic city model v2

This is a local internal prototype inspired by Northern Metropolis development themes. It is a fictional scenario and a model-based projection, not a calibrated forecast. All coefficients, costs, actors and capacities below are original synthetic assumptions. There is no claim that these reproduce real Hong Kong demographics, budgets, emissions or infrastructure performance. Licensing remains undecided.

The reviewed v2 engine is now `sandbox/engine.py`. Original v1 remains under `sandbox_v1/`; the relative `sandbox_v2 -> sandbox` symlink retains compatibility with earlier v2 commands.

The engine uses only the Python standard library. It reads no environment variables, credentials, files, wall clock or network. Every public operation validates and copies its input. The same seed and action history produce exactly the same result. Each `step_world` advances one month, with no final scripted year. The starting calendar year is 2026; year equals `2026 + month // 12`.

## Space, capacity and construction

The initial city contains 42 completed buildings: 16 housing, eight offices, four industrial buildings, six parks, four solar plants, three transit stations and one civic building. It starts with 14,600 residents, 7,680 homes and 7,460 operating job positions. Each coordinate axis uses centers from -44 to 44 in increments of eight. Centers in river x=15..24 are excluded. There are 132 sites, with at least eight units between occupied centers. New projects use the nearest free site to the origin, with a seed/month/kind hash to break ties.

| Action | Responsible user-mapped actor | Cost, illustrative HKD million | Construction months | Completed capacity |
| --- | --- | ---: | ---: | --- |
| `build_housing` | government | 20 | 6 | 480 homes |
| `build_office` | business | 28 | 8 | 650 job positions |
| `build_industry` | business | 24 | 7 | 520 job positions |
| `build_park` | government | 6 | 3 | 2,600 green area units |
| `build_solar` | energy | 12 | 4 | 320 normalized power units |
| `build_transit` | government | 30 | 9 | 1,800 commuters |
| `subsidize_housing` | government | 4 | immediate transfer | household cooperative cash +4M; housing support +0.15 |
| `support_business` | government | 6 | immediate transfer | business cash +6M; business support +0.15 |
| `raise_tax` / `lower_tax` | government | 0 | immediate | payroll tax changes by 0.015 |
| `wait` | government | 0 | immediate | retain resources |

Government may build housing, parks and transit, provide either support transfer, change tax or wait. Business may build housing, offices and industry or wait. Residents may build cooperative housing or parks or wait. Energy may build solar or wait. Resident housing uses a separate fixed specification: 12M, 280 homes, six months. Civic buildings belong to the initial scenario and are not an available construction action.

Cash is committed in full before construction starts. Progress is elapsed months divided by the fixed lead time; capacity is counted only at progress=1. Concurrent unfinished projects are capped at government three, business three, residents one and energy two. Proposals cannot bypass these limits or choose their own numeric costs, quantities, capacity, timing or coordinates.

When all sites are occupied, an actor may redevelop its own completed asset of the requested kind. The engine chooses the asset with the fewest previous upgrades, then oldest construction date and ID. Each redevelopment adds its original base capacity, up to four times that original capacity. Housing, office and industry height increases by 45% of the catalog base height, capped at 80 world units. Lead time and capex remain the catalog values. The old capacity goes offline immediately during redevelopment. When no free site or below-cap asset is available, the action is rejected. The live action catalog reports the target ID, old capacity, new total, added capacity and construction outage so an actor can assess the actual tradeoff.

## Monthly sequence

1. Validate and copy the opening world.
2. Apply supplied decisions in order, or generate current-state autonomous decisions when `decisions is None`. An explicit empty list suppresses all autonomous actions.
3. Advance the month and physical construction progress. Publish completion events.
4. Compute operating revenues, expenses and funding ratios. These use opening observed population/jobs/demand with the now-completed physical portfolio; this is a one-month economic observation lag.
5. Compute current operating capacities, electricity adequacy and employment; update population using the seeded migration equation, then recompute all current displayed metrics.
6. Smooth wellbeing and air quality, update actor moods and record newly achieved objectives.

A well-formed, role-authorized supplied decision can become unaffordable or blocked while a live response is in flight. It then records an attributed `rejected:<action>` message and `action_rejected` event, spends no capex and still advances physical/economic time. Malformed decisions, extra numeric parameters, duplicate actor decisions and unauthorized role/action combinations raise `ValidationError` atomically. Recognized but currently unaffordable user interventions raise without changing the input world.

## Public metrics and equations

Homes equal completed housing capacity. Maximum occupancy is 2.35 people per home. Workforce is 48% of population. Jobs are operating positions, which may exceed the number of employed workers; employment is `min(jobs, population*0.48)`.

```
powerDemand = population*0.09 + completedOfficeJobs*0.09
              + completedIndustrialJobs*0.30 + completedCivicJobs*0.10
powerCapacity = 1800 + completedSolarCapacity*energyFunding
powerAdequacy = min(1, powerCapacity/max(1, powerDemand))
jobs = floor(((completedOfficeJobs+completedIndustrialJobs)*businessFunding
              + completedCivicJobs*governmentFunding)*powerAdequacy)
employmentRate = min(1, jobs/max(1, population*0.48))
housingPressure = population/max(1, homes*2.35)
transitCapacity = completedTransitCapacity*governmentFunding
transitCoverage = min(1, transitCapacity/max(1, population*0.48))
greenSpace = completedParkCapacity*governmentFunding
greenRatio = min(1, greenSpace/max(1, population*1.4))
```

The grid supplies a fixed 1,800 normalized units; completed solar provides additional capacity. Electricity shortages reduce job positions. Power units and green area units are intentionally synthetic, rather than inferred physical measurements.

```
growthRate = clip(0.0025 + 0.003*businessPolicy + 0.002*housingPolicy
                  + 0.002*(happiness/100-0.5)
                  + 0.004*(employmentRate-0.88)
                  - 0.01*max(0, housingPressure-0.96)
                  - 0.012*(1-powerAdequacy) + seededNoise,
                  -0.008, 0.009)
population' = clip(round(population*(1+growthRate)), 0, floor(homes*2.35))
```

Noise is a SHA-256 function of seed and current month, in [-0.0004, 0.0004]. It represents a small reproducible external migration variation, not a probabilistic forecast. Housing, jobs and electricity physically constrain the trajectory. Redevelopment of occupied housing can reduce the district population immediately to the lower available housing ceiling; displaced people exit the modeled district. No external displaced cohort is tracked.

```
emissions = population*0.014 + operatingOfficeJobs*0.03
            + operatingIndustrialJobs*0.15 + gridPowerUsed*0.21
            + population*0.023*(1-0.65*transitCoverage)
            + monthlyConstructionSpend*40
gridPowerUsed = min(1800, max(0, powerDemand-operatingSolarCapacity))
monthlyConstructionSpend = sum(projectCost/leadMonths for active projects)
```

Emissions are tCO2e per simulated month. Construction cost is paid up front; its emissions occur during works, including the completion month. The current month's incurred construction component is retained in `metrics.constructionEmissions` at its calculation precision, so instant interventions cannot erase it or double count it. Newly commissioned work begins contributing at the next monthly tick. Existing v2 saves without this additive metric remain loadable; the first recognized intervention recovers the component deterministically from start dates, costs and lead times, including projects completed that month. The initial completed scene has no retrospective construction emissions. Transit lowers transport emissions; solar displaces imported grid emissions; industrial positions have a higher operating factor than office positions. Parks improve modeled local air quality and wellbeing; the model does not claim permanent carbon sequestration credits.

```
happinessTarget = clip(68 + 8*housingPolicy + 10*transitCoverage
                       + 9*greenRatio + 10*employmentRate
                       - 35*max(0, housingPressure-0.75)
                       - 25*(1-powerAdequacy)
                       - 8*completedIndustrialJobs/max(1,jobs)
                       - 15*taxRate, 0, 100)
airQualityTarget = clip(92 - 18*emissions/max(150,0.04*population+100)
                        + 12*greenRatio, 0, 100)
score' = 0.85*score + 0.15*target
```

Both scores remain in 0..100. Policy scales housing/transit/green/business range from zero to one; tax ranges from 0.05 to 0.30. Construction raises its sector's policy support by 0.08, capped at one. Housing/business support transfers raise their support by 0.15, capped at one. Green policy influences business building selection. Transit support records the chosen direction; its physical effects require completed infrastructure.

## Cash flows and operating funding

This is an open economy. Synthetic external sales and retained household income enter; operating costs leave. The four actor cash balances are project/savings reserves, not a complete national accounting system. Transfers move existing cash between actors. There is no debt and balances cannot go negative.

Monthly wage benchmark is `employed*0.0025` million. Workplace occupancy is employed workers divided by completed office, industry and civic positions, capped at one.

| Actor | Monthly revenue, M | Monthly expenses, M |
| --- | --- | --- |
| government | wages*taxRate + homes*0.00004 + employed*0.000015 | 0.30 per transit building + 0.09 per park + 0.20 per civic building + min(1800,demand)*0.00025 |
| business | (officePositions*0.0035 + industryPositions*0.005)*occupancy*(0.9+businessPolicy*0.2) | wages*0.70 + 0.55 per office building + 0.85 per industry building |
| residents | wages*(1-taxRate)*0.08 | population*0.000045 |
| energy | min(demand,completedSolarCapacity)*0.0025 | 0.15 per solar plant |

For every role, `paid = min(cash+revenue, expenses)`, `funding = min(1,(cash+revenue)/max(0.000001,expenses))`, and `cash' = cash+revenue-paid`. Business funding scales workplace capacity; government funding scales civic jobs, transit and parks; energy funding scales solar capacity. Household funding does not remove occupied home capacity. Cash is rounded to six decimal places. Monthly financial entries distinguish revenue from expense/capex.

## Autonomous actors and information boundaries

Autonomous rules use current state and distinct cadences: government every four months starting at month zero, business every three months starting at one, residents every six months starting at two, and energy every four months starting at three. Government considers reserves/tax, housing pressure, transit coverage and green space. Business expands only when employment is high, operating positions are below 115% of workforce and power has headroom, or when housing limits labour. High green support favors offices over industry. Residents use cooperative savings for housing or parks. Energy adds solar as demand approaches 77% of capacity. Preferred investments blocked by resources produce a wait decision. There is no predetermined project calendar or final city.

`actor_packet` exposes only that role's own name, cash, mood and stance, its goal, whitelisted public metrics, public policies, permitted affordable action IDs and bounded catalog facts. It omits rival actor records, rival cash summaries, ledger and arbitrary world extensions. Recent public messages are attributed to their actual role/source type; user proposals are distinct. It never supplies future messages or snapshots. Six recent reports and three proposals are retained when they fit; older texts are removed to keep escaped JSON below 5,200 bytes, reserving space for the service's 8,192-byte provider envelope. Unicode bytes count toward this limit.

User text supports exact action IDs and clear catalog directions such as “Build affordable housing”, “Housing first”, “Affordable housing”, “Support business”, “Build offices”, “Industrial growth”, “Build a park”, “Renewable energy”, “Expand public transit”, “Raise taxes” and “Cut taxes”, plus a small documented-in-source Chinese phrase set. Explicit construction of affordable housing means `build_housing`; affordability support alone means `subsidize_housing`. Unsupported text, negated/cancellation requests and multiple catalog actions are explicitly recorded as unrecognized, without physical execution. A selected `kind` is an exact action ID and maps to the responsible actor automatically. Every applied action states the fixed engine result; user/model-supplied numeric quantities are not used.

The engine retains 80 recent messages, 80 events and 120 financial ledger entries. The service owns immutable full snapshot history, rewinding and branches. Five objectives record first achievement at population 20,000, jobs 11,000, homes 10,000, wellbeing 80 and air quality 80. `current` remains the actual current value; an achieved milestone stays achieved even if its metric later declines.

## Limits and verification

There are no calibrated land prices, household cohorts, real parcels, disasters, market price dynamics or external displaced population. Imported supply and external demand are stylized. The action catalog does not implement arbitrary language policy. Land and density are finite, so long-run growth eventually plateaus. These are model limitations, not hidden forecasts.

Focused tests exercise deterministic histories, copy isolation, exact lead times, cash commitment and transfers, all catalog build types, role permissions, malformed/late live decisions, explicit empty-list suppression, Unicode packet bounds, private-state exclusion, policy counterfactuals, brownouts, full-site redevelopment/outages and density caps. A 600-month run checks finite resources, cash/housing bounds, site limits and continued evolution beyond five years. Run `python3 -B -m unittest sandbox.tests.test_engine -v` from the repository root. `model_document()` publishes the same synthetic status, costs, bounds, assumptions and equations through `/api/model`.

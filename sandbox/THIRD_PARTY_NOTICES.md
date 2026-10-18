# Third-party provenance

The original Northern Metropolis Decision Sandbox is covered by the SiMetropolis Decision Sandbox Restricted License in the repository [LICENSE](../LICENSE). That license permits use only by members of the SiMetropolis team in the Inter-University GenAI Hackathon for SDGs and by that competition's judges. New city geometry and application code are original; no sandbox-game source was copied. The MIT License identified below applies only to the vendored Three.js files.

## Three.js 0.180.0

MIT, Copyright 2010–2025 Three.js Authors. The exact notice is retained in [THREE-LICENSE.txt](web/vendor/THREE-LICENSE.txt).

Approved for local vendoring by the user on 2026-09-30. No package-manager install or third-party install script was run. Only the ES module entry point and its core dependency are included.

| File | Source | SHA-256 |
| --- | --- | --- |
| three.module.js | https://unpkg.com/three@0.180.0/build/three.module.min.js | e2b5ee6bccd38fd6d8a2428546b83c5f2426d84b152ef82be8055556e3b40eb6 |
| three.core.min.js | https://unpkg.com/three@0.180.0/build/three.core.min.js | 61ba0df005b05991361d040d8ff670e1aadfd0ce7aeebd1fdb0725957a8957de |
| THREE-LICENSE.txt | https://raw.githubusercontent.com/mrdoob/three.js/r180/LICENSE | bfe119ea4fd413f5f7ca3fcd63adb0c4a073ed39daa2fe7d3e6b769e21272601 |

Version metadata: https://registry.npmjs.org/three/0.180.0 . Upstream tag: https://github.com/mrdoob/three.js/tree/r180 .

These are official upstream minified builds, unmodified apart from the module entry filename. They were selected after discovering Wibe's 1 MiB per-file snapshot limit; the unminified core exceeded that limit. No minifier or additional build dependency was installed.

## Architecture references, no code copied

- AI Town: asynchronous long-running agent operations submit actions to a serialized simulation engine. https://github.com/a16z-infra/ai-town/blob/main/ARCHITECTURE.md
- Concordia: role observations and actions resolved through an environment. https://github.com/google-deepmind/concordia/blob/main/concordia/environment/README.md
- AI Economist: explicit economic action constraints and numerical environment. https://github.com/salesforce/ai-economist
- Generative Agents: stored simulation and replay precedent. https://github.com/joonspk-research/generative_agents

These systems do not establish predictive validity for the Northern Metropolis. The implementation uses synthetic coefficients. Calibration, out-of-sample backtesting and sensitivity ensembles remain future work.

## Regional experience revision

Spatial structure and place names were checked against official planning sources on 2026-09-30:

- Northern Metropolis overview, including the west-to-east development structure and existing/new towns: https://www.nm.gov.hk/en/about-nm/basic-information
- 2023 Policy Address outline of four development zones: https://www.info.gov.hk/gia/general/202310/25/P2023102500147p.htm
- Northern Metropolis Action Agenda: https://www.nm.gov.hk/downloads/NM_Eng_Booklet_Web.pdf
- September 2026 delivery programme announcement: https://www.info.gov.hk/gia/general/202609/16/P2026091600196.htm

The four in-game district lenses are illustrative navigation regions, not a reproduction of the official four-zone boundaries. Coordinates are compressed, original schematic geometry; they are not cadastral or GIS coordinates. No official map image, building model, photograph, satellite imagery, game code or proprietary texture was copied. Facade textures are generated locally from original drawing instructions. Background towns, water, wetlands, hills and transport references do not add numerical capacity to the simulation. Solid transport alignments represent schematic existing context; dashed alignments remain planned references, independent of the scenario year. Planning target dates are not treated as guaranteed openings.

The Three-Body novel reference informs the experience of entering a society, observing its behavior, intervening, and exploring alternative histories. No characters, dialogue, plot sequence, game assets or prose from the novel were copied. There is no VR-headset runtime or claim that the simulation can reliably foretell real events.

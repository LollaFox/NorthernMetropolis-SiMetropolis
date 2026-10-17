# Exact-record request deduplication: offline verification

Source `715ac9f`; baseline `sim_886a10a6301f4591a192b12789d1d94e`.

Across **235 attempted packets / 232 logical calls**, full HTTP JSON bodies fall **55.54%**, from 38,703,226 to 17,207,983 UTF-8 bytes. User-packet JSON falls **57.79%**, from 34,582,621 to 14,598,577 bytes.

Every original fact, narrative, numeric type, instruction, eligibility list, scale field and source URL remains present after expansion. Only exact repeated structured building/cell records share a full unchanged record in a request-local table. Different versions of the same ID remain separate. No summary, pruning, key abbreviation or model-setting change is applied.

| Role | Attempts | User bytes before → after | User reduction | Full-body bytes before → after | Full-body reduction | New full-body min–max |
|---|---:|---:|---:|---:|---:|---:|
| budget | 22 | 8,329,022 → 3,417,869 | 58.96% | 9,213,626 → 3,918,073 | 57.48% | 12,772–340,513 |
| firm | 20 | 270,944 → 229,198 | 15.41% | 355,320 → 317,774 | 10.57% | 10,813–18,737 |
| narrator | 128 | 1,752,192 → 1,403,662 | 19.89% | 2,337,702 → 2,007,756 | 14.11% | 11,312–19,237 |
| park | 21 | 7,948,780 → 3,278,107 | 58.76% | 8,792,874 → 3,756,550 | 57.28% | 12,773–352,572 |
| stability | 21 | 7,552,182 → 2,881,509 | 61.85% | 8,352,522 → 3,316,198 | 60.30% | 12,836–299,910 |
| work | 23 | 8,729,501 → 3,388,232 | 61.19% | 9,651,182 → 3,891,632 | 59.68% | 12,777–322,124 |

## Individual examples

| Date / role / target | User bytes before → after | Full-body bytes before → after | Shared full records |
|---|---:|---:|---:|
| 2025-02-01 / narrator / R001 | 11,515 → 9,123 | 15,978 → 13,753 | 9 |
| 2025-11-01 / narrator / R050 | 14,539 → 12,098 | 19,160 → 16,882 | 8 |
| 2026-09-01 / narrator / R100 | 10,625 → 9,248 | 14,678 → 13,644 | 4 |
| 2026-09-01 / park / all towers | 780,498 → 311,229 | 859,026 → 352,572 | 132 |

## Verification and measurement boundaries

- 232/232 saved contexts round-trip to identical canonical JSON bytes, including numeric types. All 235 historical body-byte measurements reconstruct exactly. The comparison includes all three format-correction requests, using their saved allowlisted labels.
- 235/235 complete bodies are no larger; every baseline attempt became smaller. There are 0 baseline fallbacks. Separate synthetic tests confirm unchanged plain packets when deduplication would increase the complete body.
- Full-body counts include the conditional trusted decoding legend and nested JSON-string escaping. They exclude headers, authorization and transport framing. The user packet includes the unchanged derived actionEligibility menu.
- One local sequential preparation measurement: total 1832.5 ms for 235 payloads, mean 7.80 ms, median 0.93 ms, p90 29.95 ms, max 55.31 ms. This covers payload construction, record encoding and full request serialization; it excludes disk loading, decoding checks and network time. It is not a performance guarantee.
- Historical attempts without contextEncoding remain plain-json. The analyzer explicitly restores that format rather than applying today's encoder to old measurements. New rows identify exact-records-v1 or plain-json; original contextSHA256/contextBytes remain based on the full engine input.
- Byte ratios do not establish token or cost savings. No tokenizer was installed and no provider was called for this comparison. Actual usage must be measured separately in the authorized live test.
- Per-attempt CSV/JSON contains only IDs, fingerprints, counts and timings. No context text, narratives, keys or raw provider responses are exported.

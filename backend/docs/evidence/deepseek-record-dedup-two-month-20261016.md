# DeepSeek request and answer measurements

Simulation `sim_5136e2d4bc2544bdbb75d20f49b3cd11`: **2 saved months, 18 logical calls, 18 HTTP attempts**. Attempt statuses: `{"ok": 18}`.

The provider reported **70,077 input tokens** and **915 output tokens**. Request JSON bodies totaled **0.28 MiB**. Median attempt latency was **1.36 s**, with a 90th percentile of **1.75 s**.

## By role

| Role | Attempts | Input tokens | Mean body KiB | Mean original context KiB | Median answer chars | Median output tokens | Median / p90 seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| budget | 2 | 9,688 | 19.4 | 21.7 | 214 | 44 | 1.29 / 1.40 |
| firm | 2 | 5,896 | 12.2 | 11.0 | 212 | 39 | 1.18 / 1.21 |
| narrator | 8 | 25,410 | 13.0 | 11.7 | 322 | 58 | 1.48 / 1.91 |
| park | 2 | 9,686 | 19.4 | 21.7 | 247 | 52 | 1.35 / 1.50 |
| stability | 2 | 9,699 | 19.5 | 21.8 | 160 | 30 | 1.31 / 1.48 |
| work | 2 | 9,698 | 19.5 | 21.8 | 250 | 55 | 1.36 / 1.36 |

## What the user context contains

Bytes below partition compact user-packet JSON exactly, including field names and delimiters. The packet includes the derived eligibility menu; it excludes the system prompt and outer HTTP JSON escaping. These are byte shares, not estimated token shares.

| Component | MiB sent across attempts | Share |
|---|---:|---:|
| Complete shared record facts, excluding narrative text | 0.05 | 26.4% |
| Aggregate-cluster scale, references, notes and source metadata | 0.03 | 16.7% |
| Place narratives repeated across target, neighborhood and construction facts | 0.03 | 14.7% |
| Exact 3×3 cell and neighboring object facts, excluding narrative text | 0.02 | 9.8% |
| Engine instructions, preferences, formula definitions and canonical rules | 0.02 | 8.5% |
| Current started/completed/active construction facts, excluding narrative text | 0.01 | 5.2% |
| Per-tower wages, employment, rent, quality, commute and satisfaction | 0.01 | 4.6% |
| Exact-record envelope and reference syntax | 0.01 | 4.6% |
| Recent completed/started construction history, including any nested prose | 0.00 | 2.2% |
| Current city-wide numerical metrics | 0.00 | 2.1% |
| Current firm records, capacities and synthetic financial facts | 0.00 | 1.6% |
| Per-tower occupancy and the profile's existing group | 0.00 | 1.4% |
| Month, step, profile and fixed cohort/worker/slot sizes | 0.00 | 0.6% |
| Previous six profile decisions and outcomes, including their reasons | 0.00 | 0.5% |
| Tower IDs and source eligibleActions lists | 0.00 | 0.5% |
| Provider-added tower ID → allowed actions menu | 0.00 | 0.3% |
| Target object facts, excluding narrative text | 0.00 | 0.2% |
| Root JSON delimiters | 0.00 | 0.1% |
| Other supplied context fields | 0.00 | 0.1% |

## Growth across months

| Month | Attempts | Resident mean packet KiB | Resident mean input tokens | Narrator mean body KiB |
|---|---:|---:|---:|---:|
| 2025-01-01 | 7 | 7.6 | 2,972 | 11.2 |
| 2025-02-01 | 11 | 19.7 | 6,720 | 13.6 |

## Interpretation and limits

- The resident packet grew from 7.6 KiB in 2025-01-01 to 19.7 KiB in 2025-02-01 (2.6×). The monthly table and component counts show where that growth occurred.
- Reported cache hits covered 14.4% of input tokens. The report does not infer prices or spend from token counts.
- On these exact saved inputs, plain request bodies would total 390,062 bytes; actual bodies total 291,050 bytes (25.38% reduction). Plain user packets would total 296,750 bytes versus 198,864 actual bytes. This is a local serialization comparison, not a causal token/cost comparison against another stochastic simulation.
- Exact repeated narrative strings account for 0.01 MiB across packets. A separate top-down scan found 0.00 MiB of repeated identical JSON containers of at least 256 bytes. These overlap and must not be added; neither predicts safe context removal or token savings.
- `inputBytes` is the full UTF-8 HTTP JSON body, including system instructions, schema, example, user JSON, JSON escaping and provider options. It excludes headers, credentials and transport framing. `contextBytes` is the original compact engine-context JSON before the derived eligibility menu. `systemPromptBytes` and `userContextBytes` measure the two message strings; their sum differs from the body size because the body escapes them and adds its own fields.
- `answerTextChars/Bytes` measures actual assistant content returned on each HTTP-success attempt, including whitespace, before local validation. `responseJsonChars/Bytes` measures only validated canonical JSON; saved audit response lengths are a separate cross-check. Unavailable text lengths remain null, including HTTP failures. Explicit reasoning text lengths are separate and otherwise unknown, even with thinking disabled.
- Token counts come from provider usage fields. They include returned invalid answers and format corrections when usage was supplied. No tokenizer estimate is substituted for missing usage. Character and byte counts are not tokens.
- `latencyMs` is client-observed time per attempt, covering request setup, transport, response extraction and validation; it excludes retry backoff and waiting for a free credential slot. Parallel attempt durations cannot be summed to obtain simulation wall time. No separate server generation or time-to-first-token measurement exists.
- Context categories are mutually exclusive; root history and construction-history branches include all their nested prose, while other narrative fields have their own category. Every user-packet byte is allocated once. Exact subtree repetition is structural evidence only: repeated facts may be relevant to distinct spatial decisions.
- New requests join to saved audits by role plus canonical sorted-key context SHA-256. Legacy size/status matches are labeled candidates, never exact. Unmatched or ambiguous rows are retained. Reconstructed sizes do not recover the original JSON member order or raw wire bytes.
- Linkage: `{"logicalCalls": {"exact_fingerprint": 18}, "matchedAudits": 18, "savedAudits": 18, "unmatchedAudits": 0}`. Consistency mismatches: `{}`.
- This analysis reads local saved artifacts only and constructs no provider, reads no credential, and sends no network request. The analyzer does not modify contexts or decisions; the measured exact-record encoding preserves all original information.

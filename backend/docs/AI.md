# Narrative provider and offline runs

`python3 -m backend.cli --output /private/tmp/nm-narrative-run` runs the default
twelve-month government script without a key or network access. Supply
`--scenario /absolute/path/scenario.json` to replace the script or parameters;
scenario validation runs before any provider call. `--start` and `--end` are
inclusive dates; monthly steps retain their initial day, clamping short months.
The destination must be new so previous run evidence cannot be overwritten.

The offline provider is a **deterministic fixture, not AI**. Its saved prose and
metrics say so. Profile-specific rules combine current wages, employment, rent,
commute, parks and construction with social-character keywords. Changing prose
can change fixture choices even with identical numerical facts; changing facts
can also change choices. This verifies the context path and settlement, not live
model reasoning, quality or speed. Live decisions never pass through fixture
thresholds.

For OpenAI, explicit live startup uses `OPENAI_API_KEY`:

```sh
python3 -m backend.cli --live --model gpt-6.1-sol --timeout 45 --retries 2 --output /private/tmp/nm-live-run
```

No key is read at import or offline startup. The key stays in process memory,
and is sent only as the authorization header to its provider's fixed HTTPS
endpoint; HTTP redirects are rejected. The provider adapter never reads key
files, overrides endpoints, discovers models or installs dependencies. The
authorized local startup layer separately loads the two saved DeepSeek keys
without displaying them. There is no cumulative call cap. A finite timeout
applies to each request, and transient network, HTTP 408/409/429 and server
failures receive bounded retries. Authentication failures are not retried.
OpenAI invalid decisions fail without format retry. Every attempt remains visible in metrics, including failed
attempts before recovery. Invalid response content never becomes a successful
decision.

The verified API model ID is `gpt-6.1-sol`, with a task-local `--model` override.
Official documentation confirms [the exact model ID, medium reasoning and
structured outputs](https://developers.openai.com/api/docs/models/gpt-6.1-sol).
The request uses the Responses API's strict [`text.format` JSON
schema](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
Account access, real latency, provider reliability, and live semantic quality
remain untested until an authorized key-backed run. No live request was used to
develop the OpenAI adapter. DeepSeek live verification is a separate authorized
run; mocked tests do not establish provider latency or semantic quality.

`DeepSeekProvider(model="deepseek-flash", api_key=..., timeout=180, retries=2)`
uses the fixed `https://api.deepseek.com/chat/completions` endpoint. If the
explicit key argument is omitted, it reads `DEEPSEEK_API_KEY` only at live
construction. Both authorized credentials use the same Flash model within
**one simulation**. The [official API introduction](https://api-docs.deepseek.com/)
identifies Flash and the endpoint. The [Chat Completions
reference](https://api-docs.deepseek.com/api/create-chat-completion/) documents
JSON mode and token/cache usage; the [thinking-mode
guide](https://api-docs.deepseek.com/guides/thinking_mode/) documents explicit
non-thinking mode. Requests include the exact role schema and a JSON example
in system instructions, `response_format: {"type":"json_object"}`, and
`thinking: {"type":"disabled"}`. JSON mode does not enforce the complete
application schema; local validation remains mandatory. Only an assistant
response with `finish_reason: "stop"` is accepted. Truncation, refusal, tools,
empty content, malformed/duplicate-field JSON and invalid role fields fail.

Prompts target at most 160 characters for every reason, including the overall
reason, and at most 400 for narrator character; hard validation stays at 320
and 900 respectively. DeepSeek permits one format-correction request per
logical decision by default (`format_retries=0` disables it). Correction uses
the original context/schema and an allowlisted local validation label, with no
previous model text, raw transport error or secret copied into the prompt.
The same single correction allowance covers a resident action that contradicts
the supplied current eligibility; it is not an additional retry allowance.
Refusals, filtering and interrupted generation do not trigger correction.
Failed validation is never trimmed into success. A failed correction remains
a rejected decision for the engine's existing recovery rules. Transient
transport retries are bounded separately for each initial/correction request;
this does not impose a cumulative run quota. Metrics keep the same logical
call ID, count every attempt and its returned usage/input bytes, and mark the
`formatCorrection` stage and safe triggering validation label.

`DualKeyProvider([first_provider, second_provider])` shares the same run across
two independent credentials. Sequential firm/narrator calls alternate available
slots. `call_batch([(role, context), ...])` runs at most two requests at once and
returns results or exception objects in input order. The engine batches only
the four resident decisions prepared from one pre-settlement state; narration,
firm assignment and numerical settlement remain ordered. A credential stays
exclusive to its request through retries. Two keys can share an account rate
limit; concurrency alone does not establish a speed improvement.

Merged metrics expose `credentialSlot` (1/2), a random `providerSession`, and a
session/slot-prefixed call ID, with no credential text or file paths. DeepSeek
prompt/completion counts map to the common input/output token fields; returned
cache hits/misses and reasoning counts are retained when available. Providers
support `set_metrics_callback(callback)`: a safe copied attempt row is delivered
after recording, outside provider locks, for progressive persistence. Callback
failures cannot alter model decisions; the in-memory row remains available.

Each role has a small exact output:

| Role | Fields |
| --- | --- |
| narrator | `character` bounded synthetic prose |
| firm | `firmType` (`small` or `large`), `reason` |
| budget, work, park, stability | `actions` of `{towerId, action, reason}`, `reason` |

Residents choose only `move_in` or `leave`; there are no numerical quantity
fields. Duplicate or conflicting actions reject the complete role result.
Before returning a live resident response, both providers also require every
action's tower ID to exist in the supplied context and its action to appear in
that tower's exact `eligibleActions` list. An existing own-profile group with
`["leave"]` cannot request `move_in`; an empty eligibility list permits no
action. One ineligible or invented target rejects the entire batch, including
otherwise valid actions. DeepSeek can make its existing one correction using
only a generic allowlisted eligibility label and the original context.

Resident packets end with a compact `actionEligibility` map derived from the
same per-tower lists, making valid choices visible after long neighborhood
contexts. This adds no independent policy and never changes the engine context
or original eligibility. Leaving and entering another tower refer to different
groups; they do not relocate the same residents. Narrator instructions also
forbid claiming actual occupancy, staffing or footfall without supplied facts.
Transport extraction rejects incomplete responses, refusals, malformed JSON,
duplicate JSON keys, nonstandard numeric constants and missing decision text.
The engine independently checks current action eligibility and owns all
numerical application. Narrator instructions explicitly subordinate synthetic
social prose to canonical facts and prohibit adding infrastructure or implying
planned construction is complete. Narratives cannot numerically mutate state.

The output directory contains `scenario.json`, `initial.json`, immutable
`states/YYYY-MM-DD.json` checkpoints, `audit.jsonl`, `calls.json`, `metrics.json`
and `summary.json`. Failed runs preserve completed states and write a failed
summary. Calls retain role, model, provider/source label, logical call ID,
attempt number, input bytes, latency, safe status/HTTP code and allowlisted
returned token usage. No raw provider errors, response bodies or keys are saved
in call records. Token usage unavailable from the provider remains explicitly
unavailable; no cost estimate is invented.

Provenance: reviewed `frontend/sandbox/ai.py`, `engine.py` and
`web/port-model.js`. The old bounded provider demonstrates strict JSON and
measurement, but depends on missing `sandbox_v1` and old societal roles. The
port model demonstrates explicit fixture/assumption labeling but models trips
with unrelated rules. The new implementation is independent; no old engine,
transport or port code was copied. Existing frontend and its third-party
notices remain unchanged.

Verification: `python3 -m unittest discover -s tests -p test_ai.py -v` exercises
schemas, factual and narrative fixture influence, fixed action shapes,
Responses extraction, mocked stdlib HTTP, retries, failures, key-free audit,
model overrides, no cumulative cap and month clamping. DeepSeek and dual-key
tests also check JSON-mode payloads, exact completion handling, cache usage,
slot rotation/exclusivity, two-request concurrency, stable batch ordering,
per-item failure isolation and safe callbacks. An engine-generated R42/R43
regression proves schema validation alone accepts the previously observed
already-occupied arrival, then confirms the context guard rejects it and a
bounded correction yields only eligible actions. Exhaustion rejects the full
batch without partial application. Tests make no live calls and use
dummy credentials only.

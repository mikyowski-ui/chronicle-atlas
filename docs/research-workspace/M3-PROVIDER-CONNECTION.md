# M3 provider connection preparation

Date: 2026-10-07. Contract: `chronicle-provider-transport-1`. Policy: `m3-provider-closed-1`.

Implemented: explicit provider configuration, host-only credential-presence probe, per-field consent review, token reservations, bounded wire serialization and response validation, cancellation, and a controlled offline transport adapter behind the existing `PlannerProvider` interface. **Live model services remain disabled.** No HTTP client, provider SDK, network request, credential value, or activation switch was added. All source and global `modelProcessing` flags remain `false`.

## Production integration and unavailable behavior

`apps/explorer/research-semantic/provider-transport.ts` exports `createProviderConnection(input = {})`. The `ResearchController` constructs one connection from its optional fourth, host-owned `ProviderConnectionInput` constructor argument and passes that connection to its existing `PlannerBoundary`. The default empty input returns `PROVIDER_UNAVAILABLE`, preserving the prepared-workspace journey. `getProviderStatus()` exposes a frozen, redacted readiness status. The planner's existing complete workspace validator, latest-request logic, output envelope, and no-tools policy are unchanged.

| Input state | Provider mode | Result before any transport call |
| --- | --- | --- |
| Missing or invalid configuration/budgets | `unavailable` | `PROVIDER_UNAVAILABLE` |
| Missing credential, or failed presence probe | `unavailable` | `PROVIDER_UNAVAILABLE` |
| Missing/invalid consent or denied field | `unavailable` | `PROVIDER_UNAVAILABLE` |
| Complete configuration, credential presence, and every field reviewed | `live-disabled` | `LIVE_NOT_AUTHORIZED`: `MODEL_PROCESSING_DISABLED` |

The status contains only code/reason enums and configuration/credential-presence booleans, plus `modelProcessing:false` and `liveServices:false`. It contains no question, dataset IDs, destination, credential reference, credential value, provider exception, or raw model output. Even a direct call to the production connection's `propose()` rejects. Supplied consent cannot override the hard policy or source permission. Configuration includes no enabled/live boolean that can change this outcome.

Configuration is strict JSON: version, provider ID, model ID, explicit HTTPS destination, a nonsecret credential reference, and complete budgets. Credentials in URLs, URL query parameters/fragments, an `apiKey` property, unknown properties, insecure destinations, or callable tools are rejected. The host may inject `credentials.available(reference)` to report presence; this API cannot return a key. The browser default has no probe, credential lookup, environment access, or settings persistence. A future authorized provider service must hold actual credentials outside the browser and separately approve its destination and retention terms; this contract does not establish a live provider-specific HTTP protocol.

## Field consent and source permissions

Consent records have a versioned policy identity, one distinct allow/deny decision and review ID for each of the six allowed field paths, and explicit per-dataset source policy entries:

| Allowed field path | Content |
| --- | --- |
| `question` | Exact explicit question, at most 4,000 UTF-8 bytes; whitespace identity is preserved. |
| `context.catalogueVersion` | Host catalogue version identifier. |
| `context.parentRevisionId` | Existing revision identifier or `null`. |
| `context.datasets.id` | Dataset identifiers. |
| `context.datasets.indicatorIds` | Approved indicator identifiers. |
| `context.datasets.entityIds` | Approved entity identifiers. |

No wildcard or partial field list is accepted. A denied field blocks the whole request, since silently removing required question/scope fields would alter the requested work. Dataset policy IDs must match the request before the offline adapter runs. Raw observations, values, passages, source titles, locators, rights text, URLs, and arbitrary extra fields are outside this transport vocabulary. Their exclusion is independent of whether someone supplies an affirmative field review.

Both global consent and every source policy require literal `modelProcessing:false`; `true` fails runtime validation. `provider-processing-review` records describe a review, not processing authorization. Offline transport requires the separate `offline-fixture` purpose, explicitly synthetic provider IDs and an `.invalid` destination. No source or permission fixture is modified to pretend that real processing is authorized.

## Offline wire contract and accounting

`createOfflineProviderFixture(configuration, consent, transport)` is a clearly named test seam. It adapts a trusted, injected `OfflineProviderTransport.exchange()` function to the unchanged planner interface. The function receives a frozen, copied wire request and `AbortSignal`; no credential reference, destination, source values, or provider secrets are passed. It is **not** a sandbox for arbitrary adapter functions. This release injects only handwritten fake transports with synthetic identifiers and prewritten replies; none makes a network request.

Each wire request carries a fixed protocol version, provider/model identifiers, exact question, allowed context, attempt number, enum-only repair code, explicit input/output token and output-byte caps, zero tools, and the offline consent policy identity. Configuration allows at most 64,000 input accounting tokens, 64,000 output accounting tokens, 1,000,000 session accounting tokens, a 10-second adapter deadline, 64 KiB output, and two repairs. The existing planner's stricter 64,000 aggregate request ceiling and configured remaining budget still apply. Missing or zero budgets never select defaults for a configured transport.

Before exchange, the adapter reserves the complete configured input cap plus the effective output cap from its session budget. It refuses concurrent exchanges, oversized input, insufficient remaining request/session budget, or too many repairs. Successful responses refund only the unused reservation. Both input and output charges take the greater of encoded UTF-8 byte count and reported usage; provider under-reporting cannot erase the byte charge. This is conservative fixture accounting, not tokenizer or monetary billing certification. A failed, cancelled, or timed-out attempt retains its full reservation because its cost is uncertain. Recreating an adapter creates a fresh local session; this is not a durable billing ledger or authorization to spend.

The response contract requires exact keys, status 200, `application/json`, a bounded `Uint8Array`, and nonnegative safe-integer input/output/tool usage. Nonzero tools, overruns, extra fields, malformed usage, invalid UTF-8, duplicate or unsafe keys, nonfinite numbers, and JSON deeper than 14 levels fail closed. Descriptor checks reject input getters without invoking them; only plain finite JSON is accepted. The existing planner then validates proposal/unsupported envelopes and uses the authoritative workspace validator. A transport's success cannot activate a workspace or weaken evidence checks.

Timeout and caller cancellation settle through an independent race, revoke the adapter signal, discard completion, and clear owned listeners/timers. An uncooperative trusted fixture can leave its own promise unresolved; this demonstrates completion suppression, **not remote process termination**. Physical termination and runtime isolation belong to the separate sandbox subsystem. Transport faults expose enum-only error messages. Because the unchanged outer planner treats adapter exceptions as provider failures, adapter-specific timeout/format failures normally become `PROVIDER_FAILURE` there unless the planner's own stricter deadline/cancellation wins. Direct adapter tests verify the finer-grained faults.

## Verification and remaining activation gates

From `apps/explorer`:

```sh
node --import tsx --test tests/provider-transport.test.ts tests/m3-controller-provider.test.ts
corepack pnpm exec tsc --noEmit
```

The provider module adds 18 tests; controller integration adds two. Covered negatives include missing budgets/keys, all six field denials, attempted permission override, secret-bearing/unsafe configuration, prototype and duplicate-key payloads, getter execution attempts, unreviewed datasets, source-value extras, input/output/session token overruns, tool calls, malformed encoding, deep JSON, timeout, cancellation, concurrent calls, and redaction. Tests also exercise a successful controlled transport-to-planner unsupported response. Exact run results and complete retained-suite totals are recorded in the M3 acceptance report and release logs.

This checkpoint prepares the connection layer; it does not activate a live model or claim live answer quality. Live activation still requires explicit user authorization, applicable per-field/source permission, a separate reviewed provider service with destination and credential handling, provider-specific token/output caps, independent monetary controls, live cancellation evidence, and held-out model evaluation. None is supplied by changing a fixture configuration, allowing a field, or passing the sandbox tests.

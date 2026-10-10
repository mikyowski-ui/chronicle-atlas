# Planner boundary and offline evaluation — 2026-10-07

Status: implemented declarative proposal boundary and offline evaluation harness. Live generation is **BLOCKED / not authorized**, not a completed Milestone 2 exit run. No provider SDK, credentials, inference call, arbitrary query, generated code, data loader or source-policy change is added.

## One contract and one trusted execution path

`apps/explorer/research-semantic/planner.ts` exports the provider-neutral `PlannerProvider`, `PlannerBoundary<S>` and `evaluateOfflinePlanner` interfaces. The boundary accepts an explicit question and host-built permitted catalogue context. Its generic specification must contain the existing `QueryIntent` and `QueryPlan`. The caller injects the trusted complete dashboard validator; the tests use **the same authoritative v2 `validateWorkspace` and `WorkspaceSpecification`** used by the integrated runtime. No second planner-specific catalogue or renderer schema is defined.

A provider returns a strict envelope: either `{kind: 'proposal', specification}` or `{kind: 'unsupported', reason}`. Unsupported reasons are typed enumerations; an unsupported question cannot be answered by a fallback example. A successful proposal must preserve the explicit question and parent revision reference, fit permitted catalogue IDs and pass the authoritative validator. The caller stages/resolves/activates it using the existing runtime. The boundary itself has no activation, Atlas-clock, selection, storage, query-execution or source-fetching capability. Ancestry/narrowing and revision activation remain host responsibilities, not permissions conveyed by a proposed parent ID.

Prepared workspaces remain labeled examples. This module exports no prepared-answer matching table and is not wired to reinterpret arbitrary product questions. Offline test adapters are explicitly injected by tests; the default exported adapter is unavailable. Every adapter marked `unavailable` or `live-disabled` fails before invocation, regardless of supplied question/context.

## Budgets, repairs and cancellation

Defaults: 10-second whole-request deadline, 16,000 accounting tokens, **zero callable tools**, one proposal plus at most two repairs, 64 KiB response/spec input limit. Callers may tighten budgets; upper limits are 60 seconds, 64,000 accounting tokens, two repairs and 64 KiB. A nonzero tool budget cannot be configured. There is no executable tool dispatcher to which model output can be routed.

Each attempt preflights UTF-8 request bytes as a deliberately conservative accounting charge. On return it charges the larger of that byte estimate and reported input tokens, plus reported output tokens. Usage must consist of nonnegative safe integers. Missing/malformed usage fails closed; token overruns or any reported tool call stop immediately. These are offline adapter accounting controls, **not verified model-token metering**. A future real adapter needs approved tokenization, provider-side output caps and independent billing limits before activation. Output also passes bounded JSON traversal independently of reported token usage.

Only malformed/invalid proposals receive repairs. Repair requests contain the enum `INVALID_OUTPUT`, the original bounded request and remaining budget; they do not echo untrusted prior output or validator exception text. Provider failure, cancellation, stale completion and budget overrun do not trigger repair.

An `AbortController`, whole-request deadline and generation counter enforce latest-request-wins. External cancellation, explicit `cancel()`, timeout and a newer request settle even when the fixture ignores its signal. A late reply never becomes a valid current result. This suppresses completion; it does not claim that an uncooperative external provider process was physically terminated. Live transport cancellation would need an approved adapter and evidence.

Logs contain only event/status enums, attempt counts and accounting totals. Questions, context IDs, raw outputs, source content, validator messages and provider exceptions are omitted. Logger failures cannot change the validated result. The boundary does not persist replay or prompts.

## Current and future information flow

Currently allowed path: host identifier allowlist + explicit question -> trusted, injected **offline fixture function** -> bounded proposal -> authoritative validator -> host-owned execution/activation. Context allows only catalogue version, dataset/indicator/entity identifiers and parent revision identifier. Source titles, labels, locators, rights descriptors, records, values, passages, URLs and extra keys are rejected in context. A frozen copy prevents in-flight mutation. This is a software seam, not a security sandbox for hostile adapter code; adapters are trusted host code, never model-authored code.

The source schemas still require `modelProcessing: false` and `republication: false`. The offline context shape does **not** grant permission to transmit metadata. A metadata-only model path remains disabled along with the full-record path. A local model does not bypass these restrictions.

A future enabled provider requires a separate explicit authorization identifying:

1. Provider/runtime and credential location outside browser bundles, prompts, logs and archives; approved inference and monetary budgets.
2. A field-by-field processing review covering question content, metadata, identifiers, derived content and every source whose information would be transmitted. Current source flags must not be silently overridden. If permission remains absent, the provider receives none of that material.
3. Approved request allowlisting, destination, data retention/training terms and audit identity; explicit handling of confidential user questions.
4. Adapter-side token/output/tool limits, cancellation and timeout behavior, redacted transport errors, no model-controlled retrieval/imports/paths and no callable tools unless independently designed and authorized.
5. The authoritative v2 validator, renderer capabilities, trusted query compiler, result/claim support checks and atomic activation; no provider repair may weaken them.
6. A live held-out evaluation run reported separately from the offline suite. Broader inference permission does not authorize historical publication, generated execution, redistribution or deployment.

## Offline evaluation and reproducibility

From `apps/explorer`:

```sh
node --import tsx --test tests/planner-boundary.test.ts
corepack pnpm exec tsc --noEmit
```

Executed: **15 tests PASS**; TypeScript check PASS. The test emits a machine-readable `OFFLINE_PLANNER_EVALUATION` JSON record for the release log. No new dependencies or lockfile changes are required.

Ten labeled fixture cases cover held-out-style paraphrase wording, a supported city/year combination unlike the default example, selection/date follow-up, sparse qualitative Samarkand evidence, unsupported quantities, conflicting definitions, prompt-injection wording, malformed output, provider failure and stale completion. They exercise boundary mechanics using prewritten responses; they do **not** measure language understanding, refusal reliability of a model, or live generation. The prompt-injection test checks the refusal path; additional malicious nested-loader/operation/claim tests check validator containment when unsafe output is returned.

| Metric | Passed | Failed | Not applicable | Meaning |
| --- | ---: | ---: | ---: | --- |
| Plan validity | 4 | 0 | 6 | Proposed specs pass the authoritative v2 boundary. |
| Answerability handling | 10 | 0 | 0 | Expected proposal/refusal/error or stale state is preserved. |
| Numerical correctness | 3 | 0 | 7 | Resolved ID/value pairs equal separately filtered retained fixture records. |
| Evidence/claim support | 4 | 0 | 6 | Bound records retain expected record hashes; free-form claims are not permitted. |
| Follow-up fidelity | 2 | 0 | 8 | Requested parent/scope is preserved and stale follow-up is rejected. |

Metrics report applicable denominators separately. Qualitative evidence receives no artificial numerical score. Evidence support here means constrained record lineage, not a new scholarly assessment of primary-account truth. Existing source-audit tests establish the fixture-to-retained-source link; this boundary adds no historical claims. There is no aggregate “AI accuracy” or live M2 pass claim.

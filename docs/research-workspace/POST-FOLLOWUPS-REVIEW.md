# Chronicle — completed-session review and next step

**Review date:** October 7, 2026  
**Baseline:** `Chronicle-Dual-Track-Followups-Source.zip` and its matching runnable package, created October 7, 2026.  
**Application build:** `chronicle-fb796598d29d466af238699a4f3079d1ce2bd5ac0f7d181d388dff12eb303017`  
**Source fingerprint reported by build:** `6b4a221eb8192426ea34a8021b9cc660fbebe5c23d82146f16287d69571db3ed`

## Decision

Keep this implementation. It contains useful performance improvements, two source-pinned evidence types, bounded query contracts and local revision/replay. It is not yet the natural-language, dynamically composed research workspace in the product plan.

The next bounded outcome should be **one linked workspace for both pilots, with a provider-neutral planner boundary**, while independently closing browser/production/hardware acceptance. Do not jump to arbitrary code generation or a new renderer. Do not spend another session merely adding prepared catalogue filters.

## 1. What was actually delivered

The dual-track work existed before the last continuation. It reported 350 passing tests, selected Canvas/DOM performance changes, semantic contracts and a premodern fixture. The last continuation added six tests and local catalogue follow-ups: narrow by place/date, reference-only save/reopen, source-pinned ancestry, stale-parent rejection, and previous-state preservation. It reported 356 passing tests and a successful build.

The catalogue contains 44 retained modern UN observations and ten premodern editorial account summaries at nine named places. These are two evidence types, not complete historical coverage. Modern observations are discrete published estimates, without retained cell-specific confidence intervals. Premodern account dates and composition dates are distinct. No trade edges, population values or uncertainty radii were invented for that fixture.

Sources: `docs/research-workspace/DUAL-TRACK-ACCEPTANCE.md`, `LOCAL-FOLLOWUPS-ACCEPTANCE.md`, `PREMODERN-PILOT.md`, and root `SESSION.md` in the inspected source archive.

## 2. Review evidence — independent versus inherited

### Independently checked in this review

- Both ZIP SHA-256 hashes match the supplied package receipt.
- Both retained-source check scripts passed: 44 observations/four modern entities and ten accounts/nine premodern places.
- All 2,282 protected files match the supplied baseline in both size and SHA-256. This establishes consistency with that baseline, not historical truth or a new publication approval.
- Eight emitted runtime assets served over HTTP match their declared hashes and local bytes. The range request returned 206 with the correct partial bytes.
- The saved prior-session latency samples independently recalculate to 35.6 ms selection p95 and 95.4 ms combined selection/host-year p95 (200 samples each).
- Inspected the two contract implementations, catalogue compiler, local revision/replay code, catalogue UI, retained reports and test log.

### Not independently established

- The 356-test suite and production compilation are builder-run results confirmed in retained logs, not freshly rerun here. The pinned package-manager download was blocked by registry DNS access; dependency versions were not substituted.
- No fresh browser UI or performance result. The local packaged server responded over HTTP, but the headless browser navigation was blocked by administrator policy. No alternate route was used to bypass that policy.
- No physical Windows/GPU/mobile tests; no actual OS reduced-motion or live MapLibre style-reload test.
- No new historical verification of the original academic claims, translations or accounts.

## 3. Findings and priorities

### F1 — Main integration gap: two partially separate execution paths (high)

`apps/explorer/src/research/contracts.ts` and `research-semantic/contracts.ts` both define intent, plan, result and dashboard contracts. The former drives the linked population map/scatter/evidence workspace. The latter drives a catalogue. The new view explicitly says that it does not alter Atlas time or selection.

`src/research/semantic-view.ts` constructs and validates a summary/table/evidence specification, but its `activate` function renders a fixed record list. This does not prove that arbitrary allowed specifications drive a generic linked renderer. Its schema advertises map/timeline types but has no scatter type; the original schema does support scatter.

**Next:** introduce one authoritative contract for new planner outputs and a versioned compatibility adapter for existing prepared workspaces/replays. Connect qualitative observations to the host selection/time services without converting them into numeric observations. Preserve old archives against their original policies; do not silently reinterpret or rehash them.

### F2 — Performance improvement is real within the saved workload, not a global smoothness result (high)

The archived combined result improved from the M1 report's 230.3 ms to 95.4 ms p95. The final sample maximum was 141.4 ms; that does not fail a p95 gate. There is only 4.6 ms of margin below the p95 target.

The prior run used a cloud browser, Canvas fallback, four cities, 44 rows, and warm 2000/2001 reversals. Its draw count stayed at 32 while reuse increased; this supports the redundant-paint optimization, not performance under a changed map scene. Its 59.51 measurement counts requestAnimationFrame opportunities, not physically presented frames. The report says browser interaction was with development preview, not the production bundle.

**Next:** preserve the exact original workload, add actual observation/checkpoint changes, multi-year cache misses, pan-plus-scrub and larger already-registered data within existing budgets. Separate warm/cold, CPU/DOM, rendered readiness and physical presentation. Capture raw samples and build/environment identifiers. Do not widen budgets or rerun selectively to manufacture a pass.

### F3 — Premodern pilot exists, but is not yet a fully linked qualitative workspace (high)

The ten account summaries adequately test source attribution, qualitative values, sparse/event/composition intervals and unknown positional uncertainty. They do not establish routes, trade volumes or causal connections.

**Next:** render source-backed reference points, an event-interval view, the evidence/table alternatives and explicit cross-selection through the same host runtime as the modern pilot. Display composition separately. Focusing a date or region must be a deliberate user action; an uncertain interval must not become a fabricated exact date.

### F4 — Live planner remains deliberately disabled (gated)

The active sprint excludes inference, no authorized provider is configured, and `SourcePinSchema` literally requires `modelProcessing:false` and `republication:false`. This is an application policy restriction in the delivered package; it is not an independent legal determination that every upstream source can never be used with AI.

**Next:** implement provider-neutral planning interfaces, cancellation, bounded proposals/repairs, structured errors and evaluation tooling without enabling inference. A live evaluation then requires a separately authorized provider, bounded budget and documented processing permission for every transmitted field. Do not flip existing source flags to make the demo run. A metadata-only proposal may be investigated, but metadata transmission must also be authorized and the allowed processing boundary must be explicit. A local model does not bypass a model-processing prohibition.

### F5 — Dedicated Milestone 3 threat-model deliverable is missing (medium)

The delivered source includes general sandbox requirements in the implementation plan and agent instructions, but no standalone threat model or chosen enforcing execution-boundary document was found. The active dual-track prompt omitted this documentary deliverable from the preceding user request.

**Next:** add a separate design-only document covering assets, adversaries, trusted/untrusted interfaces, permitted inputs/outputs, network/filesystem/credential isolation, resource and termination limits, output validation, stale results and adversarial acceptance tests. Keep M3 execution disabled. Document candidates and evidence needed for selection rather than claiming a sandbox has been implemented.

### F6 — Replay needs dependency independence and a future full-workspace contract (medium)

`semantic-view.ts:147–154` loads both modern and premodern fixtures with `Promise.all` before reopening any study. Therefore an unavailable unrelated pilot can prevent restoration of an otherwise valid saved study. This is a static code finding, not browser-reproduced here.

**Next:** strictly preflight an archive's bounded registered IDs; load only its required allowlisted dependencies; never accept a loader URL from the archive. Add a test where the other pilot is unavailable.

The new revision archive stores query/result references, not a complete generated dashboard specification. That is sufficient for its fixed catalogue but not yet for future arbitrary layouts. Preserve old archive behavior and introduce a versioned, validated view-specification replay contract before claiming generated-workspace replay.

### F7 — Follow-up semantics are currently narrowing-only (medium)

This is an intentional and tested limit. Broadening requires a new root. It is not conversational revision across datasets, chart choices, source comparisons or alternative hypotheses.

**Next:** maintain explicit refine/reset behavior; add validated branching or broader revision operations only when the common workspace supports them. Every revision remains parent-bound, source-pinned and atomically activated. Do not turn a keyword router or fixtures into a purported LLM evaluation.

## 4. Proposed next work order

### Track A — complete the shared product path

Preserve the Atlas and successful performance patches. Integrate the two evidence types under a common runtime and versioned contract. Prove modern map/scatter/table/evidence and premodern map/interval/table/evidence journeys. Fix independent replay loading, failure-state preservation, source/date labels and current-control accessibility. Avoid adding a second clock or permanently open essay panel.

### Track B — make M2 planner-ready, then execute a separately authorized live evaluation

Build the provider-neutral boundary, catalogue tools and held-out evaluation set. A first real planner should compose a restricted declarative workspace from registered evidence, not execute arbitrary SQL/code or ingest the web. Record plan validity, execution/numerical correctness, claim support and unsupported-request behavior separately. Include prompt injection, malformed output, provider errors, source mismatches and stale completion.

### Independent acceptance track

Test the exact production build at desktop and 375 CSS pixels; distinguish responsive emulation from physical mobile. Exercise save/reopen, keyboard focus, Space while typing, actual reduced-motion settings, style restoration and lifecycle. Perform available software work when physical devices are absent, but never mark their gates passed. A configured supported device path is needed to close the long-standing physical gate, not another static checklist.

## 5. Exit criteria for the next integrated candidate

1. Both pilots drive the same host-owned selection and time services through validated view adapters.
2. The modern numerical chart and premodern qualitative interval view preserve their different meanings, units and dates.
3. Existing replay remains valid; new revision replay restores the correct views and required dependencies without invoking a model.
4. Empty/invalid/stale requests retain the last valid state, without mixed chart/evidence revisions.
5. Existing p95 gates remain unchanged: selection <=50 ms and combined selection/year <=100 ms on the declared baseline workload. Broader workloads have separately reported results.
6. Production browser evidence and physical/environmental gates are explicitly PASS, FAIL, BLOCKED or NOT RUN, with no substituted evidence.
7. Planner infrastructure is complete enough to execute held-out real prompts once permissions/provider/budget are satisfied; fixtures remain labeled offline tests.
8. The standalone M3 design document exists, but generated code stays disabled.
9. Protected inputs remain byte-identical; no publication, relicensing, deployment or canonical ingestion occurs.

## 6. Do not expand this step into

A new renderer, global historical-data completion, continuous-border invention, arbitrary generated programs, a universal ontology, a separate graph platform or public engine release. The eventual open-source extraction still needs independent reuse and rights review. These are later boundaries, not prerequisites to linking the two existing pilots.

## Evidence locations

Review receipts are in `evidence/`; selected source excerpts are in `SOURCE_EXCERPTS.md`. Original builder reports remain in the supplied source archive. The review does not modify the application or authorize live services.

# Proposed next execution — Chronicle M2 integration and planner readiness

**Status:** proposed work order; issuing it authorizes the implementation scope below, not live inference, source-policy changes, generated execution, publication or deployment.

## Baseline and preservation

Continue from the already-delivered **Chronicle-Dual-Track-Followups-Source.zip**, not the original M1 kit or an older VP08 archive.

Expected source ZIP SHA-256: `01d53ccbb66c714742daff43aa6bb6f2981ffefaa8d0a11bbdb9224f588d4844`.
Expected matching runnable ZIP SHA-256: `8a4a0c22716d7713a6899e904af6bf1e40417af2e6bf1dc885fa2bea32ce89e0`.
Expected packaged build: `chronicle-fb796598d29d466af238699a4f3079d1ce2bd5ac0f7d181d388dff12eb303017`.

Read all applicable AGENTS.md guidance, current source, SESSION.md, LOCAL-FOLLOWUPS-ACCEPTANCE.md, DUAL-TRACK-ACCEPTANCE.md, SEMANTIC-CONTRACTS.md, PREMODERN-PILOT.md and the implementation plan. Reconcile the new task with existing instructions; do not overwrite unrelated guidance. Discover the actual working tree and preserve uncommitted changes. The delivered archive has no Git metadata; do not invent a current commit or use its old provenance commit as HEAD.

The prior builder reported 356 passing tests. Reproduce the actual baseline where dependencies are available; report any missing dependency/network/runtime precisely, without silently changing pinned versions. Preserve all 2,282 protected files and the existing Atlas. The saved 35.6/95.4 ms p95 results are prior evidence, not current-run measurements.

## Product outcome

Deliver one integrated research workspace that can display both registered evidence pilots through reusable contracts and host-owned interaction state. It must be ready for a real natural-language planner without forcing that planner to target a second disconnected catalogue application.

This is implementation work. Do not stop after drafting another schema, adding more fixed catalogue filters, or packaging unchanged behavior.

## A. Bridge contracts and implement linked qualitative views

1. Identify the existing `src/research` runtime and the newer `research-semantic` contracts. Make one explicit, authoritative contract for new planner outputs and a bounded compatibility adapter for old prepared workspaces and replays. Preserve old archives under their pinned versions; no silent edition or hash substitution.
2. Route both pilots through the same revision activation, selection, host cursor and analytical-window services. Do not add a second Atlas clock or a competing selection store. A chart can retain its full analysis window while the host cursor moves.
3. Preserve modern points/scatter/table/evidence and add premodern reference points plus a qualitative event-interval view/table/evidence. Keep event support, composition support and unknown positional accuracy distinct. Do not draw inferred trade edges, flow volumes, population radii or interpolated facts.
4. Validate renderer capabilities: do not accept a view type that the active renderer does not implement. A validated specification must actually control which registered views render, not be discarded before a hardcoded screen.
5. Keep selecting a source record separate from an explicit request to focus the map or period. Do not turn uncertain dates into a fabricated precise historical day.
6. Stage and activate the complete new revision atomically. Preserve the previous usable workspace on empty/error/stale results with accurate status and no mismatched evidence.

## B. Complete replay and follow-up reliability

1. Remove the unconditional dependency on both pilots when reopening a single-pilot study. Preflight bounded archive structure and registered IDs, then load only required host-allowlisted dependencies. Never follow an archive-provided URL/path.
2. Test a valid modern replay while the unrelated premodern asset is unavailable, and the converse.
3. Preserve existing narrowing-only archives. Make refine/reset semantics explicit. Add new branching/broadening behavior only through a versioned contract, not by weakening ancestry/scope checks.
4. Introduce a versioned complete-workspace replay format before saving dynamically selected layouts. Persist approved view specifications, source/result references and compiler/policy versions, not secrets or restricted source passages.
5. Add tests for empty years, stale parent, altered ancestry, changed source/policy, interrupted loading, byte/revision limits, duplicate/no-op revisions, cancellation and previous-state preservation.

## C. Build the planner boundary without silently enabling it

Implement a provider-neutral planner interface that accepts an explicit question and permitted catalogue context and proposes the same typed QueryIntent/QueryPlan/DashboardSpecification used by the integrated runtime. Use trusted bounded execution, no arbitrary SQL/code, model-controlled loaders or imports.

Support cancellation, time/token/tool budgets, one proposal plus at most two bounded repairs by default, structured errors, redacted logs and an explicit unavailable-provider state. Preserve prepared examples as examples; never return one as the answer to an unsupported arbitrary question.

Create an evaluation harness with held-out paraphrases, selection/date revisions, unfamiliar supported combinations, unsupported quantities, conflicting definitions, sparse qualitative evidence, prompt-injection content, malformed output, provider failure and stale completion. Report plan validity, answerability handling, numerical correctness, evidence/claim support and follow-up fidelity separately. Offline fixtures are not evidence that live generation works.

The current source schemas require `modelProcessing:false`. Do not change these flags or send source records/derived content to any model merely to complete a demo. Document a minimal future data-flow/permissions contract for the planner, including any metadata-only path; metadata and model-derived uses also need an explicit applicable permission review. A local model does not bypass source-processing restrictions.

**Live inference is not authorized by this proposed work order alone.** A live M2 exit run needs a separately explicit provider authorization, configured credentials through an approved environment, an approved budget and processing rights for all transmitted material. Complete the independent integration and harness work even if those prerequisites are absent. Do not ask for credentials in chat or install paid infrastructure unilaterally.

## D. Acceptance and environment work

Use the exact built production package for browser checks, not just the development server. Inspect desktop and an actual 375 CSS-pixel viewport. Exercise both pilots, current follow-up controls, keyboard focus, typed Space, save/reopen, invalid files, long source text and error/empty states.

Preserve the original benchmark (at least 200 interactions per phase, same endpoint definition) and targets: selection p95 <=50 ms; combined selection/host-year p95 <=100 ms. Add separately identified tests for actual observation/checkpoint changes, multiple years beyond the two-year cache, pan-plus-scrub, and a larger already-registered supported workload. Report warm/cold and old/new measurements separately. Save all raw samples, scope, renderer, build identity and timing endpoints; do not cherry-pick reruns.

Run available actual MapLibre style-reload, reduced-motion and lifecycle scenarios with ready-state evidence. Separate deterministic fixtures, browser media emulation, actual OS preference and physical-device tests. RequestAnimationFrame callback frequency is not physical frame presentation. A browser policy/network block must remain BLOCKED; do not bypass it or declare a pass based on HTTP serving alone.

Run physical Windows/GPU/mobile checks only where a genuinely available authorized device/runtime exists. Missing devices do not stop independent code work, but their acceptance remains NOT RUN. Do not claim certification, zero GPU leaks or 60 fps without applicable evidence.

## E. Restore the missing M3 design deliverable

Add a standalone `docs/research-workspace/M3-ISOLATION-THREAT-MODEL.md` (or established equivalent), decoupled from executable application code. Define protected assets, adversaries, trust boundaries, permitted inputs/outputs, credential isolation, network/filesystem denial, read-only data staging, time/CPU/memory/process/output/storage limits, termination, stale results, output validation and negative tests. Identify unresolved environment decisions and the evidence needed to approve one. Do not enable a sandbox, generate scripts or claim isolation based on a Worker name.

## Delivery

Return the integrated source and matching runnable build, exact identity/hashes, source and protected-baseline checks, complete test results, inspected visual receipts where available, workload traces, explicit gate statuses and a short SESSION.md. Update acceptance without overwriting old evidence. Show both normal user journeys through the same workspace. Keep live planner, M3 execution and M4 publication statuses separate.

Do not replace the renderer, ingest new canonical history, change source rights, publish/relicense, deploy, push remotely or spend money under this task. Do not claim the larger milestones complete merely because the adapter and test fixtures exist.

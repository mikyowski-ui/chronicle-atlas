# M2 integration and planner readiness — acceptance, 2026-10-07

## Outcome and scope

Both registered pilots now use the same Research workspace, controller, selection, host cursor adapter and view activation. The modern journey retains scatter/table/source evidence; the premodern journey adds source-backed reference points and selectable event intervals, with composition dates and unknown spatial accuracy kept separate. Approved view specifications control the rendered view set. The disconnected catalogue is no longer mounted in the production path.

The new complete-workspace replay saves approved layout, source-pinned narrowing ancestry, selection and the research cursor year. Original population and local-follow-up archives retain their original validation semantics. A single-pilot replay no longer requires the unrelated asset. Narrow/reset remains explicit; a no-op does not consume a revision. Empty/error/stale operations retain the previous workspace. A failed render notification rolls back state and re-renders the previous snapshot; persistent renderer failure is reported as restored data rather than a claimed visual pass.

A provider-neutral, disabled-by-default planning boundary now accepts proposals in the same v2 contract, with cancellation, bounded repairs, budgets and redacted logs. Production unsupported questions get PROVIDER_UNAVAILABLE with zero provider attempts. All evaluation is offline fixtures, not live inference. The separate M3 isolation threat model is present; execution remains disabled.

## Baseline reconciliation

The supplied source/runnable ZIP hashes matched exactly:

- Source: `01d53ccbb66c714742daff43aa6bb6f2981ffefaa8d0a11bbdb9224f588d4844`
- Runnable: `8a4a0c22716d7713a6899e904af6bf1e40417af2e6bf1dc885fa2bea32ce89e0`.

The current workspace also had a later checkpoint (`chronicle-a5b13f7284a6ccde92634e6c3e17f4bd7eaefbd40d84882fc52f7a8a89b8ce75`), additional final-review evidence and a disposal guard. Six tracked archive paths differed; they were preserved and reconciled, not reset. See baseline-differences.json. No Git metadata/current HEAD exists. The new work order was copied into the repository alongside the review. Existing instruction files and prior receipts remain intact.

## Fresh executed checks

| Gate | Status | Evidence |
|---|---|---|
| Baseline regression | PASS | 356 tests; baseline-tests.log |
| Final regression | PASS | 386 tests, no failed/cancelled/skipped tests; tests-final.log |
| TypeScript + Vite build | PASS | build-final.log; existing large-bundle warning retained |
| Protected baseline | PASS | 2,282 files unchanged; protected.json |
| Source fingerprint matches build | PASS | 2,354 fingerprinted inputs; source-build-match.json |
| Production serving | PASS | Seven emitted assets/identity/harness files matched bytes over HTTP, plus range 206; production-server.json |
| Modern lineage | PASS | 44 observations, four places; retained UN and canonical inputs unchanged |
| Premodern lineage | PASS | Ten accounts, nine places; retained source register unchanged |
| Unified runtime/legacy compatibility | PASS | 15 targeted tests inside final suite: both pilots, exact legacy validation, source equality, independent replay loading, schema/capability rejection, cursor/window separation, complete replay, outside-window selection, empty/no-op, cancellation/timeout/stale, malformed/oversized input, mixed-ID preflight, render rollback and disposal |
| Planner boundary | PASS — offline only | 15 targeted tests; unavailable/live-blocked, repairs, budgets, malicious proposals, provider failure and stale/cancelled response handling |
| M3 threat-model document | DELIVERED — design only | docs/research-workspace/M3-ISOLATION-THREAT-MODEL.md; negative execution checks NOT RUN |

All fresh receipts are in `apps/explorer/verification/m2-integration/`. Package integrity/identity/hashes are recorded in the release package receipt. No dependency version, lockfile, historical record or source policy was changed.

## Offline planner evaluation

| Metric | Pass | Fail | Not applicable |
|---|---:|---:|---:|
| Plan validity | 4 | 0 | 6 |
| Answerability handling | 10 | 0 | 0 |
| Numerical correctness | 3 | 0 | 7 |
| Constrained evidence lineage | 4 | 0 | 6 |
| Follow-up fidelity | 2 | 0 | 8 |

See offline-planner-evaluation.json and PLANNER-BOUNDARY.md. These are prewritten response fixtures; no language model was evaluated. Evidence support checks source-bound records, not historical truth or arbitrary narrative claims. Token accounting and cooperative provider cancellation are boundary mechanics, not certification of an untrusted live transport.

## Blocked and unrun environment gates

| Gate | Status | Reason |
|---|---|---|
| Exact production browser interaction | BLOCKED | Separate browser returned net::ERR_CONNECTION_REFUSED; no alternate network route or policy bypass attempted |
| New desktop and actual 375 CSS-pixel visual inspection | BLOCKED | Same reachability; no new screenshots claimed |
| Browser save/upload/reopen, invalid files, keyboard/typed Space, long text | BLOCKED | Same reachability; deterministic tests do not replace UI verification |
| Original 200+200 performance benchmark | BLOCKED | No fresh browser run/sample set |
| Checkpoint/multi-year/pan/qualitative workloads | BLOCKED | Implemented opt-in production harness, not run here |
| Actual MapLibre reload/GPU memory | NOT RUN | No reachable MapLibre runtime; deterministic lifecycle suite passed only |
| Reduced-motion browser media emulation / actual OS preference | NOT RUN | No reachable authorized preference-capable browser; deterministic motion tests passed only |
| Physical Windows/GPU/mobile/scanout | NOT RUN | No physical device available |

The production harness is available at `/production-review.html` (375 CSS-pixel iframe) and `/?verify=1` (timing/lifecycle controls) after running the local server. Original benchmark thresholds/endpoints are retained. Extended raw sampling uses 200 actions per named phase. It does not fabricate a larger dataset: 44 rows/four places is the largest registered numerical pilot; the qualitative pilot has nine places. Its sequential first-encounter/revisit reporting does not certify truly cold caches.

Prior dual-track timings 35.6/95.4 ms, and later retained final-review timings 44.8/88.9 ms, belong to previous development-preview builds. They are not fresh measurements of this integration. RAF callback rates are not physical frame presentation. No new performance PASS or zero-leak/GPU certification is asserted.

## Reproduce and continue

From `source/apps/explorer`, Node >=22.13:

```sh
corepack pnpm install --frozen-lockfile
(cd research-semantic && corepack pnpm install --frozen-lockfile --ignore-scripts)
corepack pnpm test
corepack pnpm run build
python3 scripts/verify-m2-integration.py
node serve.mjs
```

Open http://localhost:4173/. The runnable archive needs only the last command, with Node installed. Normal user journeys and contract details: M2-INTEGRATION.md. The build ID for this checkpoint is `chronicle-8d0829ebd21b4bd21dda135ae9b0da09eb32d2df93f696f1fdd01de7484c4311`; source fingerprint `8206b8ec85dbabecb270e01c589d3ed93066ade7b6b857a12556069ad7bdb869`.

M2 integration/planner readiness is implemented but its browser acceptance remains open; live M2 generation is not complete. Live inference still needs explicit provider authorization, approved credentials/budget and a field-by-field processing permission decision. Existing modelProcessing:false stays unchanged, including for local models and proposed metadata paths. M3 is documented only and not executable. M4 extraction/publication is not delivered; no rights or license changes, deployment, remote push or spending occurred.

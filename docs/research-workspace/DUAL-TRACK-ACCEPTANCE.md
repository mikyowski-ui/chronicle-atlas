# Dual-track sprint acceptance — 2026-10-07

Delivered inside the recovered Chronicle Explorer source, following `DUAL_TRACK_EXECUTION_PROMPT.md`, root `AGENTS.md` and `IMPLEMENTATION_PLAN.md`. This implements M1 responsiveness remediation and the authorized M2 semantic contracts/dual-pilot slice. It does **not** complete the full M2 live planner or Milestones 3–4.

## Verified result

| Gate | Result | Evidence / limit |
|---|---|---|
| Final TypeScript + production build | PASS | `build-final.log`; existing large-chunk warning remains |
| Full regression suite | PASS | 350 passed, 0 failed/cancelled/skipped; `tests-final.log` |
| Protected baseline | PASS | 2,282 unchanged; no missing/modified files; `protected-audit.json` |
| Selection latency, 200 actions | PASS | 35.6 ms p95, target ≤50 ms |
| Selection + host-year, 200 actions | PASS | 95.4 ms p95, target ≤100 ms |
| Continuous within-year scrub | PASS | 59.51 RAF opportunities/sec over six seconds; target ≥58 |
| Continuous year-crossing scrub | PASS | 59.51 RAF opportunities/sec over six seconds; four 2000/2001 crossings |
| Coordinated selection/lifecycle | PASS | No mismatches in 400 actions; 20 result-close/reopen +20 complete mount/dispose cycles; original Canvas preserved |
| Minimum viewport | PASS | Actual 375×812 CSS iframe; document scrollWidth375, panel355px within viewport; source text reachable in panel scroll |
| Existing Atlas with Research off | PASS | No Research button; timeline ready; Studies and its303 source links still available |
| Modern source lineage | PASS |44 cells /4 centres exactly checked against retained inputs |
| Premodern source lineage | PASS |10 retained accounts /9 places, exact record and file hashes |
| Semantic schemas / replay / negative cases | PASS |24 focused tests within full suite; bounds, allowlists, source pins, joins, unknowns, hostile nested input and Function-denied fresh-process test |
| Pinned replay in browser | PASS |Saved Mexico City2000 result reopened against matching records and kept its selection |
| Reduced-motion policy | PASS (deterministic tests) |Real DetailCanvas draw operations tested with injected preference changes; no new tween scheduling |
| Actual OS reduced-motion=true browser | NOT RUN |Available browser reports false; supported browser controls expose no preference emulation |
| MapLibre reload lifecycle | PASS (deterministic tests) |Single owned style listener, restoration, timeout/error/supersession/disposal coverage |
| Actual MapLibre style reload / GPU memory | NOT RUN |Available browser selected Canvas fallback; live reload harness returns NOT_RUN, not a simulated pass |
| Physical Windows GPU / mobile / scanout | NOT RUN |No physical devices available; RAF is not physical scanout |
| Built local server | PASS |Eight emitted assets served with matching hashes; byte-range206 check; `built-server.json` |
| Production-bundle browser interaction | NOT RUN |Visual/browser interactions used development preview; production assets and local server independently verified |

Receipts are in `apps/explorer/verification/dual-track/`; semantic-specific evidence is in `verification/research-semantic/`. Earlier M1 acceptance/receipts are retained unchanged. Screenshots were captured from the running UI and visually inspected, including the timeline cursor after its transform change.

## Performance method and changes

Environment: Chrome 154 in the cloud browser, 1363×936 viewport, DPR 1,Canvas 2D fallback. Warm 44-observation /4-city pilot; actual 2000↔2001 host-year reversals. Endpoints remain the original M1 selection/host-seek to two animation-frame opportunities. No timing thresholds or sample counts were relaxed. No new warm network requests; no coordinated-selection failures. Final selection CPU p95 is 3.0 ms; combined-phase selection CPU p95 is 4.5 ms. Both six-second continuous scrub phases use real canonical-day `motion.scrub` calls, verify the final committed target and restore the initial cursor. Idle diagnostic was59.52 RAF/sec. This is a local workload pass, not a guarantee across all dates, cold cities, cameras or hardware.

The dated-city cache holds at most two years and invalidates on source changes. Geometry and city candidates retain immutable identity/camera caches. Exact visible appearance comparison avoids redundant Canvas painting while always updating dated metadata for inspection; names, position, ranking, population radius, status, capitals, selection, other layers and active tweens invalidate reuse. The final combined workload reused the same 32-draw total throughout 200 updates instead of repainting identical pixels. Research updates only changed selection nodes, uses bounded two-line map callouts and cached bounds, and avoids repeated forced label measurements. Timeline text/position updates are deduplicated; the dock no longer blurs an empty backdrop. Timeline popovers remain outside paint containment.

Failures are preserved, not removed: earlier sprint selection/combined p95 pairs were 69.6/281.3,70.3/160.0,225.0/508.0,61.2/193.9 and51.0/137.9ms. Two earlier scrub runs missed 58 RAF/sec. Each subsequent run followed a concrete code change; the final passing receipts are `final-latency.json` and `final-scrub.json`. M1's 37.0/230.3ms results remain in its own acceptance report.

## Evidence and semantic scope

The existing linked map/chart/table/evidence view and authoritative Atlas clock remain intact. “Evidence catalogue” lazily opens a prepared semantic preview using the same strict Zod-derived QueryIntent → QueryPlan → resolved bundle → DashboardSpecification contracts for two contrasting pilots. It is explicitly separate coverage inspection: opening an account does not create a second clock or move the Atlas to an inferred date/location.

Modern: 44 retained UN WUP 2025 estimates at five-year intervals, 1975–2025. These are **discrete published estimates**, not a continuous measured series. The retained inputs do not supply cell-specific confidence intervals or estimation methods; those remain unknown. Changing urban extents block automatic arithmetic/comparisons. `modeled` is the broad estimate class with this method limitation retained, not a newly inferred model.

Premodern: 10 existing source-attributed editorial account summaries at 9 approximate modern reference points, 40–1516 CE. Event and composition intervals are separate; source and record hashes/pointers are retained. `attested` establishes presence of the account record, not universal truth or eyewitness certification. No new primary quotations, reconstructed trade edges, numerical trade flows, population values or uncertainty radii were invented. Quantified positional uncertainty is null because sources do not supply it. Translation/source claim review is not expanded by this software task. Local-preview use is distinct from republication/model-processing permission; neither latter permission is enabled.

Contracts reject unknown fields, unregistered datasets/indicators/entities, out-of-envelope bounding boxes/epochs, oversized/deep/non-JSON input, unsupported views/loaders/code, incompatible measures and unregistered normalizers. Replay pins fixture/source/semantic-policy/result hashes and excludes source passages and credentials. Zod 4.6.5 is pinned in a separate private package, with JIT disabled before schemas are constructed; root dependency files/security policy remain unchanged. No new `any` or loose string index signatures were introduced; pre-existing legacy permissive types were not broadly rewritten.

## Reproduce

Node 24.19.0, pinned pnpm 11.19.0. From `apps/explorer`:

```sh
corepack pnpm install --frozen-lockfile
cd research-semantic
corepack pnpm install --frozen-lockfile --ignore-scripts
cd ..
corepack pnpm test
corepack pnpm run build
python3 scripts/build-research-pilot.py --check
python3 scripts/build-premodern-pilot.py --check
python3 scripts/verify-dual-track.py
corepack pnpm dev
```

Open Research → Focus study area → Local verification tools for latency, scrub and style-reload receipts. `/research-review.html` includes 375×812, 390×844 and 430×932 review sizes. Use `?research=off` for the Atlas regression path.

Built packet: `node serve.mjs`, then `http://localhost:4173/`; Node ≥22.13 required, no dependency installation. Server verification used `PORT=4188 node serve.mjs` and matching HTTP assets/ranges within one owned process lifecycle. A separate ephemeral 4187 process was not reachable; this initial environment failure is recorded rather than counted as a pass. No new Windows EXE was built.

Build:`chronicle-fe95cbbb0cb4f59790515c168b21d27fcb17ea837ee8fdcb8c1335c3ae94ab2a`. Source fingerprint:`6dfa8fb079c699caf3f8b62f1a03355f760fda7200fa81c3baaee1e880ee318a`. No `.git` exists in the recovered archive, so current HEAD/dirty status is unavailable. Original archive commit remains provenance only.

## Remaining boundaries

Full M2 live retrieval/planning/follow-up evaluation needs a separate authorized provider/budget/permission work order. The active prompt explicitly prohibits live inference and M3 execution. M3 still needs an enforceable isolation environment and adversarial execution tests. M4 needs demonstrated reuse in a second application, dependency/data rights review and separate publication authority. No live model, arbitrary generated code, new historical publication, remote push, deployment or outside infrastructure was enabled. Existing historical coverage gaps are unchanged. Available next checks are the real MapLibre/hardware/OS-preference gates above; their harnesses are delivered.

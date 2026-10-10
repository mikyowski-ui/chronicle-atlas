# Final integrated research review — 2026-10-07

This review covers the current recovered Chronicle Atlas, the dual-track rendering/semantic work, and the local follow-up controls found in the current workspace. Earlier M1, dual-track and local-follow-up reports are preserved as historical checkpoints. This report supersedes their browser-blocker statements only for checks explicitly performed below. It does not declare all roadmap milestones complete.

## Current result

| Check | Result | Evidence or boundary |
| --- | --- | --- |
| Full regression suite | PASS | 356 tests; zero failures, cancellations or skips |
| TypeScript and production build | PASS | Existing large-chunk and build-plugin timing warnings remain |
| Current source matches built identity | PASS | All 2349 fingerprinted source inputs match the built bundle identity |
| Protected historical/publication baseline | PASS | All 2,282 protected files byte-unchanged |
| Warm selection, 200 actions | PASS | 44.8 ms p95 against 50 ms |
| Warm selection plus host year, 200 actions | PASS | 88.9 ms p95 against 100 ms |
| Continuous within-year scrub | PASS | 58.35 RAF callbacks/sec over six seconds against 58 |
| Continuous year-crossing scrub | PASS | 58.85 RAF callbacks/sec over six seconds against 58 |
| Linked map/chart/evidence and lifecycle | PASS | No mismatch in 400 actions; 20 result replacement/close cycles and 20 full mount/dispose cycles; same Canvas object |
| 375 × 812 CSS viewport | PASS | Document scrollWidth 375; panel x10,width355,bottom590; dock x0,width375,bottom812. Long source evidence scrolls inside the panel |
| Keyboard and catalogue on narrow screen | PASS | Native Enter/Space activation; 10-account result; playback stayed paused; map-collapse control worked |
| Modern and premodern catalogue | PASS | 44 urban estimates /4 places; 10 account records /9 places; dated Kilwa evidence inspected |
| Original Research replay | PASS | Save/reopen reported matching records in browser |
| Local follow-up narrowing | PASS | Samarkand narrowed to 1300–1450 CE: one retained account, revision 2 |
| Local follow-up save/upload/reopen UI | BLOCKED | Save returned a browser download handle; upload/reopen check was interrupted. Download bytes were not available in the final local handoff; no browser restore pass is claimed |
| Local follow-up restore/security contracts | PASS | Six tests cover both pilots, narrowed ancestry, tampering, gaps, stale parents, privacy and budgets |
| Research disabled / existing Atlas | PASS | No Research button; one Canvas; Studies opened; Mexico country selection and source context remained usable |
| Both retained-source generators | PASS | Exact 44-cell modern check and 10-account premodern check |
| Built local HTTP server | PASS | Emitted assets match bytes; range request returns 206; owned server stopped after checks |
| Reduced motion | PASS, deterministic tests | Actual DetailCanvas drawing with injected preference changes; in-flight tween completion and no new tween scheduling |
| Native OS reduced-motion=true browser | NOT RUN | Available browser preference false; no supported preference emulation |
| MapLibre lifecycle | PASS, deterministic tests | Listener ownership, state restoration, errors, supersession, timeout and disposal |
| Actual MapLibre reload / GPU memory | NOT RUN | Available browser selected Canvas. Live harness explicitly returned NOT_RUN |
| Physical Windows/mobile/scanout | NOT RUN | No physical devices available |
| Production-bundle browser interaction | NOT RUN | Browser QA used development preview; production output separately byte-checked over HTTP |

Receipts and inspected screenshots: `apps/explorer/verification/final-review/`. Earlier failed timings remain in `verification/dual-track/`; no failures were deleted or thresholds relaxed. Measurements varied during development, including substantial misses. The final completed latency and scrub receipts above are separate named local runs, not a cross-device performance guarantee. Interrupted runs have no passing receipt. Browser environment: Chrome 154, 1363×936, DPR1, Canvas 2D. Warm workload uses the existing four-centre/44-observation pilot and 2000↔2001 reversals; timing ends after awaited host delivery and two animation-frame opportunities. RAF callbacks are not physical scanout. Warm resource requests are recorded in the receipt.

## Implementation and evidence

A bounded two-year dated-city cache, immutable geometry/camera caches and exact visible-appearance reuse reduce repeated work. Inspection always receives current dated metadata. Changed appearance, selected places, other layers and active tweens invalidate reuse. Research updates only previous/new selection nodes, uses bounded callout dimensions and resize-driven bounds, and avoids forced label measurement. The dock no longer performs unnecessary backdrop blur. Timeline event popovers remain unclipped.

Strict Zod/TypeScript contracts separate intent, plan, resolved evidence, dashboard and replay. Fixed catalogue identifiers, reference-point bounding boxes, epochs, indicators, units and source hashes constrain every query. Unknown fields, executable content, external loaders, oversize inputs and incompatible joins fail closed. Zod runs with JIT disabled; a fresh-process Function-denial test passes. The root dependency manifest and lockfile remain protected; Zod is pinned in the isolated `research-semantic` package. Its license notice is included.

Both real pilots remain authorized local previews. The UN data are discrete five-year estimates, not a measured continuous series; retained metadata supplies no confidence intervals. Premodern records retain editorial account summaries, event/composition intervals, perspective, limitations and exact source/record hashes. Positional radii are unknown. No trade edges, primary quotations, demographic percentages or historical borders were invented. Source consistency is not certification of historical truth or republication rights.

The current local follow-up feature narrows place/date scope, validates parent-linked revisions, and exports reference-only study archives. It has no natural-language planner and does not change the Atlas clock. A small final cleanup makes an already-aborted catalogue refuse a new fetch. That cleanup occurred after the performance capture and does not change the measured warm renderer path; the complete current source was rebuilt and regression-tested afterwards.

## Verified commands

Node v24.19.0 was used; application minimum is Node 22.13. Pinned package manager: pnpm11.19. From `source/apps/explorer`:

```sh
corepack pnpm install --frozen-lockfile
(cd research-semantic && corepack pnpm install --frozen-lockfile --ignore-scripts)
corepack pnpm test
corepack pnpm run build
python3 scripts/build-research-pilot.py --check
python3 scripts/build-premodern-pilot.py --check
python3 scripts/verify-dual-track.py
python3 scripts/verify-final-review.py
corepack pnpm dev
```

Development: open Research; Local verification tools expose the fixed workloads. `research-review.html` provides actual 375/390/430 CSS iframe sizes. Use `?research=off` for regression checks.

Runnable packet: extract it, run `node serve.mjs`, open `http://localhost:4173/`. No package installation is required for that prebuilt packet. The HTTP verification used `PORT=4194 node serve.mjs`. This is a local browser application, not a newly built Windows EXE.

Build: `chronicle-a5b13f7284a6ccde92634e6c3e17f4bd7eaefbd40d84882fc52f7a8a89b8ce75`. Source fingerprint: `4144e3c22ec5eecd9d3512feaec79c0d08bd6719d2f6d2ba420ed63342af413d`. Recovered source has no `.git`; current HEAD/dirty status is unavailable. No commit, push, deployment, historical publication or project-wide relicensing was performed.

## Remaining milestones

The authorized semantic-contract slice and bounded local follow-ups are implemented. Full M2 live planning still requires an authorized provider, processing permissions, budgets and held-out planner evaluation. The active dual-track prompt expressly excludes inference and M3 execution. M3 additionally requires enforceable isolation and adversarial execution tests. M4 still requires demonstrated independent application reuse and rights review. These are remaining gates, not completed milestones. Physical/runtime checks above and the interrupted upload/reopen UI check remain open.

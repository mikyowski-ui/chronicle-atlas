# Research Workspace Milestone 1 — acceptance

Implemented October 7, 2026 in the existing Atlas. **The functional feature is delivered; acceptance has a measured combined-update performance miss and an unrun reduced-motion preference check.** This is not an unqualified all-gates pass. Milestones 2–4 remain outside this work order.

Research opens from the existing toolbar. The primary prepared question resolves 44 UN WUP 2025 estimates for four Mexican urban centres in 1975–2025; the variation resolves eight Guadalajara observations in 1990–2025. The same bounded query/validation/runtime powers summary, temporary map points, scatter chart, table and evidence inspector. Shared selection uses stable IDs; host time stays independent from the analysis window. Unknown natural-language requests are explicitly unsupported. Replay pins data and policy, without a model.

No live model service, generated code executor, dependency, infrastructure, remote publication, historical ingestion or canonical modification was introduced. Population levels are displayed separately; geographic continuity is insufficient for growth, totals, ratios or causal claims.

## Acceptance matrix

| ID | Status | Evidence / limits |
| --- | --- | --- |
| W1-01 | **PASS** | Recovered editable source, reproduced original build and 282-test baseline. Archive has no Git checkout; HEAD/dirty status unavailable and recorded. See BASELINE.md. |
| W1-02 | **PASS** | 2,282 protected files byte-identical, including canonical public data, contracts, lib, package and lockfile. See protection-check.json and protected-inputs.json. |
| W1-03 | **PASS** | 44 actual UN source cells and canonical pointers verified independently; source hash, edition, rights and conversion recorded. No synthetic normal-path rows. |
| W1-04 | **PASS** | 44-row/four-city primary and 8-row Guadalajara variation use identical contracts, executor and views. Prepared mode is explicit. |
| W1-05 | **PASS** | Chart, map and inspector resolve identical stable entity/observation IDs; both directions exercised in browser and 400-action workload. |
| W1-06 | **PASS** | Cursor/window separation, sparse dates, range/BCE/end-exclusive helpers and year conversion tested. Pilot preserves year precision and mid-year meaning; uncertain ranges are helper tests, not fabricated pilot records. |
| W1-07 | **PASS** | Unknown units/denominators, null/zero, non-positive denominator, incompatible or mismatched entity geography and duplicate joins rejected. Pilot accepts observations only; no arithmetic query is enabled. |
| W1-08 | **PASS** | Out-of-order requests, A-B-A, cancellation and timeouts tested. Revision barriers and immutable staged results prevent mixed evidence. |
| W1-09 | **PASS** | Malformed/empty/missing/timed-out/bad-reference queries preserve last valid workspace. UI unsupported question and bad replay retain prior evidence with status. |
| W1-10 | **PASS** | Actual Canvas object identity retained, canvas count 1→1. 20 replace/close cycles plus 20 full mount/dispose cycles; owned listeners/observers/subscriptions return to baseline or zero on disposal. |
| W1-11 | **PASS** | Strict runtime boundary rejects nested loaders, executable/HTML/SVG fields, unknown references/operations and oversized inputs. Cell instructions remain inert text. This is scoped testing, not general security certification. |
| W1-12 | **PASS** | All 44 source-thousands conversions match independently checked rows and displayed persons. Workbook cell, canonical pointer and transform lineage resolve every mark. |
| W1-13 | **PASS** | Actual UI save/reopen plus missing/hash-changed tests. Exported manifests use normalized host text and registered references/hashes; no measurement rows, arbitrary question text, source passages or credentials. |
| W1-14 | **PASS** | Both 200-interaction warm phases record zero resource requests; no model/provider integration exists. Ordinary base-map loading is outside this measured warm phase. |
| W1-15 | **NOT RUN** | Keyboard, visible focus, typed Space, native button Space, table and narrow layout PASS. Reduced-motion preference=true runtime NOT RUN: browser preference=false, no emulation capability; CSS reviewed and no running research animations observed. |
| W1-16 | **PASS** | Desktop and actual 390x844 CSS app screenshots inspected: chart labels/units, no overlapping research callouts, readable table/evidence, map mode and dock. Screenshots listed below. |
| W1-17 | **PASS** | Research-off Atlas navigates dates, selects France, opens country context, Studies and source inspector in Canvas. Existing 310-test suite passes. WebGL/style-reload and physical-device checks NOT RUN. |
| W1-18 | **FAIL** | Measurement complete: warm selection p95 37.0 ms PASS; combined selection+year p95 230.3 ms FAIL against same 100 ms target. Previous combined 216.1 ms miss retained. No 60 fps or physical-device claim. |

## Executed commands

From `source/apps/explorer` with Node v24.19.0 and pinned pnpm 11.19.0:

```sh
corepack pnpm --version
corepack pnpm install --frozen-lockfile --offline
corepack pnpm run build
corepack pnpm test
python3 scripts/build-research-pilot.py --check
node --import tsx --test tests/research-workspace.test.ts
```

Pinned install, TypeScript and production build PASS. Final full suite: **310 passed, 0 failed, 0 skipped** (5.920 seconds). The independent research file contains 27 test cases; the added native-control Space regression is in the existing fixture test file. `--check` verifies retained workbook and canonical hashes, all 44 source cells, and deterministic derived bytes. No canonical compiler was run. Existing Vite large-chunk advisory remains (approximately 4 MB minified JavaScript).

`PORT=0 node serve.mjs` passed a separate production HTTP smoke: Atlas shell, compiled Research code, pinned 44-row asset and feature-off entry returned successfully. For normal use run `node serve.mjs` and open `http://localhost:4173/`. The runnable packet requires Node >=22.13.0 and no dependency installation.

An attempted `corepack pnpm exec tsx --test ...` invocation hit this environment's `/tmp/tsx` IPC `EPERM`; the repository's documented `node --import tsx --test` command works and is what passed. This was a runner invocation limitation, not a suppressed application test failure.

## Browser and performance evidence

Environment: cloud Chrome 154, Canvas 2D fallback, 1363×936 CSS-pixel desktop, DPR 1. The browser's compatibility user-agent contains a Macintosh string; this is not evidence of a physical Mac. Narrow review embeds the actual app at 390×844 CSS pixels, not a phone simulator or physical-device result.

`performance-final.json` records two phases over the loaded four-entity/44-row workspace:

| Workload | Samples | p95 | 100 ms target |
| --- | ---: | ---: | --- |
| Selection only, fixed host cursor | 200 | 37.0 ms | PASS |
| Selection plus host cursor alternating 2000/2001 | 200 | 230.3 ms | FAIL |

Endpoints start before the normal selection action and end after two animation-frame opportunities following the coordinated DOM update; the combined phase also awaits the host seek. These are browser timing opportunities, not physical display scanout. Exact selected IDs across chart/map/evidence were checked for every action with no functional mismatch. Both phases recorded zero warm resource requests. Twenty result replace/close cycles and twenty complete view/controller mount/dispose cycles retained the same Canvas and returned owned resources to baseline; disposed instances reached zero owned listeners, observers, subscriptions and connected nodes.

The initial combined workload measured 216.1 ms p95 and remains preserved as `combined-performance-first.json`. Its first prepared execution took 2,004.3 ms; previously loaded executions were 26.7–59.1 ms. The subsequent first execution took 226.5 ms. These first-execution figures include the local loader but **are not controlled empty-browser-cache cold benchmarks**. No threshold was moved to conceal the miss. Final performance measurement preceded only the native-keyboard-routing and unused comparability-guard hardening; neither changes the measured programmatic selection path. Final compilation/tests and keyboard browser checks followed those fixes.

Physical Windows GPU, physical mobile, WebGL/MapLibre style reload, preference=true reduced-motion execution, hardware scanout and a 60 fps trace are **NOT RUN**. No leak-free heap-size or physical-frame-rate claim is made.

## Inspected visuals and manual checks

Evidence lives in `apps/explorer/verification/research-workspace/`:

- `desktop.jpg`: linked Guadalajara 2000 selection, chart units, actual marker anchors, other markers' 2025 reference years, unchanged 2025 host cursor, full-width timeline.
- `narrow-chart.jpg`, `narrow-table.jpg`, `narrow-evidence.jpg`, `narrow-map.jpg`: actual 390-pixel app, keyboard focus, table scrolling, source semantics and compact map mode.
- `disabled-regression.jpg`, `disabled-dom.txt`: Research disabled; France selected in the 2000 map, original source inspector and timeline usable.
- `browser-review.json`: exact manual checks, including Enter and native Space selection with paused playback, unsupported text, variation selection preservation, successful replay and explicit hash-failure retention.
- `prepared-{primary,alternate}.json`, `replay-{primary,alternate}.json`: reproducible approved examples and normalized manifests.
- `final-{build,tests}.log`, `final-build-info.json`, `pilot-check.log`, `serve-smoke.json`, `protected-inputs.json`, `protection-check.json`, `source-changes.json`: command, identity and preservation receipts.

Replay verifies exact derived-data bytes and original-source hash references. It does not reread the XLSX workbook in the browser on every replay; the offline derivation check verifies those source bytes. Software traceability does not independently certify UN estimates or historical interpretation.

## Remaining boundaries

The collection is a narrow registered pilot, not all-city coverage, a general question engine, border interpolation or historical publication. The older full-grid compiler still lacks the wider project's mesh inputs; it is not needed for this integration. The recovered archive has no `.git`; original commit references establish archive provenance only. No Git commit/push is claimed.

Continue with the measured host-year responsiveness issue and unavailable environment checks if requested. Broader catalogue work/live planning is Milestone 2 and needs its own work order; custom code and public extraction remain later gated work.

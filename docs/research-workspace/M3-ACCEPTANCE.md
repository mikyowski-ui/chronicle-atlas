# Milestone 3 acceptance — approved application and virtual DOM profile

Date: 2026-10-07. **Status: PASS under the user's revised acceptance criteria.**

The user explicitly approved an application-level in-memory sandbox and virtual DOM substitutes after the environment denied native confinement setup and lacked Chromium. This report accepts those revised gates. It does not relabel OS isolation, rendered layout, or hardware timing as tested. The original M3 threat model remains preserved as the stronger design reference.

## Delivered behavior

The runtime now provides one fresh Node Worker per job, a restricted `node:vm` context, fixed reviewed operations, bounded JSON admission/output, V8 heap limits, execution deadlines, latest-wins cancellation, resource reclamation, and current-authority checks before returning a result. Only synthetic, host-staged records and hand-authored fixtures are admitted. There is no API accepting generated JavaScript, runtime paths, executable dependencies, or arbitrary guest callbacks. The prepared Research workspace retains its existing declarative activation path.

The provider connection is wired through the production `ResearchController` and existing `PlannerBoundary`. Explicit configuration, complete token budgets, host-only credential presence, and a six-field consent review are validated. Missing keys/budgets produce `PROVIDER_UNAVAILABLE`; even complete configuration remains `LIVE_NOT_AUTHORIZED` while `modelProcessing:false` is enforced. Controlled offline transports exercise the contract without network requests. No live provider-specific HTTP client, credential value, or enable switch is included.

The virtual DOM runner mounts the actual Research view, engine and controller, uses the pinned pilot records, and drives their existing controls. It does not replace them with a separate sample application. The runnable package includes a self-contained Happy DOM/PostCSS verification kit with dependencies and licenses, requiring no browser, package installation, or external network.

## Checkpoint identity and preservation

| Item | Verified value |
|---|---|
| Accepted parent | `chronicle-8d0829ebd21b4bd21dda135ae9b0da09eb32d2df93f696f1fdd01de7484c4311` |
| M3 build | `chronicle-78185328c2969b9946da16c06d07f1115015e6330a188f51d99cf2b9c79b6ce0` |
| Source fingerprint | `0c28ea1cb251dd28a765e9730a78db4b19c6767fd1f58402dd6478f1d144f7c6` |
| Fingerprinted inputs | 2,368, including runtime source and isolated verification package metadata |
| Protected files | 2,282 unchanged |
| Original tests | All 386 retained; all 49 original test files byte-identical to accepted M2 source archive |
| Git | Extracted source has no Git metadata; no fabricated commit, remote push, deployment, or publication |

Accepted M2 source archive SHA-256: `d4f59451acebdca8088d48ec4b356dec72f08707f08e181068dd6094de6ba793`. Main application package/lockfile, canonical history, mesh, narratives, source permissions and publication artifacts remain unchanged. Happy DOM 20.14.5 is pinned in the separate `verification-tools` package; frozen offline reinstall passed. Build retains the existing large-chunk warning.

## Executed acceptance

| Gate | Result | Evidence under `apps/explorer/verification/m3/` |
|---|---|---|
| Original checkpoint regression | PASS — 386/386 | `baseline-386-tests.log` |
| Final regression | PASS — 445/445; zero failed, cancelled or skipped | `tests-final.log` |
| TypeScript and production build | PASS | `build-final.log` |
| Protected baseline and retained tests | PASS | `protected.json`, `retained-tests.json`, `accepted-m2-tests.json` |
| Source/build identity and local HTTP bytes | PASS — 2,368 source inputs, seven served files and range 206 | `source-build-match.json`, `production-server.json` |
| Pilot lineage | PASS — 44 modern observations/four places; ten premodern accounts/nine places | `research-lineage.log`, `premodern-lineage.log` |
| Application runtime | PASS — 19 fixture/transform/revocation checks, A–B–A ordering and 20 lifecycle cycles | `runtime/application-acceptance.json`, `runtime/application-acceptance-final.log` |
| Provider/controller preparation | PASS — 20 new tests; zero live attempts | Included in final suite |
| 375px responsive substitute | PASS — parsed actual CSS policy, both pilot DOMs and explicit 375×812 geometry fixture | `virtual-dom/layout-policy.json`, `virtual-dom/acceptance.json` |
| Interactive save/reopen substitute | PASS — both pilots, actual DOM event handlers, simulated download/upload, exact archive equality and invalid-JSON preservation | `virtual-dom/*-saved-replay.json`, `virtual-dom/*-reopened-replay.json` |
| Original 200+200 substitute | PASS — actual benchmark function, 400 coordinated selections, 20 close/reopen and 20 mount/dispose cycles | `virtual-dom/original-200-plus-200-simulated.json` |
| Offline virtual verification bundle | PASS — same 12 checks and all three revised gates | `virtual-dom/offline-run.log`, `virtual-offline/` |

The 59 added tests comprise 18 provider, two controller integration, 16 strict-contract/native fail-closed, and 23 application-runtime tests. The first full run had one test expectation failure when the 100ms execution guard stopped a memory fixture before its heap guard. The test now accepts either safe guard winning; no limit was relaxed. The separate final application acceptance still requires and obtained an actual `MEMORY_LIMIT` result. The original failing run is retained in `tests-first-run-resource-race.log`.

## Negative sandbox verification

Profile: `m3-application-fixed-v1`. Node v24.19.0; Linux 6.18.44, x64. Worker source SHA-256: `399662ef750c0c5251b742ec886589609cf8d1d8d5a3a950d80f31788d4b344f`. Per-job receipts retain runtime/input/result hashes, generation, policy identity, byte counts, exit state, elapsed time and cleanup state; raw guest diagnostics are not persisted.

| Probe | Actual result in the revised application profile |
|---|---|
| Network, DOM, filesystem, environment and process APIs | PASS: absent from the VM capability surface; no host objects/functions injected. This is not kernel packet-capture evidence. |
| Constructor/eval escape attempts | PASS: four fixed probes rejected with string/Wasm code generation disabled. No general hostile-code security certification. |
| Prototype pollution | PASS: frozen realm prototypes reject writes; strict input parser rejects unsafe keys at every depth and duplicate/escaped-duplicate keys before object construction. |
| Unauthorized tool, host, catalogue, provider, map and publication calls | PASS: no callable capability; request extras, runtime options, URLs, markup and code are rejected. |
| Infinite loop | PASS: `EXECUTION_TIMEOUT`; VM budget 100ms, independent parent deadline 2,000ms. |
| Heap exhaustion | PASS: actual `MEMORY_LIMIT` from the Worker; configured old/young generation limits 32/8 MiB and stack 2 MiB. |
| Output and diagnostic floods | PASS: 8,192-byte output rejected against 4,096-byte cap; 2,560-byte diagnostic rejected against 1,024-byte cap. |
| Malformed, duplicate, deep or nonfinite JSON; HTML/SVG/loader output | PASS: strict byte/depth/node/schema checks reject before host use. Request cap 64 KiB, depth 14, nodes 8,000. |
| Forged source rows, values, units, hashes and results | PASS: input rows must equal trusted staged records; output count/sum independently recomputed. Synthetic-only admission remains enforced. |
| Permission/hash/parent changes and stale completion | PASS: admission and final authority rechecks; revoked grant returns `FIELD_PERMISSION_DENIED` with no result; A–B–A activates only latest A. |
| Crash and partial output | PASS: `BOUNDARY_CRASH` or `INVALID_JSON`; no result activation. |
| Twenty execute/cancel/dispose cycles | PASS: each subsequent synthetic transform succeeds, cancelled work cannot activate, disposed engines refuse work, every owned worker is reclaimed. |
| Replay code, secrets, passages and loader injection | PASS: retained strict replay/privacy tests and new input/transport negatives; existing reference-only replay remains usable. |

Final dedicated run: maximum job wall time **137.27ms**, maximum observed worker termination **8.02ms**, below the 1,000ms reclamation ceiling. These are local measurements of reviewed fixtures. Cleanup failure disables further jobs. No generated artifact, real historical record, provider key, source passage or model call was used by the sandbox.

The original M3-01–M3-15 goals are covered at the approved application contract/lifecycle level where applicable. OS network/filesystem denial, inherited host-descriptor confinement, hard aggregate RSS/no-swap accounting and independently constrained native validation remain outside this revised acceptance. The optional native implementation is retained and fails closed at `empty-root` with errno 1; its original negative suite is honestly `BLOCKED` in `runtime/acceptance.json`.

## Virtual DOM interpretation

All 12 virtual DOM checks pass. The 375px substitute parses the actual three stylesheets, checks selected media/cascade declarations, and evaluates panel/table/timeline geometry using an explicitly supplied host rectangle and 212px timeline height. Happy DOM supplies DOM/event behavior, not a browser layout or paint engine. The report records `renderedLayoutVerified:false`; saved HTML files are DOM snapshots, not screenshots.

Both pilots export, switch pilot, read an uploaded file through the actual handler, reopen, and export again. Archives match exactly, including selection and cursor; the modern round trip retains two revisions and the narrowed table/evidence view choice. Malformed replay JSON leaves the current result unchanged.

The original production benchmark still performs 200 selection-only and 200 selection-plus-cursor updates on 44 observations/four entities. The original 50/100ms targets and sample counts are preserved. Its **simulated** frame step is 16.667ms and mocked host seek costs 2ms; resulting synthetic p95 values are 33.333/35.333ms by construction. These figures validate scheduling and coordinated DOM behavior, not speed, frame presentation or a real renderer. There are no fresh browser/GPU/mobile performance claims.

The original Chromium runner remains available and its missing-binary/provisioning failure is retained in `headless/`. It is no longer a blocking gate under the user's revised work order. Physical Windows, mobile, GPU, scanout and OS preference checks remain NOT RUN.

## Run the delivered files

From the extracted **Runnable** directory, Node >=22.13:

```sh
node serve.mjs
node --experimental-transform-types runtime-isolation/application-acceptance.ts
node virtual-acceptance/scripts/m3-virtual-dom-acceptance.mjs --offline
```

The first command serves the dashboard at http://localhost:4173/ and stays running; run the two verification commands separately. The type-transform flag is needed for the handwritten TypeScript verification CLI and may produce Node's experimental-feature notice. Both acceptance commands use local files only. Dependency licenses are included in the offline kit.

From provisioned **Source/apps/explorer**:

```sh
corepack pnpm test
corepack pnpm run build
python3 scripts/verify-m3.py
node --experimental-transform-types runtime-isolation/application-acceptance.ts
node scripts/m3-virtual-dom-acceptance.mjs
node scripts/build-m3-virtual-offline.mjs
```

Full source includes the frozen main, semantic and separate verification dependency boundaries. Optional native build: `python3 runtime-isolation/build.py`; native acceptance remains unavailable on this host and is not silently replaced by the application engine.

## Remaining activation boundary

M3 is complete **for the approved fallback profile**. Live services, arbitrary generated code, real-data sandbox execution, publication and M4 extraction remain disabled. This milestone does not change source rights. Node documents [vm's security limitations](https://nodejs.org/download/release/v24.19.0/docs/api/vm.html) and [Worker resource-limit scope](https://nodejs.org/download/release/v24.19.0/docs/api/worker_threads.html): VM contexts are not a hostile-code security mechanism, and Worker limits do not cap arbitrary external allocations or total process RSS. Typed-array/ArrayBuffer capabilities are removed from this fixed profile, but that does not constitute OS confinement. Separate authorization and stronger demonstrated enforcement remain necessary before accepting arbitrary code or enabling real model processing.

Implementation details: `M3-RUNTIME-IMPLEMENTATION.md` and `M3-PROVIDER-CONNECTION.md`. The preserved stronger design is `M3-ISOLATION-THREAT-MODEL.md`. Package receipts verify every archive member and provide archive SHA-256 values.

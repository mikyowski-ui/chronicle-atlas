# Chronicle Explorer Alpha — verification and Windows receipt

This candidate preserves the VP06 baseline `090f09c607654fac412116e3b1e3f9c076da05fc`. Historical staging and exact-result review do not publish the public historical ledger. A successful build, Canvas run, WebGL2 capability probe, or SwiftShader run cannot fill in a physical Windows acceptance receipt.

## Separate profiles

| Profile | Evidence required | Scope of a pass |
| --- | --- | --- |
| 1. Canvas fallback | Actual production page; visible Canvas map; recorded interactions and console observations | Fallback rendering, logical state changes, accessibility, selection, evidence and supported-date behavior |
| 2. MapLibre, software WebGL | Actual production page; visible MapLibre canvas; renderer string identifying software; native vector-source hydration, feature-state and race observations | MapLibre behavior on that declared software backend; no physical performance conclusion |
| 3. MapLibre, physical Windows | Actual local Windows production page; same-browser GPU report; device/driver/renderer identity; screenshots and interaction trace | This exact build on the stated physical machine/browser only |

Every scenario starts as **NOT RUN**. A test that cannot reach the page is **BLOCKED**, with the actual navigation error; it is not an application render failure. A scene on another renderer does not change this profile's result. A renderer string that does not name software is **UNVERIFIED**, until paired with the same-browser GPU report and actual visible MapLibre scene.

## Build and artifact checks

From the full checkout, use the pinned package manager and lockfile in `apps/explorer/`, then run the existing build and test commands. Build before testing, because the existing server regression reads `dist`.

```text
pnpm install --frozen-lockfile
pnpm run build
pnpm test
node scripts/verify-alpha.mjs
```

`verify-alpha.mjs` reads production files sequentially, checks manifest byte lengths and SHA-256 values, verifies every declared integrity chunk, records PMTiles v3 tile/zoom counts and canonical identity indices, and starts `node serve.mjs` on an ephemeral loopback port to check HTTP ranges and HEAD/416 behavior. It writes `verification/alpha/artifact-check.json`. This is artifact and HTTP verification, not a browser or GPU test. The script neither changes data nor installs dependencies. `--no-http` skips HTTP checks; never report that mode as a delivery pass.

Full archive verification belongs to bounded compilation/release checks. Runtime integrity checks must not require a full archive download before rendering. Review the actual runtime network trace to verify range behavior and cache reuse; a PMTiles header or this Node HTTP check alone cannot prove MapLibre streamed tiles.

## Physical Windows run: unchanged production package

1. Extract the candidate. Open PowerShell in the directory containing `serve.mjs` and `dist`.
2. Record `node --version` (minimum 22.13), then run `node serve.mjs` and keep the terminal open. No dependency install is needed for the production package.
3. In a normal local Chrome or Edge window, open **http://127.0.0.1:4173/**. Confirm the debug tray identifies MapLibre and that the map is visibly drawn. Do not use WSL/VM localhost for this physical baseline.
4. In that same browser, open `chrome://version` or `edge://version`, then `chrome://gpu` or `edge://gpu`. Save browser version, Graphics Feature Status, Driver Information, GL_RENDERER, and Problems Detected. Record Windows version, GPU model, driver version/date, viewport and device scale.
5. The GL_RENDERER evidence must identify a physical GPU through ANGLE D3D11/Vulkan (or another explicitly reviewed physical backend), not SwiftShader, llvmpipe, softpipe, Software Rasterizer, or Microsoft Basic Render Driver. **ANGLE alone is not a hardware verdict.** If identity is hidden or ambiguous, mark physical acceleration UNVERIFIED.
6. Use the application's read-only diagnostic export if available. The optional `verification/alpha/visible-map-preflight.js` is a local DevTools Snippet that reads the existing visible MapLibre canvas. It changes no settings and opens no new rendering context on a fallback canvas. Its report is diagnostic evidence only. Inspect the file before manually running it.
7. Keep Spector inactive for the normal interaction/performance run. An optional Spector capture is a separate instrumented diagnostic artifact, with its own label.

Do not disable browser sandboxing, bypass administrator restrictions, add unsafe GPU flags, or expose a public debugging port. These steps inspect the currently permitted device; they do not create GPU access.

## Capture list and interaction sequence

| Scenario | Exact observation to retain |
| --- | --- |
| Ancient view | Supported 200 BCE observation; neutral land context; cultural classification visible in the selected card/evidence; source-derived outlines, not grid rectangles. Record the actual source observation date, not continuous coverage. |
| 1900 view | Supported 1900 CE observation at a useful British Isles zoom; source-derived vector boundaries and coastline context. Record rendering and display-geometry edition. |
| Fragmented hover | Meridian Isles; hover a Cedar fragment/island with no persistent selection; capture all active associated parts receiving hover. Move out and confirm hover clears without clearing a different selected entity. |
| Population card | Select the entity for the admitted observation. Capture population value, geography, actual observation date, coverage/method, and source identity. If a value is unavailable for the requested date/area, preserve the gap. |
| Tile seams and labels | Pan a selected fragment across a tile boundary and zoom through compiled levels. Verify one independent label per entity, stable picking, holes/islands, and no duplicated card or invented identity. |
| Controls | Space play/pause; left/right supported observation; 1–5 speed; Escape dismisses inspection and selection. Type the same keys in search/year input and confirm no global shortcut fires. |
| Delayed reverse | Select Aster at 950. Enable **Simulate 500 ms delivery**. Request 1050 → 1049 → 1050 faster than delivery, then a separate 950 → 1050 → 1049 run. Keep timestamps and all terminal outcomes, including stale requests. Final visible geometry, committed date, card and evidence must agree. |
| Layer independence | Toggle population and migration while selected, cross an epoch, then toggle again. Selection/year remain coherent. Record migration source, interval and uncertainty separately from border validity. |
| Readiness and camera | Repeat reverse scrubbing while panning/zooming; late tiles from an older camera/request cannot become the current scene. Keep committed time during pending states. |
| Sustained session | Warm one viewport, then repeat at least 100 boundary reversals; separately test cold epochs, pan/zoom, and cache eviction. Record map instance/source-group counts and memory before/warm/after/quiescent, with method and time. |
| Resize and accessibility | Resize while selected/pending; use keyboard focus, labels and evidence controls. Record actual tested viewport sizes. |

Keep visible-map screenshots alongside the receipt; a screenshot of the debug tray alone cannot prove a drawn or highlighted map. Include the production asset URL/build identity in the trace; development `/src/` requests do not establish package acceptance.

## How to interpret timing and memory

Application `performance.now()` trace entries establish ordering of requests, readiness, commits and stale rejection. They do **not** establish the physical display presentation time. Measure uninstrumented interaction using the browser Performance panel and identify the latency/frame metric, duration, samples, viewport, active layers and cache condition. Report distributions, not an invented target pass.

`performance.memory`, when exposed, approximates JavaScript heap only. It is not GPU memory, total process RSS or a leak proof. Use browser task/process memory and a sustained quiescent comparison when available. A bounded source count and one MapLibre constructor are structural evidence; separately record actual instance/context counts. If memory is unavailable, write **NOT MEASURED**. If only a short run was executed, do not mark sustained leak testing passed.

## Receipt format and current environment limitation

Copy `verification/alpha/receipt-template.json` for each actual run and fill only observed fields. Link exact candidate/build hashes, production screenshots, console/network excerpts, GPU report and interaction trace. Use PASS, FAIL, BLOCKED, NOT RUN or UNVERIFIED per scenario with reasons. Do not convert nulls into zero-error claims.

This engineering environment was observed as Linux 6.18.44 x86_64; neither `/dev/dri` nor `/proc/driver/nvidia/version` was present. Its tool registry exposed supported cloud-browser access and no local Windows/device connection. A cloud browser runs on a separate host; local device-file absence does not establish its GPU identity. The required physical Windows receipt therefore remains **NOT RUN** unless the application is actually run on the target Windows environment and its evidence is attached.

The supplied VP06 GPU kit is retained as prior review material. Its preflight was previously syntax checked but not browser executed, and its blocked browser attempt is not reused as fresh VP07 evidence.

References supplied with the review: PMTiles MapLibre integration <https://docs.protomaps.com/pmtiles/maplibre>; Chromium GPU diagnosis <https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/using-gpu-hardware-in-headless-chrome.md>; Spector extension documentation <https://github.com/BabylonJS/Spector.js/blob/release/documentation/extension.md>. These explain tools, not candidate test outcomes.

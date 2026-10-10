# M3 local headless acceptance

The runner exercises the actual built dashboard through browser controls. It starts `serve.mjs` on an ephemeral loopback port, blocks non-local page requests and service workers, and never downloads a browser, invokes a provider, or changes the production app. Existing historical/pilot assets are served from `dist`. Browser tooling is a separate runner dependency; the protected application package and lockfile are unchanged.

From `apps/explorer`, after the production build:

```sh
node --check scripts/m3-headless-acceptance.mjs
node scripts/m3-headless-acceptance.mjs
```

The runner searches the existing local `playwright` module and `CODEX_PRIMARY_RUNTIME_NODE_MODULES`. A separately provisioned offline environment can supply the following paths without changing application dependencies:

```sh
CHRONICLE_PLAYWRIGHT_MODULE=/absolute/path/to/playwright CHRONICLE_CHROMIUM_EXECUTABLE=/absolute/path/to/chrome node scripts/m3-headless-acceptance.mjs
```

`--out /absolute/output/directory` selects a separate evidence directory. Default renderer is the preserved Canvas fallback. `--renderer maplibre` explicitly requires the MapLibre renderer and cannot silently substitute Canvas. Browser, kernel, CPU count, memory, binary hash, runner hash and exact `build-info.json` are recorded. A future rerun should use a new output directory to preserve earlier evidence.

| Gate | Actual actions / assertions |
| --- | --- |
| 375px responsive | Real 375×812 CSS viewport for modern and premodern pilots; no document/panel overflow; interactive controls inside panel; bounded table scrolling; timeline not covered; map/panel toggle; screenshots. Reduced motion is browser emulation. |
| Interactive save/reopen | Table click selects evidence; actual download; switch to other pilot; file upload; Reopen button; second download; exact replay JSON and selected-observation equality. |
| Original 200+200 | Existing UI verification button; 44 observations, 4 entities; 200 selection-only and 200 combined samples; unchanged 50 ms / 100 ms p95 thresholds; original host-year behavior; 20 close/reopen plus 20 mount/dispose cycles; unchanged canvas; raw receipt and screenshot. |

The runner writes `acceptance.json`, screenshots, replay files, raw benchmark JSON and a Playwright trace when the browser executes. It exits 0 only when all gates pass, 1 on test failure, and 2 when a required environment dependency is unavailable. Independent gates continue after a gate assertion fails. A blocked environment creates no synthetic screenshots or substitute timings.

## This environment

`acceptance.json` and `run.log` retain the actual run and build identity. **All three UI gates are BLOCKED, not cleared.** The runtime contains Playwright but no Chromium executable. The normal official browser provisioning attempt returned a 195-byte `text/html` page titled “Site Unavailable”; extraction failed. See `browser-setup.json` and `browser-setup.log`. No alternate network route or escalation was attempted. No real browser screenshot, interaction timing or renderer claim has been produced by this run.

The runner source has passed `node --check`; its full browser path still needs execution after a browser is available. These are headless acceptance gates. Physical mobile, hardware GPU, physical scanout and OS preference gates remain separate and NOT RUN.

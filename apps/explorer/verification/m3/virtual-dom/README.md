# M3 revised virtual DOM acceptance

The user approved replacing the browser E2E gates with deterministic virtual DOM, mocked browser APIs, declared 375px geometry and simulated animation frames. **All three revised gates PASS.** This result does not clear real browser rendering, physical mobile, GPU or measured responsiveness gates. The earlier blocked Chromium attempt remains in `../headless` as separate evidence.

The runner compiles the actual `src/research/view.ts`, controller and engine, then loads them into pinned Happy DOM 20.14.5. It does not implement a replacement dashboard. Only the two host-pinned local fixture loaders can read data; every other fetch throws. The app's production `modelProcessing:false` policy and unavailable planner remain active.

| Revised gate | Verified behavior | Explicit simulation |
| --- | --- | --- |
| 375px policy | PostCSS parses actual three stylesheets; 60 declaration checks cover mobile panel bounds, timeline reservation, table overflow, form wrapping, readable limits and reduced motion. Actual modern/premodern DOM, 44/10 table rows and map/panel toggle are checked. | Enclosing workspace is assumed at x=0, y=56, width=375, height=756; dock height=212. Panel geometry is supplied from the validated policy: x=10, y=172, width=355, max height=414. No CSS layout engine runs. |
| Save/reopen | Actual selection, narrowing and view controls; actual Save handler; Blob capture; File/DataTransfer change event; switch pilot; Reopen handler; second Save. Both pilots yield identical replay archives and retain selection/cursor. Modern replay includes two revisions and table/evidence views. Invalid JSON preserves the active result. | Download navigation and file chooser are browser API test doubles. File content and all application handlers are real. |
| Original 200+200 | The existing UI benchmark button invokes its unchanged production measurement function: 44 observations, 4 entities, 200 selection-only actions, 200 combined host-year actions, all coordinated DOM selections, 20 close/reopen cycles, 20 complete mount/dispose cycles, zero owned-resource leaks and stable canvas identity. | Each RAF callback advances 1000/60 ms; mocked host seek adds 2 ms; synchronous DOM cost is zero on the synthetic clock. Synthetic p95 values 33.333/35.333 ms follow these assumptions and are **not measured latency**. Original 50/100 ms target fields are retained as contract assertions. The real Atlas renderer does not execute. |

`acceptance.json` contains 12 passing named checks, exact source/build hashes and explicit mock descriptions. `layout-policy.json` records matched stylesheet rules, hashes and assumptions. `original-200-plus-200-simulated.json` wraps the unmodified production receipt in a simulation warning. HTML files are DOM snapshots, not screenshots. Saved and reopened replay JSON files demonstrate exact archive equality. Unsupported natural-language input causes no additional fixture fetch and remains unavailable.

From `apps/explorer` with the existing app dependencies and the isolated `verification-tools` lockfile installed:

```sh
node scripts/m3-virtual-dom-acceptance.mjs
node scripts/build-m3-virtual-offline.mjs
node verification/m3/virtual-offline/scripts/m3-virtual-dom-acceptance.mjs --offline
```

The helper creates a self-contained Node-only kit containing the compiled actual workspace, bundled Happy DOM/PostCSS, required local fixtures/styles, source/build hash manifest and dependency license notices. The kit needs no browser, package installation or network connection. The runnable archive may place this kit at `virtual-acceptance/`; run its `scripts/m3-virtual-dom-acceptance.mjs --offline`. `--out /absolute/path` selects a fresh receipt directory. Source and offline-kit runs have both passed; the final packaging run binds the release build identity.

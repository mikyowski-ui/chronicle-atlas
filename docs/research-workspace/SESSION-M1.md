# Chronicle Research Workspace — session (2026-10-07)

Implemented Milestone 1 and the pilot's minimum semantic metadata in the recovered existing Teaching Atlas source. Read `docs/research-workspace/ACCEPTANCE.md`, `BASELINE.md` and `PILOT.md` before continuing. Supplied root AGENTS adopted after finding no existing applicable AGENTS; prior README/session guidance retained.

Pilot: four existing Mexican urban centres, 44 UN WUP 2025 estimates (1975–2025); Guadalajara variation has 8 rows. Query/spec/data/manifest contracts are separate and runtime-validated. Research toolbar opens linked summary, map, chart, table and source evidence. Host time remains authoritative; query window is separate. Stable selections, staged revisions/cancellation, resource cleanup and pinned reference-only replay are implemented. Prepared mode is explicit; arbitrary questions cannot masquerade as answers. No live model, arbitrary code, new dependency, publication or canonical data change.

Node v24.19.0; `corepack pnpm` selects pinned 11.19.0. From `apps/explorer`:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm run build
corepack pnpm test
python3 scripts/build-research-pilot.py --check
corepack pnpm dev
```

For the built bundle: `node serve.mjs` → `http://localhost:4173/`. Open Research, then Focus study area; Show 2025 is explicit. Disable with `?research=off`. Dev-only `research-review.html` provides actual narrow CSS viewports; Local verification tools records the browser workload.

Final build and 310 tests PASS (0 failures/skips); all 44 raw cells match, 2,282 protected files unchanged. Desktop/narrow and feature-off Atlas inspected. Native-button Space shortcut bug fixed and browser-verified. Warm selection:37.0 ms p95/200 actions PASS; combined selection+year:230.3 ms FAIL vs100 ms. The earlier216.1 ms miss is preserved. Physical GPU/mobile, WebGL style reload and preference=true reduced-motion checks NOT RUN. No 60 fps claim. See acceptance for timing limits and exact receipts.

Build: `chronicle-4580508b5ce3e5fc8c2f228471e71b1876e82bb8524a83049272a71700be31b1`. Source fingerprint: `604144d065512dbd3b7b39a7b5b6012eb9b018c8bbb33d97c6b1aec1876f2d67`. No `.git` in recovered archive: current HEAD/dirty status unavailable. Original archive commit `1dc4084baee4602cbd8d587faf99b972a3d6b6a8` is provenance only. Detailed changed-file inventory is in `apps/explorer/verification/research-workspace/source-changes.json`.

Next bounded work: address combined host-year responsiveness and run missing device checks. Do not silently enable Milestone 2–4. Existing historical gaps and city/border continuity are unchanged by this research view. Canonical inputs, publication boundaries, and prior checkpoints remain intact.

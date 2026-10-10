# Local follow-up continuation — 2026-10-07

## Delivered behavior

The recovered workspace already included the dual-track implementation described in DUAL-TRACK-ACCEPTANCE.md. This continuation verified its 350-test baseline, then added source-pinned local follow-up revisions to the integrated Evidence catalogue for both pilots. The original Research map/chart workspace remains intact.

Open Research → Evidence catalogue, choose Modern or Premodern, choose a place and year interval, then Narrow study. Select a pilot again to reset the scope. Save study writes a references-only JSON revision chain; Reopen study validates the entire chain against retained local source hashes before activating it. An invalid archive leaves the previous evidence visible. Controls explicitly identify local prepared mode, not natural-language planning. Atlas time and selection are unaffected by catalogue filtering.

The existing 44 modern observations and 10 premodern accounts are unchanged. Unknown years return empty results rather than interpolated facts. Each follow-up narrows its parent scope; broadening requires a new root. Replay checks parent identity, policy, source hashes and deterministic result equality. Export contains no free-form question, numerical source values or account passages. Limits are 32 revisions and 64 KiB serialized input, whichever is reached first. Hashes ensure consistency, not authenticity or scholarly certification.

## Fresh verification

| Check | Result |
|---|---|
| Recovered baseline | PASS — 350 tests |
| Final regression suite | PASS — 356 tests |
| TypeScript and production build | PASS — existing large-chunk warning retained |
| Modern and premodern retained-source checks | PASS |
| Canonical/protected baseline | PASS — 2,282 files byte-unchanged |
| Follow-up/replay tests | PASS — both pilots; narrowing; stale parent; incompatible metric; empty years; altered ancestry/source/result; export privacy; budgets |
| Production server | PASS — emitted assets byte-compared over HTTP; range request 206 |
| New controls, visual layout, browser save/upload interactions | BLOCKED — separate browser returned net::ERR_CONNECTION_REFUSED for local production server |
| New performance benchmark | NOT RUN — same browser reachability blocker; host timing/render code unchanged in this continuation |
| Physical Windows/mobile, live MapLibre reload/memory, OS reduced-motion=true | NOT RUN — devices/runtime unavailable |

Receipts: `apps/explorer/verification/local-followups/`. Earlier screenshots and timing receipts in `verification/dual-track/` are retained historical evidence, not fresh verification of these controls. Prior reported local measurements: selection 35.6 ms p95, combined selection/year 95.4 ms p95, scrub 59.51 RAF opportunities/sec. These are not device scanout or new measurements.

## Files changed in this continuation

- `apps/explorer/research-semantic/revisions.ts`: bounded revision chain, scope refinement, reference-only restore.
- `apps/explorer/src/research/semantic-view.ts` and `.css`: place/date controls and save/reopen, using existing catalogue rendering.
- `apps/explorer/tests/semantic-revisions.test.ts`: six negative/positive integration tests.
- `apps/explorer/scripts/verify-local-followups.py`: protected-baseline and emitted-asset server verification.
- This report, session notes, verification logs and packaged deliverables.

## Reproduction

From `source/apps/explorer`, use Node >=22.13:

```sh
corepack pnpm install --frozen-lockfile
(cd research-semantic && corepack pnpm install --frozen-lockfile --ignore-scripts)
corepack pnpm test
corepack pnpm run build
python3 scripts/build-research-pilot.py --check
python3 scripts/build-premodern-pilot.py --check
python3 scripts/verify-local-followups.py
node serve.mjs
```

Open http://localhost:4173/. Runnable package needs only Node and `node serve.mjs`, not a dependency install. This is a local preview, not a new EXE or publication.

## Remaining milestone gates

M1 and dual-track: implementation retained and regression-tested; physical/runtime acceptance gates above are still open.

M2: semantic contracts, two evidence types and local follow-up revision/replay implemented. Full natural-language planner remains incomplete. The active supplied sprint expressly excludes live inference; retained source policy also says modelProcessing=false, and no authorized provider is configured. Do not treat these prepared controls or tests as held-out live planner evaluation. A later work order must resolve provider and processing permissions before that gate can run.

M3: not implemented/enabled. The supplied prompt expressly excludes sandboxed generated execution; no reviewed enforcing isolation boundary or generated-output evaluation exists.

M4: not complete. No independently licensed reference data or reusable second application has been established; existing source rights prohibit republication. Nothing has been published or relicensed. Extracting and publishing an engine cannot be claimed from this local follow-up slice.

These are concrete remaining prerequisites and explicit work-order limits, not successful later milestone results.

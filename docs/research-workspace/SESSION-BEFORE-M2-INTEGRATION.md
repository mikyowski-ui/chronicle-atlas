# Chronicle research checkpoint — 2026-10-07

Current integrated source reviewed against AGENTS, the dual-track prompt and implementation plan. Earlier sessions/reports are preserved, including `docs/research-workspace/SESSION-before-final-review.md`. Read `FINAL-REVIEW-ACCEPTANCE.md` there for current evidence and limits.

Implemented/retained: linked prepared Research; bounded Zod semantic contracts; two real source-backed pilots; local narrowing and parent-linked study replay; dated-city/geometry/visible-paint caches; safe rendering; reduced-motion and style lifecycle handling. Added an abort guard so disposed catalogue controls cannot start a new fetch. No live model, generated execution or historical publication.

Fresh verification: 356 tests and production build PASS; 2,282 protected files unchanged; current source/build fingerprint matched. Latency 44.8/88.9ms p95 (selection/combined) PASS; scrub 58.35/58.85RAFfps PASS. Desktop/375px, original replay, catalogue, narrowed Samarkand result and Research-off Mexico selection inspected. Follow-up upload/reopen UI was interrupted and remains unverified; deterministic restore tests pass. Actual MapLibre/GPU, physical mobile/Windows and OS reduced-motion=true NOT RUN.

Node24.19 used; minimum22.13. From `apps/explorer`:

```sh
corepack pnpm install --frozen-lockfile
(cd research-semantic && corepack pnpm install --frozen-lockfile --ignore-scripts)
corepack pnpm test
corepack pnpm run build
python3 scripts/build-research-pilot.py --check
python3 scripts/build-premodern-pilot.py --check
python3 scripts/verify-final-review.py
corepack pnpm dev
```

Prebuilt runnable: `node serve.mjs` then http://localhost:4173/. No new EXE. Build `chronicle-a5b13f7284a6ccde92634e6c3e17f4bd7eaefbd40d84882fc52f7a8a89b8ce75`; no .git/current HEAD in recovered source.

Next: finish actual-device/MapLibre/OS-preference and interrupted browser replay checks. Full M2 live planning is blocked by explicit work-order/provider/processing gates; M3 excluded; M4 extraction/rights gate incomplete. Do not claim later milestones complete or change historical publication boundaries.

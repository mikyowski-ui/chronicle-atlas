# Chronicle continuation — 2026-10-07

Read AGENTS.md, attached dual-track prompt, implementation plan and existing acceptance/session notes. Editable recovered source exists; no .git/current HEAD. Prior dual-track work was already present. Preserved all canonical data and publication boundaries.

Added bounded local follow-up study controls to both Evidence catalogue pilots: place/date narrowing, deterministic parent-linked revisions, reference-only save and reopen. No model service or generated code. Strict runtime validation and prior-visible-state preservation on failure.

Fresh baseline 350 tests PASS; final 356 tests and production build PASS. Both source checks PASS. All 2,282 protected files unchanged. Built server assets and range request PASS. New UI visual/browser verification BLOCKED: separate browser cannot reach local production server. No new latency measurements or physical-device claims. Earlier dual-track receipts and 95.4 ms combined p95 remain prior evidence only.

Read docs/research-workspace/LOCAL-FOLLOWUPS-ACCEPTANCE.md for exact commands, scope, remaining gates. Run from apps/explorer: corepack pnpm test; corepack pnpm run build; python3 scripts/verify-local-followups.py; node serve.mjs. Install both app and research-semantic frozen lockfiles when dependencies are absent. Prebuilt runnable requires Node >=22.13 only.

Next dependent work: visually test new controls/save/reopen at 375px and desktop; physical Windows/mobile, actual MapLibre reload and reduced-motion=true. Full M2 live planner requires an authorized provider and source-processing rights; active prompt excludes inference. M3 explicitly excluded and isolation unreviewed. M4 rights/extraction gate remains incomplete; no publication/relicensing.

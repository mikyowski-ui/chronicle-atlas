# Chronicle continuation — 2026-10-09

**Status: all five roadmap phases are implemented and verified for the scoped application/WASM profiles.** No deployment, publication or remote push occurred. The final local checkpoint contains the Phase 5 implementation and receipts.

## Checkpoints and baseline

- Phase 1 provider/schema repair: `3b55d21`; Phase 2 floating omnibar/HUD: `e90f105`.
- Resumed last night's 135 staged Phase 3 files without overwriting them. Fresh build/typecheck and 508 tests passed before engine-extraction checkpoint `4f9e32d`.
- Phase 4 evidence ingestion: `5a40bc5`, with 530 tests and the real browser/source/provider gates recorded under `apps/explorer/verification/m4/phase4-*`.
- Actual Git repository: outer `Chronicle-M3-Source`; editable source root: its `Chronicle-M3-Source/source` child. Never use the workspace wrapper's inherited home-directory Git repository.
- Host: Windows 10.0.26200, Node v22.17.0, pnpm 11.19.0, Chromium 153.0.8010.12, Ryzen 7 5800X.

## Final Phase 5 evidence

- Root build/typecheck and **541 tests PASS**: 497 retained Explorer tests plus 44 package tests, no failures/skips/cancellations.
- All nine final browser profiles PASS: both WASM/renderer gates, both ingestion gates, original MapLibre/Canvas responsiveness/replay/performance gates, HUD/style reload, Watt and the standalone mechanism consumer.
- Final Explorer build: `chronicle-da4cb9b91affa7a0bedccbd83d903705fb9c1e30f42f96cb7bcf46d5a1b597ea`; source fingerprint `16cf2345ca1eb2a9b6838ef5d6955eba9fa0e4a5287c2613aa52590cb39175f8` (2,431 inputs). Standalone: `mechanism-d8dd96270e0312253592d0296198da383783a7b456e36af998bcdce1ce02a357`.
- All **2,282 protected historical inputs** remain byte-identical. Main Explorer manifest/lockfile and historical contract entry point are unchanged. Node credentials are absent from all browser assets.
- Original 44-observation/four-entity 200+200 p95: MapLibre **12.4/30.1 ms**, Canvas **12.7/22.5 ms**, within unchanged 50/100 ms limits.
- Actual browser QuickJS/WASM rejects loop, heap, network/cookie/Node/import, output, SVG and provenance attacks. A 1 MiB allocation succeeds; a 9 MiB allocation fails despite otherwise valid SVG. Twenty cycles per renderer return owned workers to zero; guest network canary requests remain zero.
- Live public-source/model/program gate PASS: actual browser-fetched Wikidata Q84 bytes are reused exactly in the Node grounding adapter; one Gemini HTTP 200 request reports **1,686 tokens**; the bound program renders in **27.1 ms** and warm rerender in **24.1 ms** with no additional model/source call.
- Earlier rejected background/font output and a provider timeout remain separate receipts. The timeout retains its full reservation. One early rejected-program receipt did not retain usage; missing usage is not proof of zero billing. The accepted provider profile mirrors existing Gemini 3 LOW-thinking/no-sampling behavior and requests `store:false`.

Summary: `apps/explorer/verification/m5/acceptance.json`. Final adversarial receipts: `visualization-maplibre-final` and `visualization-canvas-final`; live: `visualization-live-vocabulary`; regression receipts: `regression-*`. Detailed history, exact commands and screenshots remain in `docs/research-workspace/M3-NATIVE-ACCEPTANCE.md`; execution assumptions/limits are in the Phase 5 addendum of `M3-ISOLATION-THREAT-MODEL.md`.

## Boundaries that must remain intact

- The user explicitly selected **Wikidata only** for new-source Gemini processing. Imported files stay browser-local; protected historical/mechanism source permissions remain false. Secrets are only loaded inside trusted Node code from the existing ignored environment configuration. Never inspect, print, stage, bundle or export credentials.
- The new guest is QuickJS **0.32.0** compiled to WASM inside a one-shot worker, not an unrestricted Worker/host eval boundary. Its fixed **50 ms** execution/activation deadline and **8 MiB guest heap** are not an aggregate browser-RSS or hard-real-time OS guarantee. Late output is never accepted; host scheduling may delay reclamation. Original native OS confinement remains unsupported/unverified on this Windows host.
- The SVG vocabulary is shared by the planner and validator. No resource URLs, scripts, CSS, arbitrary narrative, forged references, inferred historical dates/geometry, or unbound drawing primitives are admitted. A program remains untrusted even when produced by Gemini. The capability is a source-bound layout, not a certified numerical analysis, simulation or causal model.
- Previews require an explicit run control. Importing a specification or replaying evidence does not execute code. Source/program/runtime hashes and budgets must match before launch. Cursor/selection are host-owned and never require a model or guest rerun.
- Exact-pinned dependencies: QuickJS 0.32.0 and XML parser 0.9.12. Both met the seven-day release-age floor. A Windows pnpm EPERM cleared after the user's authorized identical retry; no caches, permissions or supply-chain controls were changed.
- Canonical ownership/history, publication manifests, bitemporal semantics and citation rights are unchanged. Watt remains a pinned secondary-reprint proof, not primary-patent collation or scholarly review. Physical GPU/mobile/scanout certification is **NOT RUN**.

## Reproduction and usage

From the source root: `corepack pnpm run build`, `corepack pnpm run typecheck`, `corepack pnpm run test`. Build first; do not run browser workloads alongside builds or unit tests. Browser commands and explicit live flags are recorded in `AGENTS.md` sections 14–15. Do not invoke a live provider as part of an ordinary offline regression.

From Explorer: `node serve.mjs` serves only built `dist` on loopback (default 4173), not source/credential files. In the omnibar, choose **Examples → Import or retrieve evidence**. After loading records, open **Sandboxed visualization** for the clearly labeled prepared local preview or a bound render-specification file. The evidence table/inspector remains the static fallback. Gemini planning/generation remains a separately configured Node-only opt-in path.

Broader ingestion profiles, analytical transforms, UI/backend service activation, physical-device certification or publication are separate follow-up work requiring the relevant authorization; do not infer it from these software acceptance results.

# Chronicle Explorer continuation — 2026-10-09

**All five roadmap phases are implemented and verified for the scoped application/WASM profiles.** Phase 1: `3b55d21`; Phase 2: `e90f105`; resumed Phase 3: `4f9e32d`; Phase 4: `5a40bc5`. The final local completion checkpoint contains Phase 5 and its receipts. No remote push, deployment or historical publication occurred.

Final root build/typecheck and **541 tests PASS** (497 Explorer + 44 package), all nine final browser regression profiles PASS, and real Wikidata → Gemini → browser-WASM rendering PASS. The accepted live request reports 1,686 tokens, a 27.1 ms validated render, and a 24.1 ms warm rerender without another model call. Earlier failures are retained. All 2,282 protected inputs are unchanged.

Explorer build: `chronicle-da4cb9b91affa7a0bedccbd83d903705fb9c1e30f42f96cb7bcf46d5a1b597ea`; fingerprint `16cf2345ca1eb2a9b6838ef5d6955eba9fa0e4a5287c2613aa52590cb39175f8` (2,431 inputs). Standalone mechanism: `mechanism-d8dd96270e0312253592d0296198da383783a7b456e36af998bcdce1ce02a357`. Summary: `verification/m5/acceptance.json`; actual guest gates: `visualization-{maplibre,canvas}-final`; live: `visualization-live-vocabulary`; retained regressions: `regression-*`.

The user authorized **Wikidata-only** model processing. Imported files and protected historical/mechanism records remain excluded. Credentials stay in trusted Node code, never browser assets, logs or replays. The browser's prepared visualization is explicitly local, not a live AI answer. Loading a render specification does not execute it; an explicit run and matching source/program/runtime hashes are required.

The QuickJS/WASM profile enforces a 50 ms artifact deadline and 8 MiB **guest heap**, with fresh workers, independent termination and strict data-bound SVG quarantine. It is not aggregate-RSS, hard-real-time scheduling, native OS confinement or physical GPU/mobile certification. Invalid code/output leaves the source-bound table/inspector as the static fallback. No untrusted host eval, permissive CSP or unrestricted Worker fallback is enabled.

Use `node serve.mjs` for built-only loopback review. In the omnibar: **Examples → Import or retrieve evidence**, then **Sandboxed visualization** after records load. Gemini generation remains a separate Node-only opt-in API; ordinary previews and cursor/selection do not make model calls.

Read source-root `SESSION.md`, `AGENTS.md` sections 14–15, and the Phase 5 native-acceptance/threat-model addenda before further changes. Build before tests; run real browser workloads sequentially, never concurrently with builds/unit tests. New data rights, broader analytical functionality, backend activation, physical-device certification and publication require the appropriate separate authorization.

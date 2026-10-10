# Shared research workspace and planner boundary

This edition follows the issued `NEXT_WORK_EXECUTION_PROMPT.md`. New planner/prepared dashboards use `research-semantic/workspace-contract.ts` (schema 2). QueryIntent and QueryPlan retain their strict semantic v1 definitions; the original `src/research/contracts.ts` schemas remain frozen compatibility validators for existing archives. No silent data-version or hash substitution occurs.

## One product path

`WorkspaceSpecification v2 → bounded WorkspaceEngine → single ResearchController → existing Research view/Atlas adapter`

The production Research panel now mounts one controller and one overlay for either pilot. The original standalone catalogue is no longer mounted or imported into the production JavaScript path. Its source remains as a legacy implementation reference and its dependency-loading defect is also repaired.

Prepared modern examples are first validated/resolved by the original engine, then explicitly adapted into the new semantic runtime. The adapter checks exact observation ID/value equality. Premodern and reset-pilot actions register only their requested fixture. Both use the same stage/commit, selection actions, analysis window, host cursor adapter, evidence inspector and map surface. Selection does not change time or camera. Browse-date and Focus study area are separate deliberate actions; interval-start navigation is labeled as an anchor, not an exact event day.

The spec selects the rendered view set. Supported views are map reference points, quantitative scatter, qualitative event intervals, table, evidence and summary (at most five per spec). Unknown capabilities and qualitative scatter/quantitative interval mismatches fail validation. The UI can switch between linked views and table/evidence only; replay retains that approved choice. The map is not reconstructed. Source coordinates remain fixed anchors; callout stems connect labels to their own anchor, not trade routes.

Modern views retain all 44 published estimates and their source-cell locators. Premodern views retain ten editorial summaries at nine named references; discussed intervals and composition intervals remain distinct. Numeric values, account summaries, source links, author/perspective and limitations come from retained host-registered sources. Unknown positional radii and measurement confidence stay unknown. No route, flow volume or interpolated value is created.

## State and failure handling

The controller owns a single revision, selection, cursor year and analysis window. Warm selection/cursor updates read loaded fixtures and update existing marks. A new result is resolved and validated before activation. Render notification and rollback are synchronous within the activation task; if a subscriber fails, the old snapshot is restored and re-rendered, and the commit count does not advance. If the renderer itself remains broken, the status says that previous data was restored rather than claiming visual success.

Empty scopes, invalid schemas, source mismatch, timeouts, cancellation and stale completions preserve the previous active workspace. A selection filtered out of the result remains attached to its pinned source record and is visibly marked outside the result. No-op narrowing creates no additional revision. Reset starts a new root; broadening is not silently permitted. Historical Atlas selection and camera are not replaced by these temporary research records.

## Replay versions

- Original `chronicle-research-replay` remains validated against its original compiler, policy, result and source hashes before compatibility adaptation.
- Original `chronicle-local-followups` remains narrowing-only and uses its original ancestry checks, including already-saved duplicate/no-op ancestors.
- New `chronicle-workspace-replay`, schema 2, persists the narrowing chain, approved views, renderer/compatibility version, research cursor year and selected source record. It contains references, not account passages, numeric source values, arbitrary questions or credentials.

The cursor is explicitly a **year-navigation-anchor**. The host research adapter exposes astronomical years; the archive does not claim to preserve a precise event day or camera pose. Reopening is deliberate year navigation; map focus remains a separate action.

Before loading, archive structure and dataset IDs are checked. Only required host-allowlisted assets are loaded. An unavailable premodern asset cannot block a modern replay, or vice versa. Unknown/mixed dependencies fail before loading. Invalid later ancestry, source changes and policy changes fail before activation. Complete archives obey 64 KiB and 32-revision limits, including all nested records; existing v1 population archives retain their own bounded validator. Hash checks establish consistency, not authenticity or historical truth.

## User journeys

1. **Modern:** Research → Four Mexican urban centres → select a scatter point or table row → inspect source; Focus study area separately. Narrow a place/date window, change Workspace views if desired, then Save replay JSON. Paste the saved JSON or choose its file, then Reopen pinned result.
2. **Premodern:** Research → Choose or edit prepared question → Premodern exchange accounts → select an interval or map point → inspect event support, composition support and account limitations. Choose Browse only when a timeline move is wanted. Narrow/reset and save/reopen use the same controls and runtime.

An unsupported typed question invokes the unavailable-provider boundary and retains the workspace; it never substitutes a prepared answer. No live provider or model is connected. `PLANNER-BOUNDARY.md` documents the offline proposal/repair/evaluation interface and processing-permission requirements. `M3-ISOLATION-THREAT-MODEL.md` is design only, not an enabled executor.

## Production verification controls

Run the exact built application with `node serve.mjs`. Normal entry is `/`. Opt-in local verification is `/?verify=1`; `production-review.html` loads that same build in an actual 375×812 CSS-pixel iframe with optional width controls. It is not device emulation or physical-device evidence.

The original benchmark retains 200 selection interactions and 200 combined selection/year interactions and the same two-RAF endpoints, thresholds 50/100 ms p95. Additional named phases retain 200 samples each for observation checkpoints, more than two cache years, pan-plus-scrub and the nine-place qualitative pilot. The four-city/44-row modern fixture is the largest registered numerical workload; no larger synthetic dataset is introduced. Extended phases report sequential first encounters and revisits, not a certified cold-cache reset. Receipts include build identity, viewport/renderer, raw samples, targets, selected observation IDs and resource counts. RAF opportunities are not physical presentation.

Live MapLibre style reload and continuous scrub controls reuse the existing environment verifier. Their actual results, browser preference mode, physical hardware availability and retained prior measurements must be reported separately in `M2-INTEGRATION-ACCEPTANCE.md`.

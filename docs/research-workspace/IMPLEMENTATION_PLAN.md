# Chronicle Research Workspace — Reviewed Implementation Plan

**Revision:** 1.0 · **Prepared:** October 7, 2026  
**Basis:** the attached `Untitled_Document.md`, preserved as `SOURCE_PLAN.md`, and the user's preceding Chronicle directions.  
**Status:** implementation specification; not a repository audit, implemented feature, security certification, or historical-publication approval.

## Review decision

Retain the source plan's four milestones: a manually authored interaction contract, a semantic layer and LLM planner, isolated custom generation, and eventual open-source extraction. The product remains an evidence-grounded 4D research workspace inside Chronicle Explorer, not a separate chatbot.

The manual specification is an end-to-end contract test, not the final product or a commitment to manually build every future dashboard. It must use the same query, validation, provenance, and rendering path that later model-generated specifications use.

The first execution should produce a visible, usable, source-backed workspace. It must not spend the entire session preparing infrastructure, choosing model providers, or describing future architecture.

### Source-derived requirements versus revisions

The source plan explicitly requests four coordinated views, local interaction, inspectable provenance, historical semantic guardrails, staged AI/code introduction, and reusable engine extraction. These are retained. The details below are review recommendations, not claims that they already exist in the uploaded plan or current build.

| Source-plan location | Revision and reason |
| --- | --- |
| Immediate next step: choose urban growth/trade question | Select the question after inspecting actual records. Population records alone do not establish trade routes, river effects, or causation. Use a descriptive evidence question first. |
| Milestone 1: TypeScript dashboard schema | Add runtime validation and separate intent, query, results, display, and replay contracts. Compile queries in trusted code. |
| Milestone 2: semantic metadata | Bring the minimum metadata needed for the pilot into Milestone 1. A chart with undefined denominators is not an acceptable starting contract. |
| Dynamic Spatial Ingestion | Rename to dynamic thematic composition. Adding overlays is not historical ingestion and does not solve sparse political-border transitions. |
| Entirely browser-local interactions; model reasons once | Require no model calls for routine interaction. Allow bounded asynchronous data loading on cache misses and additional planning for genuine follow-ups. Keep ordinary map-tile requests separate. |
| Deterministic validator | Validate syntax, identifiers, calculations, and declared compatibility; do not claim it certifies historical interpretation or citation support. |
| Worker or restricted container as sandbox | A Worker is not a security boundary. Arbitrary generated SQL/code requires separate isolation and verification. External loading and executable expressions in declarative specs also need controls. [T1–T4] |
| Event bus | Use typed actions and one authoritative state owner, with revision barriers, cancellation, and cleanup; a loose event bus alone does not prevent loops or stale results. |
| Fixed 1750–1850 example | Treat it as a wireframe, not evidence of temporal coverage. Display only dates and relationships actually supported. |
| Final extraction | Keep adapter boundaries now, but delay generalization until two different use cases demonstrate reuse. No public release or license change is authorized by this packet. |

## 1. The immediate next step

### Entry check — discover, do not migrate

Inspect the actual source tree and applicable `AGENTS.md` files, record the revision and dirty state, discover build/test commands, and identify the current map, selection, timeline, source catalogue, and publication interfaces. Record actual paths in `SESSION.md`; this document intentionally does not pin old versions or assume previous reported test counts.

Retain the present renderer and existing fallbacks. Do not introduce a new globe engine, framework, graph database, agent framework, or canonical data migration. Missing source access blocks integration; it does not justify recreating a different Atlas under the same name.

### Pilot selection rule

Prefer this question family:

> What population observations are available for selected settlements in this region and period, and which observations are comparable?

Discover the region, dates, settlement identities, and available sources from the checked-out collection. Prefer two or more settlements with multiple dated observations and explicit, compatible definitions. Select a bounded, informative subset deterministically and document its coverage.

A smaller honest result is acceptable when coverage is limited. A single-settlement series or separately labeled observations may replace an unsupported comparison. Missing definitions disable growth calculations and pooled totals; they need not prevent source inspection. If there are no usable numerical records, complete the interface with an explicit unavailable-data state and test-only fixtures, but mark the real-data pilot BLOCKED.

Do not ask the user to choose a city or era when repository inspection can resolve the choice. Do not import new historical sources solely to manufacture the demonstration. Do not infer trade networks, port classifications, river travel, or geographical causation from city coordinates.

### What the first workspace contains

1. A short data-bound answer summary with scope, coverage, and limitations.
2. A temporary point/thematic layer on the existing map.
3. A declarative chart of actual observations, with a table alternative.
4. A shared evidence inspector resolving measurements and derived values to sources.

Produce one primary manual specification and a small variation, such as focusing on one selected settlement or restricting to explicitly comparable observations. Both must use the same generic runtime. Static specifications are allowed; embedded invented measurements and custom components hardcoded to one historical answer are not.

The question field must identify this mode as **Prepared example — planner not enabled**. Supported examples can load their specifications. Arbitrary natural-language input must not silently return a canned answer. Milestone 2 replaces the authoring mechanism, not the renderer.

## 2. The final product and its boundaries

The long-term flow is:

`Question + explicit context -> catalogue search -> typed research/query plan -> evidence and calculations -> checked workspace specification -> linked map, charts, diagrams, and explanation`

Follow-ups revise the existing workspace. Selection and time remain shared. Users can inspect the origin of a relationship and distinguish a documented connection, calculated association, and suggested comparison.

The map is a visual guide, not a required home for every concept. Later non-geographic diagrams can share selection and historical context without inventing coordinates. A mechanism's animation clock remains separate from historical time. Actual globe support depends on the repository and separate renderer validation; this work does not promise a new globe implementation.

### What becomes dynamic

The model may eventually choose datasets, query operators, chart encodings, panel arrangements, and registered view extensions. It may later request isolated custom transformations or diagrams. The host continues to own permissions, calculations, evidence validation, resource budgets, timeline semantics, and publication.

The engine does not need a bespoke screen for every topic. It does need reusable visual primitives and explicit extension contracts. Start with a small declarative vocabulary; do not pretend it supports arbitrary programs before Milestone 3.

### Preserve the existing user experience

Keep the Atlas accessible without the research mode. Integrate research controls into Explorer; do not replace the selected-country panel with an always-open essay. Use a distinct research area that expands only when relevant. Preserve the docked full-width timeline and separate geographic/topic filters where those conventions exist.

Use the project's typography and design tokens. Keep glass surfaces readable, avoid blanket blur, and provide keyboard focus, reduced motion, narrow-screen layout, and readable tables. The spacebar must not toggle playback while the user types.

## 3. Contracts to implement

The following are proposed minimum contracts, not existing repository APIs. Follow established naming conventions where practical. Use one authoritative runtime schema and derive matching TypeScript types where possible.

| Contract | Minimum responsibility |
| --- | --- |
| `QueryIntent` | Original question, displayed interpretation/scope, explicitly inherited map selection or viewport, requested time window, follow-up parent. Viewport is context, not an automatic global-question filter. |
| `DatasetDescriptor` | Dataset/version/hash, fields, units, geographic and temporal support, available variables, null semantics, coverage, source and license references, permitted operators and declared joins. Unknown values remain explicit. |
| `QueryPlan` | Catalogue IDs, selected fields, typed filters, permitted join identifiers, approved transformations, output bindings, expected semantic constraints, and resource estimate. No arbitrary SQL, URLs, imports, or paths. |
| `ResolvedDataBundle` | Pinned inputs, resolved rows/features, stable entity/observation IDs, geometry references, computed values, warnings, and resolvable lineage. |
| `DashboardSpecification` | Schema version, resolved-data bindings, claims, view types/encodings, display caveats, allowed interaction bindings, and host-controlled layout options. No independent hidden queries or unsupported numerical constants. |
| `ExecutionManifest` | Normalized query, source editions and content hashes, schema/compiler/policy versions, transform lineage, warnings, planner provenance when applicable, replay requirements, and export permissions. |

### Minimum observation meaning

An observation resolves to `entityId`, `variableId`, value or explicit missing state, unit, geographic definition, observation date/precision, historical validity where applicable, evidence type, source locator, and edition. Uncertainty may be absent; absence must not create a synthetic interval. Geocoding quality, measurement uncertainty, and scholarly review status are separate fields.

Use source page/table/row or stable local-record locators where available. A general URL alone is not adequate support for a precise numerical claim. Dataset coverage and known sampling limitations must be available to the explanation.

Use existing chronology utilities. Record their BCE/year-zero/calendar/interval conventions and test the adapter. Do not turn an imprecise historical year into a fabricated January 1 event.

### Safe initial query vocabulary

Support only operations required by the pilot: field selection, typed comparisons, bounded filtering, sorting, grouping/counts, and permitted aggregates. Compute deltas or percentages only when declared definitions and denominators allow them. Default to no cross-dataset join; add one only through an explicit compatibility rule.

Return typed errors such as `UNKNOWN_REFERENCE`, `INCOMPATIBLE_GEOGRAPHY`, `UNSUPPORTED_OPERATION`, `INSUFFICIENT_EVIDENCE`, `BUDGET_EXCEEDED`, and `EDITION_MISMATCH`. Provide a clear user-facing explanation rather than exposing internals.

The planner's requested output is not the evidence. Trusted execution resolves real records. A generated sentence containing a number must bind to an observation or deterministic result; initial summaries should use constrained, data-bound composition.

### Validation layers

Perform schema validation, reference resolution, rights/permission checks, semantic compatibility, bounded execution, result consistency, lineage resolution, and renderer-capability checks before activating the workspace.

These checks establish properties of the supplied data and program. They do not prove that all sources are accurate or that a historical interpretation follows from them. Keep claim-support review and scholarly review statuses explicit. Do not report a semantic validator pass as historical certification.

## 4. Shared interaction and rendering contract

Keep one host-owned state containing `workspaceRevision`, `cursorTime`, `analysisTimeWindow`, selected entity/observation/claim, filters, and data-availability status. Use typed actions with origin and revision identifiers. Derive views from that state rather than maintaining competing panel-specific clocks.

The chart can show the whole analysis window while its cursor tracks the map. Clicking a point selects its entity and evidence; a deliberate action may move time to its observation. This distinction prevents every cursor motion from collapsing a useful time series to one point.

### Revision and lifecycle rules

A new query creates a staged revision. Resolve data, validate it, initialize all affected views, then activate that revision together. Slow or failed results cannot overwrite the latest request. Keep the last usable workspace visible with an explicit status; never pair its chart with a new unsupported answer.

Namespace resources using stable workspace IDs. Add/update only workspace-owned layers and sources. Preserve the existing map instance, camera, base layers, historical resolver, and unrelated selection. Reconcile after style reload where supported. Remove listeners/layers/sources on disposal, without touching base-map resources. MapLibre documents source/layer management and stable-ID feature state; implementation must match the installed version. [T5]

For selection and cursor changes, prefer local filters or attribute updates. Do not rebuild whole geometry for every pointer event. Model planning is outside the animation loop. Large or cold data requests may run asynchronously, with cancellation and explicit loading/coverage state.

### Historical presentation rules

Plot actual observations by default. Do not connect unknown intervals as though measured continuously. A connecting line must have a documented visual meaning, and modeled interpolation requires a separate approved method and visible label.

A settlement's first available population estimate is not its founding date. Retaining an older point is a labeled reference, not an exact observation at the current cursor. Entity identity persists even when its current observation is outside the display window.

This milestone improves persistent thematic interaction; it does not fill historical gaps or interpolate political frontiers. Report that scope separately from Chronicle's border-motion work.

## 5. Security, provenance, and replay

### Declarative path: Milestones 1–2

Permit a bounded view vocabulary and approved data bindings only. Disallow model-controlled external resources, script/callback strings, raw HTML/SVG, arbitrary query text, filesystem paths, and direct provider credentials.

Validate all nested structures and renderer inputs. Route chart data through host-resolved data bindings. Disable default external loading paths, including nested chart URLs and remote media. Source links are host-rendered from validated registry records; they are not executable links supplied by generated content.

Use a compatible CSP-safe expression path where required; do not add `unsafe-eval` simply to accommodate generated specs. Vega documents an interpreter option, and its loader supports network/file access, which must be controlled. [T3–T4]

Workers may move trusted computation off the main thread; they do not independently remove network capability. DuckDB explicitly treats untrusted SQL as executable code. An allowlisted query compiler and execution limits remain necessary even when a database handle is read-only. [T1–T2]

Treat retrieved text and data cells as untrusted content. They cannot override permissions, request tool escalation, or redirect data exports. Provider failures and repair attempts never disable validation.

### Custom generation: Milestone 3

Require a separate work order and threat-model review. Start with isolated transformations producing bounded JSON and diagrams rendered from validated structured output. Do not begin by granting generated programs access to the host DOM or live MapLibre object.

The chosen execution environment must enforce no outbound network, no host filesystem or credential access, read-only staged inputs, bounded temporary storage, process/time/memory/output limits, cancellation, and least privilege. Merely calling a process a container or Worker does not satisfy these requirements.

Treat outputs as untrusted too. Validate JSON; sanitize and render permitted static SVG without scripts, event handlers, external references, or `foreignObject`. Custom interactive code needs its own documented isolation boundary; it is not covered by a static-image test.

### Reproducible workspaces

Save the normalized plan/specification and explicit data references, hashes, versions, transforms, and lineage. The default replay archive is not permission to redistribute source data. Export underlying rows or passages only when the source policy allows it; never export secrets or restricted prompts.

Replay without a model against matching authorized data. Missing or changed hashes produce an explicit unavailable/mismatch result, not silent execution against the latest edition. Re-running a model is a new revision, not replay. Require deterministic result/manifest equality where specified; do not promise pixel-identical output across GPUs or browsers.

## 6. Four milestones and their exit gates

### Milestone 1 — UI and interaction contract

**Implement now:** baseline discovery, pilot metadata, read-only adapter, minimum runtime schemas, one generic executor, two manual specifications, linked views, clear prepared-example mode, save/replay, tests, and visual inspection inside Explorer.

**Exit gate:** an actual-source-backed prepared workspace passes applicable tests, including metadata incompatibility and stale-result handling, and the feature-disabled Atlas still works. No live model or arbitrary-code sandbox is required to pass. Missing real data or unavailable hardware tests must be reported separately rather than hidden.

### Milestone 2 — Semantic data layer and LLM planner

**Later work order:** broaden catalogue metadata, add provider-neutral retrieval/planning, produce the same validated plans/specifications from natural language, and support follow-up revisions. Start with local registered data, not unrestricted web research or automatic historical ingestion.

Use bounded tool calls and repair attempts, cancellation, redacted observability, and configured budgets. A suggested initial ceiling is one proposal plus at most two repairs; this is a product policy to test, not a reliability guarantee. With no authorized provider, keep the prepared-example path and mark live planning unavailable. Do not require credential disclosure in chat or add a paid service unilaterally.

**Exit gate:** held-out paraphrases, valid multi-view questions, unsupported subjects, incompatible measures, prompt-injection content, provider errors, and follow-up changes are evaluated with separate plan-validity, numerical-correctness, claim-support, and refusal-to-invent results. Prewritten fixtures are not evidence of live generation.

### Milestone 3 — Dynamic code generation and isolation

**Later work order:** implement one justified custom transformation or non-map diagram capability behind the isolation contract above. Preserve the declarative path as default.

**Exit gate:** real generated output passes functional tests and negative isolation tests for network/file/credential access, resource exhaustion, malicious output, and stale completion. If the sandbox cannot enforce the required boundary, leave execution disabled and deliver only independent completed work.

### Milestone 4 — Engine extraction for open source

**Later work order:** extract stable contracts, validator/executor interfaces, interaction runtime, and view adapters after a second distinct domain or non-map example demonstrates reuse.

**Exit gate:** a separate small application can use the core without Chronicle UI imports or a mandatory model vendor. Provide a licensed reference dataset, tests, documentation, and an extension example. Verify code/dependency/data rights independently. Publishing, changing repository visibility, or choosing a project-wide license requires explicit authority.

## 7. Acceptance matrix for the first execution

Use PASS, FAIL, BLOCKED, or NOT RUN with actual evidence and commands. These rows describe tests to run, not completed results.

| ID | Test and required outcome |
| --- | --- |
| W1-01 | Baseline: actual source/revision/dirty state and commands recorded; feature-disabled build works or pre-existing failures are identified. |
| W1-02 | Protection: canonical data/publication files and protected mesh/ledger outputs are unchanged; inspect diffs and hashes where applicable. |
| W1-03 | Pilot provenance: every displayed historical measurement resolves to an actual record and precise available source locator; synthetic fixtures stay out of the normal path. |
| W1-04 | Generic runtime: primary spec and one meaningful variation render without new subject-specific UI or embedded fabricated measurements. |
| W1-05 | Cross-selection: chart to map/inspector and map to chart/inspector resolve the same stable entity and observation. |
| W1-06 | Temporal semantics: cursor/window independence, uncertain dates, sparse observations, explicit reference dates, and BCE/interval boundaries behave as documented. |
| W1-07 | Bad semantics: unknown units/denominators, zero denominators, differing geographic definitions, null versus zero, and duplicate joins cannot produce misleading arithmetic. |
| W1-08 | Revision safety: deliberately out-of-order completions and rapid A-B-A requests cannot install stale results or mixed evidence. |
| W1-09 | Failure behavior: empty coverage, malformed spec, data timeout, missing source, and bad reference preserve the last valid workspace with clear status. |
| W1-10 | Host integrity: no map recreation on cursor movement; stable IDs survive filters; repeated open/replace/close does not accumulate workspace resources or listeners. |
| W1-11 | Security: reject nested external loaders, raw code/HTML/SVG, unknown fields/operations, injected instructions, and oversized specs before rendering. |
| W1-12 | Numerical consistency: displayed values/units/rounding match independently checked query outputs; every derived result has resolvable lineage. |
| W1-13 | Replay: saved spec/data references reopen without a model; missing/hash-changed data fails explicitly; exported manifests contain no secrets or restricted records. |
| W1-14 | Network behavior: warm cursor/selection actions make zero model or analytics requests for the loaded pilot. Do not count normal map-tile requests as violations. |
| W1-15 | Accessibility: keyboard/focus, typed-space handling, reduced motion, data-table access, and narrow viewport are checked. |
| W1-16 | Visual review: desktop and narrow screenshots are actually inspected for clipping, unreadable glass, chart labels/units, stale status, and evidence access. |
| W1-17 | Regression/fallback: existing Atlas routes, country selection, temporal controls, source inspection, and current Canvas/flat fallback remain usable. |
| W1-18 | Performance: a named loaded workload is measured, with warm/cold paths and rendering environment distinguished. Missing physical GPU/mobile testing is NOT RUN, not PASS. |

### Proposed performance and resource budgets

For the first pilot, target at most 2,000 visible entities, 20,000 loaded observation rows, and five linked views. Use a 10 MiB decoded-data budget and 1 MiB input-specification budget unless the actual implementation justifies a documented adjustment. These are starting limits, not measured hardware capacity or global product ceilings. Check projected expansion as well as input size.

Target warm selection-to-coordinated-visible-update p95 at or below 100 ms on the declared desktop test environment. Measure at least 200 interactions, include rapid reversals, and report sample counts, timing endpoints, and workload. Aim for desktop 60 fps, but do not claim it without a trace. Keep cold-loading latency separate and cancellable.

Repeat at least 20 workspace replace/dispose cycles and check owned layer/listener counts return to baseline; treat heap measurements as supporting evidence rather than exact byte equality. A physical-device result is distinct from an emulated narrow viewport or software renderer. Report target misses and improvements without moving thresholds merely to manufacture a pass.

## 8. Work organization and delivery

The integration lead owns contracts, shared state, dependencies, and final review. After contracts are fixed, data/semantics and view integration may be delegated to separate scopes; verification can be independent. Use sequential roles when subagents are unavailable. Do not introduce an orchestration service to manage the coding task.

Expected repository outputs are implemented source/tests plus a short `SESSION.md`, `docs/research-workspace/BASELINE.md`, `PILOT.md`, and `ACCEPTANCE.md`, or equivalent existing conventions. Store evidence artifacts where the repository normally keeps them. Do not substitute extensive documentation for an actual linked feature.

The final execution handoff must state what works, how to run it, what changed, which data was used, exact test results, actual screenshots/traces, unresolved gates, and the next authorized step. Do not claim all four milestones complete because the first UI compiles.

## Technical verification notes

These primary-source checks informed the revisions. They describe general platform behavior, not the installed repository versions. Accessed October 7, 2026.

- **[T1] MDN — WorkerGlobalScope.fetch:** Workers expose network fetching; moving code off the main thread does not by itself deny network access. https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/fetch
- **[T2] DuckDB — Securing DuckDB:** untrusted SQL requires sandboxing; settings and prepared values are not a substitute for controlling arbitrary query execution. https://duckdb.org/docs/current/operations_manual/securing_duckdb/overview
- **[T3] Vega — Expression Interpreter:** the default expression path generates functions; an interpreter supports stricter CSP integration. https://vega.github.io/vega/usage/interpreter/
- **[T4] Vega — Loader:** loaders can retrieve network/file resources, so a declarative spec needs explicit resource controls. https://github.com/vega/vega-loader
- **[T5] MapLibre — Map API:** documents source/layer management, filters, feature state, and stable feature-ID requirements. https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/
- **[T6] OpenAI — Custom instructions with AGENTS.md:** documents instruction discovery and nested guidance. Keep durable rules separate from the active task and preserve existing repository instructions. https://developers.openai.com/codex/guides/agents-md

No repository code, historical source collection, dependency lockfile, or live application was audited to create this packet. Integration and performance claims require the execution evidence specified above.

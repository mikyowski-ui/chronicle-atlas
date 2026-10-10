# Semantic contracts — dual-pilot local preview

This sprint adds a typed, bounded, read-only semantic query path. It is Milestone 2 contract preparation, not a live planner or a completion claim for later milestones. Neither pilot enables arithmetic, inferred routes, publication or model processing.

## Runtime boundary

`research-semantic/contracts.ts` defines strict Zod 4.6.5 schemas and derives exported TypeScript types with `z.infer`. Zod is pinned in a small isolated package so the protected main application manifest and lockfile remain unchanged. `z.config({jitless:true})` runs before schema construction: validation uses Zod's interpreted path and does not construct runtime functions. A fresh Node child test replaces the global Function constructor before importing the contracts and verifies zero construction attempts during import and parsing.

The sequence is `QueryIntent -> QueryPlan -> ResolvedDataBundle -> DashboardSpecification -> host views`. `catalogue.ts` compiles only the `observations` operation. Dataset IDs, entity IDs, indicator keys, bounding boxes and inclusive astronomical-year epochs must fit a byte-verified host registration. Coordinates are reference points; filtering them does not assert historical territory or spatial activity beyond their evidence. The compiler permits no SQL, executable expressions, loaders, URLs or callback fields. Unknown nested properties fail strict validation. Plain dataset text remains inert data for host text rendering.

Input is bounded before Zod traversal: 64 KiB query/replay input, 10 MiB fixture input, depth 14, 250,000 nodes, 20,000 rows, 2,000 entities and five views. Cycles, non-JSON values, unsafe keys, duplicate entities/views, reversed intervals and unknown references fail closed. A row-budget overflow raises an error instead of silently truncating evidence.

## Contracts

| Contract | Responsibility |
| --- | --- |
| `QueryIntent` | Prepared question, interpretation, explicit registered spatial/temporal/entity scope and parent reference. |
| `DatasetDescriptor` | Exact fixture bytes, source editions/hashes, indicator units/classes, bounds, entity IDs, row budget and permitted normalizer IDs. |
| `QueryPlan` | Normalized scope, pinned dataset and descriptor hashes, fixed observation fields, bounded rows and semantic policy version. No joins enabled. |
| `SemanticFixture` | Retained source references, typed observations, entities and explicit coverage. |
| `ResolvedDataBundle` | Bound entities/observations, original source pins, caveats and deterministic result hash. |
| `DashboardSpecification` | Data-bound host map/timeline/table/evidence/summary views, shared selection and adaptive layout. No independent hidden query. |
| `ReplayManifest` | Reference-only normalized plan, compiler/policy/adapter versions, data/source/descriptor hashes, observation identities and result hash. |

Schemas use explicit properties, unions and tuples; the new contracts and runtime contain no `any` declarations or open index signatures. Core contracts have no renderer, DOM, database, network or model imports. The catalogue adapter reuses the existing trusted source verification and SHA-256 utilities.

## Evidence meaning

`attested` means a recorded claim has an attributed source. It does not guarantee the described event, eyewitness status or scholarly review. The premodern fixture contains editorial summaries of retained accounts, explicitly labeled as summaries rather than quotations. `modeled` covers the modern published population estimates; no cell-specific estimation method or fabricated statistical confidence is asserted. `interpolated` requires explicit method/input references; no pilot interpolation is generated or enabled.

Each observation carries event support, optional composition support, an independent confidence declaration, source hash/locator, original record hash, bibliography IDs, review status, limitations and a support note. Unknown measurement confidence and unknown positional radius are separate null/unknown states. A geocoding radius never becomes measurement reliability. If a source interval is supplied, its unit class and numeric bounds must agree with the value. Missing values remain null; real zero remains zero.

Modern pilot: 44 discrete observations at five-year checkpoints, four Mexican DEGURBA urban centres, 1975–2025. The adapter first validates the original pilot file against its fixed hash and the original UN workbook/canonical-city pins. Values and source-cell pointers remain unchanged. The source provides no retained uncertainty interval; constant city footprints are unestablished. No continuous measured series, municipal-population equivalence or annual interpolation is claimed.

Premodern pilot: ten account descriptions, nine named places, 40–1516 CE. Event windows and composition windows remain distinct. Samarkand's 630–631 and 1404 observations do not fill the intervening centuries. Modern reference coordinates carry unknown spatial uncertainty radii. The fixture neither constructs routes nor quantifies trade, population or political control. See `PREMODERN-PILOT.md` and the source-audit JSON for source support and limits.

The year convention is the existing Atlas astronomical-year convention (year 0 is 1 BCE), with inclusive interval overlap. No January 1 event is fabricated from a year or uncertain range. A synthetic, clearly identified test fixture verifies BCE/year-zero boundaries; it is not part of either real-data pilot.

## Normalization and replay

Both pilots register zero normalizers. Cross-dataset joins are unavailable. `requireRegisteredNormalizer` is an explicit guard for future host-reviewed comparison rules: both descriptors must name the rule; indicator classes, units, documented fixed geography, temporal support and allowed evidence statuses must agree. Unknown confidence is preserved. Even a passed guard performs no arithmetic and does not expand the current query vocabulary. A population estimate and a qualitative account cannot be joined by inventing a rule ID.

Only registrations created by exact-byte verification enter the catalogue. Registered descriptors and fixtures are deeply frozen. Semantic metadata is part of the descriptor hash, so changing scope, source permissions or normalization rules invalidates replay. Replay never silently substitutes a newer edition. Exports omit questions, descriptions, source passages and measured values; they retain only registered references, enum values and hashes. Replay checks in-memory pinned fixtures; original-document support is independently checked by source tests and the fixture generator, not fetched again on every browser interaction.

## Reproduce

From `apps/explorer`:

```sh
(cd research-semantic && corepack pnpm install --frozen-lockfile --ignore-scripts)
node --import tsx --test tests/semantic-contracts.test.ts
corepack pnpm exec tsc --noEmit
python3 scripts/build-premodern-pilot.py --check
```

The test suite covers both actual fixtures, all ten premodern source records, all modern adapter values, query bounds, strict malicious-input rejection, code-generation denial, temporal gaps, event/composition distinction, confidence/position separation, null/zero, replay pins, forged catalogue rejection and normalization barriers. A semantic consistency pass is not certification of historical accuracy. Browser responsiveness, hardware and accessibility results belong to the sprint acceptance report.

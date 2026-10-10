# Chronicle global source observations

This directory is a staged, source-attributed display product for the existing Explorer. It does not modify or promote the public historical ledger, certify effective political control, or extend snapshot validity into intervening years. The retained Integrated 1900 product remains independently reproducible and unchanged.

`catalog.json` connects all 49 recovered observations from 3000 BCE through 2010 CE to separately bounded Alpha manifests. Each manifest has one observation and independently hashed PMTiles, canonical metadata and full normalized Canvas geometry. Global Natural Earth physical land is shared from `../integrated/`; it is neutral modern physical context, not historical political or shoreline evidence.

The reusable implementation is `scripts/build-global-history.mjs` (sequential coordinator), `scripts/build-global-history-observation.mjs` (one parameterized compiler) and `scripts/build-global-history-normalize.py` (geometry validation/repair). It reuses the existing `build-alpha-pmtiles.py` writer and Alpha validation/loading contracts. `build-integrated-world.mjs` is retained for the old exact product; there are not forty independent pipelines.

## Reproduce

Use the existing app's pinned Node dependencies and Python build environment. Python requirements are `pmtiles==3.8.1` and `shapely==2.1.2` in `.sites-runtime/fixture-build/venv` (or set `CHRONICLE_GEOMETRY_PYTHON`). Then, from `apps/explorer/`:

```sh
node --max-old-space-size=256 --import tsx scripts/build-global-history.mjs
```

The coordinator reads `source/input-manifest.json`, each corresponding `mappings/*-mappings.json`, and the frozen `resource-budget.json`. One fresh child process handles each observation with256 MiB old heap,512 MiB RSS and60 seconds per job. One input failure is recorded without discarding unrelated outputs. Resume keys bind original-source SHA256, exact mapping SHA256/version and compiler configuration/script hashes; retained asset bytes are rechecked before reuse.

`--only world_bc200,world_1700,world_1900` is a debugging checkpoint only. Primary delivery required all 40 observations. After its recorded browser gate passed, the separately authorized nine earlier observations were added. All byte, worker and runtime limits remain unchanged. The primary 40 manifest hashes are preserved exactly; new earlier manifests bind the scope amendment by hash while retaining original pilot rights records.

## Meaning and accounting

The preserved primary batch and completed extended batch reconcile every original feature:

| Outcome | Primary 40 | Extended 49 |
|---|---:|---:|
| Original source features | 15,462 | 16,928 |
| Political association | 3,384 | 3,441 |
| Cultural presence | 164 | 281 |
| Source context | 677 | 1,032 |
| Review queue | 5,375 | 5,443 |
| Quarantined whole feature | 107 | 111 |
| Explicit exclusion | 5,755 | 6,620 |

The extended product has 4,754 admitted source features, 13,067 canonical Polygon parts and 4,528 entity/date entries. These are not counts of independently verified polities or percentages of historical completeness. Independently reviewed history remains 0. A further 27 separable components intersecting the protected Hawaiian scope are withheld from otherwise admissible source features; these do not count as 27 additional whole-feature decisions. Full originals remain archived.

Each observation's `outcomes.json` contains exactly one outcome per original source feature, its raw properties, original geometry hash, mapping rationale, normalization receipt and component omissions. `coverage.json` includes the same per-date totals and overlapping regional-window diagnostics. Region values count source-feature bounding boxes intersecting each window; they are not area coverage, exclusive regional allocation, or sovereignty claims.

1492 is especially sparse relative to its unusually detailed source: 92 admitted of 1,946 features, including 74 political associations and 18 context features; 1,223 remain in review, 629 are excluded and 2 quarantined. This is an explorable overview with explicit omissions, not adequate admission of every source subdivision. The extended 3000 BCE observation has 23 admitted features: one source-political association (Egypt), nine cultural and thirteen context features. The 2000 BCE observation has one political association, fifteen cultural and twenty-six context features. These are context-rich early observations, not broad worldwide political coverage. A compiled date does not imply globally complete political coverage.

Cultural and context features keep different kinds and relations from political associations. Original PARTOF/SUBJECTO attributes remain source metadata and do not generate unverified political relationships. Stable identities are reused only under the recorded dated mapping rules. Basic cards must show source/date/type/review meaning; the three existing enriched dossiers remain separate editorial products.

## Geometry and resources

Original coordinates and properties are unchanged in `source/input/`. Eleven admitted features require documented GEOS `make_valid` via Shapely 2.1.2; no simplification, snapping or buffering is used by that normalizer. Non-polygon repair remnants, if present, are recorded. Two-dimensional display omits optional altitude and clamps latitude only at the Web Mercator projection limit, with counts in receipts. Canvas retains all normalized polygon vertices and holes. PMTiles uses the frozen cartographic zooms 0–4 encoding; this does not interpolate time or change source validity. No admitted ring contains an antimeridian longitude jump larger than180 degrees; split islands retain independent canonical render IDs and shared declared entity identity.

The completed primary batch took 31.35 seconds, with the slowest job 0.863 seconds and peak Node RSS 156,499,968 bytes. New PMTiles total 11,744,932 bytes; retained plus new compressed archives total 44,424,345 bytes. Maximum archive 469,589 bytes, metadata 1,045,551 bytes, fallback 2,118,796 bytes and 508 parts per scene all stay inside unchanged per-product caps. The root catalog is 35,226 bytes. Measurements are actual build-process measurements, not browser live-memory or physical GPU performance results.

Every MVT tile is decoded during compilation and checked against canonical identities. PMTiles headers and first/middle/last spatial entries are read back. Four regression tests traverse all 49 dates for original-source reconciliation, full Canvas loading/hash checks, native tile chronology/identity, typed meanings, protected Hawaii, BCE conversion and budget compliance. Browser date-gallery and physical/software GPU results belong to the separate final acceptance receipt; compiling does not count as displaying.

## Completed optional extension

The earlier nine observations were enabled only after the primary 40 main-screen gate preserved in `verification/global-history/primary-40/browser-gate.json`. They use the same compiler and add 1,466 original features: 57 political associations, 117 cultural-presence and 355 source-context features; 68 remain under review, four are quarantined and 865 excluded. Their source authorization is recorded separately in `source/optional-rights-amendment.json`; original pilot restrictions remain archived unchanged.

The final optional compile took 6.20 seconds. Across all 49 products, new tile archives total 13,663,316 bytes and retained plus new archives total 46,342,729 bytes. The 49-observation root catalog is 43,475 bytes. Maximum per-product sizes and peak process RSS remain the primary maxima listed above. The catalog SHA-256 is `03f1b13dad616960376897770de3abdb43eff685dd2937ac463d228df53cd980`.

Component quarantine uses exact polygon intersection with the protected Hawaiian window after a bounding-box prefilter. This prevents an unrelated broad Americas component from being withheld solely because its bounding box overlaps the window. All 27 actual protected components remain omitted. The regression suite checks all 49 scenes and verifies that the original 40 manifest/source hashes remain unchanged. Browser screenshots and exact displayed-scene evidence are recorded separately by the integrated application review.

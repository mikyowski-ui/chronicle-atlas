# Milestone 1 pilot: four Mexican urban centres

The prepared workspace asks **what population estimates are available for Mexico City, Guadalajara, Monterrey and Puebla, 1975–2025**. These four existing reference identities each have eleven UN estimates in the retained Chronicle source: 44 records in total. The variation focuses on Guadalajara in 1990–2025 (eight records). Both use the same bounded read-only runtime. The choice provides several nearby entities, repeated dates, precise raw locators, a declared population definition, and explicit reuse terms without ingesting anything new.

This is the recovered **Teaching Atlas local preview**, not a newly approved historical publication. No canonical record, source workbook, historical narrative, or publication manifest is rewritten. `apps/explorer/src/research/pilot-data.json` is a bounded derived view, outside authoritative historical data.

## Source and pinned edition

United Nations, Department of Economic and Social Affairs, Population Division (2025). *World Urbanization Prospects: The 2025 Revision, Online Edition.* File 21, `POP/DB/WUP/Rev.2025/F21`.

- Source ID: `un-wup-2025`.
- [Official source workbook](https://population.un.org/wup/assets/Download/Cities/WUP2025-F21-DEGURBA-Cities_Pop.xlsx).
- Copyright © 2025 United Nations; [CC BY 3.0 IGO](https://creativecommons.org/licenses/by/3.0/igo/).
- Derived edition: `chronicle-teaching-local-2026-09-27/un-wup-2025-f21-v1`.
- Source workbook SHA-256: `3a96030d87aec6c1c50f658d5321067d6345e1ab936c5d2854524f972caa75c0`.
- Canonical `public/history/cities.json` SHA-256: `ebc9a6ef20b1edfa3c957995b17e57c4b061a6ad89727ff1a2e0ac0983b53be5`.

The small view selects four pre-existing city identities and selected five-year dates, converts source thousands to rounded persons using the existing compiler's `round(value * 1000)`, and adds stable IDs, precise cell/record locators and conservative semantic metadata. The United Nations has not endorsed this adaptation. Preserve this attribution, license and change notice with any permitted redistribution. This work order does not publish the result. Replay should export references, version pins and validated specifications rather than source records or private credentials.

## Definition, dates, and limits

The workbook describes population residing in cities at **mid-year**, measured in thousands. Cities follow DEGURBA population, density and contiguity criteria using population grids and satellite data; the metadata lists at least 1,500 inhabitants/km² and at least 50,000 inhabitants. This is an urban-centre definition, **not municipality boundaries**. Data are statistical estimates. Source-attributed does not mean newly scholarly reviewed.

The shared DEGURBA method supports separately displayed levels with an explicit comparability caveat. Constant per-year geographic footprints are **not** established by the retained metadata. The pilot forbids totals, growth rates, percentages, cross-source deltas and joins. A common unit alone cannot enable those calculations. Record counts and available-date coverage are permissible descriptive calculations. Missing is unavailable, never zero.

Display precision is `year`, retaining original temporal meaning “mid-year estimate.” A timeline navigation boundary must not become a claim that a population was observed on January 1. No connecting lines, interpolation, extrapolation, or inferred demographic causes are supplied. When a map point retains an estimate at another cursor date it must expose the actual estimate year. The analytic window is independent of the map cursor.

Coordinates use the existing `modernReferenceCoordinates`: the UN population-weighted reference centroid, not an urban polygon. Existing city identity alignment is reused; it is not proof of unchanged geographic extent. Country labels are source reference labels, not assertions of historical sovereignty.

No population uncertainty bounds are supplied for these observations. `uncertainty: null` means unavailable; no confidence percentage is invented. Historical geocoding reliability is separate from measurement uncertainty. Rounded integer persons preserve the existing conversion and do not imply person-level accuracy.

## Precise record lineage

Workbook sheet: `Data`. Rows and spreadsheet cells are one-indexed; canonical JSON pointers are zero-indexed and valid only against their pinned content hash.

| Stable entity | Source City_Code | Data row | Canonical city index | UN population indices |
| --- | ---: | ---: | ---: | --- |
| `hist-mexicocity-faaf2abd` | 5439 | 11157 | 983 | 26–36 |
| `hist-guadalajara-86f202e4` | 3099 | 11185 | 547 | 9–19 |
| `hist-monterrey-f375b062` | 6218 | 11229 | 1005 | 2–12 |
| `hist-puebla-d4160425` | 5915 | 11249 | 1225 | 16–26 |

Years 1975, 1980, 1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020 and 2025 correspond to columns `L,Q,V,AA,AF,AK,AP,AU,AZ,BE,BJ`.

Example: Guadalajara 1975 resolves to `Data!L11185`, City_Code 3099, and `/cities/547/population/9`. Source value 2010.388 thousand becomes 2,010,388 persons. Stable observation ID: `hist-guadalajara-86f202e4:un-wup-2025:1975`. Numerical UI content is resolved from the data; it is not embedded in chart or summary code.

All 44 values were independently checked against the retained workbook with openpyxl and again by the standard-library derivation script. Exact `round(raw * 1000)` equality held for all 44. Source City_Code, Mexico reference label, centroids, canonical source ID and years are checked. These tests verify traceability and conversion, not the historical accuracy of the underlying estimate.

## Exclusions

- Other Mexican settlements and unsampled annual values are outside the pilot; this is not national coverage or a complete city ranking.
- Historical Reba/Chandler/Modelski observations and same-year alternatives are excluded. Their geographic definitions differ or are unknown; they are not additional UN values. For example, Guadalajara 1975 retains a Chandler alternative of 1,500,000 while the UN value is 2,010,388. This difference cannot be explained as demographic change from these records.
- A real incompatibility example is Guadalajara 1950 Chandler 377,000 (`alldata.csv`, physical line 9287, row ID 9286); its geographic definition is not sufficient for a cross-source growth calculation. The row remains in canonical data and is not copied into the pilot.
- Future projections for 2026–2050, current capital flags, founding dates, ports, migration, trade routes, causal explanations and new border claims are excluded.

## Reproduction and checks

From the repository root, Python 3.9+ with only the standard library:

```sh
python3 apps/explorer/scripts/build-research-pilot.py --check
```

`--check` reads fixed registered inputs, validates their actual hashes and the existing build-manifest pins, verifies every selected workbook cell against the canonical record and compares exact deterministic output bytes. It writes nothing. Missing inputs or mismatching hashes fail explicitly. It does not use the network. This command requires the source workbook from the recovered Originals archive.

To explicitly regenerate **only the derived view** from matching pinned source bytes:

```sh
python3 apps/explorer/scripts/build-research-pilot.py
```

The script has no arbitrary input path, dataset, field, query, or source URL parameter. It never invokes the historical compiler. The output's SHA is pinned by the host separately; no self-referential content hash is embedded. Runtime and security acceptance results belong in `ACCEPTANCE.md`.

## Existing chronology

`lib/readiness/chronology.ts` defines astronomical internal years and proleptic Gregorian integer days. Internal year 0 displays as 1 BCE; internal -1 as 2 BCE; civil year zero is rejected. Core intervals are end-exclusive. `observationExtent` represents uncertain observation windows without asserting their bounds as events. Explorer's city parser already uses astronomical years; its capital-year periods use inclusive years. Research year filtering and host-day conversion must preserve these conventions and avoid fabricating date precision.

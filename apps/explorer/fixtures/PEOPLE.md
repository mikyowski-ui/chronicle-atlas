# VP07 bounded people and movement observations

The population card reads a precomputed lookup. No geometry clipping or cell
intersection occurs in the client card path. The old numerical fixture model
remains a build-time oracle and a regression target; it is not imported by the
new runtime lookup module.

## Source intake and rights

The intake budget was frozen in `public/people/resource-budget.json` before the
five bounded source/rights requests. Exactly 525,063 input bytes were retained:
442,349 bytes for the ONS workbook, 14,104 bytes for the Hansard page and 68,610
bytes for the ONS catalogue. These bytes are charged to the existing aggregate
input budget of 134,217,728 bytes, starting from 82,242,223 retained bytes.
No automatic retries or source-wide scraping were performed. Rights-page direct
downloads returned HTTP 403; the rights record distinguishes web verification
from byte retention. The complete workbook and Hansard page remain pinned by
SHA-256 in `source/download-record.json` and `source/rights-record.json`.

| Product | Exact admitted observation | Source and rights |
| --- | --- | --- |
| Population | England and Wales, mid-1900, published estimate of 32,249,200 persons | ONS *England and Wales population estimates 1838 to 2025*, released 29 July 2026, Table 7 cells A128:B128; Open Government Licence v3.0 |
| Movement | Ireland → Liverpool, 13 January–11 February 1847 inclusive; 27,012 arrivals reported by Earl Fitzwilliam | *HL Deb 15 February 1847*, vol. 89, cc1323–4; Open Parliament Licence v3.0 |

The ONS workbook's own reuse terms and official catalogue footer establish OGL
reuse. Source: Office for National Statistics. Contains public sector information
licensed under the Open Government Licence v3.0.

The official Parliamentary copyright page applies the Open Parliament Licence to
the admitted electronic debate transcript, including pre-1989 material.
Contains Parliamentary information licensed under the Open Parliament Licence
v3.0. No photograph, logo or third-party illustration is used.

## Population interpretation

The real observation is an **England and Wales regional reference**, associated
with the 1900 UK context card. It is not the population of the complete United
Kingdom of Great Britain and Ireland and is not distributed across its polygons.
The full-territory population remains unavailable. The regional reference has no
admitted area geometry: area and spatial-coverage fractions are null, not zero.
The source excludes Islands in the British Seas and portions of the Armed Forces
and Merchant Service abroad. This is a published estimate, not an exact census
count; compact UI rounding is intentional.

Its source date is retained as `1900-midyear`. Visibility within the nominal
1900 observation envelope does not assert that the population was constant
throughout the year or measured on 1 January. Other dates remain gaps. Chronicle
does not compute an interpolated value or substitute a 1901 census count.

Synthetic entries use the complete, untiled display geometry, the authored
independent density rectangles and the existing spherical equal-area model.
The fixed reference is the authored 950 CE footprint evaluated with each epoch's
density. Partial coverage produces a subtotal without extrapolation. These six
synthetic entries never enter the historical dataset.

Every entry uses this complete key:

`[edition, entity_id, territory_state_id, geometry_hash, population_dataset_version, observation_date, method_version]`

Geometry hashes describe the versioned original display polygons before tile
simplification and clipping. Lookups fail closed on another edition, geometry,
state or date. The compiler validates those hashes against the complete source
geometries. Runtime work is a bounded indexed lookup, not a spatial calculation.

## Movement interpretation

The single straight line is a **schematic directional connection** from an
authored representative point in Ireland to Liverpool. The source does not
identify departure ports or voyage tracks. Coordinates are display choices,
not historical survey evidence. No density surface, origin catchment, precise
route, annual rate or later continuation is inferred.

The figure is a contemporary parliamentary report using the speaker's category
of Irish paupers; it is not an independently corroborated total of all migrants.
The numeric interval is half-open `[-44913, -44883)`, preserving the reported
13 January–11 February dates. This separate demographic observation supplies no
political borders for 1847. Neutral physical geography remains visible.

## Reproduction

From `apps/explorer/`, after the display-geometry compiler has run:

```sh
python3 scripts/build-population-observation.py
node --import tsx scripts/build-population-lookups.mjs
node --import tsx --test tests/population-lookup.test.ts
```

The Python extractor uses the standard library and the pinned workbook. It
verifies the input hash, sheet, row label and admitted value before writing the
normalized observation. It does not retrieve another edition. The JavaScript
compiler computes six synthetic comparisons and one real regional reference,
then writes hashed, bounded sidecars and a resource/build record. Any missing
display geometry hash or unexpected cardinality fails compilation.

Source URLs, exact input hashes, full attribution, recorded time and limitations
are retained beside the normalized observations. The public ledger is unchanged;
these are local candidate products pending the existing exact-result boundary.

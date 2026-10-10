# Wave B — British Isles staged candidate

The Explorer loads 31 real Historical Basemaps snapshot years from 200 BCE to
1900 CE, bounded to 12° W–3° E and 48° N–61.5° N. The source revision is
`da7a4b735ecef70aebdc9c73e409d8a2500d50f3`; attribution and GPL-3.0 text are
retained with the data. This is a local staged candidate, not a public historical
publication or independent historical certification.

The archived candidate ZIP could not be retrieved: three authorized materialization
attempts returned HTTP 502. We therefore regenerated the regional derivative from
the exact pinned mapping and normalized source files, using unchanged copies of
the existing rasterizer, coverage encoder and chronology adapter. No SQLite file
was opened or changed. We do not claim that the unavailable original database or
compiled archive was recovered or hash-verified.

## What the data means

- **123 source assertions:** 103 political associations and 20 cultural
  approximations. There are 56 distinct coverage sets, with 3,918 memberships
  counted once per set, and 7,653 memberships when reused sets are expanded across
  their assertions. These four cardinalities exactly match the archived study
  review record. Matching counts are not proof of identical original archive bytes.
- **4,906 eligible displayed cell memberships:** the existing threshold admits
  source intersections covering at least 50% of an immutable 0.5° WGS84 cell.
  The other 2,747 positive intersections remain in `source/claims.json`, with their
  fractions and ineligible status. Small islands can have no eligible cell.
- A cell is authoritative for this display; its `cell_id`, assertion identity and
  coverage fraction survive PMTiles encoding. Source outlines are not substituted
  for those cells. MVT extent 65,536 introduces display-coordinate quantization;
  no simplification, smoothing or interpolation is performed.
- A **nominal year** is a possible observation envelope. `valid_extent` retains
  uncertainty on both ends: the source does not assert a specific beginning or
  ending day. `recorded_from` remains `2026-09-20T02:00:00.000Z`, the recorded study
  edition, and `recorded_to` is open. Regeneration does not create a new historical
  recording date. Unsupported intervening years produce an empty scene.
- Cultural labels never become ownership. Political records mean
  `source_attributed_association`, not certified sovereignty or effective control.
  Overlapping memberships remain visible and explicitly marked; their evidence
  retains all overlapping assertion references.
- Labels have one independent point anchor per active entity. Assertions with no
  eligible cell retain their source evidence but do not create ghost labels. Six
  metadata-only corrections removed such labels after initial verification; the
  MVT tile bytes did not change. Their output is included in resource accounting.
- There are **no real population or migration estimates** in this source. Those
  layers are absent; the synthetic test atlas remains a separate dataset.

## Explicit limitations

The source does not provide separate Roman Britannia province geometries, nor
separate East Anglia and Sussex polygons in the selected snapshots. Five Heptarchy
names are present at 800 CE: Wessex, Northumbria, Kent, Essex and Mercia. Welsh
material is a cultural approximation or part of later composite labels; no missing
Welsh polity is invented. There are 13 named review records and 663 unnamed source
geometries excluded. All 123 admitted geometries passed the existing normalizer;
no new repair was needed. The source is an overview reconstruction with limited
feature-level documentary lineage. Scope-box edges are not historical borders.
The unrelated Hawaiʻi quarantine and all original publication gates remain intact.

## Bounds and verification

`public/wave-b/resource-budget.json` was frozen before the first raster job. It
retains the prior aggregate limits and usage, one worker, 50-feature batch cap,
60-second worker deadline, 256 MiB worker heap and 1 GiB per-process RSS cap. The
build read one snapshot at a time. 73 distinct prepared-geometry jobs were run;
repeated input hashes reused exact in-memory results. The first compile took
91.16 seconds, including 14.55 seconds in raster workers. Peak observed individual
process RSS was 103,940,096 bytes. It is not a physical-device memory measurement.

The 31 final PMTiles archives total 884,626 bytes, with at most 200 features in any
archive. The first 885,109 bytes and 207,930 bytes of corrected archives are both
charged to cumulative output accounting. A further 884,626 bytes from the corresponding-source reproduction check are charged as well. No cap was raised. Every archive was
decoded with PMTiles and MVT readers; source identities, bitemporal bounds and
immutable cell positions were verified by the actual application loader. Browser
and device results are documented separately by the integrated application review.

## Reproduction and corresponding source

From a source checkout with the pinned app dependencies installed:

```sh
cd apps/explorer
node --import tsx scripts/build-wave-b.mjs
node --import tsx --test tests/wave-b.test.ts
```

The original compiler is copied byte-for-byte into the app's ignored build cache;
its hashes and package pins are recorded. The public source bundle includes the
123 prepared feature geometries, complete mapping/review records, all reconstructed
assertion ranges, compiler/generator source, GPL license and upstream notices.
It also includes editable per-epoch cell GeoJSON and metadata plus a minimal
PMTiles rebuild script. That script reproduces the delivered archive bytes
without retrieving the unavailable old candidate ZIP. The original full raw
snapshot files are identified by pinned URLs and SHA-256 values in the inventory
and retained in the Git-backed source checkout. The application contains no claim
of independent corroborating evidence.

The delivered editable cell source was independently re-encoded and all 31 resulting PMTiles archives matched their current manifest SHA-256 values byte for byte. This proves reproduction of this derivative, not retrieval or identity of the unavailable original historical candidate archive.

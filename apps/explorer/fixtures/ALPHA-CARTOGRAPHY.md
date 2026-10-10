# Chronicle Explorer Alpha display cartography

This is a separate, versioned **display product**. It neither replaces the immutable 0.5° audit mesh nor edits, publishes, or certifies the historical ledger. `public/wave-b` remains the retained audit derivative. `public/alpha` contains the direct-vector presentation and its explicit link to those assertions.

## Input editions and rights

| Product | Exact input | Rights / attribution | Meaning |
|---|---|---|---|
| Historical display | Historical Basemaps commit `da7a4b735ecef70aebdc9c73e409d8a2500d50f3`; 123 retained prepared features across the original 31 snapshots | GPL-3.0; André Ourednik and Historical Basemaps contributors. License and source vectors retained at `public/wave-b/source/` | Political source association or explicitly cultural approximation, according to the unchanged mapping. No independent corroboration. |
| Physical context | Natural Earth 1:50m land, archive **4.1.0**, SHA-256 `0b8e670cf80dce9cbebe2a193bc44ba5602758c22e1fa603980553646d7ff162` | Public domain. Made with Natural Earth. Exact ZIP, README, version, rights record and captured terms retained in `public/alpha/source/` | Independent modern physical land context. Not reconstructed ancient shorelines, political control, or evidence of admitted historical coverage. |
| Interaction fixture | Retained `fixtures/meridian-v2.json` | Original invented Chronicle fixture | Aster, Boreal and Cedar are synthetic. |
| Movement observation | Hansard, 15 February 1847, vol. 89 cc1323–4; separate dated report of arrivals 13 January–11 February | Open Parliament Licence v3.0; detailed source record in `public/people/` | Schematic Ireland–Liverpool connection. No claim to measured sailing tracks, departure ports, annual flow, or 1847 political borders. |

The Natural Earth landing page currently calls its download 4.0.0, but the downloaded archive's `VERSION.txt` states **4.1.0**. The actual bytes and declared archive version are pinned. This discrepancy was documented before tile compilation; resource limits were not increased.

## Geography, identity and time

- The historical renderer now uses the retained prepared source Polygon/MultiPolygon components, without the 0.5° rasterizer. Each Polygon component gets `display:<assertion_id>:part:<index>`. MVT clipping repeats that same `render_id` in neighboring tiles; `entity_id` groups all active parts for hover and selection. `territory_state_id` remains the existing assertion ID.
- Original source generalization and the previously documented repair/clipping remain visible. Finite third ordinates (source altitude values) are retained in fallback geometry and geometry hashes; the 2D map projects longitude/latitude only. The study box is `[-12, 48, 3, 61.5]`; an edge created by study clipping is not a historical border. Display polygons can disagree with independent modern coastline context.
- All 123 prepared source features are included. This restores small components omitted by the audit cell threshold, without creating new assertions or changing cell membership. Each maximum-zoom tile set was checked for every original polygon component.
- 31 political/cultural observation years remain separate one-year possible observation envelopes. Unsupported years remain gaps. A separate 30-day demographic observation, `[1847-01-13, 1847-02-12)`, contains a migration line and **no political geometry**.
- Natural Earth records are scanned sequentially. Only physical polygon components intersecting `[-30, 30, 30, 72]` are retained (173 components). Tiles are bounded to that context window; complete selected components in the Canvas fallback are not clipped into invented coastlines.
- The synthetic fixture shares the independent modern physical context but its authored places and polygons are invented, not claims about Europe.
- Point labels are inherited from the prepared, independent representative points and emitted once per entity. They are not recomputed from viewport-clipped tile fragments. Persistent entity colors are carried in tile `fill_color` properties and metadata.

## Tile encoding and delivery

The original source and Canvas fallback remain unsimplified. The display tiles use `geojson-vt 4.0.3`, `@maplibre/vt-pbf 4.3.2`, and the official `pmtiles 3.8.1` Python writer with deterministic gzip (`mtime=0`).

- PMTiles v3, MVT v2, zooms **0–7**, extent **4096**, buffer **64** tile-coordinate units, simplification tolerance **1.5** tile-coordinate units.
- `geojson-vt` simplifies only spatial representations below its maximum zoom; maximum zoom disables simplification before quantization. At the equator the low-zoom nominal tolerance is `40,075,016.7 × 1.5 / (4096 × 2^z)` metres in Mercator coordinates. It is a display tolerance, not an accuracy claim. Quantization remains at every zoom. No temporal smoothing or interpolation occurs.
- Full SHA-256 appears in archive filenames and manifests. **16 KiB** authenticated chunks permit cryptographic verification of byte ranges without downloading the whole archive. This is particularly important for the ~51/57 KiB multi-tile fixture archives.
- Per-epoch metadata carries canonical identity/area/hash indices, labels, entities and evidence. The streaming renderer needs no full territory GeoJSON. A separately hashed fallback supplies source vectors to Canvas.
- `geometry_hashes[entity_id + '|' + territory_state_id]` hashes `JSON.stringify` of that state's ordered original Polygon geometries. Per-component `geometry_hash` hashes its individual geometry. Compiler-produced population rows use those values in their complete lookup keys.

## Frozen resource accounting

`public/alpha/resource-budget.json` records the freeze and an explicit pre-tile revision restoring the existing worker limits: one sequential worker, 256 MiB V8 old-space, 60 seconds per epoch job, 1 GiB process RSS, 30 minutes aggregate wall time, 1 MiB per archive, and 128 MiB cumulative compressed artifacts. Existing usage **30,561,666 bytes** is charged before these outputs. Each completed build records its measured bytes, elapsed time, tile counts and peak RSS in `build-record.json`.

Compilation is bounded per epoch. The largest historical canonical index contains 18 polygon parts. Runtime population clipping is not part of this compiler's UI path; the separate population compiler reads these verified vectors and metadata once to write lookup sidecars.

## Reproduction

From `apps/explorer`, with the retained app dependencies and the pinned PMTiles Python environment:

```sh
python3 scripts/build-alpha-land.py
node --max-old-space-size=256 --import tsx scripts/build-alpha.mjs
```

The land script reads the retained ZIP, not a mutable network URL. `build-alpha.mjs` requires the pinned migration observation from the people workstream, verifies every historical prepared-feature SHA-256, writes one archive at a time, decodes all MVTs to verify stable identities, round-trips archive headers and a spatial tile, and stops on a budget violation. Run the people lookup compiler after this display compiler; it may add a hashed population descriptor to the manifests.

No hardware rendering result is inferred from the compiler. Physical Windows/ANGLE GPU acceptance remains a separately collected receipt.

# Meridian Isles synthetic temporal fixture

This fixture invents every territory, population value, and migration path.
It reads no accepted historical publication and writes no historical ledger.
Edition: `meridian-v2`; schema: `1`; initial day: `-354285` (1000-01-01 CE).

| Epoch | Valid days, half-open | Territories | Density cells | Migration features |
| --- | --- | ---: | ---: | ---: |
| `meridian-950` | `[-372547, -336023)`; 950–1050 CE | 5 parts, 3 entities | 6 | 1 |
| `meridian-1050` | `[-336023, -299499)`; 1050–1150 CE | 5 parts, 3 entities | 6 | 1 |

`meridian-v2.json` is the authored input. Every input record receives its parent
epoch's exact `t_start` and `t_end`; no event time is invented within an epoch.
The second epoch changes the borders abruptly at 1050 CE. Nothing is morphed,
smoothed, or interpolated between epochs.

## Identity and mapping

- Aster and Boreal each have one Polygon per epoch.
- Cedar has three separated Polygon features: `main`, `east`, and `north`.
  All three share `entity_id: synthetic:cedar` and the epoch's common
  `territory_state_id`. Each has a unique `render_id`. The main island contains
  approximately `[8, 35]`; the other two lie east of it. Clicking any part should
  select every active Cedar part.
- Polygon coordinate arrays map directly to GeoJSON Polygon geometry. The
  migration coordinate array maps directly to LineString geometry.
- Population cells retain their independent geometry across epochs. Their
  invented density values change, ranging from 12 to 360 people/km². These cells
  are not political ownership and are not derived from territory fills.
- Each epoch has one migration route, with magnitude 1,200 or 2,400 invented
  people across its entire interval. The vertices are authored, not a fitted or
  smoothed curve. Magnitude is not a yearly flow or an actual historical estimate.
- `render_id` remains a string property in MVT. Source bindings use
  `promoteId: "render_id"`; no numeric feature-ID hashing is introduced.

## Delivery and precision

The public manifest is `public/fixtures/manifest.json`. Its archive URLs resolve
relative to that manifest. Each PMTiles v3 archive contains one MVT v2 tile at
`[z, x, y] = [0, 0, 0]`, containing `territories`, `population`, and `migration`.
Archive metadata repeats the schema, synthetic designation, edition, epoch,
interval, named vector layers, coordinate encoding, and measurement units.

The encoder uses Web Mercator, extent 65,536, simplification tolerance 0, and
buffer 0. It retains each authored vertex, subject to ordinary vector-tile
integer-coordinate quantization. At z0 this is 360/65,536 degrees per longitude
unit (maximum longitude rounding error approximately 0.002747 degrees); latitude
rounding varies with Mercator latitude. Decoded tile coordinates therefore need
not exactly equal the authored decimal coordinates. This is encoding precision,
not historical border interpolation. No on-demand viewport tile pyramid or
large-corpus performance claim is made by these bounded fixture archives.

## Frozen resource bounds

The generator enforces 2 archives, 1 tile per archive, 12 features per archive,
and at most 1,000,000 archive bytes each. Archives are built sequentially.
The committed archives total fewer than 4 KB. `public/fixtures/build-record.json`
records actual bytes, SHA-256 values, input hash, counts, and pinned tools.
Generation fails rather than silently expanding these bounds.

## Rebuild

From `apps/explorer/`, with the app's pinned JavaScript dependencies installed:

```sh
python -m venv .sites-runtime/fixture-build/venv
mkdir -p .sites-runtime/fixture-build/tmp
TMPDIR="$PWD/.sites-runtime/fixture-build/tmp" PIP_CACHE_DIR="$PWD/.sites-runtime/fixture-build/pip-cache" .sites-runtime/fixture-build/venv/bin/python -m pip install --disable-pip-version-check pmtiles==3.8.1
node scripts/build-fixture.mjs
```

On systems whose virtualenv Python path differs, set `FIXTURE_PYTHON` to that
interpreter before the final command. The generator puts all intermediate MVT,
metadata, Python temporary files, and build artifacts inside `apps/explorer/`.

The upstream Python `pmtiles==3.8.1` writer creates the archive. JavaScript
`pmtiles==4.5.0` and `@mapbox/vector-tile==2.0.5` independently read it back and
check header version, tile count, layer counts, geometry types, identities,
numeric values, intervals, and extent. Repeating the generator reproduces archive
hashes: no generation timestamp or random identifier enters the output.

Upstream references:

- https://docs.protomaps.com/pmtiles/
- https://pmtiles.io/typedoc/classes/PMTiles.html
- https://github.com/protomaps/PMTiles/tree/main/python/pmtiles
- https://github.com/maplibre/vt-pbf

Original fixture data is authored for Chronicle Atlas. It includes no external
geographic basemap, demographic dataset, or historical source requiring separate
attribution. The generator's packages retain their own upstream licenses.

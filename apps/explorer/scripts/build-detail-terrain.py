"""Compile pinned Natural Earth physical context; no historical assertions.

Run under the aggregate lock:
  flock /tmp/chronicle-detail-compile.lock python3 scripts/build-detail-terrain.py
Requires Python, Pillow and numpy. Inputs/rights/budget must already be retained.
The source ZIP hashes are checked before any output is replaced.
"""
from pathlib import Path
import collections, gc, gzip, hashlib, json, math, platform, resource, struct, time, zipfile
import numpy as np
from PIL import Image, ImageDraw, __version__ as pillow_version, features as pillow_features

APP = Path(__file__).resolve().parents[1]
OUT = APP / 'public/detail'
SRC = OUT / 'terrain-source'
budget = json.loads((OUT / 'terrain-budget.json').read_text())
limits = budget['limits']
rights = json.loads((OUT / 'terrain-rights.json').read_text())
began = time.monotonic()
LAT_LIMIT = 85.0511287798066

def sha(data): return hashlib.sha256(data).hexdigest()
def write_json(path, value): path.write_text(json.dumps(value, separators=(',', ':'), ensure_ascii=False) + '\n')
def guard():
    assert resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024 <= limits['process_rss_bytes'], 'RSS budget exceeded'
    assert time.monotonic() - began < limits['worker_deadline_seconds'], 'Deadline exceeded'
for entry in rights['inputs']:
    data = (SRC / entry['file']).read_bytes()
    assert len(data) == entry['bytes'] and sha(data) == entry['sha256'], 'Pinned input changed: ' + entry['file']
for entry in rights['retained_land_mask_inputs']:
    data = (APP / entry['path']).read_bytes()
    assert len(data) == entry['bytes'] and sha(data) == entry['sha256'], 'Pinned physical mask input changed: ' + entry['path']
del data
assert sum(p.stat().st_size for p in SRC.iterdir()) <= limits['new_input_bytes']

def records(name):
    """Read only ESRI PolyLine/Polygon and DBF attributes; coordinates untouched."""
    with zipfile.ZipFile(SRC / (name + '.zip')) as archive:
        assert archive.read(name + '.VERSION.txt').decode().strip() == '5.0.0'
        dbf = archive.read(name + '.dbf')
        count = struct.unpack_from('<I', dbf, 4)[0]
        header, size = struct.unpack_from('<HH', dbf, 8)
        fields, offset = [], 1
        for pos in range(32, header - 1, 32):
            raw = dbf[pos:pos + 32]
            field, kind, length = raw[:11].split(b'\0')[0].decode(), chr(raw[11]), raw[16]
            fields.append((field, kind, length, offset)); offset += length
        with archive.open(name + '.shp') as stream:
            assert struct.unpack('>i', stream.read(100)[:4])[0] == 9994
            for index in range(count):
                number, length = struct.unpack('>ii', stream.read(8))
                raw = stream.read(length * 2)
                kind = struct.unpack_from('<i', raw)[0]
                assert kind in (3, 5)
                bounds = list(struct.unpack_from('<4d', raw, 4))
                n_parts, n_points = struct.unpack_from('<2i', raw, 36)
                starts = list(struct.unpack_from('<' + str(n_parts) + 'i', raw, 44)) + [n_points]
                coords = list(struct.iter_unpack('<2d', raw[44 + n_parts * 4:44 + n_parts * 4 + n_points * 16]))
                parts = [[list(p) for p in coords[a:b]] for a, b in zip(starts, starts[1:])]
                row = dbf[header + index * size:header + (index + 1) * size]
                assert row[:1] != b'*', 'Deleted record requires explicit handling'
                attrs = {f: row[o:o + length].decode('utf-8', errors='strict').replace('\0', '').strip() for f, typ, length, o in fields}
                yield number, kind, bounds, parts, attrs

def signed_area(ring): return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2
features, outcomes = [], []
for name, role in [('ne_10m_rivers_lake_centerlines', 'river'), ('ne_10m_lakes', 'lake')]:
    counts = collections.Counter()
    for number, shp_kind, bounds, parts, attrs in records(name):
        cls = attrs['featurecla']
        if cls in ('Canal', 'Reservoir'):
            counts['excluded_artificial'] += 1
            continue
        assert cls in ('River', 'River (Intermittent)', 'Lake Centerline', 'Lake', 'Alkaline Lake')
        if role == 'lake':
            polygons = []
            for ring in parts:
                assert len(ring) >= 4 and ring[0] == ring[-1], 'Invalid source lake ring'
                if signed_area(ring) < 0: polygons.append([ring])
                else:
                    assert polygons, 'Orphan interior lake ring'
                    polygons[-1].append(ring)
            geometry = {'type': 'MultiPolygon', 'coordinates': polygons}
        else:
            geometry = {'type': 'MultiLineString', 'coordinates': parts}
        minzoom = float(attrs['min_zoom'])
        counts['admitted'] += 1
        counts['vertices'] += sum(len(p) for p in parts)
        features.append({'type': 'Feature', 'id': f'{name}:{number}', 'bbox': bounds, 'properties': {
            'kind': role, 'class': cls, 'name': attrs.get('name_en') or attrs.get('name') or '',
            'minzoom': minzoom, 'minlabel': float(attrs.get('min_label') or minzoom + 1),
            'source_id': name, 'source_edition': '5.0.0', 'source_record': number,
            'meaning': 'modern-physical-context', 'temporal_claim': False}, 'geometry': geometry})
    outcomes.append({'source': name, **counts})
assert len(features) <= limits['vector_features']
raw_hydro = (json.dumps({'type': 'FeatureCollection', 'features': features}, separators=(',', ':'), ensure_ascii=False) + '\n').encode()
assert len(raw_hydro) <= limits['hydrography_decoded_bytes'], f'Hydrography decoded cap exceeded: {len(raw_hydro)}'
packed_hydro = gzip.compress(raw_hydro, compresslevel=9, mtime=0)
assert len(packed_hydro) <= limits['hydrography_gzip_bytes'], f'Hydrography gzip cap exceeded: {len(packed_hydro)}; decoded {len(raw_hydro)}'
(OUT / 'terrain-hydrography.geojson.gz').write_bytes(packed_hydro)
hydro = {'url': './terrain-hydrography.geojson.gz', 'compression': 'gzip', 'byte_length': len(packed_hydro), 'sha256': sha(packed_hydro), 'decoded_bytes': len(raw_hydro), 'decoded_sha256': sha(raw_hydro), 'features': len(features), 'outcomes': outcomes}
del raw_hydro, packed_hydro, features
gc.collect(); guard()

# Reproject the original grayscale relief. A global 50m land mask only changes
# tint; elevation/shadow texture always comes from the retained raster.
with zipfile.ZipFile(SRC / 'SR_50M.zip') as archive:
    assert archive.read('SR_50M.VERSION.txt').decode().strip() == '2.0.0'
    with archive.open('SR_50M.tif') as raster:
        original = Image.open(raster); original.load()
assert original.mode == 'L' and original.size == (10800, 5400)
max_size = limits['raster_tile_size'] * (2 ** limits['raster_maxzoom'])
mask = Image.new('L', (max_size, max_size), 0)
draw = ImageDraw.Draw(mask)
land_path = APP / 'public/integrated/global-land.geojson.json'
land_bytes = land_path.read_bytes()
land = json.loads(land_bytes)
def projected(point):
    lon, lat = point
    lat = max(-LAT_LIMIT, min(LAT_LIMIT, lat))
    return ((lon + 180) / 360 * max_size, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * max_size)
for feature in land['features']:
    geom = feature['geometry']
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    for poly in polys:
        draw.polygon([projected(p) for p in poly[0]], fill=255)
        for hole in poly[1:]: draw.polygon([projected(p) for p in hole], fill=0)
del land, draw
tiles, byte_total = [], 0
for z in range(limits['raster_maxzoom'] + 1):
    n = 2 ** z; size = n * limits['raster_tile_size']
    # Area downsampling at overview levels avoids point-sample aliasing.
    source_width = min(original.width, max(512, size))
    source_image = original.resize((source_width, source_width // 2), Image.Resampling.LANCZOS)
    source = np.asarray(source_image)
    level_mask = mask if size == max_size else mask.resize((size, size), Image.Resampling.LANCZOS)
    for y in range(n):
        global_y = y * 256 + np.arange(256, dtype=np.float64) + .5
        lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * global_y / size))))
        sy = np.clip((90 - lat) / 180 * source.shape[0] - .5, 0, source.shape[0] - 1)
        ya, yb = np.floor(sy).astype(np.int32), np.ceil(sy).astype(np.int32)
        wy = (sy - ya)[:, None]
        for x in range(n):
            sx = np.mod((x * 256 + np.arange(256, dtype=np.float64) + .5) / size * source_width - .5, source_width)
            xa, xb = np.floor(sx).astype(np.int32), (np.floor(sx).astype(np.int32) + 1) % source_width
            wx = (sx - xa)[None, :]
            a = source[ya[:, None], xa[None, :]] * (1 - wx) + source[ya[:, None], xb[None, :]] * wx
            b = source[yb[:, None], xa[None, :]] * (1 - wx) + source[yb[:, None], xb[None, :]] * wx
            shade = (a * (1 - wy) + b * wy - 204) * .68
            coverage = np.asarray(level_mask.crop((x * 256, y * 256, (x + 1) * 256, (y + 1) * 256)), dtype=np.float64) / 255
            rgb = np.empty((256, 256, 3), dtype=np.uint8)
            for c, (land_tint, water_tint) in enumerate(zip((222, 218, 194), (186, 207, 211))):
                rgb[:, :, c] = np.clip((land_tint + shade) * coverage + water_tint * (1 - coverage), 0, 255).astype(np.uint8)
            folder = OUT / 'terrain/tiles' / str(z) / str(x); folder.mkdir(parents=True, exist_ok=True)
            path = folder / f'{y}.jpg'
            Image.fromarray(rgb).save(path, format='JPEG', quality=86, optimize=False, progressive=False, subsampling=0)
            raw = path.read_bytes(); assert len(raw) <= limits['raster_tile_bytes']
            tiles.append({'z': z, 'x': x, 'y': y, 'bytes': len(raw), 'sha256': sha(raw)})
            byte_total += len(raw)
        guard()
    source_image.close()
    if level_mask is not mask: level_mask.close()
    print(json.dumps({'zoom': z, 'tiles_so_far': len(tiles), 'bytes_so_far': byte_total}), flush=True)
    guard()
mask.close(); original.close()
assert len(tiles) == limits['raster_tile_count']
index = {'schema_version': 1, 'tiles': tiles}
write_json(OUT / 'terrain-tile-index.json', index)
descriptor = {'schema_version': 1, 'id': 'natural-earth-offline-physical-v1', 'meaning': 'modern-physical-context',
    'title': 'Relief, rivers and natural lakes', 'attribution': rights['attribution'], 'rights': './terrain-rights.json',
    'temporal_policy': rights['temporal_interpretation'],
    'raster': {'tiles': ['./terrain/tiles/{z}/{x}/{y}.jpg'], 'tile_size': 256, 'minzoom': 0, 'maxzoom': 5, 'bounds': [-180, -LAT_LIMIT, 180, LAT_LIMIT], 'scheme': 'xyz', 'projection': 'EPSG:3857', 'format': 'jpeg', 'tile_count': len(tiles), 'byte_length': byte_total, 'hash_index': './terrain-tile-index.json'},
    'hydrography': hydro,
    'display_method': 'Global grayscale SRTM Plus-derived relief, bilinear Mercator reprojection with area downsampling; independent Natural Earth50m physical-land tint mask. Warm land and blue water are display colors, not elevation bands. JPEG tiles are cartographic textures, not elevation values.',
    'source_resolution': {'width': 10800, 'height': 5400, 'scale': '1:50 million relief;1:10 million hydrography', 'limit': 'Regional reference geography; no street-scale or parcel detail.'},
    'mask': {'url': '../integrated/global-land.geojson.json', 'sha256': sha(land_bytes), 'edition': 'Natural Earth50m land4.1.0', 'purpose': 'Display tint only'}}
write_json(OUT / 'terrain.json', descriptor)
product_paths = [OUT / 'terrain.json', OUT / 'terrain-tile-index.json', OUT / 'terrain-hydrography.geojson.gz', *sorted((OUT / 'terrain/tiles').rglob('*.jpg'))]
product_bytes = sum(p.stat().st_size for p in product_paths)
assert product_bytes <= limits['output_bytes'], f'Product cap exceeded: {product_bytes}'
report = {'schema_version': 1, 'status': 'compiled', 'budget_id': budget['budget_id'], 'compiler': {'script_sha256': sha(Path(__file__).read_bytes()), 'python': platform.python_version(), 'pillow': pillow_version, 'numpy': np.__version__, 'jpeg_codec': pillow_features.version('jpg')}, 'input_bytes': sum(p.stat().st_size for p in SRC.iterdir()), 'output_bytes': product_bytes, 'tile_count': len(tiles), 'max_tile_bytes': max(t['bytes'] for t in tiles), 'hydrography': hydro, 'elapsed_ms': round((time.monotonic() - began) * 1000, 3), 'peak_rss_bytes': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024, 'source_mask_sha256': sha(land_bytes), 'historical_assertions_added': 0, 'ledger_modified': False}
write_json(OUT / 'terrain-build-record.json', report)
print(json.dumps(report), flush=True)

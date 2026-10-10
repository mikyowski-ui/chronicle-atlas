"""Compile all retained Natural Earth components into bounded neutral context.

No source geometry simplification. Deterministic groups keep the existing feature
cap; latitude clamping is a Web Mercator presentation limit, not a shoreline fact.
"""
import hashlib, json, pathlib, struct, time, zipfile

app = pathlib.Path(__file__).resolve().parents[1]
out = app / 'public/integrated'
budget = json.loads((out / 'resource-budget.json').read_text())
inventory = json.loads((out / 'source-inventory.json').read_text())
source = app / 'public/alpha/source/ne_50m_land.zip'
assert hashlib.sha256(source.read_bytes()).hexdigest() == inventory['physical_source']['input_sha256']
began = time.monotonic()
archive = zipfile.ZipFile(source)
assert archive.read('ne_50m_land.VERSION.txt').decode().strip() == '4.1.0'
limit = 85.05112878
polygons, ids = [], []
records = vertices = clamped = 0

def signed_area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2

with archive.open('ne_50m_land.shp') as fh:
    assert struct.unpack('>i', fh.read(100)[:4])[0] == 9994
    while raw := fh.read(8):
        number, length = struct.unpack('>ii', raw)
        data = fh.read(length * 2)
        records += 1
        kind = struct.unpack_from('<i', data)[0]
        if kind == 0:
            continue
        assert kind == 5
        count, points = struct.unpack_from('<2i', data, 36)
        offsets = list(struct.unpack_from('<' + str(count) + 'i', data, 44)) + [points]
        coordinates = list(struct.iter_unpack('<2d', data[44 + 4 * count:]))
        component = -1
        for start, end in zip(offsets, offsets[1:]):
            original = [list(p) for p in coordinates[start:end]]
            ring = [[p[0], max(-limit, min(limit, p[1]))] for p in original]
            vertices += len(ring)
            clamped += sum(p[1] != q[1] for p, q in zip(original, ring))
            if signed_area(original) < 0:
                component += 1
                polygons.append([ring])
                ids.append(f'natural-earth:4.1.0:{number}:{component}')
            else:
                assert component >= 0, 'Orphan interior ring'
                polygons[-1].append(ring)
        assert (time.monotonic() - began) * 1000 < budget['limits']['worker_deadline_ms']

features = []
for start in range(0, len(polygons), 10):
    features.append({'type': 'Feature', 'properties': {
        'render_id': f'natural-earth:4.1.0:group:{start // 10}',
        'source_edition': 'Natural Earth 50m land 4.1.0',
        'role': 'physical-context', 'component_ids': '|'.join(ids[start:start + 10])
    }, 'geometry': {'type': 'MultiPolygon', 'coordinates': polygons[start:start + 10]}})

assert len(features) <= budget['limits']['parts_per_scene']
assert vertices <= budget['limits']['vertices_per_physical_scene']
raw = (json.dumps({'type': 'FeatureCollection', 'features': features}, separators=(',', ':')) + '\n').encode()
assert len(raw) <= budget['limits']['fallback_bytes']
(out / 'global-land.geojson.json').write_bytes(raw)
report = {'source_records': records, 'source_components': len(polygons), 'grouped_features': len(features),
          'vertices': vertices, 'latitude_clamped_vertices': clamped, 'omitted_components': 0,
          'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
          'elapsed_ms': (time.monotonic() - began) * 1000,
          'method': 'All source rings retained. Group every10consecutive components into MultiPolygon; clamp only latitude beyond WebMercator limit; no simplification.'}
(out / 'land-build-record.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))

#!/usr/bin/env python3
"""Build bounded settlement detail from retained, pinned GIS sources.

Run under the aggregate detail compile lock. No network or ledger writes.
Pleiades chronology is a source-location relevance envelope, never proof of
continuous occupation. Natural Earth names are modern orientation only.
"""
from __future__ import annotations
import argparse
import collections
import csv
import hashlib
import html
import io
import json
import math
import pathlib
import re
import resource
import shutil
import struct
import time
import zipfile

APP = pathlib.Path(__file__).resolve().parents[1]
ROOT = APP.parents[1]
OUT = APP / 'public/detail'
SOURCES = OUT / 'source'
PLEIADES = ROOT / 'data/beta/pleiades'
RELEASE = '4.1'
PIN = 'b6a6790f71c45e4a4ef60fce296c506f28f458bf'
NE_SHA = 'cd149186f03d2603e0410da399b980a4357d0ac32d3a2305a49ed3dffcc41d7b'
CSV_NAMES = ['places.csv', 'places_place_types.csv', 'location_points.csv', 'place_types.csv', 'time_periods.csv']
KEEP_TYPES = {'settlement', 'fortified-settlement', 'urban', 'polis', 'vicus', 'city-center'}
REJECT_TYPES = {'unlocated', 'unlocated-group', 'false', 'false toponym'}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_json(path: pathlib.Path, value, pretty=False):
    text = json.dumps(value, ensure_ascii=False, indent=2 if pretty else None,
                      separators=None if pretty else (',', ':'), allow_nan=False) + '\n'
    path.write_text(text, encoding='utf8')
    return {'path': str(path.relative_to(OUT)), 'bytes': len(text.encode()), 'sha256': sha(text.encode())}


def clean(text, limit=300):
    return re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', ' ', text or ''))).strip()[:limit]


def input_bytes(name):
    retained = PLEIADES / 'sources' / name
    if retained.exists():
        return retained.read_bytes()
    # The application source packet is self-contained; root retained data is
    # preferred in the original repository, never required for reproduction.
    with zipfile.ZipFile(SOURCES / 'pleiades-4.1-gis.zip') as z:
        return z.read(name)


def read_rows(name):
    yield from csv.DictReader(io.StringIO(input_bytes(name).decode('utf-8-sig'), newline=''))


def astro(year):
    # Pleiades source uses historical numbering (no year zero).
    return year + 1 if year < 0 else year


def source_record(path, url, **extra):
    data = path.read_bytes()
    return {'path': str(path.relative_to(APP)), 'url': url, 'bytes': len(data), 'sha256': sha(data), **extra}


def bounded_pleiades(budget):
    manifest_path = PLEIADES / 'pleiades-source-manifest.json'
    if not manifest_path.exists():
        manifest_path = SOURCES / 'pleiades-4.1-source-manifest.json'
    manifest = json.loads(manifest_path.read_text())
    assert manifest['edition'] == RELEASE and manifest['commit'] == PIN
    expected = {r['path']: r for r in manifest['files']}
    raw_total = 0
    files = []
    verified_bytes = {}
    for name in CSV_NAMES + ['LICENSE', 'README.md', 'gis-README.md']:
        b = input_bytes(name)
        entry = expected['sources/' + name]
        assert len(b) == entry['bytes'] and sha(b) == entry['sha256'], name
        raw_total += len(b)
        verified_bytes[name] = b
        files.append({'name': name, 'bytes': len(b), 'sha256': sha(b), 'url': entry['url']})
    assert raw_total <= budget['retainedInputBytes']
    write_json(SOURCES / 'pleiades-4.1-source-manifest.json', {
        'edition': RELEASE, 'editionDate': '2025-05-28', 'commit': PIN,
        'license': 'CC-BY-3.0',
        'files': [expected['sources/' + entry['name']] for entry in files],
        'note': 'Exact relevant input entries retained from the earlier source manifest; unrelated 140-place sample JSON files are not inputs to this expanded GIS compiler.',
    }, pretty=True)

    # Retain exact original bytes once in a deterministic, modest archive.
    with zipfile.ZipFile(SOURCES / 'pleiades-4.1-gis.zip', 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for entry in files:
            info = zipfile.ZipInfo(entry['name'], (2025, 5, 28, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, verified_bytes[entry['name']])
    (SOURCES / 'pleiades-4.1-LICENSE.txt').write_bytes(verified_bytes['LICENSE'])
    (SOURCES / 'pleiades-4.1-gis-README.md').write_bytes(verified_bytes['gis-README.md'])
    del verified_bytes

    types = collections.defaultdict(set)
    for row in read_rows('places_place_types.csv'):
        types[row['place_id']].add(row['place_type'])
    places = {}
    excluded = collections.Counter()
    review = []
    all_places = 0
    for row in read_rows('places.csv'):
        all_places += 1
        ptypes = types[row['id']]
        if not ptypes & KEEP_TYPES:
            excluded['not_settlement_type'] += 1
            continue
        if ptypes & REJECT_TYPES or '?' in row['title'] or row['location_precision'] == 'unlocated':
            excluded['uncertain_or_unlocated_identity'] += 1
            review.append({'id': row['id'], 'title': row['title'], 'reason': 'uncertain_or_unlocated_identity'})
            continue
        places[row['id']] = row
    eligible = collections.defaultdict(list)
    point_exclusions = collections.Counter()
    source_points = 0
    for row in read_rows('location_points.csv'):
        source_points += 1
        if row['place_id'] not in places:
            point_exclusions['outside_selected_places'] += 1
            continue
        if row['association_certainty'] != 'certain' or row['location_precision'] != 'precise':
            point_exclusions['uncertain_or_imprecise_point'] += 1
            continue
        try:
            radius = float(row['accuracy_radius'])
            start = int(row['year_after_which'])
            end = int(row['year_before_which'])
            assert math.isfinite(radius) and 0 <= radius <= 2000
        except (ValueError, AssertionError):
            point_exclusions['missing_or_unacceptable_accuracy_or_dates'] += 1
            continue
        if start == 0 or end == 0 or start > end:
            point_exclusions['invalid_source_year_bounds'] += 1
            continue
        if astro(end) < budget['temporalScopeAstronomicalYears'][0] or astro(start) > budget['temporalScopeAstronomicalYears'][1]:
            point_exclusions['outside_temporal_scope'] += 1
            continue
        m = re.fullmatch(r'POINT\s*\(\s*([-\d.eE+]+)\s+([-\d.eE+]+)\s*\)', row['geometry_wkt'])
        if not m:
            point_exclusions['invalid_point'] += 1
            continue
        lon, lat = map(float, m.groups())
        if not math.isfinite(lon) or not math.isfinite(lat) or not -180 <= lon <= 180 or not -85.051129 <= lat <= 85.051129:
            point_exclusions['invalid_or_outside_display_point'] += 1
            continue
        eligible[row['place_id']].append((radius, row['uri'], row, [lon, lat], start, end))
    result = []
    for pid, place in sorted(places.items()):
        options = sorted(eligible[pid], key=lambda item: (item[0], item[1]))
        if not options:
            excluded['no_eligible_direct_point'] += 1
            review.append({'id': pid, 'title': place['title'], 'reason': 'no_eligible_direct_point'})
            continue
        radius, uri, location, coords, start, end = options[0]
        result.append({
            'id': 'pleiades:' + pid, 'title': clean(place['title'], 160), 'coordinates': coords,
            'sourceId': 'pleiades-4.1', 'sourceUrl': place['uri'], 'locationUrl': uri,
            'placeTypes': sorted(types[pid]), 'description': clean(place['description']),
            'validFromYear': astro(start), 'validToYear': astro(end),
            'sourceStartYear': start, 'sourceEndYear': end,
            'accuracyMeters': radius, 'rank': 6, 'temporalMode': 'source-envelope',
        })
    assert len(result) <= budget['maxPleiadesPlaces']
    assert len(result) + sum(excluded.values()) == all_places
    assert sum(point_exclusions.values()) + sum(len(x) for x in eligible.values()) == source_points
    outcomes = {
        'sourcePlaceRows': all_places, 'sourcePointRows': source_points,
        'admittedPlaces': len(result), 'placeExclusions': dict(sorted(excluded.items())),
        'pointExclusions': dict(sorted(point_exclusions.items())),
        'eligiblePointRows': sum(len(x) for x in eligible.values()),
        'unselectedAlternativePointRows': sum(max(0, len(x)-1) for x in eligible.values()),
        'reviewQueueCount': len(review),
        'selectionRule': 'Settlement-tagged place; certain identity; one precise, certain direct point with reported accuracy <=2000 m. Select minimum accuracy radius then source URI, retaining only that location chronology. No importance/population rank inferred.',
        'sourceFiles': files,
    }
    write_json(OUT / 'places-review-queue.json', {'sourceId': 'pleiades-4.1', 'records': review})
    return result, outcomes


def dbf_records(data):
    count = struct.unpack_from('<I', data, 4)[0]
    header_len, record_len = struct.unpack_from('<HH', data, 8)
    fields = []
    offset = 1
    for pos in range(32, header_len-1, 32):
        name = data[pos:pos+11].split(b'\0')[0].decode('ascii')
        length = data[pos+16]
        fields.append((name, offset, length))
        offset += length
    assert offset == record_len
    for index in range(count):
        start = header_len + index * record_len
        row = data[start:start+record_len]
        assert len(row) == record_len and row[:1] != b'*'
        yield {name: row[off:off+length].decode('utf8').strip() for name, off, length in fields}


def shape_points(data):
    assert struct.unpack_from('>I', data)[0] == 9994
    assert struct.unpack_from('<I', data, 32)[0] == 1
    pos = 100
    while pos < len(data):
        _, words = struct.unpack_from('>II', data, pos)
        body = data[pos+8:pos+8+words*2]
        assert struct.unpack_from('<I', body)[0] == 1 and len(body) == 20
        yield list(struct.unpack_from('<dd', body, 4))
        pos += 8+words*2
    assert pos == len(data)


def bounded_modern(budget):
    archive = SOURCES / 'ne_10m_populated_places.zip'
    data = archive.read_bytes()
    assert len(data) <= budget['externalArchiveBytes'] and sha(data) == NE_SHA
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        assert z.read('ne_10m_populated_places.VERSION.txt').decode().strip() == '5.1.2'
        rows = list(dbf_records(z.read('ne_10m_populated_places.dbf')))
        points = list(shape_points(z.read('ne_10m_populated_places.shp')))
        assert len(rows) == len(points) <= budget['maxModernPlaces']
        (SOURCES / 'ne_10m_populated_places.README.html').write_bytes(z.read('ne_10m_populated_places.README.html'))
        (SOURCES / 'ne_10m_populated_places.VERSION.txt').write_bytes(z.read('ne_10m_populated_places.VERSION.txt'))
    result = []
    excluded = []
    for row, point in zip(rows, points):
        assert all(math.isfinite(n) for n in point) and -180 <= point[0] <= 180 and -90 <= point[1] <= 90
        if abs(point[1]) > 85.051129:
            excluded.append({'id': 'ne:' + row['NE_ID'], 'title': row['NAME'], 'coordinates': point, 'reason': 'outside_web_mercator_display_limit'})
            continue
        result.append({
            'id': 'ne:' + row['NE_ID'], 'title': row['NAME'], 'coordinates': point,
            'sourceId': 'natural-earth-places-5.1.2',
            'sourceUrl': 'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/',
            'placeTypes': ['modern-populated-place'], 'validFromYear': None, 'validToYear': None,
            'sourceStartYear': None, 'sourceEndYear': None, 'accuracyMeters': None,
            'rank': int(row['SCALERANK']), 'minZoom': float(row['MIN_ZOOM']),
            'temporalMode': 'modern-context',
        })
    assert len({p['id'] for p in result}) == len(result)
    return sorted(result, key=lambda p: p['id']), {'sourceRows': len(rows), 'admittedPlaces': len(result), 'excluded': len(excluded), 'exclusionRecords': excluded}


def main():
    started = time.monotonic()
    budget = json.loads((OUT / 'places-budget.json').read_text())
    assert budget['frozenBeforeExecution'] and budget['workerCount'] == 1
    SOURCES.mkdir(parents=True, exist_ok=True)
    # Rights record precedes normalization and is separate from historical publication.
    rights = {
        'schemaVersion': 1, 'historicalPublicationApproved': False,
        'sources': [
            {'id': 'pleiades-4.1', 'title': 'Pleiades Datasets 4.1', 'edition': RELEASE,
             'editionDate': '2025-05-28', 'commit': PIN, 'license': 'CC-BY-3.0',
             'licenseUrl': 'https://creativecommons.org/licenses/by/3.0/',
             'url': 'https://pleiades.stoa.org/downloads',
             'attribution': 'Pleiades contributors; Ancient World Mapping Center and Institute for the Study of the Ancient World. Pleiades Datasets 4.1 (28 May 2025). Each point links to its place and selected location; original provenance remains in the retained exact GIS CSVs.',
             'changes': 'Filter settlement types, certain identity and precise direct points; select one location; convert no-year-zero source years; compact browser fields. No source geometry edits or ownership assertions.',
             'licenseRecord': './source/pleiades-4.1-LICENSE.txt'},
            {'id': 'natural-earth-places-5.1.2', 'title': 'Natural Earth 1:10m Populated Places',
             'edition': '5.1.2', 'license': 'public-domain',
             'licenseUrl': 'https://www.naturalearthdata.com/about/terms-of-use/',
             'url': 'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/',
             'attribution': 'Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com.',
             'inputUrl': 'https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_populated_places.zip',
             'inputSha256': NE_SHA,
             'changes': 'Direct point geometry and names retained, browser attributes selected. Modern orientation context only; no historical city names, existence dates or population inferred.',
             'licenseRecord': './source/natural-earth-terms.html'},
        ],
    }
    retained_terms = APP / 'public/alpha/source/natural-earth-terms.html'
    if retained_terms.exists():
        shutil.copyfile(retained_terms, SOURCES / 'natural-earth-terms.html')
    assert (SOURCES / 'natural-earth-terms.html').exists()
    write_json(OUT / 'places-rights.json', rights, pretty=True)
    ancient, ancient_outcomes = bounded_pleiades(budget)
    modern, modern_outcomes = bounded_modern(budget)
    payload = {
        'schemaVersion': 1, 'id': 'chronicle-detail-places-v1',
        'status': 'staged-source-attributed-gazetteer',
        'yearNumbering': 'astronomical (0 = 1 BCE); sourceStartYear/sourceEndYear retain original Pleiades historical numbering without year zero',
        'temporalPolicy': 'Ancient markers show possible relevance within the selected source location year envelope. This is approximate period relevance, not proof of continuous occupation. Modern context markers have no historical validity; show only when explicitly enabled and label as modern orientation.',
        'spatialPolicy': 'Point locations only; neither territorial extent, city size nor population. Ancient point accuracy is source reported. Natural Earth is generalized 1:10m cartography, not street-level data.',
        'selectionPolicy': ancient_outcomes['selectionRule'],
        'sources': rights['sources'], 'counts': {'ancient': len(ancient), 'modern': len(modern)},
        'places': ancient + modern,
    }
    product = write_json(OUT / 'places.json', payload)
    assert product['bytes'] <= budget['browserOutputBytes'], product['bytes']
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
    assert rss <= budget['maxRssBytes'], rss
    counts = {str(y): sum(p['validFromYear'] <= y <= p['validToYear'] for p in ancient)
              for y in [-2999, -1999, -999, -199, 0, 100, 500, 1000, 1500, 1600, 1900, 2010]}
    receipt = {
        'schemaVersion': 1, 'status': 'PASS', 'budgetId': budget['budgetId'],
        'budgetSha256': sha((OUT / 'places-budget.json').read_bytes()),
        'output': product, 'pleiades': ancient_outcomes, 'modern': modern_outcomes,
        'ancientRelevanceCountsByAstronomicalYear': counts,
        'measuredElapsedSeconds': round(time.monotonic()-started, 3), 'measuredPeakRssBytes': rss,
        'rawInputsRetained': [source_record(SOURCES / 'pleiades-4.1-gis.zip', 'https://github.com/isawnyu/pleiades.datasets/releases/tag/v4.1'),
                              source_record(SOURCES / 'ne_10m_populated_places.zip', rights['sources'][1]['inputUrl'])],
        'checks': ['Pinned source hashes and byte counts verified before normalization',
                   'All Pleiades place rows and point rows have one accounting outcome',
                   'One source point per admitted Pleiades place; no coordinate simplification',
                   'Modern records have null historical validity and distinct temporalMode',
                   'No ancient population or territorial ownership generated',
                   'Frozen worker, RSS, source, archive, output and feature limits satisfied'],
        'browserInteractions': 'NOT RUN by data compiler', 'historicalPublicationApproved': False,
    }
    write_json(OUT / 'places-receipt.json', receipt, pretty=True)
    print(json.dumps({'output': product, 'counts': payload['counts'], 'time': receipt['measuredElapsedSeconds'], 'rss': rss}))


if __name__ == '__main__':
    main()

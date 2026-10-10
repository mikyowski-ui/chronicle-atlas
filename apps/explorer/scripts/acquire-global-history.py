#!/usr/bin/env python3
"""Recover the authorized 40 exact Historical Basemaps inputs, one file at a time.

The root data tree is read-only. Retained Git tree identities are checked before
copying or downloading, and every file keeps its original bytes and properties.
No branches/latest URLs, retries against alternate hosts, or implicit extension.
"""
import argparse
import collections
import hashlib
import json
import pathlib
import resource
import signal
import time
import urllib.request

APP = pathlib.Path(__file__).resolve().parents[1]
REPO = APP.parents[1]
RETAINED = REPO / 'data/beta/basemaps'
OUT = APP / 'public/global-history/source'
RECEIPTS = APP / 'verification/global-history/intake'
REV = 'da7a4b735ecef70aebdc9c73e409d8a2500d50f3'
BASE = f'https://raw.githubusercontent.com/aourednik/historical-basemaps/{REV}/'
YEARS = [-200, -100, -1, 100, 200, 300, 400, 500, 600, 700, 800, 900,
         1000, 1100, 1200, 1279, 1300, 1400, 1492, 1500, 1530, 1600, 1650,
         1700, 1715, 1783, 1800, 1815, 1878, 1880, 1900, 1914, 1920,
         1930, 1938, 1945, 1960, 1994, 2000, 2010]
OPTIONAL_YEARS = [-3000, -2000, -1500, -1000, -700, -500, -400, -323, -300]
BUDGET = {
    'id': 'global-history-primary-intake-v1',
    'scope': '40 full pinned observations, 200 BCE through 2010 CE',
    'frozen_before_execution': True,
    'download_workers': 1, 'processing_workers': 1,
    'max_files': 40, 'max_raw_bytes_per_file': 16 * 1024 * 1024,
    'max_total_source_bytes': 256 * 1024 * 1024,
    'download_deadline_seconds_per_file': 60,
    'optional_nine_earlier_files': 'NOT AUTHORIZED FOR THIS BATCH',
    'policy_revision': 'Explicit bounded collection replaces prior 31-file/60 MiB pilot; originals, metadata and browser live memory are separate resource classes.',
    'retry_policy': 'No alternate hosts or unpinned substitutions; failures recorded per file.',
}


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def git_blob(b):
    return hashlib.sha1(b'blob ' + str(len(b)).encode() + b'\0' + b).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def write_compiler_inputs(manifest):
    """A small stable compiler contract, relative to the Explorer app root."""
    write_json(OUT / 'input-manifest.json', {
        'schema_version': 1, 'source_id': manifest['source_id'], 'pinned_revision': REV,
        'inventory': 'public/global-history/source/target-snapshots.json',
        'observations': [{
            'observation_id': row['filename'].removesuffix('.geojson'),
            'year': row['source_year'], 'astronomical_year': row['astronomical_year'],
            'source_filename': row['filename'],
            'path': 'public/global-history/source/' + row['path'],
            'sha256': row.get('sha256'), 'byte_length': row.get('bytes'),
            'precision': row['precision'], 'source_date': row['source_date'],
            'source_revision': REV, 'git_blob_sha1': row['git_blob_sha1'],
            'status': row['status'],
            'batch': row.get('batch', 'primary40'),
        } for row in manifest['snapshots']]
    })


def write_grouped_labels(observations):
    groups = {}
    for obs in observations:
        for label, count in obs['labels'].items():
            key = label.strip()
            row = groups.setdefault(key, {'label': key, 'raw_labels': set(), 'source_features': 0, 'observations': []})
            row['raw_labels'].add(label)
            row['source_features'] += count
            row['observations'].append({'filename': obs['filename'], 'source_year': obs['source_year'], 'features': count})
    for row in groups.values(): row['raw_labels'] = sorted(row['raw_labels'])
    write_json(OUT / 'labels-grouped.json', {'source_revision': REV, 'distinct_trimmed_labels': len(groups),
                                           'labels': sorted(groups.values(), key=lambda row: row['label'])})


def deadline(_signum, _frame):
    raise TimeoutError('Frozen 60-second file deadline reached')


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Chronicle-Atlas-bounded-source-intake/1'})
    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(BUDGET['download_deadline_seconds_per_file'])
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return response.read(BUDGET['max_raw_bytes_per_file'] + 1)
    finally:
        signal.alarm(0)


def geometry_counts(features):
    types = collections.Counter()
    polygons = rings = vertices = 0
    bbox = [180., 90., -180., -90.]
    def inspect(g):
        nonlocal polygons, rings, vertices
        if not g:
            types['null'] += 1
            return
        typ = g.get('type', 'missing')
        types[typ] += 1
        if typ == 'GeometryCollection':
            for child in g.get('geometries', []): inspect(child)
            return
        coords = g.get('coordinates', [])
        polys = [coords] if typ == 'Polygon' else coords if typ == 'MultiPolygon' else []
        for poly in polys:
            polygons += 1
            rings += len(poly)
            for ring in poly:
                vertices += len(ring)
                for point in ring:
                    if len(point) >= 2:
                        x, y = point[:2]
                        bbox[0] = min(bbox[0], x); bbox[1] = min(bbox[1], y)
                        bbox[2] = max(bbox[2], x); bbox[3] = max(bbox[3], y)
    for f in features: inspect(f.get('geometry'))
    return {'geometry_types': dict(sorted(types.items())), 'polygon_parts': polygons,
            'rings': rings, 'coordinate_vertices': vertices, 'raw_bounds': bbox}


def main():
    existing = OUT / 'target-snapshots.json'
    if existing.exists() and len(json.loads(existing.read_text())['snapshots']) > 40:
        raise RuntimeError('Expanded inventory exists; use --optional-earlier to resume without replacing its scope')
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'input').mkdir(exist_ok=True)
    RECEIPTS.mkdir(parents=True, exist_ok=True)
    budget_path = RECEIPTS / 'frozen-resource-budget.json'
    if budget_path.exists():
        if json.loads(budget_path.read_text()) != BUDGET:
            raise RuntimeError('Existing frozen budget differs; refusing silent policy revision')
    else:
        write_json(budget_path, BUDGET)
    budget_sha = sha256(budget_path.read_bytes())
    tree_raw = (RETAINED / 'git-tree.json').read_bytes()
    tree = json.loads(tree_raw)
    if tree['sha'] != REV or tree.get('truncated'):
        raise RuntimeError('Pinned complete Git tree required')
    nodes = {r['path']: r for r in tree['tree']}
    legacy_registry = json.loads((RETAINED / 'asset-checksums.json').read_text())
    if sha256(tree_raw) != legacy_registry['git-tree.json']:
        raise RuntimeError('Retained Git tree does not match retained checksum registry')
    metadata = []
    used = 0
    for name in ['git-tree.json', 'index.json', 'README.md', 'LICENSE', 'CONTRIBUTING.md', 'rights-record.json']:
        b = (RETAINED / name).read_bytes()
        if name in nodes and (git_blob(b) != nodes[name]['sha'] or len(b) != nodes[name]['size']):
            raise RuntimeError(f'Pinned metadata identity mismatch: {name}')
        if name in ['git-tree.json', 'rights-record.json'] and sha256(b) != legacy_registry[name]:
            raise RuntimeError(f'Retained metadata identity mismatch: {name}')
        dest_name = 'pilot-rights-record.json' if name == 'rights-record.json' else name
        (OUT / dest_name).write_bytes(b)
        metadata.append({'path': dest_name, 'sha256': sha256(b), 'bytes': len(b),
                         'git_blob_sha1': git_blob(b) if name in nodes else None,
                         'source_url': BASE + name if name in nodes else None,
                         'recovery': 'retained pinned source metadata; original bytes'})
        used += len(b)
    idx = json.loads((OUT / 'index.json').read_text())
    index = {r['year']: r for r in idx['years']}
    snapshots = []
    for year in YEARS:
        indexed = index[year]
        filename = indexed['filename']
        source_path = 'geojson/' + filename
        node = nodes[source_path]
        astronomical = year + 1 if year < 0 else year
        date = f'{astronomical:04d}-01-01' if astronomical >= 0 else '-' + f'{abs(astronomical):04d}-01-01'
        snapshots.append({'filename': filename, 'source_year': year,
                          'astronomical_year': astronomical, 'source_date': date,
                          'source_date_label': f'{abs(year)} BCE' if year < 0 else f'{year} CE',
                          'precision': 'year', 'source_path': source_path,
                          'path': 'input/' + filename, 'source_url': BASE + source_path,
                          'expected_bytes': node['size'], 'git_blob_sha1': node['sha'],
                          'indexed_label_count': len(indexed.get('countries', [])),
                          'status': 'PENDING'})
    if len(snapshots) != BUDGET['max_files'] or len({r['filename'] for r in snapshots}) != len(snapshots):
        raise RuntimeError('Target collection mismatch')
    manifest = {'schema_version': 1, 'source_id': 'ourednik-basemaps', 'pinned_revision': REV,
                'source_index_sha256': sha256((OUT / 'index.json').read_bytes()),
                'source_tree_sha256': sha256(tree_raw), 'budget_sha256': budget_sha,
                'source_rights': 'rights-record.json', 'metadata': metadata, 'snapshots': snapshots}
    rights = {'source_id': 'ourednik-basemaps', 'pinned_revision': REV, 'license': 'GPL-3.0',
              'attribution': 'André Ourednik and Historical Basemaps contributors',
              'original_pilot_record': 'pilot-rights-record.json',
              'scope_amendment': 'User authorizes bounded staged expansion to the 40 indexed source observations from 200 BCE through 2010 CE. This does not rewrite the earlier pilot authorization.',
              'license_record': next(x for x in metadata if x['path'] == 'LICENSE'),
              'attribution_and_limitations_record': next(x for x in metadata if x['path'] == 'README.md'),
              'historical_status': 'Source-attributed overview reconstruction; not independently corroborated or historically certified.',
              'publication_boundary': 'Candidate Explorer display only. Public ledger unchanged; publication requires exact-result approval.',
              'modification_notice': 'Original coordinates and properties retained byte-for-byte. Classification and display geometry are separate versioned derivatives.',
              'temporal_interpretation': 'Indexed snapshot year is a nominal observation with year precision. BCE converts to astronomical numbering (1 BCE = 0). Calendar-year envelopes do not imply event-day precision, continuous borders, or independently reviewed validity.',
              'semantic_limits': ['Cultural distributions are not political ownership.', 'Population/aggregate labels do not establish sovereignty.', 'No invented corroboration, source precision, or intervening borders.', 'Explicit source quarantine remains protected.', '2010 is not present-day geography.']}
    write_json(OUT / 'rights-record.json', rights)
    write_json(OUT / 'target-snapshots.json', manifest)
    labels_by_observation = []
    started = time.monotonic()
    for row in snapshots:
        begin = time.monotonic()
        path = OUT / row['path']
        retained = RETAINED / row['path']
        try:
            if path.exists():
                b = path.read_bytes(); recovery = 'previously recovered exact pinned bytes'
            elif retained.exists():
                b = retained.read_bytes(); recovery = 'retained full original, not regional clip'
            else:
                b = fetch(row['source_url']); recovery = 'direct pinned upstream URL'
            if len(b) > BUDGET['max_raw_bytes_per_file']:
                raise RuntimeError('Frozen per-file byte cap exceeded')
            if used + len(b) > BUDGET['max_total_source_bytes']:
                raise RuntimeError('Frozen aggregate source byte cap exceeded')
            if len(b) != row['expected_bytes'] or git_blob(b) != row['git_blob_sha1']:
                raise RuntimeError('Pinned Git blob/byte identity mismatch; refusing input')
            data = json.loads(b)
            if data.get('type') != 'FeatureCollection' or not isinstance(data.get('features'), list):
                raise RuntimeError('Expected GeoJSON FeatureCollection')
            features = data['features']
            labels = collections.Counter()
            precision = collections.Counter()
            property_fields = collections.Counter()
            for f in features:
                props = f.get('properties') or {}
                label = props.get('NAME')
                labels[label if isinstance(label, str) else ''] += 1
                precision[str(props.get('BORDERPRECISION'))] += 1
                property_fields.update(props.keys())
            if not path.exists(): path.write_bytes(b)
            used += len(b)
            row.update({'status': 'RECOVERED', 'sha256': sha256(b), 'bytes': len(b),
                        'feature_count': len(features), 'distinct_nonblank_labels': sum(bool(x.strip()) for x in labels),
                        'blank_label_features': sum(n for x, n in labels.items() if not x.strip()),
                        'source_precision_counts': dict(sorted(precision.items())),
                        'source_property_fields': dict(sorted(property_fields.items())),
                        'recovery': recovery, **geometry_counts(features)})
            labels_by_observation.append({'filename': row['filename'], 'source_year': row['source_year'],
                                          'sha256': row['sha256'], 'labels': dict(sorted(labels.items()))})
        except Exception as error:
            row.update({'status': 'BLOCKED', 'blocker': f'{type(error).__name__}: {error}'})
        row['intake_elapsed_ms'] = round((time.monotonic() - begin) * 1000, 3)
        manifest['recovered_count'] = sum(r['status'] == 'RECOVERED' for r in snapshots)
        manifest['blocked_count'] = sum(r['status'] == 'BLOCKED' for r in snapshots)
        manifest['measured_source_bytes'] = used
        write_json(OUT / 'target-snapshots.json', manifest)
        write_compiler_inputs(manifest)
        write_json(OUT / 'labels-by-observation.json', {'pinned_revision': REV, 'observations': labels_by_observation})
        print(json.dumps({k: row[k] for k in ['filename', 'status', 'bytes', 'feature_count', 'blocker'] if k in row}), flush=True)
    manifest['source_feature_count'] = sum(r.get('feature_count', 0) for r in snapshots)
    manifest['elapsed_ms'] = round((time.monotonic() - started) * 1000, 3)
    manifest['max_rss_bytes'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
    manifest['all_inputs_are_full_originals'] = manifest['recovered_count'] == len(snapshots)
    manifest['independently_reviewed_historical_observations'] = 0
    write_json(OUT / 'target-snapshots.json', manifest)
    write_compiler_inputs(manifest)
    write_grouped_labels(labels_by_observation)
    write_json(RECEIPTS / 'intake-receipt.json', manifest)
    print(json.dumps({k: manifest[k] for k in ['recovered_count', 'blocked_count', 'source_feature_count', 'measured_source_bytes', 'max_rss_bytes', 'elapsed_ms']}), flush=True)


def optional_earlier():
    """A separately authorized extension, preserving the primary result verbatim."""
    shared_budget_path = APP / 'public/global-history/resource-budget.json'
    shared_budget = json.loads(shared_budget_path.read_text())
    gate_path = APP / 'verification/global-history/primary-40/browser-gate.json'
    if (shared_budget.get('budget_id') != 'global-history-49-v2'
            or shared_budget.get('scope', {}).get('optional_enabled') is not True
            or not gate_path.exists()):
        raise RuntimeError('Optional collection requires the explicit 49-v2 authorization and retained primary browser gate')
    limits = shared_budget['limits']
    if (limits['source_file_bytes'] != BUDGET['max_raw_bytes_per_file']
            or limits['source_collection_bytes'] != BUDGET['max_total_source_bytes']
            or shared_budget['workers'] != 1):
        raise RuntimeError('Optional collection may not increase frozen intake caps')
    optional_receipts = RECEIPTS / 'optional-9'
    optional_receipts.mkdir(parents=True, exist_ok=True)
    optional_budget = {**BUDGET, 'id': 'global-history-optional-intake-v2',
                       'scope': 'Nine earlier observations, 3000 BCE through 300 BCE, after primary40 usability gate',
                       'max_files': 9, 'total_observations_after_extension': 49,
                       'optional_nine_earlier_files': 'EXPLICITLY AUTHORIZED AFTER PRIMARY40 GATE',
                       'parent_budget_sha256': sha256(shared_budget_path.read_bytes()),
                       'primary_browser_gate_sha256': sha256(gate_path.read_bytes()),
                       'policy_revision': 'Observation scope only: nine earlier inputs enabled. All file, collection, worker and deadline caps unchanged.'}
    optional_budget_path = optional_receipts / 'frozen-resource-budget.json'
    if optional_budget_path.exists():
        if json.loads(optional_budget_path.read_text()) != optional_budget:
            raise RuntimeError('Optional frozen budget differs; refusing silent amendment')
    else:
        write_json(optional_budget_path, optional_budget)
    for name in ['target-snapshots.json', 'input-manifest.json', 'labels-by-observation.json',
                 'labels-grouped.json', 'rights-record.json', 'SHA256SUMS']:
        p = OUT / name
        preserved = OUT / (p.stem + '.primary-40' + p.suffix)
        if not preserved.exists(): preserved.write_bytes(p.read_bytes())
    primary_path = OUT / 'target-snapshots.primary-40.json'
    primary = json.loads(primary_path.read_text())
    if primary['recovered_count'] != 40 or len(primary['snapshots']) != 40:
        raise RuntimeError('Exactly forty retained primary inputs required')
    for row in primary['snapshots']:
        b = (OUT / row['path']).read_bytes()
        if sha256(b) != row['sha256'] or git_blob(b) != row['git_blob_sha1']:
            raise RuntimeError('Primary raw input changed: ' + row['filename'])
    tree_raw = (OUT / 'git-tree.json').read_bytes()
    index_raw = (OUT / 'index.json').read_bytes()
    if sha256(tree_raw) != primary['source_tree_sha256'] or sha256(index_raw) != primary['source_index_sha256']:
        raise RuntimeError('Retained pinned index/tree changed')
    tree = json.loads(tree_raw)
    nodes = {r['path']: r for r in tree['tree']}
    index = {r['year']: r for r in json.loads(index_raw)['years']}
    amendment = {
        'source_id': primary['source_id'], 'pinned_revision': REV,
        'license': 'GPL-3.0', 'attribution': 'André Ourednik and Historical Basemaps contributors',
        'preserved_primary_rights': 'rights-record.primary-40.json',
        'preserved_pilot_rights': 'pilot-rights-record.json',
        'scope_amendment': 'After the primary forty-observation main-screen gate, the user-authorized optional nine indexed observations are collected and staged. The candidate nominal observation range now extends to 3000 BCE through 2010 CE. Earlier pilot and primary scope records remain unchanged.',
        'optional_source_years': OPTIONAL_YEARS,
        'primary_browser_gate_sha256': sha256(gate_path.read_bytes()),
        'budget_sha256': sha256(optional_budget_path.read_bytes()),
        'historical_status': 'Source-attributed overview, not independent historical review; prehistoric cultural reconstruction is not political ownership.',
        'publication_boundary': 'Staged Explorer candidate only; public ledger and explicit quarantine boundaries unchanged.',
        'source_precision': 'Nominal source-year observations; no exact event dates or interpolated borders inferred.',
        'license_record': 'LICENSE', 'attribution_and_limitations_record': 'README.md',
    }
    write_json(OUT / 'optional-rights-amendment.json', amendment)
    rows = []
    for year in OPTIONAL_YEARS:
        indexed = index[year]
        name = indexed['filename']
        source_path = 'geojson/' + name
        node = nodes[source_path]
        astronomical = year + 1
        rows.append({'filename': name, 'source_year': year, 'astronomical_year': astronomical,
                     'source_date': '-' + f'{abs(astronomical):04d}-01-01',
                     'source_date_label': f'{abs(year)} BCE', 'precision': 'year',
                     'source_path': source_path, 'path': 'input/' + name,
                     'source_url': BASE + source_path, 'expected_bytes': node['size'],
                     'git_blob_sha1': node['sha'], 'indexed_label_count': len(indexed.get('countries', [])),
                     'status': 'PENDING', 'batch': 'optional9'})
    started = time.monotonic()
    used = primary['measured_source_bytes']
    optional_labels = []
    receipt = {'schema_version': 1, 'pinned_revision': REV, 'source_id': primary['source_id'],
               'budget_sha256': sha256(optional_budget_path.read_bytes()),
               'primary_inventory_sha256': sha256(primary_path.read_bytes()),
               'source_rights': 'optional-rights-amendment.json', 'snapshots': rows}
    for row in rows:
        begin = time.monotonic()
        path = OUT / row['path']
        try:
            b = path.read_bytes() if path.exists() else fetch(row['source_url'])
            recovery = 'previously recovered exact pinned bytes' if path.exists() else 'direct pinned upstream URL'
            if len(b) > BUDGET['max_raw_bytes_per_file'] or used + len(b) > BUDGET['max_total_source_bytes']:
                raise RuntimeError('Frozen source byte cap exceeded')
            if len(b) != row['expected_bytes'] or git_blob(b) != row['git_blob_sha1']:
                raise RuntimeError('Pinned Git blob/byte identity mismatch')
            data = json.loads(b)
            if data.get('type') != 'FeatureCollection' or not isinstance(data.get('features'), list):
                raise RuntimeError('Expected GeoJSON FeatureCollection')
            features = data['features']
            labels = collections.Counter()
            precision = collections.Counter()
            fields = collections.Counter()
            for feature in features:
                props = feature.get('properties') or {}
                label = props.get('NAME')
                labels[label if isinstance(label, str) else ''] += 1
                precision[str(props.get('BORDERPRECISION'))] += 1
                fields.update(props.keys())
            if not path.exists(): path.write_bytes(b)
            used += len(b)
            row.update({'status': 'RECOVERED', 'sha256': sha256(b), 'bytes': len(b),
                        'feature_count': len(features), 'distinct_nonblank_labels': sum(bool(x.strip()) for x in labels),
                        'blank_label_features': sum(n for x, n in labels.items() if not x.strip()),
                        'source_precision_counts': dict(sorted(precision.items())),
                        'source_property_fields': dict(sorted(fields.items())),
                        'recovery': recovery, **geometry_counts(features)})
            optional_labels.append({'filename': row['filename'], 'source_year': row['source_year'],
                                    'sha256': row['sha256'], 'labels': dict(sorted(labels.items()))})
        except Exception as error:
            row.update({'status': 'BLOCKED', 'blocker': f'{type(error).__name__}: {error}'})
        row['intake_elapsed_ms'] = round((time.monotonic() - begin) * 1000, 3)
        write_json(optional_receipts / 'intake-receipt.json', receipt)
        print(json.dumps({k: row[k] for k in ['filename', 'status', 'bytes', 'feature_count', 'blocker'] if k in row}), flush=True)
    receipt.update({'recovered_count': sum(r['status'] == 'RECOVERED' for r in rows),
                    'blocked_count': sum(r['status'] == 'BLOCKED' for r in rows),
                    'source_feature_count': sum(r.get('feature_count', 0) for r in rows),
                    'measured_additional_source_bytes': used - primary['measured_source_bytes'],
                    'measured_cumulative_source_bytes': used,
                    'elapsed_ms': round((time.monotonic() - started) * 1000, 3),
                    'max_rss_bytes': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024})
    write_json(optional_receipts / 'intake-receipt.json', receipt)
    write_json(OUT / 'target-snapshots.optional-9.json', receipt)
    merged = {**primary, 'snapshots': sorted([{**r, 'batch': 'primary40'} for r in primary['snapshots']] + rows,
                                           key=lambda r: r['source_year']),
              'primary_inventory': 'target-snapshots.primary-40.json',
              'primary_inventory_sha256': sha256(primary_path.read_bytes()),
              'optional_inventory': 'target-snapshots.optional-9.json',
              'optional_rights': 'optional-rights-amendment.json',
              'primary_count': 40, 'optional_count': 9,
              'recovered_count': 40 + receipt['recovered_count'], 'blocked_count': receipt['blocked_count'],
              'source_feature_count': primary['source_feature_count'] + receipt['source_feature_count'],
              'measured_source_bytes': used, 'max_rss_bytes': max(primary['max_rss_bytes'], receipt['max_rss_bytes']),
              'elapsed_ms': primary['elapsed_ms'] + receipt['elapsed_ms'],
              'all_inputs_are_full_originals': receipt['recovered_count'] == 9}
    write_json(OUT / 'target-snapshots.json', merged)
    write_compiler_inputs(merged)
    write_json(OUT / 'labels-optional-9.json', {'pinned_revision': REV, 'observations': optional_labels})
    primary_labels = json.loads((OUT / 'labels-by-observation.primary-40.json').read_text())['observations']
    all_labels = sorted(primary_labels + optional_labels, key=lambda r: r['source_year'])
    write_json(OUT / 'labels-by-observation.json', {'pinned_revision': REV, 'observations': all_labels})
    write_grouped_labels(all_labels)
    (OUT / 'SHA256SUMS').write_text(''.join(r['sha256'] + '  ' + r['path'] + '\n'
                                          for r in merged['snapshots'] if r['status'] == 'RECOVERED'))
    print(json.dumps({k: receipt[k] for k in ['recovered_count', 'blocked_count', 'source_feature_count',
                                           'measured_additional_source_bytes', 'measured_cumulative_source_bytes',
                                           'elapsed_ms', 'max_rss_bytes']}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--optional-earlier', action='store_true', help='Execute explicitly enabled nine-date extension after the primary usability gate')
    args = parser.parse_args()
    optional_earlier() if args.optional_earlier else main()

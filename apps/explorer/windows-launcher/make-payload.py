"""Reuse the verified runnable packet without changing any application bytes."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('runnable', type=Path)
parser.add_argument('go_license', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parent
records = []
prefix = 'Chronicle-Explorer/'
with zipfile.ZipFile(args.runnable) as source, zipfile.ZipFile(root / 'payload.zip', 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as target:
    inventory = json.loads(source.read(prefix + 'package-inventory-runnable.json'))
    expected = {e['path']: e for e in inventory['files']}
    def add(name, data):
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        target.writestr(info, data)
        records.append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    for name in sorted(source.namelist()):
        relative = name.removeprefix(prefix)
        if not name.startswith(prefix) or name.endswith('/'):
            continue
        if not (relative.startswith('dist/') or relative in ['THIRD_PARTY_NOTICES.txt', 'LICENSE-Historical-Basemaps-GPL-3.0.txt']):
            continue
        data = source.read(name)
        assert expected[relative]['byte_length'] == len(data)
        assert expected[relative]['sha256'] == hashlib.sha256(data).hexdigest()
        add(relative, data)
    add('rights/Go-LICENSE.txt', args.go_license.read_bytes())
assert sum(row['bytes'] for row in records) <= 400 * 1024**2
archive = root / 'payload.zip'
assert archive.stat().st_size <= 128 * 1024**2
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(root / 'payload.sha256').write_text(digest + '\n')
(root / 'payload-receipt.json').write_text(json.dumps({
    'source_packet_sha256': hashlib.sha256(args.runnable.read_bytes()).hexdigest(),
    'build': inventory['production_build'],
    'source_packet_commit': inventory['source_commit'],
    'archive_sha256': digest, 'archive_bytes': archive.stat().st_size,
    'unpacked_bytes': sum(row['bytes'] for row in records),
    'file_count': len(records), 'files': records,
}, indent=2) + '\n')
print(digest)

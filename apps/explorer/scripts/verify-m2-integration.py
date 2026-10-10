"""Read-only source/protection checks plus an owned local built-server check."""
from pathlib import Path
import hashlib
import json
import os
import select
import subprocess
import urllib.request

APP = Path(__file__).resolve().parents[1]
ROOT = APP.parents[1]
OUT = APP / 'verification/m2-integration'
OUT.mkdir(parents=True, exist_ok=True)
digest = lambda data: hashlib.sha256(data).hexdigest()

protected = json.loads((APP / 'verification/research-workspace/protected-inputs.json').read_text())
changed = [entry['path'] for entry in protected if not (ROOT / entry['path']).is_file()
           or digest((ROOT / entry['path']).read_bytes()) != entry['sha256']]
assert len(protected) == 2282 and not changed, changed
(OUT / 'protected.json').write_text(json.dumps({'status': 'PASS', 'checked': len(protected), 'changed': changed}, indent=2) + '\n')

excluded = {'node_modules', '.sites-runtime', '__pycache__'}
paths = []
for directory in [APP / 'src', APP / 'research-semantic', ROOT / 'packages/contracts/src', APP / 'public']:
    paths.extend(path for path in directory.rglob('*') if path.is_file()
                 and not excluded.intersection(path.relative_to(directory).parts))
paths.extend(APP / name for name in ['index.html', 'production-review.html', 'vite.config.ts', 'package.json', 'pnpm-lock.yaml'])
# Match Vite's full-path string ordering, not pathlib's component ordering.
inputs = [{'path': path.relative_to(ROOT).as_posix(), 'byte_length': path.stat().st_size,
           'sha256': digest(path.read_bytes())} for path in sorted(paths, key=str)]
fingerprint = digest(json.dumps(inputs, ensure_ascii=False, separators=(',', ':')).encode())
build = json.loads((APP / 'dist/build-info.json').read_text())
assert fingerprint == build['source_fingerprint']
(OUT / 'source-build-match.json').write_text(json.dumps({'status': 'PASS', 'sourceFileCount': len(inputs),
    'sourceFingerprint': fingerprint, 'buildId': build['build_id']}, indent=2) + '\n')

process = subprocess.Popen(['node', 'serve.mjs'], cwd=APP, env={**os.environ, 'PORT': '4197'},
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
try:
    ready, _, _ = select.select([process.stdout], [], [], 8)
    assert ready and b'http://localhost:4197/' in process.stdout.readline(), 'Owned server did not start'
    checks = []
    for path in [APP / 'dist/index.html', APP / 'dist/build-info.json', APP/'dist/production-review.html', *sorted((APP / 'dist/assets').iterdir())]:
        if not path.is_file():
            continue
        relative = path.relative_to(APP / 'dist').as_posix()
        with urllib.request.urlopen('http://127.0.0.1:4197/' + relative, timeout=10) as response:
            data = response.read()
            assert data == path.read_bytes()
            checks.append({'path': relative, 'status': response.status, 'sha256': digest(data), 'exactBytes': True})
    request = urllib.request.Request('http://127.0.0.1:4197/index.html', headers={'Range': 'bytes=0-9'})
    with urllib.request.urlopen(request, timeout=3) as response:
        assert response.status == 206 and len(response.read()) == 10
    (OUT / 'production-server.json').write_text(json.dumps({'status': 'PASS', 'assets': checks,
        'range206': True, 'command': 'PORT=4197 node serve.mjs', 'productionBrowser': 'NOT RUN'}, indent=2) + '\n')
finally:
    process.terminate()
    process.wait(timeout=5)

for name in ['research', 'premodern']:
    result = subprocess.run(['python3', f'scripts/build-{name}-pilot.py', '--check'], cwd=APP,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    (OUT / f'{name}-lineage.log').write_text(result.stdout)
    assert result.returncode == 0, result.stdout
print(json.dumps({'status': 'PASS', 'protected': len(protected), 'sourceInputs': len(inputs),
                  'servedAssets': len(checks), 'range206': True, 'sourceChecks': 'PASS'}))

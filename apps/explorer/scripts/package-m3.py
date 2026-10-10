"""Package the checked M3 source and local runnable; verify every archived member."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

APP = Path(__file__).resolve().parents[1]
ROOT = APP.parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, default=ROOT.parent / 'm3-release')
OUT = parser.parse_args().output.resolve()
OUT.mkdir(parents=True, exist_ok=True)
assert not OUT.is_relative_to(ROOT), 'Write release archives outside the source tree.'
SKIP = {'node_modules', '.sites-runtime', 'dist', '.git', '__pycache__'}
digest = lambda data: hashlib.sha256(data).hexdigest()
build = json.loads((APP / 'dist/build-info.json').read_text())
archives = []

readme = '''Chronicle M3 — local review package

Dashboard: requires Node >=22.13. Run node serve.mjs and open
http://localhost:4173/. Research contains both prepared pilots.
No install or external service is needed to use the prebuilt dashboard.

M3 is accepted under the user-approved application-level and virtual DOM
profile. Live models and arbitrary generated execution remain disabled.
All modelProcessing flags remain false. Worker/VM capability, heap and
lifecycle checks pass for reviewed fixtures; they do not certify OS or
aggregate process-memory isolation. Virtual DOM layout and timing are
simulations, not real-browser rendering or performance measurements.

Offline application sandbox checks (Node >=22.13, built-in modules only):
node --experimental-transform-types runtime-isolation/application-acceptance.ts

Offline virtual DOM checks (all required JavaScript dependencies bundled):
node virtual-acceptance/scripts/m3-virtual-dom-acceptance.mjs --offline

The stronger optional native profile and original browser attempt are
retained as historical evidence; neither is presented as passed.

See SESSION.md and docs/research-workspace/M3-ACCEPTANCE.md for actual
test results, remaining gates, and exact reproduction commands.
Verification evidence is under verification/m3/. Prior checkpoint receipts
are retained and must not be confused with this build's results.
'''

for kind in ['Source', 'Runnable']:
    path = OUT / f'Chronicle-M3-{kind}.zip'
    prefix = f'Chronicle-M3-{kind}/'
    package_readme = readme if kind == 'Runnable' else '''Chronicle M3 — editable source package

Start in source/apps/explorer. Requires Node >=22.13 and the frozen
application, research-semantic and verification-tools dependencies.
Provision those separate dependency boundaries with pnpm install
--frozen-lockfile (and --ignore-scripts for the two isolated packages).
Then run:
corepack pnpm test
corepack pnpm run build
python3 scripts/verify-m3.py
node serve.mjs

The separate Runnable archive includes the prebuilt dashboard and requires
no dependency installation. This source also contains the self-contained
offline virtual verification kit under verification/m3/virtual-offline:
node verification/m3/virtual-offline/scripts/m3-virtual-dom-acceptance.mjs --offline
Application sandbox verification uses Node built-ins:
node --experimental-transform-types runtime-isolation/application-acceptance.ts

Read source/SESSION.md and source/docs/research-workspace/M3-ACCEPTANCE.md.
The approved M3 profile uses fixed reviewed Worker/VM fixtures and virtual
DOM substitutes; it does not certify OS isolation or real browser rendering.
Live models and arbitrary generated execution remain disabled.
'''
    if kind == 'Source':
        pairs = [(p, prefix + 'source/' + p.relative_to(ROOT).as_posix())
                 for p in sorted(ROOT.rglob('*'))
                 if p.is_file() and not SKIP.intersection(p.relative_to(ROOT).parts)]
    else:
        pairs = [(p, prefix + 'dist/' + p.relative_to(APP / 'dist').as_posix())
                 for p in sorted((APP / 'dist').rglob('*')) if p.is_file()]
        pairs += [(APP / 'serve.mjs', prefix + 'serve.mjs'),
                  (APP / 'THIRD_PARTY_NOTICES.txt', prefix + 'THIRD_PARTY_NOTICES.txt'),
                  (ROOT / 'SESSION.md', prefix + 'SESSION.md')]
        for directory, archive_path in [
            (ROOT / 'docs/research-workspace', 'docs/research-workspace'),
            (APP / 'runtime-isolation', 'runtime-isolation'),
            (APP / 'verification', 'verification'),
        ]:
            pairs += [(p, prefix + archive_path + '/' + p.relative_to(directory).as_posix())
                      for p in sorted(directory.rglob('*'))
                      if p.is_file() and not SKIP.intersection(p.relative_to(directory).parts)
                      and not (archive_path == 'verification' and p.relative_to(directory).parts[:2] == ('m3', 'virtual-offline'))]
        offline = APP / 'verification/m3/virtual-offline'
        pairs += [(p, prefix + 'virtual-acceptance/' + p.relative_to(offline).as_posix())
                  for p in sorted(offline.rglob('*')) if p.is_file()]
        pairs += [(APP / 'scripts/m3-headless-acceptance.mjs', prefix + 'scripts/m3-headless-acceptance.mjs')]
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
        for local, member in pairs:
            archive.write(local, member)
        archive.writestr(prefix + 'README.txt', package_readme)
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None
        assert archive.read(prefix + 'README.txt').decode() == package_readme
        for local, member in pairs:
            assert digest(archive.read(member)) == digest(local.read_bytes()), member
    archives.append({'file': path.name, 'bytes': path.stat().st_size,
                     'sha256': digest(path.read_bytes()), 'membersVerified': len(pairs) + 1,
                     'status': 'PASS'})

logs = OUT / 'Chronicle-M3-Verification.zip'
log_pairs = [(p, 'verification/m3/' + p.relative_to(APP / 'verification/m3').as_posix())
             for p in sorted((APP / 'verification/m3').rglob('*')) if p.is_file()]
with zipfile.ZipFile(logs, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for local, member in log_pairs:
        archive.write(local, member)
with zipfile.ZipFile(logs) as archive:
    assert archive.testzip() is None
    for local, member in log_pairs:
        assert digest(archive.read(member)) == digest(local.read_bytes()), member
archives.append({'file': logs.name, 'bytes': logs.stat().st_size,
                 'sha256': digest(logs.read_bytes()), 'membersVerified': len(log_pairs), 'status': 'PASS'})
shutil.copyfile(ROOT / 'docs/research-workspace/M3-ACCEPTANCE.md', OUT / 'Chronicle-M3-Acceptance.md')
shutil.copyfile(ROOT / 'SESSION.md', OUT / 'SESSION.md')
(OUT / 'package-receipt.json').write_text(json.dumps({'packages': archives, 'build': build}, indent=2) + '\n')
print(json.dumps(archives, indent=2))

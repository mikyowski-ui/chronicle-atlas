#!/usr/bin/env python3
"""Package existing build/review artifacts; never compile, publish, or change a ledger."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

APP = Path(__file__).resolve().parents[1]
ROOT = APP.parents[1]
BASELINE = '090f09c607654fac412116e3b1e3f9c076da05fc'
PREFIX = 'Chronicle-Explorer/'
MAX_ZIP_BYTES = 50_000_000
SKIP_PARTS = {'node_modules', '.sites-runtime', '.git', '__pycache__'}
CODE_SUFFIXES = {'.ts', '.tsx', '.mjs', '.js'}
IMPORT = re.compile(r'(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)[\'\"](\.[^\'\"]+)[\'\"]')

def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def git(*args: str) -> str:
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()

def files_under(base: Path, omit: set[str] | None = None):
    omit = (omit or set()) | SKIP_PARTS
    for directory, directories, filenames in os.walk(base, followlinks=False):
        directories[:] = sorted(name for name in directories if name not in omit)
        for name in directories:
            if (Path(directory) / name).is_symlink():
                raise ValueError('Source package does not follow symlink directories: ' + name)
        for name in sorted(filenames):
            path = Path(directory) / name
            if path.is_symlink():
                raise ValueError('Source package does not follow symlinks: ' + str(path.relative_to(base)))
            if path.suffix not in {'.pyc', '.tmp'}:
                yield path

def relative_import_target(source: Path, specifier: str) -> Path | None:
    target = (source.parent / specifier).resolve()
    for candidate in [target, *(target.with_suffix(s) for s in ('.ts', '.tsx', '.mjs', '.js')), target / 'index.ts']:
        if candidate.is_file():
            return candidate
    return None

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--commit', default=None, help='Exact candidate source commit; defaults to current HEAD.')
    parser.add_argument('--output', type=Path, default=None)
    parser.add_argument('--dry-run', action='store_true', help='Inspect package plan without writing an archive or receipt.')
    parser.add_argument('--review-profile', choices=['alpha', 'motion', 'integrated', 'global', 'detail', 'glass', 'history', 'teaching'], default='alpha')
    parser.add_argument('--bundle', choices=['runnable', 'source', 'originals', 'combined'], default=None,
                        help='Global/detail/glass/history/teaching profiles: split runnable/source/originals packets (default runnable), or combined. Legacy profiles remain combined.')
    options = parser.parse_args()
    expanded_profile = options.review_profile in {'global', 'detail', 'glass', 'history', 'teaching'}
    teaching_profile = options.review_profile == 'teaching'
    history_profile = options.review_profile in {'history', 'teaching'}
    glass_profile = options.review_profile in {'glass', 'history', 'teaching'}
    detail_profile = options.review_profile in {'detail', 'glass', 'history', 'teaching'}
    bundle = options.bundle or ('runnable' if expanded_profile else 'combined')
    if not expanded_profile and bundle != 'combined':
        parser.error('Split bundles are supported only by the global/detail/glass/history/teaching review profiles.')
    include_runtime = bundle in {'runnable', 'combined'}
    include_source = bundle in {'source', 'combined'}
    originals_root = APP / 'public/global-history/source/input'
    detail_original_roots = [APP / 'public/detail' / name for name in ['source', 'population-source', 'terrain-source']] if detail_profile else []
    history_original_root = APP / 'public/history/source' if history_profile else None

    def is_original_input(path: Path) -> bool:
        if path.is_relative_to(originals_root):
            return True
        if history_original_root and path.is_relative_to(history_original_root) and path.suffix.lower() in {'.csv', '.xls', '.xlsx'}:
            return True
        # Preserve source manifests, licenses, versions and READMEs in the
        # runnable/source packets. Only large exact original archives move.
        return any(path.is_relative_to(root) for root in detail_original_roots) and path.suffix.lower() in {'.zip', '.nc'}

    packaging_budget = None
    max_input_bytes = 134_217_728
    max_zip_bytes = MAX_ZIP_BYTES
    if expanded_profile:
        budget_path = APP / ('verification/teaching/packaging-budget.json' if teaching_profile else 'verification/history/packaging-budget.json' if history_profile else 'verification/glass/packaging-budget.json' if glass_profile else 'verification/detail/packaging-budget.json' if detail_profile else 'verification/global-history/packaging-budget.json')
        packaging_budget = json.loads(budget_path.read_text())
        limits = packaging_budget['limits']
        max_input_bytes = limits[bundle + '_input_bytes']
        max_zip_bytes = limits[bundle + '_zip_bytes_exclusive'] if detail_profile else limits['zip_bytes_exclusive']
        profile_zip_ceiling = (134_217_728 if bundle == 'originals' else 100_663_296) if detail_profile else MAX_ZIP_BYTES
        if not 0 < max_input_bytes <= 536_870_912 or not 0 < max_zip_bytes <= profile_zip_ceiling:
            raise ValueError('Invalid frozen expanded-profile packaging budget.')
    baseline = {'alpha': BASELINE, 'motion': '8c8353d5b9d103586146f3a56c9e64dbb95a9be6',
                'integrated': 'c4ff2534bdc19dd10c68f1dff384f3a60522421a',
                'global': 'd5cc0ff0307a0cb6de164937fde0e93847b4404f',
                'detail': '199070f638e56691712967d5fde8c64495c249ca',
                'glass': '6f6e671315e718a3d361b60697ff3d39d455df0e',
                'history': '4b7677e82016efda5b8d19de31656cadcd17ba3f',
                'teaching': 'ed9449b22fe16692ee8b1933eac7130ef79a3ca4'}[options.review_profile]
    commit = options.commit or git('rev-parse', 'HEAD')
    if not re.fullmatch('[0-9a-f]{40}', commit):
        raise ValueError('--commit must be a full lowercase Git commit SHA')
    git('cat-file', '-e', commit + '^{commit}')
    default_output = APP / (f'verification/teaching/Chronicle-Teaching-Atlas-{bundle.title()}.zip' if teaching_profile
                            else f'verification/history/Chronicle-Historical-Cities-{bundle.title()}.zip' if history_profile
                            else f'verification/glass/Chronicle-Glass-Beta-{bundle.title()}.zip' if glass_profile
                            else f'verification/detail/Chronicle-V2-Detail-{bundle.title()}.zip' if detail_profile
                            else f'verification/global-history/Chronicle-Global-History-{bundle.title()}.zip' if options.review_profile == 'global'
                            else 'verification/integrated/Chronicle-VP08-Integrated-Review.zip' if options.review_profile == 'integrated'
                            else 'verification/alpha/Chronicle-VP07-Alpha-Review.zip')
    output = (options.output or default_output).resolve()
    if not output.is_relative_to(APP):
        raise ValueError('Package output must remain inside apps/explorer')
    entries: dict[str, Path | bytes] = {}

    def add(name: str, value: Path | bytes) -> None:
        if name.startswith('/') or '..' in Path(name).parts or name in entries:
            raise ValueError('Unsafe or duplicate archive path: ' + name)
        entries[name] = value

    if include_runtime:
        for path in files_under(APP / 'dist'):
            public_equivalent = APP / 'public' / path.relative_to(APP / 'dist')
            if expanded_profile and bundle != 'combined' and is_original_input(public_equivalent):
                continue  # Retained byte-for-byte in the companion Originals packet.
            add('dist/' + path.relative_to(APP / 'dist').as_posix(), path)
    for name in (['serve.mjs', 'THIRD_PARTY_NOTICES.txt'] if include_runtime else ['THIRD_PARTY_NOTICES.txt']):
        add(name, APP / name)
    add('LICENSE-Historical-Basemaps-GPL-3.0.txt', APP / 'public/wave-b/source/LICENSE')
    for path in files_under(APP / 'verification/alpha'):
        # In particular, never include this ZIP, earlier review ZIPs, or an old
        # external delivery hash (a ZIP cannot contain its own final digest).
        if path == output or path.suffix.lower() == '.zip' or path.name == 'delivery.json':
            continue
        add('verification/alpha/' + path.relative_to(APP / 'verification/alpha').as_posix(), path)

    if options.review_profile in {'motion', 'integrated', 'global', 'detail', 'glass', 'history', 'teaching'}:
        for path in files_under(APP / 'verification/motion'):
            if path == output or path.suffix.lower() == '.zip' or path.name in {'delivery.json', '.gitignore'}:
                continue
            add('verification/motion/' + path.relative_to(APP / 'verification/motion').as_posix(), path)

    if options.review_profile in {'integrated', 'global', 'detail', 'glass', 'history', 'teaching'}:
        for path in files_under(APP / 'verification/integrated'):
            if path == output or path.suffix.lower() == '.zip' or path.name in {'delivery.json', '.gitignore'}:
                continue
            add('verification/integrated/' + path.relative_to(APP / 'verification/integrated').as_posix(), path)

    if expanded_profile:
        for path in files_under(APP / 'verification/global-history'):
            if path == output or path.suffix.lower() == '.zip' or path.name.startswith('delivery') or path.name == '.gitignore':
                continue
            add('verification/global-history/' + path.relative_to(APP / 'verification/global-history').as_posix(), path)
    if detail_profile:
        for path in files_under(APP / 'verification/detail'):
            if path == output or path.suffix.lower() == '.zip' or path.name.startswith('delivery') or path.name in {'.gitignore', 'Chronicle-V2-Detail-Exact-Result-Receipt.json'}:
                continue
            add('verification/detail/' + path.relative_to(APP / 'verification/detail').as_posix(), path)

    if glass_profile:
        for path in files_under(APP / 'verification/glass'):
            if (path == output or path.suffix.lower() == '.zip' or path.name.startswith('delivery')
                    or path.name in {'.gitignore', 'Chronicle-Glass-Beta-Exact-Result.json', 'Chronicle-Glass-Beta-Exact-Result-Receipt.json'}):
                continue
            add('verification/glass/' + path.relative_to(APP / 'verification/glass').as_posix(), path)

    if history_profile:
        for path in files_under(APP / 'verification/history'):
            if (path == output or path.suffix.lower() in {'.zip', '.exe'} or path.name.startswith('delivery')
                    or path.name in {'.gitignore', 'Chronicle-Historical-Cities-Exact-Result.json'}):
                continue
            add('verification/history/' + path.relative_to(APP / 'verification/history').as_posix(), path)

    if history_profile:
        continuity_root = APP / 'verification/history-continuity'
        if not (continuity_root / 'previous-geometry-hashes.json').is_file():
            raise ValueError('Required continuity regression baseline is missing.')
        admission = json.loads((APP / 'public/history/political-admission-receipt.json').read_text())
        for revision in admission['revisions']:
            previous = (APP / revision['previous_mapping_path']).resolve()
            if not previous.is_relative_to(continuity_root.resolve()):
                raise ValueError('Previous mapping fixture escapes the continuity directory.')
            if digest(previous.read_bytes()) != revision['previous_mapping_sha256']:
                raise ValueError('Previous mapping fixture differs from admission pin: ' + previous.name)
        for path in files_under(continuity_root):
            if path.suffix.lower() in {'.zip', '.exe'} or path.name.startswith('delivery'):
                continue
            add('verification/history-continuity/' + path.relative_to(continuity_root).as_posix(), path)

    if teaching_profile:
        for path in files_under(APP / 'verification/teaching'):
            if (path == output or path.suffix.lower() in {'.zip', '.exe'} or path.name.startswith('delivery')
                    or path.name in {'.gitignore', 'Chronicle-Teaching-Atlas-Exact-Result.json'}):
                continue
            add('verification/teaching/' + path.relative_to(APP / 'verification/teaching').as_posix(), path)

    source_paths: set[Path] = set(files_under(APP, {'dist', 'verification'}))
    # The embedded desktop archive is a generated copy of the runnable packet,
    # not source. Rebuild it from the matching Runnable packet with the included
    # launcher script; do not recursively ship a second app inside Source.
    source_paths.discard(APP / 'windows-launcher/payload.zip')
    source_paths.difference_update(path for path in list(source_paths)
                                   if path.is_relative_to(APP / 'windows-launcher') and path.suffix.lower() == '.exe')
    # Source must run its retained regression suite after Source + Originals are
    # extracted. Preserve the small test inputs at their checkout-relative paths;
    # outer review copies alone do not satisfy tests' ../verification imports.
    if expanded_profile:
        for relative in ['verification/global-history/primary-40/catalog.json',
                         'verification/global-history/primary-40/semantic-mappings/archive-hashes.json']:
            required = APP / relative
            if not required.is_file():
                raise ValueError('Required source regression fixture missing: ' + relative)
            source_paths.add(required)
    if history_profile:
        source_paths.update(path for path in files_under(APP / 'verification/history-continuity')
                            if path.suffix.lower() not in {'.zip', '.exe'} and not path.name.startswith('delivery'))
        # The explicit recovery helper checks this retained normalizer byte hash.
        source_paths.add(APP / 'verification/global-history/primary-40/compiler/build-global-history-normalize.py')
    source_paths.update(files_under(ROOT / 'packages/contracts'))
    # Discover transitive local imports needed by the checkout. The existing
    # fixture tests import read-only root/lib/readiness/chronology.ts.
    pending = [p for p in source_paths if p.suffix in CODE_SUFFIXES]
    scanned: set[Path] = set()
    external_prerequisites: set[Path] = set()
    while pending:
        source = pending.pop()
        if source in scanned:
            continue
        scanned.add(source)
        for specifier in IMPORT.findall(source.read_text(encoding='utf-8')):
            target = relative_import_target(source, specifier)
            if target is None:
                continue  # Generated compiler scratch inputs are not application imports.
            if not target.is_relative_to(ROOT):
                raise ValueError('Local source import escapes the checkout: ' + str(target))
            if any(part in SKIP_PARTS for part in target.relative_to(ROOT).parts):
                continue
            if target not in source_paths:
                if not target.is_relative_to(ROOT / 'lib'):
                    raise ValueError('Review new external prerequisite explicitly: ' + str(target))
                source_paths.add(target)
                external_prerequisites.add(target)
                if target.suffix in CODE_SUFFIXES:
                    pending.append(target)
    if include_source:
        for path in sorted(source_paths):
            if expanded_profile and bundle != 'combined' and is_original_input(path):
                continue
            add('source/' + path.relative_to(ROOT).as_posix(), path)
    if bundle == 'originals':
        for path in files_under(APP / 'public/global-history/source'):
            add('source/' + path.relative_to(ROOT).as_posix(), path)
        for original_root in detail_original_roots:
            for path in files_under(original_root):
                add('source/' + path.relative_to(ROOT).as_posix(), path)
        if history_original_root:
            for path in files_under(history_original_root):
                if is_original_input(path):
                    add('source/' + path.relative_to(ROOT).as_posix(), path)
    required_members = (['dist/index.html', 'dist/alpha/historical-manifest.json', 'dist/alpha/fixture-manifest.json'] if include_runtime else [])
    required_members += (['source/apps/explorer/package.json', 'source/apps/explorer/pnpm-lock.yaml',
                     'source/apps/explorer/tests/fixture.test.ts', 'source/packages/contracts/src/index.ts',
                     'source/lib/readiness/chronology.ts'] if include_source else [])
    for required in required_members:
        if required not in entries:
            raise ValueError('Required package member missing: ' + required)

    build_identity = None
    if options.review_profile in {'integrated', 'global', 'detail', 'glass', 'history', 'teaching'}:
        for required in ['dist/build-info.json', 'dist/integrated/world-manifest.json',
                         'dist/integrated/catalog.json', 'dist/integrated/dossiers/manifest.json']:
            if not (APP / required).is_file():
                raise ValueError('Integrated production build missing required member: ' + required)
        if expanded_profile:
            for required in ['global-history/catalog.json', 'global-history/coverage.json', 'global-history/source/input-manifest.json']:
                if not (APP / 'dist' / required).is_file() or not (APP / 'public' / required).is_file():
                    raise ValueError('Global product missing required member: ' + required)
        if detail_profile:
            for required in ['detail/terrain.json', 'detail/terrain-rights.json', 'detail/places.json', 'detail/places-rights.json', 'detail/population.json', 'detail/population-rights.json']:
                if not (APP / 'dist' / required).is_file() or not (APP / 'public' / required).is_file():
                    raise ValueError('Detail product missing required member: ' + required)
        if glass_profile:
            for required in ['glass/context-data.json', 'glass/source-inventory.json', 'glass/image-inventory.json',
                             'glass/map-metrics.json', 'glass/metrics-receipt.json']:
                if not (APP / 'dist' / required).is_file() or not (APP / 'public' / required).is_file():
                    raise ValueError('Glass context product missing required member: ' + required)
        if history_profile:
            for required in ['history/cities.json', 'history/capitals.json', 'history/state-histories.json',
                             'history/sources-state-register.json', 'history/political-review.json',
                             'history/political-admission-receipt.json', 'history/city-build-manifest.json',
                             'history/city-quarantine.json', 'history/city-alignments.json',
                             'history/source/CITY_DATA_ATTRIBUTION.txt', 'history/source/UN-WUP2025-METADATA.txt']:
                if not (APP / 'dist' / required).is_file() or not (APP / 'public' / required).is_file():
                    raise ValueError('Historical Cities product missing required member: ' + required)
        if teaching_profile:
            for required in ['src/teaching-data.ts', 'src/teaching-studies.ts', 'src/teaching-overlay.ts',
                             'src/state-coverage.ts', 'src/history-ruler.ts', 'src/canvas-map.ts',
                             'src/gl-map.ts', 'scripts/compile-state-coverage.py']:
                if not (APP / required).is_file():
                    raise ValueError('Teaching Atlas source missing required member: ' + required)
            for required in ['history/state-coverage.json', 'history/exchange-networks.json',
                             'history/historical-foundations.json', 'history/primary-accounts.json']:
                if not (APP / 'dist' / required).is_file() or not (APP / 'public' / required).is_file():
                    raise ValueError('Teaching Atlas product missing required member: ' + required)
        build_identity = json.loads((APP / 'dist/build-info.json').read_text())
        # Do not pair a newly edited checkout with stale production assets.
        fingerprint_paths = []
        for directory in [APP / 'src', ROOT / 'packages/contracts/src', APP / 'public']:
            fingerprint_paths.extend(files_under(directory))
        fingerprint_paths.extend(APP / name for name in ['index.html', 'vite.config.ts', 'package.json', 'pnpm-lock.yaml'])
        source_inputs = []
        for path in sorted(fingerprint_paths, key=str):
            content = path.read_bytes()
            source_inputs.append({'path': path.relative_to(ROOT).as_posix(), 'byte_length': len(content), 'sha256': digest(content)})
        compact = lambda value: json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()
        if digest(compact(source_inputs)) != build_identity.get('source_fingerprint'):
            raise ValueError('Integrated source bytes differ from the production build identity; rebuild before packaging.')
        bundle_files = build_identity.get('bundle_files')
        if not isinstance(bundle_files, list) or not bundle_files:
            raise ValueError('Integrated build identity has no bundle inventory.')
        for row in bundle_files:
            path = APP / 'dist' / row['path']
            if not path.resolve().is_relative_to((APP / 'dist').resolve()):
                raise ValueError('Invalid emitted bundle path.')
            content = path.read_bytes()
            if len(content) != row['byte_length'] or digest(content) != row['sha256']:
                raise ValueError('Emitted production bundle differs from build identity: ' + row['path'])
        if digest(compact(bundle_files)) != build_identity.get('bundle_fingerprint'):
            raise ValueError('Integrated bundle inventory fingerprint mismatch.')
        expected_id = 'chronicle-' + digest(compact({'source_fingerprint': build_identity['source_fingerprint'], 'bundle_fingerprint': build_identity['bundle_fingerprint']}))
        if build_identity.get('build_id') != expected_id:
            raise ValueError('Integrated deterministic build identity mismatch.')

    readme = f'''# Chronicle Explorer Alpha — VP07 Wave C review candidate

Run this exact production build with Node 22.13 or later:

```text
node serve.mjs
```

Open http://127.0.0.1:4173/ in a local browser. No package installation or remote tile service is needed for this launch. Keep the terminal running. Choose Meridian Isles in the Atlas menu for the deliberately synthetic Aster/Cedar/Boreal fixture. `?renderer=canvas` requests the WebGL-independent Canvas adapter.

The candidate has source-vector display geometry, independent neutral land context, a native PMTiles vector route, one long-lived MapLibre instance, entity-wide hover, keyboard playback controls, and compiled population lookups. Historical coverage remains 31 original observations (200 BCE–1900 CE); a separate 1847 movement observation supplies no political borders. Population in the real 1900 card is an England and Wales regional reference; the full UK total remains unavailable. Unsupported dates remain gaps.

Source baseline: `{baseline}`. Candidate source commit: `{commit}`. `package-inventory.json` binds every included file to its byte length and SHA-256. Exact browser scenarios, screenshots, regression results and remaining gaps are in `verification/alpha/`; do not infer unexecuted results from this packaging step. Physical Windows and software WebGL require their own actual run receipts. A Canvas pass or WebGL2 probe does not certify them.

The public historical ledger remains unchanged. This is a staged application and data candidate, not approval for historical publication. Rights, attribution, exact source editions, retained inputs and exclusions are under `dist/alpha/`, `dist/people/` and `dist/wave-b/source/`. Full Historical Basemaps GPL terms and third-party notices are included. The broader existing application is not replaced by this regional candidate.

For a source rebuild and the retained regression suite, see `source/README.md`. For physical-device acceptance, read `source/apps/explorer/fixtures/ALPHA-VERIFICATION.md` and the receipt template before recording results.
'''
    source_readme = f'''# Reproducible Explorer source subset

Baseline: `{baseline}`. Candidate: `{commit}`.

This directory preserves the app, pinned manifest/lockfile, contracts, fixtures, tests, compilers and retained source inputs in their repository-relative layout. It also includes the read-only root chronology adapter imported by the original fixture suite. It is an Explorer engineering checkout, not a replacement for the wider Chronicle database or repository.

From `apps/explorer/`, with Node >=22.13 and pnpm 11.19.0:

```text
pnpm install --frozen-lockfile
pnpm run build
pnpm test
node scripts/verify-alpha.mjs
node serve.mjs
```

Build before tests: the HTTP server regression reads `dist`. Production serving requires no development dependency installation; use the outer package's prebuilt `dist` for that path.

Retained `public` inputs permit the Alpha display and lookup products to be recompiled without historical scraping. The current display compiler is a Linux/POSIX engineering command using a pinned Python `pmtiles==3.8.1` environment at `.sites-runtime/fixture-build/venv/bin/python`; it is not needed for a Windows production/GPU run. To create that compiler environment and reproduce the new products on the documented platform:

```text
python3 -m venv .sites-runtime/fixture-build/venv
.sites-runtime/fixture-build/venv/bin/python -m pip install pmtiles==3.8.1
python3 scripts/build-population-observation.py
python3 scripts/build-alpha-land.py
node --max-old-space-size=256 --import tsx scripts/build-alpha.mjs
node --import tsx scripts/build-population-lookups.mjs
pnpm run build
pnpm test
```

The retained VP06 full-grid rebuild script still expects the wider repository's original data/mesh inputs; this subset does not claim to recreate the unavailable earlier SQLite/runtime archive. Its admitted grid/source derivatives and corresponding compiler source remain included under `public/wave-b/source`, unchanged. See `fixtures/ALPHA-CARTOGRAPHY.md`, `fixtures/PEOPLE.md`, and `fixtures/WAVE-B.md` for exact editions, bounds, rights and interpretation.

Runtime caches, installed dependencies, prior delivery archives and this ZIP itself are excluded. Rebuilding dependencies may require approved registry access; the production package runs offline against its local files.
'''
    if options.review_profile == 'motion':
        readme = readme.replace('VP07 Wave C review candidate', 'VP08 Lane A first runnable slice')
        readme = readme.replace('Exact browser scenarios, screenshots, regression results and remaining gaps are in `verification/alpha/`', 'Current exact browser scenarios, screenshots, regression results and remaining gaps are in `verification/motion/`; retained VP07 receipts are under `verification/alpha/`')
        readme += """
## Lane A motion review

Read `verification/motion/REVIEW.md` first. This slice introduces exact canonical-day `seekTime`, immediate cursor input, continuous playback with ordered commit barriers, an explicit observation tour, and bounded warm PMTiles ranges/directories independent of live GPU sources. Open Exact date & day steps for `1050-01-01 CE` input; use the diagnostics drawer for Simulate 500 ms delivery. Historical coverage and source precision are unchanged.

The compressed warm cache is capped at 1 MiB, four idle archives, eight chunks per archive, sixteen directory entries per archive, and two concurrent neighbor-header prefetches. Canvas retains its existing two-scene cache; native PMTiles warm-cache measurements are a separate Node HTTP profile. No global catalog, worldwide ingestion, historical publication, or physical GPU certification is included. Stop here for review before the global catalog.
"""
    if options.review_profile == 'integrated':
        readme = f'''# Chronicle VP08 Integrated Explorer — review candidate

Run the included production application with Node 22.13 or later:

```text
node serve.mjs
```

Open http://127.0.0.1:4173/ in a local browser. The runnable package needs no
dependency installation or remote tile service; keep the terminal running.
`?renderer=canvas` selects the WebGL-independent Canvas adapter. The deliberately
synthetic Meridian Isles fixture remains available in the Atlas menu.

This integrated candidate connects the main continuous timeline, explicit Exact
and Atlas reference views, global neutral geography, one bounded 1900 world
political overview, retained Isles detail and a Place/Polity inspector. Three
prewritten dated dossiers cover Scotland in 1600, France in 1700 and the United
Kingdom in 1900. Their local overviews and verified further-reading links are
separate from the border source; no prose is generated at runtime.

In Exact view, unsupported dates remain gaps. In Atlas reference view, an earlier
compatible observation may remain visible as clearly dated context: the browsing
date and reference map date are distinct. Reference display does not extend
historical validity, interpolate borders, change the card's historical date or
make an exact-history export. Before a route's first observation there is no
earlier reference. The user's selected entity/place intent can survive missing
representation without inventing an active polity or settlement.

The world physical layer is complete retained Natural Earth land, labeled as
modern geographic context rather than historical shoreline evidence. The world
political layer contains one nominal 1900 observation: 111 admitted source
features representing 94 entities and 280 polygon parts. All 159 omitted source
features remain explicitly documented. Regional detail retains 31 observations
from 200 BCE through 1900 CE plus an independent 1847 migration observation.
Other world dates do not gain political coverage. Exclusive route precedence
prevents simultaneous world/regional political painting or picking. No modern
country layer substitutes for missing history.

Use the primary time slider and Space for continuous playback. Observation tour
and precise date controls remain explicit alternatives. Selection pauses playback
by default. Normal controls expose geography navigation, Place/Polity inspection,
local dated overviews and the optional 500 ms delivery simulation in diagnostics.
Consult the acceptance matrix for which interactions were actually executed.

Baseline source commit: `{baseline}`.
Candidate package source commit: `{commit}`.
Production build ID: `{build_identity['build_id']}`.
Git HEAD recorded at build: `{build_identity['source_commit']}`.

`dist/build-info.json` binds exact emitted bundles and source/input bytes. Its
source commit is Git HEAD at build time; a later report-only package commit may
differ. The source fingerprint also covers uncommitted bytes if present.
`package-inventory.json` binds every included member by length and SHA-256.
These identities describe the candidate, not a deployment or publication.

Current screenshots, before/after evidence, scenario observations and the short
acceptance matrix are in `verification/integrated/`. Inherited Lane A and VP07
receipts remain in `verification/motion/` and `verification/alpha/`. Code-only
implementation, Canvas execution, native MapLibre execution and physical-device
performance are distinct evidence levels. A user-reported hardware renderer is
not automatically a complete measured performance profile; unexecuted scenarios
must remain NOT RUN. Packaging success does not establish acceptance.

The public historical ledger, immutable audit mesh, earlier recorded editions
and Hawaiʻi quarantine are unchanged. This is a staged application/data candidate
pending exact-result review, not approval for historical publication. Source
editions, hashes, rights, attribution, mapping choices and exclusions are retained
under `dist/integrated/`, `dist/alpha/`, `dist/people/` and `dist/wave-b/source/`.
Full Historical Basemaps GPL terms and third-party notices are included.

See `source/README.md` for a source rebuild. No globe/satellite renderer, new
database, broad worldwide intake or new packaging framework is introduced.
'''
        source_readme += '''
## Integrated world and dossier products

The integrated world compiler reuses the existing Alpha PMTiles writer. Its
retained full pinned `world_1900.geojson`, classification, rights record, source
inventory and frozen resource budget are under `public/integrated/`. The complete
Natural Earth source ZIP remains under `public/alpha/source/`. No retrieval or
root-ledger mutation is required to reproduce the new bounded products:

```text
node --max-old-space-size=256 --import tsx scripts/build-integrated-world.mjs
pnpm run build
pnpm test
```

The Vite build emits `dist/build-info.json`. Its deterministic build ID hashes
emitted bundle identities plus the actual application source, contracts, public
inputs, entry HTML, Vite configuration and pinned package/lockfile bytes. Git
metadata and timestamps do not enter the build ID. An extracted source checkout
without Git records a null source commit while retaining deterministic byte
identity. The integrated packaging profile rejects stale build/source mixtures.

Dossier JSON, explicit valid-time context and reviewed source/link references are
retained under `public/integrated/dossiers/`. Broader linked articles are further
reading, not automatically snapshots valid at the selected historical date.
'''
    if expanded_profile:
        catalog = json.loads((APP / 'public/global-history/catalog.json').read_text())
        coverage = json.loads((APP / 'public/global-history/coverage.json').read_text())
        observations = catalog['observations']
        primary = [row for row in observations if row['year'] >= -200]
        earlier = [row for row in observations if row['year'] < -200]
        if len(observations) != coverage['compiled_observations']:
            raise ValueError('Global catalog and coverage observation counts disagree.')
        label = lambda year: str(abs(year)) + (' BCE' if year < 0 else ' CE')
        extent = f"{label(min(row['year'] for row in observations))} through {label(max(row['year'] for row in observations))}"
        launch = '''Run this exact prebuilt application with Node 22.13 or later:

```text
node serve.mjs
```

Open http://127.0.0.1:4173/ and keep the terminal running. This launch needs no
package installation or remote tile service. `?renderer=canvas` selects Canvas.
The matching Source and Originals packets are required only for rebuilding and
compiler review. Runnable alone contains all application assets and evidence
sidecars needed to explore the maps offline.
''' if include_runtime else '''This is the matching source packet, not a prebuilt application. For the immediate
offline launch, extract the companion Runnable packet and run `node serve.mjs`
at its root. For a rebuild, extract both Source and Originals packets into the
same parent directory (their `Chronicle-Explorer/source/` trees merge), then
follow `source/README.md`. No originals are downloaded or substituted.
'''
        if bundle == 'originals':
            launch = '''This packet retains the exact original source collection, plus its input
inventory, pin, attribution and rights records. It is not a standalone app.
Extract it and the Source packet into the same parent directory; the existing
`Chronicle-Explorer/source/apps/explorer/public/global-history/source/input/`
path is restored directly. No installer or restore script is required. Runnable
alone already has the compiled maps and evidence sidecars needed for offline
exploration; raw originals are used only for reproducibility and source review.
'''
        readme = f'''# Chronicle Global History — {bundle.title()} review packet

{launch}
The integrated catalog contains **{len(observations)} compiled observations**
({len(primary)} primary observations from 200 BCE onward and {len(earlier)} earlier
extension observations), spanning {extent}. Intended inputs:
{coverage['intended_observations']}; recovered inputs: {coverage['recovered_inputs']};
compiler failures/pending records: {len(coverage['failures'])}. These are product
counts, not historical certification or proof that every browser scenario ran.
Use `verification/global-history/REVIEW.md` and its matching receipts for actual
on-screen acceptance. Earlier receipts are retained as explicitly dated baseline
evidence under `verification/integrated`, `verification/motion` and
`verification/alpha`; they do not certify this expanded build.

The existing main timeline, observation controls, Exact/reference policies and
world/Isles route select the admitted dates. Historical Basemaps political
associations, cultural presence and source context have distinct meanings.
The data are source-attributed; independently reviewed observations remain
{coverage['independently_reviewed_observations']}. Unknowns, review exceptions,
source anomalies and protected Hawaiʻi components remain documented omissions.
Feature counts are not percentages of geographic or historical completeness.
The 2010 observation is not present-day geography. Global neutral land is modern
physical context, not evidence of historical shorelines. Population/migration
sample dates and the three researched Isles dossiers remain independently dated.

Exact view preserves the source observation windows. Reference view may retain
only a compatible earlier map, labeled with its source date separately from the
requested browsing date. Unsupported intermediate borders are not interpolated,
reference-held years are not added coverage, and retained selection intent does
not invent an active polity. The synthetic Meridian Isles fixture remains in
the Atlas selector. No public historical ledger or prior edition is changed.

Baseline commit: `{baseline}`.
Candidate source commit: `{commit}`.
Production build ID: `{build_identity['build_id']}`.
Git HEAD recorded at build: `{build_identity['source_commit']}`.

All three packets record the same production build/source fingerprints in their
`package-inventory-runnable.json`, `package-inventory-source.json` or
`package-inventory-originals.json`. The source and emitted-bundle fingerprints
are checked before any ZIP can be written. A later report-only commit may differ from
build-time Git HEAD without changing the exact application bytes. Each packet
also has its own complete member hashes and external delivery receipt.

Source edition and license records, dated mappings, per-feature decisions,
coverage totals and compiler receipts are preserved under `dist/global-history/`
in the Runnable packet and `source/apps/explorer/public/global-history/` in the
Source packet. Raw GeoJSON originals are retained byte-for-byte in the Originals
packet, in the matching source tree's `global-history/source/input/` directory.
Extracting Source plus Originals restores the complete source fingerprint.
Source links in map cards still identify the exact pinned upstream originals.
Shared land,
existing regional products, enriched dossiers and their attribution are retained
alongside them. Full GPL-3.0 terms and third-party notices are included. Neither
packet requires a full-collection runtime download: the browser uses bounded
active manifests, scenes, PMTiles range caches and neighboring prefetch.

The packaging-only budget revision is recorded in
`verification/global-history/packaging-budget.json`. Each of the three split packets is capped
at 256 MiB uncompressed input and below 50,000,000 compressed bytes; compiler and
browser memory limits are unchanged. Runtime caches, installed dependencies,
prior review ZIPs and delivery hashes are excluded, while source-input ZIPs are
preserved. Packaging success does not imply historical publication or measured
native GPU performance. Unexecuted software/native profiles remain NOT RUN in
the acceptance matrix.
'''
        source_readme += '''
## Expanded global products

The forty primary source observations and admitted earlier extension use one
parameterized, sequential compiler. Full originals, exact source pin and rights,
input manifest, reusable dated mappings, per-feature outcomes and the revised
frozen budget are retained under `public/global-history/`. The complete primary
gate was preserved under `verification/global-history/primary-40/` before the
earlier-date extension. Source labels are not independent historical review.

The ordinary application rebuild above consumes already compiled products and
does not require Python. To rerun the global display compiler on Linux/POSIX,
use the retained Python environment prerequisites documented in the compiler
receipt, then run:

```text
node --max-old-space-size=256 --import tsx scripts/build-global-history.mjs
pnpm run build
pnpm test
```

Each observation resumes only when source, mapping, configuration and retained
asset hashes match. A compile failure remains explicit while unrelated inputs
continue. The root catalog is bounded and points to per-observation manifests;
physical land is shared. This command does not reconstruct or modify the public
SQLite ledger, independently certify history, or retrieve arbitrary new inputs.

Extract the companion Originals packet into the same parent directory before
source rebuild or compiler execution; its raw inputs restore the source tree
without renaming or converting any bytes. The companion Runnable packet includes
the exact prebuilt `dist` and server.
To inspect final UI evidence use the outer `verification/global-history/` folder.
'''
    if detail_profile:
        readme = readme.replace('# Chronicle Global History —', '# Chronicle V2 Detail —')
        readme = readme.replace('Use `verification/global-history/REVIEW.md` and its matching receipts for actual\non-screen acceptance. Earlier receipts are retained as explicitly dated baseline\nevidence under `verification/integrated`, `verification/motion` and',
                                'Use `verification/detail/REVIEW.md` and its matching receipts for current\non-screen acceptance. Earlier receipts are retained as explicitly dated baseline\nevidence under `verification/global-history`, `verification/integrated`, `verification/motion` and')
        readme = readme.replace('The packaging-only budget revision is recorded in\n`verification/global-history/packaging-budget.json`. Each of the three split packets is capped\nat 256 MiB uncompressed input and below 50,000,000 compressed bytes; compiler and\nbrowser memory limits are unchanged.',
                                'The detail packaging budget was explicitly frozen in\n`verification/detail/packaging-budget.json`. Each packet is capped at 512 MiB\nuncompressed; Runnable/Source must stay below 96 MiB compressed and Originals\nbelow 128 MiB. These larger limits apply only to this detail profile. Existing\nglobal-profile limits, compiler budgets and browser memory limits are unchanged.')
        readme += '''
## V2 geographic detail and independent population

The existing historical timeline and catalog are retained. The detail product
adds an offline Natural Earth relief tile pyramid, rivers and natural lakes;
dated Pleiades settlement context plus separately identified modern orientation
places; and four independently dated modeled population-density observations
(1910, 1950, 2000, 2010). Physical geography and modern place names are context,
not backdated historical claims. Population surfaces retain their own dates,
unknown cells and model limitations; they do not imply migration routes or
polity population totals. No continuous historical borders are fabricated.

Read the retained `detail/terrain-README.md`, `detail/PLACES-README.md` and
`detail/POPULATION-README.md`, with their rights/edition/hash records, under
`dist/` in Runnable or `source/apps/explorer/public/` in Source. Product
validation is distinct from browser evidence; see the current detail review.

Runnable and Source include every compiled detail product and the small original
source manifests, licenses, versions and READMEs at their existing paths.
The exact detail ZIP/NetCDF originals are in the companion
`Chronicle-V2-Detail-Originals.zip`, together with the global raw GeoJSON inputs.
Extract Source and Originals into the same parent directory: their
`Chronicle-Explorer/source/` trees merge without conversion. These originals are
not runtime dependencies. The full original assets remain available for source
review and deterministic recompilation; nothing is silently discarded.
'''
        source_readme += '''
## Offline detail products

Extract the matching `Chronicle-V2-Detail-Originals.zip` alongside Source before
rebuilding so the complete public-input fingerprint is restored. This includes
the exact Natural Earth and Pleiades ZIPs and pinned population NetCDF file.
Existing source metadata is identical in both packets. The immediate runnable
launch still requires only `node serve.mjs`; it does not read these raw inputs.

The retained compiled products support an ordinary `pnpm run build` without
rerunning their data compilers. To reproduce detail data, read the three detail
READMEs and build receipts first. On the documented Linux/POSIX profile, install
the recorded Python dependency versions, then run sequentially:

```sh
flock /tmp/chronicle-detail-compile.lock python3 scripts/build-detail-places.py
flock /tmp/chronicle-detail-compile.lock python3 scripts/build-detail-terrain.py
python3 scripts/build-population-detail.py
pnpm run build
pnpm test
```

Population compilation takes the same lock internally. Do not wrap that command
in a second lock. Compilers verify retained sources and fixed budgets before
processing; no ledger writes or unrestricted source retrieval are performed.
Current screenshot/interaction evidence is in outer `verification/detail/`.
'''
    if detail_profile:
        for label in ['Runnable', 'Source', 'Originals']:
            readme = readme.replace(f'Chronicle-Global-History-{label}.zip', f'Chronicle-V2-Detail-{label}.zip')
            source_readme = source_readme.replace(f'Chronicle-Global-History-{label}.zip', f'Chronicle-V2-Detail-{label}.zip')
    if glass_profile:
        readme = readme.replace('# Chronicle V2 Detail —', '# Chronicle Glass Beta —')
        readme = readme.replace('Use `verification/detail/REVIEW.md` and its matching receipts for current',
                                'Use `verification/glass/REVIEW.md` and its matching receipts for current')
        readme = readme.replace('evidence under `verification/global-history`,',
                                'evidence under `verification/detail`, `verification/global-history`,')
        readme = readme.replace('The detail packaging budget was explicitly frozen in\n`verification/detail/packaging-budget.json`.',
                                'The Glass Beta packaging budget was explicitly frozen in\n`verification/glass/packaging-budget.json`, preserving the V2 Detail limits.')
        readme = readme.replace('These larger limits apply only to this detail profile.',
                                'These limits apply to the detail/glass profiles only.')
        readme = readme.replace('see the current detail review.', 'see the current Glass Beta review.')
        for label in ['Runnable', 'Source', 'Originals']:
            readme = readme.replace(f'Chronicle-V2-Detail-{label}.zip', f'Chronicle-Glass-Beta-{label}.zip')
            source_readme = source_readme.replace(f'Chronicle-V2-Detail-{label}.zip', f'Chronicle-Glass-Beta-{label}.zip')
        source_readme = source_readme.replace('Current screenshot/interaction evidence is in outer `verification/detail/`.',
                                              'Current screenshot/interaction evidence is in outer `verification/glass/`.')
        readme += f'''
## Selected historical context and continuous time ruler

This candidate adds the transparent glass interface, an on-demand selected-polity
context card, a continuous zoomable time ruler and explicit historical-event
filters. The context product contains prewritten dated material and attributed
museum images; image dates and source qualifiers are retained. The map metrics
are compiled measurements of admitted display geometries, not independent
historical territorial or population estimates. Read `dist/glass/` (Runnable) or
`source/apps/explorer/public/glass/` (Source) for scope, mappings, methods, rights
and budgets. Unknown succession, population and contextual details remain
unknown. Timeline event markers do not create additional political observations.

This checkout was reconstructed byte-for-byte from the retained V2 Source and
Originals packets. Original V2 implementation commit:
`b01e3c3d61921d725c7306d7a82e0c75ba5b7703`; original review commit:
`51385d4fe6a356dcc280afe18476eabc809b0e2b`; local reconstruction baseline:
`{baseline}`. The earlier Git history is not present in this source subset.
The baseline above identifies the reconstruction, not a rewritten historical
edition or a claim that previous commits are in the current repository.

Only `verification/glass/` records acceptance of this build. Retained older
reports describe their own earlier builds. Packaging is not an interaction test.
The public ledger, recorded editions and explicit quarantine remain protected.
'''
        source_readme += f'''
## Glass Beta context products and reconstruction

The local baseline `{baseline}` restores the exact retained V2 source packet
(original implementation `b01e3c3d61921d725c7306d7a82e0c75ba5b7703`). The prior Git
history is not included. Source plus Originals preserves the current complete
source fingerprint, including context data, museum image records and compiled
metrics. The source fingerprint is verified against `dist/build-info.json`
before packaging. Existing raw historical products are retained unchanged.

For context-metric recompilation, use the bounded compiler and retained budget:

```text
node --import tsx scripts/compile-context-metrics.ts
pnpm run build
pnpm test
```

`public/glass/context-data.json` is authored static content, not runtime-generated
history. Its source and image inventories identify the retained references and
rights. See the current `verification/glass/REVIEW.md` for measured acceptance,
content coverage and explicit omissions.
'''
    if history_profile:
        readme = f'''# Chronicle Historical Cities — {bundle.title()} packet

Application commit: `{commit}`. Production build: `{build_identity['build_id']}`.
This release continues the recovered Glass Beta with dated historical city
records and reviewed polity context. `verification/history/REVIEW.md` describes
this exact release's coverage, admission decisions, tests and remaining limits.
All other verification folders retain evidence for their earlier builds.

The separate `Chronicle-Historical-Cities-Windows-x64.exe` contains the same
runtime application. Double-click it to use your installed default browser;
no Node, installer or administrator access is required. Keep its small launcher
window open while exploring. Native Windows and physical-GPU behavior require
actual Windows execution; a Linux cross-build does not establish them.

For this Runnable packet, run `node serve.mjs` from the extracted
`Chronicle-Explorer` folder using the Node version in the pinned package manifest.
The local server supports PMTiles ranges. Source and Originals packets are for
reproduction, not prerequisites for using the executable or Runnable packet.

To rebuild, extract `Chronicle-Historical-Cities-Source.zip` and
`Chronicle-Historical-Cities-Originals.zip` into the same directory; their
`source/` trees merge. Read `source/README.md`. Exact original ZIP, NetCDF,
historical GeoJSON and city CSV/XLSX inputs remain in Originals, with metadata, attribution
and licenses retained in Source and Runnable. No historical dataset retrieval
or conversion is required to restore this release's source fingerprint.

`package-inventory-{bundle}.json` binds every member to its SHA-256 and size.
The history packaging budget inherits Glass Beta's limits without increases:
512 MiB input per packet; Runnable/Source below 96 MiB compressed; Originals
below 128 MiB. The public ledger and public Site are not changed by packaging.
'''
        source_readme = f'''# Chronicle Historical Cities — reproducible source

Application commit: `{commit}`. Production build: `{build_identity['build_id']}`.
Recovered source baseline: `{baseline}`. Earlier Git history is not bundled.

Extract the matching Source and Originals packets into the same parent, then
enter `source/apps/explorer`. Use the Node and pnpm versions pinned in
`package.json`; install with `pnpm install --frozen-lockfile`, run `pnpm test`,
and build with `pnpm run build`. The restored source, public assets, retained
compiler inputs and contracts reconstruct the current source fingerprint.
The retained older full-grid compiler still needs the wider project's mesh
inputs; this engineering subset does not claim to recreate that older ledger.

Current release evidence is in the outer `verification/history/` directory.
`public/history/` retains authored records and their source registers. Historical
uncertainty and admission limits remain explicit; smooth timeline motion does
not create additional observed dates or city/population evidence.
The city compiler is `scripts/compile-historical-cities.py`; alignment and
quarantine receipts remain under `public/history/`. Restore raw CSV/XLSX inputs
to `public/history/source/` from Originals before rerunning the compiler.

The `windows-launcher/` directory contains the portable Windows wrapper source.
Its generated payload is intentionally omitted from Source. Recreate it from
the matching `Chronicle-Historical-Cities-Runnable.zip` with:

```text
python windows-launcher/make-payload.py PATH_TO_RUNNABLE_ZIP windows-launcher/Go-LICENSE.txt
```

Then follow `windows-launcher/README.md` using Go 1.26.1. The runtime requires
only an installed browser; developer tools are needed solely for rebuilding.
'''

    if teaching_profile:
        readme = readme.replace('Chronicle Historical Cities', 'Chronicle Teaching Atlas')
        readme = readme.replace('Chronicle-Historical-Cities-', 'Chronicle-Teaching-Atlas-')
        readme = readme.replace('verification/history/REVIEW.md', 'verification/teaching/REVIEW.md')
        readme = readme.replace('This release continues the recovered Glass Beta with dated historical city\nrecords and reviewed polity context.',
                                'This edition continues Historical Cities with a docked timeline, a study entry\nfor every represented source state, and sourced teaching cases for power, trade,\necological context, belief, language and contemporary accounts.')
        readme = readme.replace("The history packaging budget inherits Glass Beta's limits without increases:",
                                'The teaching packaging budget inherits the Historical Cities limits without increases:')
        readme += '''
Study-entry coverage describes the represented source catalog, not every state
that has ever existed or a fully researched biography for every year. Authored
histories, catalog descriptions and linked reading have distinct evidence levels.
Teaching geometries are explicitly approximate: relationship links are not state
borders, broad ecology zones are not annual climate observations, and religious
or linguistic evidence sites are not demographic heatmaps. Primary accounts
retain their own observation and composition dates, perspectives and limitations.

The packaged source register and case notes remain available offline. Opening
external source pages requires an internet connection. Blank teaching areas mean
no case has been authored there, not historical absence. See the current review
for the tested features and remaining coverage gaps.
'''
        source_readme = source_readme.replace('Chronicle Historical Cities', 'Chronicle Teaching Atlas')
        source_readme = source_readme.replace('Chronicle-Historical-Cities-', 'Chronicle-Teaching-Atlas-')
        source_readme = source_readme.replace('verification/history/', 'verification/teaching/')
        source_readme = source_readme.replace('run `pnpm test`,\nand build with `pnpm run build`',
                                               'build with `pnpm run build`,\nand run `pnpm test`')
        source_readme += '''

Teaching data and source references are retained under `public/history/`:
`state-coverage.json`, `exchange-networks.json`, `historical-foundations.json` and
`primary-accounts.json`. The coverage compiler is `scripts/compile-state-coverage.py`.
The catalog and authored profiles document different levels of evidence; source
polygons and source-derived descriptions are not independent historical validation.

The source subset was restored from the Historical Cities Source and Originals
packets, application commit 74c1e90603772fb55b4c4741f445dde48937fe32. Its local
reconstruction baseline is recorded above; the previous complete Git history is
not present. Source plus Originals reconstructs the current source fingerprint.
The outer `verification/history/` folder is inherited evidence for that earlier
build, not a test receipt for this edition.
The small verification inputs used by regression tests are also preserved inside
`source/apps/explorer/verification/`; no manual copy from the outer review folders
is needed for `pnpm run build` followed by `pnpm test`. Continuity-fixture recovery
is documented there, distinguishing exact pinned mappings from a newly regenerated
geometry baseline.
'''

    readme_name = f'README-{bundle.title()}.md' if expanded_profile and bundle in {'source', 'originals'} else 'README.md'
    add(readme_name, readme.encode())
    if include_source:
        add('source/README.md', source_readme.encode())
    inventory = []
    total_bytes = 0
    for name, value in sorted(entries.items()):
        content = value.read_bytes() if isinstance(value, Path) else value
        total_bytes += len(content)
        if total_bytes > max_input_bytes:
            raise ValueError(f'Package input exceeds the frozen {max_input_bytes}-byte packaging budget')
        inventory.append({'path':name, 'byte_length':len(content), 'sha256':digest(content)})
    identity = {'schema_version':1, 'candidate':{'alpha':'VP07-Wave-C-Alpha', 'motion':'VP08-Lane-A-Motion-Slice', 'integrated':'VP08-Integrated-Explorer', 'global':'Global-History-Expanded-Explorer', 'detail':'V2-Detail-Explorer', 'glass':'Glass-Beta-Explorer', 'history':'Historical-Cities-Explorer', 'teaching':'Teaching-Atlas-Explorer'}[options.review_profile], 'status':'STAGED_NOT_PUBLISHED',
                'baseline_commit':baseline, 'source_commit':commit, 'public_ledger_changed':False,
                'external_source_prerequisites':[p.relative_to(ROOT).as_posix() for p in sorted(external_prerequisites)],
                'file_count':len(inventory), 'uncompressed_bytes':total_bytes,
                'inventory_exclusion':'package-inventory.json excludes itself; the external delivery receipt records the final ZIP hash.',
                'files':inventory}
    if glass_profile:
        identity['source_reconstruction'] = {
            'original_implementation_commit': 'b01e3c3d61921d725c7306d7a82e0c75ba5b7703',
            'original_review_commit': '51385d4fe6a356dcc280afe18476eabc809b0e2b',
            'reconstruction_commit': baseline,
            'prior_git_history_available': False,
            'method': 'Retained V2 Source plus Originals packets restored without input conversion.'}
    if history_profile:
        identity['source_reconstruction'] = {
            'original_application_commit': 'b3a4953cb2f60ff4a2372d9afe21a4f034ccc18f',
            'reconstruction_commit': baseline,
            'prior_git_history_available': False,
            'method': 'Delivered Glass Beta Source plus Originals restored without input conversion.'}
    if teaching_profile:
        identity['source_reconstruction'] = {
            'original_application_commit': '74c1e90603772fb55b4c4741f445dde48937fe32',
            'reconstruction_commit': baseline,
            'prior_git_history_available': False,
            'method': 'Delivered Historical Cities Source plus Originals restored without input conversion.'}
    if build_identity:
        identity['production_build'] = {key: build_identity[key] for key in ['build_id', 'source_commit', 'source_worktree_dirty', 'source_fingerprint', 'bundle_fingerprint']}
    if packaging_budget:
        identity['bundle'] = bundle
        identity['inventory_exclusion'] = 'This packet-specific inventory excludes itself; the external delivery receipt records the final ZIP hash.'
        identity['packaging_budget'] = {'budget_id':packaging_budget['budget_id'], 'sha256':digest(budget_path.read_bytes()),
                                        'input_bytes':max_input_bytes, 'zip_bytes_exclusive':max_zip_bytes}
        identity['catalog'] = {'catalog_id':catalog['catalog_id'], 'compiled_observations':len(observations),
                               'primary_observations':len(primary), 'earlier_observations':len(earlier),
                               'catalog_sha256':digest((APP / 'public/global-history/catalog.json').read_bytes())}
        original_files = sorted(path for path in source_paths if is_original_input(path))
        identity['original_inputs'] = {'packet':'Chronicle-Teaching-Atlas-Originals.zip' if teaching_profile else 'Chronicle-Historical-Cities-Originals.zip' if history_profile else 'Chronicle-Glass-Beta-Originals.zip' if glass_profile else 'Chronicle-V2-Detail-Originals.zip' if detail_profile else 'Chronicle-Global-History-Originals.zip',
                                      'runtime_required':False, 'source_rebuild_required':True,
                                      'restoration':'Extract Source and Originals packets into the same parent; repository-relative source trees merge.',
                                      'files':[{'path':'source/' + path.relative_to(ROOT).as_posix(),
                                                'byte_length':path.stat().st_size, 'sha256':digest(path.read_bytes())}
                                               for path in original_files]}
        if detail_profile:
            identity['detail'] = {'descriptors': [{'path': 'detail/' + name, 'sha256': digest((APP / 'public/detail' / name).read_bytes())}
                                                  for name in ['terrain.json', 'places.json', 'population.json']],
                                  'raw_original_directories': ['detail/source', 'detail/population-source', 'detail/terrain-source'],
                                  'small_source_metadata_retained_in_runnable': True,
                                  'physical_context_is_historical_assertion': False,
                                  'population_is_political_ownership': False}
    inventory_bytes = (json.dumps(identity, indent=2)+'\n').encode()
    if total_bytes + len(inventory_bytes) > max_input_bytes:
        raise ValueError('Package inventory exceeds the frozen package input budget')
    inventory_name = f'package-inventory-{bundle}.json' if expanded_profile else 'package-inventory.json'
    add(inventory_name, inventory_bytes)
    summary = {'source_commit':commit, 'output':str(output), 'files':len(entries), 'uncompressed_bytes':total_bytes+len(inventory_bytes),
               'root_prerequisites':identity['external_source_prerequisites'], 'dry_run':options.dry_run}
    if build_identity:
        summary['build_id'] = build_identity['build_id']
    if packaging_budget:
        summary['bundle'] = bundle
        summary['input_limit_bytes'] = max_input_bytes
        summary['zip_limit_bytes_exclusive'] = max_zip_bytes
        if bundle != 'combined':
            aggregate_bytes = summary['uncompressed_bytes']
            for sibling in ['runnable', 'source', 'originals']:
                receipt_path = output.parent / f'delivery-{sibling}.json'
                if sibling == bundle or not receipt_path.is_file():
                    continue
                receipt = json.loads(receipt_path.read_text())
                if receipt.get('source_commit') == commit and receipt.get('build_id') == build_identity['build_id']:
                    aggregate_bytes += receipt['uncompressed_bytes']
            if aggregate_bytes > packaging_budget['limits']['intended_aggregate_input_bytes']:
                raise ValueError('Matching packet set exceeds the frozen aggregate input budget')
            summary['matching_packet_set_input_bytes_so_far'] = aggregate_bytes
    if options.dry_run:
        print(json.dumps(summary,indent=2))
        return
    output.parent.mkdir(parents=True,exist_ok=True)
    temporary = output.with_suffix('.zip.tmp')
    # Fixed archive timestamps and member order: same exact files give same ZIP.
    with zipfile.ZipFile(temporary,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for name,value in sorted(entries.items()):
            info=zipfile.ZipInfo(PREFIX+name,date_time=(2026,9,23,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED
            info.external_attr=0o100644 << 16
            content=value.read_bytes() if isinstance(value,Path) else value
            expected=next((row for row in inventory if row['path']==name),None)
            if expected and (len(content)!=expected['byte_length'] or digest(content)!=expected['sha256']):
                raise ValueError('Input changed during packaging; rebuild a coherent exact-result package: '+name)
            archive.writestr(info,content,compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
    if temporary.stat().st_size >= max_zip_bytes:
        temporary.unlink()
        raise ValueError(f'Review ZIP exceeds the frozen {max_zip_bytes}-byte exclusive limit')
    with zipfile.ZipFile(temporary) as archive:
        bad=archive.testzip()
        if bad:
            raise ValueError('ZIP CRC check failed: '+bad)
    os.replace(temporary,output)
    summary.update({'byte_length':output.stat().st_size,'sha256':digest(output.read_bytes()),'package_inventory_sha256':digest(inventory_bytes),
                    'archive_crc':'PASS','public_ledger_changed':False,'publication':'STAGED_NOT_PUBLISHED'})
    receipt_name = f'delivery-{bundle}.json' if expanded_profile else 'delivery.json'
    (output.parent/receipt_name).write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary,indent=2))

if __name__ == '__main__':
    main()

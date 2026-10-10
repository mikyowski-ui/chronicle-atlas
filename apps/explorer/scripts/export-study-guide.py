#!/usr/bin/env python3
"""Export the same authored study records used by the app; no network or new claims."""
import argparse
import json
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=APP / 'verification/teaching/Chronicle-Teaching-Atlas-Study-Guide.md')
args = parser.parse_args()
read = lambda name: json.loads((APP / 'public/history' / name).read_text())
coverage = read('state-coverage.json')
histories = read('state-histories.json')['profiles']
exchange, foundations, accounts = [read(name) for name in ['exchange-networks.json', 'historical-foundations.json', 'primary-accounts.json']]
sources = {s['id']: s for dataset in [exchange, foundations, accounts] for s in dataset['sources']}
all_sources = [*sources.values(), *[s for h in histories for s in h['sources']], *coverage['sources'], *read('state-coverage-notes.json')['sources']]
unique_sources = {s['url']: s for s in all_sources}
year = lambda value: f'{abs(value):,} BCE' if value < 0 else f'{value:,} CE'
period = lambda a, b: year(a) if a == b else year(a) + '–' + year(b)
link = lambda s: f"[{s['title']}]({s['url']}) — {s['publisher']}"
lines = ['# Chronicle Teaching Atlas — Study Guide', '',
         'This guide contains the same authored narratives and evidence links as the app. It can be read without launching the atlas; external texts require an internet connection.', '',
         f"The catalog describes all {coverage['stats']['entries']:,} atlas entries across {coverage['stats']['entityObservations']:,} entity-observations. It contains {len(histories)} researched state or period histories, {len(accounts['accounts'])} primary accounts, {len(exchange['features']) + len(foundations['features'])} contextual map features, and {len(unique_sources)} distinct source URLs.", '',
         'Coverage is not uniform historical verification. Many entries currently have an atlas description and provenance record, with a separately researched life history still to be added. Cultural and contextual labels are not promoted into states. Matching names do not establish uninterrupted identity.', '',
         '## Reading the map', '',
         '- Political outlines remain dated atlas reconstructions. Soft boundaries are a display convention, not a measured uncertainty surface.',
         '- Power layers distinguish cited core, tributary, influence and autonomous relationships. They do not assign every point in a country to one category.',
         '- Exchange lines and ecological zones are schematic. Study-window endpoints do not prove the opening or closure of a route.',
         '- Religious and linguistic markers identify dated evidence. They are not demographic heatmaps or percentages of believers and speakers.',
         '- The generation filter requires both described events and composition to be within 35 years of the browsing date; later retrospective accounts remain accessible with the date filter cleared. Composition dates, author perspective and transmission limits are separate.',
         '- The political atlas has 49 world observations through 2010 and 31 regional observations; later years retain clearly labeled reference maps. City estimates extend to 2025.', '',
         '## Researched state and period histories', '']
for h in sorted(histories, key=lambda h: (h['fromYear'], h['title'])):
    lines += [f"### {h['title']}", '', h['periodLabel'], '', h['summary'], '', '**Continuity:** ' + h['continuity'], '']
    for t in h['transitions']:
        lines += [f"- **{t['dateLabel']} — {t['title']}:** {t['summary']}"]
    lines += ['', 'Sources:', '', *['- ' + link(s) for s in h['sources']], '']
lines += ['## Primary accounts', '']
for a in sorted(accounts['accounts'], key=lambda a: (a['eventFromYear'], a['title'])):
    lines += [f"### {a['title']}", '', f"{a['author']} · {a['place']}", '',
              f"Described events: {period(a['eventFromYear'], a['eventToYear'])}. Composed or compiled: {period(a['writtenFromYear'], a['writtenToYear'])}.", '', a['summary'], '']
    if a.get('excerpt'):
        lines += [('> ' if a['excerptKind'] == 'quotation' else '**Paraphrase:** ') + a['excerpt'], '']
    lines += ['**Perspective:** ' + a['perspective'], '', '**Limits:** ' + a['limitations'], '', 'Sources:', '', *['- ' + link(sources[i]) for i in a['sourceIds']], '']
lines += ['## Connections and foundations', '']
for f in sorted([*exchange['features'], *foundations['features']], key=lambda f: (f['category'], f['fromYear'], f['title'])):
    lines += [f"### {f['title']}", '', f"{f['category'].title()} · study window {period(f['fromYear'], f['toYear'])}", '', f['summary'], '', '**Reading limits:** ' + f['limitations'], '', 'Sources:', '', *['- ' + link(sources[i]) for i in f['sourceIds']], '']
lines += ['## Complete source-link register', '', 'Distinct URLs are counted; different links may refer to the same work, translation or institution.', '']
lines += ['- ' + link(s) for s in sorted(unique_sources.values(), key=lambda s: (s['publisher'], s['title']))]
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text('\n'.join(lines) + '\n')
print(json.dumps({'path': str(args.output), 'profiles': len(histories), 'sources': len(unique_sources), 'accounts': len(accounts['accounts']), 'features': len(exchange['features']) + len(foundations['features']), 'bytes': args.output.stat().st_size}))

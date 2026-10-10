#!/usr/bin/env python3
"""Compile an exhaustive index of admitted source labels, not an invented state gazetteer.

Run from any directory. All inputs are shipped with the source bundle. First/last
observation years are explicitly not foundation/dissolution or interpolated validity.
"""
from pathlib import Path
import argparse, collections, hashlib, json, re

ROOT = Path(__file__).resolve().parents[1]
def read(path): return json.loads(path.read_text(encoding='utf-8'))
def yformat(year): return f'{abs(year):,} BCE' if year < 0 else f'{year:,} CE'
def norm(value): return value.strip().lower()

def compile_coverage(root=ROOT):
    histories = read(root / 'public/history/state-histories.json')['profiles']
    critiques = read(root / 'public/history/state-coverage-notes.json')
    rules=read(root / 'public/history/political-review.json')['rules']
    def civil_date(value):
        match=re.fullmatch(r'(-?[0-9]+)-([0-9]+)-([0-9]+)',value)
        return tuple(map(int,match.groups()))
    def chronology_review(name,kind,year):
        if kind!='political': return {'allowed':True}
        rule=next((r for r in rules if name in r['labels'] and year<=r.get('source_year_max',10**9)),None)
        if not rule:return {'allowed':True}
        windows=rule.get('intervals',[[rule.get('start_inclusive','-999999-01-01'),rule.get('end_exclusive','999999-01-01')]])
        allowed=any(civil_date(start)<=(year,1,1)<civil_date(end) for start,end in windows)
        return {'allowed':allowed,'ruleId':rule['id'],'note':rule['note'],'sources':rule['sources']}
    catalog = read(root / 'public/global-history/catalog.json')
    alpha = read(root / 'public/alpha/historical-manifest.json')
    inputs=[]
    for observation in catalog['observations']:
        path=root/'public/global-history'/observation['manifest']
        manifest=read(path)
        metadata=path.parent/manifest['epochs'][0]['metadata']['url']
        inputs.append(('world', observation['year'], metadata, manifest['source']))
    for epoch in alpha['epochs']:
        name=epoch['epoch_id'].removeprefix('isles-')
        if not re.fullmatch(r'(?:bce)?[0-9]+', name): continue
        year=-int(name[3:]) if name.startswith('bce') else int(name)
        inputs.append(('isles',year,root/'public/alpha'/epoch['metadata']['url'], alpha['source']))
    entries={}; sources={}; observations=[]
    for scope,year,path,source in inputs:
        data=read(path); observation_id=f'{scope}:{year}'
        source_id=f'atlas:{year}'
        evs=data['evidence']; ev0=next(iter(evs.values()),{})
        sources[source_id]={'id':source_id,'title':f'Historical Basemaps · {yformat(year)}',
            'publisher':'André Ourednik and contributors', 'url':ev0.get('source_url',source['url']),
            'license':source.get('license','GPL-3.0'), 'type':'overview-map',
            'edition':source.get('edition',source.get('pinned_revision','')),
            'limitations':'Compiled overview without individual documentary citations for most features; not independent verification of borders or sovereignty.'}
        observations.append({'id':observation_id,'scope':scope,'year':year,
            'sourceId':source_id,'metadataPath':str(path.relative_to(root/'public')),
            'metadataSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'entityCount':len(data['entities'])})
        by_entity=collections.defaultdict(list)
        for part in data['parts']: by_entity[part['properties']['entity_id']].append(part['properties'])
        for entity_id, entity in data['entities'].items():
            name=entity['name']; kind=entity['kind']; key=(name,kind)
            if key not in entries:
                entries[key]={'id':'coverage:'+hashlib.sha256(f'{kind}|{name}'.encode()).hexdigest()[:16],
                    'title':name,'kind':kind,'entityIds':set(),'sourceIds':set(),'observations':[],'historyIds':set()}
            entry=entries[key]; entry['entityIds'].add(entity_id);entry['sourceIds'].add(source_id)
            properties=by_entity[entity_id]; evidence=[evs[p['assertion_id']] for p in properties if p.get('assertion_id') in evs]
            matching=[h for h in histories if kind=='political' and any(norm(a['name'])==norm(name) and a['fromYear']<=year<=a['toYear'] for a in h['aliases'])]
            history_id=matching[0]['id'] if len(matching)==1 else None
            record={'observationId':observation_id,'scope':scope,'year':year,'entityId':entity_id,'sourceId':source_id,
                'classificationRules':sorted({p.get('classification_rule','regional-source-association') for p in properties}),
                'borderPrecision':sorted({p['source_borderprecision'] for p in properties if p.get('source_borderprecision') is not None}),
                'sourceFeatureIndexes':sorted({e['source_feature_index'] for e in evidence if 'source_feature_index' in e}),
                'historyId':history_id,'chronologyReview':chronology_review(name,kind,year)}
            if history_id: entry['historyIds'].add(history_id)
            entry['observations'].append(record)
    output=[]
    for entry in entries.values():
        for key in ['entityIds','sourceIds','historyIds']:entry[key]=sorted(entry[key])
        entry['observations'].sort(key=lambda r:(r['year'],r['scope'],r['entityId']))
        years=sorted({r['year'] for r in entry['observations']}); entry['observationYears']=years
        entry['firstObservationYear']=years[0];entry['lastObservationYear']=years[-1]
        kind=entry['kind']; n=len(years); span=yformat(years[0]) if n==1 else f'{yformat(years[0])} through {yformat(years[-1])}'
        meaning={'political':'a political or administrative association', 'cultural':'cultural presence', 'context':'a geographic or collective context label'}.get(kind,'a source label')
        entry['summary']=f"{entry['title']} is represented as {meaning} in {n} dated atlas {'observation' if n==1 else 'observations'} ({span}). "
        entry['summary']+= {'political':'This classification does not establish independent sovereignty, a uniform government, or effective control throughout the colored area.',
            'cultural':'The area indicates the source’s broad cultural attribution; it is not a state boundary or a measure of population, language, or religious uniformity.',
            'context':'This label may combine multiple communities or polities. It must not be read as one unified state.'}.get(kind,'Its interpretation remains source-dependent.')
        entry['researchNotes']=[{'summary':note['summary'],'sourceIds':note['sourceIds']} for note in critiques['notes'] if note['name']==entry['title'] and note['kind']==entry['kind']]
        note_sources={s for note in entry['researchNotes'] for s in note['sourceIds']}
        entry['sources']=[source for source in critiques['sources'] if source['id'] in note_sources]
        if entry['researchNotes']: entry['summary'] += ' ' + ' '.join(note['summary'] for note in entry['researchNotes'])
        entry['continuity']='These are separate map observations. The earliest and latest dates are not foundation and dissolution dates, and gaps do not prove disappearance. Matching names across maps are a browsing index, not proof of uninterrupted identity.'
        matched=sum(bool(r['historyId']) for r in entry['observations'])
        entry['researchStatus']='researched-overview' if matched==len(entry['observations']) else 'partly-researched' if matched else 'atlas-description'
        entry['researchedObservationCount']=matched
        output.append(entry)
    output.sort(key=lambda e:(e['title'].casefold(),e['kind']))
    total=sum(len(e['observations']) for e in output); researched=sum(e['researchedObservationCount'] for e in output)
    return {'version':1,'edition':'chronicle-state-coverage-20260927-v1','yearNumbering':'historical',
        'scope':'Every admitted entity in the 49 world and 31 regional historical map observations. Excludes synthetic fixtures, review-queue labels and quarantined geometry.',
        'methodology':'Exact source name plus typed meaning forms a browse entry. Entity IDs and individual observations remain separate. Researched histories match exact aliases within explicitly bounded years; no fuzzy identity merging or lifespan inference.',
        'stats':{'entries':len(output),'politicalEntries':sum(e['kind']=='political' for e in output),'culturalEntries':sum(e['kind']=='cultural' for e in output),'contextEntries':sum(e['kind']=='context' for e in output),'observations':len(observations),'entityObservations':total,'describedEntityObservations':total,'researchedEntityObservations':researched,'atlasOnlyEntityObservations':total-researched,'researchedProfiles':len(histories),'entriesWithResearch':sum(bool(e['historyIds']) for e in output),'atlasSources':len(sources),'sourceCritiqueEntries':sum(bool(e['researchNotes']) for e in output),'suppressedEntityObservations':sum(not o['chronologyReview']['allowed'] for e in output for o in e['observations'])},
        'sources':sorted(sources.values(),key=lambda s:int(s['id'].split(':')[1])), 'observationIndex':observations,'entries':output}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,default=ROOT);parser.add_argument('--output',type=Path)
    args=parser.parse_args();result=compile_coverage(args.root);out=args.output or args.root/'public/history/state-coverage.json'
    out.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    if args.output is None:
        conflicts=collections.defaultdict(list)
        for entry in result['entries']:
            for observation in entry['observations']:
                finding=observation['chronologyReview']
                if observation['scope']=='world' and not finding['allowed']:
                    conflicts[observation['year']].append({'entityId':observation['entityId'],'name':entry['title'],'ruleId':finding['ruleId'],'reason':'source-outside-reviewed-period','note':finding['note'],'sources':finding['sources']})
        audit={'schema_version':1,'review_id':read(args.root/'public/history/political-review.json')['review_id'],'reviewed_observations':sum(o['scope']=='world' for o in result['observationIndex']),
            'source_conflicts':[{'observation':f'world_bc{abs(year)}' if year<0 else f'world_{year}','year':year,'findings':findings} for year,findings in sorted(conflicts.items())],
            'meaning':'Negative chronology checks over all world source observations; passing a guard does not independently verify a state or boundary. Source metadata and geometry remain unchanged. Compiled with the exhaustive study coverage index.'}
        (args.root/'public/history/political-source-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result['stats'],indent=2))

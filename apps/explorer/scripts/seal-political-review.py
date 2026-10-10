#!/usr/bin/env python3
"""Seal explicit review amendments against preserved pre-review mapping bytes."""
import hashlib,json
from pathlib import Path
APP=Path(__file__).resolve().parents[1]
load=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
p=APP/'public/history/political-admission-receipt.json';receipt=load(p)
old={o['observation_id']:o for o in load(APP/'verification/global-history/primary-40/catalog.json')['observations']}
now={o['observation_id']:o for o in load(APP/'public/global-history/catalog.json')['observations']}
revisions=[]
for id in receipt['observations']:
 filename=id+'-mappings.json';before=APP/'verification/history-continuity/previous-mappings'/filename;after=APP/'public/global-history/mappings'/filename
 allowed={c['feature_index'] for c in receipt['changes'] if c['observation_id']==id}
 a,b=load(before),load(after)
 if len(a['mappings'])!=len(b['mappings']):raise RuntimeError('Mapping feature count changed')
 for i,(x,y) in enumerate(zip(a['mappings'],b['mappings'])):
  if x!=y and i not in allowed:raise RuntimeError(f'Unexpected mapping mutation {id}:{i}')
  if x['original_properties']!=y['original_properties'] or x['source_file_sha256']!=y['source_file_sha256']:raise RuntimeError('Original source metadata changed')
 if old[id]['source_sha256']!=now[id]['source_sha256']:raise RuntimeError('Raw source changed')
 revisions.append(dict(observation_id=id,mapping_filename=filename,previous_mapping_path=str(before.relative_to(APP)),previous_mapping_sha256=sha(before),mapping_sha256=sha(after),previous_manifest_sha256=old[id]['manifest_sha256'],manifest_sha256=now[id]['manifest_sha256'],source_sha256=now[id]['source_sha256'],reviewed_feature_indices=sorted(allowed)))
receipt['revisions']=revisions
p.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'sealed_observations':len(revisions),'features':len(receipt['changes'])}))

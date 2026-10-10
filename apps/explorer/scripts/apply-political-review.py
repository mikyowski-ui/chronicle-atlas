#!/usr/bin/env python3
"""Reproducible, exact-source mapping amendments; never edits originals or ledger."""
import hashlib,json
from pathlib import Path
APP=Path(__file__).resolve().parents[1]
ROOT=APP/'public/global-history'
review=json.loads((APP/'public/history/political-review.json').read_text())
changes=[]
for admission in review['admission_reviews']:
 for year in admission['years']:
  path=ROOT/'mappings'/f'world_{year}-mappings.json'
  data=json.loads(path.read_text())
  archive=APP/'verification/history-continuity/previous-mappings'/path.name
  archive.parent.mkdir(parents=True,exist_ok=True)
  if not archive.exists():
   if data.get('review_amendment'):raise RuntimeError('Missing unmodified baseline mapping: '+str(path))
   archive.write_bytes(path.read_bytes())
  for row in data['mappings']:
   if row['original_properties'].get('NAME')!=admission['label']:continue
   if row['decision'] not in ['review-queue','political-association'] or row.get('quarantine'):raise RuntimeError('Protected/nonreview outcome: '+str(path))
   before=row.get('review_previous_decision',row['decision'])
   row.update(decision='political-association',assertion_kind='political',rule='independent-dated-semantic-review',
     rationale=admission['reason']+' Supporting source: '+admission['source_url']+' This verifies the political interpretation and broad period only; it does not independently verify source borders or control.',
     entity_id='world:political:review:'+hashlib.sha256((admission['label']+':'+str(year)).encode()).hexdigest()[:20],
     entity_color={'Chile':'#a7b778','Teotihuacan':'#bb906c','Monte Albán':'#ab99bd'}[admission['label']],
     entity_identity_scope='provisional-single-source-observation',independently_historically_verified=False,
     semantic_review_source=admission['source_url'],review_previous_decision=before)
   changes.append(dict(observation_id=f'world_{year}',label=admission['label'],feature_index=row['feature_index'],old_decision=before,new_decision=row['decision'],source_sha256=row['source_file_sha256'],review_source=admission['source_url']))
  data['review_amendment']=review['review_id']
  data['rules_version']='global-basemap-chronology-semantics-v5'
  path.write_text(json.dumps(data,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n')
receipt=dict(schema_version=1,review_id=review['review_id'],source_originals_modified=False,public_ledger_modified=False,observations=sorted(set(c['observation_id'] for c in changes)),changes=changes,meaning='Political semantics reviewed; source polygon accuracy and effective control remain uncertain. Only preexisting source shapes admitted.')
(APP/'public/history/political-admission-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'features':len(changes),'observations':receipt['observations']}))

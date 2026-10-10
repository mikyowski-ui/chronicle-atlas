/** Host-owned local follow-ups. No provider, network, renderer or executable content. */
import { z } from '@chronicle/contracts/schema';
import { canonicalJSON, hashText, immutable } from '../src/research/engine.ts';
import { boundedSemanticInput, QueryIntentSchema, ReplayManifestSchema, SemanticError, type QueryIntent, type QueryPlan, type ResolvedDataBundle } from './contracts.ts';
import { compileIntent, makeReplay, replay, type SemanticCatalogue } from './catalogue.ts';

const RevisionSchema=z.strictObject({id:z.string().regex(/^revision-[a-f0-9]{64}$/),parentId:z.string().regex(/^revision-[a-f0-9]{64}$/).nullable(),replay:ReplayManifestSchema});
export const RevisionArchiveSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('chronicle-local-followups'),mode:z.literal('local-prepared'),revisions:z.array(RevisionSchema).min(1).max(32)});
export type RevisionArchive=z.infer<typeof RevisionArchiveSchema>;
export interface LocalRevision {readonly archive:RevisionArchive;readonly plan:QueryPlan;readonly bundle:ResolvedDataBundle}
export const FOLLOWUP_LIMIT=32;
function identity(parentId:string|null,plan:QueryPlan):string{return `revision-${hashText(canonicalJSON({parentId,plan}))}`;}
function narrowed(previous:QueryPlan,next:QueryPlan):void{
  const a=previous.scope,b=next.scope;
  if(a.datasetId!==b.datasetId||a.indicatorId!==b.indicatorId||previous.descriptorHash!==next.descriptorHash||previous.dataHash!==next.dataHash||b.entityIds.some(id=>!a.entityIds.includes(id))||b.epoch[0]<a.epoch[0]||b.epoch[1]>a.epoch[1]||b.bbox[0]<a.bbox[0]||b.bbox[1]<a.bbox[1]||b.bbox[2]>a.bbox[2]||b.bbox[3]>a.bbox[3])throw new SemanticError('OUT_OF_BOUNDS','A follow-up may narrow its parent scope only. Reset the pilot to broaden it.');
}
export function restoreRevision(input:unknown,catalogue:SemanticCatalogue):LocalRevision{
  const archive=RevisionArchiveSchema.parse(boundedSemanticInput(input));
  let previous:RevisionArchive['revisions'][number]|undefined;
  let bundle:ResolvedDataBundle|undefined;
  for(const item of archive.revisions){
    if(item.parentId!==(previous?.id??null)||item.id!==identity(item.parentId,item.replay.plan))throw new SemanticError('EDITION_MISMATCH','Revision ancestry or identity changed.');
    if(previous)narrowed(previous.replay.plan,item.replay.plan);
    bundle=replay(item.replay,catalogue);previous=item;
  }
  if(!previous||!bundle)throw new SemanticError('INVALID_SPEC','A revision archive must contain a root.');
  return immutable({archive,plan:previous.replay.plan,bundle});
}
export function beginRevision(input:unknown,catalogue:SemanticCatalogue):LocalRevision{
  const plan=compileIntent(input,catalogue),manifest=makeReplay(plan,catalogue);
  return restoreRevision({schemaVersion:1,kind:'chronicle-local-followups',mode:'local-prepared',revisions:[{id:identity(null,plan),parentId:null,replay:manifest}]},catalogue);
}
export function refineRevision(parent:LocalRevision,input:unknown,catalogue:SemanticCatalogue):LocalRevision{
  // Revalidate the parent even when called by host UI; do not trust structural typing.
  const checked=restoreRevision(parent.archive,catalogue);
  if(checked.archive.revisions.length>=FOLLOWUP_LIMIT)throw new SemanticError('BUDGET_EXCEEDED','This study has reached 32 revisions. Reset the pilot to begin a new study.');
  const intent=QueryIntentSchema.parse(boundedSemanticInput(input)),last=checked.archive.revisions.at(-1)!;
  if(intent.parentId!==last.id)throw new SemanticError('EDITION_MISMATCH','Follow-up parent is stale.');
  const plan=compileIntent(intent,catalogue);narrowed(checked.plan,plan);
  const manifest=makeReplay(plan,catalogue),item={id:identity(last.id,plan),parentId:last.id,replay:manifest};
  return restoreRevision({...checked.archive,revisions:[...checked.archive.revisions,item]},catalogue);
}
export function revisionIntent(current:LocalRevision,entityIds:string[],epoch:[number,number]):QueryIntent{
  return {schemaVersion:1,question:'Which retained observations remain in this explicit scope?',interpretation:'Local prepared follow-up; no natural-language planner.',scope:{...current.plan.scope,entityIds,epoch},context:'explicit-bounds',parentId:current.archive.revisions.at(-1)!.id};
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {ResearchController} from '../src/research/workspace-controller.ts';
import {PROVIDER_FIELDS} from '../research-semantic/provider-transport.ts';

test('production controller uses the prepared transport and degrades without credentials or budgets',async()=>{
  const controller=new ResearchController(2000);
  const previous=controller.getSnapshot();
  assert.deepEqual(controller.getProviderStatus(),{code:'PROVIDER_UNAVAILABLE',reason:'MISSING_CONFIGURATION',modelProcessing:false,liveServices:false,configurationPresent:false,credentialPresent:false});
  const response=await controller.requestProposal('Inspect the current evidence');
  assert.equal(response.status,'error');
  if(response.status==='error')assert.equal(response.code,'PROVIDER_UNAVAILABLE');
  assert.equal(response.receipt.attempts,0);
  assert.equal(controller.getSnapshot(),previous);
  controller.dispose();
});

test('explicit controller configuration cannot activate model processing',async()=>{
  const controller=new ResearchController(2000,undefined,5000,{
    configuration:{schemaVersion:1,providerId:'synthetic-provider',modelId:'synthetic-model',destination:'https://fixture.invalid/v1',credentialReference:'test-presence-only',budgets:{inputTokens:1000,outputTokens:1000,sessionTokens:2000,timeoutMs:1000,outputBytes:1000,toolCalls:0,repairAttempts:0}},
    consent:{schemaVersion:1,policyVersion:'synthetic-review',modelProcessing:false,purpose:'provider-processing-review',fields:PROVIDER_FIELDS.map(field=>({field,allow:true,decisionId:'synthetic-review'})),sourcePolicies:[{datasetId:'synthetic-dataset',modelProcessing:false}]},
    credentials:{available:()=>true},
  });
  const previous=controller.getSnapshot();
  assert.equal(controller.getProviderStatus().reason,'MODEL_PROCESSING_DISABLED');
  const response=await controller.requestProposal('An explicit review is not live activation');
  assert.equal(response.status,'error');
  if(response.status==='error')assert.equal(response.code,'LIVE_NOT_AUTHORIZED');
  assert.equal(response.receipt.attempts,0);
  assert.equal(controller.getSnapshot(),previous);
  controller.dispose();
});

import { createCatalogue, registerFixture, compileIntent } from '../research-semantic/catalogue.ts';
import { QueryIntentSchema } from '../research-semantic/contracts.ts';
import { validateWorkspace, type WorkspaceSpecification } from '../research-semantic/workspace-contract.ts';
import { PROVIDER_FIELDS } from '../research-semantic/provider-transport.ts';
import type { PlannerProviderRequest } from '../research-semantic/planner.ts';
import { canonicalJSON, hashText } from '../src/research/engine.ts';

export function geminiFixture() {
  const sourceHash = hashText('synthetic-gemini-source-only');
  const raw = canonicalJSON({
    schemaVersion: 1, id: 'synthetic-gemini-dataset', edition: 'synthetic-edition-1', coverageNote: 'Synthetic provider test; not historical evidence.',
    sourcePins: [{ id: 'synthetic-gemini-source', edition: 'synthetic-edition-1', sha256: sourceHash, title: 'Synthetic test source', locator: 'synthetic-row-1', rights: 'authorized-local-preview', modelProcessing: false, republication: false }],
    indicators: [{ id: 'population', label: 'Synthetic count', kind: 'quantitative', unit: 'persons', allowedEvidence: ['attested'] }],
    bounds: { bbox: [0, 0, 1, 1], epoch: [2000, 2000] },
    entities: [{ id: 'synthetic-gemini-entity', label: 'Synthetic entity', coordinates: [0.5, 0.5], spatialSupport: { definition: 'Synthetic fixed test scope', comparability: 'fixed', uncertaintyKm: null } }],
    observations: [{ id: 'synthetic-gemini-row', entityId: 'synthetic-gemini-entity', indicatorId: 'population', value: 1, epistemicStatus: 'attested',
      time: { startYear: 2000, endYear: 2000, precision: 'year', meaning: 'Synthetic year' }, compositionTime: null,
      confidence: { kind: 'not-supplied', note: 'No synthetic uncertainty estimate.' },
      provenance: { sourceId: 'synthetic-gemini-source', locator: 'synthetic-row-1', sourceSha256: sourceHash, recordSha256: hashText('synthetic-row-1'), bibliographySourceIds: [] },
      derivation: null, author: null, perspective: null, limitations: ['Synthetic test only.'], supportNote: 'Synthetic test only.', reviewStatus: 'source-attributed' }],
  });
  const registration = registerFixture(raw, hashText(raw)), catalogue = createCatalogue([registration]);
  const scope = { datasetId: registration.descriptor.id, indicatorId: 'population', bbox: [0, 0, 1, 1], epoch: [2000, 2000], entityIds: ['synthetic-gemini-entity'] };
  const baseIntent = QueryIntentSchema.parse({ schemaVersion: 1, question: 'Synthetic provider test', interpretation: 'Synthetic test only.', scope, context: 'explicit-bounds', parentId: null });
  const plan = compileIntent(baseIntent, catalogue);
  const question = 'Synthetic provider test only. Propose a schemaVersion 2 dashboard with table and evidence views for the following exact host-pinned plan. Preserve the entire question verbatim in intent.question, use null parentId, and copy plan.scope to intent.scope. Do not invent or transmit observation values. Host-pinned plan: ' + canonicalJSON(plan);
  const intent = QueryIntentSchema.parse({ ...baseIntent, question });
  const specification: WorkspaceSpecification = validateWorkspace({ schemaVersion: 2, id: 'synthetic-gemini-dashboard', title: 'Synthetic provider test', intent, plan,
    views: [{ id: 'synthetic-table', type: 'table', binding: 'observations' }, { id: 'synthetic-evidence', type: 'evidence', binding: 'observations' }], selection: 'entity-observation', layout: 'adaptive' }, catalogue);
  const configuration = { budgets: { inputTokens: 16000, outputTokens: 8192, sessionTokens: 48384, timeoutMs: 1000, outputBytes: 16384, toolCalls: 0 as const, repairAttempts: 0 } };
  const consent = { schemaVersion: 1, policyVersion: 'synthetic-gemini-consent-1', purpose: 'synthetic-provider-test', dataClass: 'synthetic-fixture', modelProcessing: true,
    fields: PROVIDER_FIELDS.map(field => ({ field, allow: true, decisionId: 'synthetic-gemini-review' })), sourcePolicies: [{ datasetId: registration.descriptor.id, modelProcessing: true }] };
  const request = (): PlannerProviderRequest => ({ question, context: { disclosure: 'synthetic-opt-in', catalogueVersion: 'synthetic-gemini-catalogue', datasets: [{ id: registration.descriptor.id, indicatorIds: ['population'], entityIds: ['synthetic-gemini-entity'] }], parentRevisionId: null }, signal: new AbortController().signal, attempt: 0, repairCode: null, remainingTokens: 32000, maxOutputBytes: 16384, maxToolCalls: 0 });
  return { configuration, consent, request, specification, registration, validateSpecification: (value: unknown) => validateWorkspace(value, catalogue) };
}

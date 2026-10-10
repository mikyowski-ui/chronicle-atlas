import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGeminiProviderConnection, GEMINI_DEFAULT_MODEL, GEMINI_DESTINATION, GEMINI_RESPONSE_SCHEMA } from '../research-semantic/gemini-provider.ts';
import { PlannerBoundary } from '../research-semantic/planner.ts';
import { PROVIDER_FIELDS, PROVIDER_PROCESSING_POLICY, ProviderTransportError, createProviderConnection } from '../research-semantic/provider-transport.ts';
import { QueryPlanSchema, DashboardSpecificationSchema } from '../research-semantic/contracts.ts';
import { WorkspaceSpecificationSchema } from '../research-semantic/workspace-contract.ts';
import { geminiFixture } from './gemini-fixtures.ts';

const environment = Object.freeze({ GEMINI_API_KEY: 'synthetic-test-credential-not-a-real-key' });
const unsupported = { kind: 'unsupported', reason: 'UNSUPPORTED_SCOPE' };
const fault = (code: string) => (error: unknown) => error instanceof ProviderTransportError && error.code === code && error.message === code;
function reply(output: unknown = unsupported, usage: Partial<Record<string, number>> = {}) {
  const envelope = output as { kind?: string; specification?: unknown; reason?: unknown };
  const wireOutput = envelope.kind === 'proposal' ? { ...envelope, reason: null } : envelope.kind === 'unsupported' ? { ...envelope, specification: null } : output;
  return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(wireOutput) }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100, totalTokenCount: 200, ...usage } }), { headers: { 'content-type': 'application/json' } });
}
const fake = (implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): typeof fetch => implementation as typeof fetch;
function connection(transport = fake(async () => reply()), fixture = geminiFixture()) {
  return createGeminiProviderConnection({ ...fixture, environment, fetch: transport });
}

test('Gemini requires explicit configuration, credentials, budgets, consent and a host validator before transport', async () => {
  const fixture = geminiFixture(); let calls = 0;
  const transport = fake(async () => { calls++; return reply(); });
  for (const input of [{}, { configuration: {} }, { ...fixture, configuration: { budgets: { ...fixture.configuration.budgets, sessionTokens: 0 } } },
    { ...fixture, environment: {} }, { ...fixture, environment, consent: undefined }, { ...fixture, environment, validateSpecification: undefined }]) {
    const adapter = createGeminiProviderConnection({ ...input, fetch: transport });
    assert.equal(adapter.mode, 'unavailable');
    await assert.rejects(adapter.propose(fixture.request()), fault('PROVIDER_UNAVAILABLE'));
  }
  assert.equal(calls, 0);
});

test('Gemini extended smoke deadline requires an explicit synthetic profile and cannot exceed 30 seconds', async () => {
  const fixture = geminiFixture(), budgets = { ...fixture.configuration.budgets, timeoutMs: 30000 };
  assert.equal(createGeminiProviderConnection({ ...fixture, configuration: { budgets }, environment }).mode, 'unavailable');
  const configuration = { budgets, acceptanceProfile: 'synthetic-live-30s-v1' };
  const adapter = createGeminiProviderConnection({ ...fixture, configuration, environment, fetch: fake(async () => reply()) });
  assert.equal(adapter.mode, 'live-opt-in'); await adapter.propose(fixture.request());
  assert.equal(createGeminiProviderConnection({ ...fixture, configuration: { ...configuration, budgets: { ...budgets, timeoutMs: 30001 } }, environment }).mode, 'unavailable');
  assert.equal(createGeminiProviderConnection({ ...fixture, configuration: { ...configuration, acceptanceProfile: 'arbitrary' }, environment }).mode, 'unavailable');
});

test('Gemini keeps historical processing defaults immutable and rejects real-data permission overrides', async () => {
  const fixture = geminiFixture();
  assert.equal(PROVIDER_PROCESSING_POLICY.modelProcessing, false);
  assert.ok(Object.isFrozen(PROVIDER_PROCESSING_POLICY));
  assert.ok(fixture.registration.fixture.sourcePins.every(pin => pin.modelProcessing === false));
  for (const consent of [{ ...fixture.consent, modelProcessing: false }, { ...fixture.consent, purpose: 'provider-processing-review' },
    { ...fixture.consent, sourcePolicies: [{ datasetId: 'historical-dataset', modelProcessing: true }] }]) {
    const adapter = createGeminiProviderConnection({ ...fixture, consent, environment, fetch: fake(async () => assert.fail('No historical transmission')) });
    await assert.rejects(adapter.propose(fixture.request()), fault('PROVIDER_UNAVAILABLE'));
  }
  assert.equal(createProviderConnection().mode, 'unavailable');
});

test('Gemini checks all six distinct field decisions and rejects partial, duplicate and extra consent', () => {
  const fixture = geminiFixture();
  for (const field of PROVIDER_FIELDS) {
    const consent = structuredClone(fixture.consent); consent.fields.find(entry => entry.field === field)!.allow = false;
    assert.equal(createGeminiProviderConnection({ ...fixture, consent, environment }).mode, 'unavailable');
  }
  for (const consent of [{ ...fixture.consent, fields: fixture.consent.fields.slice(1) }, { ...fixture.consent, fields: PROVIDER_FIELDS.map(() => fixture.consent.fields[0]) }, { ...fixture.consent, rawSourcesAllowed: true }])
    assert.equal(createGeminiProviderConnection({ ...fixture, consent, environment }).mode, 'unavailable');
});

test('Gemini only uses the official HTTPS endpoint, safe model IDs and named credential references', () => {
  const fixture = geminiFixture();
  for (const extra of [{ destination: 'https://elsewhere.invalid' }, { destination: GEMINI_DESTINATION + '?key=not-allowed' }, { modelId: '../outside' }, { credentialReference: 'OTHER_KEY' }, { apiKey: 'synthetic-input-must-be-rejected' }]) {
    assert.equal(createGeminiProviderConnection({ ...fixture, configuration: { ...fixture.configuration, ...extra }, environment }).mode, 'unavailable');
  }
});

test('Gemini wire schema uses only bounded OpenAPI types, homogeneous tuples and string enums', () => {
  const allowed = new Set(['type', 'nullable', 'enum', 'properties', 'required', 'items', 'minItems', 'maxItems', 'minimum', 'maximum', 'propertyOrdering']);
  const visit = (schema: any, depth = 0): void => {
    assert.ok(depth <= 8);
    assert.ok(['OBJECT', 'ARRAY', 'STRING', 'INTEGER', 'NUMBER', 'BOOLEAN'].includes(schema.type));
    assert.ok(Object.keys(schema).every(key => allowed.has(key)));
    if (schema.enum) assert.ok(schema.type === 'STRING' && schema.enum.every((value: unknown) => typeof value === 'string'));
    if (schema.type === 'ARRAY') { assert.ok(schema.items); visit(schema.items, depth + 1); }
    for (const child of Object.values(schema.properties ?? {})) visit(child, depth + 1);
  };
  visit(GEMINI_RESPONSE_SCHEMA);
  const spec = (GEMINI_RESPONSE_SCHEMA as any).properties.specification;
  assert.equal(spec.type, 'OBJECT'); assert.equal(spec.nullable, true);
  assert.equal(spec.properties.plan.properties.scope.properties.bbox.items.type, 'NUMBER');
  assert.equal(spec.properties.plan.properties.scope.properties.epoch.items.type, 'INTEGER');
  assert.deepEqual(spec.properties.plan.properties.fields.items.enum, ['id', 'entityId', 'indicatorId', 'value', 'time', 'epistemicStatus', 'provenance']);
});

test('Gemini sends JSON schemas and minimized data with header authentication, no tools, redirects or credential-bearing URLs', async () => {
  const fixture = geminiFixture(); let calls = 0;
  const adapter = connection(fake(async (url, init) => {
    calls++;
    assert.equal(String(url), `${GEMINI_DESTINATION}/models/${GEMINI_DEFAULT_MODEL}:generateContent`);
    assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).get('x-goog-api-key') === environment.GEMINI_API_KEY, true);
    assert.equal(String(init?.body).includes(environment.GEMINI_API_KEY), false);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    const schema = body.generationConfig.responseSchema;
    assert.equal(schema.type, 'OBJECT'); assert.deepEqual(schema.required, ['kind', 'reason', 'specification']); assert.equal(body.generationConfig.responseJsonSchema, undefined);
    assert.equal(/\$ref|anyOf|prefixItems|additionalProperties/.test(JSON.stringify(schema)), false);
    assert.equal(schema.properties.specification.nullable, true); assert.equal(schema.properties.reason.nullable, true);
    assert.equal(body.generationConfig.candidateCount, 1);
    assert.equal(body.generationConfig.maxOutputTokens, fixture.configuration.budgets.outputTokens);
    assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 0); assert.equal(body.tools, undefined);
    assert.equal(body.store, false);
    const payload = JSON.parse(body.contents[0].parts[0].text);
    assert.equal(payload.question, fixture.request().question); assert.deepEqual(payload.context, fixture.request().context);
    assert.equal(payload.values, undefined); assert.equal(payload.credentialReference, undefined);
    assert.ok(init?.signal instanceof AbortSignal);
    return reply({ kind: 'proposal', specification: fixture.specification });
  }), fixture);
  const result = await adapter.propose(fixture.request());
  assert.equal(adapter.mode, 'live-opt-in'); assert.equal(calls, 1);
  assert.deepEqual(result.output, { kind: 'proposal', specification: fixture.specification });
  assert.ok(result.usage.inputTokens > 100); assert.ok(result.usage.outputTokens > 100);
  assert.equal(adapter.diagnostics().reportedUsage.totalTokens, 200);
  assert.equal(adapter.diagnostics().active, false);
});

test('Gemini treats standard and authorization credentials as opaque header-safe tokens', async () => {
  const fixture = geminiFixture(), value = 'synthetic.authorization-token_part+/==';
  const adapter = createGeminiProviderConnection({ ...fixture, environment: { GEMINI_API_KEY: value }, fetch: fake(async (_url, init) => {
    assert.equal(new Headers(init?.headers).get('x-goog-api-key') === value, true);
    assert.equal(String(init?.body).includes(value), false); return reply();
  }) });
  assert.equal(adapter.mode, 'live-opt-in'); await adapter.propose(fixture.request());
  for (const invalid of ['synthetic\r\nInjected:value', 'synthetic key with spaces', 'synthetic#comment', '"synthetic-wrapped"', 'GEMINI_API_KEY=synthetic-repeated', 'x'.repeat(4097)]) {
    assert.equal(createGeminiProviderConnection({ ...fixture, environment: { GEMINI_API_KEY: invalid } }).mode, 'unavailable');
  }
  assert.equal(JSON.stringify(adapter).includes(value), false);
});

test('Gemini model selection is explicit and never silently falls back to another model', async () => {
  const fixture = geminiFixture(); let calls = 0;
  const adapter = createGeminiProviderConnection({ ...fixture, configuration: { ...fixture.configuration, modelId: 'gemini-2.5-flash-lite' }, environment,
    fetch: fake(async url => { calls++; assert.ok(String(url).endsWith('/models/gemini-2.5-flash-lite:generateContent')); return reply(); }) });
  await adapter.propose(fixture.request()); assert.equal(calls, 1);
});

test('Gemini 3 requests omit deprecated sampling and candidate-count parameters', async () => {
  const fixture = geminiFixture();
  const adapter = createGeminiProviderConnection({ ...fixture, configuration: { ...fixture.configuration, modelId: 'gemini-3.8-flash' }, environment, fetch: fake(async (_url, init) => {
    const config = JSON.parse(String(init?.body)).generationConfig;
    assert.equal(Object.hasOwn(config, 'candidateCount'), false); assert.equal(Object.hasOwn(config, 'temperature'), false);
    assert.equal(config.maxOutputTokens, 8192); assert.equal(config.responseMimeType, 'application/json');
    assert.deepEqual(config.thinkingConfig, { thinkingLevel: 'LOW', includeThoughts: false });
    assert.ok(config.responseSchema); assert.equal(config.responseJsonSchema, undefined); return reply();
  }) });
  await adapter.propose(fixture.request());
});

test('Gemini proposal output enforces both QueryPlan and DashboardSpecification contracts, including v1 compatibility', async () => {
  const fixture = geminiFixture();
  const v1 = DashboardSpecificationSchema.parse({ ...fixture.specification, schemaVersion: 1 });
  QueryPlanSchema.parse(v1.plan);
  const adapter = createGeminiProviderConnection({ ...fixture, environment, validateSpecification: value => DashboardSpecificationSchema.parse(value), fetch: fake(async () => reply({ kind: 'proposal', specification: v1 })) });
  const result = await adapter.propose(fixture.request());
  assert.deepEqual(result.output, { kind: 'proposal', specification: v1 });
});

test('Gemini planner integration requires an explicit synthetic live opt-in and preserves production rejection', async () => {
  const fixture = geminiFixture(), adapter = connection(fake(async () => reply({ kind: 'proposal', specification: fixture.specification })), fixture);
  const planner = new PlannerBoundary(adapter, fixture.validateSpecification);
  const denied = await planner.propose(fixture.request().question, fixture.request().context);
  assert.equal(denied.status, 'error'); if (denied.status === 'error') assert.equal(denied.code, 'LIVE_NOT_AUTHORIZED');
  assert.equal(adapter.diagnostics().exchanges, 0);
  const proposed = await planner.propose(fixture.request().question, fixture.request().context, { allowLiveSynthetic: true, budgets: { tokens: 32000, repairs: 0 } });
  assert.equal(proposed.status, 'proposed'); assert.equal(proposed.receipt.mode, 'live-opt-in');
  if (proposed.status === 'proposed') WorkspaceSpecificationSchema.parse(proposed.specification);
  assert.equal(createProviderConnection({ configuration: fixture.configuration, consent: fixture.consent }).mode, 'unavailable');
});

test('Gemini unsupported responses remain explicit and require no workspace activation', async () => {
  const fixture = geminiFixture(), adapter = connection();
  const result = await new PlannerBoundary(adapter, () => assert.fail('Unsupported output cannot activate a workspace'))
    .propose(fixture.request().question, fixture.request().context, { allowLiveSynthetic: true, budgets: { tokens: 32000, repairs: 0 } });
  assert.equal(result.status, 'unsupported');
});

test('Gemini rejects forged pins, unsupported operations, duplicate views and mismatched questions before returning a proposal', async () => {
  const fixture = geminiFixture(), spec = fixture.specification;
  for (const specification of [
    { ...spec, plan: { ...spec.plan, dataHash: '0'.repeat(64) } }, { ...spec, plan: { ...spec.plan, operation: 'sql' } },
    { ...spec, views: [spec.views[0], spec.views[0]] }, { ...spec, intent: { ...spec.intent, question: 'different question' } },
    { ...spec, intent: { ...spec.intent, parentId: 'synthetic-wrong-parent' } }, { ...spec, title: '<script>not allowed</script>' },
  ]) await assert.rejects(connection(fake(async () => reply({ kind: 'proposal', specification })), fixture).propose(fixture.request()), fault('INVALID_OUTPUT'));
});

test('Gemini rejects undeclared datasets, historical contexts, raw values and input getters before HTTP', async () => {
  const fixture = geminiFixture(), request = fixture.request(); let calls = 0, getters = 0;
  const adapter = connection(fake(async () => { calls++; return reply(); }), fixture);
  const accessor = { ...request }; Object.defineProperty(accessor, 'question', { enumerable: true, get() { getters++; return 'not allowed'; } });
  for (const input of [accessor, { ...request, question: environment.GEMINI_API_KEY }, { ...request, context: { ...request.context, disclosure: 'offline-fixture-only' } },
    { ...request, context: { ...request.context, values: [1] } }, { ...request, context: { ...request.context, datasets: [{ ...request.context.datasets[0], id: 'synthetic-unreviewed' }] } },
    { ...request, context: { ...request.context, datasets: [{ ...request.context.datasets[0], entityIds: ['historical-entity'] }] } }, { ...request, maxToolCalls: 1 }])
    await assert.rejects(adapter.propose(input as typeof request), fault('INVALID_REQUEST'));
  assert.equal(calls, 0); assert.equal(getters, 0);
});

test('Gemini strict JSON decoding rejects duplicate/unsafe keys, malformed encoding and deep output', async () => {
  const fixture = geminiFixture();
  for (const text of ['{"candidates":[],"candidates":[]}', '{"__proto__":{}}', '['.repeat(15) + '0' + ']'.repeat(15), 'not JSON']) {
    const adapter = connection(fake(async () => new Response(text, { headers: { 'content-type': 'application/json' } })), fixture);
    await assert.rejects(adapter.propose(fixture.request()), fault('INVALID_OUTPUT'));
  }
  await assert.rejects(connection(fake(async () => new Response(new Uint8Array([0xc0, 0xaf]), { headers: { 'content-type': 'application/json' } })), fixture).propose(fixture.request()), fault('INVALID_OUTPUT'));
});

test('Gemini rejects truncated, blocked, multiple-candidate and tool-call responses', async () => {
  const fixture = geminiFixture();
  const good = await reply().json();
  for (const response of [
    { ...good, candidates: [{ ...good.candidates[0], finishReason: 'MAX_TOKENS' }] }, { ...good, promptFeedback: { blockReason: 'SAFETY' }, candidates: [] },
    { ...good, candidates: [good.candidates[0], good.candidates[0]] }, { ...good, candidates: [{ ...good.candidates[0], content: { parts: [{ functionCall: { name: 'execute' } }] } }] },
  ]) await assert.rejects(connection(fake(async () => Response.json(response)), fixture).propose(fixture.request()), fault('INVALID_OUTPUT'));
});

test('Gemini credential/quota/model HTTP errors fail closed and raw response bodies are never exposed', async () => {
  const fixture = geminiFixture();
  for (const status of [401, 403, 404, 429]) {
    const adapter = connection(fake(async () => new Response('PRIVATE_PROVIDER_ERROR', { status })), fixture);
    await assert.rejects(adapter.propose(fixture.request()), fault('PROVIDER_UNAVAILABLE'));
    assert.equal(JSON.stringify(adapter.diagnostics()).includes('PRIVATE'), false);
  }
  await assert.rejects(connection(fake(async () => new Response('PRIVATE_PROVIDER_ERROR', { status: 503 })), fixture).propose(fixture.request()), fault('PROVIDER_FAILURE'));
});

test('Gemini reduces structured upstream errors to fixed categories without echoing their bodies', async () => {
  const fixture = geminiFixture();
  for (const [message, details, reason, code] of [
    ['private diagnostic', [{ reason: 'API_KEY_INVALID' }], 'AUTHENTICATION_REJECTED', 'PROVIDER_UNAVAILABLE'],
    ['Unknown name "store". PRIVATE_RESPONSE', [], 'UNSUPPORTED_STORE_PARAMETER', 'PROVIDER_FAILURE'],
    ['Response schema invalid. PRIVATE_RESPONSE', [], 'SCHEMA_REJECTED', 'PROVIDER_FAILURE'],
  ] as const) {
    const violations = [{ fieldViolations: [{ field: 'generation_config.response_json_schema.properties[2]', description: 'PRIVATE_RESPONSE' }, { field: 'unsafe field <script>' }] }];
    const adapter = connection(fake(async () => Response.json({ error: { status: 'INVALID_ARGUMENT', message, details: [...details, ...violations] } }, { status: 400 })), fixture);
    await assert.rejects(adapter.propose(fixture.request()), fault(code));
    assert.equal(adapter.diagnostics().lastFailureReason, reason);
    assert.deepEqual(adapter.diagnostics().lastFieldViolations, ['generation_config.response_json_schema']);
    assert.equal(/PRIVATE|private diagnostic|API_KEY_INVALID/.test(JSON.stringify(adapter.diagnostics())), false);
  }
});

test('Gemini field diagnostics retain only fixed schema names, never upstream field contents', async () => {
  const fixture = geminiFixture(), marker = 'SYNTHETIC_PRIVATE_FIELD_TOKEN';
  const fields = [marker, `generation_config.response_json_schema.properties.${marker}`, `generation_config.response_json_schema.properties[${marker}]`, 'generation_config.response_json_schema.properties[2]'];
  const adapter = connection(fake(async () => Response.json({ error: { status: 'INVALID_ARGUMENT', details: [{ fieldViolations: fields.map(field => ({ field, description: marker })) }] } }, { status: 400 })), fixture);
  await assert.rejects(adapter.propose(fixture.request()), fault('PROVIDER_FAILURE'));
  assert.equal(JSON.stringify(adapter.diagnostics()).includes(marker), false);
  assert.deepEqual(adapter.diagnostics().lastFieldViolations, ['generation_config.response_json_schema']);
});

test('Gemini sanitizes transport exceptions, redirects and wrong content types', async () => {
  const fixture = geminiFixture();
  for (const transport of [fake(async () => { throw Error('PRIVATE_TRANSPORT_ERROR'); }), fake(async () => new Response('ignored', { status: 302, headers: { location: 'https://elsewhere.invalid' } })), fake(async () => new Response('not JSON', { headers: { 'content-type': 'text/html' } }))])
    await assert.rejects(connection(transport, fixture).propose(fixture.request()), fault('PROVIDER_FAILURE'));
});

test('Gemini input and exhausted session budgets return PROVIDER_UNAVAILABLE without additional HTTP calls', async () => {
  const fixture = geminiFixture(); let calls = 0;
  const transport = fake(async () => { calls++; throw Error('Unknown request cost'); });
  const budgets = { ...fixture.configuration.budgets, sessionTokens: 24192 };
  const adapter = createGeminiProviderConnection({ ...fixture, configuration: { budgets }, environment, fetch: transport });
  await assert.rejects(adapter.propose(fixture.request()), fault('PROVIDER_FAILURE'));
  assert.equal(adapter.diagnostics().remainingSessionTokens, 0);
  await assert.rejects(adapter.propose(fixture.request()), fault('PROVIDER_UNAVAILABLE')); assert.equal(calls, 1);
  const small = createGeminiProviderConnection({ ...fixture, configuration: { budgets: { ...budgets, inputTokens: 1 } }, environment, fetch: transport });
  await assert.rejects(small.propose(fixture.request()), fault('PROVIDER_UNAVAILABLE')); assert.equal(calls, 1);
  await assert.rejects(connection().propose({ ...fixture.request(), remainingTokens: 1 }), fault('PROVIDER_UNAVAILABLE'));
});

test('Gemini reservations retain unknown completion costs and refund only validated conservative charges', async () => {
  const fixture = geminiFixture(), adapter = connection();
  const result = await adapter.propose(fixture.request()), diagnostics = adapter.diagnostics();
  assert.equal(diagnostics.remainingSessionTokens, fixture.configuration.budgets.sessionTokens - result.usage.inputTokens - result.usage.outputTokens);
  assert.equal(diagnostics.uncertainAttempts, 0); assert.equal(diagnostics.exchanges, 1);
});

test('Gemini accounts for thinking and total usage and rejects missing, malformed or excessive usage', async () => {
  const fixture = geminiFixture();
  const adapter = connection(fake(async () => reply(unsupported, { thoughtsTokenCount: 500, totalTokenCount: 700 })), fixture);
  const result = await adapter.propose(fixture.request());
  assert.ok(result.usage.outputTokens >= 600); assert.equal(adapter.diagnostics().reportedUsage.thoughtTokens, 500);
  for (const usage of [{ promptTokenCount: -1 }, { totalTokenCount: 1 }, { promptTokenCount: 1.5 }])
    await assert.rejects(connection(fake(async () => reply(unsupported, usage)), fixture).propose(fixture.request()), fault('INVALID_OUTPUT'));
  for (const usage of [{ promptTokenCount: 16001, totalTokenCount: 16101 }, { thoughtsTokenCount: 9000, totalTokenCount: 9200 }, { toolUsePromptTokenCount: 1, totalTokenCount: 201 }])
    await assert.rejects(connection(fake(async () => reply(unsupported, usage)), fixture).propose(fixture.request()), fault('BUDGET_EXCEEDED'));
  const missing = await reply().json(); delete missing.usageMetadata;
  await assert.rejects(connection(fake(async () => Response.json(missing)), fixture).propose(fixture.request()), fault('INVALID_OUTPUT'));
});

test('Gemini bounds response streams, cancels overflow and enforces output bytes before schema validation', async () => {
  const fixture = geminiFixture(); let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(262145)); }, cancel() { cancelled = true; } });
  await assert.rejects(connection(fake(async () => new Response(stream, { headers: { 'content-type': 'application/json' } })), fixture).propose(fixture.request()), fault('BUDGET_EXCEEDED'));
  assert.equal(cancelled, true);
  const small = createGeminiProviderConnection({ ...fixture, environment, configuration: { budgets: { ...fixture.configuration.budgets, outputBytes: 10 } }, fetch: fake(async () => reply()) });
  await assert.rejects(small.propose(fixture.request()), fault('BUDGET_EXCEEDED'));
});

test('Gemini times out stalled headers and stalled response bodies without returning raw errors', async () => {
  const fixture = geminiFixture();
  const configuration = { budgets: { ...fixture.configuration.budgets, timeoutMs: 20 } };
  for (const transport of [fake(async () => new Promise<Response>(() => {})), fake(async () => new Response(new ReadableStream(), { headers: { 'content-type': 'application/json' } }))]) {
    const adapter = createGeminiProviderConnection({ ...fixture, configuration, environment, fetch: transport });
    await assert.rejects(adapter.propose(fixture.request()), fault('TIMEOUT'));
    assert.equal(adapter.diagnostics().active, false); assert.equal(adapter.diagnostics().remainingSessionTokens, 24192);
  }
});

test('Gemini cancellation settles independently, suppresses late completion and refuses concurrent calls', async () => {
  const fixture = geminiFixture(), controller = new AbortController(); let complete!: (response: Response) => void;
  const adapter = connection(fake(async () => new Promise<Response>(resolve => { complete = resolve; })), fixture);
  const pending = adapter.propose({ ...fixture.request(), signal: controller.signal });
  await assert.rejects(adapter.propose(fixture.request()), fault('PROVIDER_UNAVAILABLE'));
  controller.abort(); await assert.rejects(pending, fault('CANCELLED')); complete(reply());
  assert.equal(adapter.diagnostics().active, false); assert.equal(adapter.diagnostics().uncertainAttempts, 1);
  await assert.rejects(adapter.propose({ ...fixture.request(), signal: controller.signal }), fault('CANCELLED'));
  assert.equal(adapter.diagnostics().exchanges, 1);
});

test('Gemini disposal revokes active work and prevents subsequent credential use', async () => {
  const fixture = geminiFixture(), adapter = connection(fake(async () => new Promise<Response>(() => {})), fixture);
  const pending = adapter.propose(fixture.request()); adapter.dispose();
  await assert.rejects(pending, fault('CANCELLED'));
  await assert.rejects(adapter.propose(fixture.request()), fault('PROVIDER_UNAVAILABLE'));
  assert.equal(adapter.status.code, 'PROVIDER_UNAVAILABLE');
});

test('Gemini configuration and consent are copied so later mutation cannot relax request limits', async () => {
  const fixture = geminiFixture(), adapter = connection(fake(async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).generationConfig.maxOutputTokens, 8192); return reply();
  }), fixture);
  fixture.configuration.budgets.outputTokens = 64000; fixture.consent.fields[0].allow = false;
  await adapter.propose(fixture.request());
});

test('Gemini rejects credential-bearing provider output and never serializes credential values', async () => {
  const fixture = geminiFixture();
  const adapter = connection(fake(async () => reply({ kind: 'proposal', specification: { ...fixture.specification, title: environment.GEMINI_API_KEY } })), fixture);
  await assert.rejects(adapter.propose(fixture.request()), fault('INVALID_OUTPUT'));
  assert.equal(JSON.stringify(adapter).includes(environment.GEMINI_API_KEY), false);
  assert.equal(JSON.stringify(adapter.diagnostics()).includes(environment.GEMINI_API_KEY), false);
});

test('Gemini can read a user-designated raw-key file without exposing it in diagnostics or requests other than authentication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chronicle-gemini-test-'));
  try {
    const path = join(directory, 'synthetic-key'); await writeFile(path, environment.GEMINI_API_KEY + '\n', { mode: 0o600 });
    const fixture = geminiFixture(), adapter = createGeminiProviderConnection({ ...fixture, environment: { GEMINI_API_KEY_FILE: path }, fetch: fake(async (_url, init) => {
      assert.equal(new Headers(init?.headers).get('x-goog-api-key') === environment.GEMINI_API_KEY, true); return reply();
    }) });
    await adapter.propose(fixture.request()); assert.equal(JSON.stringify(adapter.diagnostics()).includes(path), false); adapter.dispose();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Gemini planner preserves unavailable errors without retrying credential or quota failures', async () => {
  const fixture = geminiFixture(), adapter = connection(fake(async () => new Response('PRIVATE_QUOTA_RESPONSE', { status: 429 })), fixture);
  const result = await new PlannerBoundary(adapter, fixture.validateSpecification).propose(fixture.request().question, fixture.request().context, { allowLiveSynthetic: true, budgets: { tokens: 32000, repairs: 2 } });
  assert.equal(result.status, 'error'); if (result.status === 'error') assert.equal(result.code, 'PROVIDER_UNAVAILABLE');
  assert.equal(adapter.diagnostics().exchanges, 1); assert.equal(adapter.diagnostics().lastHTTPStatus, 429);
});

test('Gemini default connection code and browser controller do not import the Node-only live credential adapter', async () => {
  const transport = await readFile(new URL('../research-semantic/provider-transport.ts', import.meta.url), 'utf8');
  const controller = await readFile(new URL('../src/research/workspace-controller.ts', import.meta.url), 'utf8');
  assert.equal(/gemini-provider|GEMINI_API_KEY|node:https|process\.env/.test(transport + controller), false);
});

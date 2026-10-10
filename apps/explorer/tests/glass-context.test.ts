import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { eventDay, findHistoricalContext, HISTORICAL_CONTEXTS, historicalEvents } from '../src/historical-context.ts';
import { formatNavigationDate } from '../src/time-entry.ts';

const read = (path: string) => JSON.parse(readFileSync(new URL(`../public/glass/${path}`, import.meta.url), 'utf8'));

test('dated context cannot promote cultural meaning or leak across researched observation dates', () => {
  assert.equal(findHistoricalContext('Egypt', -2999, 'political-association')?.id, 'egypt-3000');
  assert.equal(findHistoricalContext('Egypt', -1999, 'political-association')?.id, 'egypt-2000');
  assert.equal(findHistoricalContext('Egypt', -999, 'political-association'), undefined);
  assert.equal(findHistoricalContext('Egypt', -2999, 'cultural'), undefined);
  assert.equal(findHistoricalContext('Egypt', -2999, 'cultural-presence'), undefined);
  assert.equal(findHistoricalContext('Egypt', -2999, 'context'), undefined);
  assert.equal(findHistoricalContext('Rome', -199, 'political-association')?.id, 'roman-republic');
  assert.equal(findHistoricalContext('Rome', 100, 'political-association'), undefined);
  assert.equal(findHistoricalContext('Roman Empire', 300, 'political-association'), undefined);
});

test('events retain year/circa precision while supported successor maps retain independent dates', () => {
  assert.equal(formatNavigationDate(eventDay(0)), '1-01-01 BCE');
  assert.equal(formatNavigationDate(eventDay(-29)), '30-01-01 BCE');
  const approximate = historicalEvents.find(event => event.id === 'old-kingdom')!;
  assert.equal(approximate.precision, 'circa-year'); assert.match(approximate.title, /^c\./);
  const transition = findHistoricalContext('Ptolemaic Kingdom', -199)!.succession!;
  assert.equal(transition.year, -29); assert.equal(transition.targets[0].year, 0);
  assert.equal(findHistoricalContext('Roman Empire', 100)!.succession!.targets.length, 2);
  assert.throws(() => eventDay(2023, 2, 29), RangeError);
});

test('enrichment source and image closure respects the frozen resource budget', () => {
  const budget = read('resource-budget.json'), images = read('image-inventory.json'), sources = read('source-inventory.json');
  assert.ok(HISTORICAL_CONTEXTS.length <= budget.max_profiles);
  assert.ok(historicalEvents.length <= budget.max_events);
  assert.ok(images.length <= budget.max_images);
  assert.ok(images.reduce((sum: number, item: {image_bytes:number}) => sum + item.image_bytes, 0) <= budget.max_image_bytes_aggregate);
  const sourceIds = new Set(sources.map((source: {id: string}) => source.id));
  for (const context of HISTORICAL_CONTEXTS) {
    const contextIds = new Set(context.sources.map(source => source.id));
    for (const id of context.succession?.sourceIds ?? []) assert.ok(contextIds.has(id), `${context.id}: ${id}`);
    for (const source of context.sources) assert.ok(sourceIds.has(source.id) && source.url.startsWith('https://'));
  }
  for (const event of historicalEvents) for (const id of event.sourceIds) assert.ok(sourceIds.has(id));
  for (const image of images) {
    const bytes = readFileSync(new URL(`../public/${image.path}`, import.meta.url));
    assert.equal(bytes.length, image.image_bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), image.image_sha256);
    const apiBytes = readFileSync(new URL(`../public/glass/source-records/met-${image.objectID}.json`, import.meta.url));
    assert.equal(apiBytes.length, image.api_bytes);
    assert.equal(createHash('sha256').update(apiBytes).digest('hex'), image.api_sha256);
    const api = JSON.parse(apiBytes.toString('utf8'));
    assert.equal(api.isPublicDomain, true);
    assert.match(image.rights, /CC0/);
  }
});

test('successor navigation targets are admitted political observations, never fabricated intermediate maps', () => {
  for (const context of HISTORICAL_CONTEXTS) for (const target of context.succession?.targets ?? []) {
    const key = target.year === 0 ? 'world_bc1' : `world_${target.year}`;
    const metadata = JSON.parse(readFileSync(new URL(`../public/global-history/observations/${key}/metadata.json`, import.meta.url), 'utf8'));
    assert.ok(metadata.parts.some((part: {properties: {entity_id: string; source_name: string; kind: string}}) => part.properties.entity_id === target.entityId && part.properties.source_name === target.name && part.properties.kind === 'political'));
  }
});

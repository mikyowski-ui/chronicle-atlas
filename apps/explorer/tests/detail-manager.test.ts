import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { DetailManager } from '../src/detail-manager.ts';

const BASE = 'http://chronicle.test/detail/';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const grid = { width: 180, height: 90, west: -180, north: 90, cellDegrees: 2 };

function fixture() {
  const assets = new Map<string, Uint8Array>();
  const observations = [1910, 1950, 2000, 2010].map(year => {
    const counts: (number | null)[] = Array(16200).fill(null);
    const densities: (number | null)[] = Array(16200).fill(null);
    const knownSourceCells: number[] = Array(16200).fill(0);
    counts[0] = 0; densities[0] = 0; knownSourceCells[0] = 16;
    counts[1] = year; densities[1] = year / 100; knownSourceCells[1] = 8;
    const bytes = json({ year, edition: 'test-population-v1', grid, counts, densities, knownSourceCells });
    assets.set(`population-${year}.json`, bytes);
    return { year, edition: 'test-population-v1', url: `./population-${year}.json`, sha256: hash(bytes), byte_length: bytes.length };
  });
  assets.set('population.json', json({ observations }));
  assets.set('cities.json', json({ version:1, yearNumbering:'astronomical', sources:[], cities:[] }));
  assets.set('capitals.json', json({ version:1, yearNumbering:'astronomical', sources:[], capitals:[] }));
  const places = json({ sources: [], places: [{
    id: 'modern-test-place', title: 'Test place', coordinates: [12, 42], sourceId: 'test-source',
    sourceUrl: 'https://example.test/place', validFromYear: null, validToYear: null,
    temporalMode: 'modern-context', rank: 1,
  }] });
  assets.set('places.json', places);
  assets.set('places-receipt.json', json({ output: { path: 'places.json', bytes: places.length, sha256: hash(places) } }));
  const hydro = json({ type: 'FeatureCollection', features: [{
    type: 'Feature', properties: { name: 'Test river' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
  }] });
  const compressed = new Uint8Array(gzipSync(hydro));
  assets.set('hydro.geojson.gz', compressed);
  assets.set('terrain.json', json({
    raster: { tiles: ['./terrain/{z}/{x}/{y}.jpg'], tile_size: 256, minzoom: 0, maxzoom: 5 },
    hydrography: { url: './hydro.geojson.gz', compression: 'gzip', byte_length: compressed.length,
      sha256: hash(compressed), decoded_bytes: hydro.length, decoded_sha256: hash(hydro), features: 1 },
  }));
  return assets;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function environment(t: TestContext, options: { deferredPopulation?: boolean; deferredIndex?: boolean; decoded?: boolean; corrupt?: boolean } = {}) {
  const assets = fixture();
  const requests: { name: string; signal?: AbortSignal | null }[] = [];
  const started = new Map<number, ReturnType<typeof deferred>>();
  const pending = new Map<number, ReturnType<typeof deferred>[]>();
  const indexGate = deferred();
  if (!options.deferredIndex) indexGate.resolve();
  const warnings: unknown[][] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => { warnings.push(args); });
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'location', { value: { href: BASE }, configurable: true });
  // terminal.local is HTTP; successful hashes must not require a secure-context API.
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  t.after(() => {
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation); else Reflect.deleteProperty(globalThis, 'location');
    if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto); else Reflect.deleteProperty(globalThis, 'crypto');
    indexGate.resolve();
    for (const queue of pending.values()) for (const gate of queue) gate.resolve();
  });
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const name = new URL(url).pathname.split('/').at(-1)!;
    requests.push({ name, signal: init?.signal });
    if (name === 'population.json') await indexGate.promise;
    const yearMatch = /^population-(\d+)\.json$/.exec(name);
    if (yearMatch && options.deferredPopulation) {
      const year = Number(yearMatch[1]), gate = deferred();
      pending.set(year, [...(pending.get(year) ?? []), gate]);
      started.get(year)?.resolve();
      // Deliberately ignore abort here: the manager must reject a late completion.
      await gate.promise;
    }
    const stored = assets.get(name);
    assert.ok(stored, `Unexpected request: ${url}`);
    let bytes = new Uint8Array(stored);
    if (options.decoded && name.endsWith('.gz')) bytes = new Uint8Array(gunzipSync(bytes));
    if (options.corrupt && (name === 'hydro.geojson.gz' || name === 'places.json' || yearMatch)) bytes[bytes.length - 1] ^= 1;
    return new Response(bytes.buffer, { headers: options.decoded && name.endsWith('.gz') ? { 'content-encoding': 'gzip' } : {} });
  });
  return {
    assets, requests, warnings, releaseIndex: indexGate.resolve,
    async requested(year: number) {
      if (pending.get(year)?.length) return;
      const gate = deferred(); started.set(year, gate); await gate.promise;
    },
    release(year: number) {
      const gate = pending.get(year)?.shift(); assert.ok(gate, `No pending ${year} request`); gate.resolve();
    },
  };
}

function manager(t: TestContext) {
  const lifetime = new AbortController();
  const value = new DetailManager(() => {}, BASE);
  t.after(() => { lifetime.abort(); value.destroy(); });
  return { value, lifetime };
}

test('population index arrival resolves an early user choice; same-target scrubs do not starve delivery', { timeout: 5000 }, async t => {
  const io = environment(t, { deferredPopulation: true, deferredIndex: true });
  const { value, lifetime } = manager(t);
  value.setOptions({ density: true }); value.setTime(1951);
  const loaded = value.load(lifetime.signal);
  assert.equal(value.diagnostics().populationDisplayed, null);
  assert.match(value.frame.populationLabel, /Loading population observations/);
  io.releaseIndex(); await io.requested(1950);
  for (let year = 1952; year < 2000; year++) value.setTime(year);
  const completed = value.resolvePopulation();
  const requests = io.requests.filter(r => r.name === 'population-1950.json');
  assert.equal(requests.length, 1, '48 cursor updates share the same observation request');
  assert.equal(requests[0].signal?.aborted, false);
  io.release(1950); await completed; await loaded;
  assert.equal(value.frame.population?.year, 1950);
  assert.equal(value.frame.requestedYear, 1999);
  assert.match(value.frame.populationLabel, /dated reference/);
  assert.equal(io.warnings.length, 0);
});

test('late 2000 delivery cannot replace 2010 and disabled/lifetime-aborted requests cannot commit', { timeout: 5000 }, async t => {
  const io = environment(t, { deferredPopulation: true });
  const { value, lifetime } = manager(t);
  await value.load(lifetime.signal); value.setOptions({ density: true });
  value.setTime(2005); const old = value.resolvePopulation(); await io.requested(2000);
  value.setTime(2010); const latest = value.resolvePopulation(); await io.requested(2010);
  assert.equal(io.requests.find(r => r.name === 'population-2000.json')?.signal?.aborted, true);
  io.release(2010); await latest; io.release(2000); await old;
  assert.equal(value.frame.population?.year, 2010);
  assert.equal(value.diagnostics().populationCache, 1, 'stale data must not enter the warm cache');
  value.setTime(1910); const disabled = value.resolvePopulation(); await io.requested(1910);
  value.setOptions({ density: false }); io.release(1910); await disabled;
  assert.equal(value.frame.population?.year, 2010);
  assert.equal(value.frame.populationLabel, 'Population layer off');
  value.setOptions({ density: true }); const ended = value.resolvePopulation(); await io.requested(1910);
  lifetime.abort(); io.release(1910); await ended;
  assert.equal(value.diagnostics().populationInFlight, null);
  assert.equal(value.diagnostics().populationCache, 0);
  assert.equal(value.frame.population?.year, 2010);
  assert.equal(io.warnings.length, 0);
});

test('population cache retains at most two complete observations and evicts older data', async t => {
  const io = environment(t);
  const { value, lifetime } = manager(t);
  await value.load(lifetime.signal); value.setOptions({ density: true });
  for (const year of [1910, 1950, 2000]) {
    value.setTime(year); await value.resolvePopulation();
    assert.equal(value.frame.population?.year, year);
    assert.ok(value.diagnostics().populationCache <= 2);
  }
  assert.equal(value.diagnostics().populationCache, 2);
  value.setTime(1910); await value.resolvePopulation();
  assert.equal(io.requests.filter(r => r.name === 'population-1910.json').length, 2, 'evicted observation is fetched again');
  value.setTime(1900); await value.resolvePopulation();
  assert.equal(value.frame.population, null);
  assert.match(value.frame.populationLabel, /No population grid before 1910/);
  value.setPopulationYear('2010'); await value.resolvePopulation();
  assert.equal(value.frame.requestedYear, 1900, 'pinning population must not change the map date');
  assert.match(value.frame.populationLabel, /Population 2010 · pinned comparison/);
});

for (const decoded of [false, true]) {
  test(`hash verification accepts ${decoded ? 'transport-decoded' : 'raw gzip'} hydrography without Web Crypto`, async t => {
    const io = environment(t, { decoded });
    const { value, lifetime } = manager(t);
    await value.load(lifetime.signal);
    assert.equal(value.frame.hydro?.features.length, 1);
    assert.equal(value.diagnostics().places, 1);
    assert.equal(value.frame.terrain?.tiles, 'http://chronicle.test/detail/terrain/{z}/{x}/{y}.jpg');
    value.setTime(2010); value.setOptions({ density: true }); await value.resolvePopulation();
    assert.equal(value.frame.population?.year, 2010);
    assert.equal(value.frame.population?.counts[0], 0);
    assert.equal(value.frame.population?.counts[2], null);
    assert.equal(io.warnings.length, 0);
  });
  test(`hash verification rejects corrupted ${decoded ? 'transport-decoded' : 'raw gzip'} hydrography, places and population`, async t => {
    const io = environment(t, { decoded, corrupt: true });
    const { value, lifetime } = manager(t);
    await value.load(lifetime.signal);
    assert.equal(value.frame.hydro, null);
    assert.equal(value.diagnostics().places, 0);
    value.setTime(2010); value.setOptions({ density: true }); await value.resolvePopulation();
    assert.equal(value.frame.population, null);
    assert.equal(value.diagnostics().populationCache, 0);
    assert.match(value.frame.populationLabel, /delivery unavailable/);
    assert.equal(io.warnings.length, 3);
    for (const warning of io.warnings) assert.match(String(warning[1]), /hash mismatch/);
  });
}


test('dated cities follow the requested year, remain intrinsic, and load independently of border history', async t => {
  const io = environment(t), { value, lifetime } = manager(t);
  const source = { id:'city-history', title:'City history', url:'https://example.test/cities' };
  io.assets.set('cities.json', json({version:1,yearNumbering:'astronomical',sources:[source],cities:[{
    id:'dated-city',name:'Later name',lon:12,lat:42,sourceIds:[source.id],names:[{name:'Early name',from:100,to:199},{name:'Later name',from:200}],
    population:[{year:100,value:20000,sourceId:source.id},{year:200,value:30000,sourceId:source.id}]
  }]}));
  value.setTime(99);await value.load(lifetime.signal);
  assert.equal(value.frame.places.some(p=>p.id==='dated-city'),false);
  value.setTime(100);assert.equal(value.getPlace('dated-city')?.title,'Early name');
  assert.equal(value.getPlace('dated-city')?.populationEstimate?.value,20000);
  value.setOptions({cities:false});assert.equal(value.frame.options.cities,true);
  value.setTime(200);assert.equal(value.getPlace('dated-city')?.title,'Later name');
  assert.equal(value.getPlace('dated-city')?.populationEstimate?.value,30000);
  value.setTime(199);assert.equal(value.getPlace('dated-city')?.populationEstimate?.value,20000);
  assert.equal(value.diagnostics().historicalCities,1);
  assert.equal(io.requests.filter(r=>r.name==='cities.json').length,1);
  assert.equal(io.warnings.length,0);
});

test('warm year reversals reuse two exact city views while source arrivals and modern context invalidate correctly', async t => {
  const io=environment(t),{value,lifetime}=manager(t);
  const source={id:'cache-test-source',title:'Synthetic cache test only',url:'https://example.test/city-cache'};
  io.assets.set('cities.json',json({version:1,yearNumbering:'astronomical',sources:[source],cities:[{
    id:'cache-test-city',name:'Test city',lon:12,lat:42,sourceIds:[source.id],names:[],
    population:[{year:2000,value:100,sourceId:source.id},{year:2001,value:200,sourceId:source.id}],
  }]}));
  value.setTime(2000);const emptyBeforeSource=value.frame.places;
  await value.load(lifetime.signal);
  assert.notStrictEqual(value.frame.places,emptyBeforeSource,'Asynchronous source arrival invalidates an empty cached year.');
  const year2000=value.frame.places;value.setTime(2001);const year2001=value.frame.places;
  const builds=value.diagnostics().placeBuilds;
  for(let i=0;i<200;i++){
    const year=i%2?2001:2000;value.setTime(year);
    assert.strictEqual(value.frame.places,year===2000?year2000:year2001);
    assert.equal(value.getPlace('cache-test-city')?.populationEstimate?.value,year===2000?100:200);
    assert.equal(value.frame.requestedYear,year);
  }
  assert.equal(value.diagnostics().placeBuilds,builds);
  assert.equal(value.diagnostics().placeCacheEntries,2);
  value.setOptions({modernCities:true});assert.ok(value.frame.places.some(place=>place.id==='modern-test-place'));
  assert.notStrictEqual(value.frame.places,year2001,'Modern-context visibility is part of the cache identity.');
  value.setOptions({modernCities:false});assert.strictEqual(value.frame.places,year2001);
  for(const year of [2002,2003,2004,2005]){value.setTime(year);assert.equal(value.diagnostics().placeCacheEntries,2);}
  value.setTime(2000);assert.notStrictEqual(value.frame.places,year2000,'Old years are evicted rather than accumulating.');
  value.destroy();assert.equal(value.diagnostics().placeCacheEntries,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATE_HISTORIES, STATE_HISTORY_EVENTS, HISTORICAL_CAPITALS, CAPITAL_SOURCES, CAPITAL_POLITIES,
  findStateHistory, activeCapitals, getStateHistory, toAstronomicalYear, toHistoricalYear,
  formatHistoryYear,
} from '../src/state-histories';

test('BCE matching converts the app astronomical calendar without introducing year zero', () => {
  assert.equal(toHistoricalYear(0), -1);
  assert.equal(toAstronomicalYear(-1), 0);
  assert.equal(toAstronomicalYear(-200), -199);
  assert.equal(formatHistoryYear(-1), '1 BCE');
  assert.throws(() => toAstronomicalYear(0));
  assert.throws(() => formatHistoryYear(0));
  assert.equal(findStateHistory('Roman Empire', 0)?.id, 'roman-empire');
  assert.equal(findStateHistory('Roman Republic', -199)?.id, 'roman-republic');
});

test('same modern label never attaches an unrelated ancient political identity', () => {
  assert.equal(findStateHistory('Egypt', -2999)?.id, 'egypt-early');
  assert.equal(findStateHistory('Egypt', -1999)?.id, 'egypt-middle');
  assert.equal(findStateHistory('Egypt', 2025), undefined);
  assert.equal(findStateHistory('Benin', 1800)?.id, 'benin-kingdom');
  assert.equal(findStateHistory('Benin', 2000), undefined);
  assert.equal(findStateHistory('Mali', 1300)?.id, 'mali');
  assert.equal(findStateHistory('Mali', 2000), undefined);
  assert.equal(findStateHistory('Han', 100, 'cultural'), undefined);
});

test('out-of-lifetime source labels do not gain a researched narrative', () => {
  for (const [name, year] of [['Parthian Empire',300],['Sasanian Empire',700],['Western Roman Empire',500],['Mauryan Empire',-99],['Sui Empire',700],['Inca Empire',1600],['Manchu Empire',1914]] as const) {
    assert.equal(findStateHistory(name, year), undefined, `${name} at ${year}`);
  }
});

test('interregna and occupation do not inherit uninterrupted dynastic lookup', () => {
  assert.equal(findStateHistory('Han', 8)?.id, 'han');
  assert.equal(findStateHistory('Han', 10), undefined);
  assert.equal(findStateHistory('Han', 24), undefined);
  assert.equal(findStateHistory('Han', 25)?.id, 'han');
  assert.equal(findStateHistory('Tang Empire', 700), undefined);
  assert.equal(findStateHistory('Tang Empire', 705)?.id, 'tang');
  assert.equal(findStateHistory('Mughal Empire', 1550), undefined);
  assert.equal(findStateHistory('Byzantine Empire', 1250), undefined);
  assert.equal(getStateHistory('byzantine')?.id, 'byzantine', 'An explicitly selected lifecycle may remain readable through its interruption');
});

test('Abbasid capital follows Baghdad, Samarra and return rather than one fixed point', () => {
  assert.deepEqual(activeCapitals('abbasid', 800).map(c => c.name), ['Baghdad']);
  assert.deepEqual(activeCapitals('abbasid', 850).map(c => c.name), ['Samarra']);
  assert.deepEqual(activeCapitals('abbasid', 900).map(c => c.name), ['Baghdad']);
  assert.deepEqual(activeCapitals('abbasid', 1300), []);
});

test('political capitals change without making the physical location disappear', () => {
  assert.deepEqual(activeCapitals('byzantine', 1250), []);
  assert.deepEqual(activeCapitals('byzantine', 1300).map(c => c.name), ['Constantinople']);
  assert.deepEqual(activeCapitals('byzantine', 1500), []);
  assert.deepEqual(activeCapitals('ottoman', 1500).map(c => c.name), ['Constantinople']);
  assert.deepEqual(activeCapitals('ming', 1400).map(c => c.name), ['Nanjing']);
  assert.deepEqual(activeCapitals('ming', 1500).map(c => c.name), ['Beijing']);
  assert.deepEqual(activeCapitals('qing', 1800).map(c => c.name), ['Beijing']);
});

test('source references, coordinates, and inter-profile transition targets resolve', () => {
  const ids = new Set(STATE_HISTORIES.map(p => p.id));
  assert.equal(ids.size, STATE_HISTORIES.length);
  for (const profile of STATE_HISTORIES) {
    const sources = new Set(profile.sources.map(s => s.id));
    assert.ok(profile.summary.length > 100);
    assert.ok(profile.continuity);
    for (const alias of profile.aliases) {
      assert.notEqual(alias.fromYear, 0); assert.notEqual(alias.toYear, 0);
      assert.ok(alias.fromYear <= alias.toYear);
    }
    for (const transition of profile.transitions) {
      assert.notEqual(transition.year, 0);
      transition.sourceIds.forEach(id => assert.ok(sources.has(id), `${profile.id} source ${id}`));
      transition.targets.forEach(id => assert.ok(ids.has(id), `${profile.id} target ${id}`));
    }
  }
  const sources = new Set(CAPITAL_SOURCES.map(s => s.id));
  const capitalIdentities = new Set([...ids, ...CAPITAL_POLITIES.map(p => p.id)]);
  assert.equal(new Set(CAPITAL_POLITIES.map(p => p.id)).size, CAPITAL_POLITIES.length);
  assert.ok(CAPITAL_POLITIES.every(p => p.title && p.scope));
  for (const capital of HISTORICAL_CAPITALS) {
    assert.ok(Math.abs(capital.coordinates[0]) <= 180 && Math.abs(capital.coordinates[1]) <= 90);
    assert.ok(sources.has(capital.coordinateSourceId));
    capital.periods.forEach(period => {
      assert.ok(capitalIdentities.has(period.polityId)); assert.ok(sources.has(period.sourceId));
      assert.ok(period.from <= period.to); assert.notEqual(period.from, 0); assert.notEqual(period.to, 0);
    });
  }
  assert.ok(STATE_HISTORY_EVENTS.every(event => Number.isFinite(event.time) && /^https:/.test(event.sourceURL)));
});

test('modern capitals use sourced start years and stop at the city-data coverage ceiling', () => {
  for (const [polityId, name, year] of [
    ['united-states', 'Washington, D.C.', 1800], ['turkey', 'Ankara', 1923],
    ['australia', 'Canberra', 1927], ['brazil', 'Brasília', 1960],
    ['india', 'New Delhi', 1947], ['china-prc', 'Beijing', 1949],
    ['nigeria', 'Abuja', 1991], ['canada', 'Ottawa', 1867],
    ['germany', 'Berlin', 1990], ['russian-federation', 'Moscow', 1991],
  ] as const) {
    assert.deepEqual(activeCapitals(polityId, year - 1), [], `${polityId} is not backdated`);
    assert.deepEqual(activeCapitals(polityId, year).map(c => c.name), [name]);
    const current = activeCapitals(polityId, 2025);
    assert.deepEqual(current.map(c => c.name), [name]);
    assert.match(current[0].period.note ?? '', /coverage ceiling/);
    assert.deepEqual(activeCapitals(polityId, 2026), [], '2025 is a data ceiling, not a forecast');
  }
  assert.deepEqual(activeCapitals('russian-sfsr', 1918).map(c => c.name), ['Moscow']);
  assert.deepEqual(activeCapitals('soviet-union', 1980).map(c => c.name), ['Moscow']);
  assert.deepEqual(activeCapitals('soviet-union', 2025), []);
  assert.equal(HISTORICAL_CAPITALS.filter(c => c.id === 'capital-beijing').length, 1, 'Beijing continuity shares one stable location');
});

test('every lifecycle has a period-begin navigation anchor without claiming a border observation', () => {
  for (const profile of STATE_HISTORIES) {
    const beginning = STATE_HISTORY_EVENTS.find(event =>
      event.civilization === profile.title && event.year === toAstronomicalYear(profile.fromYear));
    assert.ok(beginning, `${profile.id} beginning`);
    assert.ok(beginning.sourceIds?.length);
  }
  assert.equal(findStateHistory('Teotihuacan', 400)?.id, 'teotihuacan');
  assert.equal(findStateHistory('Monte Albán', 500)?.id, 'monte-alban');
  assert.equal(findStateHistory('Chile', 1900)?.id, 'chile');
  assert.equal(findStateHistory('Chile', 1700), undefined);
  assert.deepEqual(activeCapitals('han', -199).map(city => city.name), ['Chang’an']);
  assert.deepEqual(activeCapitals('han', 10), []);
  assert.deepEqual(activeCapitals('han', 100).map(city => city.name), ['Luoyang']);
});

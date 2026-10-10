import test from 'node:test';
import assert from 'node:assert/strict';
import { boundRulerWindow, layoutRulerEvents, rulerEmptyMessage, rulerTimeAt, rulerTicks, timelineContinents, zoomRulerWindow, type TimelineEvent } from '../src/history-ruler.ts';

test('ruler scrubbing preserves fractional and negative canonical input, with no observation snapping', () => {
  assert.equal(rulerTimeAt(.375, { min: -1000, max: 1000 }), -250);
  assert.equal(rulerTimeAt(.12345, { min: -1000, max: 1000 }), -753.1);
  assert.equal(rulerTimeAt(-.1, { min: -1000, max: 1000 }), -1000);
  assert.equal(rulerTimeAt(2, { min: -1000, max: 1000 }), 1000);
});
test('bounded zoom preserves the pointed day and reverses without date drift', () => {
  const bounds = { min: -2000000, max: 100000 }, initial = { min: -1000000, max: -900000 };
  const zoomed = zoomRulerWindow(initial, .5, .27, bounds);
  assert.equal(rulerTimeAt(.27, initial), rulerTimeAt(.27, zoomed));
  assert.deepEqual(zoomRulerWindow(zoomed, 2, .27, bounds), initial);
  assert.deepEqual(zoomRulerWindow(initial, 100, .27, bounds), bounds);
  assert.deepEqual(boundRulerWindow(-2100000, 100, bounds), { min: bounds.min, max: bounds.min + 100 });
});
test('calendar ruler labels cross BCE and CE without inventing a year zero', () => {
  const day = (year: number) => { const date = new Date(0); date.setUTCFullYear(year, 0, 1); return date.getTime() / 86400000; };
  const ticks = rulerTicks({ min: day(-501), max: day(501) }, 1000);
  assert.ok(ticks.some(tick => tick.label === '200 BCE'));
  assert.ok(ticks.some(tick => tick.label === '200 CE'));
  assert.ok(!ticks.some(tick => /\b0 (BCE|CE)/.test(tick.label)));
  assert.ok(ticks.length <= 32);
});
test('timeline rejects unbounded input and enforces a useful minimum navigation window', () => {
  assert.throws(() => zoomRulerWindow({ min: 0, max: 100 }, 0, .5, { min: 0, max: 100 }), RangeError);
  assert.throws(() => rulerTimeAt(NaN, { min: 0, max: 100 }), TypeError);
  assert.throws(() => boundRulerWindow(0, 10, { min: 1, max: 1 }), RangeError);
  assert.equal(zoomRulerWindow({ min: 0, max: 100 }, .001, .5, { min: 0, max: 100 }).max - zoomRulerWindow({ min: 0, max: 100 }, .001, .5, { min: 0, max: 100 }).min, 7);
});

test('every continent remains selectable without treating source observations as researched events', () => {
  const events: TimelineEvent[] = [
    { id: 'map', time: 20, title: 'Map observation', kind: 'observation' },
    { id: 'egypt', time: 30, title: 'Egypt event', kind: 'event', continents: ['Africa'] },
  ];
  assert.deepEqual(timelineContinents(events), ['Africa', 'Antarctica', 'Asia', 'Europe', 'North America', 'Oceania', 'South America']);
  assert.equal(rulerEmptyMessage(events, { kind: 'continent', name: 'Oceania' }, { min: 0, max: 100 }), 'No researched events for Oceania yet.');
  assert.equal(rulerEmptyMessage(events, { kind: 'continent', name: 'Africa' }, { min: 0, max: 100 }), '');
  assert.equal(rulerEmptyMessage(events, { kind: 'continent', name: 'Africa' }, { min: 50, max: 100 }), 'No researched events in this time window · zoom out to explore.');
  assert.equal(rulerEmptyMessage(events.slice(0, 1), { kind: 'all' }, { min: 0, max: 100 }), 'No researched events available yet.');
});

test('event nodes retain every exact date and expose nearby events as a group', () => {
  const events: TimelineEvent[] = [0, 1, 2, 50, 99, 100].map(time => ({ id: `event-${time}`, time, title: 'A researched historical event', kind: 'event' }));
  const layout = layoutRulerEvents(events, { min: 0, max: 100 }, 300);
  assert.deepEqual(layout.map(item => item.anchor), [0, 50, 99]);
  assert.deepEqual(layout.map(item => item.events.map(event => event.time)), [[0, 1, 2], [50], [99, 100]]);
  assert.deepEqual(layout.flatMap(item => item.events), events, 'Every dated event remains reachable in a node list.');
  for (const item of layout) {
    assert.equal(item.event.time, item.events[0].time);
    assert.equal(item.anchor, item.event.time, 'The node stays at its first actual date, without synthesizing a midpoint date.');
    assert.ok(!('label' in item), 'Event labels are revealed on demand, not positioned persistently.');
  }
});

test('a dense full-history ruler bounds nodes without truncating research entries', () => {
  const dense: TimelineEvent[] = Array.from({ length: 12000 }, (_, time) => ({ id: `event-${time}`, time, title: 'Event', kind: 'event' }));
  const bounded = layoutRulerEvents(dense, { min: 0, max: 12000 }, 1000);
  assert.ok(bounded.length <= 97);
  assert.equal(bounded.flatMap(item => item.events).length, dense.length);
  assert.equal(new Set(bounded.flatMap(item => item.events.map(event => event.id))).size, dense.length);
  const zoomed = layoutRulerEvents(dense, { min: 9990, max: 10010 }, 1000);
  assert.equal(zoomed.length, 21, 'Zoom reveals exact individual dates.');
  assert.equal(zoomed[0].event.time, 9990);
  assert.equal(zoomed.at(-1)?.event.time, 10010);
});

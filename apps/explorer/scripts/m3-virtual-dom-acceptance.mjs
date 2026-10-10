#!/usr/bin/env node
/** User-approved virtual DOM substitute. Exercises the real research view and
 * controllers; geometry, map/camera, frame clock and download browser APIs are
 * explicit test doubles. This is not browser rendering or performance evidence. */
console.error('The virtual-DOM profile is retired. This legacy entry point now runs real Chromium acceptance; no mocks or simulated timings are used.');
await import('./m3-headless-acceptance.mjs');

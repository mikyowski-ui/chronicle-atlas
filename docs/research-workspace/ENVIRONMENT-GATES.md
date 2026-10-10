# Environment gates — dual-track sprint

The environment work preserves the Canvas fallback and the committed historical source edition. No canonical data or publication manifests are changed.

## Implemented

- `GLMap.reloadBasemap('paper' | 'contrast')` accepts two host-owned styles. It does not accept a resource URL or generated style. The same MapLibre instance and camera survive the reload.
- One owned `style.load` listener restores physical geography, the committed epoch/supplement, visibility, selected and hovered feature state, contextual terrain, and map-positioned labels. Archive retains are not repeated during restoration. Queries and paint updates tolerate the temporary absence of layers.
- Staging work is canceled before a style replacement. New scene preparation waits for a pending style restoration. Superseded requests, timeout, failure, and disposal have explicit outcomes. Restoration promise resolution means the bindings exist; it does **not** mean tiles have finished loading or a physical frame has appeared.
- Diagnostics report real source/layer IDs, source hash/edition, feature selection state, tile/style readiness, and owned style listener counts. These provide a browser verification surface without exposing the internal map object.
- The shared `DetailCanvas` city-radius tween follows the current OS reduced-motion preference. Changing the preference while a tween is active completes it immediately. Changes remain direct when reduction is enabled. Disposal removes the owned preference listener.
- Existing application camera changes are instantaneous (`jumpTo` and zero-duration `fitBounds`). The installed MapLibre 5.12.0 `easeTo`/`flyTo` paths already check reduced motion unless marked essential; Chronicle does not mark them essential. An active native camera transition is also stopped when the preference becomes enabled.
- The application-wide CSS reduced-motion rule disables animation, transitions and smooth scrolling on elements and pseudo-elements. Research and semantic views additionally have their own equivalent rules. Source inspection found no application CSS keyframe animation.
- Timeline playback starts paused. A live preference change to reduction pauses playback through the host-owned motion controller. Deliberate scrub/seek operations still update the historical cursor directly; explicit Play remains available as a user-requested temporal data operation. There is no decorative cursor or camera tween added to these input paths. The preference listener is disposed with the host.

## Executed deterministic checks

From `apps/explorer`:

```sh
node --import tsx --test tests/environment-lifecycle.test.ts tests/detail-canvas.test.ts
corepack pnpm exec tsc --noEmit
```

Both commands passed when this note was written: **15 tests**, including six new environment tests. The saved test log is `apps/explorer/verification/research-workspace/environment-tests.log`.

The new tests cover preference changes, listener removal, completion of an in-progress city tween, suppression of new tweens, twenty style-load callbacks through one owned listener, supersession, disposal, restoration/replacement errors, and a bounded timeout. The city test calls the actual `DetailCanvas.drawOverlay` implementation against a recording Canvas context: a partially advanced radius immediately becomes the final radius, waiting does not move it further, the next changed population draws immediately, and reduced-motion draws schedule no new tween frames. This verifies emitted drawing operations in addition to diagnostics. The preference source, animation clock, Canvas context, and style event emitter are controlled fixtures. These tests establish lifecycle and drawing behavior, not browser GPU memory usage or physical-device accessibility.

## Browser and hardware evidence still required

The lead session's acceptance report is authoritative for browser results. A complete browser style exercise must alternate the two host basemaps, wait for reported style/tile readiness, and compare map/canvas identity, camera, edition/hash, source/layer IDs, feature selection, archive live-reference count, and research DOM overlay identity before and after. Repeated reloads must retain one style listener. Browser heap or GPU memory needs separately captured evidence; stable counts alone do not prove zero leaks.

At this checkpoint the lead reports that the available cloud browser is using Canvas and its OS media preference is `false`; a supported media-emulation facility has not been available. Consequently actual browser MapLibre reloads and OS-enabled reduced-motion behavior remain **NOT RUN** unless later browser evidence in the final acceptance report explicitly supersedes this status. The deterministic reduced-motion test is **PASS** and is intentionally reported separately.

Run layout checks at an actual CSS viewport of 375 px and inspect the selected inspector, chart/table, and timeline dock. An iframe viewport is responsive-layout evidence, not physical mobile evidence.

Run the browser with `prefers-reduced-motion: reduce` enabled and inspect computed animation/transition styles plus the renderer's `reducedMotion` and `activeCityTweens` diagnostics. An injected deterministic preference fixture does not prove the operating-system preference was exercised.

Native Windows GPU, physical mobile, driver stability, physical presentation timing, and true GPU-memory leak checks cannot be inferred from screenshots, source inspection, mocked lifecycle tests, or a software renderer. Report inaccessible checks as **NOT RUN** or **BLOCKED**, with the missing environment identified.

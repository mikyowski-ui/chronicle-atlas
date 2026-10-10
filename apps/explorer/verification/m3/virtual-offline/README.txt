Chronicle M3 virtual DOM acceptance kit

Requires Node >=22.13. No install, browser or network needed.
Run: node scripts/m3-virtual-dom-acceptance.mjs --offline
Output: verification/m3/virtual-dom/acceptance.json

Actual research view/controller behavior is tested. Layout geometry, map host, browser file APIs and animation clock are simulated. PASS is not real browser rendering, hardware GPU, physical mobile or real performance certification. Original50/100ms targets remain asserted as a contract; synthetic33.333/35.333ms timings result from the stated mock clock.

Source/build hashes: runtime/source-manifest.json
Bundled dependency licenses: licenses/dependencies.json and accompanying files.

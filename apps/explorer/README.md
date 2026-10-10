Current reviewed handoff: `../../docs/research-workspace/FINAL-REVIEW-ACCEPTANCE.md` and SESSION.md. Earlier checkpoint text is retained below.

# Current Research Workspace checkpoint

Read `../../SESSION.md` and `../../docs/research-workspace/DUAL-TRACK-ACCEPTANCE.md` for current run commands and evidence. Research includes a prepared, pinned-source pilot and a contrasting evidence catalogue. No live planner is enabled. Install the pinned package inside `research-semantic` before building; exact commands are in SESSION. Earlier product documentation remains below.

---

# Chronicle Explorer Alpha — VP07 Wave C candidate

Baseline: VP06 `090f09c607654fac412116e3b1e3f9c076da05fc`. This staged local
candidate preserves the public ledger, immutable audit cells, the 60 original
regressions and the Meridian Isles fixture. Historical publication still needs
exact-result approval.

Run the packaged application with **`node serve.mjs`** (Node 22.13+), then open
**http://127.0.0.1:4173**. It needs no remote tile service or dependency install.
The ZIP contains production assets, corresponding source, lockfile, tests,
compilers, retained source inputs, rights and review receipts.

## Explore

The default British Isles atlas retains 31 source snapshots, 200 BCE–1900 CE.
The 1847 marker is a separate migration observation with no political assertions.
Unsupported years remain gaps. Source-year windows never imply exact events.
Choose Meridian Isles in the Atlas menu for the two synthetic epochs.

- Drag to pan; wheel or navigation buttons zoom. Click a polygon or independent
  label; search finds active entities. All fragments of the entity highlight.
  Hover is independent of selection.
- Space plays/pauses; Left/Right step supported observations; 1–5 choose speed;
  Escape clears selection and inspection. Shortcuts do not run while editing.
- Layers opens independent density/movement controls. Real density is unavailable;
  the UK 1900 card instead shows the precomputed England/Wales regional reference.
  The full UK population remains unknown. The 1847 route is a schematic connection
  for reported arrivals, not reconstructed voyages or a continuous flow estimate.
- Inspect evidence opens assertion references, valid/recorded time, uncertainty,
  methodology, rights and independent demographic sources in place.
- The ··· diagnostics tray contains identities, GPU classification, source/cache
  counters, the 500 ms delivery switch and an interaction-receipt export. Select
  Aster at 950, seek 1050 then immediately 1049. The old committed scene remains
  visible until the newest complete generation is ready.

## Display and audit geometry

The 0.5° audit mesh and its existing compiled data remain untouched. The separate
Alpha display product uses all 123 prepared source features directly, decomposed
into stable polygon parts, with spatial-only zoom simplification during tiling.
The neutral physical context is bounded Natural Earth 4.1.0 land. Modern physical
coastlines are context, not historical political evidence; source coastlines can
be coarser or disagree. Study-box clipping edges are not historical borders.

Historical Basemaps revision `da7a4b735ecef70aebdc9c73e409d8a2500d50f3` remains
GPL-3.0. Corresponding inputs and rights are in `public/wave-b/source/` (and its
production copy). Alpha inventory and exact input hashes are in `public/alpha/`;
ONS and Hansard inputs/licenses are in `public/people/`. See the three new
methodology documents in `fixtures/`. Cultural labels do not imply ownership.

## Runtime and verification

A single long-lived MapLibre instance uses native vector PMTiles sources with
`promoteId:"render_id"`. Fixed land plus at most active/staging epoch groups use
generation/camera readiness guards. Full archive hashes are checked in compilation
and verification; runtime range delivery checks 16 KiB SHA-256 chunks with bounded
caches. The two synthetic archives have 201/233 tiles across zooms 0–7.

Canvas initializes independently when WebGL2 is unavailable, consuming hashed
untiled source-vector sidecars. Population comparisons are compiler products;
card rendering does no polygon clipping/intersection. Seven-field lookup keys
retain edition, entity, state, geometry, dataset, date and method identity.

Read `verification/alpha/VP07-REVIEW.html` and JSON receipts for executed results.
Canvas, software WebGL and Windows physical hardware are separate acceptance
profiles. CPU/native protocol tests are not shader execution. A context probe
is not physical GPU evidence. Required Windows OS/browser/GPU/driver/GL_RENDERER,
chrome://gpu, frame-rate and sustained memory evidence must be collected on that
actual device; unexecuted scenarios remain NOT RUN.

## Development

From `source/apps/explorer` in the source handoff (or this app directory):

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm test
node scripts/verify-alpha.mjs
node serve.mjs
```

The lockfile pins pnpm 11.19.0 dependencies. Python compilation uses the pinned
PMTiles 3.8.1 writer; detailed bounded rebuild instructions are in
`fixtures/ALPHA-CARTOGRAPHY.md` and `fixtures/PEOPLE.md`. No global ingestion,
new database or packaging framework is required. Existing Wave B compiler inputs
and regression prerequisites are included in the corresponding source handoff.

## Current M2 integration checkpoint

Both evidence pilots now use the same linked Research workspace. See [../../docs/research-workspace/M2-INTEGRATION.md](../../docs/research-workspace/M2-INTEGRATION.md) and the adjacent M2-INTEGRATION-ACCEPTANCE.md for the current commands, complete-workspace replay contract and unrun browser/hardware gates. Live inference and generated execution remain disabled.

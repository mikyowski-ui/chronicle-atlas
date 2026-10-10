# Integrated world display candidate

This directory contains one bounded source-political overview for the nominal
year 1900 and independent global neutral physical context. It is a local/staged
display product. No public ledger, immutable audit cell, prior recorded edition,
Hawaiʻi quarantine or publication gate is changed.

`catalog.json` joins two existing Alpha-format manifests. The regional route has
exclusive precedence when camera center is within `[-12,48,3,61.5]` at zoom 4 or
higher. Otherwise the world route applies. Only one political scene is painted
and picked at a time. The world manifest contains one observation, not a global
continuous timeline. The regional manifest retains its 31 historical snapshots and
independent migration observation. `global-base.json` supplies the same neutral
world to both routes.

The full pinned Historical Basemaps `world_1900.geojson` was recovered from the
existing project. Its SHA-256 and Git blob identity match the recorded pinned
revision `da7a4b735ecef70aebdc9c73e409d8a2500d50f3`; no regional clip was treated as
a world file. Retained GPL-3.0 text, attribution, exact inputs and mappings are in
`source/`. The old asset-checksum registry was stale for the current classification
file. The source inventory records that mismatch explicitly; all 270 mapping rows
were replayed against the retained current classifier and matched their decision,
rule and rationale. This is a semantic-classification check, not historical
certification.

Of 270 source features, 111 source-political associations are displayed as 94 entities
and 280 polygon parts. `review-queue.json` lists all 159 omissions: 111 unresolved or
suspect mappings and 48 unidentified exclusions. Raw `SUBJECTO` and `PARTOF` fields
are preserved in the mapping record and do not establish inferred control or
suzerainty. No cultural, archaeological or generic population label is converted
to ownership. Shared UK, France and Belgium identities and colors come from exact
source-name matches to the existing 1900 Isles scene. Display-state and geometry
identities remain separate across products.

The year interval is the possible observation envelope for a nominal annual
snapshot. It is not an exact event date, a claim that borders were constant every
day of 1900 or permission to extend historical validity. Atlas reference mode, if
used by the viewer, must keep reference dates distinct from the browsing date.

The full Natural Earth 50m archive 4.1.0 supplies 1,421 land components from 1,420 shape
records. Deterministic groups of ten form 143 MultiPolygon feature objects, below
the existing 1,000 feature cap. All 60,669 vertices are retained; 269 latitudes outside
the Web Mercator display domain are clamped to its polar limits. No component is
omitted or simplified in the Canvas fallback. The physical land is modern
geographic context, never evidence of a historical shoreline or political claim.

The separate MVT product uses the existing `geojson-vt` encoding at zooms 0–4;
cartographic zoom simplification does not alter retained source/fallback geometry
or temporal assertions. The original political geometry passed JSTS 2.12.1
topology validation for all 111 admitted features; no repair was needed. All 280 parts
have encoded representations at maximum source zoom 4, though subpixel visibility
at a particular camera scale is not guaranteed.

Run from `apps/explorer/` with existing dependencies and the existing PMTiles
Python writer environment:

```
node --max-old-space-size=256 --import tsx scripts/build-integrated-world.mjs
node --import tsx --test tests/integrated-world.test.ts
```

The compiler checks pinned input and budget hashes before processing, uses one
sequential worker, and retains the 60 second per-batch, 1 MB archive, 2 MiB metadata,
4 MiB fallback, 1,000 part, 250,000 physical-vertex, 32 epoch and 64 KiB manifest bounds.
The pre-frozen allowance for new compressed products is 16 MiB, within the existing
128 MiB aggregate cap. Current archives total 745,497 bytes in 426 spatial tiles.
Measured compilation: approximately 0.90 seconds; Node peak RSS 189,472,768 bytes.
A second compilation reproduced both archive hashes. Cumulative compressed usage
is 32,679,413 bytes against the unchanged 134,217,728 byte cap.
These are compiler observations, not browser frame-rate or physical GPU evidence.

`build-record.json` contains exact measurements and archive digests. Five focused
tests exercise continent-spanning archive access, full neutral-base loading,
political source preservation/omissions, cross-route entity selection intent and
the absence of world political coverage before 1900. Browser acceptance belongs
to the integrated application's separate receipt.

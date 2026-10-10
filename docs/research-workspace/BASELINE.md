# Research Workspace Milestone 1 — baseline

Inspected October 7, 2026. The preceding scratch checkout had been removed by workspace maintenance. The existing application was recovered from the saved, matching Teaching Atlas Source and Originals archives; it was not recreated as a new Atlas.

| Input | SHA-256 |
| --- | --- |
| Chronicle-Teaching-Atlas-Source.zip | `605d302de8687a9dfa6f21f38502492fd6b94894efa500bcd93a691bb1da3186` |
| Chronicle-Teaching-Atlas-Originals.zip | `c344a7d350037b0f601d3e6400e8520d7335a1a6af56dbb5441dba52f329fa8e` |

Editable root: `Chronicle-Explorer/source`. Application: `apps/explorer`; shared contracts: `packages/contracts/src`. This extraction contains no `.git` directory. Therefore current Git revision and Git dirty status are unavailable, not clean. The source packet records its original application commit as `1dc4084baee4602cbd8d587faf99b972a3d6b6a8`; that is an archive provenance reference, not a present checkout HEAD.

The recovered source built to the exact prior source fingerprint `204a8bd29b0b58db8b66db54354bdff08950e95b77d4ba18d8f6ae239362355b` and build ID `chronicle-a291668ccb5651a69ec319fea61f5f79889ea37d1c0a53b01a86d5d11b7203f3`. The baseline build reports `source_commit: null` honestly. Actual file hashes were recorded before implementation and are used for change/protection checks instead of a fabricated Git diff.

## Instructions reconciled

No root, nested or ancestor `AGENTS.md`/`AGENTS.override.md` was present in the recovered source or applicable workspace parents. Existing source README, application README, session notes and protected-data conventions were read. The supplied AGENTS was installed at source root; the implementation plan and work order were installed here. No unrelated instruction file was overwritten. The old application README contains earlier VP07 product descriptions, so inspected source and the newer root README/session record establish actual behavior.

This task authorizes a derived research view of the existing local Teaching Atlas preview. It does not publish a historical edition, mutate the canonical population collection, change a ledger, migrate the renderer, enable a model service, or deploy remotely. No source fetching or broad historical ingestion is required by the pilot.

## Actual runtime and commands

Node `v24.19.0`; initial environment pnpm `11.25.0`. The package pins `pnpm@11.19.0`, confirmed available through `corepack pnpm --version`. The existing frozen lockfile was installed without dependency or lockfile changes. Subsequent verification uses `corepack pnpm` so the package's pinned version is selected.

Executed from `apps/explorer` before integration:

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm test
```

Results: installation PASS, TypeScript/production build PASS, 282 tests PASS / 0 failed / 0 skipped. Vite reported the existing large JavaScript chunk advisory. Logs and exact baseline build identity are in `apps/explorer/verification/research-workspace/baseline-{build,tests}.log` and `baseline-build-info.json`. The retained source packet itself contains required historical regression fixtures.

## Integration owners

- `src/main.ts`: existing `TimeMotion`, canonical-day timeline cursor, requested date and territory selection. Research subscribes to the existing cursor and requests time changes through `seekTime`/the existing year adapter. Research observation selection is distinct from the country's context selection.
- `src/canvas-map.ts`, `src/gl-map.ts`: long-lived renderer instances. A small projection adapter supports temporary research point buttons without rebuilding the map or changing historical geometry/styles.
- `src/history-ruler.ts`: full-width dock and separate filters retained.
- `src/dossier-inspector.ts`, `src/polity-context-card.ts`, `src/teaching-studies.ts`: existing source/country/study flows retained; the research inspector is a separate adaptive area.
- `public/history/cities.json` and retained `public/history/source/` inputs: canonical population data, read only. The new bounded derivative lives under `src/research/`.
- `public/**`, `packages/contracts/**`, `lib/**` and retained authoritative/verification inputs: protected by before/after byte comparisons; generated `dist` is a build product, not a publication boundary.

No dependency was introduced. The declarative scatter/table renderer uses host-created DOM/SVG elements, no evaluation or external chart loaders. Prepared specifications choose only registered datasets and view types.

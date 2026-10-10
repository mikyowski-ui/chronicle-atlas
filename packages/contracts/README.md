# Chronicle Explorer fixture contract

`src/index.ts` contains the approved VP-01 TypeScript interfaces. The consumer
provides the GeoJSON type dependency (`@types/geojson`). The fixture is synthetic
and does not represent an accepted historical publication.

- Historical time is an integer count of proleptic Gregorian days since
  1970-01-01, using Chronicle's existing chronology adapter.
- Feature intervals are half-open: `t_start <= time && time < t_end`. Both
  bounds must be finite integers, with `t_start < t_end`.
- The initial committed time must display at least three distinct, nonoverlapping
  valid polygons. Polygon rings must be closed, and `render_id` values unique.
- Bind the GeoJSON source with `promoteId: "render_id"` for stable picking.
- Requested time, committed historical state, and presentation elapsed time are
  separate. Presentation animation must not interpolate historical geometry or
  determine feature eligibility.
- Resolve card contents from the selected feature in the committed state. Clear
  selection when that feature is no longer active.
- VP-01 playback toggles `isPlaying`; it does not require historical time to
  advance automatically.

These interfaces describe the contract; fixture runtime validation belongs to
the consuming explorer application.

## Temporal delivery and independent layers

VP-02 through VP-04 add `TemporalManifest`, `FixtureEpoch`, `SceneSnapshot`,
`PopulationFeature`, and `MigrationFeature` without replacing the VP-01 types.
The manifest identifies one synthetic edition and half-open epochs; each epoch
identifies an immutable PMTiles archive by SHA-256 and byte length. Archive URLs
resolve relative to the manifest URL. The fixed `tile` tuple uses `[z, x, y]`.

An accepted scene groups territory, independent density, and migration records
under one generation, epoch, edition, and committed day. An asynchronous seek
must not expose records from two generations. The current scene remains visible
until all required layers for a requested generation are ready. Aborted or late
requests cannot commit over a newer request.

`render_id` identifies a rendered part; `entity_id` identifies the selectable
entity. An archipelago may have several active Polygon features sharing an
entity and territory-state identity. Selection applies to every active render
ID for that entity. Selection may therefore survive an epoch transition when
the entity remains active even though its render IDs change.

Population has no required political-entity association. Its `density` is
invented people per square kilometre. Migration `magnitude` is an invented
number of people across the stated interval, with no implied annual rate.
Both use their own render IDs and half-open time intervals. Display toggles
change visibility only and preserve the selected entity and committed day.

The implemented fixture uses two epochs, 950–1050 CE and 1050–1150 CE, initially
1000 CE. These dates organize synthetic test data; they make no historical claim.
See `apps/explorer/fixtures/README.md` for the authored input, encoding precision,
resource bounds, and deterministic rebuild command.

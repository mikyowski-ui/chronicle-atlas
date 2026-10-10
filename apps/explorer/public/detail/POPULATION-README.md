# Independent population density observations

This staged layer contains four **modeled** global observations: **1910, 1950,
2000 and 2010**. It does not turn population change into a migration route and
does not assign population to historical territories.

The source is **ISIMIP3a Population Input Data v1.4**, provider edition
`20260807`, DOI [10.48364/ISIMIP.822480.4](https://doi.org/10.48364/ISIMIP.822480.4).
The provider API identifies it as **CC0-1.0**. Author attribution, exact source
URL, retained provider records, byte length and SHA-512/SHA-256 hashes accompany
the data. The complete pinned source is retained in `population-source/`.

The source is a modeled spatial distribution based on HYDE 3.3 with country-level
scaling. Version 1.4 uses a fine land grid during that scaling, then aggregates
back to the distributed grids. The admitted input is the 0.5° historical-scenario
`total-population` variable. Its NetCDF global title says ISIMIP3b while the API
assigns the exact file ID and checksum to ISIMIP3a; both records remain unchanged.
This metadata discrepancy is disclosed rather than silently corrected.

## Display contract

`population.json` lists four hashed, bounded JSON observations. Their arrays have
16,200 slots in row-major order: north to south, west to east. The first cell is
180°W–178°W, 88°N–90°N. Every cell is 2° by 2°.

- `counts`: sum of available counts in the source 4 × 4 cell block.
- `densities`: count divided by the complete spherical geographic cell area,
  including water, using mean Earth radius 6371.0088 km. **Not land-only density.**
- `knownSourceCells`: number of valid contributing source cells, 0 through 16.
- `null`: no valid source values; not zero population.
- `0`: valid source data whose population sum is zero.

No interpolation is performed. Before 1910, follow-date mode has no admitted
population surface. An earlier surface held while browsing must retain its own
visible observation date. A manually pinned surface is independent of the map
date and must visibly say so. A 2010 pin on an ancient map is a modern comparison,
never an ancient population estimate.

At this resolution, a coastal or island cell can include substantial water and
partial source coverage. The layer cannot supply street detail, settlement
population, ethnic identity, political ownership or a migration mechanism.
Differences between dates describe changes in modeled distribution; births,
deaths, model revisions and migration cannot be separated from those differences.

## Reproduction and scope

From `apps/explorer/`, with Python 3, NumPy and h5py installed:

```sh
python3 scripts/build-population-detail.py
```

The default build reads the retained source offline. `--fetch` downloads only the
same pinned source and refuses mismatching length or SHA-512. It reads one year
at a time and uses the shared detail-compiler lock. The frozen input cap is
64 MiB, output cap 8 MiB and worker RSS cap 512 MiB. Actual values are recorded
in `population-build-record.json`.

The four outputs conserve source counts. No 121-year in-memory cube, territory
intersection, runtime density fabrication, inferred route or public-ledger write
is involved. Earlier historical gridded HYDE intake remains outside this admitted
slice: the Utrecht directory returned an anti-bot challenge, and the Harvard
author dataset returned HTTP 403. Neither access restriction was bypassed.

Population before 1910 remains an explicit gap. The retained ONS England/Wales
1900 regional total remains available in its original territory card; it is not
converted into a fabricated density map.

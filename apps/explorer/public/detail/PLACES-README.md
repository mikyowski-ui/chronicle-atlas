# Settlement detail

This staged display layer contains 6,157 settlement points from **Pleiades Datasets 4.1** (28 May 2025, commit `b6a6790f71c45e4a4ef60fce296c506f28f458bf`) and 7,341 modern orientation points from **Natural Earth 1:10m populated places 5.1.2**.

Pleiades points are possible relevance within the selected location's approximate year envelope. They do not establish continuous occupation, exact founding or abandonment dates, a historical capital, city population, or territorial ownership. The year envelope is inclusive and uses astronomical years; the original no-year-zero bounds remain alongside it. One precise, certain direct location is chosen per certain settlement identity by lowest source-reported accuracy radius, then source URI. Alternative locations are retained in the exact original GIS archive. This selection can omit other attested periods; it does not join dates or combine location envelopes.

Natural Earth points are **modern orientation context only**. They have no historical validity dates and must be explicitly distinguished from the selected historical date. Modern names are not backdated into antiquity. One South Pole station is excluded because it lies outside Web Mercator's latitude limit; its original coordinates remain in the archive and exclusion receipt. No city population or population-change routes are derived here.

At 200 BCE, 2,624 Pleiades points satisfy the source-envelope filter; at 500 CE, 3,434; at 1000 CE, 95; at 1600 CE, 38. Coverage is concentrated in the ancient Mediterranean and adjacent regions. Absence of a point is not evidence that a place did not exist. The full modern orientation set is separate from these counts.

Exact original inputs are in `source/pleiades-4.1-gis.zip` and `source/ne_10m_populated_places.zip`. The Pleiades archive preserves the original GIS CSV bytes and source README/license. Individual place and location URIs identify the rows and preserve a path to contributor attribution and evidence; the CSVs retain their source provenance. Books or websites cited by the data are not copied or independently relicensed. `places-rights.json` records license, attribution, changes and edition identity; `places-receipt.json` contains input/output hashes, complete row accounting and measured resources. `places-review-queue.json` records excluded uncertain identities and settlements without an eligible direct point.

Reproduce from the repository root with:

```sh
flock /tmp/chronicle-detail-compile.lock python3 apps/explorer/scripts/build-detail-places.py
```

This uses the retained, read-only `data/beta/pleiades` source set when present, or the exact GIS archive and source manifest supplied with this application. The Natural Earth archive is also retained. It performs no network retrieval, ledger mutation or historical publication. Processing stays within the frozen aggregate detail budget and `places-budget.json` limits. The generated `places.json` is deterministic; elapsed time and RSS in the receipt are measurements of a particular run.

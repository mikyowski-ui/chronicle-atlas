# Chronicle Atlas city evidence layer

Build date: 2026-09-27. Runtime data: `../cities.json`.

## Scope

13,763 city reference records, 108,064 selected population estimates, from 3700 BCE to 2025. The historical input has 10,352 rows; the modern source contributes 98,495 sampled checkpoints. There are 1,146 conservative identity alignments and 730 city-years with retained alternative estimates. These counts describe available evidence, not a complete inventory or definitive ranking of the world's cities.

Historical years use astronomical numbering: 1 BCE is year 0, 2 BCE is -1. No population is invented between observations. First evidence is not a founding date; last evidence is not abandonment. The app's world prominence window is 150 years through 500 CE, 75 years from 501–1700, and 30 years after 1700. Older evidence remains a detailed, hollow location reference. These windows govern display relevance, not historical population decay.

## Sources and reuse

Reba, Meredith; Reitsma, Femke; Seto, Karen C. (2016). Spatializing 6,000 years of global urbanization from 3700 BC to AD 2000. Scientific Data 3, 160034. https://doi.org/10.1038/sdata.2016.34. Digitized Chandler and Modelski datasets by Meredith Reba, licensed CC BY 4.0: https://creativecommons.org/licenses/by/4.0/.

Dataset records: https://doi.org/10.6084/m9.figshare.2059494 (Chandler), https://doi.org/10.6084/m9.figshare.2059497 (Modelski Ancient), https://doi.org/10.6084/m9.figshare.2059500 (Modelski Modern). The combined CSV and wide tables were obtained from this frozen public mirror because direct Figshare downloads failed: https://github.com/fasiha/Historical-Urban-Population-Growth-Data/tree/808ff2b4a279013f58621a3696cb9c28058c6af1. The mirror text was normalized as UTF-8 with terminal newlines. Input hashes are preserved in `../city-build-manifest.json`.

United Nations, Department of Economic and Social Affairs, Population Division (2025). World Urbanization Prospects: The 2025 Revision, Online Edition. File 21, POP/DB/WUP/Rev.2025/F21. Copyright © 2025 United Nations. Licensed CC BY 3.0 IGO: https://creativecommons.org/licenses/by/3.0/igo/. Official source: https://population.un.org/wup/assets/Download/Cities/WUP2025-F21-DEGURBA-Cities_Pop.xlsx. Exact workbook metadata and statistical notes are retained in `UN-WUP2025-METADATA.txt`.

This layer adapts these sources by filtering, unit conversion, year-number conversion, source attribution, conservative identity alignment, name curation, and checkpoint sampling. Source authors and the United Nations have not endorsed this adaptation. Preserve the source attribution, license links, and this description of changes when redistributing the data. The app's own code license does not replace these third-party licenses.

## Decisions and caveats

- UN data use DEGURBA urban centres and population-weighted reference centroids. These extents differ from historical city estimates. Population jumps across definitions must not be presented as demographic change alone.
- Only estimated years through 2025 are imported. Projections for 2026–2050 and 3,637 future-only rows are excluded. Five-year checkpoints plus each city's first and final available estimate are used; the raw annual workbook remains available.
- The UN current-capital flag is deliberately excluded from historical capital claims. Capitals require independently dated evidence in `../capitals.json`.
- Historical same-name/alias points are joined within 10 km; UN reference identities within 50 km are joined only where unambiguous. Join receipts are in `../city-alignments.json`. Coordinates mark a general reference location, not an ancient footprint or seat of government.
- Reference names remain explicitly unverified for their historical period except for the curated dated-name entries. Place-name change and urban continuity are separate questions.
- Geographic reliability scores 1–3 describe geocoding, not population confidence. Conflicting values remain as alternatives. The compiler's deterministic display preference does not prove which historical estimate is correct.
- Modelski's mainland China values under the AD_2000 header are dated 1990 following the associated paper's stated census basis.
- `../city-quarantine.json` preserves 25 withheld raw rows and reasons: impossible/suspect BCE duplicate columns, wrong Caracol identity, the London BCE row, a modern population assigned to archaeological Egyptian Memphis, uncorroborated Gallipoli medieval outliers, and nonpositive values. Withholding does not invent corrected values. Other historical records still need specialist review.

## Reproduce

From the app root, with Python 3 and `openpyxl` installed:

```sh
python scripts/compile-historical-cities.py
```

Inputs default to `public/history/source`; output defaults to `public/history`. Explicit `--source-dir` and `--output-dir` arguments are supported. The raw files and compiler must travel together. The original source material can be packaged outside the executable; runtime requires only the compiled JSON files and attribution.

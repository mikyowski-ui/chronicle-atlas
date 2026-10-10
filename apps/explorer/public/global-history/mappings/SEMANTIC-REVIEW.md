# Source-semantic admission record

This is the preserved primary40 semantic record. The subsequent optional9 extension has separate decisions and accounting in [EARLIER-SEMANTIC-AMENDMENT.md](EARLIER-SEMANTIC-AMENDMENT.md); the original40 mapping bytes remain unchanged.

These are **source-attributed display classifications**, not independently reviewed historical borders. All 40 pinned inputs are processed. The immutable audit mesh, historical editions and public ledger are not changed.

## Accounting

| Outcome | Raw source features |
|---|---:|
| Political/administrative association | 3,384 |
| Cultural presence | 164 |
| Aggregate/geographic source context | 677 |
| Unresolved review | 5,375 |
| Quarantined | 107 |
| Blank/unknown excluded from named display | 5,755 |
| **Total** | **15,462** |
| Independently reviewed historical features | **0** |

These are source-feature counts. They are not world-area percentages, historical completeness, or final rendered counts. The compiler separately records invalid geometry, protected Hawaiian components and subpixel parts. Original features remain archived even when omitted from display. The per-date reconciliation is in `classification-summary.json`; `label-worklist.json` groups repeated labels, dates, outcomes, rationales and source-feature identifiers.

The 1492 input contains 1,946 raw features, including a large set of individual Indigenous labels. Many are unresolved because the source record alone does not reliably distinguish dated political institutions, cultural territory and modern descriptive names. The same caution applies to hundreds of Australian community labels at early-modern dates. Their continued review status is deliberate; they were not converted into political ownership to fill the map.

## Decision precedence and identities

1. Protected Hawaiʻi labels or Hawaiian `SUBJECTO`/`PARTOF` references remain quarantined.
2. Blank and `?` labels are explicitly excluded from named display.
3. Dated chronology concerns remain quarantined; contested archaeological imperial interpretations remain in review.
4. The 486 versioned exact-label mappings apply only at listed observed years. This fixes the `United States of America` / `States` precedence defect.
5. Explicit cultural words produce cultural presence. Collective institutions, subsistence groups and aggregate populations produce low-priority source context, with no numeric population or singular state authority inferred.
6. Unambiguous singular institutional wording produces source-attributed political association. Remaining individual names stay in review.

The date lists are mapping applicability, not continuous valid-time intervals. Source nominal years retain annual precision and uncertainty. No event day, intervening border or carry-forward historical validity is inferred.

Exact dated Isles source-feature evidence anchors retained entity IDs, names and colors. Matching source-name fragments at that same observation join the same declared entity. This preserves France's separately indexed overseas components without guessing cross-era identity. Only four additional bounded source-label series declare cross-date continuity: United States (including its explicit alternate label), USSR, East Germany and West Germany. Other entities receive observation-scoped provisional identities and stable label-based styling. Selecting one does not silently select an unrelated later entity with the same name.

`SUBJECTO` and `PARTOF` otherwise remain uninterpreted source metadata. Colonial labels and disputed territorial associations do not assert independent sovereignty or effective control. Context areas such as Arabia, India, Papua New Guinea and Western Sahara are not coded as a single owner. Classification prose never supplies a government-structure dossier.

## Bounded reassessment and anomaly evidence

The retained classifier's permanent `Kingdom of France >= 1792` rejection was too broad. Versailles documents Louis XVIII's accession in 1814 and the Restoration. The revised triage permits a nominal 1815 monarchy observation while preserving uncertainty within that year; 1800 remains quarantined. No replacement geometry is created.

The US exact mapping is bounded to observed dates after 1776. The National Archives' Treaty of Paris record confirms the meaningful named polity by 1783; this supports semantic identity, not the source polygon.

New modern-input checks flag later state names at implausibly early observations: Bangladesh before 1971; Pakistan before 1947; Israel before 1948; UAE before 1971; Tanzania before 1964; Botswana before 1966; Zimbabwe before 1980; Zambia/Malawi before 1964; Lesotho before 1966; Burkina Faso before 1984; Sri Lanka before 1972; Guyana before 1966; USSR before 1922; Malaysia before 1963; Namibia before 1968. Zaire is held outside 1971–1996. These are conservative name/state triage checks, not a complete worldwide chronology audit. They explain visible gaps in some modern observations, especially 1945 and 1960. They do not rename a source polygon to an assumed predecessor.

Retained anomaly rules for earlier sources remain unresolved triage flags rather than infallible historical conclusions. No broad archaeological reinterpretation or new feature-level corroboration was performed in this batch.

Sources consulted on 23 September 2026:

- [US National Archives — Treaty of Paris, 1783](https://www.archives.gov/milestone-documents/treaty-of-paris): named-entity precedence check only.
- [Château de Versailles — Louis XVIII](https://en.chateauversailles.fr/discover/history/great-characters/louis-xviii) and [Restoration overview](https://en.chateauversailles.fr/discover/resources/versailles-french-revolution-interwar-period): narrow France-rule correction.
- [US Office of the Historian — Bangladesh, 1971](https://history.state.gov/milestones/1969-1976/south-asia) and [Israel, 1948](https://history.state.gov/milestones/1945-1952/creation-israel): formation-year triage.
- [UAE government — History](https://u.ae/en/about-the-uae/history): federation naming/formation triage.
- [UK Permanent Committee on Geographical Names — historical name changes](https://www.gov.uk/government/publications/country-names/timeline-of-country-name-changes-in-hmg-use-1919-to-present): bounded modern name-change checks. British usage is not universal recognition or border certification. The page's Malaysia independence entry is not used as the federation-formation date.
- [Malaysia government — Malaysian history](https://www.malaysia.gov.my/en/government/learn-about-malaysia/malaysian-history): Malaysia's 1963 formation.
- [United Nations — UNTAG background](https://peacekeeping.un.org/sites/default/files/past/untagFT.htm): adoption of Namibia's name in 1968, distinct from later independence.
- [US Office of the Historian — Botswana](https://history.state.gov/countries/botswana), [Zimbabwe](https://history.state.gov/countries/zimbabwe), and [Tanzania background](https://1997-2001.state.gov/background_notes/tanzania_0598_bgn.html): focused cross-checks.
- [Brazilian National Archive — republic proclamation](https://mapa.an.gov.br/index.php/ultimas-noticias/1728-proclamacao-da-republica): the retained Brazil-1900 anomaly remains quarantined.
- [US National Park Service — Queen Liliʻuokalani](https://www.nps.gov/articles/000/queen-lili-uokalani.htm): historical background only. The explicit Hawaiʻi documentary/publication quarantine remains in force independently of this secondary contextual source.

All references support the limited statements above. None independently validates a Historical Basemaps boundary or promotes the staged candidate into the public ledger.

## Reproduction and limits

Run from `apps/explorer`:

```sh
python3 scripts/build-global-mapping-registry.py
python3 scripts/classify-global-sources.py
node --import tsx --test tests/global-semantics.test.ts
```

Inputs are processed one source at a time. The classifier reads the frozen resource budget, verifies input SHA-256, rejects an expanded observation scope unless enabled, and enforces source bytes, RSS and job time limits. The measured classification run took 1.106 seconds with 62,451,712 bytes peak RSS. These figures measure classification only, not compiler/browser performance.

Seven focused tests pass: exact precedence, distinct cultural/context semantics, date scopes/anomalies, France reassessment, protected quarantine and blanks, exact-once full-corpus reconciliation, and fragmented identity preservation with provisional continuity. Browser and hardware verification belong to the integrated acceptance receipt; this file makes no renderer claim.

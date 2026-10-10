# Optional nine-observation semantic amendment

This amendment was executed **after** the primary40 product passed its integration gate. It adds 3000,2000,1500,1000,700,500,400,323 and300BCE source observations. The prior pilot's200BCE lower limit and primary40 records are preserved rather than rewritten. The separate `global-basemap-earlier-semantics-v4` registry contains185 explicitly classified earlier labels; it does not automatically extend primary exact-name mappings backward.

All40 primary mapping files and their registry remain byte-for-byte unchanged. Their scripts, mappings and checksums were archived under `verification/global-history/primary-40/semantic-mappings/` before this amendment. The classifier refuses a primary-file change during reproduction.

| Earlier observation | Raw | Political association | Cultural presence | Source context | Review | Quarantine | Blank/unknown excluded |
|---|---:|---:|---:|---:|---:|---:|---:|
| 3000BCE | 138 | 1 | 9 | 13 | 2 | 0 | 113 |
| 2000BCE | 145 | 1 | 15 | 26 | 3 | 0 | 100 |
| 1500BCE | 163 | 4 | 8 | 47 | 9 | 1 | 94 |
| 1000BCE | 163 | 3 | 9 | 48 | 9 | 1 | 93 |
| 700BCE | 174 | 7 | 15 | 50 | 7 | 1 | 94 |
| 500BCE | 189 | 5 | 15 | 44 | 13 | 0 | 112 |
| 400BCE | 190 | 6 | 20 | 43 | 12 | 0 | 109 |
| 323BCE | 149 | 13 | 13 | 43 | 6 | 0 | 74 |
| 300BCE | 155 | 17 | 13 | 41 | 7 | 1 | 76 |
| **Optional9 total** | **1,466** | **57** | **117** | **355** | **68** | **4** | **865** |

The earliest two observations each have only one admitted political source feature, Egypt. They are primarily archaeological/cultural and geographic-context views, **not complete worldwide political maps**. Egypt's semantic mapping acknowledges the source's ancient institutional association, not a modern state or independently verified borders. Later labels such as Assyria, Rome and the named Hellenistic kingdoms receive only individually dated institutional mappings. Identities remain scoped to the observation; a shared ancient name does not establish uninterrupted state continuity.

Cycladic, Minoan and Jōmon are cultural representations. Ur, Elam, Kerma and other ambiguous archaeological/geographic frames are context only. Generic subsistence groups and plural institutions remain context; no precise population, single government, point settlement identity or political ownership follows from them. Unresolved individual labels are kept in review. `Xia`, `Zhoa`, and `Zhangzhung Kingdom` are not silently normalized or certified. The source's repeated `Kingdom of David and Solomon` label at1500/1000/700BCE remains in interpretation review.

Four specific earlier source records are quarantined: Urartu at1500/1000BCE, LaTène culture at700BCE, and Kingdom of Antigonus at300BCE. They are chronology questions, not replaced borders. The nominal323BCE Alexander observation retains its annual precision; no exact day or year-long continuous imperial control is invented.

Bounded reference checks, consulted23September2026:

- [Egypt Ministry of Tourism and Antiquities — Early Dynastic Period](https://egymonuments.gov.eg/historical-periods/early-dynastic-period/) and [British Museum — Early Egypt](https://www.britishmuseum.org/collection/galleries/early-egypt): institutional unification context around3100BCE. These do not authenticate the source polygon.
- [Metropolitan Museum — Early Cycladic Art and Culture](https://www.metmuseum.org/essays/early-cycladic-art-and-culture), [Aegean Bronze Age](https://www.metmuseum.org/met-publications/art-of-the-aegean-bronze-age-the-metropolitan-museum-of-art-bulletin-v-69-no-4-spring-2012), and [Jōmon Culture](https://www.metmuseum.org/essays/jomon-culture-ca-10500-ca-300-b-c): cultural meaning rather than state ownership.
- [Library of Congress — Armenia](https://www.loc.gov/exhibits/armenian-literary-tradition/armenia.html): broad Hittite and Urartian institutional chronology. The dated Hittite mapping is restricted to1500BCE; other Hittite-labelled observations remain context.
- [British Museum — LaTèneI classification](https://www.britishmuseum.org/collection/term/x111162): a chronological reference beginning around450BCE, supporting quarantine of the700BCE label.
- [Oxford Classical Dictionary — AntigonusI](https://academic.oup.com/edited-volume/61673/chapter-abstract/548061563) and [Livius — Ipsus](https://www.livius.org/articles/battle/ipsus/): focused301BCE chronology check, not a substitute successor map.

The combined49-source classification reconciles16,928 raw features:3,441 political associations,281 cultural presence,1,032 context,5,443 review,111 quarantine and6,620 excluded. **Independently reviewed historical features remain0.** Compiler omissions and Hawaiian component protection are measured separately from these semantic counts.

Reproduction: run `python3 scripts/build-earlier-mapping-registry.py`, then `python3 scripts/classify-global-sources.py`. Frozen worker, source-byte, process-memory and job-time caps remain unchanged. The measured49-source classification took1.367seconds and65,875,968bytes peakRSS. Nine semantic tests now pass, including preservation of all primary mapping bytes and explicit earlier cultural/context/anomaly cases. Browser/native-profile results are separate integrated receipts.

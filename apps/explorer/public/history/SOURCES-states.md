# Researched state lifecycles and capitals

Edition: 27 September 2026. This is a curated reference layer, not a complete global political gazetteer. It currently provides 36 state or dynastic-period lifecycles. A separate modern-capital supplement can extend the capital layer without implying additional whole-life narratives.

## What these records establish

`state-histories.json` contains original, concise histories of political formation, development and dissolution or transition. The label, time range and political feature kind must all match before a history attaches to a source polygon. An explicit history selection may remain readable outside its represented years; the map and active capital still use the current cursor year.

Exact labels are scoped to dates to prevent modern Egypt, Mali or Benin from inheriting a different ancient or medieval state's history. Han, Tang, Byzantine and Mughal lookup ranges exclude researched interregna or occupation. The broad lifecycle remains readable across those interruptions. Not every political polygon yet has a researched lifecycle.

The ministry chronology of c. 2686–2181 BCE is used for the Old Kingdom, aligning its beginning with the Early Dynastic endpoint. The Met uses c. 2649–2130 BCE in its essay; that alternate chronology is retained as evidence, not added as a second timeline boundary. Archaeological periods such as Great Zimbabwe, Angkor, Teotihuacan and Monte Albán are explicitly approximate. Monte Albán's c. 800–850 CE endpoint uses 825 only as a navigation anchor; it does not claim an event happened in that year.

## Capital and location policy

`capitals.json` separates physical places from dated political roles. Multiple capitals, returns to an earlier seat and interruptions are allowed. The historical subset contains 24 city points and 31 role periods. Ranges are deliberately conservative where a fuller court itinerary has not been researched; an omitted year is missing capital coverage, not proof that no capital existed. Chang’an and Luoyang use such conservative phase intervals. A role endpoint does not delete the physical city.

Coordinates come from the cited Reba gazetteer and locate settlements at map scale. They are not surveyed ancient palaces, exact historic city footprints, or evidence of sovereignty. Explicit city IDs join compound historical names to the existing city index, avoiding duplicate markers. Source reference countries are modern locator labels and must not be presented as historical national membership.

All JSON dates use signed historical BCE/CE numbering: -1 is 1 BCE and there is no year zero. Period ranges are inclusive at annual precision; they do not establish the day of a capital move or conquest. The app converts those years to its astronomical calendar at the boundary. `toAstronomicalYear(-1)` is 0 internally. User-visible date labels remain BCE/CE. Capital intervals ending at 2025 in a modern supplement mark atlas coverage, not political dissolution.

## Evidence and limits

The sources are museums, heritage agencies, university teaching resources, official parliamentary history and specialist scholarship. Text is newly written factual paraphrase; no historical imagery, article body or cartographic geometry is reproduced from these references. Reba dataset attribution and its reuse terms are documented with the city dataset.

These sources support historical identities, dates, capitals and summaries. They do not independently verify the detailed border outlines used by the atlas. Period-begin and transition anchors are contextual navigation points, never invented dated boundary observations. Predecessor/successor targets are included only when the relationship is explicitly represented; absence of a target is not absence of historical succession.

`src/state-histories.ts` provides dated identity lookup, active capital lookup and timeline conversion. Focused tests cover BCE conversion, modern/ancient name separation, interruptions, out-of-lifetime lookup, capital moves, evidence references and period-begin anchors.

## Profile coverage

| Profile | Period | Evidence IDs |
| --- | --- | --- |
| Early Dynastic Egypt | c. 3100–2686 BCE | mota-early |
| Old Kingdom Egypt | c. 2686–2181 BCE | mota-old, met-old-egypt |
| Middle Kingdom Egypt | c. 2030–1650 BCE | met-middle-egypt, mota-second |
| New Kingdom Egypt | c. 1550–1070 BCE | met-new-egypt, mota-third |
| Ptolemaic Kingdom | 323–30 BCE · Ptolemaic rule | mota-ptolemy |
| Roman Republic | 509–27 BCE · conventional republican period | met-republic |
| Roman Empire | 27 BCE–395 CE · before permanent court division | met-rome |
| Western Roman Empire | 395–476 CE · western imperial court | met-rome |
| Eastern Roman / Byzantine Empire | 330–1453 CE · with fragmentation in 1204–1261 | met-byzantium |
| Achaemenid Empire | 550–330 BCE | met-achaemenid |
| Seleucid Kingdom | 312–64 BCE · Seleucid era convention | met-seleucid |
| Parthian Empire | 247 BCE–224 CE | met-parthian |
| Sasanian Empire | 224–651 CE | met-sasanian |
| Umayyad Caliphate | 661–750 CE · Damascus caliphate | met-umayyad, met-abbasid |
| Abbasid Caliphate | 750–1258 CE · Iraqi caliphate | met-abbasid |
| Ottoman Empire | c. 1299–1922 CE | met-ottoman, met-ottoman-early |
| Safavid Iran | 1501–1736 CE · effective imperial rule to 1722 | met-safavid, met-safavid-end, iranica-nader |
| Mughal Empire | 1526–1858 CE · interrupted rule, then nominal survival | met-mughal-early, met-mughal-late, iis-mughal |
| Mauryan Empire | c. 321–185 BCE | met-maurya |
| Han dynasty | 206 BCE–220 CE · Western and Eastern Han | si-han, parma-han |
| Sui dynasty | 581–618 CE | si-tang |
| Tang dynasty | 618–907 CE · with Wu Zhou interregnum | si-tang, si-song, columbia-wu |
| Song dynasty | 960–1279 CE · Northern and Southern Song | si-song, si-yuan |
| Yuan dynasty | 1271–1368 CE · conquest completed in 1279 | si-yuan, si-ming |
| Ming dynasty | 1368–1644 CE · principal imperial court | si-ming, beijing-tourism-ming |
| Qing dynasty | 1644–1912 CE · rule from Beijing | si-qing |
| Mali Empire | c. 1230–1600 CE · imperial period | met-mali-trade, met-sahel |
| Songhai Empire | c. 1464–1591 CE · imperial expansion | met-sahel |
| Kingdom of Benin | c. 1200–1897 CE · dynasty and independent kingdom | bm-benin, bm-benin-origins, bm-benin-dynasty |
| Zimbabwe state at Great Zimbabwe | c. 12th–15th centuries · principal period of influence | met-zimbabwe |
| Mexica Triple Alliance | 1428–1521 CE | inah-aztec, cdmx-alliance, inah-conquest |
| Inka Empire / Tawantinsuyu | 1438–1533 CE · main imperial expansion | si-inca, si-cusco |
| Khmer Empire · Angkor period | 9th–15th centuries CE · Angkor-centered phase | unesco-angkor |
| Teotihuacan urban state | c. 50–650 CE · urban state | inah-teotihuacan |
| Monte Albán state | c. 500 BCE–800/850 CE | inah-monte-alban, inah-monte-alban-tribute |
| Chile | 1818–present · independent state | bcn-chile-independence, bcn-chile-republic, bcn-chile-dictatorship, bcn-chile-democracy |

## Source register

The machine-readable register is `sources-state-register.json`. URLs and verification dates are also embedded beside each profile or capital evidence record.

| ID | Reference | Publisher |
| --- | --- | --- |
| bcn-chile-democracy | [1990 onward: Retorno a la democracia](https://www.bcn.cl/historiapolitica/hitos_periodo/detalle_periodo.html?per=1990-2022) | Biblioteca del Congreso Nacional de Chile |
| bcn-chile-dictatorship | [1973–1990: Dictadura militar](https://www.bcn.cl/historiapolitica/hitos_periodo/detalle_periodo.html?per=1973-1990) | Biblioteca del Congreso Nacional de Chile |
| bcn-chile-independence | [1811–1823: Congreso e Independencia](https://www.bcn.cl/historiapolitica/hitos_periodo/detalle_periodo.html?per=1811-1823) | Biblioteca del Congreso Nacional de Chile |
| bcn-chile-republic | [1833–1891: Consolidación de la República](https://www.bcn.cl/historiapolitica/hitos_periodo/detalle_periodo.html?per=1833-1891) | Biblioteca del Congreso Nacional de Chile |
| beijing-tourism-ming | [The Status of Beijing in Ming Dynasty](https://english.visitbeijing.com.cn/article/47OMiM6dfPl) | Beijing Municipal Culture and Tourism Bureau |
| bm-benin | [Benin Bronzes](https://www.britishmuseum.org/about-us/british-museum-story/contested-objects-collection/benin-bronzes) | British Museum |
| bm-benin-dynasty | [Figure: royal equestrian figure from Benin](https://www.britishmuseum.org/collection/object/E_Af1944-04-13) | British Museum |
| bm-benin-origins | [Visit resource: Benin](https://www.britishmuseum.org/learn/schools/ages-7-11/africa/visit-resource-benin) | British Museum |
| cdmx-alliance | [La Triple Alianza](https://mexicocity.cdmx.gob.mx/historical-timeline-of-mexico-city/triple-alliance/) | Secretaría de Turismo de la Ciudad de México |
| columbia-wu | [China 600–1000 CE: Tang and Wu Zhou](https://afe.easia.columbia.edu/tps/600ce_cn.htm) | Columbia University, Asia for Educators |
| iis-mughal | [Mughals](https://www.iis.ac.uk/glossary/mughals/) | The Institute of Ismaili Studies |
| inah-aztec | [Analizarán el origen del Estado mexica](https://www.inah.gob.mx/boletines/analizaran-el-origen-del-estado-mexica-en-el-museo-nacional-de-antropologia) | Instituto Nacional de Antropología e Historia |
| inah-conquest | [1519–1521: alianzas, confrontación y conquistas](https://mexicograndezaydiversidad.inah.gob.mx/publicacion/capitulo-07.html) | Instituto Nacional de Antropología e Historia |
| inah-monte-alban | [Monte Albán: archaeological context](https://lugares.inah.gob.mx/en/node/5597) | Instituto Nacional de Antropología e Historia |
| inah-monte-alban-tribute | [Zona arqueológica de Monte Albán](https://lugares.inah.gob.mx/en/node/4351) | Instituto Nacional de Antropología e Historia |
| inah-teotihuacan | [Zona arqueológica de Teotihuacan](https://lugares.inah.gob.mx/es/node/4528) | Instituto Nacional de Antropología e Historia |
| iranica-nader | [Nāder Shah](https://www.iranicaonline.org/articles/nader-shah/) | Encyclopaedia Iranica |
| met-abbasid | [The Art of the Abbasid Period (750–1258)](https://www.metmuseum.org/essays/the-art-of-the-abbasid-period-750-1258) | The Metropolitan Museum of Art |
| met-achaemenid | [The Achaemenid Persian Empire (550–330 BCE)](https://www.metmuseum.org/essays/the-achaemenid-persian-empire-550-330-b-c) | The Metropolitan Museum of Art |
| met-byzantium | [Byzantium (ca. 330–1453)](https://www.metmuseum.org/essays/byzantium-ca-330-1453) | The Metropolitan Museum of Art |
| met-mali-trade | [The Trans-Saharan Gold Trade (7th–14th Century)](https://www.metmuseum.org/essays/the-trans-saharan-gold-trade-7th-14th-century) | The Metropolitan Museum of Art |
| met-maurya | [Mauryan Empire (ca. 323–185 BCE)](https://www.metmuseum.org/essays/mauryan-empire-ca-323-185-b-c) | The Metropolitan Museum of Art |
| met-middle-egypt | [Egypt in the Middle Kingdom (ca. 2030–1650 BCE)](https://www.metmuseum.org/essays/egypt-in-the-middle-kingdom-2030-1640-b-c) | The Metropolitan Museum of Art |
| met-mughal-early | [The Art of the Mughals before 1600](https://www.metmuseum.org/essays/the-art-of-the-mughals-before-1600) | The Metropolitan Museum of Art |
| met-mughal-late | [The Art of the Mughals after 1600](https://www.metmuseum.org/essays/the-art-of-the-mughals-after-1600) | The Metropolitan Museum of Art |
| met-new-egypt | [Egypt in the New Kingdom (ca. 1550–1070 BCE)](https://www.metmuseum.org/essays/egypt-in-the-new-kingdom-ca-1550-1070-b-c) | The Metropolitan Museum of Art |
| met-old-egypt | [Egypt in the Old Kingdom (ca. 2649–2130 BCE)](https://www.metmuseum.org/essays/egypt-in-the-old-kingdom-ca-2649-2150-b-c) | The Metropolitan Museum of Art |
| met-ottoman | [The Greater Ottoman Empire, 1600–1800](https://www.metmuseum.org/essays/the-greater-ottoman-empire-1600-1800) | The Metropolitan Museum of Art |
| met-ottoman-early | [The Art of the Ottomans before 1600](https://www.metmuseum.org/essays/the-art-of-the-ottomans-before-1600) | The Metropolitan Museum of Art |
| met-parthian | [The Parthian Empire (247 BCE–224 CE)](https://www.metmuseum.org/essays/the-parthian-empire-247-b-c-224-a-d) | The Metropolitan Museum of Art |
| met-republic | [The Roman Republic](https://www.metmuseum.org/essays/the-roman-republic) | The Metropolitan Museum of Art |
| met-rome | [The Roman Empire (27 BCE–393 CE)](https://www.metmuseum.org/essays/the-roman-empire-27-b-c-393-a-d) | The Metropolitan Museum of Art |
| met-safavid | [The Art of the Safavids before 1600](https://www.metmuseum.org/essays/the-art-of-the-safavids-before-1600) | The Metropolitan Museum of Art |
| met-safavid-end | [Iran, 1600–1800 CE](https://82nd-and-fifth.metmuseum.org/toah/ht/09/wai.html) | The Metropolitan Museum of Art |
| met-safavid-silk | [Silk Textiles from Safavid Iran, 1501–1722](https://www.metmuseum.org/essays/silk-textiles-from-safavid-iran-1501-1722) | The Metropolitan Museum of Art |
| met-sahel | [Sahel: Art and Empires on the Shores of the Sahara](https://www.metmuseum.org/exhibitions/sahel-art-empire-sahara/inside-the-exhibition) | The Metropolitan Museum of Art |
| met-sasanian | [The Sasanian Empire (224–651 CE)](https://www.metmuseum.org/essays/the-sasanian-empire-224-651-a-d) | The Metropolitan Museum of Art |
| met-seleucid | [The Seleucid Empire (323–64 BCE)](https://www.metmuseum.org/essays/the-seleucid-empire-323-64-b-c) | The Metropolitan Museum of Art |
| met-umayyad | [The Art of the Umayyad Period (661–750)](https://www.metmuseum.org/essays/the-art-of-the-umayyad-period-661-750) | The Metropolitan Museum of Art |
| met-zimbabwe | [Great Zimbabwe](https://www.metmuseum.org/essays/great-zimbabwe) | The Metropolitan Museum of Art |
| mota-early | [Early Dynastic Period](https://egymonuments.gov.eg/historical-periods/early-dynastic-period/) | Egyptian Ministry of Tourism and Antiquities |
| mota-old | [Old Kingdom](https://egymonuments.gov.eg/historical-periods/old-kingdom/) | Egyptian Ministry of Tourism and Antiquities |
| mota-ptolemy | [Ptolemaic Period](https://egymonuments.gov.eg/historical-periods/ptolemaic-period/) | Egyptian Ministry of Tourism and Antiquities |
| mota-second | [Second Intermediate Period](https://egymonuments.gov.eg/historical-periods/second-intermediate-period/) | Egyptian Ministry of Tourism and Antiquities |
| mota-third | [Third Intermediate Period](https://egymonuments.gov.eg/historical-periods/third-intermediate-period/) | Egyptian Ministry of Tourism and Antiquities |
| parma-han | [206 BCE–220 CE: Han Dynasty](https://museocineseparma.org/en/scuole/le-dinastie-della-cina/106-206-bc-220-ad-han-dynasty) | Museo d’Arte Cinese ed Etnografico, Parma |
| reba-2016 | [Spatializing 6,000 years of global urbanization from 3700 BC to AD 2000](https://doi.org/10.1038/sdata.2016.34) | Reba, Reitsma & Seto, Scientific Data |
| si-cusco | [The Great Inka Road: Cusco](https://americanindian.si.edu/inkaroad/inkauniverse/cusco/introduction.html) | Smithsonian National Museum of the American Indian |
| si-han | [Han dynasty (206 BCE–220 CE)](https://asia-archive.si.edu/learn/for-educators/teaching-china-with-the-smithsonian/explore-by-dynasty/han-dynasty/) | Smithsonian National Museum of Asian Art |
| si-inca | [The Inka Empire: What Innovations Can Provide Food and Water for Millions?](https://americanindian.si.edu/nk360/inka-water) | Smithsonian National Museum of the American Indian |
| si-ming | [Ming dynasty (1368–1644)](https://asia-archive.si.edu/learn/for-educators/teaching-china-with-the-smithsonian/explore-by-dynasty/ming-dynasty/) | Smithsonian National Museum of Asian Art |
| si-qing | [Qing dynasty (1644–1911)](https://asia-archive.si.edu/learn/for-educators/teaching-china-with-the-smithsonian/explore-by-dynasty/qing-dynasty/) | Smithsonian National Museum of Asian Art |
| si-song | [Song dynasty (960–1279)](https://asia-archive.si.edu/learn/for-educators/teaching-china-with-the-smithsonian/explore-by-dynasty/song-dynasty/) | Smithsonian National Museum of Asian Art |
| si-tang | [Tang dynasty (618–907)](https://asia-archive.si.edu/learn/for-educators/teaching-china-with-the-smithsonian/explore-by-dynasty/tang-dynasty/) | Smithsonian National Museum of Asian Art |
| si-yuan | [Yuan dynasty (1279–1368)](https://asia-archive.si.edu/learn/for-educators/teaching-china-with-the-smithsonian/explore-by-dynasty/yuan-dynasty/) | Smithsonian National Museum of Asian Art |
| unesco-angkor | [Angkor](https://whc.unesco.org/en/list/668/) | UNESCO World Heritage Centre |
| unesco-fatehpur | [Fatehpur Sikri](https://whc.unesco.org/en/list/255/) | UNESCO World Heritage Centre |
| unesco-hangzhou | [West Lake Cultural Landscape of Hangzhou: nomination dossier](https://whc.unesco.org/uploads/nominations/1334.pdf) | UNESCO World Heritage Centre / China nomination |

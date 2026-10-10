#!/usr/bin/env python3
"""Explicit semantic amendment for the nine reviewed pre-200BCE inputs.

This does not extend primary-v3 exact-name membership. Clear source cultures and
aggregate words keep their distinct meanings; unreviewed individual names do not
become countries. Per-label/per-year overrides handle recurring source anomalies.
"""
import hashlib, importlib.util, json
from pathlib import Path
APP=Path(__file__).resolve().parents[1]
ROOT=APP/'public/global-history'
spec=importlib.util.spec_from_file_location('classify', APP/'scripts/classify-global-sources.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
budget=json.loads((ROOT/'resource-budget.json').read_text())
if not budget['scope']['optional_enabled']: raise RuntimeError('Optional earlier scope has not passed the primary gate')
targets=[x for x in json.loads((ROOT/'source/target-snapshots.json').read_text())['snapshots'] if x['source_year'] < -200]
if len(targets)!=9: raise RuntimeError('All nine optional input records required before this reviewed registry is emitted')
observed={}
for entry in targets:
    for feature in json.loads((ROOT/'source/input'/entry['filename']).read_text())['features']:
        label=str((feature.get('properties') or {}).get('NAME') or '').strip()
        if label and label!='?': observed.setdefault(label,set()).add(entry['source_year'])

# Individually selected institutional associations at these observations. This
# acknowledges the *source's* reconstruction, not ownership/control certification.
POLITICAL={
 'Egypt':[-3000,-2000,-1500,-1000,-700],
 'Assyria':[-1500,-1000,-700], 'Babylonia':[-1500,-1000,-700],
 'Hittites':[-1500], 'Urartu':[-700], 'Kush':[-700], 'Wu':[-700],
 'Saba':[-700,-500,-323,-300], 'Magadha':[-500,-400,-323],
 'Rome':[-500,-323], 'Roman Republic':[-400,-300],
 'Achaemenid Empire':[-500,-400], 'Carthaginian Empire':[-500,-400,-323,-300],
 'Empire of Alexander':[-323], 'Bosporan Kingdom':[-323,-300],
 'Armenia':[-323,-300], 'Atropatene':[-323,-300], 'Cappadocia':[-323,-300],
 'Colchis':[-323,-300], 'Hadramaut':[-323,-300], 'Qataban':[-323,-300],
 'Qin':[-323,-300], 'Kingdom of Kassander':[-300], 'Kingdom of Lysimachus':[-300],
 'Mauryan Empire':[-300], 'Nabatean Kingdom':[-300], 'Ptolemaic Kingdom':[-300],
 'Seleucid Kingdom':[-300],
}
# These terms identify archaeological traditions, not a single political owner.
CULTURAL={'Cycladic','Minoan','Jōmon','Afanasevo','Andronovo','Beaker','Sintashta','Únětice','Namazga','Valdivia','Olmec','Chavin','Paracas','Yayoi'}
# Interpretable geographic/archaeological frames and plural population terms are
# admitted as contextual source reconstruction only; no polity is invented.
CONTEXT={'Elam','Ur','Kerma','Norte Chico','Oxus','Canaan','Meroe','Monte Albán','Teotihuacan','Wankarani','El Paraiso','Chorrera','Chinchoros','Simhala','Crete','Bithynia','Austronesians','Arameans','Berbers','Burmese','Celtiberians','Cimerians','Dravidians','Illyrians','Iranian pastoralists','Paleo-Koreans','Phrygians','Proto-Altaic pastoralists','Thrace','Tibetans','Vedic Aryans','Semites','Bantu','Koreans','Thai','Tibeto-Burmanese','Aboriginal Tasmanians','Celts','Boii','Curonians','Etrurians','Paleo-Inuit','Samnites','Scythians','Sabines','Sabini','Blemmyes'}
REVIEW={'Kingdom of David and Solomon':'The source repeats this contested composite kingdom at 1500,1000 and700BCE. Neither singular title wording nor the source file resolves chronology, unity or borders; withheld as an archaeological/historical interpretation question.',
 'Zhangzhung Kingdom':'The source supplies an early kingdom label, but this bounded review has no adequate dated documentary or archaeological mapping to justify these particular earlier observations; keep in review.',
 'Xia':'Dynastic/archaeological identification and territorial reconstruction require explicit scholarly mapping; a source name does not establish one political authority.',
 'Zhoa':'Unresolved source spelling/identity; do not silently convert it into Zhou or another dynasty.',
 'Xiongnu':'Earlier source population/territorial identity before the admitted200BCE polity observation is unresolved; do not carry the later exact mapping backward.',
 'Damot':'Unresolved early-date source polity identity; retained in review rather than back-projecting a later similarly named entity.'}

rows=[]
for label,years in sorted(observed.items()):
    decision='review-queue';why='Earlier individual source label lacks a resolved political/cultural interpretation in this bounded amendment; retained in the exceptions worklist.'
    if module.CULTURE.search(label) or label in CULTURAL:
        decision='cultural-presence';why='Earlier archaeological/cultural distribution, separately displayed as cultural presence. This classification cannot establish political ownership, a single government or exact temporal borders.'
    elif module.COLLECTIVE.search(label) or label in CONTEXT:
        decision='source-context';why='Earlier source aggregate, population, geographic or archaeological context only; no single political authority, numeric population or named settlement at the clicked point is inferred.'
    if label in REVIEW: decision='review-queue';why=REVIEW[label]
    row={'mapping_id':'earlier-dated-label:'+hashlib.sha256(label.encode()).hexdigest()[:20], 'label':label,'observed_years':sorted(years),'decision':decision,'rationale':why,'basis':'explicit-optional-earlier-v4-semantic-review','independently_historically_verified':False}
    changes={}
    for year in years:
        if year in POLITICAL.get(label,[]):
            changes[str(year)]={'decision':'political-association','rationale':'Explicitly reviewed earlier source-labelled institutional association at this nominal observation. The original name is retained; it does not assert sovereignty, effective control, unbroken identity, government structure or independently verified borders.'}
        if label=='Hittites' and year in (-2000,-1000,-700):
            changes[str(year)]={'decision':'source-context','rationale':'Hittite-labelled source regional/cultural context at this date; not extended into a single Hittite Empire beyond its dated institutional mapping.'}
        if label=='Kush' and year in (-1500,-1000):
            changes[str(year)]={'decision':'source-context','rationale':'Kush/Nubian source regional context at this early observation; a separate kingdom or sovereignty is not inferred from the region name.'}
        if label=='Urartu' and year in (-1500,-1000):
            changes[str(year)]={'decision':'quarantined','rationale':'Source labels Urartu substantially earlier than the ninth-to-sixth-centuryBCE kingdom identified by the Library of Congress overview; chronological anomaly retained, with no replacement geometry.'}
        if label=='La Tène culture' and year==-700:
            changes[str(year)]={'decision':'quarantined','rationale':'Source places La Tène at700BCE, earlier than the British Museum classification beginning around450BCE; chronology concern withheld without substituting a different culture.'}
        if label=='Kingdom of Antigonus' and year==-300:
            changes[str(year)]={'decision':'quarantined','rationale':'Source chronology requires review around the301BCE death of Antigonus I and division after Ipsus; no assumed successor is substituted for the300BCE label.'}
    if changes: row['date_decisions']=changes
    rows.append(row)
doc={'schema_version':1,'rules_version':'global-basemap-earlier-semantics-v4','scope':'Optional9 earlier observations explicitly enabled only after primary40 integration gate; prior pilot scope remains unchanged in retained records.','source_revision':module.REVISION,'meaning':'Reviewed semantic applicability only; zero independently verified historical borders. Exact observed-year decisions do not become continuous historical validity.','primary_registry_sha256':hashlib.sha256((ROOT/'mappings/reusable-labels.json').read_bytes()).hexdigest(),'mappings':rows}
path=ROOT/'mappings/earlier-dated-mappings.json';path.write_text(module.compact(doc)+'\n')
print(json.dumps({'labels':len(rows),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}))

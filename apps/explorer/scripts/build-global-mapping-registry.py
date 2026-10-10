#!/usr/bin/env python3
"""Materialize a bounded exact-label mapping registry from explicit decisions.

Date membership is taken from the pinned input inventory. It is not a continuous
validity claim. Generic lexical rules are in classify-global-sources.py.
"""
import ast
import hashlib
import json
from pathlib import Path
APP = Path(__file__).resolve().parents[1]
OUT = APP / 'public/global-history/mappings/reusable-labels.json'
SOURCE = APP / 'public/global-history/source'
legacy = APP / 'public/integrated/source/classify_sources.py'
tree = ast.parse(legacy.read_text())
names = set()
for node in tree.body:
    if isinstance(node, ast.Assign) and any(isinstance(x, ast.Name) and x.id == 'ALLOW' for x in node.targets):
        names.update(node.value.args[0].func.value.value.split('|'))
    if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Attribute) and isinstance(node.value.func.value, ast.Name) and node.value.func.value.id == 'ALLOW' and node.value.func.attr == 'update':
        names.update(ast.literal_eval(node.value.args[0]))

# Clear political/administrative labels inspected in the complete pinned inputs.
# Association does not mean sovereignty: colonies, mandates and occupied zones
# remain independent source-labelled assertions, without inferred relationships.
ADDITIONAL = '''Albania|Andorra|Australia|Austria|Azerbaijan|Bangladesh|Bosnia and Herzegovina|Botswana|Brazil|Burkina Faso|Byelarus|Cameroon|Central African Republic|Chad|China|Chile|Cuba|Czech Republic|Czechoslovakia|Djibouti|East Germany|Equatorial Guinea|Eritrea|Estonia|Finland|Gambia|Gambia, The|Ghana|Guinea|Guinea-Bissau|Guyana|Indonesia|Iran|Iraq|Ireland|Israel|Jamaica|Jordan|Kazakhstan|Kenya|Korea, Democratic People's Republic of|Korea, Republic of|Kuwait|Kyrgyzstan|Latvia|Lebanon|Lesotho|Libya|Liechtenstein|Macedonia|Malawi|Malaysia|Mauritania|Mongolia|Namibia|New Zealand|Niger|Nigeria|Pakistan|Panama|Puerto Rico|Russia|Saudi Arabia|Slovakia|Slovenia|South Africa|Sri Lanka|Sudan|Suriname|Syria|Tajikistan|Tanzania, United Republic of|Thailand|Togo|Turkey|Turkmenistan|Uganda|Ukraine|United Arab Emirates|Uzbekistan|Vietnam|Yugoslavia|Zaire|Zambia|Zimbabwe|United States|United States of America|USSR|West Germany|Angola|Antigua and Barbuda|Anguilla|Dominica|Fiji|Gabon|Guadeloupe|Iceland|Ivory Coast|Malta|Montserrat|Netherlands Antilles|Netherlands Indies|Niue|Saint Kitts and Nevis|Saint Martin|Saint Barthelemy|Samoa|Sierra Leone|Spanish Guinea|Portuguese Guinea|Portuguese East Africa|Wallis and Futuna Islands|Prussia|Tokugawa shogunate|Tsardom of Muscovy|Dutch East Indies|Genoa|Lucca|Modena|Naples|Parma|Sardinia-Piedmont|Tuscany|Gwalior|Hyderabad|Mysore|Travancore|Cochin|Kandy|Lan Na|New France|British American colonies|Portuguese Brazil|Dutch Republic|Netherlands Indies|French Indo-China|French Indochina|French Equatorial Africa|French West Africa|French Cameroons|French Somaliland|British Somaliland|Italian Somaliland|British East Africa|German E. Africa (Tanganyika)|German South-West Africa|Belgian Congo|Anglo-Egyptian Sudan|Algeria (France)|Congo (France)|Eritrea (Italy)|Ethiopia (Italy)|Germany (France)|Germany (Soviet)|Germany (UK)|Germany (USA)|Guinea-Bissau (Portugal)|Japan (USA)|Korea (USA)|Korea (USSR)|Libya (IT)|Madagascar (France)|Martinique (France)|Mesopotamia (GB)|Morocco (France)|Mozambique (Portugal)|Rwanda (Belgium)|Syria (France)|Yemen (UK)|Mandatory Palestine (GB)|Northern Rhodesia|Southern Rhodesia|Nyasaland|Togoland|Gold Coast|Kamerun|South Australia (UK)|Western Australia (UK)|Victoria (UK)|Queensland (UK)|New South Wales (UK)|Northern Territory (UK)'''.split('|')
# Conservative observed-date scopes for exact names that can mean a different
# thing in ancient or early-modern inputs. Earlier unresolved labels stay review.
MODERN_ONLY = set(ADDITIONAL[:ADDITIONAL.index('Angola')]) - {'United States', 'United States of America'}
CONTEXT = set('''Arabia|Africa|India|Malaya|Papua New Guinea|Greenland|Madagascar|Manchuria|Xinjiang|Antarctica|Western Sahara|South Russia|White Russia|Chinese Warlords|Chinese warlords|Post-Ming Warlords|Macedon and Hellenic League|Ato trading confederacy'''.split('|'))
MODERN_ADMIN = set('''American Samoa|Bahamas|Barbados|Belize|Grenada|Hong Kong|Martinique|Mozambique|Philippines|Saint Lucia|Saint Vincent and the Grenadines|Senegal|Somalia|Taiwan|Trinidad|Turkish Cypriot-administered area|Turks and Caicos Islands|Dominion of Newfoundland|Union of South Africa|East Prussia|Muscat and Oman|Spanish Morocco|Spanish Sahara|Algeria (France)|Angola (Portugal)|Guam|New Caledonia|New Hebrides|Gilbert and Ellice Islands|Jamaica (UK)'''.split('|'))
ADDITIONAL.extend(sorted(MODERN_ADMIN))
MODERN_ONLY.update(MODERN_ADMIN)
# Specific alias continuity declared only for these bounded series. Other exact
# names get reusable classification but observation-scoped provisional identity.
SERIES = {
 'United States':'united-states-1776-series', 'United States of America':'united-states-1776-series',
 'USSR':'soviet-union-1922-1991-series', 'East Germany':'east-germany-1949-1990-series',
 'West Germany':'west-germany-1949-1990-series',
}
observed = {}
for entry in json.loads((SOURCE/'target-snapshots.json').read_text())['snapshots']:
    # The optional pre-200BCE amendment has a separately reviewed registry.
    # Never extend primary semantic decisions by discovering an older label.
    if entry.get('source_year', entry.get('year')) < -200: continue
    path = SOURCE/'input'/entry['filename']
    if not path.exists(): continue
    year = entry.get('source_year', entry.get('year'))
    for f in json.loads(path.read_text())['features']:
        label = str((f.get('properties') or {}).get('NAME') or '').strip()
        observed.setdefault(label,set()).add(year)
rows=[]
for label in sorted((names|set(ADDITIONAL)|CONTEXT)&set(observed)):
    years=sorted(y for y in observed[label] if label not in MODERN_ONLY or y>=1914)
    if not years: continue
    decision='source-context' if label in CONTEXT else 'political-association'
    rationale = ('Exact source label denotes a geographic, composite or contested regional frame in this registry. It is shown as source context only; no single political authority, sovereignty, settlement identity or population total is inferred.' if decision=='source-context' else 'Date-scoped exact semantic mapping of this source label as a political or administrative association. It is not a claim of independent sovereignty, effective control, governmental structure, boundary accuracy or continuous identity between observations.')
    row={'mapping_id':'dated-label:'+hashlib.sha256(label.encode()).hexdigest()[:20], 'label':label,'observed_years':years,'decision':decision,'rationale':rationale,'basis':'retained-v2-explicit-name-mapping' if label in names else 'explicit-global-v3-semantic-mapping','independently_historically_verified':False}
    if label in SERIES: row['identity_group']=SERIES[label]
    rows.append(row)
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps({'schema_version':1,'rules_version':'global-basemap-semantics-v3','source_revision':'da7a4b735ecef70aebdc9c73e409d8a2500d50f3','meaning':'Exact observed-year semantic decisions, not political certification or valid-time intervals. Quarantine/anomaly rules always take precedence. Unlisted labels are never admitted by registry default.','legacy_classifier_sha256':hashlib.sha256(legacy.read_bytes()).hexdigest(),'identity_policy':'Retained exact dated Isles crosswalks take precedence. Only four explicitly declared source-label series have cross-observation identity; all other names are observation-scoped provisional identities with stable source-label styling.','mappings':rows},ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n')
print(json.dumps({'mappings':len(rows),'path':str(OUT),'sha256':hashlib.sha256(OUT.read_bytes()).hexdigest()}))

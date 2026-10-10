import json,pathlib,re,hashlib,collections
ROOT=pathlib.Path(__file__).resolve().parent
# Exact NAME labels inspected in pinned index. These are labels for source-attributed
# political associations, never an assertion of sovereign title or modern nationhood.
ALLOW=set('''Abdelouadides|Aceh|Adal|Afghanistan|Ahmadnagar|Algeria|Algeria (FR)|Algiers|Alwa|Anhalt|Annam|Aragón|Arakan|Arakan (Indian princely state)|Argentina|Armenia|Asante|Asturias|Austria Hungary|Austrian Netherlands|Ava|Axum|Ayutthaya|Bactria|Baden|Bagan|Bagirmi|Bahawalpur|Balhae|Barotse|Basutoland|Bavaria|Belgium|Bengal|Benin|Berar|Bhutan|Bidar|Bijapur|Bolivia|Bosnia|Bosnia-Herzegovina|Brandenburg|Bremen|Britany|British East India Company|British Guiana|Brunei|Brunswick|Buganda|Bulgaria|Bunyoro|Burma|Burundi|Cambodia|Canada|Carthage|Castile|Castilla|Castille|Caucasian Albania|Ceylon|Ceylon (Dutch)|Champa|Chola|Chūzan|Colombia|Congo|Costa Rica|Croatia|Cyprus|Dacia|Dahomey|Dardania|Denmark|Denmark-Norway|Dutch Guiana|Dvaravati|East Francia|Ecuador|Egypt|El Salvador|England|English territory|Ethiopia|France|French Guiana|French Indochina|Funan|Funj|Futa Jalon|Futa Toro|Gaya|Georgia|Germany|Ghana|Golkonda|Goryeo|Granada|Great Moravia|Greece|Guatemala|Hadramaut|Haiti|Han|Han Zhao|Haripunjaya|Hejaz|Hokuzan|Honduras|Hungary|Ifat|Ilkhanate|Imperial Hungary|Imperial Japan|Imperial Japan (Fujiwara)|Italy|Japan|Jin|Judea|Kakheti-Hereti|Kalinga|Kalmar Union|Kamarupa|Kanauj|Kanem|Kanem-Bornu|Karkhanids|Kediri|Kent|Kievan Rus|Koguryo|Kong|Korea|Kuba|Kyivan Rus|Lagos|Laos|Lavo|León|Liao|Liberia|Lithuania|Luba|Lunda|Luxembourg|Maan|Magadha|Makkura|Malacca|Mali|Maskat|Mascat|Mataram|Meroe|Merinides|Mexico|Moldova|Montenegro|Morocco|Multan|Muscat|Mwenemutapa|Nan Chao|Nan-Yue|Nan-Zhao|Nanzan|Natal|Navarre|Ndongo|Nepal|Netherlands|Neustria|Nicaragua|Nobatia|Northern Liang|Northumbria|Norway|Novgorod|Novgorod-Seversky|Numidia|Oman|Opobo|Orange Free State|Orissa|Oyo|Paekche|Pagan|Papal States|Paraguay|Parthia|Pegu|Pergamon|Persia|Peru|Poland|Poland-Lithuania|Portugal|Pskov|Qataban|Qatar|Rashtrakuta|Raška|Romania|Rome|Rome (Constantinus)|Rome (Diocletianus)|Rome (Galerius)|Rome (Maximian)|Rwanda|Ryazan|Saba|Saffarids|Sardinia|Scotland|Serbia|Shirvan|Shoa|Shogun Japan (Kamakura)|Sicily|Silla|Simhala|Sindh|Songhai|Spain|Sukhothai|Swaziland|Sweden|Sweden–Norway|Switzerland|Syunik|Takrur|Tashir|Teutonic Knights|Tibet|Toba Wei|Tonga|Transvaal|Trebizond|Trucial Oman|Tunisia|United States of America|Uruguay|Vakataka|Vallabhi|Vasconia|Vengi|Venice|Venezuela|Vijayanagara|Vishnu-Kundins|Wessex|West Francia|Western Chalukyas|Western Gangas|Xixia|Yamato|Yemen|Đại Việt'''.split('|'))
ALLOW.update({'Mauretania','Min-Yue','Xiongnu','Southern Xiongnu','Yueban'})
TITLE=re.compile(r'\b(empire|kingdom|republic|sultanate|caliphate|emirate|khanate|khaganate|duchy|principality|confederation|commonwealth|colony|bishopric|archbishopric|county|electorate|protectorate|beylik|raj|horde)\b',re.I)
CULTURE=re.compile(r'\b(culture|cultures|civilization|complex)\b',re.I)
COLLECTIVE=re.compile(r'\b(kingdoms|states|chiefdoms|principalities|khanates|tribes|peoples|farmers|hunters|hunter|gatherers|gatherer|foraging|pastoral|nomads|nomadic|city-states)\b',re.I)
# Suspected anomalies are withheld for review. These bounds are conservative triage,
# not alternate event facts and do not produce replacement temporal assertions.
SUSPECT={
 'Mauretania':lambda y:y>=44,'Min-Yue':lambda y:y>-110,
 'Xiongnu':lambda y:y>50,'Southern Xiongnu':lambda y:y<48 or y>216,
 'Yueban':lambda y:y<160 or y>490,
 'Mauryan Empire':lambda y:y>-185,'Kushan Empire':lambda y:y<1,
 'Parthian Empire':lambda y:y>224,'Western Roman Empire':lambda y:y>480,
 'Sasanian Empire':lambda y:y>651,'Sasanian dependencies':lambda y:y>651,
 'Sui Empire':lambda y:y>618,'Liao':lambda y:y>1125,
 'Fatimid Caliphate':lambda y:y>1171,'Shogun Japan (Kamakura)':lambda y:y>1333,
 'Kingdom of Brazil':lambda y:y>=1889,'Kingdom of Hawaii':lambda y:y>=1893,
 'Kō Hawaiʻi Paeʻāina (Hawaiian Kingdom)':lambda y:y>=1893,
 'Austrian Empire':lambda y:y<1804,'Jin Empire':lambda y:y==500,
 'Tuʻi Tonga Empire':lambda y:y<900,'Han Zhao':lambda y:y<304,
 'Gupta Empire':lambda y:y<319,'Empire of Ghana':lambda y:y<500,
 'Kingdom of Sukhotai':lambda y:y<1200,'Mongol Empire':lambda y:y<1206,
 'Srivijaya Empire':lambda y:y>=1400,'Great Khanate':lambda y:y>=1400,
 'Chola Empire':lambda y:y>=1300,'Cholas':lambda y:y>=1300,
 'Poverty point culture':lambda y:y>0,'Hopewell Culture':lambda y:y>500,
 'Suren Kingdom':lambda y:y>400,'Satavahanihara':lambda y:y>300,
 'Koguryo':lambda y:y>668,'Paekche':lambda y:y>660,
 'Nabatean Kingdom':lambda y:y>106,'Merina Kingdom':lambda y:y<1500,
 'Kingdom of France':lambda y:y>=1792,
}
CONTESTED={'Huari Empire','Tiahuanaco Empire','Toltec Empire','Mixtec Empire','Zapotec Empire'}
def classify(label,year,props):
 n=str(label or '').strip()
 if not n or n=='?':return 'excluded','empty-or-unknown','Unidentified source feature; no political or cultural assertion.'
 if n in SUSPECT and SUSPECT[n](year):return 'review-queue','suspected-source-date-inconsistency','Source label at this nominal year raises chronology concerns; retained unchanged for review, not converted to a historical claim.'
 if n in CONTESTED:return 'review-queue','archaeological-polity-interpretation','Archaeological or collective regional label uses imperial wording; political organization requires explicit scholarly mapping review.'
 if CULTURE.search(n):return 'cultural-presence','explicit-cultural-label','Source explicitly describes a cultural/archaeological distribution. Independent cultural layer only; no ownership, control, or polity relation.'
 if COLLECTIVE.search(n):return 'review-queue','collective-or-population-label','Collective, population, subsistence or multi-polity label cannot identify one political authority; retain for classification review.'
 if TITLE.search(n):return 'political-association','explicit-political-institution','Explicitly named singular political institution. Source-attributed territorial association only, uncertain snapshot; no de jure or effective-control inference.'
 if n in ALLOW:return 'political-association','explicit-name-mapping','Exact source name assigned by this explicit semantic mapping as a named historical political unit for this source-only association layer; sovereignty, control and duration remain unasserted.'
 return 'review-queue','unresolved-label-semantics','Country/NAME index entry alone does not establish a polity. Retain source fields and geometry for mapping review; no ownership inference.'
rows=[];stats={};files=[]
idx=json.loads((ROOT/'candidate-index.json').read_text())['snapshots']
for s in idx:
 p=ROOT/'input'/s['filename']
 if not p.exists():continue
 b=p.read_bytes();j=json.loads(b);counts=collections.Counter();file_sha=hashlib.sha256(b).hexdigest()
 for i,f in enumerate(j['features']):
  props=f.get('properties') or {};decision,rule,why=classify(props.get('NAME'),s['year'],props);counts[decision]+=1
  row={'filename':s['filename'],'feature_index':i,'source_year':s['year'],'astronomical_year':s['year']+1 if s['year']<0 else s['year'],'original_properties':props,'decision':decision,'rule':rule,'rationale':why,'political_semantics':'source-attributed territorial association; not sovereignty or effective control' if decision=='political-association' else None,'source_geometry_type':f.get('geometry',{}).get('type') if f.get('geometry') else None,'source_file_sha256':file_sha,'source_feature_id':f.get('id'),'independently_historically_verified':False}
  if props.get('SUBJECTO') and props.get('SUBJECTO')!=props.get('NAME'):row['relationship_note']='SUBJECTO differs from NAME; raw field retained, no automatic colonial/suzerain relationship created.'
  if props.get('PARTOF') and props.get('PARTOF')!=props.get('NAME'):row['cultural_group_note']='PARTOF retained as source metadata, not an imperial/suzerain mapping.'
  rows.append(row)
 stats[s['filename']]=dict(counts)
 (ROOT/(s['filename'].replace('.geojson','')+'-mappings.json')).write_text(json.dumps({'source':s['filename'],'source_sha256':file_sha,'rules_version':'basemap-classification-v2','mappings':rows[-len(j['features']):]},ensure_ascii=False,indent=2))
 allcounts=collections.Counter(r['decision'] for r in rows)
 if allcounts['political-association']+allcounts['cultural-presence']>10000:raise RuntimeError('STOP selected executable feature cap')
out={'version':2,'revision':'da7a4b735ecef70aebdc9c73e409d8a2500d50f3','budget_sha256':'4f3f49020d87affad22d402535d8a3ff0e319396db959c32137567ebf1bc58e6','status':'Source classification asset; no rasterization or ledger mutation','counts':dict(collections.Counter(r['decision'] for r in rows)),'per_file':stats,'rules':{'year_conversion':'Historical negative n BCE maps to astronomical n+1; source index is not astronomical. No display year zero.','temporal':'Nominal snapshot year with source uncertainty; no extrapolation before/after that sampled year and no invented event day.','rights':'GPL-3.0 as declared at exact pinned revision; preserve source license, README attribution and work-in-progress limitations. No independent rights audit or scholarly verification is implied.','no_automatic_relations':'SUBJECTO and PARTOF retained raw. Neither is a universal sovereignty or suzerainty mapping.'},'mappings':rows}
(ROOT/'feature-mappings.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
print(json.dumps({'files':len(stats),'counts':out['counts'],'per_file':stats},indent=2))

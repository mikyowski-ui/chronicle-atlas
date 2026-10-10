#!/usr/bin/env python3
"""Compile dated city evidence. No population interpolation or lifecycle inference.

Inputs are immutable copies of the Reba 2016 CSV mirror and official UN WUP2025
File 21. Negative historical years are converted to astronomical numbering.
Only observed/estimated years <=2025 are imported; future projections excluded.
"""
import csv, json, hashlib, math, re, unicodedata, collections, argparse
from pathlib import Path
import openpyxl

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_SOURCE = SCRIPT_DIR.parent / 'public/history/source' if SCRIPT_DIR.name == 'scripts' else SCRIPT_DIR
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-dir', type=Path, default=DEFAULT_SOURCE)
parser.add_argument('--output-dir', type=Path, default=None)
args = parser.parse_args()
ROOT = args.source_dir.resolve()
OUTPUT = (args.output_dir or (SCRIPT_DIR.parent / 'public/history' if SCRIPT_DIR.name == 'scripts' else ROOT)).resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)
SOURCES = [
 {'id':'reba-2016','title':'Reba, Reitsma & Seto (2016), Spatializing 6,000 years of global urbanization','url':'https://doi.org/10.1038/sdata.2016.34','license':'CC BY 4.0','note':'Chandler and Modelski historical population estimates; sparse and non-exhaustive coverage. Geographic reliability is not population confidence. Mirror of authors’ combined CSV.'},
 {'id':'reba-chandler','title':'Chandler Population Data, digitized by Meredith Reba','url':'https://doi.org/10.6084/m9.figshare.2059494','license':'CC BY 4.0'},
 {'id':'reba-modelski-ancient','title':'Modelski Ancient Cities, digitized by Meredith Reba','url':'https://doi.org/10.6084/m9.figshare.2059497','license':'CC BY 4.0'},
 {'id':'reba-modelski-modern','title':'Modelski Modern Period Data, digitized by Meredith Reba','url':'https://doi.org/10.6084/m9.figshare.2059500','license':'CC BY 4.0','note':'Mainland Chinese values are from the 1990 census; their AD_2000 table heading is corrected to 1990 during this import, as specified in the associated paper.'},
 {'id':'un-wup-2025','title':'United Nations, World Urbanization Prospects 2025, File 21','url':'https://population.un.org/wup/assets/Download/Cities/WUP2025-F21-DEGURBA-Cities_Pop.xlsx','license':'CC BY 3.0 IGO','note':'Annual estimates for DEGURBA urban centres through 2025; population-weighted reference centroids. This is a different spatial definition from the historical compilation. Present-day capital field is deliberately not backdated.'},
 {'id':'london-archaeology','title':'English Heritage: History of London Wall','url':'https://www.english-heritage.org.uk/visit/places/london-wall/history/'},
 {'id':'istanbul-names','title':'Istanbul Metropolitan Municipality: İstanbul’un İsim Serüveni','url':'https://istanbulseninhaber.ibb.istanbul/haber-detay/istanbulun-isim-seruveni'},
 {'id':'istanbul-330','title':'Turkish Ministry of Culture: Hıristiyanlığın Kutsal Kenti','url':'https://ekitap.ktb.gov.tr/TR-80054/hiristiyanligin-kutsal-kenti.html'},
 {'id':'mexico-unesco','title':'UNESCO: Historic Centre of Mexico City and Xochimilco','url':'https://whc.unesco.org/en/list/412/'},
 {'id':'tokyo-names','title':'Tokyo Museum Collection: The Procession of the Emperor Going to Tokyo','url':'https://museumcollection.tokyo/en/works/6244159/'},
 {'id':'beijing-jin','title':'Beijing Government: Jin Zhongdu archaeological exhibition','url':'https://english.beijing.gov.cn/latest/activities/202608/t20260804_4807709.html'},
 {'id':'beijing-ming','title':'Beijing Tourism: The Status of Beijing in Ming Dynasty','url':'https://english.visitbeijing.com.cn/article/47OMiM6dfPl'},
 {'id':'beijing-yuan','title':'Beijing Government: Scenic Spots along the Central Axis','url':'https://english.beijing.gov.cn/travellinginbeijing/citytours/202006/t20200608_1918916.html'},
 {'id':'beijing-names','title':'Beijing Tourism: The Names of Beijing','url':'https://english.visitbeijing.com.cn/article/47OMhkXlgaL'},
 {'id':'patna-names','title':'Archaeological Survey of India: Patna history','url':'https://www.asipatnacircle.gov.in/about-districts'},
 {'id':'teotihuacan-unesco','title':'UNESCO: Pre-Hispanic City of Teotihuacan','url':'https://whc.unesco.org/en/list/414/'},
 {'id':'tikal-smithsonian','title':'Smithsonian National Museum of the American Indian: Tikal','url':'https://maya.nmai.si.edu/gallery/tikal'},
 {'id':'tiwanaku-unesco','title':'UNESCO: Tiwanaku','url':'https://whc.unesco.org/en/list/567/'},
 {'id':'tula-inah','title':'INAH: Zona Arqueológica y Museo de sitio de Tula','url':'https://www.inah.gob.mx/zonas/zona-arqueologica-y-museo-de-sitio-de-tula'},
 {'id':'caracol-project','title':'Caracol Archaeological Project: Field Guide','url':'https://caracol.org/students/field-guide/'},
 {'id':'memphis-unesco','title':'UNESCO: Memphis and its Necropolis','url':'https://whc.unesco.org/en/list/86/'},
 {'id':'mumbai-names','title':'Mumbai City Government: History','url':'https://mumbaicity.gov.in/en/history/'},
 {'id':'kolkata-names','title':'Kolkata Municipal Corporation: About Kolkata','url':'https://www.kmcgov.in/KMCPortal/jsp/KMCAboutKolkataHome.jsp'},
 {'id':'chennai-names','title':'Tamil Nadu Government: Chennai District Statistical Handbook','url':'https://www.amrut.mohua.gov.in/uploads/basic_deatils_document/Statstical_Hand_Book_Chennai.pdf'},
 {'id':'saigon-names','title':'Ho Chi Minh City Department of Culture: July 1976 renaming','url':'https://svhtt.hochiminhcity.gov.vn/tin-chi-tiet/-/chi-tiet/chuong-trinh-nghe-thuat-ky-niem-46-nam-ngay-thanh-pho-sai-gon-gia-%C4%91inh-chinh-thuc-vinh-du-mang-ten-chu-tich-ho-chi-minh-02-7-1976-02-7-2022--23802-1.html'},
]

def norm(s):
 return re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',s.translate(str.maketrans({'Đ':'D','đ':'d','Ł':'L','ł':'l'}))).encode('ascii','ignore').decode().casefold())

def distance(a,b):
 la,lo=map(math.radians,a); lb,lob=map(math.radians,b)
 return 6371*2*math.asin(min(1,math.sqrt(math.sin((lb-la)/2)**2+math.cos(la)*math.cos(lb)*math.sin((lob-lo)/2)**2)))

def astro(y): return y+1 if y<0 else y

def index_wide(path, sid):
 result=set()
 for r in csv.DictReader(path.open()):
  for k,v in r.items():
   if v and re.fullmatch('(BC|AD)_\\d+',k):
    y=int(k.split('_')[1])*(-1 if k.startswith('BC') else 1)
    try: result.add((r['City'].strip(),r['Country'].strip(),y,int(float(v))))
    except ValueError: pass
 return result

ancient=index_wide(ROOT/'modelskiAncient.csv','reba-modelski-ancient')
modern=index_wide(ROOT/'modelskiModern.csv','reba-modelski-modern')
cities=[]; byname=collections.defaultdict(list); quarantine=[]; merges=[]
rawrows=list(csv.DictReader((ROOT/'alldata.csv').open()))
for r in rawrows:
 name=r['City'].strip(); country=r['Country'].strip(); year=int(r['year']); value=int(float(r['pop']))
 key=(name,country,year,value)
 sid='reba-modelski-modern' if key in modern else 'reba-modelski-ancient' if key in ancient else 'reba-chandler'
 original_name=name
 if name=='Pataliputra' and country=='India':name='Patna'
 anomaly=None
 if name=='Memphis' and country=='Egypt' and year>1700:
  anomaly=('memphis-unesco','Modern large population assigned to Egyptian archaeological Memphis appears to be a homonym contamination. Held out; not reassigned to Tennessee without an original-source check.')
 elif name=='Caracol':
  anomaly=('caracol-project','Large Maya Caracol is in Belize; this record geocodes El Caracol at Chichen Itza in Mexico. Both identity/coordinate and BCE date assignments need review; no replacement invented.')
 elif (name=='Teotihuacan' and year<=-600) or (name in ('Tikal','Tiahuanaco','Tollan') and year<0):
  sid_review={'Teotihuacan':'teotihuacan-unesco','Tikal':'tikal-smithsonian','Tiahuanaco':'tiwanaku-unesco','Tollan':'tula-inah'}[name]
  anomaly=(sid_review,'BCE value duplicates an existing CE observation exactly 1,300 years later and conflicts with the documented major urban period. Suspected era-column error; CE original remains, BCE row held for review, not silently redated.')
 elif name=='Gelibolu' and year in (1000,1200):
  anomaly=('reba-2016','Uncorroborated medieval outlier (150,000–300,000) followed by much smaller early-modern estimates. Held out pending original-source review; exclusion is not a corrected population claim.')
 if anomaly:
  quarantine.append({'row':r,'reason':anomaly[1],'sourceId':anomaly[0]});continue
 if name=='London' and country=='United Kingdom' and year<43:
  quarantine.append({'row':r,'reason':'Londinium dates to c. AD 50; BC_100 record is inconsistent with archaeological chronology. No replacement date invented.','sourceId':'london-archaeology'})
  continue
 if year==2000 and country=='China' and sid=='reba-modelski-modern': year=1990
 year=astro(year)
 lat=float(r['Latitude']);lon=float(r['Longitude'])
 if not (-90<=lat<=90 and -180<=lon<=180 and value>0):
  quarantine.append({'row':r,'reason':'Invalid coordinate or nonpositive population'});continue
 names=[name]+[x.strip() for x in r['OtherName'].split(',') if x.strip()]
 matches=list({c['id']:c for n in names for c in byname[norm(n)] if distance((lat,lon),(c['lat'],c['lon']))<10}.values())
 if matches:c=matches[0]
 else:
  cid='hist-'+norm(name)+'-'+hashlib.sha256(f'{name}|{country}|{lat:.2f}|{lon:.2f}'.encode()).hexdigest()[:8]
  c={'id':cid,'name':name,'lat':lat,'lon':lon,'nameStatus':'modern-reference','referenceCountry':country,'population':[],'sourceIds':['reba-2016'],'geographicReliability':int(r['Certainty']),'aliases':[], '_rows':[]}
  cities.append(c)
 for n in names:
  if c not in byname[norm(n)]:byname[norm(n)].append(c)
 c['geographicReliability']=max(c['geographicReliability'],int(r['Certainty']))
 for alias in r['OtherName'].split(','):
  if alias.strip() and alias.strip()!=name and alias.strip() not in c['aliases']: c['aliases'].append(alias.strip())
 if sid not in c['sourceIds']:c['sourceIds'].append(sid)
 if original_name=='Pataliputra':
  if original_name not in c['aliases']:c['aliases'].append(original_name)
  if 'patna-names' not in c['sourceIds']:c['sourceIds'].append('patna-names')
 c.setdefault('referenceCountries',[])
 if country not in c['referenceCountries']:c['referenceCountries'].append(country)
 c['_rows'].append({'year':year,'value':value,'sourceId':sid})

# Conservative identity alignment: name or recorded alias AND nearby reference point.
# No match is based solely on proximity. Ambiguous candidates are kept separate.
historical_count=len(cities)
alias_index=collections.defaultdict(list)
for c in cities:
 for n in [c['name']]+c['aliases']: alias_index[norm(n)].append(c)
w=openpyxl.load_workbook(ROOT/'WUP2025-F21-DEGURBA-Cities_Pop.xlsx',read_only=True,data_only=True)
it=w['Data'].iter_rows(values_only=True);headers=next(it)
yearcols=[(i,int(v)) for i,v in enumerate(headers) if str(v).isdigit() and 1975<=int(v)<=2025]
uncount=0;future_excluded=0;unpoints=0;unselected=0
for row in it:
 obs=[{'year':y,'value':round(row[i]*1000),'sourceId':'un-wup-2025'} for i,y in yearcols if isinstance(row[i],(float,int)) and row[i]>0]
 if not obs:future_excluded+=1;continue
 uncount+=1;unpoints+=len(obs)
 first,last=obs[0]['year'],obs[-1]['year']
 obs=[p for p in obs if p['year']%5==0 or p['year'] in (first,last)]
 unselected+=len(obs)
 name=str(row[7]);lat=float(row[10]);lon=float(row[9])
 options=[name]+re.findall(r'\(([^)]+)\)',name)
 # Strip the parenthesized alternate when matching the primary official name.
 options.append(re.sub(r'\s*\([^)]*\)','',name))
 if name=='New York City': options.append('New York')
 if name=='Ho Chi Minh City':options.append('Ho Chi Minh')
 if name=='New Delhi':options.append('Delhi')
 if name=='Chennai':options.append('Madras')
 candidates={c['id']:c for n in options for c in alias_index[norm(n)] if distance((lat,lon),(c['lat'],c['lon']))<=50}
 if len(candidates)==1:
  c=next(iter(candidates.values()));merges.append({'historicalId':c['id'],'historicalName':c['name'],'unCityCode':row[6],'unName':name,'distanceKm':round(distance((lat,lon),(c['lat'],c['lon'])),3)})
  c['sourceIds'].append('un-wup-2025')
  c['modernReferenceCoordinates']=[lon,lat]
 else:
  c={'id':'un-'+str(row[6]),'name':name,'lat':lat,'lon':lon,'nameStatus':'modern-reference','referenceCountry':row[1],'population':[],'sourceIds':['un-wup-2025'],'aliases':[], '_rows':[]}
  cities.append(c)
 c['unCityCode']=row[6]
 c['modernName']=name
 c['populationDefinition']='UN estimates from 1975 use DEGURBA urban centres; older estimates may describe a different settlement extent.'
 c['_rows'].extend(obs)

# Prefer the harmonized contemporary series where present; retain conflicts and
# definition differences. In the historical overlap Chandler is a display default,
# not a claim that Chandler is more accurate than Modelski.
priority={'un-wup-2025':0,'reba-chandler':1,'reba-modelski-ancient':2,'reba-modelski-modern':3}
conflicts=0
for c in cities:
 byyear=collections.defaultdict(list)
 for p in c.pop('_rows'):
  if p not in byyear[p['year']]:byyear[p['year']].append(p)
 for year,values in sorted(byyear.items()):
  values.sort(key=lambda p:(priority[p['sourceId']],p['value']))
  p=dict(values[0])
  if len(values)>1:
   p['alternativeValues']=[{'value':v['value'],'sourceId':v['sourceId']} for v in values[1:]]
   conflicts+=len({v['value'] for v in values})>1
  c['population'].append(p)
 c['firstObservationYear']=c['population'][0]['year']; c['lastObservationYear']=c['population'][-1]['year']
 c['sourceIds']=sorted(set(c['sourceIds']))
 c['existenceNote']='First and last population records are evidence limits, not founding or abandonment dates. A location marker does not establish continuous occupation. Country names are source reference labels, not historical sovereignty.'

def setnames(name,country,entries,note,sourceids):
 for c in cities:
  if c['name']==name and c['referenceCountry']==country:
   c['names']=[{'name':n,'from':f,**({'to':t} if t is not None else {}),'sourceId':sid} for n,f,t,sid in entries]
   c['nameStatus']='dated-names';c['existenceNote']=note+' '+c['existenceNote'];c['sourceIds']=sorted(set(c['sourceIds']+sourceids))

setnames('Istanbul','Turkey',[
 ('Byzantium',-99,330,'istanbul-330'),('Constantinople',330,1453,'istanbul-330'),('Kostantiniyye / Istanbul',1453,1923,'istanbul-names'),('Istanbul',1923,None,'istanbul-names')],
 'Display names select common period usages; several names coexisted, especially under Ottoman rule. Boundaries are editorial period labels, not assertions that a name changed universally in one year.', ['istanbul-names','istanbul-330'])
setnames('Mexico City','Mexico',[
 ('Tenochtitlan',1500,1521,'mexico-unesco'),('Mexico City',1521,None,'mexico-unesco')],
 'Mexico City was built over Tenochtitlan after the conquest. The shared reference point is not a claim that the city footprint or population definition remained unchanged.', ['mexico-unesco'])
setnames('Tokyo','Japan',[
 ('Edo',1600,1868,'tokyo-names'),('Tokyo',1868,None,'tokyo-names')],
 'Edo was renamed Tokyo in 1868. The marker uses the compiled geographic reference point, not an imperial residence.', ['tokyo-names'])
setnames('Beijing','China',[
 ('Yanjing (Beijing area)',900,1153,'beijing-jin'),('Zhongdu / Yanjing',1153,1272,'beijing-jin'),('Dadu',1272,1368,'beijing-yuan'),('Beiping',1368,1403,'beijing-ming'),('Beijing',1403,1928,'beijing-ming'),('Beiping / Beijing',1928,1949,'beijing-names'),('Beijing',1949,None,'beijing-names')],
 'Earlier capital sites occupied different parts of the present city. Combined labels cover periods of overlapping names; no exact historical city boundary is implied.', ['beijing-jin','beijing-yuan','beijing-ming','beijing-names'])
setnames('Patna','India',[
 ('Pataliputra (Patna area)',-429,1500,'patna-names'),('Patna',1500,None,'patna-names')],
 'Pataliputra and Patna records identify the same general city area and have been joined to avoid duplicate markers. The medieval/early-modern display boundary is approximate, not a single formal renaming date.', ['patna-names'])
setnames('Mumbai','India',[('Bombay',1661,1995,'mumbai-names'),('Mumbai',1995,None,'mumbai-names')], 'Dated names use the conventional English official-name transition; local names coexisted.', ['mumbai-names'])
setnames('Calcutta','India',[('Calcutta',1710,2001,'kolkata-names'),('Kolkata',2001,None,'kolkata-names')], 'Dated names follow the 2001 official English-name change; the Bengali name long predates it.', ['kolkata-names'])
setnames('Madras','India',[('Madras',1650,1996,'chennai-names'),('Chennai',1996,None,'chennai-names')], 'Dated names follow the 1996 official English-name change; local names long coexisted.', ['chennai-names'])
setnames('Ho Chi Minh','Vietnam',[('Saigon',1700,1976,'saigon-names'),('Ho Chi Minh City',1976,None,'saigon-names')], 'The official renaming of Saigon–Gia Dinh occurred in July 1976; this layer resolves the transition by year.', ['saigon-names'])
for c in cities:
 if c['name']=='Ao' and 'Zhengzhou' in c.get('aliases',[]):
  c['names']=[{'name':'Ao (Zhengzhou area)','from':c['firstObservationYear'],'to':1975,'sourceId':'reba-2016'},{'name':'Zhengzhou','from':1975,'sourceId':'reba-2016'}]
  c['nameStatus']='dated-names'
  c['existenceNote']='Shang Ao and modern Zhengzhou share a compiled reference area; the large chronological gap is not continuous settlement evidence. '+c['existenceNote']

for c in cities:
 if c['name']=='London' and c['referenceCountry']=='United Kingdom':
  # No fabricated foundation marker: earliest usable population evidence remains1199.
  c['existenceNote']='Londinium was founded around AD 50; the compilation’s BC_100 record was quarantined. '+c['existenceNote']
  c['sourceIds'].append('london-archaeology')

cities.sort(key=lambda c:c['id'])
stats={'historicalInputRows':len(rawrows),'historicalPlaces':historical_count,'unCitiesWithEstimatesThrough2025':uncount,'unAnnualEstimatesInSource':unpoints,'unCheckpointsImported':unselected,'futureOnlyRowsExcluded':future_excluded,'alignedCityIdentities':len(merges),'cityCount':len(cities),'selectedPopulationEstimates':sum(len(c['population']) for c in cities),'cityYearsWithAlternativeValues':conflicts,'quarantinedRows':len(quarantine),'earliestAstronomicalYear':min(c['firstObservationYear'] for c in cities),'latestYear':max(c['lastObservationYear'] for c in cities)}
payload={'version':1,'yearNumbering':'astronomical','sources':SOURCES,'cities':cities,'coverage':stats,'methodology':{'population':'Dated estimates only. No interpolation or extrapolation. Future UN projections excluded.','historicalCoverage':'Sparse and geographically uneven; prominence is among available estimates, not a proven complete global ranking.','geographicReliability':'Reba 1–3 scores concern geocoded identification, not accuracy of population estimates.','identityAlignment':'Exact normalized name/recorded alias plus reference points <=50 km; ambiguous candidates remain separate. Modern urban-centre definitions do not imply ancient territorial continuity.','capitalPolicy':'UN capital indicator is not imported as a historical capital assertion. Dated capitals are compiled separately.','timelineAppearance':'First available evidence is not a founding date; loss of recent evidence is not abandonment.'}}
payload['methodology']['modernSampling']='UN annual estimates are sampled at five-year checkpoints plus each city’s first and final available estimate through 2025. Raw annual workbook retained.'
for s in SOURCES:
 if s['id']=='un-wup-2025': s.update(minYear=1975,maxYear=2025,sampling='five-year checkpoints and first/final available year',definition='DEGURBA urban centre')
 elif s['id'].startswith('reba'): s.update(maxYear=2000,definition='Historical city/settlement extent varies by underlying estimate')
(OUTPUT/'cities.json').write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n')
(OUTPUT/'city-quarantine.json').write_text(json.dumps(quarantine,ensure_ascii=False,indent=2)+'\n')
(OUTPUT/'city-alignments.json').write_text(json.dumps(merges,ensure_ascii=False,indent=2)+'\n')
files=['alldata.csv','modelskiAncient.csv','modelskiModern.csv','WUP2025-F21-DEGURBA-Cities_Pop.xlsx']
manifest={'statistics':stats,'inputs':[{'file':n,'sha256':hashlib.sha256((ROOT/n).read_bytes()).hexdigest(),'bytes':(ROOT/n).stat().st_size} for n in files],'output':{'file':'cities.json','sha256':hashlib.sha256((OUTPUT/'cities.json').read_bytes()).hexdigest(),'bytes':(OUTPUT/'cities.json').stat().st_size},'mirror':'https://github.com/fasiha/Historical-Urban-Population-Growth-Data/tree/808ff2b4a279013f58621a3696cb9c28058c6af1','officialModernSource':SOURCES[4]['url']}
(OUTPUT/'city-build-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))

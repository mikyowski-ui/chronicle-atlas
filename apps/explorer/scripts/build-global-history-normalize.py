"""Bounded original-vector normalization; no coordinate simplification or buffering.
Run once per source observation. Originals stay untouched. GEOS make_valid is
used only for invalid topology; polygon surfaces and repair receipts are retained.
"""
import hashlib,json,sys,resource
from pathlib import Path
import shapely
from shapely.geometry import shape,mapping,Polygon,MultiPolygon
from shapely import make_valid
source_path,mapping_path,output_path=map(Path,sys.argv[1:])
source=json.loads(source_path.read_text()); decisions=json.loads(mapping_path.read_text())
allowed={'political-association','cultural-presence','source-context'}
sha=lambda value:hashlib.sha256(json.dumps(value,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
rows=[]; limit=85.05112878

def polygons(g):
 if g.geom_type=='Polygon': return [g]
 if g.geom_type in ('MultiPolygon','GeometryCollection'):
  return [p for child in g.geoms for p in polygons(child)]
 return []
for row in decisions['mappings']:
 if row['decision'] not in allowed: continue
 f=source['features'][row['feature_index']]; original=f.get('geometry'); receipt={'source_feature_index':row['feature_index'],'original_geometry_sha256_python':sha(original),'repair':'none','collapsed_nonpolygon_components':0,'polar_clamped_vertices':0,'discarded_display_altitude_vertices':0}
 try:
  geom=shape(original)
  if not geom.is_valid:
   receipt['original_validity']=shapely.is_valid_reason(geom)
   geom=make_valid(geom); receipt['repair']='shapely.make_valid; no simplification, snapping or buffering'
   receipt['repair_engine']='Shapely '+shapely.__version__+' / GEOS '+shapely.geos_version_string
   if geom.geom_type=='GeometryCollection':receipt['collapsed_nonpolygon_components']=sum(1 for g in geom.geoms if g.geom_type not in ('Polygon','MultiPolygon'))
  poly=polygons(geom)
  if not poly:raise ValueError('make_valid yielded no polygonal area')
  display=[]
  for part in poly:
   if part.is_empty:continue
   rings=[]
   for ring in mapping(part)['coordinates']:
    points=[]
    for point in ring:
     lon,lat=point[:2]
     receipt['discarded_display_altitude_vertices']+=int(len(point)>2)
     if not (-180<=lon<=180):raise ValueError('Longitude outside [-180,180]; explicit source review required')
     clamp=max(-limit,min(limit,lat))
     receipt['polar_clamped_vertices']+=int(clamp!=lat)
     points.append([lon,clamp])
    rings.append(points)
   # Coordinates remain full precision; the clamp is the Web Mercator display limit.
   display.append(rings)
  if not display:raise ValueError('No nonempty polygon after display projection restriction')
  receipt['display_geometry_sha256_python']=sha(display)
  receipt['polygon_parts']=len(display)
  receipt['original_bounds']=list(shape(original).bounds)
  rows.append({'feature_index':row['feature_index'],'polygons':display,'receipt':receipt})
 except Exception as error:
  rows.append({'feature_index':row['feature_index'],'error':str(error),'receipt':receipt})
Path(output_path).write_text(json.dumps({'schema_version':1,'rows':rows,'engine':{'shapely':shapely.__version__,'geos':shapely.geos_version_string},'peak_rss_bytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024},separators=(',',':'))+'\n')

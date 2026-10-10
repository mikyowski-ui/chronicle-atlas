"""Read the pinned Natural Earth Polygon shapefile without external GIS dependencies.
Iterate records; retain physical components intersecting the contextual window.
No historical assertion, coastline backdating, or geometry repair is performed.
"""
import hashlib, json, pathlib, struct, zipfile
app=pathlib.Path(__file__).resolve().parents[1]
out=app/'public/alpha'
source=out/'source/ne_50m_land.zip'
archive=zipfile.ZipFile(source)
version=archive.read('ne_50m_land.VERSION.txt').decode().strip()
assert version=='4.1.0',version
bounds=[-30,30,30,72]
def intersects(box): return box[2]>=bounds[0] and box[0]<=bounds[2] and box[3]>=bounds[1] and box[1]<=bounds[3]
def area(r):return sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(r,r[1:]))/2
features=[]; records=0
with archive.open('ne_50m_land.shp') as fh:
    header=fh.read(100); assert struct.unpack('>i',header[:4])[0]==9994
    while raw:=fh.read(8):
        num,length=struct.unpack('>ii',raw); data=fh.read(length*2); records+=1
        kind=struct.unpack_from('<i',data)[0]
        if kind==0:continue
        assert kind==5,kind
        box=struct.unpack_from('<4d',data,4)
        if not intersects(box):continue
        np,npts=struct.unpack_from('<2i',data,36)
        offsets=list(struct.unpack_from('<'+str(np)+'i',data,44))+[npts]
        coords=list(struct.iter_unpack('<2d',data[44+4*np:]))
        polygons=[]
        for start,end in zip(offsets,offsets[1:]):
            ring=[list(p) for p in coords[start:end]]
            # ESRI clockwise outer ring, counterclockwise interior. Shapefile
            # records order each outer immediately before its interior rings.
            if area(ring)<0:polygons.append([ring])
            else:
                assert polygons,'Orphan hole in source record'
                polygons[-1].append(ring)
        for i,poly in enumerate(polygons):
            xs=[p[0] for p in poly[0]];ys=[p[1] for p in poly[0]]
            if intersects([min(xs),min(ys),max(xs),max(ys)]):features.append({'type':'Feature','properties':{'render_id':f'natural-earth:4.1.0:{num}:{i}','source_edition':'Natural Earth 50m land 4.1.0','role':'physical-context'},'geometry':{'type':'Polygon','coordinates':poly}})
fc={'type':'FeatureCollection','features':features}
raw=(json.dumps(fc,separators=(',',':'))+'\n').encode()
assert len(raw)<=4194304
(out/'base-land.geojson.json').write_bytes(raw)
(out/'source/ne_50m_land.VERSION.txt').write_bytes(archive.read('ne_50m_land.VERSION.txt'))
(out/'source/ne_50m_land.README.html').write_bytes(archive.read('ne_50m_land.README.html'))
print(json.dumps({'source_records_scanned_sequentially':records,'retained_components':len(features),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'bounds':bounds,'source_version':version,'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest()}))

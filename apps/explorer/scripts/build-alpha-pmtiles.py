"""Bounded multi-zoom/multi-tile archive writer, official pmtiles 3.8.1."""
import gzip,json,os,pathlib,sys,tempfile
from pmtiles.tile import Compression,TileType,zxy_to_tileid
from pmtiles.writer import Writer
index_path,metadata_path,archive_path=map(pathlib.Path,sys.argv[1:])
metadata=json.loads(metadata_path.read_text());bounds=metadata['bounds_array']
index=json.loads(index_path.read_text())
tempfile.tempdir=str(index_path.parent)
header={'tile_type':TileType.MVT,'tile_compression':Compression.GZIP,
 'min_lon_e7':round(bounds[0]*1e7),'min_lat_e7':round(bounds[1]*1e7),
 'max_lon_e7':round(bounds[2]*1e7),'max_lat_e7':round(bounds[3]*1e7),
 'center_zoom':5,'center_lon_e7':round((bounds[0]+bounds[2])/2*1e7),
 'center_lat_e7':round((bounds[1]+bounds[3])/2*1e7)}
with archive_path.open('wb') as out:
    writer=Writer(out)
    for row in sorted(index,key=lambda r:zxy_to_tileid(*r['tile'])):
        raw=(index_path.parent/row['path']).read_bytes()
        writer.write_tile(zxy_to_tileid(*row['tile']),gzip.compress(raw,mtime=0))
    writer.finalize(header,metadata)

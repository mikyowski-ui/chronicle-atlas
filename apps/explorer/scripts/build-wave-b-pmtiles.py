"""Bounded single-tile PMTiles v3 writer; same pinned upstream writer as fixture."""
import json
import os
from pathlib import Path
import sys
import tempfile
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

app = Path(__file__).resolve().parents[1]
temp_path = Path(os.environ.get('TMPDIR', app / '.sites-runtime' / 'wave-b-build' / 'tmp'))
temp_path.mkdir(parents=True, exist_ok=True)
tempfile.tempdir = str(temp_path)
tile_path, metadata_path, archive_path = map(Path, sys.argv[1:])
header = {'tile_type': TileType.MVT, 'tile_compression': Compression.NONE,
          'min_lon_e7': -120000000, 'min_lat_e7': 480000000,
          'max_lon_e7': 30000000, 'max_lat_e7': 615000000,
          'center_zoom': 5, 'center_lon_e7': -45000000, 'center_lat_e7': 547500000}
with archive_path.open('wb') as archive:
    writer = Writer(archive)
    writer.write_tile(zxy_to_tileid(0, 0, 0), tile_path.read_bytes())
    writer.finalize(header, json.loads(metadata_path.read_text()))

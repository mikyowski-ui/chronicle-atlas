"""Write one genuine PMTiles v3 archive using pinned upstream pmtiles 3.8.1."""
import json
import os
from pathlib import Path
import sys
import tempfile

from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

if len(sys.argv) != 4:
    raise SystemExit("Usage: build-fixture-pmtiles.py TILE.mvt METADATA.json OUTPUT.pmtiles")

app = Path(__file__).resolve().parents[1]
tempdir = app / ".sites-runtime" / "fixture-build" / "tmp"
tempdir.mkdir(parents=True, exist_ok=True)
tempfile.tempdir = str(tempdir)
os.environ["TMPDIR"] = str(tempdir)
tile_path, metadata_path, archive_path = map(Path, sys.argv[1:])
header = {
    "tile_type": TileType.MVT,
    "tile_compression": Compression.NONE,
    "min_lon_e7": -240000000,
    "min_lat_e7": 280000000,
    "max_lon_e7": 220000000,
    "max_lat_e7": 580000000,
    "center_zoom": 3,
    "center_lon_e7": -10000000,
    "center_lat_e7": 430000000,
}
with archive_path.open("wb") as archive:
    writer = Writer(archive)
    writer.write_tile(zxy_to_tileid(0, 0, 0), tile_path.read_bytes())
    writer.finalize(header, json.loads(metadata_path.read_text()))

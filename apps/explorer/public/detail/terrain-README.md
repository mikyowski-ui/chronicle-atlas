# Offline physical context

`terrain.json` is the renderer descriptor. Relative URLs resolve against it.
`raster.tiles` is a local Web Mercator XYZ pyramid, 256 pixels, zoom 0–5.
Use the closest supported raster zoom above zoom 5; no additional detail is
claimed beyond the retained 1:50-million relief source.

`hydrography` is deterministic gzip-compressed GeoJSON. Its compressed and
decoded lengths and SHA-256 hashes are in the descriptor. Verify compressed
bytes before decoding; bound decoding to 16 MiB and verify the decoded hash.
The 2,596 features carry `kind`, `class`, `name`, `minzoom`, `minlabel` and
feature-level `bbox`. Lines are MultiLineString and lakes are MultiPolygon.
Original line/ring coordinates and interior holes are retained. The source
provides progressive display thresholds; smaller waterways need closer zoom.

This layer is **modern physical reference**, independent of the date of a
historical political observation. Source names, present lake extent and river
courses are not historical assertions. Two canal and 230 reservoir records
are omitted; exact originals remain in `terrain-source`. Lake centerlines
remain physical context. No current city or ownership data are introduced.

The relief texture is actual Natural Earth data derived from SRTM Plus.
Warm land and blue water are display tints, not inferred elevation classes.
The existing complete Natural Earth 50m land product is used as a tint mask.
The JPGs and hydrography need no third-party runtime service.

Edition warning: the official relief page advertises 3.2.0, while the ZIP
actually served by the official CDN contains `SR_50M.VERSION.txt` = 2.0.0.
The exact ZIP hash and embedded version govern this product. River and lake
ZIPs both identify 5.0.0. Public-domain rights, archived README files, retained
terms and input hashes are in `terrain-rights.json` and `terrain-source`.

Reproduce from the Explorer directory, with Python, Pillow and numpy:

```sh
flock /tmp/chronicle-detail-compile.lock python3 scripts/build-detail-terrain.py
```

The aggregate lock prevents concurrent heavy detail compilation. The lane
budget was frozen before acquisition; the compressed hydrography allowance
was explicitly amended from 4 to 5 MiB after a stopped preflight measured
4,430,036 bytes. The 20 MiB output, 64 MiB input, 512 MiB RSS, 120-second
deadline and single-worker caps remain unchanged. Exact runtime dependency
versions and measurements are recorded in `terrain-build-record.json`.
`terrain-validation.json` records product checks, not browser or GPU results.

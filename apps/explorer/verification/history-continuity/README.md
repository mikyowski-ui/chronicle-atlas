# Continuity fixture recovery — 27 September 2026

The Historical Cities Source packet omitted these regression fixtures. The ten
previous mappings are restored byte-for-byte by deterministic classification of
the retained raw inputs. Each matches both the admission receipt and the older
primary-40 archive hash list. The restored mapping SHA-256s are recorded here.

The original `previous-geometry-hashes.json` receipt was not recovered. The file
now bearing that test-fixture name is explicitly marked as regenerated evidence.
It is derived independently from exact raw GeoJSON, the hash-verified previous
mappings and the unchanged retained normalizer using Shapely 2.1.2 / GEOS 3.13.1.
The recovery preserves the compiler's Hawaii component exclusions and stable
render IDs. No current compiled metadata is read to construct the baseline.
After derivation, all 2,138 pre-admission parts across ten observations were
compared with the current metadata and matched. This is new recovery validation,
not a claim that the omitted earlier receipt survives or that historical borders
are independently authenticated.

To reproduce the geometry recovery from the restored checkout, use a Python
installation containing Shapely 2.1.2 / GEOS 3.13.1 and run from apps/explorer:

```text
node verification/history-continuity/recover-geometry-baseline.mjs PATH_TO_PYTHON
```

Current targeted regression: 20 tests passed, none failed or skipped. No tests
were disabled or weakened. The Teaching Source packet includes all required
verification fixtures at their checkout-relative paths so ordinary build/test
commands need no manual copy from the outer review folder.

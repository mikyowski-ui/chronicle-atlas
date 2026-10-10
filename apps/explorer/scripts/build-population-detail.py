"""Compile four pinned modeled population observations without loading a time cube.

Requires Python 3, numpy and h5py. Default operation is entirely offline. --fetch
reacquires only the single pinned source named below and verifies its SHA-512.
The source remains independent of historical territory products and the ledger.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import math
from pathlib import Path
import resource
import time
import urllib.request

import h5py
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/detail"
SOURCE = OUT / "population-source/population_histsoc_30arcmin_annual_1901_2021.nc"
SOURCE_URL = "https://files.isimip.org/ISIMIP3a/InputData/socioeconomic/pop/histsoc/population_histsoc_30arcmin_annual_1901_2021.nc"
SOURCE_BYTES = 61_819_211
SOURCE_SHA512 = "64e76d9e190ae2c3b09eb29f467f5c2af87d961d334c420025ec150f6f3344ba8860b0ba743e9a70e3d9c9deb8bf6e04cdbfde4a1230e2faa706c59c8d224614"
YEARS = (1910, 1950, 2000, 2010)
GRID = {"width": 180, "height": 90, "west": -180, "north": 90, "cellDegrees": 2, "order": "row-major-north-to-south-west-to-east"}
EDITION = "isimip3a-population-v1.4-20260807"
METHOD = "sum-4x4-count-cells-spherical-total-cell-area-v1"
RADIUS_KM = 6371.0088


def digest(path: Path, algorithm="sha256") -> str:
    h = hashlib.new(algorithm)
    with path.open("rb") as stream:
        while chunk := stream.read(1_048_576):
            h.update(chunk)
    return h.hexdigest()


def encode(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode()


def write_json(path: Path, value) -> tuple[int, str]:
    payload = encode(value)
    path.write_bytes(payload)
    return len(payload), hashlib.sha256(payload).hexdigest()


def fetch():
    SOURCE.parent.mkdir(parents=True, exist_ok=True)
    temporary = SOURCE.with_suffix(".partial")
    try:
        with urllib.request.urlopen(SOURCE_URL, timeout=30) as response, temporary.open("wb") as output:
            size = 0
            while chunk := response.read(1_048_576):
                size += len(chunk)
                if size > SOURCE_BYTES:
                    raise ValueError("Population source exceeded its pinned byte count.")
                output.write(chunk)
        if size != SOURCE_BYTES or digest(temporary, "sha512") != SOURCE_SHA512:
            raise ValueError("Population source bytes do not match the pinned edition.")
        temporary.replace(SOURCE)
    finally:
        temporary.unlink(missing_ok=True)


def compile_observations():
    started = time.perf_counter()
    limits = json.loads((OUT / "resource-budget.json").read_text())["limits"]
    budget = json.loads((OUT / "population-budget.json").read_text())
    assert budget["output_grid_degrees"] == 2
    assert SOURCE.stat().st_size == SOURCE_BYTES <= limits["population_input_bytes"]
    assert digest(SOURCE, "sha512") == SOURCE_SHA512, "Pinned population source hash changed"
    assert sum(p.stat().st_size for p in SOURCE.parent.iterdir() if p.is_file()) <= limits["population_input_bytes"]
    assert GRID["width"] * GRID["height"] <= limits["population_browser_cells"]

    metadata = json.loads((OUT / "population-source/dataset-metadata.json").read_text())
    resource_metadata = json.loads((OUT / "population-source/resource-metadata.json").read_text())
    assert metadata["version"] == "20260807" and resource_metadata["version"] == "1.4"
    assert metadata["rights"]["short"] == "CC0 1.0"
    source_sha256 = digest(SOURCE)
    rows = np.arange(90, dtype=np.float64)
    north = 90 - rows * 2
    south = north - 2
    row_areas = RADIUS_KM ** 2 * math.radians(2) * (np.sin(np.radians(north)) - np.sin(np.radians(south)))
    assert np.all(row_areas > 0)
    observations = []
    output_bytes = 0
    accounting = []
    with h5py.File(SOURCE, "r") as source:
        assert source["total-population"].shape == (121, 360, 720)
        assert np.array_equal(source["lat"][:], np.arange(89.75, -90, -0.5))
        assert np.array_equal(source["lon"][:], np.arange(-179.75, 180, 0.5))
        assert source["time"].attrs["units"].decode() == "years since 1850-1-1 12:00:00"
        assert np.array_equal(source["time"][:], np.arange(51, 172))
        source_metadata = {key: value.decode("utf8", "replace") for key, value in source.attrs.items() if isinstance(value, bytes)}
        for year in YEARS:
            # One year, one variable, ~2 MiB; the 121-year cube is never read.
            values = source["total-population"][year - 1901, :, :].astype(np.float64)
            fill = float(source["total-population"].attrs["_FillValue"][0])
            valid = np.isfinite(values) & (values != fill)
            assert np.all(values[valid] >= 0), "Negative population values require review"
            known = valid.reshape(90, 4, 180, 4).sum(axis=(1, 3))
            counts = np.where(valid, values, 0).reshape(90, 4, 180, 4).sum(axis=(1, 3))
            densities = counts / row_areas[:, None]
            before = math.fsum(values[valid].tolist())
            after = math.fsum(counts.ravel().tolist())
            assert math.isclose(before, after, rel_tol=1e-14, abs_tol=1e-6), "Conservative aggregation lost population"
            count_values = [float(v) if k else None for v, k in zip(counts.ravel(), known.ravel())]
            density_values = [float(v) if k else None for v, k in zip(densities.ravel(), known.ravel())]
            year_document = {
                "schema_version": 1, "edition": EDITION, "year": year, "grid": GRID,
                "method": METHOD, "units": "people per square kilometre of complete geographic cell",
                "counts": count_values, "densities": density_values,
                "knownSourceCells": known.ravel().tolist(),
                "total_population": after, "source_sha256": source_sha256,
            }
            filename = f"population-{year}.json"
            byte_length, sha256 = write_json(OUT / filename, year_document)
            output_bytes += byte_length
            observation = {
                "year": year, "url": f"./{filename}", "sha256": sha256, "byte_length": byte_length,
                "source_id": EDITION, "edition": EDITION, "method": METHOD,
                "classification": "modeled-population", "date_precision": "year",
                "known_cells": int((known > 0).sum()), "positive_cells": int((counts > 0).sum()),
                "total_population": after,
            }
            observations.append(observation)
            accounting.append({"year": year, "source_year_index": year - 1901,
                "source_valid_cells": int(valid.sum()), "source_zero_cells": int((values[valid] == 0).sum()),
                "source_population": before, "output_population": after, "difference": after - before,
                "known_cells": int((known > 0).sum()), "partially_known_cells": int(((known > 0) & (known < 16)).sum()),
                "null_cells": int((known == 0).sum()), "positive_cells": int((counts > 0).sum()),
                "output_bytes": byte_length, "output_sha256": sha256})

    notes = [
        "Modeled distribution, not a cell-level census or independently reviewed historical population.",
        "Four fixed observations only: 1910, 1950, 2000 and 2010. There is no admitted surface before 1910 and no interpolation between observations.",
        "In follow-date mode, an earlier observation may be retained only as an explicitly dated reference. A manually pinned population date remains independent of the map date.",
        "Each 2-degree cell sums a 4 × 4 block of the source 0.5-degree count grid. No political territory clipping or population-derived migration routes are used.",
        "Density divides the known count by the complete geographic cell area, including water; it is not a land-only density or local settlement estimate.",
        "Null means no admitted source values in that cell. Zero means the source had known cells whose counts sum to zero. knownSourceCells records partial coverage from 0 to 16.",
        "The provider uses HYDE 3.3 and country-level population scaling; temporal and spatial modeling in the source remain part of its uncertainty.",
        "Source NetCDF global title says ISIMIP3b while the provider API assigns this exact file ID and checksum to ISIMIP3a v1.4; both metadata records are retained without rewriting them.",
    ]
    descriptor = {
        "schema_version": 1, "id": "chronicle-population-detail-v1", "edition": EDITION,
        "classification": "modeled-population", "publication": "staged-candidate-only",
        "grid": GRID, "observations": observations, "method": METHOD,
        "units": "people per square kilometre of complete geographic cell",
        "interpolation": False, "no_inferred_routes": True,
        "sources": [{"id": EDITION, "title": resource_metadata["title_with_version"],
            "url": resource_metadata["doi_url"], "edition": EDITION,
            "license": "CC0-1.0", "license_url": metadata["rights"]["rights_uri"],
            "attribution": resource_metadata["citation"], "input_sha256": source_sha256,
            "input_sha512": SOURCE_SHA512, "input_bytes": SOURCE_BYTES,
            "input_url": SOURCE_URL, "rights_record": "./population-rights.json"}],
        "notes": notes,
    }
    size, _ = write_json(OUT / "population.json", descriptor)
    output_bytes += size
    assert output_bytes <= limits["population_output_bytes"]
    peak_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
    assert peak_rss <= limits["worker_rss_bytes"], "Population compiler RSS budget exceeded"
    receipt = {
        "schema_version": 1, "source_sha256": source_sha256, "source_sha512": SOURCE_SHA512,
        "source_bytes": SOURCE_BYTES, "source_netcdf_metadata": source_metadata,
        "compiler_sha256": digest(Path(__file__)), "grid": GRID, "method": METHOD,
        "observations": accounting, "output_bytes": output_bytes,
        "elapsed_ms": round((time.perf_counter() - started) * 1000), "peak_rss_bytes": peak_rss,
        "checks": {"source_sha512": "PASS", "count_conservation": "PASS", "grid_orientation": "PASS",
            "null_zero_distinction": "PASS", "input_budget": "PASS", "output_budget": "PASS", "rss_budget": "PASS"},
        "ledger_modified": False, "source_modeling_preserved": True, "new_time_interpolation": False,
    }
    write_json(OUT / "population-build-record.json", receipt)
    print(json.dumps({"observations": list(YEARS), "source_bytes": SOURCE_BYTES,
        "output_bytes": output_bytes, "peak_rss_bytes": peak_rss, "elapsed_ms": receipt["elapsed_ms"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true")
    arguments = parser.parse_args()
    if arguments.fetch:
        fetch()
    # Shared with the terrain compiler; one heavy detail job at a time.
    with open("/tmp/chronicle-detail-compile.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        compile_observations()

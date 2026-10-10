#!/usr/bin/env python3
"""Derive a bounded qualitative fixture from the retained primary-account register.

Only the derived JSON and its audit may be written. --check is read-only.
No source download, publication, historical compiler or arbitrary input path exists.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


APP = Path(__file__).resolve().parents[1]
SOURCE = APP / "public/history/primary-accounts.json"
SOURCE_HASH = "5f122549fe654c433680ecd50f011527047a98371a2d6ac8c8d8267ddc5f5541"
SOURCE_ID = "chronicle-primary-accounts"
EDITION = "chronicle-teaching-local-2026-09-27/primary-accounts-v1"
OUTPUT = APP / "research-semantic/premodern-pilot.json"
AUDIT = APP / "verification/research-semantic/premodern-source-audit.json"
# Explicit existing records, not fuzzy matches or invented journeys.
SELECTED = (
    (23, "account-periplus-barygaza-first-century", "barygaza"),
    (9, "account-faxian-khotan-400-402", "khotan"),
    (10, "account-xuanzang-samarkand-630", "samarkand"),
    (1, "account-ibn-kilwa-1331", "kilwa"),
    (2, "account-ibn-mogadishu-1331", "mogadishu"),
    (4, "account-ibn-walata-1352", "walata"),
    (5, "account-clavijo-samarkand-1404", "samarkand"),
    (6, "account-clavijo-tabriz-1404", "tabriz"),
    (11, "account-barbosa-calicut-1500-1516", "calicut"),
    (12, "account-barbosa-malacca-1500-1516", "melaka"),
)


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical_hash(value: object) -> str:
    """Match core sorted-key canonical JSON for these finite JSON records."""
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return sha256(raw.encode("utf-8"))


def encoded(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def time_support(start: int, end: int, meaning: str) -> dict:
    if not (isinstance(start, int) and isinstance(end, int) and 0 < start <= end):
        raise ValueError("This bounded CE fixture requires positive ordered source years")
    return {
        "startYear": start,
        "endYear": end,
        "precision": "year" if start == end else "range",
        "meaning": meaning,
    }


def derive() -> tuple[bytes, bytes]:
    raw = SOURCE.read_bytes()
    if sha256(raw) != SOURCE_HASH:
        raise ValueError("Pinned primary-account register hash mismatch")
    source = json.loads(raw)
    if source["schemaVersion"] != 1 or source["reviewedOn"] != "2026-09-27":
        raise ValueError("Unexpected source schema or edition")
    sources = {item["id"]: (index, item) for index, item in enumerate(source["sources"])}
    entities = {}
    observations = []
    rows = []
    bibliography = {}
    for index, expected_id, place_key in SELECTED:
        account = source["accounts"][index]
        if account["id"] != expected_id:
            raise ValueError(f"Source pointer /accounts/{index} no longer matches {expected_id}")
        entity_id = f"account-place-{place_key}"
        entity = {
            "id": entity_id,
            "label": account["place"],
            "coordinates": account["coordinates"],
            "spatialSupport": {
                "definition": source["geographyNote"],
                "comparability": "uncertain",
                "uncertaintyKm": None,
            },
        }
        if entity_id in entities and entities[entity_id] != entity:
            raise ValueError(f"Conflicting retained place references for {entity_id}")
        entities[entity_id] = entity
        bibliography_ids = account["sourceIds"]
        if not bibliography_ids or not any(sources[sid][1]["kind"].startswith("primary-") for sid in bibliography_ids):
            raise ValueError(f"Selected account {expected_id} lacks a registered primary reference")
        record_hash = canonical_hash(account)
        provenance = {
            "sourceId": SOURCE_ID,
            "locator": f"/accounts/{index}",
            "sourceSha256": SOURCE_HASH,
            "recordSha256": record_hash,
            "bibliographySourceIds": bibliography_ids,
        }
        observations.append({
            "id": account["id"],
            "entityId": entity_id,
            "indicatorId": "trade-node-description",
            "value": account["summary"],
            "epistemicStatus": "attested",
            "time": time_support(account["eventFromYear"], account["eventToYear"], "Period discussed by the account; an interval is not evidence of continuous activity."),
            "compositionTime": time_support(account["writtenFromYear"], account["writtenToYear"], "Account composition window; separate from the events described and later translation dates."),
            "author": account["author"],
            "perspective": account["perspective"],
            "limitations": [account["limitations"], "The retained record supplies no quantified spatial uncertainty or statistical confidence interval."],
            "confidence": {"kind": "not-supplied", "note": "No numeric confidence or probability is supplied. Approximate dates and reference coordinates are not measures of narrative reliability."},
            "provenance": provenance,
            "derivation": None,
            "reviewStatus": "source-attributed",
            "supportNote": "Attested means a recorded account description is present in the retained source register. The value is its editorial summary, not a direct quotation, population measurement, quantified trade flow or newly verified eyewitness claim.",
        })
        rows.append({
            "observationId": account["id"],
            "entityId": entity_id,
            "recordPointer": provenance["locator"],
            "recordSha256": record_hash,
            "statementPointer": f"/accounts/{index}/summary",
            "eventPointers": [f"/accounts/{index}/eventFromYear", f"/accounts/{index}/eventToYear"],
            "compositionPointers": [f"/accounts/{index}/writtenFromYear", f"/accounts/{index}/writtenToYear"],
            "coordinatePointer": f"/accounts/{index}/coordinates",
            "bibliographyPointers": [f"/sources/{sources[sid][0]}" for sid in bibliography_ids],
        })
        for sid in bibliography_ids:
            source_index, citation = sources[sid]
            bibliography[sid] = {
                "id": sid,
                "pointer": f"/sources/{source_index}",
                "recordSha256": canonical_hash(citation),
                "title": citation["title"],
                "publisher": citation["publisher"],
                "kind": citation["kind"],
                "notes": citation["notes"],
                "urlPolicy": "Resolve the retained URL only through the host source registry; fixture contains no model-controlled links.",
            }
    coordinates = [entity["coordinates"] for entity in entities.values()]
    fixture = {
        "schemaVersion": 1,
        "id": "premodern-exchange-accounts",
        "edition": EDITION,
        "sourcePins": [{
            "id": SOURCE_ID,
            "edition": EDITION,
            "sha256": SOURCE_HASH,
            "title": "Chronicle retained primary-account register (2026-09-27 local preview)",
            "locator": "public/history/primary-accounts.json",
            "rights": "authorized-local-preview",
            "modelProcessing": False,
            "republication": False,
        }],
        "indicators": [{
            "id": "trade-node-description",
            "label": "Recorded description of exchange or travel support",
            "kind": "qualitative",
            "unit": "qualitative-statement",
            "allowedEvidence": ["attested"],
        }],
        "bounds": {
            "bbox": [min(c[0] for c in coordinates), min(c[1] for c in coordinates), max(c[0] for c in coordinates), max(c[1] for c in coordinates)],
            "epoch": [min(row["time"]["startYear"] for row in observations), max(row["time"]["endYear"] for row in observations)],
        },
        "entities": list(entities.values()),
        "observations": observations,
        "coverageNote": "Ten discontinuous source-attributed account descriptions at nine approximate modern place references, 40–1516 CE. Samarkand has separate records for 630–631 and 1404, with no interpolated connection. This is a bounded evidence-inspection fixture, not a global trade network, a measure of trade intensity, or a claim that places without records were inactive. No geometric routes, inferred edges, invented spatial radii, new primary quotations or numerical historical measurements are supplied. Existing translation and source-access rights are not generalized into republication or provider-processing permission.",
    }
    fixture_bytes = encoded(fixture)
    audit = {
        "schemaVersion": 1,
        "fixtureId": fixture["id"],
        "fixtureSha256": sha256(fixture_bytes),
        "source": {"path": "public/history/primary-accounts.json", "sha256": SOURCE_HASH, "edition": EDITION},
        "recordHashConvention": "UTF-8 JSON, sorted object keys, no whitespace, Unicode retained; array order retained",
        "observationCount": len(observations),
        "entityCount": len(entities),
        "rows": rows,
        "bibliography": list(bibliography.values()),
        "derivation": "Exact retained summary, coordinates and year fields copied; stable local reference-place IDs assigned; limitations and permission constraints added. No source records changed.",
        "validationScope": "Pins the retained register and verifies exact local lineage. Does not re-fetch translations, certify their claims or grant a new historical publication.",
    }
    return fixture_bytes, encoded(audit)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify pinned inputs and exact existing output bytes without writing")
    args = parser.parse_args()
    fixture, audit = derive()
    for path, expected in ((OUTPUT, fixture), (AUDIT, audit)):
        if args.check:
            if path.read_bytes() != expected:
                raise ValueError(f"Derived output differs: {path.relative_to(APP)}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(expected)
    print(f"PASS: 10 account records, 9 places; pinned source {SOURCE_HASH}")
    print(f"Fixture SHA-256: {sha256(fixture)}; {'verified without writes' if args.check else 'derived outputs written'}")


if __name__ == "__main__":
    main()

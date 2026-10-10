#!/usr/bin/env python3
"""Bounded source-semantic classification. No ledger writes or historical certification.

The versioned registry lists exact labels and *observed* dates; it is not an
unbounded name allow-list. Unknown labels stay unresolved. Every input feature
receives exactly one outcome before geometry compilation.
"""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import re
import time

APP = Path(__file__).resolve().parents[1]
ROOT = APP / "public/global-history"
REVISION = "da7a4b735ecef70aebdc9c73e409d8a2500d50f3"
VERSION = "global-basemap-semantics-v3"
EARLIER_VERSION = "global-basemap-earlier-semantics-v4"
DECISIONS = ("political-association", "cultural-presence", "source-context", "review-queue", "quarantined", "excluded")
KINDS = {"political-association": "political", "cultural-presence": "cultural", "source-context": "context"}
TITLE = re.compile(r"\b(empire|kingdom|republic|sultanate|caliphate|emirate|khanate|khaganate|duchy|principality|confederation|commonwealth|colony|bishopric|archbishopric|county|electorate|protectorate|beylik|raj|horde|shogunate|tsardom|viceroyalty)\b", re.I)
CULTURE = re.compile(r"\b(culture|cultures|civilization|complex)\b", re.I)
COLLECTIVE = re.compile(r"\b(kingdoms|states|chiefdoms|chieftainships|principalities|khanates|tribes|peoples|farmers|hunters|hunter|gatherers|gatherer|foraging|pastoral|nomads|nomadic|city-states|warlords)\b", re.I)
HAWAII = re.compile(r"hawa[iʻ‘i’' ]*i|hawaiian|pae[ʻ‘i’' ]*āina", re.I)
CONTESTED = {"Huari Empire", "Tiahuanaco Empire", "Toltec Empire", "Mixtec Empire", "Zapotec Empire"}
# Retained triage flags remain review questions, not certified alternative dates.
SUSPECT = {
    "Mauretania": lambda y: y >= 44, "Min-Yue": lambda y: y > -110,
    "Xiongnu": lambda y: y > 50, "Southern Xiongnu": lambda y: y < 48 or y > 216,
    "Yueban": lambda y: y < 160 or y > 490, "Mauryan Empire": lambda y: y > -185,
    "Kushan Empire": lambda y: y < 1, "Parthian Empire": lambda y: y > 224,
    "Western Roman Empire": lambda y: y > 480, "Sasanian Empire": lambda y: y > 651,
    "Sasanian dependencies": lambda y: y > 651, "Sui Empire": lambda y: y > 618,
    "Liao": lambda y: y > 1125, "Fatimid Caliphate": lambda y: y > 1171,
    "Shogun Japan (Kamakura)": lambda y: y > 1333, "Kingdom of Brazil": lambda y: y >= 1889,
    "Austrian Empire": lambda y: y < 1804, "Jin Empire": lambda y: y == 500,
    "Tuʻi Tonga Empire": lambda y: y < 900, "Han Zhao": lambda y: y < 304,
    "Gupta Empire": lambda y: y < 319, "Empire of Ghana": lambda y: y < 500,
    "Kingdom of Sukhotai": lambda y: y < 1200, "Mongol Empire": lambda y: y < 1206,
    "Srivijaya Empire": lambda y: y >= 1400, "Great Khanate": lambda y: y >= 1400,
    "Chola Empire": lambda y: y >= 1300, "Cholas": lambda y: y >= 1300,
    "Poverty point culture": lambda y: y > 0, "Hopewell Culture": lambda y: y > 500,
    "Suren Kingdom": lambda y: y > 400, "Satavahanihara": lambda y: y > 300,
    "Koguryo": lambda y: y > 668, "Paekche": lambda y: y > 660,
    "Nabatean Kingdom": lambda y: y > 106, "Merina Kingdom": lambda y: y < 1500,
    # Old >=1792 rule incorrectly rejected Restoration-era labels. A nominal1815
    # observation is not an assertion that monarchy persisted every day that year.
    "Kingdom of France": lambda y: 1792 <= y < 1814 or y >= 1848,
    "United States": lambda y: y < 1776,
    "United States of America": lambda y: y < 1776,
    "Bangladesh": lambda y: y < 1971,
    "Pakistan": lambda y: y < 1947,
    "Israel": lambda y: 1000 < y < 1948,
    "United Arab Emirates": lambda y: y < 1971,
    "Tanzania, United Republic of": lambda y: y < 1964,
    "Botswana": lambda y: y < 1966,
    "Zimbabwe": lambda y: 1800 < y < 1980,
    "Zambia": lambda y: y < 1964,
    "Zaire": lambda y: y < 1971 or y >= 1997,
    "Zaire (Belgium)": lambda y: True,
    "Malawi": lambda y: y < 1964,
    "Lesotho": lambda y: y < 1966,
    "Burkina Faso": lambda y: y < 1984,
    "Sri Lanka": lambda y: y < 1972,
    "Guyana": lambda y: y < 1966,
    "USSR": lambda y: y < 1922 or y > 1991,
    "Malaysia": lambda y: y < 1963,
    "Namibia": lambda y: y < 1968,
}

def digest(value):
    if isinstance(value, str): value = value.encode()
    return hashlib.sha256(value).hexdigest()

def compact(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(compact(value) + "\n")

def result(decision, rule, rationale, mapping=None):
    return {"decision": decision, "rule": rule, "rationale": rationale,
            "assertion_kind": KINDS.get(decision), "quarantine": decision == "quarantined",
            "independently_historically_verified": False,
            **({"mapping_id": mapping["mapping_id"]} if mapping else {})}

def classify(label, year, props=None, registry=None):
    """Precedence is deliberate. Exact mappings never bypass quarantine/anomalies."""
    n = str(label or "").strip()
    if HAWAII.search(n) or any(HAWAII.search(str((props or {}).get(k) or "")) for k in ("SUBJECTO", "PARTOF")):
        return result("quarantined", "protected-hawaii-quarantine", "Protected Hawaiʻi material remains withheld under the existing explicit documentary/publication quarantine; this batch cannot release it.")
    if not n or n == "?":
        return result("excluded", "empty-or-unknown", "Unidentified source geometry is retained raw, but cannot produce a named political or cultural assertion.")
    if n in SUSPECT and SUSPECT[n](year):
        return result("quarantined", "suspected-source-date-inconsistency", "Retained source label at this nominal year raises a documented chronology question. Withheld pending resolution; no replacement label, border or event date is invented.")
    if n in CONTESTED:
        return result("review-queue", "archaeological-polity-interpretation", "Imperial wording on an archaeological or collective region is insufficient to establish one political institution. Scholarly semantic mapping remains unresolved.")
    mapping = (registry or {}).get(n)
    if mapping and year in mapping["observed_years"]:
        dated = mapping.get('date_decisions', {}).get(str(year), mapping)
        return result(dated["decision"], "dated-exact-mapping", dated["rationale"], mapping)
    if CULTURE.search(n):
        return result("cultural-presence", "explicit-cultural-label", "Source explicitly labels a cultural/archaeological distribution; independent cultural presence only, with no ownership, control or government inference.")
    if COLLECTIVE.search(n):
        return result("source-context", "collective-context-only", "Source explicitly describes multiple communities, institutions or subsistence groups. Shown only as aggregate source context, not a single polity or political ownership; no numeric population is inferred.")
    if TITLE.search(n):
        return result("political-association", "explicit-political-institution", "Source explicitly names a singular political institution. This is an uncertain source-attributed association at the sampled year, not sovereignty, effective control or independent historical corroboration.")
    return result("review-queue", "unresolved-label-semantics", "A source name alone cannot determine whether this is a polity, population, cultural distribution or geographic region. Raw record retained in the focused mapping worklist; not colored as an authoritative country.")

def retained_isles_aliases():
    """Only exact dated source feature indices in the retained evidence are authority."""
    aliases = {}
    for path in sorted((APP / "public/alpha").glob("isles-*.metadata.json")):
        doc = json.loads(path.read_text())
        for part in doc.get("parts", []):
            props = part["properties"]
            ev = doc.get("evidence", {}).get(props["territory_state_id"], {})
            edition = ev.get("source_edition", "")
            index = ev.get("source_feature_index")
            if not edition.startswith("overview:da7a4b7:") or not isinstance(index, int): continue
            filename = edition.split(":")[-1]
            entity = doc["entities"][props["entity_id"]]
            key = (filename, index)
            alias = {"entity_id": props["entity_id"], "entity_color": entity["color"], "display_name": entity["name"], "assertion_kind": props["kind"], "entity_identity_scope": "retained-exact-dated-Isles-source-feature"}
            if key in aliases and aliases[key] != alias: raise ValueError("Conflicting retained source-feature identity")
            aliases[key] = alias
    return aliases

def color(label, kind):
    hue = int(digest(kind + ":" + label)[:6], 16)
    if kind == "context": return "#b8b2a1"
    if kind == "cultural": return "#b3aa86"
    return "#" + "".join(f"{min(230, x):02x}" for x in [90 + (hue & 127), 80 + ((hue >> 7) & 127), 85 + ((hue >> 14) & 127)])

def run(args):
    import resource
    began = time.monotonic()
    budget_path = ROOT / 'resource-budget.json'
    budget = json.loads(budget_path.read_text())
    limits = budget['limits']
    manifest = json.loads(args.manifest.read_text())
    registry_doc = json.loads(args.registry.read_text())
    registry = {x["label"]: x for x in registry_doc["mappings"]}
    if len(registry) != len(registry_doc["mappings"]): raise ValueError("Duplicate mapping labels")
    registry_hash = digest(args.registry.read_bytes())
    earlier_registry_path = args.out / 'earlier-dated-mappings.json'
    earlier_registry = None
    if earlier_registry_path.exists():
        earlier_registry = {x['label']: x for x in json.loads(earlier_registry_path.read_text())['mappings']}
        earlier_registry_hash = digest(earlier_registry_path.read_bytes())
    aliases = retained_isles_aliases()
    total = collections.Counter(); per_date = []; worklist = {}; blocked = []
    snapshots = manifest.get("snapshots", manifest.get("observations", []))
    observation_cap = budget['scope']['primary_observations'] + (budget['scope']['optional_earlier_observations'] if budget['scope']['optional_enabled'] else 0)
    if len(snapshots) > observation_cap: raise ValueError("Frozen observation scope exceeded")
    for entry in snapshots:
        filename = entry["filename"]
        if args.only and filename not in args.only: continue
        year = entry.get("source_year", entry.get("year"))
        optional = year < -200
        if optional and not earlier_registry:
            blocked.append({'filename': filename, 'source_year': year, 'reason': 'optional-earlier-semantic-review-not-retained'}); continue
        active_registry = earlier_registry if optional else registry
        active_version = EARLIER_VERSION if optional else VERSION
        active_registry_hash = earlier_registry_hash if optional else registry_hash
        path = args.input_dir / filename
        if not path.exists():
            blocked.append({"filename": filename, "source_year": year, "reason": "exact-pinned-input-unavailable"}); continue
        data = path.read_bytes()
        if len(data) > limits['source_file_bytes']: raise ValueError("Frozen source file cap exceeded")
        file_sha = digest(data)
        expected = entry.get("sha256")
        if expected and expected != file_sha: raise ValueError("Input hash mismatch: " + filename)
        source = json.loads(data); rows = []; counts = collections.Counter()
        if len(source["features"]) > 10000: raise ValueError("Raw feature10000 per source cap exceeded")
        # Exact source-name alias reuse within this one dated observation keeps
        # separately indexed colonial/island parts selectable as the same entity.
        # A conflicting dated interpretation blocks reuse; no cross-date guessing.
        dated_aliases = {}
        for index, feature in enumerate(source['features']):
            alias = aliases.get((filename, index))
            if alias:
                name = str((feature.get('properties') or {}).get('NAME') or '').strip()
                if name in dated_aliases and dated_aliases[name] != alias: dated_aliases[name] = None
                else: dated_aliases.setdefault(name, alias)
        for index, feature in enumerate(source["features"]):
            props = feature.get("properties") or {}; label = str(props.get("NAME") or "").strip()
            d = classify(label, year, props, active_registry)
            alias = aliases.get((filename, index)) or dated_aliases.get(label)
            # Deliberate retained regional typing may clarify a culture or source
            # composite; it never overrides protected quarantine or an anomaly.
            if alias and d["decision"] not in ("quarantined", "excluded"):
                d.update(result("political-association" if alias["assertion_kind"] == "political" else "cultural-presence", "retained-dated-isles-mapping", "Exact source edition/name has a unique retained dated Isles interpretation, anchored to its recorded source feature index. The alias also joins matching fragmented source features at this observation only. Shared intent/style, independent full-source geometry/state."))
            stable_id = f"basemap:da7a4b7:{filename}:{index}"
            row = {"filename": filename, "feature_index": index, "source_year": year,
                   "astronomical_year": year + 1 if year < 0 else year,
                   "original_properties": props, "source_feature_id": feature.get("id"),
                   "stable_source_feature_id": stable_id, "source_file_sha256": file_sha,
                   "source_geometry_type": (feature.get("geometry") or {}).get("type"), **d}
            if d["assertion_kind"]:
                mapping = active_registry.get(label, {})
                group = mapping.get("identity_group") if year in mapping.get("observed_years", []) else None
                scope = "explicit-dated-source-alias" if group else "provisional-single-source-observation"
                key = f"{d['assertion_kind']}:{group}" if group else f"{filename}:{d['assertion_kind']}:{label}"
                row.update({"entity_id": "world:" + d["assertion_kind"] + ":" + digest(key)[:20], "entity_color": color(group or label, d["assertion_kind"]), "entity_identity_scope": scope})
                if alias:
                    row.update(alias)
                    row['entity_identity_scope'] = 'retained-dated-source-name-alias'
                row["political_semantics"] = "source-attributed territorial association; not sovereignty or effective control" if d["assertion_kind"] == "political" else "no political ownership inference"
            if props.get("SUBJECTO") and props["SUBJECTO"] != props.get("NAME"):
                row["relationship_note"] = "SUBJECTO retained raw; no automatic dependency, colonial or suzerain relationship inferred."
            if props.get("PARTOF") and props["PARTOF"] != props.get("NAME"):
                row["cultural_group_note"] = "PARTOF retained raw; not a universal political or cultural identity crosswalk."
            rows.append(row); counts[d["decision"]] += 1
            key = (label, d["decision"], d["rule"])
            item = worklist.setdefault(key, {"label": label, "decision": d["decision"], "rule": d["rule"], "rationale": d["rationale"], "source_years": set(), "source_features": []})
            item["source_years"].add(year)
            item["source_features"].append(stable_id)
        if sum(counts.values()) != len(source["features"]): raise ValueError("Feature accounting mismatch")
        dest = args.out / filename.replace(".geojson", "-mappings.json")
        doc = {"source": filename, "source_sha256": file_sha, "source_revision": REVISION, "rules_version": active_version, "registry_sha256": active_registry_hash, "source_year": year, "independently_reviewed_features": 0, "counts": dict(counts), "mappings": rows}
        if not optional and dest.exists():
            if dest.read_text() != compact(doc) + '\n': raise ValueError('Protected primary mapping would change: ' + filename)
        else: write_json(dest, doc)
        per_date.append({"filename": filename, "source_year": year, "scope": 'optional-earlier9' if optional else 'primary40', "rules_version": active_version, "raw_features": len(rows), "counts": dict(counts), "mapping_sha256": digest(dest.read_bytes()), "independently_reviewed_features": 0})
        total.update(counts)
        if resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024 > limits['process_rss_bytes']: raise ValueError('Frozen classifier RSS cap exceeded')
        if time.monotonic() - began > limits['job_deadline_ms'] / 1000: raise ValueError('Frozen sequential classification job deadline exceeded')
    grouped = [{**v, "source_years": sorted(v["source_years"])} for _, v in sorted(worklist.items())]
    write_json(args.out / "label-worklist.json", {"rules_version": VERSION, "earlier_rules_version": EARLIER_VERSION if any(x['scope']=='optional-earlier9' for x in per_date) else None, "groups": grouped})
    summary = {"rules_version": VERSION, "revision": REVISION, "registry_sha256": registry_hash, "budget_sha256": digest(budget_path.read_bytes()), "classifier_sha256": digest(Path(__file__).read_bytes()), "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024, "source_count": len(per_date), "raw_features": sum(total.values()), "counts": dict(total), "independently_reviewed_features": 0, "per_date": per_date, "blocked": blocked,
               "earlier_rules_version": EARLIER_VERSION if any(x['scope']=='optional-earlier9' for x in per_date) else None,
               "earlier_registry_sha256": earlier_registry_hash if any(x['scope']=='optional-earlier9' for x in per_date) else None,
               "scope_counts": {scope: {'source_count': sum(x['scope']==scope for x in per_date), 'raw_features': sum(x['raw_features'] for x in per_date if x['scope']==scope)} for scope in ['primary40', 'optional-earlier9']},
               "precision": "Nominal source year; no event dates, valid-time interpolation or invented continuity.",
               "count_meaning": "Source-feature outcomes, not percentages of world area or historical completeness.",
               "precedence": ["protected quarantine", "blank/unknown exclusion", "dated source anomaly", "archaeological interpretation exception", "dated exact mapping", "explicit culture", "aggregate source context", "singular political wording", "unresolved review"],
               "elapsed_seconds": round(time.monotonic() - began, 3)}
    write_json(args.out / "classification-summary.json", summary)
    print(json.dumps({k: v for k, v in summary.items() if k not in ("per_date", "precedence")}, ensure_ascii=False))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=ROOT / "source/target-snapshots.json")
    parser.add_argument("--input-dir", type=Path, default=ROOT / "source/input")
    parser.add_argument("--registry", type=Path, default=ROOT / "mappings/reusable-labels.json")
    parser.add_argument("--out", type=Path, default=ROOT / "mappings")
    parser.add_argument("--only", nargs="*")
    run(parser.parse_args())

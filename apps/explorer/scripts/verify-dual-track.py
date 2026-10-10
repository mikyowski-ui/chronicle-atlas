#!/usr/bin/env python3
"""Audit retained protected inputs and changes from the delivered M1 source.

Run from any directory. Fixed repository-relative inputs only; no source writes.
Receipts are written only below apps/explorer/verification/dual-track.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath


APP = Path(__file__).resolve().parents[1]
ROOT = APP.parents[1]
OUTPUT = APP / "verification/dual-track"
PROTECTED = APP / "verification/research-workspace/protected-inputs.json"
BASELINE = OUTPUT / "start-source-inventory.json"
EXCLUDED_NAMES = frozenset({"node_modules", ".sites-runtime", "dist", ".git", "__pycache__"})
OUTPUT_PREFIX = "apps/explorer/verification/dual-track"
EXPECTED_PROTECTED_COUNT = 2282


def digest_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_relative(value: str) -> str:
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError("Inventory paths must be nonempty POSIX relative paths")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in (".", "..") for part in value.split("/")):
        raise ValueError(f"Unsafe inventory path: {value!r}")
    if str(path) != value:
        raise ValueError(f"Non-normalized inventory path: {value!r}")
    return value


def excluded(relative: str) -> bool:
    return bool(EXCLUDED_NAMES.intersection(PurePosixPath(relative).parts)) or relative == OUTPUT_PREFIX or relative.startswith(OUTPUT_PREFIX + "/")


def input_entries(entries: list) -> dict:
    result = {}
    for entry in entries:
        relative = safe_relative(entry["path"])
        sha = entry["sha256"]
        if relative in result or not isinstance(sha, str) or len(sha) != 64 or any(character not in "0123456789abcdef" for character in sha):
            raise ValueError(f"Invalid or duplicate inventory entry: {relative}")
        result[relative] = entry
    return result


def inspect(path: Path) -> dict:
    # Never follow a source-tree link to an unregistered path outside the root.
    for ancestor in path.parents:
        if ancestor == ROOT:
            break
        if ancestor.is_symlink():
            raise ValueError("A source parent is a symbolic link; it was not followed")
    if path.is_symlink():
        target_bytes = os.fsencode(os.readlink(path))
        return {"kind": "symlink", "bytes": len(target_bytes), "sha256": digest_bytes(target_bytes)}
    if not path.is_file():
        raise ValueError("Expected a regular source file")
    return {"kind": "file", "bytes": path.stat().st_size, "sha256": digest_file(path)}


def current_inventory() -> tuple[dict, list]:
    records = {}
    errors = []
    def walk_error(exception: OSError) -> None:
        failed = Path(exception.filename) if exception.filename else ROOT
        errors.append({"path": failed.relative_to(ROOT).as_posix(), "error": str(exception)})
    for directory, directories, filenames in os.walk(ROOT, followlinks=False, onerror=walk_error):
        parent = Path(directory)
        descend = []
        for name in sorted(directories):
            path = parent / name
            relative = path.relative_to(ROOT).as_posix()
            if excluded(relative):
                continue
            if path.is_symlink():
                filenames.append(name)
            else:
                descend.append(name)
        directories[:] = descend
        for name in sorted(filenames):
            path = parent / name
            relative = path.relative_to(ROOT).as_posix()
            if excluded(relative):
                continue
            try:
                records[relative] = inspect(path)
            except (OSError, ValueError) as exception:
                errors.append({"path": relative, "error": str(exception)})
    return records, errors


def save(name: str, value: object) -> None:
    # All mutations belong to the excluded receipt directory.
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    protected_raw = PROTECTED.read_bytes()
    baseline_raw = BASELINE.read_bytes()
    protected = input_entries(json.loads(protected_raw))
    baseline_document = json.loads(baseline_raw)
    complete_baseline = input_entries(baseline_document["files"])
    baseline = {path: entry for path, entry in complete_baseline.items() if not excluded(path)}
    current, inventory_errors = current_inventory()

    missing = []
    modified = []
    protected_errors = []
    for relative, before in sorted(protected.items()):
        path = ROOT / relative
        if not path.exists() and not path.is_symlink():
            missing.append({"path": relative, "beforeSha256": before["sha256"]})
            continue
        try:
            after = inspect(path)
        except (OSError, ValueError) as exception:
            protected_errors.append({"path": relative, "error": str(exception)})
            continue
        if after["kind"] != "file" or after["sha256"] != before["sha256"] or ("bytes" in before and after["bytes"] != before["bytes"]):
            modified.append({"path": relative, "beforeSha256": before["sha256"], "beforeBytes": before.get("bytes"), "after": after})
    expected_count_matches = len(protected) == EXPECTED_PROTECTED_COUNT
    protected_pass = expected_count_matches and not missing and not modified and not protected_errors
    protected_audit = {
        "schemaVersion": 1,
        "status": "PASS" if protected_pass else "FAIL",
        "scope": "Exact retained immutable baseline entries; no exemptions or inferred replacements",
        "repositoryRoot": str(ROOT),
        "baselinePath": PROTECTED.relative_to(ROOT).as_posix(),
        "baselineSha256": digest_bytes(protected_raw),
        "expectedCount": EXPECTED_PROTECTED_COUNT,
        "checkedCount": len(protected),
        "expectedCountMatches": expected_count_matches,
        "unchangedCount": len(protected) - len(missing) - len(modified) - len(protected_errors),
        "missing": missing,
        "modified": modified,
        "readErrors": protected_errors,
    }

    deleted = [{"path": path, "beforeSha256": baseline[path]["sha256"]} for path in sorted(baseline.keys() - current.keys())]
    changed = [{"path": path, "beforeSha256": baseline[path]["sha256"], "after": current[path]} for path in sorted(baseline.keys() & current.keys()) if current[path]["kind"] != "file" or baseline[path]["sha256"] != current[path]["sha256"]]
    added = [{"path": path, **current[path]} for path in sorted(current.keys() - baseline.keys())]
    current_digest_input = "".join(f"{path}\0{entry['kind']}\0{entry['sha256']}\n" for path, entry in sorted(current.items()))
    source_changes = {
        "schemaVersion": 1,
        "status": "PASS" if not inventory_errors else "FAIL",
        "meaning": "PASS means inventory comparison completed, not approval of every source change",
        "repositoryRoot": str(ROOT),
        "baselinePath": BASELINE.relative_to(ROOT).as_posix(),
        "baselineInventorySha256": digest_bytes(baseline_raw),
        "baselineSource": baseline_document.get("source"),
        "baselineArchiveSha256": baseline_document.get("sha256"),
        "exclusions": {"directoryNamesAtAnyDepth": sorted(EXCLUDED_NAMES), "subtree": OUTPUT_PREFIX},
        "baselineFileCount": len(baseline),
        "baselineExcludedCount": len(complete_baseline) - len(baseline),
        "currentFileCount": len(current),
        "unchangedCount": len(baseline.keys() & current.keys()) - len(changed),
        "deletedCount": len(deleted),
        "modifiedCount": len(changed),
        "newCount": len(added),
        "currentInventorySha256": digest_bytes(current_digest_input.encode("utf-8")),
        "inventoryHashConvention": "Sorted path, NUL, kind, NUL, SHA-256, newline; UTF-8",
        "deleted": deleted,
        "modified": changed,
        "new": added,
        "readErrors": inventory_errors,
    }
    save("protected-audit.json", protected_audit)
    save("source-changes.json", source_changes)
    print(f"Protected inputs: {protected_audit['status']} — {protected_audit['unchangedCount']}/{len(protected)} unchanged; {len(modified)} modified, {len(missing)} missing, {len(protected_errors)} errors")
    print(f"Source inventory: {source_changes['status']} — {len(changed)} modified, {len(added)} new, {len(deleted)} deleted; {len(inventory_errors)} errors")
    print(f"Receipts: {OUTPUT.relative_to(ROOT).as_posix()}/{{protected-audit,source-changes}}.json")
    if not protected_pass or inventory_errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

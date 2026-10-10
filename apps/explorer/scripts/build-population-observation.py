"""Re-extract the one admitted ONS cell; never fetch or broaden the source scope."""
from pathlib import Path
import hashlib
import json
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1] / "public" / "people"
SOURCE = ROOT / "source" / "ons-ew-1838-2025.xlsx"
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

raw = SOURCE.read_bytes()
assert len(raw) <= 1_048_576, "Pinned workbook input limit exceeded"
with zipfile.ZipFile(SOURCE) as book:
    assert sum(info.file_size for info in book.infolist()) <= 16_777_216, "Workbook expansion budget exceeded"
    shared = ["".join(item.itertext()) for item in ET.fromstring(book.read("xl/sharedStrings.xml"))]
    sheets = ET.fromstring(book.read("xl/workbook.xml")).find("s:sheets", NS)
    sheet = next(item for item in sheets if item.attrib["name"] == "Table 7")
    relation_id = sheet.attrib[f"{{{RNS}}}id"]
    relations = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
    target = next(item.attrib["Target"] for item in relations if item.attrib["Id"] == relation_id)
    tree = ET.fromstring(book.read("xl/" + target.lstrip("/")))
    row = tree.find('.//s:row[@r="128"]', NS)
    values = {}
    for cell in row:
        value = cell.find("s:v", NS)
        if value is not None:
            values[cell.attrib["r"]] = shared[int(value.text)] if cell.attrib.get("t") == "s" else float(value.text)
    assert values["A128"] == "Mid-1900", "Pinned source row changed"
    assert values["B128"] == 32_249_200, "Pinned source value changed; requires a new reviewed edition"

observation_path = ROOT / "population-observation.json"
observation = json.loads(observation_path.read_text())
assert observation["input_sha256"] == hashlib.sha256(raw).hexdigest(), "Pinned source hash changed"
observation["population"] = int(values["B128"])
observation_path.write_text(json.dumps(observation, indent=2, ensure_ascii=False) + "\n")
print(json.dumps({"source_cell": observation["source_cell"], "population": observation["population"], "source_sha256": observation["input_sha256"]}))

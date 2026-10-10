# Premodern sparse-evidence pilot

The second semantic fixture asks **which descriptions of exchange and travel support are retained for selected premodern places, and what dates and source limitations accompany them?** It contains ten account records at nine place references from the existing local Teaching Atlas. It is qualitative evidence inspection, not a numerical trade network or a new historical publication.

The derived file is `apps/explorer/research-semantic/premodern-pilot.json`; authoritative inputs remain unchanged. Dataset ID: `premodern-exchange-accounts`. Edition: `chronicle-teaching-local-2026-09-27/primary-accounts-v1`. Its bytes are pinned externally by the host; the file has no self-referential hash.

## Retained evidence and selection

Input: `apps/explorer/public/history/primary-accounts.json` (schema 1, retained review date 2026-09-27), SHA-256 `5f122549fe654c433680ecd50f011527047a98371a2d6ac8c8d8267ddc5f5541`. This sprint reads that register; it does not fetch or re-review the underlying translations. The register provides named places, approximate modern coordinates, event and composition windows, editorial summaries, source IDs, author perspectives, and limitations. Records were selected explicitly by stable ID and pointer, with at least one registered primary translation per record.

| Place reference | Discussed period (CE) | Composition window (CE) | Retained account pointer | Registered references |
| --- | --- | --- | --- | --- |
| Barygaza / Bharuch | 40–70 | 40–70 | `/accounts/23` | `account-periplus` |
| Khotan / Hotan oasis | 400–402 | 414–416 | `/accounts/9` | `account-faxian`, `account-faxian-dating` |
| Samarkand | 630–631 | 646 | `/accounts/10` | `account-xuanzang` |
| Kilwa Kisiwani | 1331 | 1354–1355 | `/accounts/1` | `account-ibn-east-africa` |
| Mogadishu | 1331 | 1354–1355 | `/accounts/2` | `account-ibn-east-africa` |
| Walata / Oualata | 1352 | 1354–1355 | `/accounts/4` | `account-ibn-travels` |
| Samarkand | 1404 | 1406–1412 | `/accounts/5` | `account-clavijo`, `account-clavijo-scan` |
| Tabriz | 1404 | 1406–1412 | `/accounts/6` | `account-clavijo` |
| Calicut / Kozhikode | 1500–1516 | 1516 | `/accounts/11` | `account-barbosa` |
| Malacca / Melaka | 1500–1516 | 1516 | `/accounts/12` | `account-barbosa` |

These sources include the Periplus, Faxian, Xuanzang, Ibn Battuta, Clavijo and the manuscript tradition associated with Duarte Barbosa. Translation dates and interpretations remain in the source registry and citation audit. For example, the retained Faxian entry cites James Legge's 1886 translation and separate scholarly dating context; it does not imply that a modern translation was composed in 414–416. Each bibliography ID resolves to its exact `/sources/N` record and hash in `apps/explorer/verification/research-semantic/premodern-source-audit.json`.

Samarkand deliberately has two separated records. The fixture does not interpolate between 630–631 and 1404, or imply uninterrupted trade. Khotan concerns monastic accommodation and travel support; it is not a commodity-volume observation. Calicut and Melaka are accumulated accounts covering 1500–1516, not annual surveys. The data preserve the original limitations rather than flattening them into equivalent measurements.

## Semantic commitments

- Indicator `trade-node-description` has unit `qualitative-statement`; values are exact retained editorial summaries. They are not direct quotations and cannot be added, averaged, converted to population, ranked by trade intensity, or interpreted as the number of traders.
- `attested` means that a recorded primary-account description exists in the retained register. It does not certify every statement, eyewitness status, representativeness or neutrality. Review status remains `source-attributed`, separate from evidence classification.
- `time` describes the period discussed. `compositionTime` describes when the account was written. Intervals retain their uncertainty and do not prove continuous activity at every date inside them. Later translation dates are a third, distinct temporal fact.
- Coordinates are copied approximate modern place references, not excavated author positions, historical urban boundaries, transport geometry or political control. All entities have uncertain spatial support and `uncertaintyKm: null`: the source supplies no defensible numerical range. No probability, radius or confidence percentage is invented.
- Measurement confidence is `not-supplied`. Date precision and geocoding uncertainty are not substituted for narrative reliability.
- Bounds `[-7.024, -8.9579, 102.2501, 39.6542]` and `[40, 1516]` are the envelope of these retained reference points and discussed years. They limit queries; they are not historical region boundaries or proof of coverage between nodes.
- Stable `account-place-*` IDs identify fixture-local place references. They neither create canonical historical entities nor override Atlas city identities. Matching Samarkand coordinates permit the two local records to share a place reference, not a claim of unchanged urban extent.

No joins or normalizers are registered. The modern UN pilot is estimated population in persons; the premodern pilot is qualitative account wording. Common coordinates or overlapping dates cannot make those indicator classes comparable. No interpolated records are created. The generic schema can represent `interpolated` and `modeled` evidence under explicit constraints; that vocabulary is not permission to manufacture examples in the real fixture.

## Why existing corridor geometry is excluded

The retained `public/history/exchange-networks.json` was inspected as a candidate. Its methodology explicitly identifies newly authored schematic geography and editorial study windows, rather than surveyed roads, continuous flows or proven opening/closure dates. SHA-256: `519c2d87f18e2ac158d4625e7b92f2a4233e150cceb34d2411a608e56c69e722`.

Using those lines as primary-attested journeys would erase a distinction the Atlas already preserves. This fixture therefore includes account nodes only. It creates no edges between cities, even where travel or exchange appears in a summary, and does not relabel corridor display windows as observation intervals. Route display and teaching-corridor source content remain unchanged in the original Atlas.

## Lineage, rights and reproduction

Every observation carries the original account ID, source-register file hash, exact account pointer, canonical record hash, and registered bibliography IDs. The audit separately records summary, coordinate, event, composition and bibliography pointers. Canonical record hashes use UTF-8 JSON with sorted object keys, compact separators and retained Unicode, matching the TypeScript canonical serializer for these records. File hashes bind exact bytes. A record hash is not a claim that the historical narrative is true.

The retained register does not establish a single blanket license for every translation or linked institution. This fixture is restricted to the authorized existing local preview: `modelProcessing: false`, `republication: false`; replay exports use references only. No full translation, new source quotation or model-provider transfer is introduced. Source URL resolution belongs to the host registry, not user- or model-authored resource strings.

From `apps/explorer`, with Python 3.9+ standard library only:

```sh
python3 scripts/build-premodern-pilot.py --check
```

The check reads the fixed source, requires its pinned SHA-256 and edition, verifies all ten expected IDs and primary-source references, rebuilds the fixture and audit in memory, then compares exact existing bytes. It performs no writes and no network requests. Missing inputs, altered sources or stale derived outputs fail visibly.

To explicitly regenerate only the derived fixture and audit from the same pinned input:

```sh
python3 scripts/build-premodern-pilot.py
```

The generator has no arbitrary input-path, URL or dataset option and never invokes the historical compiler. The dual-track acceptance report records runtime-schema validation, query/replay tests, and remaining product or environment gates. Neither deterministic lineage nor passing software tests amounts to a new scholarly review or historical-publication approval.

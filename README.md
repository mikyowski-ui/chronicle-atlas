Current reviewed handoff: [FINAL-REVIEW-ACCEPTANCE.md](docs/research-workspace/FINAL-REVIEW-ACCEPTANCE.md) and SESSION.md. Earlier checkpoint text is retained below.

# Current checkpoint: Chronicle dual-track research sprint

The existing Atlas includes the prepared Research workspace and a new evidence catalogue for modern urban estimates and premodern accounts. See [SESSION.md](SESSION.md) and [dual-track acceptance](docs/research-workspace/DUAL-TRACK-ACCEPTANCE.md) for current commands, measurements and remaining gates. Earlier M1 receipts and release documentation remain below as provenance.

The semantic validator has an isolated, pinned dependency package. After installing from `apps/explorer`, also run `corepack pnpm install --frozen-lockfile --ignore-scripts` **inside `apps/explorer/research-semantic`**, then return to `apps/explorer` to build or test. Root dependency files and authoritative data remain unchanged.

---

# Chronicle Teaching Atlas — reproducible source

Application commit: `1dc4084baee4602cbd8d587faf99b972a3d6b6a8`. Production build: `chronicle-a291668ccb5651a69ec319fea61f5f79889ea37d1c0a53b01a86d5d11b7203f3`.
Recovered source baseline: `ed9449b22fe16692ee8b1933eac7130ef79a3ca4`. Earlier Git history is not bundled.

Extract the matching Source and Originals packets into the same parent, then
enter `source/apps/explorer`. Use the Node and pnpm versions pinned in
`package.json`; install with `pnpm install --frozen-lockfile`, build with `pnpm run build`,
and run `pnpm test`. The restored source, public assets, retained
compiler inputs and contracts reconstruct the current source fingerprint.
The retained older full-grid compiler still needs the wider project's mesh
inputs; this engineering subset does not claim to recreate that older ledger.

Current release evidence is in the outer `verification/teaching/` directory.
`public/history/` retains authored records and their source registers. Historical
uncertainty and admission limits remain explicit; smooth timeline motion does
not create additional observed dates or city/population evidence.
The city compiler is `scripts/compile-historical-cities.py`; alignment and
quarantine receipts remain under `public/history/`. Restore raw CSV/XLSX inputs
to `public/history/source/` from Originals before rerunning the compiler.

The `windows-launcher/` directory contains the portable Windows wrapper source.
Its generated payload is intentionally omitted from Source. Recreate it from
the matching `Chronicle-Teaching-Atlas-Runnable.zip` with:

```text
python windows-launcher/make-payload.py PATH_TO_RUNNABLE_ZIP windows-launcher/Go-LICENSE.txt
```

Then follow `windows-launcher/README.md` using Go 1.26.1. The runtime requires
only an installed browser; developer tools are needed solely for rebuilding.


Teaching data and source references are retained under `public/history/`:
`state-coverage.json`, `exchange-networks.json`, `historical-foundations.json` and
`primary-accounts.json`. The coverage compiler is `scripts/compile-state-coverage.py`.
The catalog and authored profiles document different levels of evidence; source
polygons and source-derived descriptions are not independent historical validation.

The source subset was restored from the Historical Cities Source and Originals
packets, application commit 74c1e90603772fb55b4c4741f445dde48937fe32. Its local
reconstruction baseline is recorded above; the previous complete Git history is
not present. Source plus Originals reconstructs the current source fingerprint.
The outer `verification/history/` folder is inherited evidence for that earlier
build, not a test receipt for this edition.
The small verification inputs used by regression tests are also preserved inside
`source/apps/explorer/verification/`; no manual copy from the outer review folders
is needed for `pnpm run build` followed by `pnpm test`. Continuity-fixture recovery
is documented there, distinguishing exact pinned mappings from a newly regenerated
geometry baseline.

## Current M2 integration checkpoint

Both evidence pilots now use the same linked Research workspace. See [docs/research-workspace/M2-INTEGRATION.md](docs/research-workspace/M2-INTEGRATION.md) and the adjacent M2-INTEGRATION-ACCEPTANCE.md for the current commands, complete-workspace replay contract and unrun browser/hardware gates. Live inference and generated execution remain disabled.

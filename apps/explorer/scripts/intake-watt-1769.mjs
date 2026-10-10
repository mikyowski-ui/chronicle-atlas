#!/usr/bin/env node
/** One-source intake for the Watt mechanism domain. Default mode verifies the retained excerpt offline.
 * --fetch re-downloads the two pinned public-domain sources and rebuilds or compares the excerpt record. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../src/domains/watt-mechanism/source/watt-1769-specification.json', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const normalize = text => text.replace(/\s+/g, ' ').trim();
const REPRINT = Object.freeze({ url: 'https://www.gutenberg.org/cache/epub/22657/pg22657.txt', bytes: 1031980, sha256: '65be4b09abf9e474a440d57ebea434d2438c87ce79eb26eb7e031ce26d1d1f66' });
const PRIMARY_URL = 'https://www.dpma.de/docs/dpma/veroeffentlichungen/gb000176900913a_watt1769.pdf';
const PASSAGES = Object.freeze([
  { id: 'specification-quotation', role: 'patent-specification-text', start: /"My method of lessening/, end: /in\s+their\s+fluid\s+state\."/ },
  { id: 'reprint-patent-year', role: 'reprint-editorial-statement', start: /After several trials with an experimental apparatus/, end: /patented\s+his\s+improvements\s+in\s+1769\./ },
  { id: 'reprint-fifth-omitted', role: 'reprint-editorial-statement', start: /The fifth claim was for a rotary engine/, end: /need\s+not\s+be\s+quoted\s+here\./ },
]);

async function download(url) {
  const response = await fetch(url, { redirect: 'error' });
  if (response.status !== 200) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
function passage(bytes, definition) {
  const text = bytes.toString('utf8'), start = text.search(definition.start);
  if (start < 0) throw new Error(`Missing start anchor for ${definition.id}`);
  const tail = text.slice(start), match = definition.end.exec(tail);
  if (!match) throw new Error(`Missing end anchor for ${definition.id}`);
  const end = start + match.index + match[0].length, excerpt = normalize(text.slice(start, end));
  const byteRange = [Buffer.byteLength(text.slice(0, start)), Buffer.byteLength(text.slice(0, end))];
  if (text.indexOf(text.slice(start, end), start + 1) >= 0) throw new Error(`Ambiguous passage ${definition.id}`);
  return { id: definition.id, role: definition.role, byteRange, text: excerpt, sha256: sha256(excerpt) };
}

if (process.argv.includes('--fetch')) {
  const reprint = await download(REPRINT.url);
  if (reprint.length !== REPRINT.bytes || sha256(reprint) !== REPRINT.sha256) throw new Error('Upstream reprint bytes differ from the pinned edition; review before re-pinning.');
  const primary = await download(PRIMARY_URL);
  const record = {
    schemaVersion: 1, id: 'watt-1769-specification-reprint', domain: 'technological-mechanism',
    title: 'James Watt, patent specification for lessening the consumption of steam and fuel in fire engines (1769), as quoted in Babcock & Wilcox Co., Steam, Its Generation and Use',
    edition: 'Project Gutenberg eBook #22657 plain-text release',
    retrieval: { url: REPRINT.url, retrievedOn: new Date().toISOString().slice(0, 10), upstreamBytes: REPRINT.bytes, upstreamSha256: REPRINT.sha256 },
    normalization: 'UTF-8 byte ranges from the upstream file; line breaks, indentation and whitespace runs collapsed to single spaces. Characters are otherwise unchanged.',
    passages: PASSAGES.map(definition => passage(reprint, definition)),
    primaryRecord: { label: 'Printed specification of GB patent 1769 No. 913 (facsimile PDF)', url: PRIMARY_URL, bytes: primary.length, sha256: sha256(primary), status: 'pinned-not-retained-not-collated' },
    rights: 'public-domain-text', modelProcessing: false, republication: false,
    limitations: [
      'Secondary reprint with American spelling; it has not been collated against the printed 1769 specification.',
      'The reprint marks an elision after the fourth principle and omits the fifth (rotary) principle; omitted wording is not represented.',
      'A patent specification states the inventor’s claimed method. It is not evidence of construction, operating performance or fuel savings.',
    ],
  };
  const text = JSON.stringify(record, null, 2) + '\n';
  if (existsSync(output) && !process.argv.includes('--write')) {
    const existing = JSON.parse(await readFile(output, 'utf8'));
    const comparable = value => JSON.stringify({ ...value, retrieval: { ...value.retrieval, retrievedOn: null } });
    if (comparable(existing) !== comparable(record)) throw new Error('Re-derived record differs from the retained excerpt.');
    console.log(JSON.stringify({ status: 'PASS', mode: 'fetch-compare', passages: record.passages.map(item => [item.id, item.sha256]), primary: record.primaryRecord.sha256 }));
  } else {
    await writeFile(output, text);
    console.log(JSON.stringify({ status: 'WRITTEN', output, passages: record.passages.map(item => [item.id, item.byteRange, item.sha256]), primary: [record.primaryRecord.bytes, record.primaryRecord.sha256] }));
  }
} else {
  const record = JSON.parse(await readFile(output, 'utf8'));
  for (const item of record.passages) if (sha256(item.text) !== item.sha256 || normalize(item.text) !== item.text) throw new Error(`Passage hash mismatch: ${item.id}`);
  console.log(JSON.stringify({ status: 'PASS', mode: 'offline-check', passages: record.passages.length }));
}

import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { BrowserPackBuild } from './browser-pack-compiler.ts';
import { buildAcceptedBrowserPackV2 } from './generate-browser-pack.ts';

// #208 / #211 A — payload decomposition of the accepted BrowserPack v2 (§16.1). Every section byte is
// assigned to exactly one payload class, and within binary sections split into Unicode string bytes
// (UTF-8 data + string offsets), integer references/postings and fixed overhead. Textual payload is
// also measured across the whole pack: how many string occurrences, how many distinct strings, how
// many duplicate bytes, and how many distinct orthographic atoms (code points) carry it. This report
// is the oracle the Symbol/Sequence units (B–J) are measured against; it changes no semantics.
//
//   npm run measure:pack-payload            -> data/reports/browser-pack-v2-payload-decomposition.json
//   npm run measure:pack-payload -- --check

export const PACK_PAYLOAD_REPORT = 'data/reports/browser-pack-v2-payload-decomposition.json';

const require = createRequire(import.meta.url);
const { decodeSection, decodeBundle } = require('../runtime/browser-pack-binary.js');

/** Payload class of a section kind (bundle parts are classified by their part name). */
export const PAYLOAD_CLASS: Record<string, string> = {
  'string-pool': 'knowledge-strings', facts: 'knowledge-facts', 'lexical-index': 'knowledge-index',
  'surface-index': 'lexical-index', 'reading-index': 'lexical-index', 'lexical-directory': 'lexical-index', 'shard-directory': 'knowledge-index',
  'lexeme-table': 'lexeme-metadata', 'lexeme-forms': 'lexeme-metadata', 'lexeme-readings': 'lexeme-metadata',
  'morphology-table': 'morphology',
  'detail-shard': 'provenance-evidence', 'provenance-index': 'provenance-evidence',
  rules: 'rules-bindings', bindings: 'rules-bindings',
  'profile-policy': 'profile', terminology: 'presentation'
};

const utf8 = new TextEncoder();
/** Orthographic text vs identifier text (ids, refs, tags, URLs): identifiers contain ':' or are ASCII-only. */
export const isIdentifierText = (s: string) => s.includes(':') || /^[\x00-\x7f]*$/u.test(s);

export function measurePackPayload(build: BrowserPackBuild) {
  const classes: Record<string, { sections: number; bytes: number; unicodeStringBytes: number; stringOffsetBytes: number; integerBytes: number; overheadBytes: number; jsonBytes: number }> = {};
  const occurrences = { orthographic: { count: 0, bytes: 0 }, identifier: { count: 0, bytes: 0 } };
  const distinct = new Map<string, number>(); // string -> occurrences
  const atomOccurrences = new Map<string, number>();
  const row = (name: string) => (classes[name] ??= { sections: 0, bytes: 0, unicodeStringBytes: 0, stringOffsetBytes: 0, integerBytes: 0, overheadBytes: 0, jsonBytes: 0 });

  const account = (cls: string, section: any, totalBytes: number) => {
    const r = row(cls);
    let accounted = 0;
    for (const column of Object.values<any>(section.columns)) {
      const data = column.values.byteLength;
      const offsets = column.offsets?.byteLength ?? 0;
      if (column.utf8) {
        r.unicodeStringBytes += data; r.stringOffsetBytes += offsets;
        for (let i = 0; i < column.rowCount; i += 1) {
          const s: string = section.string(column.name, i);
          if (s === '') continue;
          const bytes = utf8.encode(s).length;
          const kind = isIdentifierText(s) ? 'identifier' : 'orthographic';
          occurrences[kind].count += 1; occurrences[kind].bytes += bytes;
          distinct.set(s, (distinct.get(s) ?? 0) + 1);
          if (kind === 'orthographic') for (const atom of Array.from(s as string)) atomOccurrences.set(atom, (atomOccurrences.get(atom) ?? 0) + 1);
        }
      } else {
        r.integerBytes += data + offsets;
      }
      accounted += data + offsets;
    }
    r.overheadBytes += totalBytes - accounted;
  };

  for (const s of build.manifest.sections) {
    const body = build.files.get(s.path)!;
    if (s.encoding === 'json') {
      const r = row(PAYLOAD_CLASS[s.kind] ?? s.kind);
      r.sections += 1; r.bytes += body.byteLength; r.jsonBytes += body.byteLength;
      continue;
    }
    if (s.encoding === 'binary-bundle') {
      const bundle = decodeBundle(body);
      let partBytes = 0;
      for (const [name, part] of Object.entries<any>(bundle.parts)) {
        const cls = PAYLOAD_CLASS[name] ?? name;
        const size = Object.values<any>(part.columns).reduce((n, c) => n + c.values.byteLength + (c.offsets?.byteLength ?? 0), 0);
        row(cls).bytes += size;
        account(cls, part, size);
        partBytes += size;
      }
      const bundleRow = row('bundle-container');
      bundleRow.sections += 1; bundleRow.bytes += body.byteLength - partBytes; bundleRow.overheadBytes += body.byteLength - partBytes;
      continue;
    }
    const cls = PAYLOAD_CLASS[s.kind] ?? s.kind;
    const r = row(cls);
    r.sections += 1; r.bytes += body.byteLength;
    account(cls, decodeSection(body), body.byteLength);
  }

  const total = build.manifest.sections.reduce((n, s) => n + s.byteLength, 0);
  const classTotal = Object.values(classes).reduce((n, c) => n + c.bytes, 0);
  let distinctBytes = 0;
  let distinctOrthographic = 0;
  for (const s of distinct.keys()) { distinctBytes += utf8.encode(s).length; if (!isIdentifierText(s)) distinctOrthographic += 1; }
  const allOccurrenceBytes = occurrences.orthographic.bytes + occurrences.identifier.bytes;
  const atoms = [...atomOccurrences].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return {
    schemaVersion: '1',
    kind: 'browser-pack-payload-decomposition',
    owner: 'japanese-orthography#211 A (spec #208 §16.1)',
    packDigest: build.manifest.packDigest,
    totalBytes: total,
    classTotalBytes: classTotal,
    classes: Object.fromEntries(Object.entries(classes).sort(([a], [b]) => (a < b ? -1 : 1))),
    textualPayload: {
      occurrences,
      distinctStrings: distinct.size,
      distinctOrthographicStrings: distinctOrthographic,
      occurrenceBytes: allOccurrenceBytes,
      distinctBytes,
      duplicateBytes: allOccurrenceBytes - distinctBytes,
      note: 'string occurrences are counted per shard-local pool entry; duplicateBytes is what one pack-wide pool would save before any Symbol encoding'
    },
    orthographicAtoms: {
      distinct: atoms.length,
      top: atoms.slice(0, 20).map(([atom, n]) => ({ atom, occurrences: n })),
      bmpOnly: atoms.every(([atom]) => atom.length === 1)
    }
  };
}

if (process.argv[1]?.endsWith('measure-pack-payload.ts')) {
  const root = resolve(process.cwd());
  const report = measurePackPayload(await buildAcceptedBrowserPackV2(root));
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (process.argv.includes('--check')) {
    const committed = (await readFile(resolve(root, PACK_PAYLOAD_REPORT), 'utf8')).replace(/\r\n/g, '\n');
    if (committed !== text) throw new Error(`stale ${PACK_PAYLOAD_REPORT}; run npm run measure:pack-payload`);
    console.log(`${PACK_PAYLOAD_REPORT} OK`);
  } else {
    await writeFile(resolve(root, PACK_PAYLOAD_REPORT), text);
    console.log(JSON.stringify({ total: report.totalBytes, textual: report.textualPayload, atoms: report.orthographicAtoms.distinct }, null, 1));
  }
}

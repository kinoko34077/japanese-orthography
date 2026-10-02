import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { encodeSection } from './browser-pack-encoding.ts';
import type { OrthographyKnowledgeGraph } from './orthography-knowledge-model.ts';
import { withProfileRules } from './orthography-policy.ts';
import { normalizeAcceptedOrthographySources } from './orthography-source-normalization.ts';
import { RENDER_MARKERS, SYMBOL_REGISTRY, type SymbolRegistry } from './symbol-registry.ts';

// #208 §7 / §6.6 / §16.2 — #211 C: Sequence Pool + SymbolId encoding comparison.
//
// buildSequencePool interns every distinct orthographic text once as a SymbolId sequence, sorted by
// its symbols (deterministic, binary-searchable). The encoding report compares, on the real accepted
// dataset, the current UTF-8 representation with fixed uint16, short-id + escape and varint SymbolId
// encodings (raw bytes, gzip, decode cost, random access), and records the choice.
//
//   npm run measure:sequence-encoding   -> data/reports/symbol-sequence-encoding.json

export const SEQUENCE_ENCODING_REPORT = 'data/reports/symbol-sequence-encoding.json';
const require = createRequire(import.meta.url);
const { createSymbolizer } = require('../runtime/symbol-registry-runtime.js');
const { compareSymbols } = require('../runtime/sequence-pool-runtime.js');

export interface SequencePool {
  /** SequenceId -> SymbolIds (sorted by symbols; deterministic) */
  sequences: number[][];
  /** text -> SequenceId */
  idOf: Map<string, number>;
  /** the pool as one binary section (`symbols` list column) */
  section: Uint8Array;
}

export function buildSequencePool(texts: Iterable<string>, registry: SymbolRegistry): SequencePool {
  const symbolizer = createSymbolizer(registry);
  const unique = new Map<string, number[]>();
  for (const text of texts) {
    if (unique.has(text)) continue;
    const seq = symbolizer.sequenceOf(text);
    if (!seq) throw new Error(`text ${JSON.stringify(text)} contains atoms outside the Symbol Registry`);
    unique.set(text, seq);
  }
  const ordered = [...unique].sort((a, b) => compareSymbols(a[1], b[1]));
  const idOf = new Map(ordered.map(([text], i) => [text, i]));
  const sequences = ordered.map(([, seq]) => seq);
  return { sequences, idOf, section: encodeSection([{ name: 'symbols', kind: 'list', values: sequences }]) };
}

/** Distinct orthographic texts the hot runtime needs: forms, readings, relation endpoints, rule literals. */
export function orthographicTexts(graph: OrthographyKnowledgeGraph): string[] {
  const out = new Set<string>();
  for (const f of graph.facts) for (const v of [f.surface, f.reading, f.target]) if (v) out.add(v);
  for (const r of graph.rules) {
    const literal = (v: string) => !(r.predicate && 'mechanism' in r.predicate && /^[a-z-]+$/u.test(v));
    for (const v of [...r.from, ...r.to]) if (literal(v)) out.add(v);
  }
  for (const m of RENDER_MARKERS) out.add(m);
  return [...out];
}

// ---- encodings (§6.6) ------------------------------------------------------------------------------
type Encoder = (sequences: number[][], maxId: number) => { bytes: Uint8Array; decode: () => number[][]; scan: () => number; randomAccess: string };

const withOffsets = (body: number[], offsets: number[]) => {
  const out = new Uint8Array(body.length + offsets.length * 4);
  out.set(body, 0);
  const view = new DataView(out.buffer);
  offsets.forEach((o, i) => view.setUint32(body.length + i * 4, o, true));
  return out;
};

export const ENCODINGS: Record<string, Encoder> = {
  'fixed-uint16': (sequences) => {
    const total = sequences.reduce((n, s) => n + s.length, 0);
    const data = new Uint16Array(total);
    const offsets = [0];
    let at = 0;
    for (const s of sequences) { data.set(s, at); at += s.length; offsets.push(at); }
    const bytes = withOffsets([...new Uint8Array(data.buffer)], offsets);
    return {
      bytes,
      randomAccess: 'O(1) per symbol (offset + index); TypedArray view, no decode',
      decode: () => sequences.map((_, i) => Array.from(data.subarray(offsets[i]!, offsets[i + 1]!))),
      scan: () => { let sum = 0; for (let i = 0; i + 1 < offsets.length; i += 1) { const v = data.subarray(offsets[i]!, offsets[i + 1]!); for (let j = 0; j < v.length; j += 1) sum += v[j]!; } return sum; }
    };
  },
  'short-id-escape': (sequences) => {
    // ids 1..254 in one byte; 255 escapes a following uint16
    const body: number[] = [];
    const offsets = [0];
    for (const s of sequences) {
      for (const id of s) { if (id < 255) body.push(id); else body.push(255, id & 0xff, id >> 8); }
      offsets.push(body.length);
    }
    const bytes = withOffsets(body, offsets);
    return {
      bytes,
      randomAccess: 'O(1) per sequence, O(length) per symbol (variable width)',
      decode: () => sequences.map((_, i) => {
        const out: number[] = [];
        for (let p = offsets[i]!; p < offsets[i + 1]!;) { const b = body[p]!; if (b < 255) { out.push(b); p += 1; } else { out.push(body[p + 1]! | (body[p + 2]! << 8)); p += 3; } }
        return out;
      }),
      scan: () => { const u = Uint8Array.from(body); let sum = 0; for (let p = 0; p < u.length;) { const b = u[p]!; if (b < 255) { sum += b; p += 1; } else { sum += u[p + 1]! | (u[p + 2]! << 8); p += 3; } } return sum; }
    };
  },
  varint: (sequences) => {
    const body: number[] = [];
    const offsets = [0];
    for (const s of sequences) {
      for (let id of s) { while (id >= 0x80) { body.push((id & 0x7f) | 0x80); id >>>= 7; } body.push(id); }
      offsets.push(body.length);
    }
    const bytes = withOffsets(body, offsets);
    return {
      bytes,
      randomAccess: 'O(1) per sequence, O(length) per symbol (variable width)',
      decode: () => sequences.map((_, i) => {
        const out: number[] = [];
        for (let p = offsets[i]!; p < offsets[i + 1]!;) { let v = 0; let shift = 0; let b: number; do { b = body[p++]!; v |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80); out.push(v); }
        return out;
      }),
      scan: () => { const u = Uint8Array.from(body); let sum = 0; for (let p = 0; p < u.length;) { let v = 0; let shift = 0; let b: number; do { b = u[p++]!; v |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80); sum += v; } return sum; }
    };
  }
};

const time = (fn: () => unknown, rounds = 5) => {
  let best = Infinity;
  for (let i = 0; i < rounds; i += 1) { const t = performance.now(); fn(); best = Math.min(best, performance.now() - t); }
  return Math.round(best * 10) / 10;
};

export function compareEncodings(texts: readonly string[], registry: SymbolRegistry) {
  const pool = buildSequencePool(texts, registry);
  const utf8 = new TextEncoder();
  const utf8Body = [...pool.idOf.keys()].map((t) => utf8.encode(t));
  const flat: number[] = [];
  const offsets = [0];
  for (const b of utf8Body) { for (const x of b) flat.push(x); offsets.push(flat.length); }
  const utf8Bytes = withOffsets(flat, offsets);
  const decoder = new TextDecoder();
  const rows: Record<string, unknown> = {
    'utf8-strings': {
      bytes: utf8Bytes.byteLength, gzipBytes: gzipSync(utf8Bytes, { level: 9 }).length,
      scanMs: time(() => { let n = 0; for (const b of utf8Body) n += decoder.decode(b).length; return n; }),
      randomAccess: 'O(1) per string; per-character access needs UTF-8 decoding'
    }
  };
  for (const [name, encode] of Object.entries(ENCODINGS)) {
    const e = encode(pool.sequences, registry.atoms.length);
    const decoded = e.decode();
    if (decoded.some((s, i) => compareSymbols(s, pool.sequences[i]!) !== 0)) throw new Error(`${name} does not round-trip`);
    rows[name] = { bytes: e.bytes.byteLength, gzipBytes: gzipSync(e.bytes, { level: 9 }).length, scanMs: time(() => e.scan()), randomAccess: e.randomAccess };
  }
  const symbols = pool.sequences.reduce((n, s) => n + s.length, 0);
  const oneByte = pool.sequences.reduce((n, s) => n + s.filter((id) => id < 255).length, 0);
  return {
    schemaVersion: '1',
    kind: 'symbol-sequence-encoding-comparison',
    owner: 'japanese-orthography#211 C (spec #208 §6.6, §16.2)',
    registry: { size: registry.atoms.length, generation: registry.generations.at(-1)!.generation },
    dataset: { distinctSequences: pool.sequences.length, symbols, symbolsBelow255: oneByte, maxSequenceLength: pool.sequences.reduce((m, s) => Math.max(m, s.length), 0) },
    encodings: rows,
    choice: {
      encoding: 'fixed-uint16',
      reason: 'registry ids fit uint16 (wider ids would use a versioned extension, §6.5); fixed width gives zero-decode TypedArray views and O(1) symbol access in the binary sections the runtime already uses; the variable-width encodings save raw bytes, and the measured gzip and scan figures here are what the trade-off is judged on',
      revisit: 're-measure when the registry approaches 65,535 ids or if transfer size dominates (short-id tier is prepared by the frequency-ordered ids)'
    }
  };
}

if (process.argv[1]?.endsWith('sequence-pool.ts')) {
  const root = resolve(process.cwd());
  const { graph } = await normalizeAcceptedOrthographySources(root);
  const registry = JSON.parse(await readFile(resolve(root, SYMBOL_REGISTRY), 'utf8')) as SymbolRegistry;
  const report = compareEncodings(orthographicTexts(withProfileRules(graph)), registry);
  await writeFile(resolve(root, SEQUENCE_ENCODING_REPORT), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ dataset: report.dataset, encodings: report.encodings }, null, 1));
}

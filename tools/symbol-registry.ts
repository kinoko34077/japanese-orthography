import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { OrthographyKnowledgeGraph } from './orthography-knowledge-model.ts';
import { withProfileRules } from './orthography-policy.ts';
import { normalizeAcceptedOrthographySources } from './orthography-source-normalization.ts';

// #208 §6 / #211 B — append-only project-local Symbol Registry.
//
// * Only atoms the accepted knowledge actually needs are registered (no Unicode-wide table).
// * First generation: ids by output frequency desc, then total reference frequency desc, then UTF-8
//   byte order — deterministic.
// * Later generations only append (newId = maxId + 1). An atom that is no longer referenced is
//   tombstoned: its id is never reused and never reassigned. A tombstoned atom that comes back gets
//   its own original id back (same atom, same id).
// * Every generation records the SHA-256 of the atom prefix it covered, so any remap / reorder /
//   shrink of an earlier id is detected from the registry file alone (`--check`, CI).
//
//   npm run generate:symbol-registry            -> data/runtime/symbol-registry.json (append-only update)
//   npm run validate:symbol-registry            -> invariants + "no pending atoms" against live knowledge

export const SYMBOL_REGISTRY = 'data/runtime/symbol-registry.json';
const require = createRequire(import.meta.url);
const { atomsOf } = require('../runtime/symbol-registry-runtime.js');

export interface SymbolRegistry {
  schemaVersion: '1';
  kind: 'japanese-orthography-symbol-registry';
  owner: string;
  /** atoms[i] is the atom of SymbolId i + 1 */
  atoms: string[];
  /** SymbolIds no longer referenced; never reused */
  tombstones: number[];
  generations: Array<{ generation: number; size: number; prefixSha256: string; added: number; tombstoned: number; reactivated: number }>;
}

/** Render markers the late renderer emits (Ruby syntax) — always outputs. */
export const RENDER_MARKERS = ['｜', '《', '》'] as const;

export interface AtomStats { output: number; total: number }

/** Output / total reference frequency of every orthographic atom in the accepted knowledge. */
export function atomStatistics(graph: OrthographyKnowledgeGraph): Map<string, AtomStats> {
  const stats = new Map<string, AtomStats>();
  const count = (text: string | undefined, output: boolean) => {
    if (!text) return;
    for (const atom of atomsOf(text) as string[]) {
      const s = stats.get(atom) ?? { output: 0, total: 0 };
      s.total += 1;
      if (output) s.output += 1;
      stats.set(atom, s);
    }
  };
  for (const f of graph.facts) {
    // emitted by some transformation: relation endpoints (both directions), written forms, readings (Ruby)
    const outputs = f.kind === 'form_relation' || f.kind === 'literal_form' || f.kind === 'literal_reading';
    count(f.surface, outputs);
    count(f.reading, outputs && f.kind === 'literal_reading');
    count(f.target, outputs);
  }
  for (const r of graph.rules) {
    // mechanism rules name transformations ('katakana', 'expanded'), not text: only literal operands count
    const literal = (v: string) => !(r.predicate && 'mechanism' in r.predicate && /^[a-z-]+$/u.test(v));
    for (const v of r.from) if (literal(v)) count(v, r.directionality !== 'forward_only');
    for (const v of r.to) if (literal(v)) count(v, true);
  }
  for (const b of graph.bindings) for (const ref of b.lexicalRefs) if (ref.startsWith('symbol:')) count(ref.slice('symbol:'.length), false);
  for (const m of RENDER_MARKERS) count(m, true);
  return stats;
}

const utf8Compare = (a: string, b: string) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const byFrequency = (stats: Map<string, AtomStats>) => (a: string, b: string) => {
  const sa = stats.get(a)!;
  const sb = stats.get(b)!;
  return sb.output - sa.output || sb.total - sa.total || utf8Compare(a, b);
};
const prefixDigest = (atoms: readonly string[], size: number) => createHash('sha256').update(JSON.stringify(atoms.slice(0, size))).digest('hex');

/** Semantic identity of the registry, independent of its binary section layout. */
export function symbolRegistryDigest(registry: Pick<SymbolRegistry, 'atoms' | 'tombstones' | 'generations'>): string {
  const generation = registry.generations[registry.generations.length - 1]?.generation ?? 0;
  return createHash('sha256').update(JSON.stringify({
    schemaVersion: '1', generation, atoms: [...registry.atoms], tombstones: [...registry.tombstones].sort((a, b) => a - b)
  })).digest('hex');
}

export function initialRegistry(stats: Map<string, AtomStats>): SymbolRegistry {
  const atoms = [...stats.keys()].sort(byFrequency(stats));
  return {
    schemaVersion: '1', kind: 'japanese-orthography-symbol-registry', owner: 'japanese-orthography#211 B (spec #208 §6)',
    atoms, tombstones: [],
    generations: [{ generation: 1, size: atoms.length, prefixSha256: prefixDigest(atoms, atoms.length), added: atoms.length, tombstoned: 0, reactivated: 0 }]
  };
}

/** Append-only update: new atoms appended (frequency order among themselves), absent atoms tombstoned. */
export function updateRegistry(previous: SymbolRegistry, stats: Map<string, AtomStats>): SymbolRegistry {
  verifyRegistry(previous);
  const known = new Map(previous.atoms.map((atom, i) => [atom, i + 1]));
  const added = [...stats.keys()].filter((atom) => !known.has(atom)).sort(byFrequency(stats));
  const atoms = [...previous.atoms, ...added];
  const wasTombstoned = new Set(previous.tombstones);
  const tombstones = previous.atoms.map((atom, i) => (stats.has(atom) ? null : i + 1)).filter((id): id is number => id !== null);
  const reactivated = [...wasTombstoned].filter((id) => !tombstones.includes(id)).length;
  const newlyTombstoned = tombstones.filter((id) => !wasTombstoned.has(id)).length;
  if (!added.length && !reactivated && !newlyTombstoned) return previous;
  const last = previous.generations[previous.generations.length - 1]!;
  return {
    ...previous, atoms, tombstones,
    generations: [...previous.generations, { generation: last.generation + 1, size: atoms.length, prefixSha256: prefixDigest(atoms, atoms.length), added: added.length, tombstoned: newlyTombstoned, reactivated }]
  };
}

/** Fail-closed invariants of one registry file (append-only history included). */
export function verifyRegistry(registry: SymbolRegistry): void {
  if (registry.kind !== 'japanese-orthography-symbol-registry' || registry.schemaVersion !== '1') throw new Error('unsupported symbol registry');
  const seen = new Set<string>();
  registry.atoms.forEach((atom, i) => {
    if (typeof atom !== 'string' || atom === '') throw new Error(`SymbolId ${i + 1}: empty atom`);
    if ((atomsOf(atom) as string[]).length !== 1) throw new Error(`SymbolId ${i + 1}: ${JSON.stringify(atom)} is not a single orthographic atom`);
    if (seen.has(atom)) throw new Error(`SymbolId ${i + 1}: atom ${atom} already has an id`);
    seen.add(atom);
  });
  for (const id of registry.tombstones) if (!Number.isInteger(id) || id < 1 || id > registry.atoms.length) throw new Error(`tombstone ${id} out of range`);
  if (!registry.generations.length) throw new Error('registry has no generation');
  let size = 0;
  for (const g of registry.generations) {
    if (g.size < size) throw new Error(`generation ${g.generation} shrinks the registry (${g.size} < ${size})`);
    if (g.size > registry.atoms.length) throw new Error(`generation ${g.generation} is larger than the registry`);
    if (prefixDigest(registry.atoms, g.size) !== g.prefixSha256) throw new Error(`generation ${g.generation}: ids 1..${g.size} were remapped or reordered`);
    size = g.size;
  }
  if (size !== registry.atoms.length) throw new Error('atoms beyond the last generation are unrecorded');
}

/** `next` must extend `previous`: same atom for every old id, ids never removed, history kept. */
export function verifyAppendOnly(previous: SymbolRegistry, next: SymbolRegistry): void {
  verifyRegistry(previous);
  verifyRegistry(next);
  if (next.atoms.length < previous.atoms.length) throw new Error('registry shrank');
  previous.atoms.forEach((atom, i) => { if (next.atoms[i] !== atom) throw new Error(`SymbolId ${i + 1} remapped: ${atom} -> ${next.atoms[i]}`); });
  previous.generations.forEach((g, i) => { if (JSON.stringify(next.generations[i]) !== JSON.stringify(g)) throw new Error(`generation ${g.generation} history rewritten`); });
}

export const serializeRegistry = (registry: SymbolRegistry) => {
  const { atoms, ...head } = registry;
  const json = JSON.stringify(head, null, 2);
  const body = `${json.slice(0, json.lastIndexOf('\n}'))},\n  "atoms": [\n`;
  return `${body}${atoms.map((a) => `    ${JSON.stringify(a)}`).join(',\n')}\n  ]\n}\n`;
};

if (process.argv[1]?.endsWith('symbol-registry.ts')) {
  const root = resolve(process.cwd());
  const { graph } = await normalizeAcceptedOrthographySources(root);
  const stats = atomStatistics(withProfileRules(graph));
  const path = resolve(root, SYMBOL_REGISTRY);
  let committed: SymbolRegistry | null = null;
  try { committed = JSON.parse(await readFile(path, 'utf8')) as SymbolRegistry; } catch { committed = null; }
  if (process.argv.includes('--check')) {
    if (!committed) throw new Error(`${SYMBOL_REGISTRY} missing; run npm run generate:symbol-registry`);
    verifyRegistry(committed);
    const next = updateRegistry(committed, stats);
    if (next !== committed) throw new Error(`${SYMBOL_REGISTRY} is behind the accepted knowledge (${next.atoms.length - committed.atoms.length} new atoms / tombstone changes); run npm run generate:symbol-registry`);
    console.log(`symbol registry OK: ${committed.atoms.length} SymbolIds (${committed.tombstones.length} tombstoned), generation ${committed.generations.at(-1)!.generation}`);
  } else {
    const next = committed ? updateRegistry(committed, stats) : initialRegistry(stats);
    if (committed) verifyAppendOnly(committed, next);
    await writeFile(path, serializeRegistry(next));
    console.log(`wrote ${SYMBOL_REGISTRY}: ${next.atoms.length} SymbolIds, generation ${next.generations.at(-1)!.generation}`);
  }
}

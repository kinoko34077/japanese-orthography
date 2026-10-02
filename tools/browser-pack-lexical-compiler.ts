import { createRequire } from 'node:module';
import type { BrowserPackBuild, BrowserPackLayerContext } from './browser-pack-compiler.ts';
import { encodeSection, StringTable } from './browser-pack-encoding.ts';
import type { BrowserPackShardDescriptor } from './browser-pack-model.ts';
import type { JmdictEntry } from './jmdict-intake.ts';
import { lexemeKeys } from './jmdict-lexical-graph.ts';
import type { UniDicSourceSlice } from './lexical-compiler.ts';
import type { OrthographyKnowledgeGraph } from './orthography-knowledge-model.ts';

// BrowserPack v2 lexical layer (#196 B). A lexeme-centric projection of the canonical v2 graph:
//
//   surface-index  surface -> lexeme ids ┐
//   reading-index  reading -> lexeme ids ┴-> lexeme-table (identity, morphology ids)
//                                             ├ lexeme-forms    (written forms + JMdict form tags)
//                                             └ lexeme-readings (modern / historical readings)
//   morphology-table (eager)  dense id -> POS / conjugation type / conjugation form
//
// Both indexes converge on one dense lexeme id space, so a surface, a reading or (later) Ruby evidence
// reach the same lexical identity. Nothing here is new authority: every form/reading row carries the
// canonical fact index it was projected from, and lexical identities are the canonical lexicalRefs.
// Lexeme ids are dense indexes over the sorted lexicalRefs; ambiguity is kept as id lists and never
// collapsed by storage order.

const require = createRequire(import.meta.url);
const { decodeSection } = require('../runtime/browser-pack-binary.js');

export const LEXICAL_INDEX_KINDS = ['surface', 'reading', 'lexeme'] as const;
export const FORM_FLAGS = { listed: 1, ateji: 2, iK: 4, oK: 8, io: 16, rK: 32, sK: 64 } as const;
export const READING_PERIODS = { modern: 1, historical: 2 } as const;
export const MORPHOLOGY_SOURCES = ['jmdict', 'unidic'] as const;

export interface LexicalMorphologyRow {
  readonly source: typeof MORPHOLOGY_SOURCES[number];
  readonly pos: readonly string[];
  readonly conjugationType: string | null;
  readonly conjugationForm: string | null;
}

export interface LexemeModel {
  readonly lexicalIdentity: string;
  readonly headSurface: string | null;
  readonly headReading: string | null;
  readonly morphologyIds: number[];
  readonly forms: Array<{ surface: string; flags: number; factIndex: number }>;
  readonly readings: Array<{ surface: string | null; reading: string; period: number; factIndex: number }>;
}

export interface LexicalModel {
  readonly lexemes: LexemeModel[];
  readonly morphologies: LexicalMorphologyRow[];
  readonly surfaceIndex: Map<string, number[]>;
  readonly readingIndex: Map<string, number[]>;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const morphologyKey = (m: LexicalMorphologyRow) => JSON.stringify([m.source, m.pos, m.conjugationType, m.conjugationForm]);
const katakanaToHiragana = (text: string) => text.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));

/** Parse `lexeme:<surface>/<reading>[#n]` into its headword; other identities have none. */
export function lexemeHead(ref: string): { surface: string | null; reading: string | null } {
  const match = /^lexeme:([^/]*)\/([^#]*)(?:#\d+)?$/u.exec(ref);
  return match ? { surface: match[1]!, reading: match[2]! } : { surface: null, reading: null };
}

/** JMdict sense POS per lexeme (union over senses), keyed by the canonical lexical identity. */
export function jmdictLexemeMorphology(extract: readonly JmdictEntry[]): Map<string, LexicalMorphologyRow[]> {
  const keys = lexemeKeys(extract);
  const out = new Map<string, LexicalMorphologyRow[]>();
  for (const entry of extract) {
    const pos = [...new Set(entry.s.flatMap((s) => s.pos ?? []))].sort(cmp);
    if (pos.length) out.set(`lexeme:${keys.get(entry.seq)!}`, [{ source: 'jmdict', pos, conjugationType: null, conjugationForm: null }]);
  }
  return out;
}

/** UniDic morphology rows bridged to a lexeme only through an exact (base form, reading) headword. */
export function unidicLexemeMorphology(slice: UniDicSourceSlice, lexicalIdentities: ReadonlySet<string>): Map<string, LexicalMorphologyRow[]> {
  const out = new Map<string, LexicalMorphologyRow[]>();
  for (const r of slice.records) {
    const ref = `lexeme:${r.orthBase}/${katakanaToHiragana(r.kanaBase)}`;
    if (!lexicalIdentities.has(ref)) continue;
    const row: LexicalMorphologyRow = {
      source: 'unidic', pos: r.pos.filter((p) => p !== '*'),
      conjugationType: r.cType === '*' ? null : r.cType, conjugationForm: r.cForm === '*' ? null : r.cForm
    };
    out.set(ref, [...(out.get(ref) ?? []), row]);
  }
  return out;
}

export function mergeMorphology(...sources: ReadonlyArray<ReadonlyMap<string, readonly LexicalMorphologyRow[]>>): Map<string, LexicalMorphologyRow[]> {
  const out = new Map<string, LexicalMorphologyRow[]>();
  for (const source of sources) for (const [ref, rows] of source) out.set(ref, [...(out.get(ref) ?? []), ...rows]);
  return out;
}

export function buildLexicalModel(graph: OrthographyKnowledgeGraph, morphology: ReadonlyMap<string, readonly LexicalMorphologyRow[]> = new Map()): LexicalModel {
  const refs = new Set<string>();
  for (const fact of graph.facts) if (fact.kind === 'literal_form' || fact.kind === 'literal_reading') for (const ref of fact.lexicalRefs) refs.add(ref);
  const sorted = [...refs].sort(cmp);
  const idOf = new Map(sorted.map((ref, i) => [ref, i]));
  const morphologies: LexicalMorphologyRow[] = [];
  const morphologyId = new Map<string, number>();
  const lexemes: LexemeModel[] = sorted.map((ref) => {
    const head = lexemeHead(ref);
    const ids = new Set<number>();
    for (const row of morphology.get(ref) ?? []) {
      const key = morphologyKey(row);
      let id = morphologyId.get(key);
      if (id === undefined) { id = morphologies.length; morphologies.push({ ...row, pos: [...row.pos] }); morphologyId.set(key, id); }
      ids.add(id);
    }
    return { lexicalIdentity: ref, headSurface: head.surface, headReading: head.reading, morphologyIds: [...ids].sort((a, b) => a - b), forms: [], readings: [] };
  });
  graph.facts.forEach((fact, factIndex) => {
    for (const ref of fact.lexicalRefs) {
      const lexeme = lexemes[idOf.get(ref) ?? -1];
      if (lexeme === undefined) continue;
      if (fact.kind === 'literal_form' && fact.surface !== undefined) {
        let flags: number = FORM_FLAGS.listed;
        for (const tag of fact.tags ?? []) if (tag in FORM_FLAGS && tag !== 'listed') flags |= FORM_FLAGS[tag as keyof typeof FORM_FLAGS];
        lexeme.forms.push({ surface: fact.surface, flags, factIndex });
      } else if (fact.kind === 'literal_reading' && fact.reading !== undefined) {
        const period = fact.periodRefs?.includes('period:historical-kana') ? READING_PERIODS.historical : READING_PERIODS.modern;
        lexeme.readings.push({ surface: fact.surface ?? null, reading: fact.reading, period, factIndex });
      }
    }
  });
  const surfaceIndex = new Map<string, Set<number>>();
  const readingIndex = new Map<string, Set<number>>();
  const post = (index: Map<string, Set<number>>, key: string, id: number) => { let set = index.get(key); if (!set) index.set(key, (set = new Set())); set.add(id); };
  lexemes.forEach((lexeme, id) => {
    lexeme.forms.sort((a, b) => cmp(a.surface, b.surface) || a.factIndex - b.factIndex);
    lexeme.readings.sort((a, b) => cmp(a.surface ?? '', b.surface ?? '') || a.period - b.period || cmp(a.reading, b.reading) || a.factIndex - b.factIndex);
    for (const form of lexeme.forms) post(surfaceIndex, form.surface, id);
    for (const reading of lexeme.readings) {
      if (reading.surface !== null) post(surfaceIndex, reading.surface, id);
      post(readingIndex, reading.reading, id);
    }
  });
  const finish = (index: Map<string, Set<number>>) => new Map([...index].sort(([a], [b]) => cmp(a, b)).map(([k, ids]) => [k, [...ids].sort((a, b) => a - b)]));
  return { lexemes, morphologies, surfaceIndex: finish(surfaceIndex), readingIndex: finish(readingIndex) };
}

export interface LexicalLayerOptions {
  readonly morphology?: ReadonlyMap<string, readonly LexicalMorphologyRow[]>;
  /** Lexemes per lexeme-table shard. */
  readonly lexemeShardSize?: number;
  /** Approximate encoded bytes per surface/reading index shard (a key is never split). */
  readonly indexShardBudgetBytes?: number;
}

/** Fixed-width shard bound for the lexeme id space, so string order equals numeric order. */
export const lexemeShardBound = (id: number) => String(id).padStart(8, '0');

function partitionIndex(index: Map<string, number[]>, budget: number): Array<Array<[string, number[]]>> {
  const shards: Array<Array<[string, number[]]>> = [];
  let current: Array<[string, number[]]> = [];
  let bytes = 0;
  for (const entry of index) {
    if (bytes >= budget && current.length) { shards.push(current); current = []; bytes = 0; }
    current.push(entry);
    bytes += 12 + entry[0].length * 3 + entry[1].length * 4;
  }
  if (current.length) shards.push(current);
  return shards;
}

/** Pack layer emitting the v2 lexical sections (use with compilerVersion '2'). */
export function lexicalLayer(options: LexicalLayerOptions = {}) {
  return ({ graph, add }: BrowserPackLayerContext): void => {
    const model = buildLexicalModel(graph, options.morphology);
    const directory = { kind: [] as number[], index: [] as number[], from: [] as string[], to: [] as string[], keys: [] as number[], maxKeyLength: [] as number[] };
    const directoryRow = (kind: number, index: number, from: string, to: string, keys: number, maxKeyLength: number) => {
      directory.kind.push(kind); directory.index.push(index); directory.from.push(from); directory.to.push(to); directory.keys.push(keys); directory.maxKeyLength.push(maxKeyLength);
    };

    for (const [kindIndex, kind, index] of [[0, 'surface-index', model.surfaceIndex], [1, 'reading-index', model.readingIndex]] as const) {
      const shards = partitionIndex(index, options.indexShardBudgetBytes ?? 64 * 1024);
      shards.forEach((entries, i) => {
        const shard: BrowserPackShardDescriptor = { key: LEXICAL_INDEX_KINDS[kindIndex], index: i, count: shards.length, from: entries[0]![0], to: entries[entries.length - 1]![0] };
        const s = new StringTable();
        const keyIds = entries.map(([key]) => s.id(key));
        add(kind, encodeSection([
          { name: 'strings', kind: 'strings', values: s.values },
          { name: 'key', kind: 'scalar', values: keyIds },
          { name: 'lexemes', kind: 'list', values: entries.map(([, ids]) => ids) }
        ]), { shard, rowCount: entries.length });
        directoryRow(kindIndex, i, shard.from, shard.to, entries.length, Math.max(...entries.map(([key]) => key.length)));
      });
    }

    const size = options.lexemeShardSize ?? 4096;
    const count = Math.max(1, Math.ceil(model.lexemes.length / size));
    for (let i = 0; i < count; i += 1) {
      const first = i * size;
      const rows = model.lexemes.slice(first, first + size);
      const shard: BrowserPackShardDescriptor = { key: 'lexeme', index: i, count, from: lexemeShardBound(first), to: lexemeShardBound(first + Math.max(rows.length, 1) - 1) };
      const t = new StringTable();
      const tableId = add('lexeme-table', encodeSection([
        { name: 'strings', kind: 'strings', values: t.values },
        // the headword is derived from the identity (`lexemeHead`), never stored twice
        { name: 'identity', kind: 'scalar', values: rows.map((l) => t.id(l.lexicalIdentity)) },
        { name: 'morphology', kind: 'list', values: rows.map((l) => l.morphologyIds) }
      ]), { shard, rowCount: rows.length, requires: ['morphology-table'] });
      const f = new StringTable();
      add('lexeme-forms', encodeSection([
        { name: 'strings', kind: 'strings', values: f.values },
        { name: 'surface', kind: 'list', values: rows.map((l) => l.forms.map((x) => f.id(x.surface))) },
        { name: 'flags', kind: 'list', values: rows.map((l) => l.forms.map((x) => x.flags)) },
        { name: 'factIndex', kind: 'list', values: rows.map((l) => l.forms.map((x) => x.factIndex)) }
      ]), { shard, rowCount: rows.length, requires: [tableId] });
      const r = new StringTable();
      add('lexeme-readings', encodeSection([
        { name: 'strings', kind: 'strings', values: r.values },
        { name: 'surface', kind: 'list', values: rows.map((l) => l.readings.map((x) => r.id(x.surface))) },
        { name: 'reading', kind: 'list', values: rows.map((l) => l.readings.map((x) => r.id(x.reading))) },
        { name: 'period', kind: 'list', values: rows.map((l) => l.readings.map((x) => x.period)) },
        { name: 'factIndex', kind: 'list', values: rows.map((l) => l.readings.map((x) => x.factIndex)) }
      ]), { shard, rowCount: rows.length, requires: [tableId] });
      directoryRow(2, i, shard.from, shard.to, rows.length, 0);
    }

    {
      const s = new StringTable();
      add('morphology-table', encodeSection([
        { name: 'strings', kind: 'strings', values: s.values },
        { name: 'source', kind: 'scalar', values: model.morphologies.map((m) => MORPHOLOGY_SOURCES.indexOf(m.source)) },
        { name: 'pos', kind: 'list', values: model.morphologies.map((m) => m.pos.map((p) => s.id(p))) },
        { name: 'conjugationType', kind: 'scalar', values: model.morphologies.map((m) => s.id(m.conjugationType)) },
        { name: 'conjugationForm', kind: 'scalar', values: model.morphologies.map((m) => s.id(m.conjugationForm)) }
      ]), { rowCount: model.morphologies.length });
    }
    {
      const s = new StringTable();
      add('lexical-directory', encodeSection([
        { name: 'strings', kind: 'strings', values: s.values },
        { name: 'indexKind', kind: 'scalar', values: directory.kind },
        { name: 'index', kind: 'scalar', values: directory.index },
        { name: 'from', kind: 'scalar', values: directory.from.map((v) => s.id(v)) },
        { name: 'to', kind: 'scalar', values: directory.to.map((v) => s.id(v)) },
        { name: 'keys', kind: 'scalar', values: directory.keys },
        { name: 'maxKeyLength', kind: 'scalar', values: directory.maxKeyLength }
      ]), { rowCount: directory.kind.length, requires: ['morphology-table'] });
    }
  };
}

// ---- fail-closed structural verification + reference reader ------------------------------------

const strings = (section: any, column: string, row: number): string | null => {
  const id = section.value(column, row);
  if (id === 0) return null;
  const s = section.string('strings', id);
  if (s === undefined) throw new Error(`dangling string id ${id} in ${column}`);
  return s;
};

/**
 * Decode and check the whole lexical layer: shard coverage, key order, and that every lexeme,
 * morphology and string reference is in range. Throws on the first violation.
 */
export function readLexicalLayer(build: BrowserPackBuild) {
  const sections = build.manifest.sections;
  const decode = (sectionId: string) => {
    const section = sections.find((s) => s.sectionId === sectionId);
    if (!section) throw new Error(`missing section ${sectionId}`);
    return decodeSection(build.files.get(section.path)!);
  };
  const morph = decode('morphology-table');
  const morphologyCount = morph.rowCount('source');
  const morphologies: LexicalMorphologyRow[] = [];
  for (let i = 0; i < morphologyCount; i += 1) {
    const source = MORPHOLOGY_SOURCES[morph.value('source', i)];
    if (source === undefined) throw new Error(`morphology ${i}: unknown source`);
    morphologies.push({
      source, pos: [...morph.list('pos', i)].map((id: number) => { const s = morph.string('strings', id); if (s === undefined) throw new Error(`morphology ${i}: dangling pos string`); return s; }),
      conjugationType: strings(morph, 'conjugationType', i), conjugationForm: strings(morph, 'conjugationForm', i)
    });
  }
  const lexemeShards = sections.filter((s) => s.kind === 'lexeme-table').sort((a, b) => a.shard!.index - b.shard!.index);
  const lexemes: LexemeModel[] = [];
  for (const section of lexemeShards) {
    if (Number(section.shard!.from) !== lexemes.length) throw new Error(`lexeme shard ${section.shard!.index} does not start at id ${lexemes.length}`);
    const table = decodeSection(build.files.get(section.path)!);
    const forms = decode(`lexeme-forms@lexeme/${section.shard!.index}`);
    const readings = decode(`lexeme-readings@lexeme/${section.shard!.index}`);
    const rowCount = table.rowCount('identity');
    if (forms.rowCount('surface') !== rowCount || readings.rowCount('surface') !== rowCount) throw new Error(`lexeme shard ${section.shard!.index}: forms/readings are not aligned`);
    for (let row = 0; row < rowCount; row += 1) {
      const identity = strings(table, 'identity', row);
      if (identity === null) throw new Error(`lexeme ${lexemes.length}: missing identity`);
      const morphologyIds = [...table.list('morphology', row)] as number[];
      for (const id of morphologyIds) if (id >= morphologyCount) throw new Error(`lexeme ${identity}: dangling morphology id ${id}`);
      const formSurfaces = [...forms.list('surface', row)] as number[];
      const formFlags = [...forms.list('flags', row)] as number[];
      const formFacts = [...forms.list('factIndex', row)] as number[];
      const rs = [...readings.list('surface', row)] as number[];
      const rr = [...readings.list('reading', row)] as number[];
      const rp = [...readings.list('period', row)] as number[];
      const rf = [...readings.list('factIndex', row)] as number[];
      if (formFlags.length !== formSurfaces.length || formFacts.length !== formSurfaces.length || rr.length !== rs.length || rp.length !== rs.length || rf.length !== rs.length) throw new Error(`lexeme ${identity}: ragged form/reading rows`);
      const str = (sec: any, id: number) => { const s = sec.string('strings', id); if (s === undefined) throw new Error(`lexeme ${identity}: dangling string id ${id}`); return s as string; };
      const head = lexemeHead(identity);
      lexemes.push({
        lexicalIdentity: identity, headSurface: head.surface, headReading: head.reading, morphologyIds,
        forms: formSurfaces.map((id, i) => ({ surface: str(forms, id), flags: formFlags[i]!, factIndex: formFacts[i]! })),
        readings: rs.map((id, i) => ({ surface: id === 0 ? null : str(readings, id), reading: str(readings, rr[i]!), period: rp[i]!, factIndex: rf[i]! }))
      });
    }
  }
  const readIndex = (kind: 'surface-index' | 'reading-index') => {
    const index = new Map<string, number[]>();
    let previous: string | null = null;
    for (const section of sections.filter((s) => s.kind === kind).sort((a, b) => a.shard!.index - b.shard!.index)) {
      const body = decodeSection(build.files.get(section.path)!);
      for (let row = 0; row < body.rowCount('key'); row += 1) {
        const key = strings(body, 'key', row);
        if (key === null) throw new Error(`${section.sectionId}: missing key`);
        if (previous !== null && cmp(previous, key) >= 0) throw new Error(`${section.sectionId}: keys out of order at ${key}`);
        if (cmp(key, section.shard!.from) < 0 || cmp(key, section.shard!.to) > 0) throw new Error(`${section.sectionId}: key ${key} outside shard range`);
        const ids = [...body.list('lexemes', row)] as number[];
        for (const id of ids) if (id >= lexemes.length) throw new Error(`${section.sectionId}: key ${key} references dangling lexeme id ${id}`);
        index.set(key, ids);
        previous = key;
      }
    }
    return index;
  };
  const surfaceIndex = readIndex('surface-index');
  const readingIndex = readIndex('reading-index');
  return {
    lexemes, morphologies, surfaceIndex, readingIndex,
    lookupSurface: (surface: string) => (surfaceIndex.get(surface) ?? []).map((id) => ({ lexemeId: id, ...lexemes[id]! })),
    lookupReading: (reading: string) => (readingIndex.get(reading) ?? []).map((id) => ({ lexemeId: id, ...lexemes[id]! }))
  };
}

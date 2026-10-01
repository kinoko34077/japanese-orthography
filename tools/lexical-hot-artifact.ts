import type { EntityGraph } from './lexical-entity-graph.ts';

// Phase 4.8G hot runtime projection (#139): the minimum needed at runtime for lexical span lookup
// and reverse reading-DAG traversal, as interned dense tables. Each column declares the table it
// indexes (`HOT_SCHEMA`); the runtime refuses an artifact whose schema differs, so an index into
// one namespace can never be read as another. Provenance, categories, restrictions and source refs
// stay in the cold compact graph; the hot artifact records the canonical graph hash it came from.

export const HOT_SCHEMA = {
  'lexemes.primaryForm': 'string',
  'lexemes.primaryReading': 'string',
  'lexemes.ordinal': 'count',
  'lexemes.readings': 'string[]',
  'forms.text': 'string',
  'forms.lexemes': 'lexeme[]',
  'readings.text': 'string',
  'readings.lexemes': 'lexeme[]',
  'patterns.from': 'string',
  'patterns.to': 'string',
  'patterns.base': 'pattern|-1',
  'patterns.derivations': 'pattern[]',
  'bindings.symbol': 'string',
  'bindings.modern': 'string',
  'bindings.context': 'string|-1',
  'bindings.patterns': 'pattern[]',
  'bindings.evidence': 'string[]'
} as const;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const strip = (id: string) => id.slice(id.indexOf(':') + 1);

export function buildHotArtifact(lexical: EntityGraph, sino: EntityGraph, provenance: Record<string, unknown>) {
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  const intern = (value: string) => {
    let at = stringIndex.get(value);
    if (at === undefined) { at = strings.length; strings.push(value); stringIndex.set(value, at); }
    return at;
  };
  const lexemeIndex = new Map(lexical.lexemes.map((l, i) => [l.id, i]));
  // LexemeId key = <primary form>/<primary reading>[#n] (4.8C contract), stored as interned parts.
  const keyParts = lexical.lexemes.map((l) => {
    const match = /^(.*)\/([^/#]+)(?:#(\d+))?$/u.exec(strip(l.id));
    if (!match) throw new Error(`unparseable lexeme key ${l.id}`);
    const [, form, reading, ordinal] = match;
    const rebuilt = `${form}/${reading}${ordinal ? `#${ordinal}` : ''}`;
    if (rebuilt !== strip(l.id)) throw new Error(`lexeme key does not round-trip ${l.id}`);
    return [form!, reading!, ordinal ? Number(ordinal) : 0] as const;
  });
  const lexemes = {
    primaryForm: keyParts.map(([form]) => intern(form)),
    primaryReading: keyParts.map(([, reading]) => intern(reading)),
    ordinal: keyParts.map(([, , ordinal]) => ordinal),
    readings: lexical.lexemes.map((l) => l.readings.map((r) => intern(strip(r))))
  };
  const index = (pick: (l: EntityGraph['lexemes'][number]) => string[]) => {
    const map = new Map<string, Set<number>>();
    for (const l of lexical.lexemes) for (const id of pick(l)) {
      const key = strip(id);
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(lexemeIndex.get(l.id)!);
    }
    const keys = [...map.keys()].sort(cmp);
    return { text: keys.map(intern), lexemes: keys.map((k) => [...map.get(k)!].sort((a, b) => a - b)) };
  };
  const forms = index((l) => l.forms);
  const readings = index((l) => l.readings);
  const patternIndex = new Map(sino.convergencePatterns.map((p, i) => [p.id, i]));
  const patterns = {
    from: sino.convergencePatterns.map((p) => intern(strip(p.from))),
    to: sino.convergencePatterns.map((p) => intern(strip(p.to))),
    base: sino.convergencePatterns.map((p) => (p.base ? patternIndex.get(p.base)! : -1)),
    derivations: sino.convergencePatterns.map((p) => (p.derivations ?? []).map((d) => patternIndex.get(d)!))
  };
  const bindings = {
    symbol: sino.bindings.map((b) => intern(strip(b.symbol))),
    modern: sino.bindings.map((b) => intern(strip(b.modern))),
    context: sino.bindings.map((b) => (b.context === null ? -1 : intern(strip(strip(b.context))))),
    patterns: sino.bindings.map((b) => b.patterns.map((p) => patternIndex.get(p)!)),
    evidence: sino.bindings.map((b) => b.evidence.map((e) => intern(strip(e))))
  };
  return {
    schemaVersion: '1',
    kind: 'japanese-orthography-lexical-hot-runtime',
    schema: HOT_SCHEMA,
    provenance,
    strings,
    lexemes,
    forms,
    readings,
    patterns,
    bindings
  };
}

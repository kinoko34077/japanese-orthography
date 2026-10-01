import { JMDICT_INTAKE_DIR, jmdictSourceLocalRef, type JmdictAccounting, type JmdictEntry } from './jmdict-intake.ts';
import { buildEntityGraph, type EntityGraph, type RawEntityGraph } from './lexical-entity-graph.ts';

// Phase 4.8C: compile the pinned JMdict 4.8A extract into the typed lexical entity graph.
//
// Mapping contract (snapshot-scoped, explicit):
//   LexemeId  = lexeme:<primary form>/<primary reading>   (primary = first keb, else first reb)
//               + `#<n>` when several entries share that pair; n ranks those entries by ent_seq.
//   FormId    = form:<keb>          ReadingPathId = reading-path:<reb>  (whole-word reading atom)
//   CategoryId= category:jmdict-<pos|misc|field|dial>:<entity name>
//   sourceRefs= jmdict:<created>:seq:<ent_seq>   (provenance only)
// Mapped into the hot graph: keb, reb, re_restr, re_nokanji, sense pos/misc/field/dial (union).
// Retained cold (by sourceRef into the committed 4.8A extract): ke_inf, ke_pri, re_inf, re_pri,
// stagk, stagr and per-sense structure. Nothing in the extract is dropped without a disposition.

export const JMDICT_GRAPH_SOURCE_KEY = 'jmdict-2026-10-01';
export const JMDICT_GRAPH_DISPOSITION = {
  'entry/ent_seq': 'sourceRef',
  'entry/k_ele/keb': 'form',
  'entry/r_ele/reb': 'reading',
  'entry/r_ele/re_restr': 'restriction',
  'entry/r_ele/re_nokanji': 'restriction',
  'entry/sense/pos': 'category',
  'entry/sense/misc': 'category',
  'entry/sense/field': 'category',
  'entry/sense/dial': 'category',
  'entry/k_ele/ke_inf': 'cold',
  'entry/k_ele/ke_pri': 'cold',
  'entry/r_ele/re_inf': 'cold',
  'entry/r_ele/re_pri': 'cold',
  'entry/sense/stagk': 'cold',
  'entry/sense/stagr': 'cold'
} as const;

export function lexemeKeys(extract: readonly JmdictEntry[]): Map<number, string> {
  const groups = new Map<string, number[]>();
  for (const entry of extract) {
    const pair = `${entry.k?.[0]?.t ?? entry.r[0]!.t}/${entry.r[0]!.t}`;
    const list = groups.get(pair) ?? [];
    list.push(entry.seq);
    groups.set(pair, list);
  }
  const keys = new Map<number, string>();
  for (const [pair, seqs] of groups) {
    seqs.sort((a, b) => a - b);
    seqs.forEach((seq, i) => keys.set(seq, seqs.length === 1 ? pair : `${pair}#${i + 1}`));
  }
  return keys;
}

export function compileJmdictLexicalGraph(extract: readonly JmdictEntry[], accounting: JmdictAccounting): EntityGraph {
  for (const path of Object.keys(accounting.elements)) {
    const field = accounting.elements[path]!;
    if (field.disposition !== 'included') continue;
    if (/^entry\/(k_ele|r_ele|sense)$/.test(path)) continue;
    if (!(path in JMDICT_GRAPH_DISPOSITION)) throw new Error(`no lexical-graph disposition for ${path}`);
  }
  const keys = lexemeKeys(extract);
  const raw: RawEntityGraph = {
    sources: [{ key: JMDICT_GRAPH_SOURCE_KEY, sourceClass: `pinned-snapshot:${JMDICT_INTAKE_DIR}` }],
    evidence: [], contexts: [], patterns: [], bindings: [], morphemes: [], relations: [],
    lexemes: [], restrictions: []
  };
  for (const entry of extract) {
    const key = keys.get(entry.seq)!;
    const categories = new Set<string>();
    for (const sense of entry.s) {
      for (const kind of ['pos', 'misc', 'field', 'dial'] as const) for (const tag of sense[kind] ?? []) categories.add(`jmdict-${kind}:${tag}`);
    }
    raw.lexemes.push({
      key,
      forms: (entry.k ?? []).map((k) => k.t),
      readings: entry.r.map((r) => ({ path: [r.t] })),
      categories: [...categories].sort(),
      sourceRefs: [jmdictSourceLocalRef(accounting.createdDate, entry.seq)]
    });
    for (const r of entry.r) {
      if (r.nokanji) raw.restrictions!.push({ lexeme: key, reading: [r.t], forms: [] });
      else if (r.restr?.length) raw.restrictions!.push({ lexeme: key, reading: [r.t], forms: r.restr });
    }
  }
  return buildEntityGraph(raw);
}

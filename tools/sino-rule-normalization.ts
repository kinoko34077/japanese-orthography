import type { OrthographyKnowledgeGraph, OrthographyRule } from './orthography-knowledge-model.ts';
import { projectSinoDag, type SinoComponentRelation } from './sino-dag-projection.ts';
import type { EntityGraph } from './lexical-entity-graph.ts';

// ARCH-V2 D (#168): the 字音 in-word derivation mechanisms of the accepted Phase-4.6E runtime
// (relationForms) as named first-class v2 rules. Their character tables live in the rule objects,
// and derivation is computed from those rules, so the mechanisms exist once instead of being
// re-encoded per word. No 呉音/漢音 class gate is modelled: no source-backed class model exists.

const MECHANISM_PROVENANCE = {
  sourceRefs: ['derivation/phase46e-sino-conventions'],
  evidenceRefs: ['runtime/historical-sino-runtime.js#relationForms', 'japanese-orthography#91']
};

export const SINO_MECHANISM_RULES: readonly OrthographyRule[] = [
  {
    id: 'rule:sino-mech:stem-modernization', class: 'orthographic', directionality: 'forward_only', lossiness: 'contextual',
    from: ['ゐ', 'ゑ', 'を', 'ぢ', 'づ', 'くゎ', 'ぐゎ'], to: ['い', 'え', 'お', 'じ', 'ず', 'か', 'が'], dependencies: [],
    predicate: { channel: 'reading', scope: 'sino-component', side: 'modern', initialOnly: ['くゎ', 'ぐゎ'] }, ...MECHANISM_PROVENANCE
  },
  {
    id: 'rule:sino-mech:coda-gemination', class: 'phonological', directionality: 'forward_infer_reverse', lossiness: 'many_to_one',
    from: ['く', 'き', 'ち', 'つ'], to: ['っ'], dependencies: [],
    predicate: { channel: 'reading', scope: 'sino-component', position: 'final', side: 'modern' }, ...MECHANISM_PROVENANCE
  },
  {
    id: 'rule:sino-mech:fu-gemination', class: 'phonological', directionality: 'forward_infer_reverse', lossiness: 'contextual',
    from: ['ふ'], to: ['っ'], dependencies: ['rule:sino-mech:stem-modernization'],
    predicate: { channel: 'reading', scope: 'sino-component', position: 'final', side: 'both', modernStem: 'rule:sino-mech:stem-modernization' }, ...MECHANISM_PROVENANCE
  },
  {
    id: 'rule:sino-mech:voicing', class: 'phonological', directionality: 'reverse_traversable', lossiness: 'lossless',
    from: ['か', 'き', 'く', 'け', 'こ', 'さ', 'し', 'す', 'せ', 'そ', 'た', 'ち', 'つ', 'て', 'と', 'は', 'ひ', 'ふ', 'へ', 'ほ'],
    to: ['が', 'ぎ', 'ぐ', 'げ', 'ご', 'ざ', 'じ', 'ず', 'ぜ', 'ぞ', 'だ', 'ぢ', 'づ', 'で', 'ど', 'ば', 'び', 'ぶ', 'べ', 'ぼ'],
    dependencies: ['rule:sino-mech:coda-gemination', 'rule:sino-mech:fu-gemination'],
    predicate: { channel: 'reading', scope: 'sino-component', position: 'initial', side: 'both' }, ...MECHANISM_PROVENANCE
  },
  {
    id: 'rule:sino-mech:semi-voicing', class: 'phonological', directionality: 'reverse_traversable', lossiness: 'lossless',
    from: ['は', 'ひ', 'ふ', 'へ', 'ほ'], to: ['ぱ', 'ぴ', 'ぷ', 'ぺ', 'ぽ'],
    dependencies: ['rule:sino-mech:coda-gemination', 'rule:sino-mech:fu-gemination'],
    predicate: { channel: 'reading', scope: 'sino-component', position: 'initial', side: 'both' }, ...MECHANISM_PROVENANCE
  }
];

const mechanismName = (rule: OrthographyRule) => rule.id.slice('rule:sino-mech:'.length);
const table = (rule: OrthographyRule) => new Map(rule.from.map((f, i) => [f, rule.to[i]!]));

export interface SinoVariant { modern: string; historical: string; mechanism: string | null }

/** In-word surface variants of one table pair, computed from the mechanism rules. */
export function deriveSinoVariants(modern: string, historical: string, rules: readonly OrthographyRule[] = SINO_MECHANISM_RULES): SinoVariant[] {
  const byId = new Map(rules.map((r) => [mechanismName(r), r]));
  const stem = byId.get('stem-modernization')!;
  const stemTable = table(stem);
  const initialOnly = new Set((stem.predicate?.initialOnly as string[] | undefined) ?? []);
  const modernizeStem = (value: string) => {
    let out = Array.from(value, (c) => (initialOnly.has(c) ? c : stemTable.get(c) ?? c)).join('');
    for (const prefix of initialOnly) if (out.startsWith(prefix)) out = stemTable.get(prefix)! + out.slice(prefix.length);
    return out;
  };
  const coda = byId.get('coda-gemination')!;
  const fu = byId.get('fu-gemination')!;
  const base: SinoVariant[] = [{ modern, historical, mechanism: null }];
  if (coda.from.includes(modern.slice(-1))) base.push({ modern: `${modern.slice(0, -1)}${coda.to[0]}`, historical, mechanism: mechanismName(coda) });
  if (fu.from.includes(historical.slice(-1))) {
    const stemPart = historical.slice(0, -1);
    base.push({ modern: `${modernizeStem(stemPart)}${fu.to[0]}`, historical: `${stemPart}${fu.to[0]}`, mechanism: mechanismName(fu) });
  }
  const out = [...base];
  for (const v of base) {
    for (const rule of [byId.get('voicing')!, byId.get('semi-voicing')!]) {
      const map = table(rule);
      const m0 = map.get(v.modern[0]!);
      const h0 = map.get(v.historical[0]!);
      if (m0 && h0) out.push({ modern: m0 + v.modern.slice(1), historical: h0 + v.historical.slice(1), mechanism: v.mechanism ? `${v.mechanism}+${mechanismName(rule)}` : mechanismName(rule) });
    }
  }
  return out;
}

/** Component relations (character, modern, context -> historical readings) read from v2 bindings. */
export function sinoRelationsFromKnowledge(graph: OrthographyKnowledgeGraph): SinoComponentRelation[] {
  const rules = new Map(graph.rules.map((r) => [r.id, r]));
  const rows = new Map<string, SinoComponentRelation>();
  for (const binding of graph.bindings) {
    if (!binding.id.startsWith('binding:sino:')) continue;
    const rule = rules.get(binding.ruleId)!;
    // Reading-class identity rows are compiled into the BrowserPack's compact
    // applicability index. They are not historical-kana table relations and
    // must not expand the accepted 4.6E DAG projection.
    if (binding.sourceRefs.includes('phase46e-sino-reading-class')) continue;
    const character = binding.lexicalRefs.find((ref) => ref.startsWith('symbol:'))!.slice('symbol:'.length);
    const usage = binding.contextRefs?.find((ref) => ref.startsWith('context:usage:'));
    const context = usage ? usage.slice('context:usage:'.length) : null;
    const key = JSON.stringify([character, rule.to[0], context]);
    const row = rows.get(key) ?? { character, modernReading: rule.to[0]!, context, historicalReadings: [], evidenceRefs: [] };
    row.historicalReadings = [...new Set([...row.historicalReadings, rule.from[0]!])].sort();
    row.evidenceRefs = [...new Set([...row.evidenceRefs, ...binding.evidenceRefs])].sort();
    rows.set(key, row);
  }
  return [...rows.values()];
}

/** The 4.8 字音 DAG as a projection of the v2 knowledge graph. */
export function projectSinoDagFromKnowledge(graph: OrthographyKnowledgeGraph, sourceId: string): EntityGraph {
  return projectSinoDag(sinoRelationsFromKnowledge(graph), sourceId);
}

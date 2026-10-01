import type { OrthographyKnowledgeGraph, OrthographyRule } from './orthography-knowledge-model.ts';

// ARCH-V2 E (#169): kana / orthographic presentation conventions as first-class v2 rules,
// executed by the shared projection core. Mergers are lossy forward modernization only (no inverse
// rules); presentation conventions are gated by explicit policy flags; context-dependent
// conventions (iteration, script mapping) are named mechanisms of the projection core.

export const KANA_CONVENTIONS_SOURCE = 'derivation/kana-conventions';
const provenance = (evidence: string[]) => ({ sourceRefs: [KANA_CONVENTIONS_SOURCE], evidenceRefs: evidence });
const GENDAI_KANAZUKAI = 'naikaku-kokuji-1986-gendai-kanazukai';

export const KANA_CONVENTION_RULES: readonly OrthographyRule[] = [
  // 四つ仮名 merger: modern projection only; the fine-grained predecessor survives in retainedDistinctions
  { id: 'rule:kana:yotsugana-di', class: 'orthographic', directionality: 'forward_infer_reverse', lossiness: 'many_to_one', from: ['ぢ', 'じ'], to: ['じ'], dependencies: [], predicate: { channel: 'reading', period: 'modern' }, ...provenance([GENDAI_KANAZUKAI]) },
  { id: 'rule:kana:yotsugana-du', class: 'orthographic', directionality: 'forward_infer_reverse', lossiness: 'many_to_one', from: ['づ', 'ず'], to: ['ず'], dependencies: [], predicate: { channel: 'reading', period: 'modern' }, ...provenance([GENDAI_KANAZUKAI]) },
  // ゐ / ゑ modernization from an already-established historical state (never applied in reverse)
  { id: 'rule:kana:wi-modernization', class: 'orthographic', directionality: 'forward_infer_reverse', lossiness: 'many_to_one', from: ['ゐ', 'い'], to: ['い'], dependencies: [], predicate: { channel: 'reading', period: 'modern' }, ...provenance([GENDAI_KANAZUKAI]) },
  { id: 'rule:kana:we-modernization', class: 'orthographic', directionality: 'forward_infer_reverse', lossiness: 'many_to_one', from: ['ゑ', 'え'], to: ['え'], dependencies: [], predicate: { channel: 'reading', period: 'modern' }, ...provenance([GENDAI_KANAZUKAI]) },
  // small/full sokuon rendering: only when the policy enables it AND the same historical representation is asserted
  { id: 'rule:render:full-size-sokuon', class: 'render', directionality: 'forward_only', lossiness: 'lossless', from: ['っ', 'ッ'], to: ['つ', 'ツ'], dependencies: [], predicate: { channel: 'surface', policyFlags: ['fullSizeSokuon', 'sameHistoricalRepresentation'] }, ...provenance(['japanese-orthography#105']) },
  // script folding / rendering where script is non-lexical
  { id: 'rule:render:script-fold-hiragana', class: 'render', directionality: 'forward_only', lossiness: 'many_to_one', from: ['katakana', 'hiragana'], to: ['hiragana'], dependencies: [], predicate: { channel: 'surface', mechanism: 'script-fold-hiragana', policyFlags: ['scriptFoldable'] }, ...provenance(['japanese-orthography#105']) },
  { id: 'rule:render:script-katakana', class: 'render', directionality: 'reverse_traversable', lossiness: 'lossless', from: ['hiragana'], to: ['katakana'], dependencies: [], predicate: { channel: 'surface', mechanism: 'script-render-katakana', policyFlags: ['renderKatakana'] }, ...provenance(['japanese-orthography#105']) },
  // iteration marks: expanded canonical form <-> rendered marks
  { id: 'rule:render:iteration-expand', class: 'render', directionality: 'reverse_traversable', lossiness: 'lossless', from: ['ゝ', 'ゞ', 'ヽ', 'ヾ', '々'], to: ['expanded'], dependencies: [], predicate: { channel: 'surface', mechanism: 'iteration-expand', policyFlags: ['expandIterationMarks'] }, ...provenance(['japanese-orthography#105']) },
  { id: 'rule:render:iteration-marks', class: 'render', directionality: 'reverse_traversable', lossiness: 'lossless', from: ['expanded'], to: ['ゝ', 'ゞ', 'ヽ', 'ヾ', '々'], dependencies: ['rule:render:iteration-expand'], predicate: { channel: 'surface', mechanism: 'iteration-render', policyFlags: ['renderIterationMarks'] }, ...provenance(['japanese-orthography#105']) },
  { id: 'rule:render:span-iteration-expand', class: 'render', directionality: 'reverse_traversable', lossiness: 'lossless', from: ['〳〵'], to: ['expanded-span'], dependencies: [], predicate: { channel: 'surface', mechanism: 'span-iteration-expand', policyFlags: ['expandSpanIteration'] }, ...provenance(['japanese-orthography#105']) },
  { id: 'rule:render:span-iteration-marks', class: 'render', directionality: 'reverse_traversable', lossiness: 'lossless', from: ['expanded-span'], to: ['〳〵'], dependencies: ['rule:render:span-iteration-expand'], predicate: { channel: 'surface', mechanism: 'span-iteration-render', policyFlags: ['renderSpanIteration'] }, ...provenance(['japanese-orthography#105']) }
];

/** Minimal knowledge graph holding only the kana conventions (used by the compatibility wrappers). */
export function kanaConventionGraph(): OrthographyKnowledgeGraph {
  return {
    schemaVersion: '2',
    kind: 'japanese-orthography-knowledge-graph',
    lexicalNamespaceId: 'kana-conventions',
    sources: [{ sourceId: KANA_CONVENTIONS_SOURCE }],
    facts: [],
    rules: KANA_CONVENTION_RULES.map((rule) => structuredClone(rule)),
    bindings: [],
    dispositions: []
  };
}

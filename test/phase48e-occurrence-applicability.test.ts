import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import type { NormalizedOrthographyRelation } from '../tools/normalized-relation-model.ts';
import { resolveProductiveOrthography, type LexicalOccurrenceContext } from '../tools/productive-orthography.ts';
import { lexicalOccurrenceContext, loadLexicalSpanAnalyzer } from '../tools/lexical-span-analysis.ts';

const analyzer = await loadLexicalSpanAnalyzer(process.cwd());
const contextFor = (text: string) => lexicalOccurrenceContext(analyzer.analyze(text)) as LexicalOccurrenceContext;

function relation(id: string, from: string, to: string, extra: Record<string, unknown> = {}): NormalizedOrthographyRelation {
  return {
    id, relationKind: 'mapping', channel: 'surface', applicationMode: 'substring_productive',
    fromForms: [from], toForms: [to], basis: 'source_exact', evidenceRefs: [`test:${id}`], ...extra
  } as NormalizedOrthographyRelation;
}
const bengo = relation('span:bengo', '弁護', '辯護');

async function runtime() {
  const sandbox: Record<string, any> = {};
  sandbox.globalThis = sandbox;
  for (const file of ['runtime/occurrence-arbitration.js', 'runtime/productive-relation-runtime.js']) {
    vm.runInNewContext(await readFile(file, 'utf8'), sandbox, { filename: file });
  }
  return sandbox.ProductiveRelationRuntime;
}
const graphOf = (relations: NormalizedOrthographyRelation[]) => ({ schemaVersion: '1', kind: 'normalized_orthography_graph', lexicalNamespaceId: 'test', sources: [], relations });

test('lexical 弁護 components transform inside 国選弁護士 / 弁護人 / 弁護団', () => {
  for (const [input, expected] of [['国選弁護士', '国選辯護士'], ['弁護人', '辯護人'], ['弁護団', '辯護団'], ['弁護士', '辯護士']] as const) {
    const result = resolveProductiveOrthography(input, [bengo], { lexical: contextFor(input) });
    assert.equal(result.output, expected, input);
    assert.deepEqual(result.appliedRules.map((r) => r.relationId), ['span:bengo']);
  }
});

test('勘弁護衛 does not transform through an accidental raw 弁護 substring', () => {
  const lexical = contextFor('勘弁護衛');
  // every optimal analysis is 勘弁 + 護衛: no optimal edge starts or ends at offset 3
  const { edges } = (lexical as { dag: { edges: { start: number; end: number; internal: number[] }[] } }).dag;
  assert.ok(edges.every((e) => e.start !== 3 && e.end !== 3 && !e.internal.includes(3)));
  const result = resolveProductiveOrthography('勘弁護衛', [bengo], { lexical });
  assert.equal(result.output, '勘弁護衛');
  assert.deepEqual(result.blockedRules.map((b) => [b.relationId, b.start, b.end, b.reason]), [['span:bengo', 1, 3, 'crosses_lexical_boundary']]);
  // accepted Phase-4.7 behaviour without lexical evidence is unchanged
  assert.equal(resolveProductiveOrthography('勘弁護衛', [bengo]).output, '勘辯護衛');
  // an explicitly retained `anywhere` relation still applies
  assert.equal(resolveProductiveOrthography('勘弁護衛', [relation('span:bengo-any', '弁護', '辯護', { applicability: 'anywhere' })], { lexical }).output, '勘辯護衛');
});

test('shifted AB / BC overlap is visible to arbitration and never resolved by input order', () => {
  const ab = relation('t:AB', 'AB', 'X');
  const bc = relation('t:BC', 'BC', 'Y');
  const plain = resolveProductiveOrthography('ABC', [ab, bc]);
  assert.equal(plain.output, 'ABC');
  assert.deepEqual(plain.segments.map((s) => [s.input, s.basis]), [['ABC', 'unresolved']]);
  assert.deepEqual(plain.blockedRules.map((b) => `${b.relationId}:${b.reason}`).sort(), ['t:AB:unresolved_shifted_overlap', 't:BC:unresolved_shifted_overlap']);
  assert.deepEqual(resolveProductiveOrthography('ABC', [bc, ab]), plain);
  // lexical evidence A | BC selects BC and blocks AB with a traceable reason
  const lexical: LexicalOccurrenceContext = { paths: [{ boundaries: [0, 1, 3], units: [[0, 1], [1, 3]] }] };
  const decided = resolveProductiveOrthography('ABC', [ab, bc], { lexical });
  assert.equal(decided.output, 'AY');
  assert.deepEqual(decided.blockedRules.map((b) => `${b.relationId}:${b.reason}`), ['t:AB:crosses_lexical_boundary']);
  // competing analyses keep the region unresolved
  const split: LexicalOccurrenceContext = { paths: [{ boundaries: [0, 1, 3], units: [] }, { boundaries: [0, 2, 3], units: [] }] };
  const undecided = resolveProductiveOrthography('ABC', [ab, bc], { lexical: split });
  assert.equal(undecided.output, 'ABC');
  assert.ok(undecided.blockedRules.every((b) => b.reason === 'ambiguous_lexical_boundary'));
  // a longer covering match wins over a shifted shorter one deterministically
  assert.equal(resolveProductiveOrthography('ABCD', [ab, relation('t:BCD', 'BCD', 'Z')]).output, 'AZ');
});

test('same-start longest match stays deterministic', () => {
  const result = resolveProductiveOrthography('AB', [relation('t:A', 'A', 'a'), relation('t:AB', 'AB', 'X')]);
  assert.equal(result.output, 'X');
  assert.deepEqual(result.blockedRules.map((b) => `${b.relationId}:${b.reason}`), ['t:A:shadowed_by_longer_match']);
});

test('lexicalIdentity constraints execute against the analysed lexeme', () => {
  const lexical = contextFor('弁護士');
  const right = relation('span:bengo-id', '弁護', '辯護', { lexicalIdentity: 'lexeme:弁護/べんご', applicability: 'whole_lexeme' });
  const wrong = relation('span:bengo-other', '弁護', '辯護', { lexicalIdentity: 'lexeme:弁明/べんめい', applicability: 'whole_lexeme' });
  assert.equal(resolveProductiveOrthography('弁護士', [right], { lexical }).output, '辯護士');
  const blocked = resolveProductiveOrthography('弁護士', [wrong], { lexical });
  assert.equal(blocked.output, '弁護士');
  assert.equal(blocked.blockedRules[0]!.reason, 'lexical_identity_mismatch');
});

test('browser/worker runtime arbitrates identically', async () => {
  const Runtime = await runtime();
  const rt = Runtime.createProductiveRelationRuntime(graphOf([bengo, relation('t:AB', 'AB', 'X'), relation('t:BC', 'BC', 'Y')]));
  assert.equal(rt.transform('国選弁護士', { lexical: contextFor('国選弁護士') }).output, '国選辯護士');
  const kanben = rt.transform('勘弁護衛', { lexical: contextFor('勘弁護衛') });
  assert.equal(kanben.output, '勘弁護衛');
  assert.deepEqual(JSON.parse(JSON.stringify(kanben.blockedRules.map((b: any) => b.reason))), ['crosses_lexical_boundary']);
  assert.equal(rt.transform('勘弁護衛').output, '勘辯護衛');
  const abc = rt.transform('ABC');
  assert.equal(abc.output, 'ABC');
  assert.equal(abc.segments[0].basis, 'unresolved');
  assert.equal(rt.transform('ABC', { lexical: { paths: [{ boundaries: [0, 1, 3], units: [] }] } }).output, 'AY');
});

test('applicability is part of the canonical relation contract and fails closed on misuse', async () => {
  const { canonicalizeNormalizedRelation } = await import('../tools/normalized-relation-model.ts');
  assert.equal(canonicalizeNormalizedRelation(relation('a', '弁護', '辯護', { applicability: 'whole_lexeme' })).applicability, 'whole_lexeme');
  assert.throws(() => canonicalizeNormalizedRelation(relation('b', '弁護', '辯護', { applicability: 'sometimes' })), /unknown applicability/);
  assert.throws(() => canonicalizeNormalizedRelation(relation('c', '弁護', '辯護', { applicationMode: 'exact_lexeme', applicability: 'anywhere' })), /requires a productive application mode/);
});

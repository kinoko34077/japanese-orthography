import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { kanaConventionGraph } from '../tools/kana-rule-normalization.ts';
import type { OrthographyKnowledgeGraph } from '../tools/orthography-knowledge-model.ts';
import { projectOrthography, type CanonicalOrthographyState } from '../tools/orthography-projection.ts';
import { restoreOrthography } from '../tools/orthography-restoration.ts';
import { normalizeAcceptedOrthographySources } from '../tools/orthography-source-normalization.ts';

const modern = { period: 'modern' };
const state = (surface: string, reading: string | null, extra: Partial<CanonicalOrthographyState> = {}): CanonicalOrthographyState => ({
  lexicalIdentity: null, surface, reading, morphology: null, factIds: [], retainedDistinctions: {}, ...extra
});
const prov = { sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] };

// kana conventions + a few literal facts (irregular reading / ateji) on top
function fixture(): OrthographyKnowledgeGraph {
  const g = kanaConventionGraph();
  g.sources.push({ sourceId: 'src:fixture' });
  g.facts.push(
    { id: 'fact:literal_reading:今日|けふ|', kind: 'literal_reading', lexicalRefs: ['lexeme:今日/きょう'], surface: '今日', reading: 'けふ', periodRefs: ['period:historical-kana'], ...prov },
    { id: 'fact:form_relation:獨逸|独逸|', kind: 'form_relation', lexicalRefs: ['lexeme:独逸/ドイツ'], surface: '獨逸', target: '独逸', periodRefs: ['period:historical-kana'], ...prov },
    { id: 'fact:literal_reading:鼻血|はなぢ|', kind: 'literal_reading', lexicalRefs: ['lexeme:鼻血/はなぢ'], surface: '鼻血', reading: 'はなぢ', periodRefs: ['period:historical-kana'], ...prov }
  );
  return g;
}

test('retained identity renders the known historical ぢ back after a modern じ projection', () => {
  const projected = projectOrthography(state('鼻血', 'はなぢ'), fixture(), modern);
  assert.equal(projected.state.reading, 'はなじ');
  const restored = restoreOrthography({ observedSurface: '鼻血', observedReading: 'はなじ', lexicalCandidates: [], knownState: projected.state, targetPolicy: modern }, fixture());
  assert.equal(restored.status, 'resolved');
  assert.equal(restored.candidates[0]!.basis, 'retained_identity');
  assert.equal(restored.candidates[0]!.state.reading, 'はなぢ');
});

test('forward agreement keeps only predecessors whose ordinary modernization reproduces the observation', () => {
  const result = restoreOrthography({ observedSurface: '・', observedReading: 'みかずき', lexicalCandidates: [], targetPolicy: modern }, fixture());
  assert.equal(result.status, 'candidates');
  assert.deepEqual(result.candidates.map((c) => c.state.reading).sort(), ['みかずき', 'みかづき']);
  for (const candidate of result.candidates) {
    assert.equal(candidate.basis, 'forward_agreement');
    assert.equal(projectOrthography(candidate.state, fixture(), modern).state.reading, 'みかずき');
  }
  // the hypothesis space never includes a predecessor that modernizes elsewhere
  assert.ok(result.candidates.every((c) => !c.state.reading!.includes('ぢ')));
});

test('bare modern じ without lexical evidence stays ambiguous; evidence narrows it', () => {
  const bare = restoreOrthography({ observedSurface: '鼻血', observedReading: 'はなじ', lexicalCandidates: [], targetPolicy: modern }, kanaConventionGraph());
  assert.equal(bare.status, 'candidates');
  assert.deepEqual(bare.candidates.map((c) => c.state.reading).sort(), ['はなじ', 'はなぢ']);
  const attested = restoreOrthography({ observedSurface: '鼻血', observedReading: 'はなじ', lexicalCandidates: ['lexeme:鼻血/はなぢ'], targetPolicy: modern }, fixture());
  assert.equal(attested.status, 'resolved');
  assert.equal(attested.candidates[0]!.state.reading, 'はなぢ');
  assert.equal(attested.candidates[0]!.basis, 'reverse_traversal');
  assert.deepEqual(attested.candidates[0]!.sourceRefs, ['src:fixture']);
  // a pure identity hypothesis is not presented as certainty
  const unknown = restoreOrthography({ observedSurface: '・', observedReading: 'さくら', lexicalCandidates: [], targetPolicy: modern }, fixture());
  assert.equal(unknown.status, 'unresolved');
});

test('literal irregular reading and ateji resolve through literal facts without a productive rule', () => {
  const g = fixture();
  const kyou = restoreOrthography({ observedSurface: '今日', observedReading: 'きょう', lexicalCandidates: ['lexeme:今日/きょう'], targetPolicy: modern }, g);
  assert.equal(kyou.status, 'resolved');
  assert.equal(kyou.candidates[0]!.state.reading, 'けふ');
  assert.deepEqual(kyou.candidates[0]!.ruleChain, []);
  // without a lexical tie the irregular fact cannot be claimed for an unverifiable reading
  assert.notEqual(restoreOrthography({ observedSurface: '今日', observedReading: 'こんにち', lexicalCandidates: ['lexeme:今日/こんにち'], targetPolicy: modern }, g).candidates[0]?.state.reading, 'けふ');
  const doitsu = restoreOrthography({ observedSurface: '独逸', observedReading: null, lexicalCandidates: [], targetPolicy: modern }, g);
  assert.equal(doitsu.status, 'resolved');
  assert.equal(doitsu.candidates[0]!.state.surface, '獨逸');
  assert.equal(g.rules.some((r) => r.from.includes('獨逸')), false);
});

const real = (await normalizeAcceptedOrthographySources(process.cwd())).graph;

test('学校 restores がくかう from component/reading source evidence', () => {
  const result = restoreOrthography({ observedSurface: '学校', observedReading: 'がっこう', lexicalCandidates: ['lexeme:学校/がっこう'], targetPolicy: modern }, real);
  assert.equal(result.status, 'resolved');
  assert.equal(result.candidates[0]!.state.reading, 'がくかう');
  assert.equal(result.candidates[0]!.basis, 'reverse_traversal');
});

test('法 / ほう stays ambiguous without context; Buddhist context narrows to ほふ', () => {
  const open = restoreOrthography({ observedSurface: '法', observedReading: 'ほう', lexicalCandidates: [], targetPolicy: modern }, real);
  assert.equal(open.status, 'candidates');
  assert.deepEqual(open.candidates.map((c) => c.state.reading).sort(), ['はふ', 'ほふ']);
  assert.ok(open.candidates.every((c) => c.ruleChain.length === 1 && c.basis === 'reverse_traversal'));
  const buddhist = restoreOrthography({ observedSurface: '法', observedReading: 'ほう', lexicalCandidates: [], context: { usage: '仏教用語' }, targetPolicy: modern }, real);
  assert.equal(buddhist.status, 'resolved');
  assert.deepEqual(buddhist.candidates[0]!.ruleChain, ['rule:sino:ほふ>ほう']);
});

test('browser/worker runtime restoration is identical to the TS restoration', async () => {
  const sandbox: Record<string, any> = {};
  sandbox.globalThis = sandbox;
  for (const file of ['runtime/orthography-projection-runtime.js', 'runtime/orthography-restoration-runtime.js']) {
    vm.runInNewContext(await readFile(file, 'utf8'), sandbox, { filename: file });
  }
  const g = fixture();
  for (const query of [
    { observedSurface: '鼻血', observedReading: 'はなじ', lexicalCandidates: [], targetPolicy: modern },
    { observedSurface: '今日', observedReading: 'きょう', lexicalCandidates: ['lexeme:今日/きょう'], targetPolicy: modern },
    { observedSurface: '・', observedReading: 'みかずき', lexicalCandidates: [], targetPolicy: modern }
  ]) {
    assert.equal(JSON.stringify(sandbox.OrthographyRestorationRuntime.restoreOrthography(query, g)), JSON.stringify(restoreOrthography(query, g)));
  }
});

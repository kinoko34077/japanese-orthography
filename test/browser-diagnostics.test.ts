import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { canonicalizeOrthographyKnowledge } from '../tools/orthography-knowledge-model.ts';
import { plannerFixture, plannerPack } from './fixtures/browser-pack-fixture.ts';

const require = createRequire(import.meta.url);
const { planAndTransform } = require('../runtime/browser-span-planner.js');
const { summarize, expandDetail } = require('../runtime/browser-diagnostic-contract.js');
const { createTransformService } = require('../runtime/browser-transform-worker.js');

// extend the shared fixture with a shifted-overlap competition resolved by precedence
const graph = plannerFixture();
const prov = { sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] };
graph.facts.push(
  { id: 'fact:literal_form:円周||', kind: 'literal_form', lexicalRefs: ['lexeme:円周'], surface: '円周', periodRefs: ['period:modern'], ...prov },
  { id: 'fact:form_relation:圓周||円周', kind: 'form_relation', lexicalRefs: [], surface: '圓周', target: '円周', periodRefs: ['period:historical-kana'], ...prov },
  { id: 'fact:literal_reading:溶接|ようせつ|', kind: 'literal_reading', lexicalRefs: ['lexeme:溶接'], surface: '溶接', reading: 'ようせつ', periodRefs: ['period:modern'], ...prov }
);
const { pack } = await plannerPack(canonicalizeOrthographyKnowledge(graph));
const run = async (text: string, profile = 'historical') => { const raw = await planAndTransform(pack, text, profile); return { raw, summary: summarize(raw) }; };

test('unique resolution is green; no-op text has no highlight', async () => {
  const { summary } = await run('溶接する');
  assert.deepEqual(summary.spans.map((s: any) => [s.sourceText, s.certainty, s.authority]), [['溶接', 'unique', 'literal_fact']]);
  assert.equal((await run('ABC と する')).summary.spans.length, 0);
});

test('competition resolved by precedence or source alternatives is orange', async () => {
  // the lexical relation 円周 -> 圓周 competes with the character rule 円 -> 圓 at the same start;
  // same-start longest precedence selects the lexical relation
  const { summary } = await run('円周');
  assert.equal(summary.renderedText, '圓周');
  assert.equal(summary.spans[0].certainty, 'conditional');
  assert.ok(summary.spans[0].reasonCodes.includes('shadowed_by_longer_match'));
});

test('unresolved, conflicting or context-dependent results are red even when nothing changed', async () => {
  for (const text of ['装丁', '台風']) {
    const span = (await run(text)).summary.spans[0];
    assert.equal(span.certainty, 'unresolved', text);
    assert.equal(span.changed, false);
  }
  // red is decided by semantic state: a span the planner left unresolved never turns green
  const { raw } = await run('装丁');
  const forged = { ...raw, spans: [{ ...raw.spans[0], renderedText: '装幀' }] };
  assert.equal(summarize(forged).spans[0].certainty, 'unresolved');
});

test('lazy detail maps back to canonical provenance and equals an eager expansion', async () => {
  const { raw, summary } = await run('溶接と円');
  const lazy = await expandDetail(pack, raw, summary.spans[0].detailRef);
  assert.equal(lazy.acceptedCandidates[0].fact.id, 'fact:form_relation:熔接||溶接');
  assert.deepEqual(lazy.provenance, { sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] });
  assert.deepEqual(lazy.readings.modern, ['ようせつ']);
  assert.ok(lazy.lexicalCandidates.includes('lexeme:溶接'));
  assert.equal(lazy.basis, 'reverse_traversal');
  const rule = await expandDetail(pack, raw, summary.spans[1].detailRef);
  assert.deepEqual(rule.ruleChain, ['rule:char:圓>円']);
  assert.equal(rule.authority, 'source_rule');
  // eager reference: expanding every span up front gives the same payloads
  const eager = await Promise.all(summary.spans.map((s: any) => expandDetail(pack, raw, s.detailRef)));
  assert.deepEqual(eager[0], lazy);
  for (const key of ['lexicalIdentity', 'lexicalCandidates', 'readings', 'morphologyContext', 'basis', 'ruleChain', 'acceptedCandidates', 'rejectedCandidates', 'retainedDistinctions', 'provenance', 'compatibilityAgreement', 'profileEffects', 'reasonCodes']) {
    assert.ok(key in lazy, key);
  }
});

test('rejected candidates carry reason codes in the detail of a conflict', async () => {
  const { raw, summary } = await run('装丁');
  const detail = await expandDetail(pack, raw, summary.spans[0].detailRef);
  assert.equal(detail.rejectedCandidates.length, 2);
  assert.ok(detail.rejectedCandidates.every((c: any) => c.reason === 'conflicting_productive_outputs' && c.fact.sourceCandidate));
});

test('the worker serves summaries and lazy details through the message contract', async () => {
  const service = createTransformService({ openPack: async () => pack });
  const result = await service.handle({ type: 'transform', requestId: 'r1', text: '溶接', profileId: 'historical' });
  assert.equal(result.result.spans[0].certainty, 'unique');
  const detail = await service.handle({ type: 'detail', requestId: 'd1', resultId: 'r1', detailRef: '0' });
  assert.equal(detail.detail.acceptedCandidates[0].fact.id, 'fact:form_relation:熔接||溶接');
  const stale = await service.handle({ type: 'detail', requestId: 'd2', resultId: 'gone', detailRef: '0' });
  assert.equal(stale.type, 'error');
});

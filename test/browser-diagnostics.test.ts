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

const resolverRaw = (unit: any, output: string, renderMode = 'ruby-whole-explicit') => ({
  profileId: 'historical',
  renderedText: output,
  offsetUnit: 'UTF-16',
  renderMode,
  lexicalMatchCount: 1,
  units: [],
  spans: [{
    detailRef: '0', start: 0, end: 2, renderedStart: 0, renderedEnd: output.length,
    sourceText: '男女', renderedText: output, state: 'applied', reasons: [], blocked: [], contextual: [],
    winners: [{ origin: 'resolver', output, authority: 'source_rule', unit, relationFacts: [] }]
  }]
});

const resolverUnit = (overrides: any = {}) => ({
  kind: 'resolved',
  lexicalIdentity: 'lexeme:男女/だんじょ',
  lexicalCandidates: [],
  historical: {
    status: 'unknown', route: null, kana: null, basis: null,
    sourceRefs: [], evidenceRefs: [], canonicalIds: [],
    ...overrides.historical
  },
  ...overrides
});

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

test('resolver display winners do not turn unknown history into unique certainty', () => {
  const modernDisplay = resolverRaw(resolverUnit(), '｜男女《だんじょ》');
  const historicalPlain = resolverRaw(resolverUnit(), '男女');
  assert.deepEqual(
    [summarize(modernDisplay).spans[0].certainty, summarize(modernDisplay).spans[0].authority],
    ['unresolved', 'none']
  );
  assert.deepEqual(
    [summarize(historicalPlain).spans[0].certainty, summarize(historicalPlain).spans[0].authority],
    ['unresolved', 'none']
  );
});

test('lexical ambiguity remains conditional even when a historical result is source-backed', () => {
  const unit = resolverUnit({
    kind: 'candidates',
    lexicalIdentity: null,
    lexicalCandidates: [
      { lexicalIdentity: 'lexeme:男女/おとこおんな' },
      { lexicalIdentity: 'lexeme:男女/だんじょ' }
    ],
    historical: {
      status: 'resolved', basis: 'sino_component_reconstruction', route: 'sino', kana: 'だんじょ',
      sourceRefs: ['historical/sino'], evidenceRefs: ['ev:sino'], canonicalIds: ['binding:sino']
    }
  });
  const span = summarize(resolverRaw(unit, '｜男女《だんじょ》')).spans[0];
  assert.equal(span.certainty, 'conditional');
  assert.equal(span.authority, 'source_rule');
});

test('source-backed resolver authority is preserved without a source_rule fallback', () => {
  const unit = resolverUnit({
    historical: {
      status: 'resolved', basis: 'deterministic_identity', route: 'native', kana: 'がくかう',
      sourceRefs: ['historical/identity'], evidenceRefs: ['ev:identity'], canonicalIds: ['identity:學校']
    }
  });
  const span = summarize(resolverRaw(unit, '｜男女《だんじょ》')).spans[0];
  assert.equal(span.certainty, 'unique');
  assert.equal(span.authority, 'source_rule');
});

test('Rule Program candidates retain source authority and branch uncertainty', () => {
  const raw = {
    profileId: 'historical', renderedText: '乙', offsetUnit: 'UTF-16', renderMode: 'plain', lexicalMatchCount: 0, units: [],
    spans: [{
      detailRef: '0', start: 0, end: 1, renderedStart: 0, renderedEnd: 1, sourceText: '甲', renderedText: '乙',
      state: 'applied', reasons: [], blocked: [], contextual: [],
      winners: [{ origin: 'program', output: '乙', ref: 'program:7', programIds: [7], candidate: true }]
    }]
  };
  const span = summarize(raw).spans[0];
  assert.equal(span.certainty, 'conditional');
  assert.equal(span.authority, 'source_rule');
});

test('Rule Program Ruby diagnostics preserve historical unknown and lexical ambiguity', () => {
  const programRaw = (unit: any) => ({
    profileId: 'historical', renderedText: '｜男女《だんじょ》', offsetUnit: 'UTF-16', renderMode: 'ruby-whole-explicit', lexicalMatchCount: 1, units: [],
    spans: [{
      detailRef: '0', start: 0, end: 2, renderedStart: 0, renderedEnd: 9, sourceText: '男女', renderedText: '｜男女《だんじょ》',
      state: 'applied', reasons: [], blocked: [], contextual: [],
      winners: [{ origin: 'program', output: '｜男女《だんじょ》', ref: 'program:7', programIds: [7], candidate: false, unit }]
    }]
  });
  const unknown = resolverUnit({ historical: { status: 'unknown', sourceRefs: [], evidenceRefs: [], canonicalIds: [] } });
  assert.deepEqual(
    [summarize(programRaw(unknown)).spans[0].certainty, summarize(programRaw(unknown)).spans[0].authority],
    ['unresolved', 'none']
  );
  const ambiguous = resolverUnit({
    kind: 'candidates', lexicalIdentity: null,
    lexicalCandidates: [{ lexicalIdentity: 'lexeme:男女/おとこおんな' }, { lexicalIdentity: 'lexeme:男女/だんじょ' }],
    historical: { status: 'resolved', route: 'sino', kana: 'だんじょ', sourceRefs: [], evidenceRefs: ['ev:program'], canonicalIds: ['fact:program'] }
  });
  assert.deepEqual(
    [summarize(programRaw(ambiguous)).spans[0].certainty, summarize(programRaw(ambiguous)).spans[0].authority],
    ['conditional', 'source_rule']
  );
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
  const service = createTransformService({ openPack: async () => pack, executionMode: 'legacy-only' });
  const result = await service.handle({ type: 'transform', requestId: 'r1', text: '溶接', profileId: 'historical' });
  assert.equal(result.result.spans[0].certainty, 'unique');
  const detail = await service.handle({ type: 'detail', requestId: 'd1', resultId: 'r1', detailRef: '0' });
  assert.equal(detail.detail.acceptedCandidates[0].fact.id, 'fact:form_relation:熔接||溶接');
  const stale = await service.handle({ type: 'detail', requestId: 'd2', resultId: 'gone', detailRef: '0' });
  assert.equal(stale.type, 'error');
});

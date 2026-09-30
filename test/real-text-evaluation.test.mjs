import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function loadRuntime() {
  let source = '';
  try { source = await readFile(new URL('../runtime/real-text-evaluation-runtime.js', import.meta.url), 'utf8'); } catch {}
  const sandbox = {};
  sandbox.globalThis = sandbox;
  if (source) vm.runInNewContext(source, sandbox, { filename: 'real-text-evaluation-runtime.js' });
  return sandbox.RealTextEvaluationRuntime;
}

function unit(kind, sourceText, disposition, extra = {}) {
  return {
    kind,
    sourceText,
    sourceSurface: sourceText,
    lexicalIdentity: extra.lexicalIdentity ?? null,
    reading: extra.reading ?? { modernSurface: null, source: 'unknown' },
    historical: {
      route: extra.route ?? null,
      kana: extra.kana ?? null,
      contextualKanji: extra.contextualKanji ?? { status: 'none', target: null, candidates: [], relationIds: [] },
      deterministicKanji: extra.deterministicKanji ?? null,
      disposition,
      surface: extra.surface ?? sourceText,
      evidenceRefs: extra.evidenceRefs ?? []
    },
    evidenceRefs: extra.evidenceRefs ?? []
  };
}

function fakeBundle() {
  const map = new Map([
    ['学校', unit('resolved', '学校', 'AUTO', { lexicalIdentity: 'lemma:school', route: 'historical-sino', kana: 'がくかう', surface: '學校' })],
    ['台風', unit('resolved', '台風', 'AUTO', { lexicalIdentity: 'lemma:taifu', surface: '颱風', contextualKanji: { status: 'resolved', target: '颱風', candidates: ['颱風'], relationIds: ['rel-taifu'] } })],
    ['今日', { ...unit('candidates', '今日', 'CANDIDATES'), lexicalCandidates: [{ lexicalIdentity: 'lemma:today-1' }, { lexicalIdentity: 'lemma:today-2' }] }],
    ['未知語', unit('unresolved', '未知語', 'UNRESOLVED')]
  ]);
  return {
    resolveUnit(text, options = {}) {
      if (options.protected) return unit('protected', text, 'PRESERVE');
      return map.get(text) ?? unit('unresolved', text, 'UNRESOLVED');
    },
    render(result) { return result.historical.surface; }
  };
}

test('evaluates ordered spans while preserving literal gaps and ambiguity', async () => {
  const runtime = await loadRuntime();
  assert.equal(typeof runtime?.createRealTextEvaluator, 'function');
  const evaluator = runtime.createRealTextEvaluator(fakeBundle());
  const result = evaluator.evaluate('学校 と 台風、今日 未知語。', [
    { start: 0, end: 2 },
    { start: 5, end: 7 },
    { start: 8, end: 10 },
    { start: 11, end: 14 }
  ]);

  assert.equal(result.renderedText, '學校 と 颱風、今日 未知語。');
  assert.deepEqual(JSON.parse(JSON.stringify(result.summary)), {
    resolved: 2,
    auto: 2,
    candidates: 1,
    unresolved: 1,
    protectedPreserved: 0,
    literal: 4
  });
  assert.equal(result.offsetUnit, 'utf16-code-unit');
  assert.equal(result.trace[0].lexicalIdentity, 'lemma:school');
  assert.equal(result.trace[2].historical.contextualKanji.status, 'resolved');
  assert.equal(result.trace[4].kind, 'candidates');
  assert.equal(result.trace[4].lexicalCandidates.length, 2);
  assert.equal(result.trace[6].kind, 'unresolved');
});

test('protected spans remain byte-for-byte source text', async () => {
  const runtime = await loadRuntime();
  const evaluator = runtime.createRealTextEvaluator(fakeBundle());
  const result = evaluator.evaluate('学校', [{ start: 0, end: 2, protected: true }]);
  assert.equal(result.renderedText, '学校');
  assert.equal(result.summary.protectedPreserved, 1);
  assert.equal(result.trace[0].kind, 'protected');
});

test('rejects overlapping span plans', async () => {
  const runtime = await loadRuntime();
  const evaluator = runtime.createRealTextEvaluator(fakeBundle());
  assert.throws(() => evaluator.evaluate('学校台風', [{ start: 0, end: 2 }, { start: 1, end: 4 }]), /ordered and non-overlapping/);
});

test('does not invoke renderer for candidate or unresolved units', async () => {
  const runtime = await loadRuntime();
  let renderCalls = 0;
  const bundle = {
    resolveUnit(text) {
      if (text === '今日') return { ...unit('candidates', text, 'CANDIDATES'), lexicalCandidates: [{ lexicalIdentity: 'a' }, { lexicalIdentity: 'b' }] };
      return unit('unresolved', text, 'UNRESOLVED');
    },
    render() {
      renderCalls += 1;
      return 'WRONG';
    }
  };
  const result = runtime.createRealTextEvaluator(bundle).evaluate('今日 未知語', [
    { start: 0, end: 2 },
    { start: 3, end: 6 }
  ]);
  assert.equal(result.renderedText, '今日 未知語');
  assert.equal(renderCalls, 0);
});

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { plannerPack } from './fixtures/browser-pack-fixture.ts';

const { createTransformService } = createRequire(import.meta.url)('../runtime/browser-transform-worker.js');
const { pack } = await plannerPack();

const hasTypedArrayOrFunction = (value: unknown): boolean => {
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || typeof value === 'function') return true;
  if (value && typeof value === 'object') return Object.values(value as object).some(hasTypedArrayOrFunction);
  return false;
};

test('the worker service opens the pack once and serves repeated requests', async () => {
  let opens = 0;
  const service = createTransformService({ openPack: async () => { opens += 1; return pack; } });
  const opened = await service.handle({ type: 'open', requestId: 1 });
  assert.equal(opened.type, 'opened');
  assert.deepEqual(opened.executionModes, ['legacy-only', 'parity', 'vm-authoritative']);
  for (let i = 0; i < 5; i += 1) {
    const reply = await service.handle({ type: 'transform', requestId: 10 + i, text: '溶接する', profileId: 'historical' });
    assert.equal(reply.type, 'result');
    assert.equal(reply.result.renderedText, '熔接する');
  }
  assert.equal(opens, 1);
});

test('only plain compact JSON crosses the worker boundary', async () => {
  const service = createTransformService({ openPack: async () => pack });
  const reply = await service.handle({ type: 'transform', requestId: 1, text: '装丁と溶接と円', profileId: 'historical' });
  assert.equal(hasTypedArrayOrFunction(reply), false);
  assert.deepEqual(structuredClone(reply), reply);
  assert.ok(JSON.stringify(reply).length < 4000);
});

test('failures are reported as messages and the pack can be reopened after a failed open', async () => {
  let attempts = 0;
  const service = createTransformService({ openPack: async () => { attempts += 1; if (attempts === 1) throw new Error('network down'); return pack; } });
  const failed = await service.handle({ type: 'transform', requestId: 1, text: '溶接', profileId: 'historical' });
  assert.deepEqual([failed.type, failed.message], ['error', 'network down']);
  const ok = await service.handle({ type: 'transform', requestId: 2, text: '溶接', profileId: 'historical' });
  assert.equal(ok.result.renderedText, '熔接');
  const unknown = await service.handle({ type: 'nope', requestId: 3 });
  assert.equal(unknown.type, 'error');
});

test('vm-authoritative mode uses the Rule Program result without invoking the legacy adapter', async () => {
  let legacyCalls = 0;
  const vmPack = { ...pack, hasSection: () => true };
  const programRuntime = {
    createBrowserProgramRuntime: async () => ({
      transformText: async () => ({
        candidates: [{ start: 0, end: 1, output: '乙', policy: 'anywhere', origin: 'program', ref: 'program:7', programIds: [7] }],
        contextual: [],
        lexicalMatchCount: 0,
        trace: { executedProgramIds: [7], runs: [{ stage: 'orthographic', direction: 'to-historical', channel: 'surface', start: 0, end: 1, executedProgramIds: [7] }] }
      })
    })
  };
  const adapter = { transformWithResolver: async () => { legacyCalls += 1; throw new Error('legacy adapter must not run'); } };
  const service = createTransformService({ openPack: async () => vmPack, executionMode: 'vm-authoritative', programRuntime, adapter });
  const reply = await service.handle({ type: 'transform', requestId: 'vm', text: '甲', profileId: 'historical', renderMode: 'plain' });
  assert.equal(reply.type, 'result', reply.message);
  assert.equal(reply.result.renderedText, '乙');
  assert.equal(reply.result.programTrace.executedProgramIds[0], 7);
  assert.equal(legacyCalls, 0);
});

test('vm-authoritative mode rejects a pack without required hot sections instead of falling back', async () => {
  const service = createTransformService({ openPack: async () => pack, executionMode: 'vm-authoritative' });
  const reply = await service.handle({ type: 'transform', requestId: 'missing-hot', text: '甲', profileId: 'historical', renderMode: 'plain' });
  assert.equal(reply.type, 'error');
  assert.match(reply.message, /required hot sections are unavailable/);
});

test('parity mode observes one VM scan and never calls traceText as a second execution', async () => {
  const vmPack = { ...pack, hasSection: () => true };
  const programRuntime = {
    createBrowserProgramRuntime: async () => ({
      traceText: () => { throw new Error('traceText must not run in parity mode'); },
      transformText: async () => ({ candidates: [], contextual: [], lexicalMatchCount: 0, trace: { executedProgramIds: [9], runs: [] } })
    })
  };
  const adapter = {
    transformWithResolver: async () => ({
      profileId: 'historical', renderedText: '甲', offsetUnit: 'UTF-16', spans: [], units: []
    })
  };
  const service = createTransformService({ openPack: async () => vmPack, executionMode: 'parity', programRuntime, adapter, lexicalRuntime: { createBrowserLexicalRuntime: () => ({}) } });
  const reply = await service.handle({ type: 'transform', requestId: 'parity', text: '甲', profileId: 'historical', renderMode: 'plain' });
  assert.equal(reply.type, 'result', reply.message);
  assert.equal(reply.result.executionMode, 'parity');
  assert.deepEqual(reply.result.programTrace.executedProgramIds, [9]);
});

test('parity mode compares the legacy rendered output with the assembled VM output', async () => {
  const vmPack = { ...pack, hasSection: () => true };
  const programRuntime = {
    createBrowserProgramRuntime: async () => ({
      transformText: async () => ({
        candidates: [{ start: 0, end: 1, output: '乙', policy: 'anywhere', origin: 'program', ref: 'program:7', programIds: [7] }],
        contextual: [],
        lexicalMatchCount: 0,
        trace: { executedProgramIds: [7], runs: [] }
      })
    })
  };
  const adapter = {
    transformWithResolver: async () => ({
      profileId: 'historical', sourceText: '甲', renderedText: '乙', offsetUnit: 'utf16-code-unit',
      spans: [{ start: 0, end: 1, sourceText: '甲', renderedText: '乙', state: 'applied', reasons: [], winners: [], blocked: [], contextual: [] }],
      units: []
    })
  };
  const service = createTransformService({ openPack: async () => vmPack, executionMode: 'parity', programRuntime, adapter, lexicalRuntime: { createBrowserLexicalRuntime: () => ({}) } });
  const reply = await service.handle({ type: 'transform', requestId: 'parity-compare', text: '甲', profileId: 'historical', renderMode: 'plain' });
  assert.equal(reply.type, 'result', reply.message);
  assert.deepEqual(reply.result.programParity, {
    equivalent: true,
    legacyRenderedText: '乙',
    programRenderedText: '乙',
    legacySpanCount: 1,
    programSpanCount: 1,
    authority: 'legacy'
  });
});

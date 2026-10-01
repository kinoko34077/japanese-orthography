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

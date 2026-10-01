import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { plannerPack } from './fixtures/browser-pack-fixture.ts';

const require = createRequire(import.meta.url);
const { planAndTransform } = require('../runtime/browser-span-planner.js');
const { pack } = await plannerPack();
const run = (text: string, profile = 'historical') => planAndTransform(pack, text, profile);

test('arbitrary mixed text stays stable outside applicable spans', async () => {
  const text = 'ABC 溶接する。123、「円」！';
  const result = await run(text);
  assert.equal(result.renderedText, 'ABC 熔接する。123、「圓」！');
  assert.deepEqual(result.spans.map((s: any) => [s.start, s.end, s.sourceText, s.renderedText, s.state]), [[4, 6, '溶接', '熔接', 'applied'], [14, 15, '円', '圓', 'applied']]);
  for (const s of result.spans) assert.equal(text.slice(s.start, s.end), s.sourceText);
  assert.equal((await run('ABC 123')).renderedText, 'ABC 123');
  assert.equal((await run('')).renderedText, '');
});

test('the modern profile runs the same relations forward', async () => {
  assert.equal((await run('熔接と圓', 'modern')).renderedText, '溶接と円');
});

test('lexical boundaries come from the accepted arbitration: 勘弁護衛 is not rewritten through 弁護', async () => {
  const result = await run('勘弁護衛');
  assert.equal(result.renderedText, '勘弁護衛');
  assert.deepEqual(result.spans, []);
  assert.ok(result.quietlyBlocked.some((b: any) => b.reason === 'crosses_lexical_boundary'));
  assert.equal((await run('弁護')).renderedText, '辯護');
});

test('ambiguity stays explicit and context-dependent relations never apply silently', async () => {
  const soutei = await run('装丁');
  assert.equal(soutei.renderedText, '装丁');
  assert.equal(soutei.spans[0].state, 'unresolved');
  assert.deepEqual(soutei.spans[0].reasons, ['conflicting_productive_outputs']);
  const taifu = await run('台風');
  assert.equal(taifu.renderedText, '台風');
  assert.equal(taifu.spans[0].state, 'context_required');
});

test('profile rules apply only under their profile and only to the exact token', async () => {
  assert.equal((await run('こと', 'kinotch-fixed')).renderedText, 'ヿ');
  assert.equal((await run('ことば', 'kinotch-fixed')).renderedText, 'ことば');
  assert.equal((await run('こと', 'historical')).renderedText, 'こと');
});

test('UTF-16 source and rendered ranges stay UI-safe when lengths change', async () => {
  const result = await run('𠮷円と円', 'historical');
  assert.equal(result.renderedText, '𠮷圓と圓');
  for (const s of result.spans) {
    assert.equal(result.sourceText.slice(s.start, s.end), s.sourceText);
    assert.equal(result.renderedText.slice(s.renderedStart, s.renderedEnd), s.renderedText);
  }
});

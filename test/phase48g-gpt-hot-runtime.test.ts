import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEntityGraph } from '../tools/lexical-entity-graph.ts';
import { createSinoDagRuntime, projectSinoDag } from '../tools/sino-dag-projection.ts';
import { lexemesForFormReading } from '../tools/lexical-historical-join.ts';
import { buildPhase48RuntimeBundle, createPhase48HotRuntime } from '../tools/phase48-hot-runtime.ts';

function lexical() {
  return buildEntityGraph({
    sources: [{ key: 'jmdict-test', sourceClass: 'fixture' }],
    evidence: [], contexts: [], patterns: [], bindings: [], morphemes: [], relations: [],
    lexemes: [
      { key: '装丁/そうてい', forms: ['装丁','装幀','装釘','装訂'], readings: [{ path: ['そうてい'] }], categories: ['noun'], sourceRefs: ['jmdict:test:1'] },
      { key: 'restrict/こう', forms: ['甲','乙'], readings: [{ path: ['こう'] }], categories: [], sourceRefs: ['jmdict:test:2'] }
    ],
    restrictions: [{ lexeme: 'restrict/こう', reading: ['こう'], forms: ['甲'] }]
  });
}

function sino() {
  return projectSinoDag([
    { character: '装', modernReading: 'そう', context: null, historicalReadings: ['さう'], evidenceRefs: ['sou'] },
    { character: '文', modernReading: 'ぶん', context: null, historicalReadings: ['ぶん'], evidenceRefs: ['bun'] },
    { character: '法', modernReading: 'ほう', context: null, historicalReadings: ['はふ'], evidenceRefs: ['law'] },
    { character: '法', modernReading: 'ほう', context: '仏教用語', historicalReadings: ['ほふ'], evidenceRefs: ['buddhist'] }
  ], 'sino-test');
}

const plain = (value: unknown) => JSON.parse(JSON.stringify(value ?? null));

test('hot runtime preserves lexical form+reading restrictions', () => {
  const l = lexical();
  const s = sino();
  const bundle = buildPhase48RuntimeBundle(l, s);
  const hot = createPhase48HotRuntime(bundle.hot);
  assert.deepEqual(hot.lexemesForFormReading('装丁','そうてい'), lexemesForFormReading(l,'装丁','そうてい'));
  assert.deepEqual(hot.lexemesForFormReading('甲','こう'), lexemesForFormReading(l,'甲','こう'));
  assert.deepEqual(hot.lexemesForFormReading('乙','こう'), lexemesForFormReading(l,'乙','こう'));
});

test('hot reading runtime preserves direct/context and word reconstruction semantics', () => {
  const l = lexical();
  const s = sino();
  const bundle = buildPhase48RuntimeBundle(l, s);
  const hot = createPhase48HotRuntime(bundle.hot);
  const canonical = createSinoDagRuntime(s);

  for (const query of [{}, { context: '仏教用語' }]) {
    assert.deepEqual(plain(hot.resolveDirect('法','ほう',query)), plain(canonical.resolveDirect('法','ほう',query)));
    assert.deepEqual(plain(hot.reconstructWord('文法','ぶんぽう',query)), plain(canonical.reconstructWord('文法','ぶんぽう',query)));
  }
  assert.deepEqual(plain(hot.reconstructWord('装丁','そうてい')), plain(canonical.reconstructWord('装丁','そうてい')));
});

test('hot compiler is deterministic and separates provenance into cold projection', () => {
  const a = buildPhase48RuntimeBundle(lexical(), sino());
  const b = buildPhase48RuntimeBundle(lexical(), sino());
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.hot.kind, 'phase48-hot-runtime');
  assert.equal(a.cold.kind, 'phase48-cold-provenance');
  assert.ok(a.cold.lexicalSourceRefs.length > 0);
  assert.ok(a.hot.patterns.length > 0);
  assert.ok(a.hot.bindings.length > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(a.hot), 'utf8') < Buffer.byteLength(JSON.stringify({ lexical: lexical(), sino: sino() }), 'utf8'));
});

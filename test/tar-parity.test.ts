import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTarParityArtifacts, verifyTarParitySourceBlobs } from '../tools/tar-parity.ts';

const artifactsPromise = buildTarParityArtifacts(process.cwd());

test('TAR parity source union is complete and two-origin vocabulary is enforced', async () => {
  verifyTarParitySourceBlobs();
  const { fixture } = await artifactsPromise;

  assert.equal(fixture.accounting.flatRecords, 3438);
  assert.equal(fixture.accounting.structuredRuleObjects, 2279);
  assert.equal(fixture.accounting.structuredSemanticEdges, 2354);
  assert.equal(fixture.accounting.unaccountedFlat, 0);
  assert.equal(fixture.accounting.unaccountedStructured, 0);
  assert.deepEqual(fixture.originVocabulary, ['kinotch', 'tar']);
  assert.deepEqual([...new Set(fixture.records.map((record) => record.origin))], ['tar']);
});

test('TAR parity differential does not overclaim static direct coverage as final runtime parity', async () => {
  const { diff, summary } = await artifactsPromise;
  assert.equal(diff.comparison.mode, 'rule-ir-direct-conservative');
  assert.equal(diff.comparison.finalExecutionParity, false);
  assert.equal(diff.comparison.requiredNextGate, 'runtime-parity');
  assert.deepEqual(summary.comparison, diff.comparison);
});

test('TAR parity fixture preserves the condition-sensitive まま / よう rules', async () => {
  const { fixture } = await artifactsPromise;

  const nounMama = fixture.records.find((record) =>
    record.sourceKind === 'structured'
    && record.from === 'まま'
    && record.expectedOutputs.includes('儘')
  );
  assert.ok(nounMama);
  assert.equal(nounMama.sourceEnabled, true);
  assert.deepEqual(nounMama.conditions, { current: { pos: '名詞', pos1: '非自立' } });

  const adverbMama = fixture.records.find((record) =>
    record.sourceKind === 'structured'
    && record.from === 'まま'
    && record.expectedOutputs.includes('間々')
  );
  assert.ok(adverbMama);
  assert.equal(adverbMama.sourceEnabled, true);
  assert.deepEqual(adverbMama.conditions, { current: { pos: '副詞' } });

  const nounYou = fixture.records.find((record) =>
    record.sourceKind === 'structured'
    && record.from === 'よう'
    && record.expectedOutputs.includes('様')
  );
  assert.ok(nounYou);
  assert.equal(nounYou.sourceEnabled, true);
  assert.deepEqual(nounYou.conditions, { current: { pos: '名詞', pos1: '非自立' } });
});

test('TAR fixture preserves rule type and TAR bracket candidate semantics', async () => {
  const { fixture } = await artifactsPromise;

  const renyou = fixture.records.find((record) =>
    record.sourceKind === 'structured'
    && record.from === '悩み'
    && record.expectedOutputs.includes('悩')
  );
  assert.ok(renyou);
  assert.equal(renyou.ruleType, 'renyou');

  const compound = fixture.records.find((record) =>
    record.sourceKind === 'structured'
    && record.from === '書き出す'
    && record.expectedOutputs.includes('書出す')
  );
  assert.ok(compound);
  assert.equal(compound.ruleType, 'compound');

  const wakaru = fixture.records.find((record) =>
    record.sourceKind === 'structured'
    && record.from === 'わかる'
    && record.rawTo === '[分,解]る'
  );
  assert.ok(wakaru);
  assert.deepEqual(wakaru.expectedOutputs, ['分る', '解る']);
  assert.equal(wakaru.ruleType, 'verb');
});

test('regex source is atomic even when exported from_options is malformed', async () => {
  const { fixture } = await artifactsPromise;
  const regexCases = fixture.records.filter((record) => record.regex);
  assert.equal(regexCases.length, 1);
  assert.equal(regexCases[0]!.from, '(\\d{4})年(\\d{1,2})月(\\d{1,2})日');
  assert.deepEqual(regexCases[0]!.expectedOutputs, ['$1/$2/$3']);
});

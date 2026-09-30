import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadRuntime() {
  let source = '';
  try { source = await readFile('runtime/safe-character-runtime.js', 'utf8'); } catch { /* RED before runtime exists */ }
  const sandbox: Record<string, any> = {};
  sandbox.globalThis = sandbox;
  if (source) vm.runInNewContext(source, sandbox, { filename: 'runtime/safe-character-runtime.js' });
  return sandbox;
}

function minimalSlice() {
  return {
    schemaVersion: '1',
    kind: 'japanese-orthography-safe-character-slice',
    sources: [{ id: 'official-source', kind: 'primary_official', locator: '学(學)' }],
    evidenceRecords: [
      { id: 'ev-gaku', sourceRef: 'official-source', role: 'same-character-form' },
      { id: 'ev-regression', sourceRef: 'official-source', role: 'regression-only' },
      { id: 'ev-ben', sourceRef: 'official-source', role: 'contextual-negative-control' },
      { id: 'ev-tai', sourceRef: 'official-source', role: 'guarded-negative-control' }
    ],
    excludedModernCharacters: ['弁', '台'],
    exclusionRecords: [
      { modern: '弁', reason: 'contextual', evidenceRefs: ['ev-ben'] },
      { modern: '台', reason: 'guarded', evidenceRefs: ['ev-tai'] }
    ],
    mappings: [{
      modern: '学',
      historical: '學',
      evidenceRefs: ['ev-gaku'],
      regressionEvidenceRefs: ['ev-regression']
    }]
  };
}

test('safe-character runtime exposes a copy-safe deterministic map and applies it by code point', async () => {
  const sandbox = await loadRuntime();
  assert.equal(typeof sandbox.SafeCharacterRuntime?.createSafeCharacterRuntime, 'function');

  const runtime = sandbox.SafeCharacterRuntime.createSafeCharacterRuntime(minimalSlice());
  assert.deepEqual({ ...runtime.characterMap }, { 学: '學' });
  assert.equal(runtime.apply('学校で学ぶ'), '學校で學ぶ');

  const callerCopy = { ...runtime.characterMap };
  callerCopy['学'] = 'BROKEN';
  assert.equal(runtime.apply('学校'), '學校');
});

test('safe-character runtime rejects dangling source/evidence references', async () => {
  const sandbox = await loadRuntime();
  const danglingSource = structuredClone(minimalSlice());
  danglingSource.evidenceRecords[0].sourceRef = 'missing-source';
  assert.throws(
    () => sandbox.SafeCharacterRuntime.createSafeCharacterRuntime(danglingSource),
    /Unknown safe-character source ref/
  );

  const danglingEvidence = structuredClone(minimalSlice());
  danglingEvidence.mappings[0].evidenceRefs = ['missing-evidence'];
  assert.throws(
    () => sandbox.SafeCharacterRuntime.createSafeCharacterRuntime(danglingEvidence),
    /Unknown safe-character evidence ref/
  );
});

test('safe-character runtime closes regression and exclusion evidence refs', async () => {
  const sandbox = await loadRuntime();

  const danglingRegression = structuredClone(minimalSlice());
  danglingRegression.mappings[0].regressionEvidenceRefs = ['missing-regression-evidence'];
  assert.throws(
    () => sandbox.SafeCharacterRuntime.createSafeCharacterRuntime(danglingRegression),
    /Unknown safe-character evidence ref/
  );

  const danglingExclusion = structuredClone(minimalSlice());
  danglingExclusion.exclusionRecords[0].evidenceRefs = ['missing-exclusion-evidence'];
  assert.throws(
    () => sandbox.SafeCharacterRuntime.createSafeCharacterRuntime(danglingExclusion),
    /Unknown safe-character evidence ref/
  );
});

test('safe-character runtime requires one-code-point mappings and unique modern sources', async () => {
  const sandbox = await loadRuntime();
  const multiCodePoint = structuredClone(minimalSlice());
  multiCodePoint.mappings[0].modern = '学校';
  assert.throws(
    () => sandbox.SafeCharacterRuntime.createSafeCharacterRuntime(multiCodePoint),
    /one code point/
  );

  const duplicate = structuredClone(minimalSlice());
  duplicate.mappings.push({ modern: '学', historical: '學', evidenceRefs: ['ev-gaku'] });
  assert.throws(
    () => sandbox.SafeCharacterRuntime.createSafeCharacterRuntime(duplicate),
    /Duplicate safe-character modern source/
  );
});

test('safe-character runtime rejects unconditional mappings for explicit contextual negative controls', async () => {
  const sandbox = await loadRuntime();
  for (const [modern, historical] of [['弁', '辨'], ['台', '臺']]) {
    const unsafe = structuredClone(minimalSlice());
    unsafe.mappings.push({ modern, historical, evidenceRefs: ['ev-gaku'] });
    assert.throws(
      () => sandbox.SafeCharacterRuntime.createSafeCharacterRuntime(unsafe),
      /excluded from unconditional safe-character mapping/
    );
  }
});

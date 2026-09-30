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
    evidenceRecords: [{ id: 'ev-gaku', sourceRef: 'official-source', role: 'same-character-form' }],
    excludedModernCharacters: ['弁', '台'],
    mappings: [{ modern: '学', historical: '學', evidenceRefs: ['ev-gaku'] }]
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

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadRuntime(path: string, globals: Record<string, unknown> = {}) {
  let source = '';
  try { source = await readFile(path, 'utf8'); } catch { /* RED before runtime exists */ }
  const sandbox: Record<string, any> = { ...globals };
  sandbox.globalThis = sandbox;
  if (source) vm.runInNewContext(source, sandbox, { filename: path });
  return sandbox;
}

const slice = {
  schemaVersion: '1',
  kind: 'japanese-orthography-historical-native-slice',
  lexicalNamespaceId: 'namespace-1',
  source: {
    repository: 'example/source',
    commit: '0123456789abcdef0123456789abcdef01234567',
    license: 'BSD-2-Clause',
    status: 'test-fixture',
    files: [{ path: 'kana-jisyo', blobSha: '0123456789abcdef0123456789abcdef01234567' }]
  },
  sourceRecords: [{
    id: 'source:kana:omou',
    file: 'kana-jisyo',
    raw: '思う /思ふ ;ハ行四段'
  }],
  relations: [{
    lexicalIdentity: 'namespace-1:lemma:1',
    surface: '思う',
    historicalSurface: '思ふ',
    requiredMorphology: {
      conjugationType: '五段-ワア行'
    },
    evidenceRefs: ['source:kana:omou']
  }]
};

test('historical native runtime resolves a source-backed relation by lexical identity and morphology', async () => {
  const sandbox = await loadRuntime('runtime/historical-native-runtime.js');
  assert.equal(typeof sandbox.HistoricalNativeRuntime?.createHistoricalNativeRuntime, 'function');

  const runtime = sandbox.HistoricalNativeRuntime.createHistoricalNativeRuntime(slice, {
    lexicalNamespaceId: 'namespace-1'
  });
  const relation = runtime.lookup({
    lexicalIdentity: 'namespace-1:lemma:1',
    lexicalOrigin: 'native',
    morphology: { conjugationType: '五段-ワア行', conjugationForm: '終止形-一般' }
  });

  assert.equal(relation.route, 'native');
  assert.equal(relation.surface, '思ふ');
  assert.equal(relation.reading, null);
  assert.equal(relation.requiresMorphology, true);
  assert.deepEqual(Array.from(relation.evidenceRefs), ['source:kana:omou']);
});

test('historical native runtime fails closed for origin, unknown identity, and morphology mismatch', async () => {
  const sandbox = await loadRuntime('runtime/historical-native-runtime.js');
  const runtime = sandbox.HistoricalNativeRuntime.createHistoricalNativeRuntime(slice, {
    lexicalNamespaceId: 'namespace-1'
  });

  assert.equal(runtime.lookup({
    lexicalIdentity: 'namespace-1:lemma:1', lexicalOrigin: 'sino',
    morphology: { conjugationType: '五段-ワア行' }
  }), null);
  assert.equal(runtime.lookup({
    lexicalIdentity: 'namespace-1:lemma:999', lexicalOrigin: 'native',
    morphology: { conjugationType: '五段-ワア行' }
  }), null);
  assert.equal(runtime.lookup({
    lexicalIdentity: 'namespace-1:lemma:1', lexicalOrigin: 'native',
    morphology: { conjugationType: '上一段' }
  }), null);
});

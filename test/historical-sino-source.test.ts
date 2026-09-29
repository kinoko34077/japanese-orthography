import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const namespaceId = '6aba6e8a20610ece73a028ed4dd9e64aefaaff3eec3f9a8bb56fd33c3bdfb144';

async function loadRuntime(path: string, globals: Record<string, unknown> = {}) {
  const source = await readFile(path, 'utf8');
  const sandbox: Record<string, any> = { ...globals };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: path });
  return sandbox;
}

async function loadSlice() {
  return JSON.parse(await readFile('data/historical/sino/kkh-jion-first-slice.json', 'utf8')) as Record<string, any>;
}

test('pinned KKH slice resolves real UniDic 学校 identity without flattening source ambiguity', async () => {
  const [sandbox, slice] = await Promise.all([
    loadRuntime('runtime/historical-sino-runtime.js'),
    loadSlice()
  ]);
  const runtime = sandbox.HistoricalSinoRuntime.createHistoricalSinoRuntime(slice, { lexicalNamespaceId: namespaceId });
  const relation = runtime.lookup({
    lexicalIdentity: 'unidic-cwj:2025.12:lemma:8098',
    lexicalOrigin: 'sino'
  });

  assert.equal(slice.source.repository, 'okikae/kkh');
  assert.equal(slice.source.commit, '19b24f88ab55809a186d88c465959548495b26a2');
  assert.equal(slice.source.license, 'BSD-2-Clause');
  assert.ok(slice.source.files.some((file: any) => file.path === 'kana-jisyo' && file.blobSha === '6a69cdc140994a0b8d5f6acb86d7b3b8c3ef20be'));
  assert.ok(slice.source.files.some((file: any) => file.path === 'jion-jisyo' && file.blobSha === '3447864cb4b661c586ae1a35ef7cc524b3d5d895'));
  assert.equal(slice.source.status, 'beta-incomplete');
  assert.equal(relation.reading, 'がくかう');
  assert.deepEqual(Array.from(relation.components, (component: any) => [
    component.surface,
    component.lexicalReading,
    component.historicalKana
  ]), [
    ['学', 'がく', 'がく'],
    ['校', 'こう', 'かう']
  ]);
  assert.ok(slice.sourceRecords.some((record: any) => record.file === 'kana-jisyo' && record.modernReading === 'がっこう' && record.historicalReading === 'がくかう'));
  assert.ok(slice.sourceRecords.some((record: any) => record.file === 'jion-jisyo' && record.surface === '校' && record.historicalReading === 'かう'));
  assert.ok(slice.sourceRecords.some((record: any) => record.file === 'jion-jisyo' && record.surface === '校' && record.historicalReading === 'けう'));
});

test('historical Sino runtime rejects a lexical namespace mismatch', async () => {
  const [sandbox, slice] = await Promise.all([
    loadRuntime('runtime/historical-sino-runtime.js'),
    loadSlice()
  ]);
  assert.throws(
    () => sandbox.HistoricalSinoRuntime.createHistoricalSinoRuntime(slice, { lexicalNamespaceId: 'wrong-namespace' }),
    /namespace mismatch/
  );
});

test('historical Sino runtime fails closed for non-Sino and unknown lexical identities', async () => {
  const [sandbox, slice] = await Promise.all([
    loadRuntime('runtime/historical-sino-runtime.js'),
    loadSlice()
  ]);
  const runtime = sandbox.HistoricalSinoRuntime.createHistoricalSinoRuntime(slice, { lexicalNamespaceId: namespaceId });

  assert.equal(runtime.lookup({ lexicalIdentity: 'unidic-cwj:2025.12:lemma:8098', lexicalOrigin: 'native' }), null);
  assert.equal(runtime.lookup({ lexicalIdentity: 'unidic-cwj:2025.12:lemma:999999', lexicalOrigin: 'sino' }), null);
});

test('same historical Sino slice/runtime loads in browser-class and Worker-class sandboxes', async () => {
  const slice = await loadSlice();
  for (const globals of [{ window: {} }, { self: {} }]) {
    const sandbox = await loadRuntime('runtime/historical-sino-runtime.js', globals);
    const runtime = sandbox.HistoricalSinoRuntime.createHistoricalSinoRuntime(slice, { lexicalNamespaceId: namespaceId });
    assert.equal(runtime.lookup({ lexicalIdentity: 'unidic-cwj:2025.12:lemma:8098', lexicalOrigin: 'sino' }).reading, 'がくかう');
  }
});

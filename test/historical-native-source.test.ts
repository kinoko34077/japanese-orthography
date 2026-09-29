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
  return JSON.parse(await readFile('data/historical/native/kkh-kana-first-slice.json', 'utf8')) as Record<string, any>;
}

test('pinned KKH native slice resolves 思う by real lexical identity and preserves source variants', async () => {
  const [sandbox, slice] = await Promise.all([
    loadRuntime('runtime/historical-native-runtime.js'),
    loadSlice()
  ]);
  const runtime = sandbox.HistoricalNativeRuntime.createHistoricalNativeRuntime(slice, { lexicalNamespaceId: namespaceId });
  const relation = runtime.lookup({
    lexicalIdentity: 'unidic-cwj:2025.12:lemma:5255',
    lexicalOrigin: 'native',
    morphology: { conjugationType: '五段-ワア行', conjugationForm: '終止形-一般' }
  });

  assert.equal(slice.source.repository, 'okikae/kkh');
  assert.equal(slice.source.commit, '19b24f88ab55809a186d88c465959548495b26a2');
  assert.equal(slice.source.license, 'BSD-2-Clause');
  assert.ok(slice.source.files.some((file: any) => (
    file.path === 'kana-jisyo' && file.blobSha === '6a69cdc140994a0b8d5f6acb86d7b3b8c3ef20be'
  )));
  assert.equal(slice.relations[0].requiredMorphology.conjugationType, '五段-ワア行');
  assert.equal(slice.relations[0].requiredMorphology.conjugationForm, '終止形-一般');
  assert.equal(relation.route, 'native');
  assert.equal(relation.surface, '思ふ');
  assert.equal(relation.reading, null);
  assert.deepEqual(Array.from(relation.evidenceRefs), ['kkh-kana-omou-omofu']);

  assert.equal(runtime.lookup({
    lexicalIdentity: 'unidic-cwj:2025.12:lemma:5255',
    lexicalOrigin: 'native',
    morphology: { conjugationType: '五段-ワア行', conjugationForm: '連用形-ウ音便' }
  }), null);

  const variants = slice.sourceRecords.filter((record: any) => record.surface === '味わおう');
  assert.deepEqual(Array.from(variants, (record: any) => record.historicalSurface), ['味はゝう', '味ははう']);
  assert.equal(slice.relations.some((entry: any) => entry.lexicalIdentity === 'unidic-cwj:2025.12:lemma:670'), false);
});

test('historical native runtime rejects malformed pinned source identity', async () => {
  const [sandbox, slice] = await Promise.all([
    loadRuntime('runtime/historical-native-runtime.js'),
    loadSlice()
  ]);
  const malformed = structuredClone(slice);
  malformed.source.files[0].blobSha = 'not-a-git-blob-sha';
  assert.throws(
    () => sandbox.HistoricalNativeRuntime.createHistoricalNativeRuntime(malformed, { lexicalNamespaceId: namespaceId }),
    /source file blob SHA/
  );
});

test('historical native runtime rejects dangling evidence references', async () => {
  const [sandbox, slice] = await Promise.all([
    loadRuntime('runtime/historical-native-runtime.js'),
    loadSlice()
  ]);
  const malformed = structuredClone(slice);
  malformed.relations[0].evidenceRefs = ['missing-evidence-id'];
  assert.throws(
    () => sandbox.HistoricalNativeRuntime.createHistoricalNativeRuntime(malformed, { lexicalNamespaceId: namespaceId }),
    /Unknown historical native evidence ref/
  );
});

test('historical native runtime rejects lexical namespace mismatch', async () => {
  const [sandbox, slice] = await Promise.all([
    loadRuntime('runtime/historical-native-runtime.js'),
    loadSlice()
  ]);
  assert.throws(
    () => sandbox.HistoricalNativeRuntime.createHistoricalNativeRuntime(slice, { lexicalNamespaceId: 'wrong-namespace' }),
    /namespace mismatch/
  );
});

test('same historical native slice/runtime loads in browser-class and Worker-class sandboxes', async () => {
  const slice = await loadSlice();
  for (const globals of [{ window: {} }, { self: {} }]) {
    const sandbox = await loadRuntime('runtime/historical-native-runtime.js', globals);
    const runtime = sandbox.HistoricalNativeRuntime.createHistoricalNativeRuntime(slice, { lexicalNamespaceId: namespaceId });
    const relation = runtime.lookup({
      lexicalIdentity: 'unidic-cwj:2025.12:lemma:5255',
      lexicalOrigin: 'native',
      morphology: { conjugationType: '五段-ワア行', conjugationForm: '終止形-一般' }
    });
    assert.equal(relation.surface, '思ふ');
  }
});

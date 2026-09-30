import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const lexicalNamespaceId = '6aba6e8a20610ece73a028ed4dd9e64aefaaff3eec3f9a8bb56fd33c3bdfb144';
const taifuIdentity = 'unidic-cwj:2025.12:lemma:21903';

async function loadJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

async function loadBindingSlice() {
  try {
    return await loadJson('data/lexical/bindings/contextual-kanji-unidic-first-slice.json');
  } catch {
    return null;
  }
}

async function loadBindingTool() {
  try {
    return await import('../tools/contextual-lexical-bindings.ts');
  } catch {
    return null;
  }
}

test('real contextual binding slice binds constraint-taifu to the accepted UniDic identity', async () => {
  const slice = await loadBindingSlice();
  assert.equal(slice?.schemaVersion, '1');
  assert.equal(slice?.kind, 'japanese-orthography-contextual-lexical-binding-slice');
  assert.equal(slice?.bindingNamespaceId, 'pmin-current');
  assert.equal(slice?.sourceLexicalNamespaceId, lexicalNamespaceId);
  assert.deepEqual(slice?.bindings?.['constraint-taifu'], [taifuIdentity]);
  assert.equal(slice?.sourceEvidence?.sourceLemmaId, 21903);
  assert.equal(slice?.sourceEvidence?.surface, '台風');
});

test('validated contextual bindings are derived only from the accepted UniDic source record', async () => {
  const [tool, slice, lexicalSource] = await Promise.all([
    loadBindingTool(),
    loadJson('data/lexical/bindings/contextual-kanji-unidic-first-slice.json'),
    loadJson('data/lexical/sources/unidic-cwj-202512-first-slice.json')
  ]);
  assert.equal(typeof tool?.createContextualCompilationBindings, 'function');

  const bindings = tool!.createContextualCompilationBindings(slice, lexicalSource);
  assert.equal(bindings.lexicalNamespaceId, 'pmin-current');
  assert.deepEqual(bindings.lexicalBindings.get('constraint-taifu'), [taifuIdentity]);
});

test('contextual binding validation fails closed on namespace and source-record drift', async () => {
  const [tool, slice, lexicalSource] = await Promise.all([
    loadBindingTool(),
    loadJson('data/lexical/bindings/contextual-kanji-unidic-first-slice.json'),
    loadJson('data/lexical/sources/unidic-cwj-202512-first-slice.json')
  ]);
  assert.equal(typeof tool?.createContextualCompilationBindings, 'function');

  const wrongNamespace = structuredClone(slice);
  wrongNamespace.sourceLexicalNamespaceId = 'wrong-namespace';
  assert.throws(
    () => tool!.createContextualCompilationBindings(wrongNamespace, lexicalSource),
    /source lexical namespace mismatch/
  );

  const wrongLemma = structuredClone(slice);
  wrongLemma.sourceEvidence.sourceLemmaId = 999999;
  wrongLemma.sourceEvidence.lexicalIdentity = 'unidic-cwj:2025.12:lemma:999999';
  wrongLemma.bindings['constraint-taifu'] = ['unidic-cwj:2025.12:lemma:999999'];
  assert.throws(
    () => tool!.createContextualCompilationBindings(wrongLemma, lexicalSource),
    /source evidence record not found/
  );
});

test('real contextual bindings overlay only the admitted anchor and preserve unproven fixture bindings', async () => {
  const [tool, slice, lexicalSource] = await Promise.all([
    loadBindingTool(),
    loadJson('data/lexical/bindings/contextual-kanji-unidic-first-slice.json'),
    loadJson('data/lexical/sources/unidic-cwj-202512-first-slice.json')
  ]);
  assert.equal(typeof tool?.overlayContextualCompilationBindings, 'function');

  const base = {
    lexicalNamespaceId: 'pmin-current',
    lexicalBindings: new Map([
      ['constraint-taifu', ['fixture-local-0006']],
      ['constraint-taito', ['fixture-local-0008']]
    ])
  };
  const real = tool!.createContextualCompilationBindings(slice, lexicalSource);
  const merged = tool!.overlayContextualCompilationBindings(base, real);

  assert.deepEqual(merged.lexicalBindings.get('constraint-taifu'), [taifuIdentity]);
  assert.deepEqual(merged.lexicalBindings.get('constraint-taito'), ['fixture-local-0008']);
  assert.deepEqual(base.lexicalBindings.get('constraint-taifu'), ['fixture-local-0006']);
});

test('contextual binding overlay rejects a binding namespace mismatch', async () => {
  const tool = await loadBindingTool();
  assert.equal(typeof tool?.overlayContextualCompilationBindings, 'function');
  assert.throws(
    () => tool!.overlayContextualCompilationBindings(
      { lexicalNamespaceId: 'pmin-current', lexicalBindings: new Map() },
      { lexicalNamespaceId: 'other-namespace', lexicalBindings: new Map() }
    ),
    /binding namespace mismatch/
  );
});

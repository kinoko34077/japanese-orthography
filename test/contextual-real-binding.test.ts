import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const lexicalNamespaceId = '6aba6e8a20610ece73a028ed4dd9e64aefaaff3eec3f9a8bb56fd33c3bdfb144';
const taifuIdentity = 'unidic-cwj:2025.12:lemma:21903';

async function loadBindingSlice() {
  try {
    return JSON.parse(await readFile('data/lexical/bindings/contextual-kanji-unidic-first-slice.json', 'utf8')) as Record<string, any>;
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

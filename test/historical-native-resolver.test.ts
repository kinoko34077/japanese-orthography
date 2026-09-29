import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadUmd(path: string, globals: Record<string, unknown> = {}) {
  const source = await readFile(path, 'utf8');
  const sandbox: Record<string, any> = { ...globals };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: path });
  return sandbox;
}

test('resolver consumes a native historical relation without inventing a historical reading', async () => {
  const sharedSandbox = await loadUmd('runtime/transform-shared.js');
  const resolverSandbox = await loadUmd('runtime/orthography-resolver.js', {
    TransformShared: sharedSandbox.TransformShared
  });
  const resolver = resolverSandbox.OrthographyResolver.createResolver({
    lexicalLookup(surface: string) {
      return surface === '思う' ? [{
        lexicalIdentity: 'unidic-cwj:2025.12:lemma:5255',
        lemma: '思う',
        reading: 'おもう',
        modernReadings: ['おもう'],
        lexicalOrigin: 'native',
        morphology: {
          partOfSpeech: ['動詞', '一般', '*', '*'],
          conjugationType: '五段-ワア行',
          conjugationForm: '終止形-一般'
        },
        components: [],
        viableBindingIds: ['unidic-cwj:2025.12:lemma:5255'],
        evidenceRefs: ['unidic-cwj:2025.12:lemma:5255']
      }] : [];
    },
    historicalLookup(candidate: Record<string, any>) {
      return candidate.lexicalIdentity === 'unidic-cwj:2025.12:lemma:5255' ? {
        route: 'native',
        reading: null,
        surface: '思ふ',
        requiresMorphology: true,
        evidenceRefs: ['kkh-kana-omou-omofu']
      } : null;
    }
  });

  const plain = resolver.resolveUnit('思う');
  assert.equal(plain.lexicalIdentity, 'unidic-cwj:2025.12:lemma:5255');
  assert.equal(plain.historical.route, 'native');
  assert.equal(plain.historical.surface, '思ふ');
  assert.equal(plain.historical.kana, null);
  assert.equal(resolver.render(plain, { mode: 'plain' }), '思ふ');
  assert.equal(resolver.render(plain, { mode: 'ruby-whole-explicit' }), '思ふ');

  const ruby = resolver.resolveUnit('｜思う《おもう》');
  assert.equal(ruby.lexicalIdentity, plain.lexicalIdentity);
  assert.equal(ruby.reading.source, 'ruby-word');
  assert.equal(ruby.historical.surface, '思ふ');
  assert.equal(ruby.historical.kana, null);
});

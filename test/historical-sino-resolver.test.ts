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

test('resolver adopts historical relation components when the lexical candidate has none', async () => {
  const sharedSandbox = await loadUmd('runtime/transform-shared.js');
  const resolverSandbox = await loadUmd('runtime/orthography-resolver.js', {
    TransformShared: sharedSandbox.TransformShared
  });
  const resolver = resolverSandbox.OrthographyResolver.createResolver({
    lexicalLookup(surface: string) {
      return surface === '学校' ? [{
        lexicalIdentity: 'unidic-cwj:2025.12:lemma:8098',
        surface: '学校',
        reading: 'がっこう',
        modernReadings: ['がっこ', 'がっこう'],
        lexicalOrigin: 'sino',
        morphology: { partOfSpeech: ['名詞', '普通名詞', '一般', '*'], conjugationType: null, conjugationForm: null },
        components: [],
        viableBindingIds: ['unidic-cwj:2025.12:lemma:8098'],
        evidenceRefs: ['unidic-cwj:2025.12:lemma:8098']
      }] : [];
    },
    historicalLookup(candidate: Record<string, any>) {
      return candidate.lexicalIdentity === 'unidic-cwj:2025.12:lemma:8098' ? {
        route: 'sino',
        reading: 'がくかう',
        surface: '学校',
        components: [
          {
            lexicalIdentity: null,
            surface: '学',
            lexicalReading: 'がく',
            lexicalOrigin: 'sino',
            readingClass: 'on',
            historicalKana: 'がく',
            evidenceRefs: ['kkh-jion-gaku-gaku']
          },
          {
            lexicalIdentity: null,
            surface: '校',
            lexicalReading: 'こう',
            lexicalOrigin: 'sino',
            readingClass: 'on',
            historicalKana: 'かう',
            evidenceRefs: ['kkh-jion-kou-kau']
          }
        ],
        evidenceRefs: ['kkh-kana-school-gakkou', 'kkh-jion-gaku-gaku', 'kkh-jion-kou-kau']
      } : null;
    },
    safeKanjiMap: { 学: '學' }
  });

  const unit = resolver.resolveUnit('学校');

  assert.equal(unit.lexicalIdentity, 'unidic-cwj:2025.12:lemma:8098');
  assert.deepEqual(Array.from(unit.components, (component: any) => [
    component.lexicalIdentity,
    component.surface,
    component.lexicalReading,
    component.historicalKana,
    component.renderedSurface
  ]), [
    [null, '学', 'がく', 'がく', '學'],
    [null, '校', 'こう', 'かう', '校']
  ]);
  assert.equal(unit.historical.kana, 'がくかう');
  assert.equal(resolver.render(unit, { mode: 'ruby-whole-explicit' }), '｜學校《がくかう》');
  assert.equal(resolver.render(unit, { mode: 'ruby-components-explicit' }), '｜學《がく》校《かう》');
});

test('resolver does not reuse source-surface relation components for a different contextual target', async () => {
  const resolverSandbox = await loadUmd('runtime/orthography-resolver.js');
  const resolver = resolverSandbox.OrthographyResolver.createResolver({
    lexicalLookup(surface: string) {
      return surface === '台風' ? [{
        lexicalIdentity: 'lex-taifu',
        surface: '台風',
        reading: 'たいふう',
        lexicalOrigin: 'sino',
        components: [],
        viableBindingIds: ['bind-taifu'],
        evidenceRefs: []
      }] : [];
    },
    historicalLookup() {
      return {
        route: 'sino',
        reading: 'たいふう',
        surface: '台風',
        components: [
          { lexicalIdentity: null, surface: '台', lexicalReading: 'たい', historicalKana: 'たい' },
          { lexicalIdentity: null, surface: '風', lexicalReading: 'ふう', historicalKana: 'ふう' }
        ],
        evidenceRefs: ['synthetic:jion']
      };
    },
    contextualRelations: [{ id: 'ctx-taifu', match: '台風', target: '颱風', lexicalBindingIds: ['bind-taifu'] }]
  });

  const unit = resolver.resolveUnit('台風');
  assert.equal(unit.historical.surface, '颱風');
  assert.deepEqual(Array.from(unit.components), []);
  assert.equal(resolver.render(unit, { mode: 'ruby-components-explicit' }), '｜颱風《たいふう》');
});

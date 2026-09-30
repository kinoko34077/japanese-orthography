import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { compileWorkspace } from '../tools/compiler.ts';
import { createContextualCompilationBindings, type ContextualLexicalBindingSlice } from '../tools/contextual-lexical-bindings.ts';
import { compileLexicalSourceSlice, type UniDicSourceSlice } from '../tools/lexical-compiler.ts';

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

async function loadUmd(path: string, globals: Record<string, unknown> = {}) {
  const source = await readFile(path, 'utf8');
  const sandbox: Record<string, any> = { ...globals };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: path });
  return sandbox;
}

function located(value: Record<string, any>, file: string, pointer: string) {
  return { value, location: { file, pointer } };
}

async function compileCanonicalTaifuRelations() {
  const [bindingSlice, lexicalSource, manifest, taiPack] = await Promise.all([
    json('data/lexical/bindings/contextual-kanji-unidic-first-slice.json'),
    json('data/lexical/sources/unidic-cwj-202512-first-slice.json'),
    json('data/packs/contextual-kanji/manifest.json'),
    json('data/packs/contextual-kanji/merged-tai.json')
  ]);
  const relation = taiPack.positiveRelations.find((entry: any) => entry.id === 'rel-taifu');
  const unit = taiPack.restorationUnits.find((entry: any) => entry.id === relation?.unitId);
  assert.ok(relation);
  assert.ok(unit);

  const workspace: any = {
    sources: [],
    evidence: [],
    lexicalEvidence: [],
    lexicalConstraintSets: [],
    restorationUnits: [located(unit, 'data/packs/contextual-kanji/merged-tai.json', '/restorationUnits/0')],
    positiveRelations: [located(relation, 'data/packs/contextual-kanji/merged-tai.json', '/positiveRelations/0')],
    safetyConstraints: [],
    reviewHints: [],
    packMetadata: [located(manifest, 'data/packs/contextual-kanji/manifest.json', '')]
  };
  const bindings = createContextualCompilationBindings(
    bindingSlice as ContextualLexicalBindingSlice,
    lexicalSource as UniDicSourceSlice
  );
  return JSON.parse(compileWorkspace(workspace, bindings)['hot-relations.json']) as Array<Record<string, any>>;
}

test('source-backed safe map composes with real lexical, Sino, contextual, and late rendering', async () => {
  const [lexicalSandbox, sinoSandbox, safeSandbox, resolverSandbox, lexicalSource, sinoSlice, safeSlice, contextualRelations] = await Promise.all([
    loadUmd('runtime/lexical-runtime.js'),
    loadUmd('runtime/historical-sino-runtime.js'),
    loadUmd('runtime/safe-character-runtime.js'),
    loadUmd('runtime/orthography-resolver.js'),
    json('data/lexical/sources/unidic-cwj-202512-first-slice.json'),
    json('data/historical/sino/kkh-jion-first-slice.json'),
    json('data/deterministic/safe-character-first-slice.json'),
    compileCanonicalTaifuRelations()
  ]);

  const lexicalArtifact = compileLexicalSourceSlice(lexicalSource as UniDicSourceSlice);
  const lexical = lexicalSandbox.LexicalRuntime.createLexicalRuntime(lexicalArtifact);
  const sino = sinoSandbox.HistoricalSinoRuntime.createHistoricalSinoRuntime(sinoSlice, {
    lexicalNamespaceId: lexical.lexicalNamespaceId
  });
  const safe = safeSandbox.SafeCharacterRuntime.createSafeCharacterRuntime(safeSlice);
  const resolver = resolverSandbox.OrthographyResolver.createResolver({
    lexicalLookup(surface: string) { return lexical.lookup(surface); },
    historicalLookup(candidate: Record<string, any>) { return sino.lookup(candidate); },
    contextualRelations,
    safeKanjiMap: safe.characterMap
  });

  const school = resolver.resolveUnit('学校');
  assert.equal(school.lexicalIdentity, 'unidic-cwj:2025.12:lemma:8098');
  assert.equal(school.historical.surface, '學校');
  assert.equal(school.historical.kana, 'がくかう');
  assert.equal(resolver.render(school, { mode: 'plain' }), '學校');
  assert.equal(resolver.render(school, { mode: 'ruby-whole-explicit' }), '｜學校《がくかう》');

  const taifu = resolver.resolveUnit('台風');
  assert.equal(taifu.lexicalIdentity, 'unidic-cwj:2025.12:lemma:21903');
  assert.equal(taifu.historical.contextualKanji.status, 'resolved');
  assert.equal(taifu.historical.surface, '颱風');
  assert.equal(resolver.render(taifu, { mode: 'plain' }), '颱風');

  assert.equal(safe.apply('台風'), '台風');
  assert.equal(Object.prototype.hasOwnProperty.call(safe.characterMap, '台'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(safe.characterMap, '弁'), false);
});

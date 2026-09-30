import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { compileWorkspace } from '../tools/compiler.ts';
import type { ContextualLexicalBindingSlice } from '../tools/contextual-lexical-bindings.ts';
import { compileLexicalSourceSlice, type UniDicSourceSlice } from '../tools/lexical-compiler.ts';

const lexicalNamespaceId = '6aba6e8a20610ece73a028ed4dd9e64aefaaff3eec3f9a8bb56fd33c3bdfb144';
const taifuIdentity = 'unidic-cwj:2025.12:lemma:21903';
const bindingSlicePath = 'data/lexical/bindings/contextual-kanji-unidic-first-slice.json';

async function loadJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

async function loadBindingSliceFile(): Promise<ContextualLexicalBindingSlice> {
  return JSON.parse(await readFile(bindingSlicePath, 'utf8')) as ContextualLexicalBindingSlice;
}

async function loadBindingSlice(): Promise<ContextualLexicalBindingSlice | null> {
  try {
    return await loadBindingSliceFile();
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

async function loadRuntime(path: string) {
  const source = await readFile(path, 'utf8');
  const sandbox: Record<string, any> = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: path });
  return sandbox;
}

function located(value: Record<string, any>, file: string, pointer: string) {
  return { value, location: { file, pointer } };
}

async function compileCanonicalTaifuRelations() {
  const [tool, slice, lexicalSource, manifest, taiPack] = await Promise.all([
    loadBindingTool(),
    loadBindingSliceFile(),
    loadJson('data/lexical/sources/unidic-cwj-202512-first-slice.json'),
    loadJson('data/packs/contextual-kanji/manifest.json'),
    loadJson('data/packs/contextual-kanji/merged-tai.json')
  ]);
  assert.equal(typeof tool?.createContextualCompilationBindings, 'function');
  const relation = taiPack.positiveRelations.find((entry: any) => entry.id === 'rel-taifu');
  const unit = taiPack.restorationUnits.find((entry: any) => entry.id === relation.unitId);
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
  const bindings = tool!.createContextualCompilationBindings(slice, lexicalSource);
  const compiled = compileWorkspace(workspace, bindings);
  return JSON.parse(compiled['hot-relations.json']) as Array<Record<string, any>>;
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
    loadBindingSliceFile(),
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
    loadBindingSliceFile(),
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
    loadBindingSliceFile(),
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

test('canonical rel-taifu compiles with the real UniDic lexical binding', async () => {
  const hotRelations = await compileCanonicalTaifuRelations();
  const compiledTaifu = hotRelations.find((entry) => entry.id === 'rel-taifu');

  assert.deepEqual(compiledTaifu?.lexicalBindingIds, [taifuIdentity]);
  assert.equal(compiledTaifu?.match, '台風');
  assert.equal(compiledTaifu?.target, '颱風');
  assert.equal(JSON.stringify(hotRelations).includes('fixture-local-0006'), false);
  assert.equal(hotRelations.some((entry) => entry.match === '台'), false);
});

test('compiled canonical rel-taifu resolves only the matching real lexical candidate', async () => {
  const [lexicalSandbox, resolverSandbox, lexicalSource, contextualRelations] = await Promise.all([
    loadRuntime('runtime/lexical-runtime.js'),
    loadRuntime('runtime/orthography-resolver.js'),
    loadJson('data/lexical/sources/unidic-cwj-202512-first-slice.json'),
    compileCanonicalTaifuRelations()
  ]);
  const lexicalArtifact = compileLexicalSourceSlice(lexicalSource as UniDicSourceSlice);
  const lexical = lexicalSandbox.LexicalRuntime.createLexicalRuntime(lexicalArtifact);
  const resolver = resolverSandbox.OrthographyResolver.createResolver({
    lexicalLookup(surface: string) { return lexical.lookup(surface); },
    contextualRelations
  });

  const unit = resolver.resolveUnit('台風');
  assert.equal(unit.lexicalIdentity, taifuIdentity);
  assert.equal(unit.historical.contextualKanji.status, 'resolved');
  assert.equal(unit.historical.surface, '颱風');
  assert.deepEqual(Array.from(unit.historical.contextualKanji.relationIds), ['rel-taifu']);
  assert.equal(resolver.render(unit, { mode: 'plain' }), '颱風');

  const wrongBindingRelations = contextualRelations.map((entry) => ({
    ...entry,
    lexicalBindingIds: ['unidic-cwj:2025.12:lemma:999999']
  }));
  const wrongBindingResolver = resolverSandbox.OrthographyResolver.createResolver({
    lexicalLookup(surface: string) { return lexical.lookup(surface); },
    contextualRelations: wrongBindingRelations
  });
  const wrong = wrongBindingResolver.resolveUnit('台風');
  assert.equal(wrong.lexicalIdentity, taifuIdentity);
  assert.equal(wrong.historical.contextualKanji.status, 'none');
  assert.equal(wrong.historical.surface, '台風');
  assert.equal(wrong.historical.disposition, 'SOURCE_REVIEW');
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { compileWorkspace } from '../tools/compiler.ts';
import { createFirstSliceCompilationBindings, validateRoot } from '../tools/validate.ts';

async function loadResolver() {
  const source = await readFile('runtime/orthography-resolver.js', 'utf8');
  const sandbox: Record<string, any> = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'runtime/orthography-resolver.js' });
  return sandbox.OrthographyResolver;
}

async function canonicalRelations() {
  const { workspace, diagnostics, integrationFixture } = await validateRoot(process.cwd());
  assert.deepEqual(diagnostics, []);
  const artifact = compileWorkspace(workspace, createFirstSliceCompilationBindings(integrationFixture));
  return JSON.parse(artifact['hot-relations.json']) as Array<Record<string, any>>;
}

function resolverFor(relations: Array<Record<string, any>>, resolverApi: any) {
  return resolverApi.createResolver({
    lexicalLookup(surface: string) {
      return [{
        lexicalIdentity: `fixture-local:${surface}`,
        surface,
        reading: null,
        lexicalOrigin: 'fixture',
        components: [],
        viableBindingIds: [],
        evidenceRefs: []
      }];
    },
    contextualRelations: relations,
    safeKanjiMap: {}
  });
}

test('4.6C exact homophone relations resolve through the canonical runtime path', async () => {
  const [relations, resolverApi] = await Promise.all([canonicalRelations(), loadResolver()]);
  const resolver = resolverFor(relations, resolverApi);

  for (const [modern, historical] of [['溶接', '熔接'], ['間欠', '間歇'], ['賛嘆', '讃嘆']] as const) {
    const unit = resolver.resolveUnit(modern);
    assert.equal(unit.historical.contextualKanji.status, 'resolved', modern);
    assert.equal(unit.historical.contextualKanji.target, historical, modern);
    assert.deepEqual([...unit.historical.contextualKanji.candidates], [historical], modern);
    assert.equal(unit.historical.surface, historical, modern);
    assert.equal(unit.historical.disposition, 'AUTO', modern);
  }
});

test('4.6C 装丁 remains a complete two-target candidate set independent of relation order', async () => {
  const [relations, resolverApi] = await Promise.all([canonicalRelations(), loadResolver()]);
  const expected = new Set(['装釘', '装幀']);

  for (const ordered of [relations, [...relations].reverse()]) {
    const unit = resolverFor(ordered, resolverApi).resolveUnit('装丁');
    assert.equal(unit.historical.contextualKanji.status, 'candidates');
    assert.equal(unit.historical.contextualKanji.target, null);
    assert.deepEqual(new Set(unit.historical.contextualKanji.candidates), expected);
    assert.equal(unit.historical.surface, '装丁');
    assert.equal(unit.historical.disposition, 'CANDIDATES');
  }
});

test('4.6C does not create bare-character reverse authority', async () => {
  const [relations, resolverApi] = await Promise.all([canonicalRelations(), loadResolver()]);
  const resolver = resolverFor(relations, resolverApi);

  for (const surface of ['溶', '欠', '賛', '丁']) {
    const unit = resolver.resolveUnit(surface);
    assert.equal(unit.historical.contextualKanji.status, 'none', surface);
    assert.deepEqual([...unit.historical.contextualKanji.candidates], [], surface);
    assert.equal(unit.historical.surface, surface, surface);
  }
});

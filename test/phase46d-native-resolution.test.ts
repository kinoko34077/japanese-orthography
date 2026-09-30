import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const namespaceId = 'namespace-phase46d-test';

async function loadRuntime(path: string, globals: Record<string, unknown> = {}) {
  const source = await readFile(path, 'utf8');
  const sandbox: Record<string, any> = { ...globals };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: path });
  return sandbox;
}

const v2Slice = {
  schemaVersion: '2',
  kind: 'japanese-orthography-historical-native-slice',
  purpose: 'Phase 4.6D runtime test fixture',
  lexicalNamespaceId: namespaceId,
  sources: [{
    sourceId: 'test-native',
    sourceClass: 'external-repository',
    repository: 'example/native',
    commit: '0123456789abcdef0123456789abcdef01234567',
    path: 'kana-jisyo',
    blobSha: '1111111111111111111111111111111111111111',
    license: 'BSD-2-Clause',
    coverageRole: 'coverage-contract'
  }],
  identityRelations: [{
    lexicalIdentity: 'namespace-phase46d-test:lemma:1',
    surface: '思う',
    historicalSurface: 'IDENTITY',
    requiredMorphology: {
      conjugationType: '五段-ワア行',
      conjugationForm: '終止形-一般'
    },
    provenance: [[0, 'line:1']]
  }],
  surfaceRelations: [
    ['アイゴ', 'アヰゴ', [[0, 'line:4']]],
    ['思う', 'SURFACE', [[0, 'line:2']]],
    ['植え', '植ゑ', [[0, 'line:3']]]
  ],
  readingRelations: [
    ['アイゴ', 'アヰゴ', [[0, 'line:4']]],
    ['藍', 'あゐ', [[0, 'entry:1']]]
  ],
  surfaceCandidates: [
    ['味わおう', ['味ははう', '味はゝう'], [[0, 'line:5'], [0, 'line:6']]]
  ],
  readingCandidates: [],
  artifactContentId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
};

function candidate(form = '終止形-一般') {
  return {
    lexicalIdentity: 'namespace-phase46d-test:lemma:1',
    lexicalOrigin: 'native',
    morphology: {
      conjugationType: '五段-ワア行',
      conjugationForm: form
    },
    evidenceRefs: ['lexical:test']
  };
}

test('v2 native runtime keeps identity+morphology lookup ahead of exact-surface lookup', async () => {
  const sandbox = await loadRuntime('runtime/historical-native-runtime.js');
  const runtime = sandbox.HistoricalNativeRuntime.createHistoricalNativeRuntime(v2Slice, {
    lexicalNamespaceId: namespaceId
  });

  const identity = runtime.lookup(candidate());
  assert.equal(identity.route, 'native');
  assert.equal(identity.surface, 'IDENTITY');
  assert.equal(identity.reading, null);
  assert.equal(identity.requiresMorphology, true);
  assert.deepEqual(Array.from(identity.evidenceRefs), ['source:test-native:line:1']);

  assert.equal(runtime.lookup(candidate('連用形-ウ音便')), null);

  const surface = runtime.lookupSurface('思う');
  assert.equal(surface.status, 'resolved');
  assert.equal(surface.surface, 'SURFACE');
  assert.equal(surface.reading, null);
  assert.deepEqual(Array.from(surface.evidenceRefs), ['source:test-native:line:2']);
});

test('v2 native runtime exposes exact whole-surface, reading, and ambiguity indexes without substring lookup', async () => {
  const sandbox = await loadRuntime('runtime/historical-native-runtime.js');
  const runtime = sandbox.HistoricalNativeRuntime.createHistoricalNativeRuntime(v2Slice, {
    lexicalNamespaceId: namespaceId
  });

  const ue = runtime.lookupSurface('植え');
  assert.equal(ue.status, 'resolved');
  assert.equal(ue.surface, '植ゑ');
  assert.equal(ue.reading, null);

  const ai = runtime.lookupSurface('藍');
  assert.equal(ai.status, 'resolved');
  assert.equal(ai.surface, '藍');
  assert.equal(ai.reading, 'あゐ');

  const aigo = runtime.lookupSurface('アイゴ');
  assert.equal(aigo.status, 'resolved');
  assert.equal(aigo.surface, 'アヰゴ');
  assert.equal(aigo.reading, 'アヰゴ');

  const ambiguous = runtime.lookupSurface('味わおう');
  assert.equal(ambiguous.status, 'candidates');
  assert.equal(ambiguous.surface, '味わおう');
  assert.deepEqual(Array.from(ambiguous.candidates), ['味ははう', '味はゝう']);
  assert.deepEqual(Array.from(ambiguous.readingCandidates), []);

  assert.equal(runtime.lookupSurface('前植え後'), null);
  assert.equal(runtime.lookupSurface('未知語'), null);
});

test('resolver uses matching identity relation before surface fallback and can fall back after morphology mismatch', async () => {
  const [nativeSandbox, resolverSandbox] = await Promise.all([
    loadRuntime('runtime/historical-native-runtime.js'),
    loadRuntime('runtime/orthography-resolver.js')
  ]);
  const native = nativeSandbox.HistoricalNativeRuntime.createHistoricalNativeRuntime(v2Slice, {
    lexicalNamespaceId: namespaceId
  });

  const exactResolver = resolverSandbox.OrthographyResolver.createResolver({
    lexicalLookup(surface: string) { return surface === '思う' ? [candidate()] : []; },
    historicalLookup(value: Record<string, any>) { return native.lookup(value); },
    historicalSurfaceLookup(surface: string) { return native.lookupSurface(surface); }
  });
  const exact = exactResolver.resolveUnit('思う');
  assert.equal(exact.kind, 'resolved');
  assert.equal(exact.historical.surface, 'IDENTITY');
  assert.equal(exact.historical.disposition, 'AUTO');

  const fallbackResolver = resolverSandbox.OrthographyResolver.createResolver({
    lexicalLookup(surface: string) { return surface === '思う' ? [candidate('連用形-ウ音便')] : []; },
    historicalLookup(value: Record<string, any>) { return native.lookup(value); },
    historicalSurfaceLookup(surface: string) { return native.lookupSurface(surface); }
  });
  const fallback = fallbackResolver.resolveUnit('思う');
  assert.equal(fallback.kind, 'resolved');
  assert.equal(fallback.historical.surface, 'SURFACE');
  assert.equal(fallback.historical.disposition, 'AUTO');
});

test('resolver resolves unknown lexical units only by exact full-surface authority', async () => {
  const [nativeSandbox, resolverSandbox] = await Promise.all([
    loadRuntime('runtime/historical-native-runtime.js'),
    loadRuntime('runtime/orthography-resolver.js')
  ]);
  const native = nativeSandbox.HistoricalNativeRuntime.createHistoricalNativeRuntime(v2Slice, {
    lexicalNamespaceId: namespaceId
  });
  const resolver = resolverSandbox.OrthographyResolver.createResolver({
    lexicalLookup() { return []; },
    historicalSurfaceLookup(surface: string) { return native.lookupSurface(surface); }
  });

  const ue = resolver.resolveUnit('植え');
  assert.equal(ue.kind, 'resolved');
  assert.equal(ue.lexicalIdentity, null);
  assert.equal(ue.historical.route, 'native');
  assert.equal(ue.historical.surface, '植ゑ');
  assert.equal(ue.historical.disposition, 'AUTO');

  const embedded = resolver.resolveUnit('前植え後');
  assert.equal(embedded.kind, 'unresolved');
  assert.equal(embedded.historical.surface, '前植え後');
});

test('resolver preserves historical candidates and historical reading semantics', async () => {
  const [nativeSandbox, resolverSandbox] = await Promise.all([
    loadRuntime('runtime/historical-native-runtime.js'),
    loadRuntime('runtime/orthography-resolver.js')
  ]);
  const native = nativeSandbox.HistoricalNativeRuntime.createHistoricalNativeRuntime(v2Slice, {
    lexicalNamespaceId: namespaceId
  });
  const resolver = resolverSandbox.OrthographyResolver.createResolver({
    lexicalLookup(surface: string) {
      if (surface === '味わおう') {
        return [{
          lexicalIdentity: 'namespace-phase46d-test:lemma:2',
          lexicalOrigin: 'native',
          morphology: { conjugationType: '五段-ワア行', conjugationForm: '意志推量形' }
        }];
      }
      return [];
    },
    historicalLookup(value: Record<string, any>) { return native.lookup(value); },
    historicalSurfaceLookup(surface: string) { return native.lookupSurface(surface); }
  });

  const ambiguous = resolver.resolveUnit('味わおう');
  assert.equal(ambiguous.kind, 'resolved');
  assert.equal(ambiguous.historical.disposition, 'CANDIDATES');
  assert.equal(ambiguous.historical.surface, '味わおう');
  assert.deepEqual(Array.from(ambiguous.historical.candidates), ['味ははう', '味はゝう']);

  const ai = resolver.resolveUnit('藍');
  assert.equal(ai.kind, 'resolved');
  assert.equal(ai.historical.surface, '藍');
  assert.equal(ai.historical.kana, 'あゐ');
  assert.equal(resolver.render(ai, { mode: 'ruby-whole-explicit' }), '｜藍《あゐ》');

  const aigo = resolver.resolveUnit('アイゴ');
  assert.equal(aigo.historical.surface, 'アヰゴ');
  assert.equal(aigo.historical.kana, 'アヰゴ');

  assert.equal(resolver.resolveUnit('藍', { protected: true }).kind, 'protected');
});

test('real Phase 4.6D artifact exposes accepted exact and candidate native authority', async () => {
  const [sandbox, artifact] = await Promise.all([
    loadRuntime('runtime/historical-native-runtime.js'),
    readFile('data/historical/native/phase46d-native-kana.json', 'utf8').then(JSON.parse)
  ]);
  const runtime = sandbox.HistoricalNativeRuntime.createHistoricalNativeRuntime(artifact, {
    lexicalNamespaceId: artifact.lexicalNamespaceId
  });

  assert.equal(runtime.lookupSurface('植え').surface, '植ゑ');
  assert.equal(runtime.lookupSurface('藍').reading, 'あゐ');
  assert.deepEqual(Array.from(runtime.lookupSurface('味わおう').candidates), ['味ははう', '味はゝう']);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

async function loadRuntime(path: string, globals: Record<string, unknown> = {}) {
  const source = await readFile(path, 'utf8');
  const sandbox: Record<string, any> = { ...globals };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: path });
  return sandbox;
}

async function phase46dRuntime() {
  const [sandbox, artifact] = await Promise.all([
    loadRuntime('runtime/historical-native-runtime.js'),
    json('data/historical/native/phase46d-native-kana.json')
  ]);
  const runtime = sandbox.HistoricalNativeRuntime.createHistoricalNativeRuntime(artifact, {
    lexicalNamespaceId: artifact.lexicalNamespaceId
  });
  return { runtime, artifact };
}

test('v2 native runtime resolves exact whole surfaces and historical readings separately', async () => {
  const { runtime } = await phase46dRuntime();
  assert.equal(typeof runtime.lookupSurface, 'function');

  const ue = runtime.lookupSurface('植え');
  assert.equal(ue?.status, 'resolved');
  assert.equal(ue?.surface, '植ゑ');
  assert.equal(ue?.reading, null);
  assert.ok(Array.isArray(ue?.evidenceRefs) && ue.evidenceRefs.length > 0);

  const aisatsu = runtime.lookupSurface('挨拶');
  assert.equal(aisatsu?.status, 'resolved');
  assert.equal(aisatsu?.surface, '挨拶');
  assert.equal(aisatsu?.reading, 'あいさつ');

  const aigo = runtime.lookupSurface('アイゴ');
  assert.equal(aigo?.status, 'resolved');
  assert.equal(aigo?.surface, 'アヰゴ');
  assert.equal(aigo?.reading, 'アヰゴ');

  assert.equal(runtime.lookupSurface('植え物'), null);
  assert.equal(runtime.lookupSurface('ビハインド'), null);
});

test('v2 native runtime preserves surface and reading ambiguity without source-order winners', async () => {
  const { runtime } = await phase46dRuntime();

  const taste = runtime.lookupSurface('味わおう');
  assert.equal(taste?.status, 'candidates');
  assert.deepEqual(Array.from(taste.surfaceCandidates), ['味ははう', '味はゝう']);
  assert.deepEqual(Array.from(taste.readingCandidates), []);

  const ai = runtime.lookupSurface('藍');
  assert.equal(ai?.status, 'candidates');
  assert.deepEqual(Array.from(ai.surfaceCandidates), []);
  assert.deepEqual(Array.from(ai.readingCandidates), ['あゐ', 'アヰ']);
});

test('resolver prefers identity+morphology authority before exact-surface fallback', async () => {
  const [{ runtime }, resolverSandbox] = await Promise.all([
    phase46dRuntime(),
    loadRuntime('runtime/orthography-resolver.js')
  ]);
  const exactCandidate = {
    lexicalIdentity: 'unidic-cwj:2025.12:lemma:5255',
    lexicalOrigin: 'native',
    morphology: {
      conjugationType: '五段-ワア行',
      conjugationForm: '終止形-一般'
    },
    evidenceRefs: ['lexical:test:omou']
  };
  const resolver = resolverSandbox.OrthographyResolver.createResolver({
    lexicalLookup(surface: string) {
      return surface === '思う' ? [exactCandidate] : [];
    },
    historicalLookup(candidate: Record<string, any>) {
      return runtime.lookup(candidate);
    },
    historicalSurfaceLookup(surface: string) {
      return runtime.lookupSurface(surface);
    }
  });

  const resolved = resolver.resolveUnit('思う');
  assert.equal(resolved.historical.surface, '思ふ');
  assert.deepEqual(Array.from(resolved.historical.evidenceRefs), ['kkh-kana-omou-omofu']);

  const mismatchResolver = resolverSandbox.OrthographyResolver.createResolver({
    lexicalLookup(surface: string) {
      return surface === '思う'
        ? [{
            ...exactCandidate,
            morphology: {
              conjugationType: '五段-ワア行',
              conjugationForm: '連用形-一般'
            }
          }]
        : [];
    },
    historicalLookup(candidate: Record<string, any>) {
      return runtime.lookup(candidate);
    },
    historicalSurfaceLookup(surface: string) {
      return runtime.lookupSurface(surface);
    }
  });
  const fallback = mismatchResolver.resolveUnit('思う');
  assert.equal(fallback.historical.surface, '思ふ');
  assert.equal(fallback.historical.evidenceRefs.includes('kkh-kana-omou-omofu'), false);
});

test('resolver uses exact whole-surface fallback for unknown lexical surfaces without substring matching', async () => {
  const [{ runtime }, resolverSandbox] = await Promise.all([
    phase46dRuntime(),
    loadRuntime('runtime/orthography-resolver.js')
  ]);
  const resolver = resolverSandbox.OrthographyResolver.createResolver({
    lexicalLookup() { return []; },
    historicalSurfaceLookup(surface: string) { return runtime.lookupSurface(surface); }
  });

  const ue = resolver.resolveUnit('植え');
  assert.equal(ue.kind, 'resolved');
  assert.equal(ue.historical.surface, '植ゑ');
  assert.equal(ue.historical.disposition, 'AUTO');

  const longer = resolver.resolveUnit('植え物');
  assert.equal(longer.kind, 'unresolved');
  assert.equal(longer.historical.surface, '植え物');
});

test('resolver exposes native candidate metadata and historical readings without changing unrelated surfaces', async () => {
  const [{ runtime }, resolverSandbox] = await Promise.all([
    phase46dRuntime(),
    loadRuntime('runtime/orthography-resolver.js')
  ]);
  const resolver = resolverSandbox.OrthographyResolver.createResolver({
    lexicalLookup() { return []; },
    historicalSurfaceLookup(surface: string) { return runtime.lookupSurface(surface); }
  });

  const taste = resolver.resolveUnit('味わおう');
  assert.equal(taste.historical.disposition, 'CANDIDATES');
  assert.deepEqual(Array.from(taste.historical.nativeCandidates.surfaces), ['味ははう', '味はゝう']);
  assert.deepEqual(Array.from(taste.historical.nativeCandidates.readings), []);

  const aisatsu = resolver.resolveUnit('挨拶');
  assert.equal(aisatsu.historical.surface, '挨拶');
  assert.equal(aisatsu.historical.kana, 'あいさつ');
  assert.equal(aisatsu.historical.disposition, 'AUTO');

  const ai = resolver.resolveUnit('藍');
  assert.equal(ai.historical.surface, '藍');
  assert.equal(ai.historical.disposition, 'CANDIDATES');
  assert.deepEqual(Array.from(ai.historical.nativeCandidates.readings), ['あゐ', 'アヰ']);

  const aigo = resolver.resolveUnit('アイゴ');
  assert.equal(aigo.historical.surface, 'アヰゴ');
  assert.equal(aigo.historical.kana, 'アヰゴ');
});

test('protected input bypasses Phase 4.6D surface fallback', async () => {
  const [{ runtime }, resolverSandbox] = await Promise.all([
    phase46dRuntime(),
    loadRuntime('runtime/orthography-resolver.js')
  ]);
  const resolver = resolverSandbox.OrthographyResolver.createResolver({
    lexicalLookup() { return []; },
    historicalSurfaceLookup(surface: string) { return runtime.lookupSurface(surface); }
  });
  const protectedUnit = resolver.resolveUnit('植え', { protected: true });
  assert.equal(protectedUnit.kind, 'protected');
  assert.equal(protectedUnit.historical.surface, '植え');
  assert.equal(protectedUnit.historical.disposition, 'PRESERVE');
});


test('mixed native channels preserve an exact surface while exposing reading candidates', async () => {
  const [{ runtime }, resolverSandbox] = await Promise.all([
    phase46dRuntime(),
    loadRuntime('runtime/orthography-resolver.js')
  ]);

  const direct = runtime.lookupSurface('向こう');
  assert.equal(direct?.status, 'candidates');
  assert.equal(direct?.surface, '向かう');
  assert.equal(direct?.reading, null);
  assert.deepEqual(Array.from(direct?.surfaceCandidates ?? []), []);
  assert.deepEqual(Array.from(direct?.readingCandidates ?? []), ['むかう', 'むかふ']);

  const resolver = resolverSandbox.OrthographyResolver.createResolver({
    lexicalLookup() { return []; },
    historicalSurfaceLookup(surface: string) { return runtime.lookupSurface(surface); }
  });
  const resolved = resolver.resolveUnit('向こう');
  assert.equal(resolved.historical.disposition, 'CANDIDATES');
  assert.equal(resolved.historical.surface, '向かう');
  assert.equal(resolved.historical.kana, null);
  assert.deepEqual(Array.from(resolved.historical.nativeCandidates.readings), ['むかう', 'むかふ']);
});

test('mixed native channels preserve an exact reading while exposing surface candidates', async () => {
  const [{ runtime }, resolverSandbox] = await Promise.all([
    phase46dRuntime(),
    loadRuntime('runtime/orthography-resolver.js')
  ]);

  const direct = runtime.lookupSurface('うじうじ');
  assert.equal(direct?.status, 'candidates');
  assert.equal(direct?.surface, 'うじうじ');
  assert.equal(direct?.reading, 'うぢうぢ');
  assert.deepEqual(Array.from(direct?.surfaceCandidates ?? []), ['うじ〳〵', 'うぢうぢ']);
  assert.deepEqual(Array.from(direct?.readingCandidates ?? []), []);

  const resolver = resolverSandbox.OrthographyResolver.createResolver({
    lexicalLookup() { return []; },
    historicalSurfaceLookup(surface: string) { return runtime.lookupSurface(surface); }
  });
  const resolved = resolver.resolveUnit('うじうじ');
  assert.equal(resolved.historical.disposition, 'CANDIDATES');
  assert.equal(resolved.historical.surface, 'うじうじ');
  assert.equal(resolved.historical.kana, 'うぢうぢ');
  assert.deepEqual(Array.from(resolved.historical.nativeCandidates.surfaces), ['うじ〳〵', 'うぢうぢ']);
});


test('mixed native exact data also survives the unique lexical-candidate path', async () => {
  const [{ runtime }, resolverSandbox] = await Promise.all([
    phase46dRuntime(),
    loadRuntime('runtime/orthography-resolver.js')
  ]);
  const lexicalCandidate = {
    lexicalIdentity: 'test:native:mixed-channel',
    lexicalOrigin: 'native',
    morphology: null,
    components: [],
    evidenceRefs: ['test:lexical:mixed-channel']
  };
  const resolver = resolverSandbox.OrthographyResolver.createResolver({
    lexicalLookup() { return [lexicalCandidate]; },
    historicalLookup() { return null; },
    historicalSurfaceLookup(surface: string) { return runtime.lookupSurface(surface); }
  });

  const surfaceExact = resolver.resolveUnit('向こう');
  assert.equal(surfaceExact.historical.disposition, 'CANDIDATES');
  assert.equal(surfaceExact.historical.surface, '向かう');
  assert.deepEqual(Array.from(surfaceExact.historical.nativeCandidates.readings), ['むかう', 'むかふ']);

  const readingExact = resolver.resolveUnit('うじうじ');
  assert.equal(readingExact.historical.disposition, 'CANDIDATES');
  assert.equal(readingExact.historical.kana, 'うぢうぢ');
  assert.deepEqual(Array.from(readingExact.historical.nativeCandidates.surfaces), ['うじ〳〵', 'うぢうぢ']);
});

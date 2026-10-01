import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { compileBrowserPack } from '../tools/browser-pack-compiler.ts';
import { kanaConventionGraph } from '../tools/kana-rule-normalization.ts';
import { canonicalizeOrthographyKnowledge, type OrthographyKnowledgeGraph } from '../tools/orthography-knowledge-model.ts';
import { HISTORICAL_PROFILE, KINOTCH_PROFILE, MODERN_PROFILE, withProfileRules } from '../tools/orthography-policy.ts';

const { openBrowserPack } = createRequire(import.meta.url)('../runtime/browser-pack-runtime.js');
const prov = { sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] };

function fixture(): OrthographyKnowledgeGraph {
  const g = withProfileRules(kanaConventionGraph());
  g.sources.push({ sourceId: 'src:fixture' });
  g.facts.push(
    { id: 'fact:form_relation:熔接||溶接', kind: 'form_relation', lexicalRefs: ['lexeme:溶接/ようせつ'], surface: '熔接', target: '溶接', periodRefs: ['period:historical-kana'], ...prov },
    { id: 'fact:literal_form:溶接||', kind: 'literal_form', lexicalRefs: ['lexeme:溶接/ようせつ'], surface: '溶接', periodRefs: ['period:modern'], ...prov },
    { id: 'fact:literal_form:溶||', kind: 'literal_form', lexicalRefs: ['lexeme:溶/よう'], surface: '溶', periodRefs: ['period:modern'], ...prov },
    { id: 'fact:literal_form:𠮷野||', kind: 'literal_form', lexicalRefs: ['lexeme:𠮷野/よしの'], surface: '𠮷野', periodRefs: ['period:modern'], ...prov }
  );
  for (let i = 0; i < 300; i += 1) {
    const surface = `語${String(i).padStart(4, '0')}`;
    g.facts.push({ id: `fact:literal_form:${surface}||`, kind: 'literal_form', lexicalRefs: [`lexeme:${surface}/ご`], surface, periodRefs: ['period:modern'], ...prov });
  }
  return canonicalizeOrthographyKnowledge(g);
}

const build = compileBrowserPack(fixture(), [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE], { shardBudgetBytes: 4 * 1024 });
const provider = (requested: string[]) => async (section: { path: string; sectionId: string }) => {
  requested.push(section.sectionId);
  return build.files.get(section.path)!;
};

test('opening fetches only the eager sections; lookups fetch only the shards they reach', async () => {
  const requested: string[] = [];
  const pack = await openBrowserPack(build.manifest, provider(requested));
  const eager = build.manifest.sections.filter((s) => s.loading === 'eager').map((s) => s.sectionId).sort();
  assert.deepEqual([...requested].sort(), eager);
  await pack.findMatches('溶接する', 0);
  const knowledge = requested.filter((id) => id.includes('@surface/'));
  assert.ok(knowledge.length > 0 && knowledge.length <= 6, knowledge.join());
  assert.ok(!requested.some((id) => id.startsWith('detail-shard')));
  assert.ok(build.manifest.sections.filter((s) => s.kind === 'facts').length > 3);
});

test('known surfaces match their canonical facts; unknown text fabricates nothing', async () => {
  const pack = await openBrowserPack(build.manifest, provider([]));
  const matches = await pack.findMatches('溶接する', 0);
  assert.deepEqual(matches.map((m: any) => [m.start, m.end, m.surface]), [[0, 1, '溶'], [0, 2, '溶接']]);
  const yosetsu = matches[1].facts;
  assert.ok(yosetsu.some((f: any) => f.kind === 'form_relation' && f.surface === '熔接' && f.target === '溶接' && f.viaTarget && f.historical));
  assert.ok(yosetsu.some((f: any) => f.kind === 'literal_form' && f.modern));
  assert.deepEqual(await pack.findMatches('する', 0), []);
  assert.deepEqual(await pack.findMatches('☃', 0), []);
  const detail = await pack.loadDetail(yosetsu.find((f: any) => f.kind === 'form_relation').detailRef);
  assert.deepEqual(detail, { factId: 'fact:form_relation:熔接||溶接', lexicalRefs: ['lexeme:溶接/ようせつ'], tags: [], sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] });
});

test('UTF-16 offsets are preserved and surrogate pairs are never split', async () => {
  const pack = await openBrowserPack(build.manifest, provider([]));
  const text = 'あ𠮷野へ';
  await pack.prepare(text);
  const matches = pack.findMatchesSync(text, 1);
  assert.deepEqual(matches.map((m: any) => [m.start, m.end, m.surface]), [[1, 4, '𠮷野']]);
  assert.equal(text.slice(1, 4), '𠮷野');
});

test('lookups across shard boundaries resolve to the covering shard', async () => {
  const pack = await openBrowserPack(build.manifest, provider([]));
  const facts = build.manifest.sections.filter((s) => s.kind === 'facts');
  for (const section of facts) {
    for (const key of [section.shard!.from, section.shard!.to]) {
      const matches = await pack.findMatches(key, 0);
      assert.ok(matches.some((m: any) => m.surface === key), `${section.sectionId} ${key}`);
    }
  }
});

test('corrupt or foreign sections fail closed and are refetched rather than cached', async () => {
  const facts = build.manifest.sections.find((s) => s.kind === 'facts' && s.shard!.from <= '溶接' && '溶接' <= s.shard!.to)!;
  let corrupt = true;
  const pack = await openBrowserPack(build.manifest, async (section: { path: string; sectionId: string }) => {
    const body = build.files.get(section.path)!;
    if (section.sectionId === facts.sectionId && corrupt) { const copy = new Uint8Array(body); copy[copy.length - 1] = copy[copy.length - 1]! ^ 1; return copy; }
    return body;
  });
  await assert.rejects(() => pack.findMatches('溶接', 0), /digest mismatch/);
  corrupt = false;
  assert.equal((await pack.findMatches('溶接', 0)).length, 2);
  const tampered = { ...build.manifest, lexicalNamespaceId: 'other' };
  await assert.rejects(() => openBrowserPack(tampered, provider([])), /manifest digest mismatch/);
});

test('rules, bindings and profile policies are readable; VM-loaded runtime gives identical results', async () => {
  const pack = await openBrowserPack(build.manifest, provider([]));
  const rules = Array.from({ length: pack.ruleCount() }, (_, i) => pack.getRule(i));
  assert.ok(rules.some((r: any) => r.id === 'rule:kana:yotsugana-di' && r.lossiness === 'many_to_one'));
  assert.equal(pack.getProfilePolicy('kinotch-fixed').profile.profileId, 'kinotch-fixed');
  const sandbox: Record<string, any> = { crypto: globalThis.crypto, TextEncoder, TextDecoder };
  sandbox.globalThis = sandbox;
  for (const file of ['runtime/browser-pack-binary.js', 'runtime/browser-pack-runtime.js']) vm.runInNewContext(await readFile(file, 'utf8'), sandbox, { filename: file });
  const vmPack = await sandbox.BrowserPackRuntime.openBrowserPack(JSON.parse(JSON.stringify(build.manifest)), provider([]));
  assert.equal(JSON.stringify(await vmPack.findMatches('溶接', 0)), JSON.stringify(await pack.findMatches('溶接', 0)));
});

test('the committed real pack opens from its eager sections alone', async () => {
  const manifest = JSON.parse(await readFile('data/browser-pack/manifest.json', 'utf8'));
  const eagerBytes = manifest.sections.filter((s: any) => s.loading === 'eager').reduce((n: number, s: any) => n + s.byteLength, 0);
  assert.ok(eagerBytes < 1024 * 1024, `eager ${eagerBytes}`);
  assert.ok(manifest.sections.some((s: any) => s.kind === 'shard-directory'));
});

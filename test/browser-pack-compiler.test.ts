import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { compileBrowserPack, FACT_FLAGS } from '../tools/browser-pack-compiler.ts';
import { validateBrowserPackManifest, verifyBrowserPackSections } from '../tools/browser-pack-model.ts';
import { kanaConventionGraph } from '../tools/kana-rule-normalization.ts';
import { canonicalizeOrthographyKnowledge, type OrthographyKnowledgeGraph } from '../tools/orthography-knowledge-model.ts';
import { HISTORICAL_PROFILE, KINOTCH_PROFILE, MODERN_PROFILE, withProfileRules } from '../tools/orthography-policy.ts';

const { decodeSection } = createRequire(import.meta.url)('../runtime/browser-pack-binary.js');
const prov = { sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] };
const PROFILES = [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE];

function fixture(extraFacts = 0): OrthographyKnowledgeGraph {
  const g = withProfileRules(kanaConventionGraph());
  g.sources.push({ sourceId: 'src:fixture' });
  g.facts.push(
    { id: 'fact:form_relation:熔接||溶接', kind: 'form_relation', lexicalRefs: ['lexeme:溶接/ようせつ'], surface: '熔接', target: '溶接', periodRefs: ['period:historical-kana'], tags: ['lexical_historical_kanji'], ...prov },
    { id: 'fact:literal_reading:今日|けふ|', kind: 'literal_reading', lexicalRefs: [], surface: '今日', reading: 'けふ', periodRefs: ['period:historical-kana'], ...prov },
    { id: 'fact:literal_form:独逸||', kind: 'literal_form', lexicalRefs: ['lexeme:独逸/ドイツ'], surface: '独逸', tags: ['ateji', 'rK'], periodRefs: ['period:modern'], ...prov },
    { id: 'fact:literal_reading:|あいつ|', kind: 'literal_reading', lexicalRefs: ['lexeme:あいつ/あいつ'], reading: 'あいつ', periodRefs: ['period:modern'], ...prov }
  );
  for (let i = 0; i < extraFacts; i += 1) {
    const surface = `語${String(i).padStart(5, '0')}`;
    g.facts.push({ id: `fact:literal_form:${surface}||`, kind: 'literal_form', lexicalRefs: [`lexeme:${surface}/ご`], surface, periodRefs: ['period:modern'], ...prov });
  }
  return canonicalizeOrthographyKnowledge(g);
}

const bodies = (build: ReturnType<typeof compileBrowserPack>) => new Map(build.manifest.sections.map((s) => [s.sectionId, build.files.get(s.path)!]));

test('identical inputs rebuild byte-identically and pass the unit-A validator', () => {
  const a = compileBrowserPack(fixture(), PROFILES);
  const b = compileBrowserPack(canonicalizeOrthographyKnowledge(structuredClone(fixture())), PROFILES);
  assert.deepEqual(a.manifest, b.manifest);
  for (const [path, body] of a.files) assert.deepEqual(body, b.files.get(path), path);
  assert.doesNotThrow(() => validateBrowserPackManifest(JSON.parse(JSON.stringify(a.manifest))));
  assert.doesNotThrow(() => verifyBrowserPackSections(a.manifest, bodies(a)));
});

test('source or canonical change changes pack identity', () => {
  const base = compileBrowserPack(fixture(), PROFILES).manifest;
  const changed = fixture();
  changed.facts[0] = { ...changed.facts[0]!, evidenceRefs: ['ev:other'] };
  const other = compileBrowserPack(changed, PROFILES).manifest;
  assert.notEqual(other.packDigest, base.packDigest);
  assert.notEqual(other.canonicalGraphSha256, base.canonicalGraphSha256);
  const sources = fixture();
  sources.sources.push({ sourceId: 'src:extra' });
  assert.notEqual(compileBrowserPack(sources, PROFILES).manifest.sourceSetDigest, base.sourceSetDigest);
});

test('profiles share one knowledge set and contribute only policy descriptors', () => {
  const one = compileBrowserPack(fixture(), [MODERN_PROFILE]);
  const three = compileBrowserPack(fixture(), PROFILES);
  const knowledge = (b: typeof one) => b.manifest.sections.filter((s) => s.kind !== 'profile-policy').map((s) => [s.sectionId, s.sha256]);
  assert.deepEqual(knowledge(three), knowledge(one));
  assert.deepEqual(three.manifest.sections.filter((s) => s.kind === 'profile-policy').map((s) => s.sectionId), ['profile-policy@historical', 'profile-policy@kinotch-fixed', 'profile-policy@modern']);
  for (const s of three.manifest.sections.filter((x) => x.kind === 'profile-policy')) assert.ok(s.byteLength < 2048, s.sectionId);
});

test('rows are addressable directly from binary views and every canonical record survives compaction', () => {
  const graph = fixture(400);
  const build = compileBrowserPack(graph, PROFILES, { shardBudgetBytes: 8 * 1024 });
  const facts = build.manifest.sections.filter((s) => s.kind === 'facts');
  assert.ok(facts.length > 1, 'small budget forces several shards');
  const seen = new Set<number>();
  for (const section of facts) {
    const f = decodeSection(build.files.get(section.path));
    const pool = decodeSection(build.files.get(section.path.replace('facts-', 'string-pool-'))!);
    const detail = decodeSection(build.files.get(section.path.replace('facts-', 'detail-shard-'))!);
    assert.ok(ArrayBuffer.isView(f.column('factIndex').values));
    for (let row = 0; row < f.rowCount('kind'); row += 1) {
      const canonical = graph.facts[f.value('factIndex', row)]!;
      seen.add(f.value('factIndex', row));
      const str = (col: string) => { const id = f.value(col, row); return id === 0 ? undefined : pool.string('strings', id); };
      assert.equal(str('surface'), canonical.surface);
      assert.equal(str('reading'), canonical.reading);
      assert.equal(str('target'), canonical.target);
      assert.equal(detail.string('strings', detail.value('factId', row)), canonical.id);
      assert.deepEqual([...detail.list('sourceRefs', row)].map((id: number) => detail.string('strings', id)), canonical.sourceRefs);
      assert.deepEqual([...detail.list('evidenceRefs', row)].map((id: number) => detail.string('strings', id)), canonical.evidenceRefs);
    }
  }
  assert.equal(seen.size, graph.facts.length);
  const ateji = graph.facts.findIndex((x) => x.surface === '独逸');
  const relation = graph.facts.findIndex((x) => x.surface === '熔接');
  const flagsOf = (factIndex: number) => {
    for (const section of facts) {
      const f = decodeSection(build.files.get(section.path));
      for (let row = 0; row < f.rowCount('kind'); row += 1) if (f.value('factIndex', row) === factIndex) return f.value('flags', row);
    }
    return -1;
  };
  assert.ok(flagsOf(ateji) & FACT_FLAGS.ateji);
  assert.ok(flagsOf(relation) & FACT_FLAGS.historical);
  const rules = decodeSection(build.files.get('rules.bin')!);
  assert.equal(rules.rowCount('id'), graph.rules.length);
});

test('a form relation is reachable from both its historical surface and its modern target', () => {
  const build = compileBrowserPack(fixture(), PROFILES);
  const keys: string[] = [];
  for (const section of build.manifest.sections.filter((s) => s.kind === 'lexical-index')) {
    const index = decodeSection(build.files.get(section.path)!);
    const pool = decodeSection(build.files.get(section.path.replace('lexical-index-', 'string-pool-'))!);
    for (let i = 0; i < index.rowCount('key'); i += 1) keys.push(pool.string('strings', index.value('key', i)));
  }
  assert.ok(keys.includes('熔接') && keys.includes('溶接'));
  assert.ok(keys.includes('あいつ'));
});

test('corruption fails closed', () => {
  const build = compileBrowserPack(fixture(), PROFILES);
  const map = bodies(build);
  const facts = build.manifest.sections.find((s) => s.kind === 'facts')!;
  const tampered = new Uint8Array(map.get(facts.sectionId)!);
  tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;
  map.set(facts.sectionId, tampered);
  assert.throws(() => verifyBrowserPackSections(build.manifest, map), /digest mismatch/);
  assert.throws(() => decodeSection(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0])), /bad magic/);
  const truncated = build.files.get('rules.bin')!.slice(0, 40);
  assert.throws(() => decodeSection(truncated), /out of range|truncated/);
});

test('a fact is contextual only when a context constraint is attached', () => {
  const g = fixture();
  g.facts.push(
    { id: 'fact:form_relation:颱風||台風', kind: 'form_relation', lexicalRefs: [], surface: '颱風', target: '台風', periodRefs: ['period:historical-kana'], tags: ['contextual_kanji', 'context:constraint-taifu'], ...prov },
    { id: 'fact:form_relation:讃嘆||賛嘆', kind: 'form_relation', lexicalRefs: [], surface: '讃嘆', target: '賛嘆', periodRefs: ['period:historical-kana'], tags: ['contextual_kanji', 'lexical_historical_kanji'], ...prov }
  );
  const graph = canonicalizeOrthographyKnowledge(g);
  const build = compileBrowserPack(graph, PROFILES);
  const flags = new Map<string, number>();
  for (const section of build.manifest.sections.filter((s) => s.kind === 'facts')) {
    const f = decodeSection(build.files.get(section.path));
    for (let row = 0; row < f.rowCount('kind'); row += 1) flags.set(graph.facts[f.value('factIndex', row)]!.id, f.value('flags', row));
  }
  assert.ok(flags.get('fact:form_relation:颱風||台風')! & FACT_FLAGS.contextual);
  assert.equal(flags.get('fact:form_relation:讃嘆||賛嘆')! & FACT_FLAGS.contextual, 0);
});

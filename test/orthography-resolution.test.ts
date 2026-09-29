import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

type Fixture = {
  lexicalRecords: Array<Record<string, any>>;
  historicalRelations: Array<Record<string, any>>;
  safeKanjiMap: Record<string, string>;
};

type Resolver = {
  resolveUnit: (input: string, options?: { protected?: boolean }) => any;
  render: (unit: any, options?: { mode?: string }) => string;
};

type ResolverApi = {
  createResolver: (config: Record<string, any>) => Resolver;
};

const loadUmd = async (path: string, globals: Record<string, unknown> = {}) => {
  const source = await readFile(path, "utf8");
  const sandbox: Record<string, any> = { ...globals };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: path });
  return sandbox;
};

const loadJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, "utf8")) as T;

const createHarness = async () => {
  const fixture = await loadJson<Fixture>("test/fixtures/orthography-resolution/first-slice.json");
  const contextualRelations = await loadJson<any[]>("test/golden/contextual-kanji/hot-relations.json");
  const contextualSafety = await loadJson<any[]>("test/golden/contextual-kanji/hot-safety.json");
  const sharedSandbox = await loadUmd("runtime/transform-shared.js");
  const resolverSandbox = await loadUmd("runtime/orthography-resolver.js", {
    TransformShared: sharedSandbox.TransformShared
  });
  const api = resolverSandbox.OrthographyResolver as ResolverApi;
  assert.equal(typeof api?.createResolver, "function");

  let lexicalLookupCount = 0;
  const resolver = api.createResolver({
    lexicalLookup(surface: string) {
      lexicalLookupCount += 1;
      return fixture.lexicalRecords.filter((record) => record.surface === surface);
    },
    historicalLookup(candidate: Record<string, any>) {
      return fixture.historicalRelations.find((relation) => relation.lexicalIdentity === candidate.lexicalIdentity) ?? null;
    },
    contextualRelations,
    contextualSafety,
    safeKanjiMap: fixture.safeKanjiMap
  });

  return {
    resolver,
    getLexicalLookupCount: () => lexicalLookupCount
  };
};

const semanticCore = (unit: any) => ({
  kind: unit.kind,
  sourceSurface: unit.sourceSurface,
  lexicalIdentity: unit.lexicalIdentity,
  modernReading: unit.reading?.modernSurface,
  lexicalOrigin: unit.lexicalOrigin,
  morphology: unit.morphology ?? null,
  components: Array.from(unit.components ?? [], (component: any) => ({
    surface: component.surface,
    lexicalIdentity: component.lexicalIdentity,
    lexicalReading: component.lexicalReading,
    lexicalOrigin: component.lexicalOrigin,
    readingClass: component.readingClass,
    historicalKana: component.historicalKana,
    renderedSurface: component.renderedSurface
  })),
  historical: unit.historical == null ? null : JSON.parse(JSON.stringify(unit.historical))
});

test("学校 plain input resolves lexical, component, 字音, and safe-kanji semantics", async () => {
  const { resolver } = await createHarness();
  const unit = resolver.resolveUnit("学校");

  assert.equal(unit.kind, "resolved");
  assert.equal(unit.sourceSurface, "学校");
  assert.equal(unit.lexicalIdentity, "lex-gakkou");
  assert.equal(unit.reading.modernSurface, "がっこう");
  assert.equal(unit.reading.source, "lexical");
  assert.equal(unit.lexicalOrigin, "sino");
  assert.deepEqual(
    Array.from(unit.components, (component: any) => [
      component.surface,
      component.lexicalReading,
      component.historicalKana,
      component.renderedSurface
    ]),
    [
      ["学", "がく", "がく", "學"],
      ["校", "こう", "かう", "校"]
    ]
  );
  assert.equal(unit.historical.route, "sino");
  assert.equal(unit.historical.kana, "がくかう");
  assert.equal(unit.historical.surface, "學校");
  assert.equal(unit.historical.disposition, "AUTO");
});

test("学校 plain, whole Ruby, and component Ruby converge semantically", async () => {
  const { resolver } = await createHarness();
  const plain = resolver.resolveUnit("学校");
  const wholeExplicit = resolver.resolveUnit("｜学校《がっこう》");
  const wholeImplicit = resolver.resolveUnit("学校《がっこう》");
  const componentsExplicit = resolver.resolveUnit("｜学《がく》校《こう》");
  const componentsImplicit = resolver.resolveUnit("学《がく》校《こう》");

  for (const unit of [wholeExplicit, wholeImplicit, componentsExplicit, componentsImplicit]) {
    assert.deepEqual(semanticCore(unit), semanticCore(plain));
  }

  assert.equal(wholeExplicit.reading.source, "ruby-word");
  assert.equal(wholeImplicit.reading.source, "ruby-word");
  assert.deepEqual(Array.from(componentsExplicit.components, (component: any) => component.readingSource), ["ruby-component", "ruby-component"]);
  assert.deepEqual(Array.from(componentsImplicit.components, (component: any) => component.readingSource), ["ruby-component", "ruby-component"]);
  assert.equal(componentsExplicit.reading.modernSurface, "がっこう");
  assert.equal(componentsExplicit.reading.source, "lexical");
});

test("whole Ruby filters ambiguous lexical candidates before disposition", async () => {
  const sharedSandbox = await loadUmd("runtime/transform-shared.js");
  const resolverSandbox = await loadUmd("runtime/orthography-resolver.js", {
    TransformShared: sharedSandbox.TransformShared
  });
  const api = resolverSandbox.OrthographyResolver as ResolverApi;
  const candidates = [
    { lexicalIdentity: "unidic-cwj:2025.12:lemma:9128", surface: "今日", reading: "きょう", lexicalOrigin: "native", evidenceRefs: ["unidic-cwj:2025.12:lemma:9128"] },
    { lexicalIdentity: "unidic-cwj:2025.12:lemma:13244", surface: "今日", reading: "こんにち", lexicalOrigin: "sino", evidenceRefs: ["unidic-cwj:2025.12:lemma:13244"] }
  ];
  const resolver = api.createResolver({ lexicalLookup: (surface: string) => surface === "今日" ? candidates : [] });
  assert.equal(resolver.resolveUnit("今日").kind, "candidates");
  const native = resolver.resolveUnit("｜今日《きょう》");
  assert.equal(native.kind, "resolved");
  assert.equal(native.lexicalIdentity, "unidic-cwj:2025.12:lemma:9128");
  assert.equal(native.reading.source, "ruby-word");
  assert.equal(native.lexicalOrigin, "native");
  const sino = resolver.resolveUnit("｜今日《こんにち》");
  assert.equal(sino.kind, "resolved");
  assert.equal(sino.lexicalIdentity, "unidic-cwj:2025.12:lemma:13244");
  assert.equal(sino.lexicalOrigin, "sino");
});

test("台風 resolves contextually to 颱風 without global 台 replacement", async () => {
  const { resolver } = await createHarness();
  const taifu = resolver.resolveUnit("台風");

  assert.equal(taifu.historical.contextualKanji.status, "resolved");
  assert.equal(taifu.historical.contextualKanji.target, "颱風");
  assert.deepEqual(Array.from(taifu.historical.contextualKanji.candidates), ["颱風"]);
  assert.equal(taifu.historical.surface, "颱風");

  const unknownTai = resolver.resolveUnit("台本");
  assert.equal(unknownTai.kind, "unresolved");
  assert.equal(unknownTai.sourceSurface, "台本");
});

test("合弁 keeps competing historical targets as candidates", async () => {
  const { resolver } = await createHarness();
  const unit = resolver.resolveUnit("合弁");

  assert.equal(unit.historical.contextualKanji.status, "candidates");
  assert.deepEqual(Array.from(unit.historical.contextualKanji.candidates), ["合瓣", "合辦"]);
  assert.equal(unit.historical.contextualKanji.target, null);
  assert.equal(unit.historical.surface, "合弁");
  assert.equal(unit.historical.disposition, "CANDIDATES");
});

test("武弁 preserves an explicit lexical safety exception", async () => {
  const { resolver } = await createHarness();
  const unit = resolver.resolveUnit("武弁");

  assert.equal(unit.historical.contextualKanji.status, "preserve");
  assert.equal(unit.historical.surface, "武弁");
  assert.equal(unit.historical.disposition, "PRESERVE");
});

test("native inflected input uses morphology-aware historical relation", async () => {
  const { resolver } = await createHarness();
  const unit = resolver.resolveUnit("合わない");

  assert.equal(unit.lexicalIdentity, "lex-awanai");
  assert.equal(unit.morphology.conjugationType, "godan-w-row");
  assert.equal(unit.historical.route, "native");
  assert.equal(unit.historical.kana, "あはない");
  assert.equal(unit.historical.surface, "合はない");
  assert.equal(unit.historical.disposition, "AUTO");
});

test("unknown lexical input remains unresolved", async () => {
  const { resolver } = await createHarness();
  const unit = resolver.resolveUnit("未知語");

  assert.equal(unit.kind, "unresolved");
  assert.equal(unit.sourceSurface, "未知語");
  assert.equal(unit.historical.disposition, "UNRESOLVED");
  assert.equal(unit.lexicalIdentity, null);
});

test("serializers render one 学校 semantic result without re-analysis", async () => {
  const { resolver, getLexicalLookupCount } = await createHarness();
  const unit = resolver.resolveUnit("学校");
  const afterResolve = getLexicalLookupCount();

  assert.equal(resolver.render(unit, { mode: "plain" }), "學校");
  assert.equal(resolver.render(unit, { mode: "ruby-whole-explicit" }), "｜學校《がくかう》");
  assert.equal(resolver.render(unit, { mode: "ruby-whole-implicit" }), "學校《がくかう》");
  assert.equal(resolver.render(unit, { mode: "ruby-components-explicit" }), "｜學《がく》校《かう》");
  assert.equal(resolver.render(unit, { mode: "ruby-components-implicit" }), "學《がく》校《かう》");
  assert.equal(getLexicalLookupCount(), afterResolve);
});

test("protected unit round-trips without invoking lexical resolution", async () => {
  const { resolver, getLexicalLookupCount } = await createHarness();
  const before = getLexicalLookupCount();
  const source = "｜学校《がっこう》";
  const unit = resolver.resolveUnit(source, { protected: true });

  assert.equal(unit.kind, "protected");
  assert.equal(unit.historical.disposition, "PRESERVE");
  assert.equal(resolver.render(unit), source);
  assert.equal(getLexicalLookupCount(), before);
});

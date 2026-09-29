import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

type Fixture = {
  lexicalRecords: Array<Record<string, any>>;
  historicalRelations: Array<Record<string, any>>;
  safeKanjiMap: Record<string, string>;
};

const loadUmd = async (path: string, globals: Record<string, unknown> = {}) => {
  const source = await readFile(path, "utf8");
  const sandbox: Record<string, any> = { ...globals };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: path });
  return sandbox;
};

test("partial viable-binding coverage cannot become an automatic contextual target", async () => {
  const fixture = JSON.parse(
    await readFile("test/fixtures/orthography-resolution/first-slice.json", "utf8")
  ) as Fixture;
  const allRelations = JSON.parse(
    await readFile("test/golden/contextual-kanji/hot-relations.json", "utf8")
  ) as Array<Record<string, any>>;
  const contextualSafety = JSON.parse(
    await readFile("test/golden/contextual-kanji/hot-safety.json", "utf8")
  ) as Array<Record<string, any>>;

  const shared = await loadUmd("runtime/transform-shared.js");
  const resolverModule = await loadUmd("runtime/orthography-resolver.js", {
    TransformShared: shared.TransformShared
  });

  const resolver = resolverModule.OrthographyResolver.createResolver({
    lexicalLookup(surface: string) {
      return fixture.lexicalRecords.filter((record) => record.surface === surface);
    },
    historicalLookup(candidate: Record<string, any>) {
      return fixture.historicalRelations.find(
        (relation) => relation.lexicalIdentity === candidate.lexicalIdentity
      ) ?? null;
    },
    contextualRelations: allRelations.filter((relation) => relation.id === "rel-goben-botanical"),
    contextualSafety,
    safeKanjiMap: fixture.safeKanjiMap
  });

  const unit = resolver.resolveUnit("合弁");

  assert.equal(unit.historical.contextualKanji.status, "candidates");
  assert.equal(unit.historical.contextualKanji.target, null);
  assert.deepEqual(Array.from(unit.historical.contextualKanji.candidates), ["合瓣"]);
  assert.equal(unit.historical.disposition, "CANDIDATES");
});

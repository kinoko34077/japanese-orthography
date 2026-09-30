(function (root, factory) {
  const api = factory(
    root.LexicalRuntime,
    root.HistoricalNativeRuntime,
    root.HistoricalSinoRuntime,
    root.SafeCharacterRuntime,
    root.OrthographyResolver
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ResolverBundleRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  LexicalRuntime,
  HistoricalNativeRuntime,
  HistoricalSinoRuntime,
  SafeCharacterRuntime,
  OrthographyResolver
) {
  "use strict";

  const REQUIRED_CAPABILITIES = [
    "lexical",
    "historical-native",
    "historical-sino",
    "contextual-kanji",
    "safe-character",
    "late-rendering"
  ];
  const REQUIRED_SECTIONS = [
    "lexical",
    "historical-native",
    "historical-sino",
    "contextual-kanji",
    "safe-character"
  ];

  const requireNonEmptyString = (value, label) => {
    if (typeof value !== "string" || value.trim() === "") throw new TypeError(`Invalid ${label}`);
  };
  const requireSha256 = (value, label) => {
    if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new TypeError(`Invalid ${label}`);
  };
  const requireApi = (owner, key, label) => {
    if (typeof owner?.[key] !== "function") throw new TypeError(`Missing resolver bundle runtime dependency: ${label}`);
  };

  const validateArtifact = (artifact) => {
    if (artifact?.schemaVersion !== "1" || artifact?.kind !== "japanese-orthography-resolver-bundle-artifact") {
      throw new TypeError("Unsupported resolver bundle artifact");
    }
    if (artifact.bundleSemantics !== "phase3-first-slice-v1") {
      throw new TypeError("Unsupported resolver bundle semantics");
    }
    requireSha256(artifact.bundleContentId, "resolver bundle content id");

    if (!Array.isArray(artifact.capabilities) || artifact.capabilities.length !== REQUIRED_CAPABILITIES.length ||
      !REQUIRED_CAPABILITIES.every((value, index) => artifact.capabilities[index] === value)) {
      throw new Error("Resolver bundle capability declaration mismatch");
    }

    if (!Array.isArray(artifact.sections)) throw new TypeError("Resolver bundle requires sections");
    const sectionIds = new Set();
    for (const section of artifact.sections) {
      requireNonEmptyString(section?.id, "resolver bundle section id");
      requireSha256(section?.contentId, "resolver bundle section content id");
      if (sectionIds.has(section.id)) throw new Error(`Duplicate resolver bundle section: ${section.id}`);
      sectionIds.add(section.id);
    }
    for (const id of REQUIRED_SECTIONS) {
      if (!sectionIds.has(id)) throw new Error(`Missing resolver bundle section: ${id}`);
    }

    const lexicalNamespaceId = artifact.lexicalArtifact?.lexicalNamespaceId;
    requireNonEmptyString(lexicalNamespaceId, "resolver bundle lexical namespace");
    const lexicalSection = artifact.sections.find((section) => section.id === "lexical");
    if (lexicalSection.contentId !== artifact.lexicalArtifact?.artifactContentId) {
      throw new Error("Resolver bundle lexical section identity mismatch");
    }
    if (artifact.historicalNativeSlice?.lexicalNamespaceId !== lexicalNamespaceId) {
      throw new Error("Resolver bundle native lexical namespace mismatch");
    }
    if (artifact.historicalSinoSlice?.lexicalNamespaceId !== lexicalNamespaceId) {
      throw new Error("Resolver bundle Sino lexical namespace mismatch");
    }
    if (artifact.contextual?.sourceLexicalNamespaceId !== lexicalNamespaceId) {
      throw new Error("Resolver bundle contextual source lexical namespace mismatch");
    }
    requireNonEmptyString(artifact.contextual?.bindingNamespaceId, "resolver bundle contextual binding namespace");
    if (!Array.isArray(artifact.contextual?.relations) || artifact.contextual.relations.length === 0) {
      throw new Error("Resolver bundle requires contextual relations");
    }
    if (!Array.isArray(artifact.contextual?.safety)) {
      throw new Error("Resolver bundle requires contextual safety section");
    }
    if (!artifact.safeCharacterSlice) throw new Error("Resolver bundle requires safe-character slice");
    return lexicalNamespaceId;
  };

  const createResolverBundle = (artifact) => {
    requireApi(LexicalRuntime, "createLexicalRuntime", "LexicalRuntime.createLexicalRuntime");
    requireApi(HistoricalNativeRuntime, "createHistoricalNativeRuntime", "HistoricalNativeRuntime.createHistoricalNativeRuntime");
    requireApi(HistoricalSinoRuntime, "createHistoricalSinoRuntime", "HistoricalSinoRuntime.createHistoricalSinoRuntime");
    requireApi(SafeCharacterRuntime, "createSafeCharacterRuntime", "SafeCharacterRuntime.createSafeCharacterRuntime");
    requireApi(OrthographyResolver, "createResolver", "OrthographyResolver.createResolver");

    const lexicalNamespaceId = validateArtifact(artifact);
    const lexical = LexicalRuntime.createLexicalRuntime(artifact.lexicalArtifact);
    if (lexical.lexicalNamespaceId !== lexicalNamespaceId) throw new Error("Resolver bundle lexical runtime namespace mismatch");
    const historicalNative = HistoricalNativeRuntime.createHistoricalNativeRuntime(
      artifact.historicalNativeSlice,
      { lexicalNamespaceId }
    );
    const historicalSino = HistoricalSinoRuntime.createHistoricalSinoRuntime(
      artifact.historicalSinoSlice,
      { lexicalNamespaceId }
    );
    const safeCharacter = SafeCharacterRuntime.createSafeCharacterRuntime(artifact.safeCharacterSlice);

    const historicalLookup = (candidate) => {
      const nativeRelation = historicalNative.lookup(candidate);
      const sinoRelation = historicalSino.lookup(candidate);
      if (nativeRelation && sinoRelation) throw new Error("Resolver bundle historical route collision");
      return nativeRelation ?? sinoRelation ?? null;
    };

    const resolver = OrthographyResolver.createResolver({
      lexicalLookup(surface) { return lexical.lookup(surface); },
      historicalLookup,
      contextualRelations: artifact.contextual.relations,
      contextualSafety: artifact.contextual.safety,
      safeKanjiMap: safeCharacter.characterMap
    });

    const capabilities = Object.freeze([...artifact.capabilities]);
    return Object.freeze({
      bundleContentId: artifact.bundleContentId,
      lexicalNamespaceId,
      capabilities,
      resolveUnit(input, options) { return resolver.resolveUnit(input, options); },
      render(unit, options) { return resolver.render(unit, options); }
    });
  };

  return { createResolverBundle };
});

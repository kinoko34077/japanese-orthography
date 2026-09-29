(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.HistoricalNativeRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const requireNonEmptyString = (value, label) => {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(`Invalid ${label}`);
    }
  };

  const morphologyMatches = (required, actual) => {
    if (!required) return true;
    if (!actual) return false;
    if (required.conjugationType && required.conjugationType !== actual.conjugationType) return false;
    if (required.conjugationForm && required.conjugationForm !== actual.conjugationForm) return false;
    return true;
  };

  const createHistoricalNativeRuntime = (slice, options = {}) => {
    if (slice?.schemaVersion !== "1" || slice?.kind !== "japanese-orthography-historical-native-slice") {
      throw new TypeError("Unsupported historical native slice");
    }
    requireNonEmptyString(slice.lexicalNamespaceId, "historical native lexical namespace");
    const expectedNamespace = options.lexicalNamespaceId ?? slice.lexicalNamespaceId;
    if (slice.lexicalNamespaceId !== expectedNamespace) {
      throw new Error("Historical native lexical namespace mismatch");
    }

    const relationByIdentity = new Map();
    for (const relation of Array.isArray(slice.relations) ? slice.relations : []) {
      requireNonEmptyString(relation?.lexicalIdentity, "historical native lexical identity");
      requireNonEmptyString(relation?.surface, "historical native surface");
      requireNonEmptyString(relation?.historicalSurface, "historical native historical surface");
      relationByIdentity.set(relation.lexicalIdentity, {
        route: "native",
        reading: null,
        surface: relation.historicalSurface,
        requiresMorphology: Boolean(relation.requiredMorphology),
        requiredMorphology: relation.requiredMorphology ?? null,
        evidenceRefs: Array.isArray(relation.evidenceRefs) ? [...relation.evidenceRefs] : []
      });
    }

    const lookup = (candidate) => {
      if (candidate?.lexicalOrigin !== "native") return null;
      requireNonEmptyString(candidate?.lexicalIdentity, "candidate lexical identity");
      const relation = relationByIdentity.get(candidate.lexicalIdentity) ?? null;
      if (!relation) return null;
      if (!morphologyMatches(relation.requiredMorphology, candidate.morphology)) return null;
      return relation;
    };

    return {
      lexicalNamespaceId: slice.lexicalNamespaceId,
      source: slice.source ?? null,
      lookup
    };
  };

  return { createHistoricalNativeRuntime };
});

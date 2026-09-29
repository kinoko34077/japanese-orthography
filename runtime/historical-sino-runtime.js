(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.HistoricalSinoRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const requireNonEmptyString = (value, label) => {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(`Invalid ${label}`);
    }
  };

  const normalizeComponent = (component) => {
    requireNonEmptyString(component?.surface, "historical Sino component surface");
    requireNonEmptyString(component?.modernReading, "historical Sino component modern reading");
    requireNonEmptyString(component?.historicalReading, "historical Sino component historical reading");
    return {
      lexicalIdentity: null,
      surface: component.surface,
      lexicalReading: component.modernReading,
      lexicalOrigin: "sino",
      readingClass: component.readingClass ?? "on",
      historicalKana: component.historicalReading,
      evidenceRefs: Array.isArray(component.evidenceRefs) ? [...component.evidenceRefs] : []
    };
  };

  const normalizeRelation = (relation) => {
    requireNonEmptyString(relation?.lexicalIdentity, "historical Sino lexical identity");
    requireNonEmptyString(relation?.surface, "historical Sino surface");
    requireNonEmptyString(relation?.historicalReading, "historical Sino historical reading");
    return {
      route: "sino",
      reading: relation.historicalReading,
      surface: relation.surface,
      components: Array.isArray(relation.components) ? relation.components.map(normalizeComponent) : [],
      evidenceRefs: Array.isArray(relation.evidenceRefs) ? [...relation.evidenceRefs] : []
    };
  };

  const createHistoricalSinoRuntime = (slice, options = {}) => {
    if (slice?.schemaVersion !== "1" || slice?.kind !== "japanese-orthography-historical-sino-slice") {
      throw new TypeError("Unsupported historical Sino slice");
    }
    requireNonEmptyString(slice.lexicalNamespaceId, "historical Sino lexical namespace");
    const expectedNamespace = options.lexicalNamespaceId ?? slice.lexicalNamespaceId;
    if (slice.lexicalNamespaceId !== expectedNamespace) {
      throw new Error("Historical Sino lexical namespace mismatch");
    }

    const relationByIdentity = new Map();
    for (const relation of Array.isArray(slice.relations) ? slice.relations : []) {
      if (relationByIdentity.has(relation?.lexicalIdentity)) {
        throw new Error(`Duplicate historical Sino relation: ${relation.lexicalIdentity}`);
      }
      relationByIdentity.set(relation.lexicalIdentity, normalizeRelation(relation));
    }

    const lookup = (candidate) => {
      if (candidate?.lexicalOrigin !== "sino") {
        return null;
      }
      requireNonEmptyString(candidate?.lexicalIdentity, "candidate lexical identity");
      return relationByIdentity.get(candidate.lexicalIdentity) ?? null;
    };

    return {
      lexicalNamespaceId: slice.lexicalNamespaceId,
      source: slice.source ?? null,
      lookup
    };
  };

  return { createHistoricalSinoRuntime };
});

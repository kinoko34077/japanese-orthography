(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.LexicalRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

  const findSurface = (surfaceIndex, surface) => {
    let low = 0;
    let high = surfaceIndex.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const entry = surfaceIndex[mid];
      const cmp = compareText(entry.surface, surface);
      if (cmp === 0) return entry;
      if (cmp < 0) low = mid + 1;
      else high = mid - 1;
    }
    return null;
  };

  const chooseReading = (lemma, modernReadings) => {
    if (modernReadings.length === 1) return modernReadings[0];
    if (modernReadings.includes(lemma.lexicalReading)) return lemma.lexicalReading;
    return lemma.lexicalReading ?? modernReadings[0] ?? null;
  };

  const createLexicalRuntime = (artifact) => {
    if (artifact?.schemaVersion !== "1" || artifact?.kind !== "japanese-orthography-lexical-artifact") {
      throw new TypeError("Unsupported lexical artifact");
    }
    const lemmas = Array.isArray(artifact.lemmas) ? artifact.lemmas : [];
    const morphologies = Array.isArray(artifact.morphologies) ? artifact.morphologies : [];
    const candidates = Array.isArray(artifact.candidates) ? artifact.candidates : [];
    const surfaceIndex = Array.isArray(artifact.surfaceIndex) ? artifact.surfaceIndex : [];

    const decodeCandidate = (record) => {
      const lemma = lemmas[record.localLemmaId];
      const morphology = morphologies[record.morphologyId];
      if (!lemma || lemma.localLemmaId !== record.localLemmaId || !morphology || morphology.morphologyId !== record.morphologyId) {
        throw new Error("Lexical artifact candidate references an invalid table entry");
      }
      const modernReadings = Array.isArray(record.modernReadings) ? [...record.modernReadings] : [];
      return {
        lexicalIdentity: lemma.lexicalIdentity,
        lemma: lemma.lemma,
        reading: chooseReading(lemma, modernReadings),
        lexicalReading: lemma.lexicalReading,
        modernReadings,
        lexicalOrigin: lemma.lexicalOrigin,
        morphology: {
          partOfSpeech: Array.isArray(morphology.pos) ? [...morphology.pos] : [],
          conjugationType: morphology.cType === "*" ? null : morphology.cType,
          conjugationForm: morphology.cForm === "*" ? null : morphology.cForm
        },
        components: [],
        viableBindingIds: [lemma.lexicalIdentity],
        evidenceRefs: [lemma.lexicalIdentity]
      };
    };

    const lookup = (surface) => {
      const entry = findSurface(surfaceIndex, `${surface ?? ""}`);
      if (!entry) return [];
      const start = entry.candidateOffset;
      const end = start + entry.candidateCount;
      if (!Number.isInteger(start) || !Number.isInteger(entry.candidateCount) || start < 0 || end > candidates.length) {
        throw new Error("Lexical artifact surface index is out of bounds");
      }
      return candidates.slice(start, end).map(decodeCandidate);
    };

    return {
      lexicalNamespaceId: artifact.lexicalNamespaceId,
      artifactContentId: artifact.artifactContentId,
      lookup
    };
  };

  return { createLexicalRuntime };
});

(function (root, factory) {
  const api = factory(root.TransformShared);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.OrthographyResolver = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (TransformShared) {
  "use strict";

  const emptyHistorical = (surface, disposition = "UNRESOLVED") => ({
    route: null,
    kana: null,
    contextualKanji: {
      status: "none",
      target: null,
      candidates: []
    },
    deterministicKanji: null,
    surface,
    disposition,
    evidenceRefs: []
  });

  const normalizeInputEvidence = (input) => {
    const sourceText = `${input ?? ""}`;
    const parseRubySegments = TransformShared?.parseRubySegments;
    if (typeof parseRubySegments !== "function") {
      return {
        sourceText,
        baseSurface: sourceText,
        wholeRuby: null,
        componentRuby: []
      };
    }

    const segments = parseRubySegments(sourceText);
    const rubySegments = segments.filter((segment) => segment?.type === "ruby");
    if (rubySegments.length === 0) {
      return {
        sourceText,
        baseSurface: sourceText,
        wholeRuby: null,
        componentRuby: []
      };
    }

    const baseSurface = segments.map((segment) => (
      segment?.type === "ruby" ? `${segment.base ?? ""}` : `${segment?.text ?? ""}`
    )).join("");

    const wholeRuby = segments.length === 1 && rubySegments.length === 1 && rubySegments[0].base === baseSurface
      ? { base: rubySegments[0].base, reading: rubySegments[0].ruby }
      : null;

    return {
      sourceText,
      baseSurface,
      wholeRuby,
      componentRuby: wholeRuby ? [] : rubySegments.map((segment) => ({
        base: `${segment.base ?? ""}`,
        reading: `${segment.ruby ?? ""}`
      }))
    };
  };

  const unresolvedUnit = (evidence, candidates = []) => ({
    kind: candidates.length > 1 ? "candidates" : "unresolved",
    sourceText: evidence.sourceText,
    sourceSurface: evidence.baseSurface,
    lexicalIdentity: null,
    reading: {
      modernSurface: evidence.wholeRuby?.reading ?? null,
      source: evidence.wholeRuby ? "ruby-word" : "unknown"
    },
    lexicalOrigin: "unknown",
    morphology: null,
    components: [],
    lexicalCandidates: candidates,
    historical: emptyHistorical(
      evidence.baseSurface,
      candidates.length > 1 ? "CANDIDATES" : "UNRESOLVED"
    ),
    evidenceRefs: []
  });

  const attachComponentRuby = (components, componentRuby) => {
    if (!Array.isArray(components) || components.length === 0) {
      return [];
    }

    let rubyIndex = 0;
    return components.map((component) => {
      const explicit = componentRuby[rubyIndex];
      const matches = explicit && explicit.base === component.surface;
      if (matches) {
        rubyIndex += 1;
      }
      return {
        ...component,
        readingSource: matches ? "ruby-component" : "lexical"
      };
    });
  };

  const createResolver = (config = {}) => {
    if (typeof config.lexicalLookup !== "function") {
      throw new TypeError("createResolver requires lexicalLookup(surface)");
    }

    const resolveUnit = (input, options = {}) => {
      const evidence = normalizeInputEvidence(input);

      if (options.protected === true) {
        return {
          kind: "protected",
          sourceText: evidence.sourceText,
          sourceSurface: evidence.sourceText,
          lexicalIdentity: null,
          reading: { modernSurface: null, source: "protected" },
          lexicalOrigin: "unknown",
          morphology: null,
          components: [],
          historical: emptyHistorical(evidence.sourceText, "PRESERVE"),
          evidenceRefs: []
        };
      }

      const candidates = config.lexicalLookup(evidence.baseSurface) ?? [];
      if (!Array.isArray(candidates) || candidates.length !== 1) {
        return unresolvedUnit(evidence, Array.isArray(candidates) ? candidates : []);
      }

      const candidate = candidates[0];
      const components = attachComponentRuby(candidate.components ?? [], evidence.componentRuby);
      const reading = evidence.wholeRuby
        ? { modernSurface: evidence.wholeRuby.reading, source: "ruby-word" }
        : { modernSurface: candidate.reading ?? null, source: candidate.reading ? "lexical" : "unknown" };

      return {
        kind: "resolved",
        sourceText: evidence.sourceText,
        sourceSurface: evidence.baseSurface,
        lexicalIdentity: candidate.lexicalIdentity ?? null,
        lemma: candidate.lemma ?? null,
        reading,
        lexicalOrigin: candidate.lexicalOrigin ?? "unknown",
        morphology: candidate.morphology ?? null,
        components,
        viableBindingIds: candidate.viableBindingIds ?? [],
        historical: emptyHistorical(evidence.baseSurface),
        evidenceRefs: [...(candidate.evidenceRefs ?? [])]
      };
    };

    const render = (unit) => unit?.historical?.surface ?? unit?.sourceText ?? unit?.sourceSurface ?? "";

    return {
      resolveUnit,
      render
    };
  };

  return {
    createResolver
  };
});

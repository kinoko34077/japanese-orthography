(function (root, factory) {
  const api = factory(root.TransformShared);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.OrthographyResolver = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (TransformShared) {
  "use strict";

  const emptyContextualDecision = () => ({
    status: "none",
    target: null,
    candidates: [],
    relationIds: []
  });

  const emptyHistorical = (surface, disposition = "UNRESOLVED") => ({
    route: null,
    kana: null,
    contextualKanji: emptyContextualDecision(),
    deterministicKanji: null,
    surface,
    disposition,
    evidenceRefs: []
  });

  const historicalMetadata = (relation) => ({
    ...(relation?.basis ? { basis: relation.basis } : {}),
    sourceRefs: [...(relation?.sourceRefs ?? [])],
    canonicalIds: [...(relation?.canonicalIds ?? [])],
    evidenceRefs: [...(relation?.evidenceRefs ?? [])]
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

  const candidateReadings = (candidate) => {
    const readings = Array.isArray(candidate?.modernReadings) ? candidate.modernReadings.filter(Boolean) : [];
    return readings.length > 0 ? [...new Set(readings)] : (candidate?.reading ? [candidate.reading] : []);
  };

  const displayReadingForCandidates = (candidates) => {
    const list = Array.isArray(candidates) ? candidates : [];
    const readings = [...new Set(list.flatMap(candidateReadings))];
    const preferred = [...new Set(list.flatMap((candidate) => {
      const preferences = Array.isArray(candidate?.displayReadingPreferences)
        ? candidate.displayReadingPreferences
        : candidate?.displayPriority?.length && candidate?.reading
          ? [{ reading: candidate.reading, priorities: candidate.displayPriority }]
          : [];
      return preferences.filter((entry) => Array.isArray(entry?.priorities) && entry.priorities.length > 0).map((entry) => entry.reading);
    }))].filter((reading) => readings.includes(reading));
    if (preferred.length === 1) return { value: preferred[0], source: "jmdict-re-pri" };
    if (readings.length === 1) return { value: readings[0], source: "lexical-consensus" };
    return null;
  };

  const displayReadingForCandidate = (candidate, reading) => {
    const value = reading ?? (candidateReadings(candidate).length === 1 ? candidateReadings(candidate)[0] : null);
    if (!value) return null;
    const priorities = Array.isArray(candidate?.displayReadingPreferences)
      ? candidate.displayReadingPreferences.find((entry) => entry.reading === value)?.priorities ?? []
      : candidate?.displayPriority ?? [];
    return priorities.length > 0 ? { value, source: "jmdict-re-pri" } : { value, source: "lexical" };
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
    displayReading: displayReadingForCandidates(candidates),
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
        readingSource: matches ? "ruby-component" : "lexical",
        ...(matches ? { rubyReading: explicit.reading } : {})
      };
    });
  };

  const relationBindingIds = (entry) => (
    Array.isArray(entry?.lexicalBindingIds) ? entry.lexicalBindingIds : []
  );

  const bindingEligible = (entry, candidate) => {
    const required = relationBindingIds(entry);
    if (required.length === 0) {
      return true;
    }
    const viable = Array.isArray(candidate?.viableBindingIds) ? candidate.viableBindingIds : [];
    return viable.some((bindingId) => required.includes(bindingId));
  };

  const resolveContextualKanji = (surface, candidate, relations, safety) => {
    const preserve = (Array.isArray(safety) ? safety : []).find((entry) => (
      entry?.effect === "preserve_exact" && entry.match === surface && bindingEligible(entry, candidate)
    ));
    if (preserve) {
      return {
        status: "preserve",
        target: null,
        candidates: [],
        relationIds: [preserve.id].filter(Boolean)
      };
    }

    const matchingRelations = (Array.isArray(relations) ? relations : []).filter((entry) => (
      entry?.match === surface && typeof entry?.target === "string"
    ));
    const viable = Array.isArray(candidate?.viableBindingIds) ? candidate.viableBindingIds : [];
    const eligibleRelations = matchingRelations.filter((entry) => bindingEligible(entry, candidate));
    const targets = [];
    for (const relation of eligibleRelations) {
      if (!targets.includes(relation.target)) targets.push(relation.target);
    }
    if (targets.length === 0) return emptyContextualDecision();

    // Candidate evidence never becomes admitted merely because filtering leaves one spelling.
    const admittedRelations = eligibleRelations.filter((entry) => entry.candidate !== true);
    const admittedTargets = [];
    for (const relation of admittedRelations) {
      if (!admittedTargets.includes(relation.target)) admittedTargets.push(relation.target);
    }
    const hasGlobalRelation = admittedRelations.some((entry) => relationBindingIds(entry).length === 0);
    const coversAllViableBindings = hasGlobalRelation || (
      viable.length > 0 && viable.every((bindingId) => (
        admittedRelations.some((entry) => relationBindingIds(entry).includes(bindingId))
      ))
    );

    if (admittedTargets.length === 1 && coversAllViableBindings) {
      return {
        status: "resolved",
        target: admittedTargets[0],
        candidates: targets,
        relationIds: admittedRelations.map((entry) => entry.id).filter(Boolean)
      };
    }

    return {
      status: "candidates",
      target: null,
      candidates: targets,
      relationIds: eligibleRelations.map((entry) => entry.id).filter(Boolean)
    };
  };

  const applySafeKanjiMap = (surface, safeKanjiMap) => Array.from(`${surface ?? ""}`).map((char) => (
    Object.prototype.hasOwnProperty.call(safeKanjiMap ?? {}, char) ? safeKanjiMap[char] : char
  )).join("");

  const resolveHistoricalComponents = (components, acceptedRelation, safeKanjiMap, options = {}) => {
    const relationComponents = Array.isArray(acceptedRelation?.components) ? acceptedRelation.components : [];
    if (!Array.isArray(components) || components.length === 0) {
      if (options.allowRelationFallback === false) {
        return [];
      }
      return relationComponents.map((component) => ({
        ...component,
        renderedSurface: applySafeKanjiMap(component.surface, safeKanjiMap)
      }));
    }

    const componentRelations = new Map(
      relationComponents.map((component) => [component.lexicalIdentity, component])
    );
    return components.map((component) => {
      const componentRelation = componentRelations.get(component.lexicalIdentity);
      return {
        ...component,
        historicalKana: componentRelation?.historicalKana ?? null,
        renderedSurface: applySafeKanjiMap(component.surface, safeKanjiMap)
      };
    });
  };

  const resolveHistorical = (candidate, sourceSurface, components, config) => {
    const historicalDecision = candidate && typeof config.historicalLookup === "function"
      ? config.historicalLookup(candidate, sourceSurface)
      : null;
    const diagnostic = historicalDecision?.diagnostic ?? null;
    const sinoCandidates = historicalDecision?.status === "candidates" ? historicalDecision : null;
    const identityRelation = sinoCandidates || historicalDecision?.status === "unavailable" ? null : historicalDecision;
    const identityAllowed = !identityRelation?.requiresMorphology || candidate?.morphology != null;
    const acceptedIdentityRelation = identityAllowed ? identityRelation : null;
    const surfaceDecision = !acceptedIdentityRelation && !sinoCandidates && typeof config.historicalSurfaceLookup === "function"
      ? config.historicalSurfaceLookup(sourceSurface)
      : null;
    const surfaceRelation = surfaceDecision?.status === "resolved"
      ? {
          route: surfaceDecision.route ?? "native",
          reading: surfaceDecision.reading ?? null,
          surface: surfaceDecision.surface ?? sourceSurface,
          requiresMorphology: false,
          requiredMorphology: null,
          evidenceRefs: [...(surfaceDecision.evidenceRefs ?? [])],
          ...historicalMetadata(surfaceDecision)
        }
      : null;
    const acceptedRelation = acceptedIdentityRelation ?? surfaceRelation;
    const nativeCandidates = !acceptedIdentityRelation && surfaceDecision?.status === "candidates"
      ? {
          surfaces: [...(surfaceDecision.surfaceCandidates ?? [])],
          readings: [...(surfaceDecision.readingCandidates ?? [])]
        }
      : null;
    const contextualKanji = resolveContextualKanji(
      sourceSurface,
      candidate,
      config.contextualRelations,
      config.contextualSafety
    );

    const resolvedComponents = resolveHistoricalComponents(
      components,
      acceptedRelation,
      config.safeKanjiMap ?? {},
      { allowRelationFallback: contextualKanji.status !== "resolved" }
    );

    if (contextualKanji.status === "preserve") {
      return {
        components: resolvedComponents,
        historical: {
          route: acceptedRelation?.route ?? null,
          kana: acceptedRelation?.reading ?? null,
          contextualKanji,
          deterministicKanji: null,
          surface: sourceSurface,
          disposition: "PRESERVE",
          evidenceRefs: [...(acceptedRelation?.evidenceRefs ?? []), ...historicalMetadata(acceptedRelation).evidenceRefs],
          ...historicalMetadata(acceptedRelation),
          ...(diagnostic ? { diagnostic } : {})
        }
      };
    }

    if (contextualKanji.status === "candidates") {
      return {
        components: resolvedComponents,
        historical: {
          route: acceptedRelation?.route ?? null,
          kana: acceptedRelation?.reading ?? null,
          contextualKanji,
          deterministicKanji: null,
          surface: sourceSurface,
          disposition: "CANDIDATES",
          evidenceRefs: [...(acceptedRelation?.evidenceRefs ?? []), ...historicalMetadata(acceptedRelation).evidenceRefs],
          ...historicalMetadata(acceptedRelation),
          ...(diagnostic ? { diagnostic } : {})
        }
      };
    }

    if (contextualKanji.status === "resolved") {
      return {
        components: resolvedComponents,
        historical: {
          route: acceptedRelation?.route ?? null,
          kana: acceptedRelation?.reading ?? null,
          contextualKanji,
          deterministicKanji: null,
          surface: contextualKanji.target,
          disposition: "AUTO",
          evidenceRefs: [...(acceptedRelation?.evidenceRefs ?? []), ...historicalMetadata(acceptedRelation).evidenceRefs],
          ...historicalMetadata(acceptedRelation),
          ...(diagnostic ? { diagnostic } : {})
        }
      };
    }

    if (sinoCandidates && contextualKanji.status === "none") {
      return {
        components: resolvedComponents,
        historical: {
          route: sinoCandidates.route ?? "sino",
          kana: null,
          contextualKanji,
          deterministicKanji: null,
          surface: sourceSurface,
          disposition: "CANDIDATES",
          evidenceRefs: [...(sinoCandidates.evidenceRefs ?? []), ...historicalMetadata(sinoCandidates).evidenceRefs],
          ...historicalMetadata(sinoCandidates),
          sinoCandidates: { readings: [...(sinoCandidates.readings ?? [])] },
          ...(diagnostic ? { diagnostic } : {})
        }
      };
    }

    if (nativeCandidates) {
      return {
        components: resolvedComponents,
        historical: {
          route: surfaceDecision?.route ?? "native",
          kana: surfaceDecision?.reading ?? null,
          contextualKanji,
          deterministicKanji: null,
          surface: surfaceDecision?.surface ?? sourceSurface,
          disposition: "CANDIDATES",
          evidenceRefs: [...(surfaceDecision?.evidenceRefs ?? []), ...historicalMetadata(surfaceDecision).evidenceRefs],
          ...historicalMetadata(surfaceDecision),
          nativeCandidates,
          ...(diagnostic ? { diagnostic } : {})
        }
      };
    }

    const relationSurface = acceptedRelation?.surface ?? sourceSurface;
    const renderedSurface = applySafeKanjiMap(relationSurface, config.safeKanjiMap ?? {});
    const deterministicKanji = renderedSurface === relationSurface
      ? null
      : {
          status: "resolved",
          source: relationSurface,
          target: renderedSurface
        };

    return {
      components: resolvedComponents,
      historical: {
        route: acceptedRelation?.route ?? null,
        kana: acceptedRelation?.reading ?? null,
        contextualKanji,
        deterministicKanji,
        surface: renderedSurface,
        disposition: acceptedRelation || deterministicKanji ? "AUTO" : "SOURCE_REVIEW",
        evidenceRefs: [...(acceptedRelation?.evidenceRefs ?? []), ...historicalMetadata(acceptedRelation).evidenceRefs],
        ...historicalMetadata(acceptedRelation),
        ...(diagnostic ? { diagnostic } : {})
      }
    };
  };

  const resolveSurfaceFallbackUnit = (evidence, lexicalCandidates, config) => {
    if (typeof config.historicalSurfaceLookup !== "function") {
      return unresolvedUnit(evidence, lexicalCandidates);
    }
    const decision = config.historicalSurfaceLookup(evidence.baseSurface);
    if (!decision) {
      return unresolvedUnit(evidence, lexicalCandidates);
    }

    if (decision.status === "candidates") {
      const unit = unresolvedUnit(evidence, lexicalCandidates);
      return {
        ...unit,
        historical: {
          route: decision.route ?? "native",
          kana: decision.reading ?? null,
          contextualKanji: emptyContextualDecision(),
          deterministicKanji: null,
          surface: decision.surface ?? evidence.baseSurface,
          disposition: "CANDIDATES",
          evidenceRefs: [...(decision.evidenceRefs ?? [])],
          ...historicalMetadata(decision),
          nativeCandidates: {
            surfaces: [...(decision.surfaceCandidates ?? [])],
            readings: [...(decision.readingCandidates ?? [])]
          }
        },
        evidenceRefs: [...(decision.evidenceRefs ?? [])],
        ...historicalMetadata(decision)
      };
    }

    if (decision.status !== "resolved") {
      return unresolvedUnit(evidence, lexicalCandidates);
    }

    const relationSurface = decision.surface ?? evidence.baseSurface;
    const renderedSurface = applySafeKanjiMap(relationSurface, config.safeKanjiMap ?? {});
    const deterministicKanji = renderedSurface === relationSurface
      ? null
      : {
          status: "resolved",
          source: relationSurface,
          target: renderedSurface
        };

    return {
      kind: "resolved",
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
      lexicalCandidates,
      historical: {
        route: decision.route ?? "native",
        kana: decision.reading ?? null,
        contextualKanji: emptyContextualDecision(),
        deterministicKanji,
        surface: renderedSurface,
        disposition: "AUTO",
        evidenceRefs: [...(decision.evidenceRefs ?? [])]
      },
      evidenceRefs: [...(decision.evidenceRefs ?? [])]
    };
  };

  const protectedUnit = (sourceText) => ({
    kind: "protected",
    sourceText,
    sourceSurface: sourceText,
    lexicalIdentity: null,
    reading: { modernSurface: null, source: "protected" },
    lexicalOrigin: "unknown",
    morphology: null,
    components: [],
    historical: emptyHistorical(sourceText, "PRESERVE"),
    evidenceRefs: []
  });

  const createResolver = (config = {}) => {
    if (typeof config.lexicalLookup !== "function") {
      throw new TypeError("createResolver requires lexicalLookup(surface)");
    }

    // The single semantic path shared by every analysis route (surface, reading).
    const resolveCandidate = (evidence, candidate, lexicalSurface, reading) => {
      const historicalResolution = resolveHistorical(
        candidate,
        lexicalSurface,
        candidate.components ?? [],
        config
      );
      const components = attachComponentRuby(historicalResolution.components, evidence.componentRuby);

      return {
        kind: "resolved",
        sourceText: evidence.sourceText,
        sourceSurface: evidence.baseSurface,
        lexicalIdentity: candidate.lexicalIdentity ?? null,
        lemma: candidate.lemma ?? null,
        reading,
        displayReading: displayReadingForCandidate(candidate, reading.modernSurface),
        lexicalOrigin: candidate.lexicalOrigin ?? "unknown",
        morphology: candidate.morphology ?? null,
        inflection: candidate.inflection ?? null,
        components,
        viableBindingIds: candidate.viableBindingIds ?? [],
        historical: historicalResolution.historical,
        evidenceRefs: [
          ...(candidate.evidenceRefs ?? []),
          ...(historicalResolution.historical.evidenceRefs ?? [])
        ]
      };
    };

    const resolveUnit = (input, options = {}) => {
      const evidence = normalizeInputEvidence(input);

      if (options.protected === true) {
        return protectedUnit(evidence.sourceText);
      }

      const lookupResult = config.lexicalLookup(evidence.baseSurface) ?? [];
      const candidates = Array.isArray(lookupResult) && evidence.wholeRuby?.reading
        ? lookupResult.filter((candidate) => (candidate?.reading === evidence.wholeRuby.reading || (Array.isArray(candidate?.modernReadings) && candidate.modernReadings.includes(evidence.wholeRuby.reading))))
        : lookupResult;
      if (!Array.isArray(candidates)) {
        return unresolvedUnit(evidence, []);
      }
      if (candidates.length === 0) {
        return resolveSurfaceFallbackUnit(evidence, [], config);
      }
      if (candidates.length !== 1) {
        return unresolvedUnit(evidence, candidates);
      }

      const candidate = candidates[0];
      const reading = evidence.wholeRuby
        ? { modernSurface: evidence.wholeRuby.reading, source: "ruby-word" }
        : { modernSurface: candidate.reading ?? null, source: candidate.reading ? "lexical" : "unknown" };
      return resolveCandidate(evidence, candidate, evidence.baseSurface, reading);
    };

    // Reading input: candidates come from the reading index and enter the same
    // semantic path directly; no reconstructed string is re-looked-up.
    const resolveReading = (input, options = {}) => {
      const sourceText = `${input ?? ""}`;
      if (options.protected === true) {
        return protectedUnit(sourceText);
      }
      if (typeof config.readingLookup !== "function") {
        throw new TypeError("resolveReading requires readingLookup(reading)");
      }
      const evidence = { sourceText, baseSurface: sourceText, wholeRuby: null, componentRuby: [] };
      const lookupResult = config.readingLookup(sourceText) ?? [];
      const candidates = Array.isArray(lookupResult) ? lookupResult : [];
      if (candidates.length !== 1 || typeof candidates[0]?.surface !== "string") {
        return unresolvedUnit(evidence, candidates);
      }

      const candidate = candidates[0];
      return {
        ...resolveCandidate(evidence, candidate, candidate.surface, { modernSurface: sourceText, source: "reading-input" }),
        reconstructedSurface: candidate.surface
      };
    };

    const render = (unit, options = {}) => {
      if (!unit) {
        return "";
      }
      if (unit.kind === "protected") {
        return unit.sourceText ?? unit.sourceSurface ?? "";
      }

      const mode = options.mode ?? "plain";
      const surface = unit?.historical?.surface ?? unit?.sourceSurface ?? unit?.sourceText ?? "";
      const historicalKana = unit?.historical?.kana ?? null;
      const displayReading = unit?.displayReading?.value ?? unit?.reading?.modernSurface ?? null;
      // A modern-only unit may expose its lexical reading as Ruby, but a historical
      // route with no admitted historical kana must not invent a modern Ruby fallback.
      const rubyReading = historicalKana ?? (unit?.historical?.route ? null : displayReading);
      if (mode === "plain" || !rubyReading) {
        return surface;
      }

      if (mode === "ruby-whole-explicit") {
        return `｜${surface}《${rubyReading}》`;
      }
      if (mode === "ruby-whole-implicit") {
        return `${surface}《${rubyReading}》`;
      }

      const components = Array.isArray(unit.components) ? unit.components : [];
      const completeComponents = components.length > 0 && components.every((component) => Boolean(component.historicalKana ?? component.lexicalReading));
      const componentRuby = completeComponents ? components.map((component) => {
        const componentSurface = component.renderedSurface ?? component.surface ?? "";
        const componentKana = component.historicalKana ?? component.lexicalReading ?? null;
        return componentKana ? `${componentSurface}《${componentKana}》` : componentSurface;
      }).join("") : "";

      if (mode === "ruby-components-explicit") {
        return componentRuby ? `｜${componentRuby}` : `｜${surface}《${rubyReading}》`;
      }
      if (mode === "ruby-components-implicit") {
        return componentRuby || `${surface}《${rubyReading}》`;
      }

      return surface;
    };

    return {
      resolveUnit,
      resolveReading,
      render
    };
  };

  return {
    createResolver
  };
});

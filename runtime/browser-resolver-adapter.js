(function (root, factory) {
  const isCommonJs = typeof module === "object" && module.exports;
  if (isCommonJs) require("./transform-shared.js"); // sets globalThis.TransformShared for the resolver
  const deps = isCommonJs
    ? { planner: require("./browser-span-planner.js"), resolver: require("./orthography-resolver.js") }
    : { planner: root.BrowserSpanPlanner, resolver: root.OrthographyResolver };
  const api = factory(deps);
  if (isCommonJs) module.exports = api;
  root.BrowserResolverAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (deps) {
  "use strict";
  const { planner, resolver: OrthographyResolver } = deps;

  // Browser resolver adapter (#196 D). The accepted OrthographyResolver is the single semantic
  // authority for historical-direction conversion; this module only feeds it pack-derived lookups
  // and schedules its unit results through the shared span assembly / occurrence arbitration.
  //
  //   text -> lexical units (BrowserPack v2 surface/reading index; UTF-16 offsets)
  //        -> OrthographyResolver.resolveUnit (lexical identity, reading, morphology,
  //           historical kana, contextual kanji, deterministic character rendering)
  //        -> unit outputs (plain / Ruby render modes) as arbitration candidates
  //        -> BrowserSpanPlanner.assemble (accepted occurrence arbitration) -> spans
  //
  // Pack-derived resolver inputs (no new authority, all from canonical facts/rules):
  //   lexicalLookup       lexeme candidates of a surface, one per modern reading (like UniDic rows)
  //   readingLookup       lexeme candidates of a reading
  //   historicalLookup    lexeme-bound historical readings; else a surface-keyed historical reading
  //                       confirmed by the native kana relation of the candidate's own reading
  //   historicalSurfaceLookup  only for surfaces the lexicon does not know (accepted fallback)
  //   contextualRelations kanji form relations reached by the text; contextual ones are bound to
  //                       their canonical lexicalRefs (a constraint without lexicalRefs never binds)
  //   contextualSafety    preserve_exact / block_fallback constraints (both preserve the unit)
  //   safeKanjiMap        the profile's enabled single-character surface rules
  //
  // Kana units keep their script: their historical output is the native kana relation of the kana
  // itself (as in v1); their lexical candidates are recorded for diagnostics only. The modern
  // (restoration) direction is unchanged in this unit and still runs on the v1 planner.

  if (!planner || typeof planner.assemble !== "function" || !OrthographyResolver?.createResolver) {
    throw new Error("BrowserResolverAdapter requires BrowserSpanPlanner and OrthographyResolver");
  }
  const KANA = /^[ぁ-ゟ゠-ヿ]+$/u;
  const isKana = (text) => KANA.test(text);
  const RUBY_MODES = new Set(["plain", "ruby-whole-explicit", "ruby-whole-implicit", "ruby-components-explicit", "ruby-components-implicit"]);

  const uniq = (values) => [...new Set(values)];

  const transformWithResolver = async (pack, lexical, text, profileId, options = {}) => {
    const policy = pack.getProfilePolicy(profileId).policy;
    if (policy.period !== "historical") {
      return { ...(await planner.planAndTransform(pack, text, profileId, options)), engine: "restoration" };
    }
    const renderMode = options.renderMode ?? "plain";
    if (!RUBY_MODES.has(renderMode)) throw new RangeError(`unknown render mode ${renderMode}`);
    await Promise.all([pack.prepare(text), lexical.prepare(text, { reading: true })]);

    // ---- pack facts reached by the text (v1 knowledge shards) --------------------------------------
    const charBoundaries = [];
    const factMatches = [];
    for (let i = 0; i < text.length;) {
      const ch = planner.charAt(text, i);
      charBoundaries.push([i, i + ch.length]);
      for (const m of pack.findMatchesSync(text, i)) factMatches.push(m);
      i += ch.length;
    }
    const factsAt = new Map(); // surface -> facts
    for (const m of factMatches) factsAt.set(m.surface, m.facts);
    // whole-string facts for strings outside the text (candidate readings); `prepare`d below
    const facts = (surface) => {
      if (!factsAt.has(surface)) factsAt.set(surface, pack.findMatchesSync(surface, 0).find((m) => m.end === surface.length)?.facts ?? []);
      return factsAt.get(surface);
    };

    // contextual / safety facts need their canonical lexicalRefs + tags (lazy detail; few rows)
    const details = new Map();
    for (const m of factMatches) for (const f of m.facts) {
      if ((f.contextual || f.safety) && !details.has(f.detailRef)) details.set(f.detailRef, pack.loadDetail(f.detailRef));
    }
    for (const [ref, promise] of details) details.set(ref, await promise);

    const kanjiRelation = (f) => f.kind === "form_relation" && f.viaTarget && f.surface !== f.target && !(isKana(f.surface) && isKana(f.target));
    const kanaRelation = (f) => f.kind === "form_relation" && f.viaTarget && f.surface !== f.target && isKana(f.surface) && isKana(f.target) && f.historical;
    const relations = [];
    const safety = [];
    const seenRelation = new Set();
    for (const m of factMatches) for (const f of m.facts) {
      if (kanjiRelation(f) && !seenRelation.has(f.detailRef)) {
        seenRelation.add(f.detailRef);
        const detail = details.get(f.detailRef);
        const constraint = detail?.tags.find((t) => t.startsWith("context:"));
        const lexicalBindingIds = f.contextual ? (detail.lexicalRefs.length ? [...detail.lexicalRefs] : [`unsatisfiable:${constraint}`]) : [];
        relations.push({ id: f.detailRef, match: f.target, target: f.surface, lexicalBindingIds, contextual: f.contextual, candidate: f.candidate, fact: f });
      }
      if (f.safety && f.surface === m.surface) {
        const detail = details.get(f.detailRef);
        safety.push({ id: f.detailRef, effect: "preserve_exact", match: f.surface, lexicalBindingIds: [...detail.lexicalRefs], constraint: detail.tags.find((t) => t.startsWith("safety:")) ?? null, fact: f });
      }
    }
    const rules = planner.ruleTables(pack, policy);
    const safeKanjiMap = {};
    const safeRules = new Map();
    for (const r of rules) {
      if (r.class === "orthographic" && r.predicate?.channel === "surface" && !r.predicate?.exactToken && !r.predicate?.mechanism
        && r.from.length === 1 && r.to.length === 1 && r.directionality === "reverse_traversable") {
        safeKanjiMap[r.to[0]] = r.from[0];
        safeRules.set(r.to[0], r);
      }
    }
    const applySafe = (surface) => Array.from(surface).map((c) => safeKanjiMap[c] ?? c).join("");

    // ---- resolver over pack-derived lookups ----------------------------------------------------------
    const lexicalCandidates = (surface) => lexical.lookupSurfaceSync(surface)
      .flatMap((c) => (c.modernReadings.length > 1 ? c.modernReadings.map((r) => lexical.withReading(c, r)) : [c]));
    const kanaHistorical = (reading) => uniq(facts(reading).filter(kanaRelation).map((f) => f.surface));
    const resolver = OrthographyResolver.createResolver({
      lexicalLookup: lexicalCandidates,
      readingLookup: (reading) => lexical.lookupReadingSync(reading),
      historicalLookup: (candidate, surface) => {
        const bound = (candidate.historicalReadings ?? []).filter((h) => h.surface === surface);
        const readings = uniq(bound.map((h) => h.reading));
        if (readings.length === 1) {
          return { route: bound[0].route ?? "native", reading: readings[0], surface, requiresMorphology: false, requiredMorphology: null, evidenceRefs: uniq(bound.map((h) => `fact#${h.factIndex}`)) };
        }
        if (readings.length > 1) return { status: "candidates", route: bound[0].route ?? "native", readings, evidenceRefs: uniq(bound.map((h) => `fact#${h.factIndex}`)) };
        // surface-keyed historical reading, accepted only when the native kana relation of the
        // candidate's own modern reading names the same historical kana (two sources agree)
        if (typeof candidate.reading !== "string") return null;
        const surfaceReadings = uniq(facts(surface).filter((f) => f.kind === "literal_reading" && f.historical && f.surface === surface).map((f) => f.reading));
        const agreed = surfaceReadings.filter((r) => kanaHistorical(candidate.reading).includes(r));
        if (agreed.length !== 1) return null;
        return { route: "native", reading: agreed[0], surface, requiresMorphology: false, requiredMorphology: null, evidenceRefs: [`surface:${surface}`, `kana:${candidate.reading}>${agreed[0]}`] };
      },
      historicalSurfaceLookup: (surface) => {
        if (lexical.lookupSurfaceSync(surface).length) return null; // the identity route decides
        const readings = uniq(facts(surface).filter((f) => f.kind === "literal_reading" && f.historical && f.surface === surface).map((f) => f.reading));
        if (readings.length === 1) return { status: "resolved", route: "native", reading: readings[0], surface, evidenceRefs: [`surface:${surface}`] };
        if (readings.length > 1) return { status: "candidates", route: "native", surfaceCandidates: [surface], readingCandidates: readings, evidenceRefs: [`surface:${surface}`] };
        return null;
      },
      contextualRelations: relations,
      contextualSafety: safety,
      safeKanjiMap
    });

    // ---- lexical units --------------------------------------------------------------------------------
    // (the modern readings of every lexical candidate are looked up as kana relations: prepare them)
    const units = new Map(); // `${start}:${end}` -> unit
    const lexicalSpans = [];
    const addUnit = (start, end) => {
      const key = `${start}:${end}`;
      if (!units.has(key)) units.set(key, { start, end, surface: text.slice(start, end) });
    };
    for (const [start] of charBoundaries) {
      for (const m of lexical.matchesAtSync(text, start, "surface")) addUnit(m.start, m.end);
      for (const m of lexical.matchesAtSync(text, start, "reading")) if (isKana(m.surface)) addUnit(m.start, m.end);
    }
    // relation keys the lexicon does not list (e.g. inflected stems) are still lexical units
    for (const m of factMatches) if (m.facts.some((f) => kanjiRelation(f) || kanaRelation(f) || f.safety)) addUnit(m.start, m.end);

    const readingKeys = new Set();
    for (const unit of units.values()) {
      if (isKana(unit.surface)) continue;
      for (const c of lexicalCandidates(unit.surface)) if (typeof c.reading === "string" && !factsAt.has(c.reading)) readingKeys.add(c.reading);
    }
    for (const reading of readingKeys) await pack.prepare(reading);

    const candidates = [];
    const contextual = [];
    const recognized = [];
    const exactTokenRules = rules.filter((r) => r.predicate?.exactToken === true && r.predicate?.channel === "surface");
    for (const unit of units.values()) {
      const { start, end, surface } = unit;
      let outputs = [];
      let resolved = null;
      if (isKana(surface)) {
        const readingCandidates = lexical.lookupReadingSync(surface);
        const hist = kanaHistorical(surface);
        resolved = {
          kind: readingCandidates.length === 1 ? "resolved" : readingCandidates.length ? "candidates" : "unresolved",
          sourceSurface: surface,
          lexicalIdentity: readingCandidates.length === 1 ? readingCandidates[0].lexicalIdentity : null,
          lexicalCandidates: readingCandidates,
          reading: { modernSurface: surface, source: "kana-input" },
          lexicalOrigin: readingCandidates.length === 1 ? readingCandidates[0].lexicalOrigin : "unknown",
          morphology: readingCandidates.length === 1 ? readingCandidates[0].morphology : null,
          historical: { route: hist.length ? "native" : null, kana: hist.length === 1 ? hist[0] : null, surface: hist.length === 1 ? hist[0] : surface, disposition: hist.length > 1 ? "CANDIDATES" : hist.length === 1 ? "AUTO" : "SOURCE_REVIEW", contextualKanji: { status: "none", target: null, candidates: [], relationIds: [] }, deterministicKanji: null, evidenceRefs: hist.length === 1 ? [`kana:${surface}>${hist[0]}`] : [] }
        };
        outputs = hist;
      } else {
        resolved = resolver.resolveUnit(surface);
        const h = resolved.historical;
        if (resolved.kind === "resolved" && h.disposition !== "PRESERVE") {
          outputs = h.disposition === "CANDIDATES"
            ? uniq((h.contextualKanji.candidates.length ? h.contextualKanji.candidates : [h.surface]).map(applySafe))
              .flatMap((s) => (renderMode === "plain" || !(h.sinoCandidates || h.nativeCandidates) ? [s] : uniq([...(h.sinoCandidates?.readings ?? []), ...(h.nativeCandidates?.readings ?? [])]).map((k) => resolver.render({ ...resolved, historical: { ...h, surface: s, kana: k } }, { mode: renderMode }))))
            : [resolver.render(resolved, { mode: renderMode })];
        } else if (resolved.kind !== "resolved" && h.disposition !== "PRESERVE") {
          // lexical ambiguity: only identity-independent knowledge applies — relations bound to no
          // lexeme, and deterministic character rendering. It never selects among the candidates.
          const global = uniq(relations.filter((r) => r.match === surface && r.lexicalBindingIds.length === 0).map((r) => r.target));
          const preserved = safety.some((x) => x.match === surface);
          outputs = preserved ? [] : (global.length ? global : [surface]).map(applySafe);
        }
      }
      outputs = uniq(outputs.filter((o) => o !== surface));
      unit.resolution = resolved;
      unit.outputs = outputs;
      const relationsHere = relations.filter((r) => r.match === surface);
      const authority = resolved.historical.contextualKanji.status === "resolved" ? "literal_fact"
        : resolved.historical.route && resolved.historical.kana && renderMode !== "plain" ? "literal_fact"
          : relationsHere.length && !relationsHere.some((r) => r.contextual) ? "literal_fact" : "source_rule";
      for (const output of outputs) {
        candidates.push({ start, end, output, policy: "lexical_boundary", origin: "resolver", ref: `unit:${start}:${end}`, unit: summarizeUnit(resolved), authority, relationFacts: relationsHere.map((r) => r.fact) });
      }
      // a contextual relation that could not bind needs context the free text does not carry
      if (!outputs.length || resolved.historical.contextualKanji.status !== "resolved") {
        for (const r of relationsHere.filter((x) => x.contextual && resolved.historical.contextualKanji.status !== "resolved")) contextual.push({ start, end, output: r.target, fact: r.fact });
      }
      if (!outputs.length) recognized.push({ start, end, surface, unit: summarizeUnit(resolved) });
      // KiNoTch exact-token profile rules (accepted v1 behaviour; the style overlay is unit G)
      for (const rule of exactTokenRules.filter((r) => r.from.includes(surface))) {
        candidates.push({ start, end, output: rule.to[0], policy: "whole_lexeme", origin: "rule", ref: rule.id, rule });
      }
    }
    // deterministic character rendering outside lexical units (identity-independent, as in v1)
    for (const [start, end] of charBoundaries) {
      const ch = text.slice(start, end);
      const rule = safeRules.get(ch);
      if (rule) candidates.push({ start, end, output: rule.from[0], policy: "anywhere", origin: "rule", ref: rule.id, rule });
    }

    // Analysis DAG: kanji-bearing lexical units plus every unit that proposes an output. Kana-only
    // words without any proposal stay inspectable but do not take part in segmentation, so free kana
    // text is not split into competing dictionary words (same lexical boundary scope as v1).
    for (const unit of units.values()) {
      if (!isKana(unit.surface) || candidates.some((c) => c.start === unit.start && c.end === unit.end)) lexicalSpans.push({ start: unit.start, end: unit.end });
    }
    const lexicalDag = planner.lexicalDag(text.length, lexicalSpans, charBoundaries);
    const raw = planner.assemble(text, profileId, lexicalDag, candidates, contextual, { ...options, lexicalMatchCount: lexicalSpans.length });
    return {
      ...raw,
      engine: "resolver",
      renderMode,
      units: [...units.values()].sort((a, b) => a.start - b.start || a.end - b.end).map((u) => ({ start: u.start, end: u.end, surface: u.surface, outputs: u.outputs, unit: summarizeUnit(u.resolution) })),
      recognized
    };
  };

  /** Plain, structured-clone-safe summary of a resolver unit (the browser semantic fields). */
  function summarizeUnit(unit) {
    if (!unit) return null;
    const h = unit.historical ?? {};
    return {
      kind: unit.kind,
      sourceSurface: unit.sourceSurface ?? null,
      lexicalIdentity: unit.lexicalIdentity ?? null,
      reading: unit.reading?.modernSurface ?? null,
      readingSource: unit.reading?.source ?? null,
      lexicalOrigin: unit.lexicalOrigin ?? "unknown",
      morphology: unit.morphology ? { partOfSpeech: [...(unit.morphology.partOfSpeech ?? [])].filter((p) => p !== "*"), conjugationType: unit.morphology.conjugationType ?? null, conjugationForm: unit.morphology.conjugationForm ?? null } : null,
      lexicalCandidates: (unit.lexicalCandidates ?? []).map((c) => ({ lexicalIdentity: c.lexicalIdentity, surface: c.surface ?? null, reading: c.reading ?? null })),
      historical: {
        route: h.route ?? null,
        kana: h.kana ?? null,
        surface: h.surface ?? null,
        disposition: h.disposition ?? null,
        contextualKanji: h.contextualKanji?.status ?? "none",
        contextualCandidates: [...(h.contextualKanji?.candidates ?? [])],
        deterministicKanji: h.deterministicKanji ? { source: h.deterministicKanji.source, target: h.deterministicKanji.target } : null,
        candidateReadings: [...(h.sinoCandidates?.readings ?? []), ...(h.nativeCandidates?.readings ?? [])],
        evidenceRefs: [...(h.evidenceRefs ?? [])]
      }
    };
  }

  return { transformWithResolver, summarizeUnit };
});

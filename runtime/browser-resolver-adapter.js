(function (root, factory) {
  const isCommonJs = typeof module === "object" && module.exports;
  const shared = isCommonJs ? require("./transform-shared.js") : root.TransformShared; // also sets globalThis.TransformShared for the resolver
  const deps = isCommonJs
    ? { planner: require("./browser-span-planner.js"), resolver: require("./orthography-resolver.js"), shared,
      inflection: require("./browser-inflection.js"), sino: require("./historical-sino-runtime.js") }
    : { planner: root.BrowserSpanPlanner, resolver: root.OrthographyResolver, shared, inflection: root.BrowserInflection, sino: root.HistoricalSinoRuntime };
  const api = factory(deps);
  if (isCommonJs) module.exports = api;
  root.BrowserResolverAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (deps) {
  "use strict";
  const { planner, resolver: OrthographyResolver, shared: TransformShared, inflection: Inflection, sino: HistoricalSino } = deps;
  const HAN = /\p{Script=Han}/u;

  // Accepted 4.6E Sino component table, rebuilt from the pack's canonical sino bindings
  // (binding:sino:<char>:<historical>><modern>@<context>); one reconstructor per pack.
  const sinoReconstructors = new WeakMap();
  const sinoFor = (pack) => {
    if (sinoReconstructors.has(pack)) return sinoReconstructors.get(pack);
    const grouped = new Map();
    for (let i = 0; i < pack.bindingCount(); i += 1) {
      const binding = pack.getBinding(i);
      const rule = pack.getRule(binding.rule);
      const symbol = binding.lexicalRefs.find((r) => r.startsWith("symbol:"));
      if (!symbol || !rule.id.startsWith("rule:sino:") || rule.from.length !== 1 || rule.to.length !== 1) continue;
      const context = binding.contextRefs.find((r) => r.startsWith("context:usage:"))?.slice("context:usage:".length) ?? null;
      const character = symbol.slice("symbol:".length);
      const key = JSON.stringify([character, rule.to[0], context]);
      const entry = grouped.get(key) ?? { character, modernReading: rule.to[0], context, historicalReadings: [], evidenceRefs: [] };
      if (!entry.historicalReadings.includes(rule.from[0])) entry.historicalReadings.push(rule.from[0]);
      for (const ref of binding.evidenceRefs) if (!entry.evidenceRefs.includes(ref)) entry.evidenceRefs.push(ref);
      grouped.set(key, entry);
    }
    const relations = [...grouped.values()];
    const reconstructor = relations.length && HistoricalSino?.createSinoComponentReconstructor ? HistoricalSino.createSinoComponentReconstructor(relations) : null;
    sinoReconstructors.set(pack, reconstructor);
    return reconstructor;
  };

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

  /**
   * Ruby syntax spans of `text` (#196 E) via the accepted TransformShared parser, with UTF-16
   * offsets. An explicit `｜` bar belongs to its span. If the segments cannot be laid back onto the
   * text exactly, no Ruby is recognised (fail closed: the text is then ordinary text).
   */
  const rubySpans = (text) => {
    if (typeof TransformShared?.parseRubySegments !== "function") return [];
    const spans = [];
    let at = 0;
    for (const segment of TransformShared.parseRubySegments(text)) {
      if (segment.type !== "ruby") {
        if (text.slice(at, at + segment.text.length) !== segment.text) return [];
        at += segment.text.length;
        continue;
      }
      const explicit = (text[at] === "｜" || text[at] === "|") && text.slice(at + 1, at + 1 + segment.text.length) === segment.text;
      const length = segment.text.length + (explicit ? 1 : 0);
      if (!explicit && text.slice(at, at + length) !== segment.text) return [];
      spans.push({ start: at, end: at + length, base: segment.base, reading: segment.ruby, explicit, source: text.slice(at, at + length) });
      at += length;
    }
    if (at !== text.length) return [];
    const grouped = [];
    for (const span of spans) {
      const previous = grouped[grouped.length - 1];
      if (previous && previous.end === span.start) {
        previous.end = span.end;
        previous.base += span.base;
        previous.reading += span.reading;
        previous.source = text.slice(previous.start, previous.end);
        previous.explicit = previous.explicit || span.explicit;
      } else {
        grouped.push({ ...span });
      }
    }
    return grouped;
  };

  const transformWithResolver = async (pack, lexical, text, profileId, options = {}) => {
    const policy = pack.getProfilePolicy(profileId).policy;
    const renderMode = options.renderMode ?? "plain";
    if (policy.period !== "historical" && renderMode === "plain") {
      return { ...(await planner.planAndTransform(pack, text, profileId, options)), engine: "restoration" };
    }
    if (!RUBY_MODES.has(renderMode)) throw new RangeError(`unknown render mode ${renderMode}`);
    await Promise.all([pack.prepare(text), lexical.prepare(text, { reading: true })]);

    // ---- inflected forms (#196 F): deinflect to dictionary forms whose JMdict POS admits the rule ---
    const inflected = new Map(); // inflected surface -> lexical candidates (one per base reading)
    const inflectedSites = [];
    if (Inflection) {
      const sites = Inflection.scan(text, 6).filter((site) => HAN.test(site.baseSurface) || isKana(text.slice(site.start, site.end)));
      const surfaceBases = uniq(sites.filter((x) => HAN.test(x.baseSurface)).map((x) => x.baseSurface));
      const readingBases = uniq(sites.filter((x) => !HAN.test(x.baseSurface)).map((x) => x.baseSurface));
      await Promise.all([lexical.prepareKeys(surfaceBases, "surface"), lexical.prepareKeys(readingBases, "reading")]);
      for (const site of sites) {
        const surface = text.slice(site.start, site.end);
        const kana = !HAN.test(site.baseSurface);
        const bases = kana ? lexical.lookupReadingSync(site.baseSurface) : lexical.lookupSurfaceSync(site.baseSurface);
        for (const base of bases) {
          for (const baseReading of (base.modernReadings.length ? base.modernReadings : [base.reading]).filter(Boolean)) {
            const jmdictRows = base.morphologyCandidates.filter((m) =>
              m.source === "jmdict" &&
              (m.surface === null || m.surface === base.surface) &&
              (m.reading === null || m.reading === baseReading)
            );
            const pos = jmdictRows.flatMap((m) => m.partOfSpeech);
            if (!Inflection.admits(pos, site.rule)) continue;
            const reading = Inflection.inflectReading(baseReading, site.rule);
            if (!reading) continue;
            const unidic = base.morphologyCandidates.filter((m) => m.source === "unidic" && m.reading === baseReading);
            const row = unidic.find((m) => m.conjugationForm === site.rule.form) ?? (unidic.length === 1 ? unidic[0] : null);
            const candidate = {
              ...base, surface, reading, modernReadings: [reading],
              lexicalOrigin: row?.lexicalOrigin ?? (unidic[0]?.lexicalOrigin ?? base.lexicalOrigin),
              morphology: { partOfSpeech: row ? [...row.partOfSpeech] : pos, conjugationType: row?.conjugationType ?? site.rule.pos, conjugationForm: row?.conjugationForm ?? site.rule.form, source: row ? "unidic" : "jmdict+deinflection" },
              inflection: { baseSurface: base.surface ?? site.baseSurface, baseReading, rule: site.rule.inflected, conjugationClass: site.rule.pos, conjugationForm: site.rule.form },
              historicalReadings: []
            };
            const list = inflected.get(surface) ?? [];
            if (!list.some((c) => c.lexicalIdentity === candidate.lexicalIdentity && c.reading === candidate.reading)) list.push(candidate);
            inflected.set(surface, list);
            inflectedSites.push({ start: site.start, end: site.end });
          }
        }
      }
    }

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
    const activeSafeKanjiMap = policy.period === "historical" ? safeKanjiMap : {};
    const applyActiveSafe = (surface) => Array.from(surface).map((c) => activeSafeKanjiMap[c] ?? c).join("");

    // ---- resolver over pack-derived lookups ----------------------------------------------------------
    const lexicalCandidates = (surface) => [
      ...lexical.lookupSurfaceSync(surface).flatMap((c) => (c.modernReadings.length > 1 ? c.modernReadings.map((r) => lexical.withReading(c, r)) : [c])),
      ...(inflected.get(surface) ?? [])
    ];
    const sino = sinoFor(pack);
    const kanaHistorical = (reading) => policy.period === "historical" ? uniq(facts(reading).filter(kanaRelation).map((f) => f.surface)) : [];
    const resolver = OrthographyResolver.createResolver({
      lexicalLookup: lexicalCandidates,
      readingLookup: (reading) => lexical.lookupReadingSync(reading),
      historicalLookup: (candidate, surface) => {
        if (policy.period !== "historical") return null;
        const bound = (candidate.historicalReadings ?? []).filter((h) =>
          h.surface === surface && (h.basisReading == null || h.basisReading === candidate.reading)
        );
        const admitted = bound.filter((h) => !h.candidate);
        const admittedReadings = uniq(admitted.map((h) => h.reading));
        if (admittedReadings.length === 1) {
          return { route: admitted[0].route ?? "native", reading: admittedReadings[0], surface, requiresMorphology: false, requiredMorphology: null, evidenceRefs: uniq(admitted.map((h) => `fact#${h.factIndex}`)) };
        }
        if (admittedReadings.length > 1) return { status: "candidates", route: admitted[0].route ?? "native", readings: admittedReadings, evidenceRefs: uniq(admitted.map((h) => `fact#${h.factIndex}`)) };
        const boundCandidates = uniq(bound.map((h) => h.reading));
        if (boundCandidates.length) return { status: "candidates", route: bound[0].route ?? "native", readings: boundCandidates, evidenceRefs: uniq(bound.map((h) => `fact#${h.factIndex}`)) };
        if (typeof candidate.reading !== "string") return null;
        // accepted 4.6E Sino component reconstruction for an all-Han surface whose whole reading
        // decomposes into on-readings of its characters (never for words UniDic marks native/loan)
        if (sino && candidate.lexicalOrigin !== "native" && candidate.lexicalOrigin !== "loan" && !candidate.inflection && Array.from(surface).every((ch) => HAN.test(ch))) {
          const reconstructed = sino.reconstructWord(surface, candidate.reading);
          if (reconstructed?.status === "resolved") {
            return {
              route: "sino", reading: reconstructed.historicalReading, surface, requiresMorphology: false, requiredMorphology: null,
              components: reconstructed.components.map((c) => ({ lexicalIdentity: null, surface: c.surface, lexicalReading: c.modernReading, lexicalOrigin: "sino", readingClass: "on", historicalKana: c.historicalReading, evidenceRefs: c.evidenceRefs })),
              evidenceRefs: reconstructed.evidenceRefs
            };
          }
          if (reconstructed?.status === "candidates") return { status: "candidates", route: "sino", readings: reconstructed.historicalReadings, evidenceRefs: [] };
        }
        // surface-keyed historical reading, accepted only when the native kana relation of the
        // candidate's own modern reading names the same historical kana (two sources agree)
        const surfaceFacts = facts(surface).filter((f) => f.kind === "literal_reading" && f.historical && f.surface === surface);
        const admittedSurfaceReadings = uniq(surfaceFacts.filter((f) => !f.candidate).map((f) => f.reading));
        const agreed = admittedSurfaceReadings.filter((r) => kanaHistorical(candidate.reading).includes(r));
        if (agreed.length === 1) {
          return { route: "native", reading: agreed[0], surface, requiresMorphology: false, requiredMorphology: null, evidenceRefs: [`surface:${surface}`, `kana:${candidate.reading}>${agreed[0]}`] };
        }
        const candidateReadings = uniq(surfaceFacts.filter((f) => f.candidate).map((f) => f.reading));
        if (candidateReadings.length) return { status: "candidates", route: "native", readings: candidateReadings, evidenceRefs: [`surface:${surface}`] };
        return null;
      },
      historicalSurfaceLookup: (surface) => {
        if (policy.period !== "historical") return null;
        if (lexical.lookupSurfaceSync(surface).length) return null; // the identity route decides
        const rows = facts(surface).filter((f) => f.kind === "literal_reading" && f.historical && f.surface === surface);
        const admitted = uniq(rows.filter((f) => !f.candidate).map((f) => f.reading));
        if (admitted.length === 1) return { status: "resolved", route: "native", reading: admitted[0], surface, evidenceRefs: [`surface:${surface}`] };
        const readings = uniq(rows.map((f) => f.reading));
        if (readings.length) return { status: "candidates", route: "native", surfaceCandidates: [surface], readingCandidates: readings, evidenceRefs: [`surface:${surface}`] };
        return null;
      },
      contextualRelations: relations,
      contextualSafety: safety,
      safeKanjiMap: activeSafeKanjiMap
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
    for (const site of inflectedSites) addUnit(site.start, site.end);
    // relation keys the lexicon does not list (e.g. inflected stems) are still lexical units
    for (const m of factMatches) if (m.facts.some((f) => kanjiRelation(f) || kanaRelation(f) || f.safety)) addUnit(m.start, m.end);
    // Ruby spans are protected syntax: one unit each, resolved with the Ruby as reading evidence;
    // no other unit may cut into them (so base and reading are never rewritten piecemeal)
    const rubies = rubySpans(text);
    for (const [key, unit] of units) if (rubies.some((r) => unit.start < r.end && unit.end > r.start)) units.delete(key);
    for (const r of rubies) units.set(`${r.start}:${r.end}`, { start: r.start, end: r.end, surface: r.source, ruby: r });

    const readingKeys = new Set();
    for (const unit of units.values()) {
      const base = unit.ruby ? unit.ruby.base : unit.surface;
      if (isKana(base)) continue;
      for (const c of lexicalCandidates(base)) if (typeof c.reading === "string" && !factsAt.has(c.reading)) readingKeys.add(c.reading);
    }
    for (const reading of readingKeys) await pack.prepare(reading);

    // style overlay attested-form check (#196 G) needs the lexeme's forms: fetch those few records
    const styleFrom = new Set(rules.filter((r) => r.predicate?.styleFamily === "okurigana-abbreviation").flatMap((r) => r.from));
    const formsOf = new Map();
    for (const list of inflected.values()) for (const c of list) {
      if (c.inflection && styleFrom.has(c.inflection.baseSurface) && !formsOf.has(c.lexemeId)) formsOf.set(c.lexemeId, (await lexical.getForms(c.lexemeId)).map((f) => f.surface));
    }

    const candidates = [];
    const contextual = [];
    const recognized = [];
    const exactTokenRules = rules.filter((r) => r.predicate?.exactToken === true && r.predicate?.channel === "surface");
    for (const unit of units.values()) {
      const { start, end, surface } = unit;
      let outputs = [];
      let resolved = null;
      if (unit.ruby) {
        // Ruby input: the resolver reads the Ruby as reading evidence (whole-word Ruby filters the
        // lexical candidates). The author's Ruby markup round-trips: the output keeps Ruby in the
        // input's explicit/implicit style unless a Ruby render mode is requested. Without a resolved
        // historical reading the whole segment is preserved unchanged (fail closed).
        resolved = resolver.resolveUnit(surface);
        const h = resolved.historical;
        if (resolved.kind === "resolved" && h.disposition !== "PRESERVE" && h.disposition !== "CANDIDATES" && h.kana) {
          const mode = renderMode === "plain" ? (unit.ruby.explicit ? "ruby-whole-explicit" : "ruby-whole-implicit") : renderMode;
          outputs = [resolver.render(resolved, { mode })];
        }
      } else if (isKana(surface)) {
        // dictionary-form readings plus deinflected kana forms (morphology-filtered by JMdict POS)
        const readingCandidates = [...lexical.lookupReadingSync(surface), ...(inflected.get(surface) ?? [])];
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
              ? uniq((h.contextualKanji.candidates.length ? h.contextualKanji.candidates : [h.surface]).map(applyActiveSafe))
              .flatMap((s) => (renderMode === "plain" || !(h.sinoCandidates || h.nativeCandidates) ? [s] : uniq([...(h.sinoCandidates?.readings ?? []), ...(h.nativeCandidates?.readings ?? [])]).map((k) => resolver.render({ ...resolved, historical: { ...h, surface: s, kana: k } }, { mode: renderMode }))))
            : [resolver.render(resolved, { mode: renderMode })];
        } else if (resolved.kind !== "resolved" && h.disposition !== "PRESERVE") {
          // lexical ambiguity: only identity-independent knowledge applies — relations bound to no
          // lexeme, and deterministic character rendering. It never selects among the candidates.
          const global = uniq(relations.filter((r) => r.match === surface && r.lexicalBindingIds.length === 0).map((r) => r.target));
          const preserved = safety.some((x) => x.match === surface);
          if (!preserved && renderMode !== "plain" && resolved.displayReading?.value) {
            const displaySurfaces = global.length ? global.map(applyActiveSafe) : [surface];
            outputs = displaySurfaces.map((displaySurface) => resolver.render({
              ...resolved,
              historical: { ...h, surface: displaySurface }
            }, { mode: renderMode }));
          } else {
            outputs = preserved ? [] : (global.length ? global : [surface]).map(applyActiveSafe);
          }
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
      // KiNoTch style/render overlay (#196 G, #47): composed *after* the semantic result. A profile
      // style rule applies to an exact token, or — for the okurigana family — to an inflected form
      // of the same lexeme when the style target is an attested form of that lexeme. It never
      // overrides a semantic change (the semantic output no longer carries the rule's source form).
      if (!outputs.length && !unit.ruby) {
        const lexicalForStyle = isKana(surface) ? [] : lexicalCandidates(surface);
        for (const rule of exactTokenRules) {
          let output = null;
          if (rule.from.includes(surface)) output = rule.to[0];
          else if (rule.predicate?.styleFamily === "okurigana-abbreviation" && resolved.kind === "resolved" && resolved.lexicalIdentity) {
            const same = lexicalForStyle.filter((c) => c.lexicalIdentity === resolved.lexicalIdentity);
            const from = rule.from[0];
            const to = rule.to[0];
            let k = 0;
            while (k < Math.min(from.length, to.length) && from[from.length - 1 - k] === to[to.length - 1 - k]) k += 1;
            const stemFrom = from.slice(0, from.length - k);
            const stemTo = to.slice(0, to.length - k);
            if (same.length && same.every((c) => c.inflection?.baseSurface === from && (formsOf.get(c.lexemeId) ?? []).includes(to)) && surface.startsWith(stemFrom)) {
              output = stemTo + surface.slice(stemFrom.length);
            }
          }
          if (output !== null && output !== surface) {
            candidates.push({ start, end, output, policy: "whole_lexeme", origin: "rule", ref: rule.id, rule, unit: summarizeUnit(resolved), authority: "project_rule" });
          }
        }
      }
    }
    // deterministic character rendering outside lexical units that already resolved an output (inside
    // them the resolver applied the same safe map, so a character candidate would only be redundant)
    const unitOutputs = candidates.filter((c) => c.origin === "resolver");
    for (const [start, end] of charBoundaries) {
      const ch = text.slice(start, end);
      const rule = safeRules.get(ch);
      if (rule && !rubies.some((r) => start < r.end && end > r.start) && !unitOutputs.some((c) => start >= c.start && end <= c.end)) candidates.push({ start, end, output: rule.from[0], policy: "anywhere", origin: "rule", ref: rule.id, rule });
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
      lexicalCandidates: (unit.lexicalCandidates ?? []).map((c) => ({ lexicalIdentity: c.lexicalIdentity, lexemeId: c.lexemeId ?? null, surface: c.surface ?? null, reading: c.reading ?? null, inflection: c.inflection ?? null })),
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

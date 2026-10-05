(function (root, factory) {
  const isCommonJs = typeof module === "object" && module.exports;
  if (!isCommonJs && typeof importScripts === "function" && typeof root.BrowserSpanPlanner === "undefined") {
    // dedicated Worker: load the runtime modules next to this script
    importScripts("browser-pack-binary.js", "browser-pack-runtime.js", "occurrence-arbitration.js", "browser-span-planner.js", "browser-diagnostic-contract.js", "browser-section-fetcher.js",
      "transform-shared.js", "orthography-resolver.js", "browser-lexical-runtime.js", "browser-inflection.js", "historical-sino-runtime.js", "browser-resolver-adapter.js", "symbol-registry-runtime.js", "sequence-pool-runtime.js", "rule-program-vm.js", "browser-program-runtime.js");
  }
  const deps = isCommonJs
    ? { runtime: require("./browser-pack-runtime.js"), planner: require("./browser-span-planner.js"), diagnostics: safeRequire("./browser-diagnostic-contract.js"), fetcher: safeRequire("./browser-section-fetcher.js"), transformShared: safeRequire("./transform-shared.js"),
      lexicalRuntime: safeRequire("./browser-lexical-runtime.js"), resolver: safeRequire("./orthography-resolver.js"), adapter: safeRequire("./browser-resolver-adapter.js"), programRuntime: safeRequire("./browser-program-runtime.js") }
    : { runtime: root.BrowserPackRuntime, planner: root.BrowserSpanPlanner, diagnostics: root.BrowserDiagnosticContract, fetcher: root.BrowserSectionFetcher,
      transformShared: root.TransformShared,
      lexicalRuntime: root.BrowserLexicalRuntime, resolver: root.OrthographyResolver, adapter: root.BrowserResolverAdapter, programRuntime: root.BrowserProgramRuntime };
  function safeRequire(path) { try { return require(path); } catch { return null; } }
  const api = factory(deps);
  if (isCommonJs) module.exports = api;
  root.BrowserTransformWorker = api;
  if (!isCommonJs && typeof root.addEventListener === "function" && typeof importScripts === "function") api.attachToWorkerScope(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (deps) {
  "use strict";
  const { runtime, planner, diagnostics, fetcher, transformShared, lexicalRuntime, resolver, adapter, programRuntime } = deps;

  // Worker-side transform service (#185 D/E). The pack is opened once per service and reused for every
  // request. Only plain, compact JSON crosses the worker boundary; the pack, its TypedArray views and
  // any canonical structure stay inside the worker.

  const plainSpan = (span) => ({
    start: span.start, end: span.end, sourceText: span.sourceText, renderedText: span.renderedText,
    renderedStart: span.renderedStart, renderedEnd: span.renderedEnd, state: span.state, reasons: span.reasons,
    winners: span.winners.map((w) => ({ output: w.output, origin: w.origin, ref: w.ref, policy: w.policy })),
    blocked: span.blocked.map((b) => ({ output: b.output, origin: b.origin, ref: b.ref, reason: b.reason, start: b.start, end: b.end })),
    contextual: span.contextual.map((c) => ({ output: c.output, ref: c.fact.detailRef }))
  });

  const createTransformService = ({ openPack, executionMode = "parity", adapter: adapterOverride, lexicalRuntime: lexicalRuntimeOverride, programRuntime: programRuntimeOverride }) => {
    const selectedAdapter = adapterOverride ?? adapter;
    const selectedLexicalRuntime = lexicalRuntimeOverride ?? lexicalRuntime;
    const selectedProgramRuntime = programRuntimeOverride ?? programRuntime;
    const executionModes = new Set(["legacy-only", "parity", "vm-authoritative"]);
    if (!executionModes.has(executionMode)) throw new RangeError(`unknown execution mode ${executionMode}`);
    let packPromise = null;
    let opens = 0;
    const pack = () => {
      if (!packPromise) {
        opens += 1;
        packPromise = openPack().catch((error) => { packPromise = null; throw error; });
      }
      return packPromise;
    };
    const lastResults = new Map(); // requestId -> raw planner result (for lazy detail expansion)
    // BrowserPack v2 (lexical layer present): the accepted resolver via the adapter (#196 D);
    // a v1 pack keeps the v1 planner, so the published site is unaffected until the J cutover
    const lexicalFor = new WeakMap();
    const programFor = new WeakMap();
    const sinoFor = new WeakMap();
    const lexicalScopeFor = async (p, text) => {
      if (!selectedLexicalRuntime || typeof p.hasSection !== "function" || !p.hasSection("lexical-directory")
        || typeof p.eagerSection !== "function" || !p.eagerSection("lexical-directory")) {
        return { lexicalMatches: [], lexemesFor: () => new Set() };
      }
      if (!lexicalFor.has(p)) lexicalFor.set(p, selectedLexicalRuntime.createBrowserLexicalRuntime(p));
      const lexical = lexicalFor.get(p);
      await lexical.prepare(text, { reading: true });
      const byRange = new Map();
      const candidatesByRange = new Map();
      const lexicalMatches = [];
      for (let start = 0; start < text.length;) {
        const ch = planner.charAt(text, start);
        for (const match of lexical.matchesAtSync(text, start, "surface")) {
          lexicalMatches.push({ start: match.start, end: match.end });
          const key = `${match.start}:${match.end}`;
          const ids = byRange.get(key) ?? new Set();
          for (const candidate of match.candidates ?? []) if (Number.isInteger(candidate.lexemeId)) ids.add(candidate.lexemeId);
          byRange.set(key, ids);
          candidatesByRange.set(key, match.candidates ?? []);
        }
        start += ch.length;
      }
      return {
        lexical,
        lexicalMatches,
        candidatesFor: (start, end) => candidatesByRange.get(`${start}:${end}`) ?? [],
        lexemesFor: (start, end) => byRange.get(`${start}:${end}`) ?? new Set()
      };
    };
    const sinoComponentsFor = async (p) => {
      if (sinoFor.has(p)) return sinoFor.get(p);
      const promise = (async () => {
        const byKey = new Map();
        const add = (character, modernReading, historicalReading, metadata = {}) => {
          if (!character || !modernReading || !historicalReading) return;
          const key = `${character}:${modernReading}:${historicalReading}`;
          const current = byKey.get(key) ?? {
            character, modernReading, historicalReading, classFlags: 0,
            sourceRefs: [], evidenceRefs: []
          };
          current.classFlags |= metadata.classFlags ?? 0;
          for (const name of ["sourceRefs", "evidenceRefs"]) {
            for (const value of metadata[name] ?? []) if (!current[name].includes(value)) current[name].push(value);
          }
          byKey.set(key, current);
        };
        if (typeof p.bindingCount === "function" && typeof p.getBinding === "function" && typeof p.getRule === "function") {
          for (let i = 0; i < p.bindingCount(); i += 1) {
            const binding = p.getBinding(i);
            const rule = p.getRule(binding.rule);
            const symbol = binding.lexicalRefs.find((ref) => ref.startsWith("symbol:"));
            if (!symbol || !rule?.id?.startsWith("rule:sino:") || rule.from.length !== 1 || rule.to.length !== 1) continue;
            add(symbol.slice("symbol:".length), rule.to[0], rule.from[0], {
              sourceRefs: [...(binding.sourceRefs ?? []), ...(rule.sourceRefs ?? [])],
              evidenceRefs: [...(binding.evidenceRefs ?? []), ...(rule.evidenceRefs ?? [])]
            });
          }
        }
        let section = typeof p.eagerSection === "function" ? p.eagerSection("sino-component-index") : null;
        if (!section && typeof p.sectionsOfKind === "function" && typeof p.loadSection === "function") {
          const descriptor = p.sectionsOfKind("sino-component-index")[0];
          if (descriptor) section = await p.loadSection(descriptor.sectionId);
        }
        if (section) {
          const stringOf = (id) => section.string("strings", id);
          for (let i = 0; i < section.rowCount("character"); i += 1) {
            add(stringOf(section.value("character", i)), stringOf(section.value("modernReading", i)), stringOf(section.value("modernReading", i)), {
              classFlags: section.value("classFlags", i),
              sourceRefs: [...section.list("sourceRefs", i)].map(stringOf),
              evidenceRefs: [...section.list("evidenceRefs", i)].map(stringOf)
            });
          }
        }
        return [...byKey.values()].sort((a, b) => a.character.localeCompare(b.character) || a.modernReading.localeCompare(b.modernReading) || a.historicalReading.localeCompare(b.historicalReading));
      })();
      sinoFor.set(p, promise);
      return promise;
    };
    const alignSinoComponents = (surface, modernReading, components) => {
      const chars = [...surface];
      const byCharacter = new Map();
      for (const component of components) {
        const list = byCharacter.get(component.character) ?? [];
        list.push(component);
        byCharacter.set(component.character, list);
      }
      const paths = [];
      const walk = (characterIndex, readingIndex, parts) => {
        if (paths.length >= 32) return;
        if (characterIndex === chars.length) {
          if (readingIndex === modernReading.length) paths.push(parts);
          return;
        }
        for (const component of byCharacter.get(chars[characterIndex]) ?? []) {
          if (!modernReading.startsWith(component.modernReading, readingIndex)) continue;
          const end = readingIndex + component.modernReading.length;
          walk(characterIndex + 1, end, [...parts, { ...component, start: readingIndex, end }]);
        }
      };
      walk(0, 0, []);
      const unique = new Map();
      for (const path of paths) {
        const key = path.map((part) => `${part.character}:${part.modernReading}:${part.historicalReading}`).join("|");
        unique.set(key, path);
      }
      return [...unique.values()];
    };
    const runSinoReadingPath = async (p, hot, profileId, candidate, path) => {
      if (!path.length || path.some((part) => part.evidenceRefs.length === 0)) return null;
      const modernReading = candidate.reading;
      if (typeof modernReading !== "string") return null;
      const lexemeIds = Number.isInteger(candidate.lexemeId) ? new Set([candidate.lexemeId]) : new Set();
      const symbolFor = (start, end) => {
        const part = path.find((entry) => entry.start === start && entry.end === end);
        return part && typeof hot.symbolId === "function" ? hot.symbolId(part.character) : undefined;
      };
      const observation = await hot.transformText(modernReading, profileId, {
        stages: ["diachronic"], directions: ["to-historical"], channels: ["reading"],
        symbolFor, lexemesFor: () => lexemeIds
      });
      const historicalParts = [];
      const programIds = [];
      for (const part of path) {
        const outputs = [...new Map((observation.candidates ?? [])
          .filter((item) => item.start === part.start && item.end === part.end && item.channel === "reading")
          .map((item) => [item.output, item])).values()];
        // The VM can expose preserve/alternative edges for the same span. The
        // source-backed component path is the semantic selector here: retain
        // only the output licensed by this component evidence, while still
        // failing closed when the VM does not expose that output at all.
        const output = outputs.find((item) => item.output === part.historicalReading);
        // Identity components are licensed directly by the source-backed compact
        // row and therefore do not need a Rule Program edge. A changed component
        // must still have the exact source-selected VM output.
        if (!output && part.historicalReading !== part.modernReading) return null;
        historicalParts.push({ ...part, historicalReading: output?.output ?? part.historicalReading });
        for (const id of output?.programIds ?? []) if (!programIds.includes(id)) programIds.push(id);
      }
      const historicalReading = historicalParts.map((part) => part.historicalReading).join("");
      const provenance = await programEvidenceFor(p, programIds);
      const componentEvidence = historicalParts.flatMap((part) => part.evidenceRefs);
      return {
        historicalReading,
        programIds,
        trace: observation.trace,
        provenance: {
          sourceRefs: [...new Set([...provenance.sourceRefs, ...historicalParts.flatMap((part) => part.sourceRefs)])],
          evidenceRefs: [...new Set([...provenance.evidenceRefs, ...componentEvidence])],
          canonicalIds: provenance.canonicalIds
        },
        components: historicalParts.map((part) => ({
          lexicalIdentity: null, surface: part.character, lexicalReading: part.modernReading,
          lexicalOrigin: "sino", readingClass: part.classFlags, historicalKana: part.historicalReading,
          evidenceRefs: [...part.evidenceRefs]
        }))
      };
    };
    const programForPack = async (p) => {
      if (!selectedProgramRuntime || typeof p.hasSection !== "function" || !p.hasSection("sequence-pool")) return null;
      if (!programFor.has(p)) programFor.set(p, selectedProgramRuntime.createBrowserProgramRuntime(p));
      return programFor.get(p);
    };
    const programDirection = (p, profileId) => {
      const period = p.getProfilePolicy(profileId).policy.period;
      if (profileId === "kinotch-fixed") return ["to-historical", "to-modern"];
      return [period === "historical" ? "to-historical" : "to-modern"];
    };
    const charBoundariesOf = (text) => {
      const charBoundaries = [];
      for (let i = 0; i < text.length;) {
        const end = i + planner.charAt(text, i).length;
        charBoundaries.push([i, end]);
        i = end;
      }
      return charBoundaries;
    };
    const normalizeRubyInput = (source) => {
      const parseRubySegments = transformShared?.parseRubySegments;
      if (typeof parseRubySegments !== "function") return null;
      const segments = parseRubySegments(source);
      if (!segments.some((segment) => segment?.type === "ruby")) return null;
      let sourceCursor = 0;
      let baseCursor = 0;
      let baseText = "";
      const ranges = [];
      for (const segment of segments) {
        const segmentText = `${segment?.type === "ruby" ? segment.base ?? "" : segment?.text ?? ""}`;
        const originalText = `${segment?.text ?? ""}`;
        const originalIndex = source.indexOf(originalText, sourceCursor);
        if (originalIndex < 0) return null;
        if (segment?.type === "ruby") {
          const originalStart = originalIndex > 0 && source[originalIndex - 1] === "｜" ? originalIndex - 1 : originalIndex;
          ranges.push({
            baseStart: baseCursor,
            baseEnd: baseCursor + segmentText.length,
            originalStart,
            originalEnd: originalIndex + originalText.length
          });
        }
        baseText += segmentText;
        baseCursor += segmentText.length;
        sourceCursor = originalIndex + originalText.length;
      }
      return { baseText, ranges };
    };
    const restoreRubyInputRanges = (raw, source, normalized) => {
      if (!normalized) return raw;
      const mapRange = (range) => {
        const affected = normalized.ranges.filter((entry) => range.start < entry.baseEnd && range.end > entry.baseStart);
        if (affected.length === 0) {
          const delta = normalized.ranges
            .filter((entry) => entry.baseEnd <= range.start)
            .reduce((total, entry) => total
              + (entry.originalEnd - entry.originalStart) - (entry.baseEnd - entry.baseStart), 0);
          return { start: range.start + delta, end: range.end + delta };
        }
        return { start: affected[0].originalStart, end: affected.at(-1).originalEnd };
      };
      const spans = (raw.spans ?? []).map((span) => {
        const mapped = mapRange(span);
        return { ...span, ...mapped, sourceText: source.slice(mapped.start, mapped.end) };
      });
      const units = (raw.units ?? []).map((unit) => {
        const mapped = mapRange(unit);
        return { ...unit, ...mapped, surface: source.slice(mapped.start, mapped.end) };
      });
      return { ...raw, sourceText: source, spans, units };
    };
    const surfaceCandidatesOf = (observation, options = {}) => {
      const surface = (observation.candidates ?? [])
        .filter((candidate) => !candidate.channel || candidate.channel === "surface");
      if (surface.length > 0 || (options.lexicalMatches?.length ?? 0) > 0) return surface;
      // Some source-backed native-kana rules are indexed on the reading
      // channel and have no lexical surface match (for example サービス ->
      // サーヸス). In that bounded case the Rule Program result is the
      // surface transformation itself, not Ruby metadata.
      return (observation.candidates ?? [])
        .filter((candidate) => candidate.channel === "reading")
        .map((candidate) => ({
          ...candidate,
          policy: "anywhere",
          authority: options.authority ?? "source_rule",
          unit: {
            kind: "resolved",
            sourceText: options.sourceText ?? null,
            sourceSurface: options.sourceText?.slice(candidate.start, candidate.end) ?? null,
            lexicalIdentity: null,
            reading: { modernSurface: null, source: "unknown" },
            displayReading: null,
            lexicalOrigin: "unknown",
            morphology: null,
            components: [],
            lexicalCandidates: [],
            historical: { status: "unknown", route: null, kana: null, sourceRefs: [], evidenceRefs: [], canonicalIds: [] }
          }
        }));
    };
    const assembleProgramObservation = (text, profileId, observation, renderMode, options = {}) => {
      const charBoundaries = charBoundariesOf(text);
      const lexicalMatches = options.lexicalMatches ?? [];
      const raw = planner.assemble(text, profileId, planner.lexicalDag(text.length, lexicalMatches, charBoundaries), observation.candidates ?? [], observation.contextual ?? [], { lexicalMatchCount: options.lexicalMatchCount ?? observation.lexicalMatchCount ?? lexicalMatches.length });
      return { ...raw, engine: "rule-program", renderMode: renderMode ?? "plain", programTrace: observation.trace, executionMode: "vm-authoritative" };
    };
    const programEvidenceFor = async (p, programIds) => {
      const entries = [];
      for (const programId of [...new Set(programIds ?? [])]) {
        const evidence = typeof p.loadProgramEvidence === "function" ? await p.loadProgramEvidence(programId) : null;
        if (evidence) entries.push(evidence);
      }
      return {
        sourceRefs: [],
        evidenceRefs: [...new Set(entries.flatMap((entry) => entry.evidenceRefs ?? []))],
        canonicalIds: [...new Set(entries.flatMap((entry) => entry.canonicalIds ?? []))]
      };
    };
    const localSurface = (text, profileId, start, end, candidates) => {
      const source = text.slice(start, end);
      const localCandidates = candidates
        .filter((candidate) => candidate.start >= start && candidate.end <= end)
        .map((candidate) => ({ ...candidate, start: candidate.start - start, end: candidate.end - start }));
      return planner.assemble(source, profileId, planner.lexicalDag(source.length, [], charBoundariesOf(source)), localCandidates, [], {}).renderedText;
    };
    const composeProgramSurfaceCandidates = async (p, text, profileId, scope, observation, candidates) => {
      const covered = new Set();
      const composed = [];
      for (const match of scope.lexicalMatches) {
        const surface = text.slice(match.start, match.end);
        const local = candidates
          .map((candidate, index) => ({ candidate, index }))
          .filter(({ candidate }) => candidate.start >= match.start && candidate.end <= match.end);
        if (local.length === 0) continue;
        const output = localSurface(text, profileId, match.start, match.end, local.map(({ candidate }) => candidate));
        if (output === surface) continue;
        for (const { index } of local) covered.add(index);
        const lexicalCandidates = scope.candidatesFor(match.start, match.end);
        let unit;
        if (profileId !== "modern" && lexicalCandidates.length === 1) {
          const exactReading = [...new Map((observation.candidates ?? [])
            .filter((candidate) => candidate.channel === "reading" && candidate.stage === "diachronic"
              && candidate.direction === "to-historical" && candidate.start === match.start && candidate.end === match.end)
            .map((candidate) => [candidate.output, candidate])).values()];
          const admitted = (lexicalCandidates[0].historicalReadings ?? []).filter((entry) => (
            entry.surface === surface && exactReading.length === 1 && entry.reading === exactReading[0].output && entry.candidate !== true
          ));
          if (admitted.length === 1) {
            const provenance = await programEvidenceFor(p, exactReading[0].programIds ?? []);
            const unitResolver = resolver.createResolver({
              lexicalLookup: () => [lexicalCandidates[0]],
              historicalLookup: () => ({
                route: admitted[0].route ?? "native",
                basis: "rule_program",
                reading: admitted[0].reading,
                surface: output,
                ...provenance
              })
            });
            unit = typeof selectedAdapter?.summarizeUnit === "function"
              ? selectedAdapter.summarizeUnit(unitResolver.resolveUnit(surface))
              : unitResolver.resolveUnit(surface);
          }
        }
        composed.push({
          start: match.start,
          end: match.end,
          output,
          policy: "lexical_boundary",
          origin: "program",
          ref: `program:surface:${match.start}:${match.end}`,
          programIds: [...new Set(local.flatMap(({ candidate }) => candidate.programIds ?? []))],
          candidate: local.some(({ candidate }) => candidate.candidate === true),
          ...(unit ? { unit } : {}),
          key: `program:surface:${match.start}:${match.end}:${output}`
        });
      }
      return [
        ...candidates.filter((_, index) => !covered.has(index)),
        ...composed
      ];
    };
    const transformWithProgramRuby = async (p, hot, text, profileId, renderMode, supplied = {}) => {
      const scope = supplied.scope ?? await lexicalScopeFor(p, text);
      const observation = supplied.observation ?? await hot.transformText(text, profileId, {
        directions: programDirection(p, profileId),
        lexemesFor: scope.lexemesFor
      });
      const surfaceCandidates = surfaceCandidatesOf(observation, { lexicalMatches: scope.lexicalMatches, sourceText: text, authority: "source_rule" });
      const readingCandidates = (observation.candidates ?? []).filter((candidate) => (
        candidate.channel === "reading" && candidate.stage === "diachronic" && candidate.direction === "to-historical"
      ));
      const rubyCandidates = [];
      const units = [];
      const extraTraces = [];
      const period = p.getProfilePolicy(profileId).policy.period;
      for (const match of scope.lexicalMatches) {
        const surface = text.slice(match.start, match.end);
        const lexicalCandidates = scope.candidatesFor(match.start, match.end);
        if (lexicalCandidates.length === 0) continue;
        const baseSurface = localSurface(text, profileId, match.start, match.end, surfaceCandidates);
        const exactReading = [...new Map(readingCandidates
          .filter((candidate) => candidate.start === match.start && candidate.end === match.end)
          .map((candidate) => [candidate.output, candidate])).values()];
        let resolved = null;
        let programIds = [];
        if (period === "historical" && lexicalCandidates.length === 1 && exactReading.length === 1) {
          const lexicalCandidate = lexicalCandidates[0];
          const reading = exactReading[0];
          const admitted = (lexicalCandidate.historicalReadings ?? []).filter((entry) => (
            entry.surface === surface && entry.reading === reading.output && entry.candidate !== true
          ));
          if (admitted.length === 1) {
            programIds = reading.programIds ?? [];
            const provenance = await programEvidenceFor(p, programIds);
            const unitResolver = resolver.createResolver({
              lexicalLookup: () => [lexicalCandidate],
              historicalLookup: () => ({
                route: admitted[0].route ?? "native",
                basis: "rule_program",
                reading: reading.output,
                surface: baseSurface,
                ...provenance
              })
            });
            resolved = unitResolver.resolveUnit(surface);
          }
        } else if (period !== "historical") {
          const unitResolver = resolver.createResolver({ lexicalLookup: () => lexicalCandidates });
          resolved = unitResolver.resolveUnit(surface);
        }
        if (period === "historical" && !resolved && lexicalCandidates.length === 1 && lexicalCandidates[0].reading) {
          const components = await sinoComponentsFor(p);
          const paths = alignSinoComponents(surface, lexicalCandidates[0].reading, components);
          const sinoResults = [];
          for (const path of paths) {
            const result = await runSinoReadingPath(p, hot, profileId, lexicalCandidates[0], path);
            if (result) sinoResults.push(result);
          }
          const uniqueResults = [...new Map(sinoResults.map((result) => [result.historicalReading, result])).values()];
          if (uniqueResults.length === 1) {
            const result = uniqueResults[0];
            programIds = result.programIds;
            extraTraces.push(result.trace);
            const unitResolver = resolver.createResolver({
              lexicalLookup: () => [lexicalCandidates[0]],
              historicalLookup: () => ({
                route: "sino",
                basis: "sino_component_reconstruction",
                reading: result.historicalReading,
                surface: baseSurface,
                components: result.components,
                ...result.provenance
              })
            });
            resolved = unitResolver.resolveUnit(surface);
          }
        }
        if (!resolved) {
          const unitResolver = resolver.createResolver({ lexicalLookup: () => lexicalCandidates });
          resolved = unitResolver.resolveUnit(surface);
        }
        const summarized = typeof selectedAdapter?.summarizeUnit === "function"
          ? selectedAdapter.summarizeUnit(resolved)
          : resolved;
        units.push({ start: match.start, end: match.end, surface, outputs: [], unit: summarized });
        if (period === "historical" && resolved.kind === "resolved" && resolved.historical?.status === "resolved"
          && (exactReading.length === 1 || resolved.historical.basis === "sino_component_reconstruction")) {
          const reading = exactReading[0] ?? null;
          const rendered = resolver.createResolver({ lexicalLookup: () => [lexicalCandidates[0]] }).render(resolved, { mode: renderMode, profile: period });
          if (rendered !== surface) {
            rubyCandidates.push({
              start: match.start, end: match.end, output: rendered, policy: "lexical_boundary", origin: "program",
              ref: `program:${programIds.at(-1) ?? "historical-reading"}`,
              programIds, candidate: Boolean(reading?.candidate), unit: summarized,
              provenance: resolved.historical
            });
            units.at(-1).outputs = [rendered];
          }
        } else if (period !== "historical" && resolved.kind !== "protected" && resolved.displayReading?.value) {
          const rendered = resolver.createResolver({ lexicalLookup: () => [lexicalCandidates[0]] }).render(resolved, { mode: renderMode, profile: period });
          if (rendered !== surface) {
            rubyCandidates.push({
              start: match.start, end: match.end, output: rendered, policy: "lexical_boundary", origin: "program",
              ref: "program:display-reading", programIds: [], candidate: false, unit: summarized
            });
            units.at(-1).outputs = [rendered];
          }
        }
      }
      const observationForAssembly = {
        ...observation,
        candidates: [...surfaceCandidates, ...rubyCandidates]
      };
      const charBoundaries = charBoundariesOf(text);
      const raw = planner.assemble(text, profileId, planner.lexicalDag(text.length, scope.lexicalMatches, charBoundaries), observationForAssembly.candidates, observationForAssembly.contextual ?? [], { lexicalMatchCount: scope.lexicalMatches.length });
      return {
        ...raw,
        engine: "rule-program",
        renderMode: renderMode ?? "plain",
        programTrace: {
          executedProgramIds: [...new Set([...(observation.trace?.executedProgramIds ?? []), ...extraTraces.flatMap((trace) => trace.executedProgramIds ?? [])])],
          runs: [...(observation.trace?.runs ?? []), ...extraTraces.flatMap((trace) => trace.runs ?? [])]
        },
        executionMode: "vm-authoritative",
        units
      };
    };
    const transformWithProgram = async (p, hot, text, profileId, renderMode) => {
      const scope = await lexicalScopeFor(p, text);
      const observation = await hot.transformText(text, profileId, {
        directions: programDirection(p, profileId),
        lexemesFor: scope.lexemesFor
      });
      const surfaceCandidates = await composeProgramSurfaceCandidates(
        p,
        text,
        profileId,
        scope,
        observation,
        surfaceCandidatesOf(observation, { lexicalMatches: scope.lexicalMatches })
      );
      return assembleProgramObservation(text, profileId, { ...observation, candidates: surfaceCandidates }, renderMode, { lexicalMatches: scope.lexicalMatches });
    };
    const compareProgramOutput = (legacy, program) => {
      const summarize = (raw) => diagnostics?.summarize(raw) ?? null;
      const legacySummary = summarize(legacy);
      const programSummary = summarize(program);
      const semanticSpans = (summary) => (summary?.spans ?? []).map((span) => ({
        start: span.start,
        end: span.end,
        renderedText: span.renderedText,
        certainty: span.certainty,
        authority: span.authority,
        resolved: span.resolved
      }));
      const legacySemantic = semanticSpans(legacySummary);
      const programSemantic = semanticSpans(programSummary);
      const semanticEquivalent = JSON.stringify(legacySemantic) === JSON.stringify(programSemantic);
      return {
        equivalent: legacy.renderedText === program.renderedText
          && (legacy.spans?.length ?? 0) === (program.spans?.length ?? 0)
          && semanticEquivalent,
        legacyRenderedText: legacy.renderedText,
        programRenderedText: program.renderedText,
        legacySpanCount: legacy.spans?.length ?? 0,
        programSpanCount: program.spans?.length ?? 0,
        semanticEquivalent,
        legacySemantic,
        programSemantic,
        authority: "legacy"
      };
    };
    const transformLegacy = async (p, text, profileId, renderMode) => {
      if (selectedAdapter && selectedLexicalRuntime && typeof p.hasSection === "function" && p.hasSection("lexical-directory")) {
        if (!lexicalFor.has(p)) lexicalFor.set(p, selectedLexicalRuntime.createBrowserLexicalRuntime(p));
        return selectedAdapter.transformWithResolver(p, lexicalFor.get(p), text, profileId, { renderMode: renderMode ?? "plain" });
      }
      return planner.planAndTransform(p, text, profileId);
    };

    const handle = async (message) => {
      try {
        if (message?.type === "open") {
          const p = await pack();
          // render modes are a capability of the v2 resolver path; a v1 pack renders plain text only
          const renderModes = typeof p.hasSection === "function" && p.hasSection("lexical-directory") && selectedAdapter
            ? ["plain", "ruby-whole-explicit", "ruby-whole-implicit", "ruby-components-explicit", "ruby-components-implicit"] : ["plain"];
          return { type: "opened", requestId: message.requestId, packDigest: p.packDigest, profiles: p.profiles, stats: p.stats(), renderModes, executionModes: [...executionModes] };
        }
        if (message?.type === "transform") {
          const p = await pack();
          const started = Date.now();
          const mode = message.executionMode ?? executionMode;
          if (!executionModes.has(mode)) throw new RangeError(`unknown execution mode ${mode}`);
          const source = `${message.text ?? ""}`;
          const normalizedRuby = normalizeRubyInput(source);
          const programSource = normalizedRuby?.baseText ?? source;
          let raw;
          if (mode === "vm-authoritative") {
            const hot = await programForPack(p);
            if (!hot || typeof hot.transformText !== "function") throw new Error("Rule Program VM admission failed: required hot sections are unavailable");
            raw = (message.renderMode ?? "plain") === "plain" && !normalizedRuby
              ? await transformWithProgram(p, hot, programSource, message.profileId, message.renderMode)
              : await transformWithProgramRuby(p, hot, programSource, message.profileId, normalizedRuby && (message.renderMode ?? "plain") === "plain" ? "ruby-whole-explicit" : message.renderMode);
            raw = restoreRubyInputRanges(raw, source, normalizedRuby);
            raw.renderMode = message.renderMode ?? "plain";
          } else {
            raw = await transformLegacy(p, source, message.profileId, message.renderMode);
            if (mode === "parity") {
              const hot = await programForPack(p);
              if (hot && typeof hot.transformText === "function") {
                const scope = await lexicalScopeFor(p, programSource);
                const observation = await hot.transformText(programSource, message.profileId, {
                  directions: programDirection(p, message.profileId),
                  lexemesFor: scope.lexemesFor
                });
                raw.programTrace = observation.trace;
                if ((message.renderMode ?? "plain") === "plain" && !normalizedRuby) {
                  const surfaceCandidates = await composeProgramSurfaceCandidates(
                    p,
                    programSource,
                    message.profileId,
                    scope,
                    observation,
                    surfaceCandidatesOf(observation, { lexicalMatches: scope.lexicalMatches, sourceText: programSource, authority: "source_rule" })
                  );
                  const program = assembleProgramObservation(programSource, message.profileId, { ...observation, candidates: surfaceCandidates }, "plain", { lexicalMatches: scope.lexicalMatches });
                  raw.programParity = compareProgramOutput(raw, restoreRubyInputRanges(program, source, normalizedRuby));
                } else {
                  const program = await transformWithProgramRuby(p, hot, programSource, message.profileId, normalizedRuby && (message.renderMode ?? "plain") === "plain" ? "ruby-whole-explicit" : message.renderMode, { scope, observation });
                  const parityLegacy = normalizedRuby
                    ? await transformLegacy(p, programSource, message.profileId, (message.renderMode ?? "plain") === "plain" ? "ruby-whole-explicit" : message.renderMode)
                    : raw;
                  raw.programParity = compareProgramOutput(parityLegacy, normalizedRuby ? program : restoreRubyInputRanges(program, source, normalizedRuby));
                }
              }
            }
          }
          lastResults.clear();
          lastResults.set(message.requestId, raw);
          const result = diagnostics ? diagnostics.summarize(raw) : { renderedText: raw.renderedText, spans: raw.spans.map(plainSpan), offsetUnit: raw.offsetUnit };
          return { type: "result", requestId: message.requestId, result: { ...result, ...(raw.programTrace ? { programTrace: raw.programTrace } : {}), ...(raw.programParity ? { programParity: raw.programParity } : {}), executionMode: mode }, elapsedMs: Date.now() - started };
        }
        if (message?.type === "detail") {
          const p = await pack();
          if (!diagnostics) throw new Error("diagnostic contract not loaded");
          const raw = lastResults.get(message.resultId);
          if (!raw) throw new Error("detail requested for a result that is no longer current; convert again");
          const detail = `${message.detailRef}`.startsWith("u:")
            ? await diagnostics.expandUnitDetail(p, lexicalFor.get(p), raw, message.detailRef)
            : await diagnostics.expandDetail(p, raw, message.detailRef);
          return { type: "detail", requestId: message.requestId, detail };
        }
        throw new TypeError(`unknown message type ${message?.type}`);
      } catch (error) {
        return { type: "error", requestId: message?.requestId ?? null, message: `${error?.message ?? error}` };
      }
    };
    return { handle, opens: () => opens, plainSpan };
  };

  /** Wire the service to a dedicated Worker scope; the pack is fetched relative to the manifest URL. */
  const attachToWorkerScope = (scope) => {
    let manifestUrl = null;
    const service = createTransformService({
      openPack: async () => {
        if (!manifestUrl) throw new Error("pack location not configured");
        const manifest = await (await fetch(manifestUrl, { cache: "no-cache" })).json();
        // content-addressed URLs (`?v=<sha256>`) + verify, evict and refetch once on mismatch (#185 H)
        const sections = fetcher.createSectionFetcher({
          manifestUrl, fetchImpl: fetch.bind(scope), cachesImpl: scope.caches ?? null, subtleImpl: scope.crypto.subtle
        });
        return runtime.openBrowserPack(manifest, sections.fetchSection);
      }
    });
    scope.addEventListener("message", async (event) => {
      const message = event.data;
      if (message?.type === "configure") { manifestUrl = message.manifestUrl; scope.postMessage({ type: "configured", requestId: message.requestId }); return; }
      scope.postMessage(await service.handle(message));
    });
  };

  return { createTransformService, attachToWorkerScope, plainSpan };
});

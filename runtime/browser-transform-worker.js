(function (root, factory) {
  const isCommonJs = typeof module === "object" && module.exports;
  if (!isCommonJs && typeof importScripts === "function" && typeof root.BrowserSpanPlanner === "undefined") {
    // dedicated Worker: load the runtime modules next to this script
    importScripts("browser-pack-binary.js", "browser-pack-runtime.js", "occurrence-arbitration.js", "browser-span-planner.js", "browser-diagnostic-contract.js", "browser-section-fetcher.js",
      "transform-shared.js", "orthography-resolver.js", "browser-lexical-runtime.js", "browser-inflection.js", "historical-sino-runtime.js", "browser-resolver-adapter.js", "symbol-registry-runtime.js", "sequence-pool-runtime.js", "rule-program-vm.js", "browser-program-runtime.js");
  }
  const deps = isCommonJs
    ? { runtime: require("./browser-pack-runtime.js"), planner: require("./browser-span-planner.js"), diagnostics: safeRequire("./browser-diagnostic-contract.js"), fetcher: safeRequire("./browser-section-fetcher.js"),
      lexicalRuntime: safeRequire("./browser-lexical-runtime.js"), resolver: safeRequire("./orthography-resolver.js"), adapter: safeRequire("./browser-resolver-adapter.js"), programRuntime: safeRequire("./browser-program-runtime.js") }
    : { runtime: root.BrowserPackRuntime, planner: root.BrowserSpanPlanner, diagnostics: root.BrowserDiagnosticContract, fetcher: root.BrowserSectionFetcher,
      lexicalRuntime: root.BrowserLexicalRuntime, resolver: root.OrthographyResolver, adapter: root.BrowserResolverAdapter, programRuntime: root.BrowserProgramRuntime };
  function safeRequire(path) { try { return require(path); } catch { return null; } }
  const api = factory(deps);
  if (isCommonJs) module.exports = api;
  root.BrowserTransformWorker = api;
  if (!isCommonJs && typeof root.addEventListener === "function" && typeof importScripts === "function") api.attachToWorkerScope(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (deps) {
  "use strict";
  const { runtime, planner, diagnostics, fetcher, lexicalRuntime, resolver, adapter, programRuntime } = deps;

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
    const surfaceCandidatesOf = (observation) => (observation.candidates ?? [])
      .filter((candidate) => !candidate.channel || candidate.channel === "surface");
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
    const transformWithProgramRuby = async (p, hot, text, profileId, renderMode, supplied = {}) => {
      const scope = supplied.scope ?? await lexicalScopeFor(p, text);
      const observation = supplied.observation ?? await hot.transformText(text, profileId, {
        directions: programDirection(p, profileId),
        lexemesFor: scope.lexemesFor
      });
      const surfaceCandidates = surfaceCandidatesOf(observation);
      const readingCandidates = (observation.candidates ?? []).filter((candidate) => (
        candidate.channel === "reading" && candidate.stage === "diachronic" && candidate.direction === "to-historical"
      ));
      const rubyCandidates = [];
      const units = [];
      const period = p.getProfilePolicy(profileId).policy.period;
      for (const match of scope.lexicalMatches) {
        const key = `${match.start}:${match.end}`;
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
        } else if (period !== "historical" && lexicalCandidates.length === 1) {
          const lexicalCandidate = lexicalCandidates[0];
          const unitResolver = resolver.createResolver({ lexicalLookup: () => [lexicalCandidate] });
          resolved = unitResolver.resolveUnit(surface);
        }
        if (!resolved) {
          const unitResolver = resolver.createResolver({ lexicalLookup: () => lexicalCandidates });
          resolved = unitResolver.resolveUnit(surface);
        }
        const summarized = typeof selectedAdapter?.summarizeUnit === "function"
          ? selectedAdapter.summarizeUnit(resolved)
          : resolved;
        units.push({ start: match.start, end: match.end, surface, outputs: [], unit: summarized });
        if (period === "historical" && resolved.kind === "resolved" && resolved.historical?.status === "resolved" && exactReading.length === 1) {
          const reading = exactReading[0];
          const rendered = resolver.createResolver({ lexicalLookup: () => [lexicalCandidates[0]] }).render(resolved, { mode: renderMode, profile: period });
          if (rendered !== surface) {
            rubyCandidates.push({
              start: match.start, end: match.end, output: rendered, policy: "lexical_boundary", origin: "program",
              ref: `program:${reading.programIds?.at(-1) ?? "historical-reading"}`,
              programIds: reading.programIds ?? [], candidate: Boolean(reading.candidate), unit: summarized,
              provenance: resolved.historical
            });
            units.at(-1).outputs = [rendered];
          }
        } else if (period !== "historical" && resolved.kind === "resolved") {
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
        programTrace: observation.trace,
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
      return assembleProgramObservation(text, profileId, { ...observation, candidates: surfaceCandidatesOf(observation) }, renderMode, { lexicalMatches: scope.lexicalMatches });
    };
    const compareProgramOutput = (legacy, program) => ({
      equivalent: legacy.renderedText === program.renderedText
        && (legacy.spans?.length ?? 0) === (program.spans?.length ?? 0),
      legacyRenderedText: legacy.renderedText,
      programRenderedText: program.renderedText,
      legacySpanCount: legacy.spans?.length ?? 0,
      programSpanCount: program.spans?.length ?? 0,
      authority: "legacy"
    });
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
          let raw;
          if (mode === "vm-authoritative") {
            const hot = await programForPack(p);
            if (!hot || typeof hot.transformText !== "function") throw new Error("Rule Program VM admission failed: required hot sections are unavailable");
            raw = (message.renderMode ?? "plain") === "plain"
              ? await transformWithProgram(p, hot, source, message.profileId, message.renderMode)
              : await transformWithProgramRuby(p, hot, source, message.profileId, message.renderMode);
          } else {
            raw = await transformLegacy(p, source, message.profileId, message.renderMode);
            if (mode === "parity") {
              const hot = await programForPack(p);
              if (hot && typeof hot.transformText === "function") {
                const scope = await lexicalScopeFor(p, source);
                const observation = await hot.transformText(source, message.profileId, {
                  directions: programDirection(p, message.profileId),
                  lexemesFor: scope.lexemesFor
                });
                raw.programTrace = observation.trace;
                if ((message.renderMode ?? "plain") === "plain") {
                  raw.programParity = compareProgramOutput(raw, assembleProgramObservation(source, message.profileId, { ...observation, candidates: surfaceCandidatesOf(observation) }, "plain", { lexicalMatches: scope.lexicalMatches }));
                } else {
                  const program = await transformWithProgramRuby(p, hot, source, message.profileId, message.renderMode, { scope, observation });
                  raw.programParity = compareProgramOutput(raw, program);
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

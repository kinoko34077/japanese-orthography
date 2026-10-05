(function (root, factory) {
  const isCommonJs = typeof module === "object" && module.exports;
  if (!isCommonJs && typeof importScripts === "function" && typeof root.BrowserSpanPlanner === "undefined") {
    // dedicated Worker: load the runtime modules next to this script
    importScripts("browser-pack-binary.js", "browser-pack-runtime.js", "occurrence-arbitration.js", "browser-span-planner.js", "browser-diagnostic-contract.js", "browser-section-fetcher.js",
      "transform-shared.js", "orthography-resolver.js", "browser-lexical-runtime.js", "browser-inflection.js", "historical-sino-runtime.js", "browser-resolver-adapter.js", "symbol-registry-runtime.js", "sequence-pool-runtime.js", "rule-program-vm.js", "browser-program-runtime.js");
  }
  const deps = isCommonJs
    ? { runtime: require("./browser-pack-runtime.js"), planner: require("./browser-span-planner.js"), diagnostics: safeRequire("./browser-diagnostic-contract.js"), fetcher: safeRequire("./browser-section-fetcher.js"),
      lexicalRuntime: safeRequire("./browser-lexical-runtime.js"), adapter: safeRequire("./browser-resolver-adapter.js"), programRuntime: safeRequire("./browser-program-runtime.js") }
    : { runtime: root.BrowserPackRuntime, planner: root.BrowserSpanPlanner, diagnostics: root.BrowserDiagnosticContract, fetcher: root.BrowserSectionFetcher,
      lexicalRuntime: root.BrowserLexicalRuntime, adapter: root.BrowserResolverAdapter, programRuntime: root.BrowserProgramRuntime };
  function safeRequire(path) { try { return require(path); } catch { return null; } }
  const api = factory(deps);
  if (isCommonJs) module.exports = api;
  root.BrowserTransformWorker = api;
  if (!isCommonJs && typeof root.addEventListener === "function" && typeof importScripts === "function") api.attachToWorkerScope(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (deps) {
  "use strict";
  const { runtime, planner, diagnostics, fetcher, lexicalRuntime, adapter, programRuntime } = deps;

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
    const assembleProgramObservation = (text, profileId, observation, renderMode) => {
      if (renderMode && renderMode !== "plain") throw new RangeError("vm-authoritative mode currently exposes plain output only; Ruby rendering remains in parity mode");
      const charBoundaries = [];
      for (let i = 0; i < text.length;) {
        const end = i + planner.charAt(text, i).length;
        charBoundaries.push([i, end]);
        i = end;
      }
      const raw = planner.assemble(text, profileId, planner.lexicalDag(text.length, [], charBoundaries), observation.candidates ?? [], observation.contextual ?? [], { lexicalMatchCount: observation.lexicalMatchCount ?? 0 });
      return { ...raw, engine: "rule-program", renderMode: renderMode ?? "plain", programTrace: observation.trace, executionMode: "vm-authoritative" };
    };
    const transformWithProgram = async (p, hot, text, profileId, renderMode) =>
      assembleProgramObservation(text, profileId, await hot.transformText(text, profileId, { directions: programDirection(p, profileId) }), renderMode);
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
            raw = await transformWithProgram(p, hot, source, message.profileId, message.renderMode);
          } else {
            raw = await transformLegacy(p, source, message.profileId, message.renderMode);
            if (mode === "parity") {
              const hot = await programForPack(p);
              if (hot && typeof hot.transformText === "function") {
                const observation = await hot.transformText(source, message.profileId, { directions: programDirection(p, message.profileId) });
                raw.programTrace = observation.trace;
                if ((message.renderMode ?? "plain") === "plain") {
                  raw.programParity = compareProgramOutput(raw, assembleProgramObservation(source, message.profileId, observation, "plain"));
                } else {
                  raw.programParity = { candidateCount: observation.candidates?.length ?? 0, renderedText: null, authority: "legacy" };
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

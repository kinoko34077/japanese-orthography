(function (root, factory) {
  const symbols = typeof module === "object" && module.exports ? require("./symbol-registry-runtime.js") : root.SymbolRegistryRuntime;
  const sequences = typeof module === "object" && module.exports ? require("./sequence-pool-runtime.js") : root.SequencePoolRuntime;
  const programs = typeof module === "object" && module.exports ? require("./rule-program-vm.js") : root.RuleProgramVM;
  const api = factory(symbols, sequences, programs);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BrowserProgramRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (SymbolRegistryRuntime, SequencePoolRuntime, RuleProgramVM) {
  "use strict";

  // BrowserPack v3 hot executor (#229): the loader supplies only digest-verified sections. The
  // ordinary lookup identity is a SymbolId sequence; Unicode is materialized only for VM edges.
  const STAGES = ["lexical", "semantic", "diachronic", "orthographic", "profile", "render"];
  const DIRECTIONS = ["to-historical", "to-modern", "reconstruct"];
  const CHANNELS = ["surface", "reading"];
  const SCOPES = ["exact-surface", "exact-reading", "whole-token", "symbol", "anywhere"];
  const modes = ["all", "some", "none"];
  const keyOf = (stage, direction, channel, sequenceId) => `${stage}|${direction}|${channel}|${sequenceId}`;

  const createBrowserProgramRuntime = async (pack) => {
    if (!pack || typeof pack.loadSection !== "function" || !pack.hasSection("sequence-pool")) {
      throw new Error("BrowserProgramRuntime requires BrowserPack v3 hot sections");
    }
    const registry = pack.eagerSection("symbol-registry");
    if (!registry) throw new Error("BrowserProgramRuntime requires the eager Symbol Registry");
    const atoms = [];
    for (let i = 0; i < registry.rowCount("atoms"); i += 1) atoms.push(registry.string("atoms", i));
    const tombstones = registry.rowCount("tombstones") ? Array.from(registry.columns.tombstones.values) : [];
    const symbolizer = SymbolRegistryRuntime.createSymbolizer({ kind: "japanese-orthography-symbol-registry", atoms, tombstones });
    const [poolSection, programSection, indexSection, predicateSection, lexemeSection, metaSection] = await Promise.all([
      pack.loadSection("sequence-pool"), pack.loadSection("rule-programs"), pack.loadSection("rule-program-index"),
      pack.loadSection("rule-predicates"), pack.loadSection("rule-lexeme-sets"), pack.loadSection("rule-runtime-meta")
    ]);
    const pool = SequencePoolRuntime.createSequencePool(poolSection, atoms);
    const programView = {
      count: programSection.rowCount("kind"),
      direct: (i) => programSection.value("direct", i) !== 0,
      outputs: (i) => programSection.list("outputs", i),
      flags: (i) => programSection.list("flags", i),
      code: (i) => programSection.list("code", i)
    };
    const predicates = [];
    const textOf = (tokens) => new TextDecoder().decode(Uint8Array.from(tokens));
    const predicateText = (name, row) => textOf(predicateSection.list(name, row)) || undefined;
    for (let i = 0; i < predicateSection.rowCount("bindingGroup"); i += 1) {
      const predicate = {};
      for (const name of ["bindingGroup", "bindingContext", "constraint", "usage", "period", "sense"]) {
        const value = predicateText(name, i);
        if (value !== undefined) predicate[name] = value;
      }
      const tokenContext = predicateText("tokenContext", i);
      if (tokenContext !== undefined) predicate.tokenContext = JSON.parse(tokenContext);
      predicates.push(predicate);
    }
    const lexemeSets = [];
    const lexemeSetModes = [];
    for (let i = 0; i < lexemeSection.rowCount("lexemes"); i += 1) {
      lexemeSets.push(lexemeSection.list("lexemes", i));
      lexemeSetModes.push(modes[lexemeSection.value("mode", i)] ?? "all");
    }
    const profileBits = {};
    for (let i = 0; i < metaSection.rowCount("profileIds"); i += 1) profileBits[textOf(metaSection.list("profileIds", i))] = metaSection.value("profileBits", i);
    const mechanismCount = metaSection.rowCount("mechanisms");
    const vm = RuleProgramVM.createRuleVM({ programs: programView, pool, predicates, profileBits, lexemeSets, lexemeSetModes, mechanismCount });
    vm.verify();
    const index = new Map();
    const inputLengths = new Set();
    for (let i = 0; i < indexSection.rowCount("stage"); i += 1) {
      const input = indexSection.value("input", i);
      const key = keyOf(STAGES[indexSection.value("stage", i)], DIRECTIONS[indexSection.value("direction", i)], CHANNELS[indexSection.value("channel", i)], input);
      index.set(key, [...indexSection.list("programs", i)]);
      inputLengths.add(pool.symbols(input).length);
    }

    const runSequence = ({ stage, direction, channel, sequenceId, text, profileId, symbol, lexemes, context }) => {
      if (sequenceId < 0) return { text, sequenceId, edges: [], preserved: false, mechanisms: [], executedProgramIds: [], trace: [] };
      const programIds = index.get(keyOf(stage, direction, channel, sequenceId)) ?? [];
      const state = { profileId, symbol, lexemes: lexemes instanceof Set ? lexemes : new Set(lexemes ?? []), context };
      const edges = [], trace = [], mechanisms = [];
      let preserved = false;
      for (const programId of programIds) {
        const result = vm.run(programId, state);
        edges.push(...result.edges);
        trace.push(...result.trace);
        mechanisms.push(...(result.mechanisms ?? []));
        preserved = preserved || result.preserved;
      }
      const executedProgramIds = [...new Set(trace)];
      return { text, sequenceId, edges, preserved, mechanisms: [...new Set(mechanisms)], executedProgramIds, trace };
    };

    const run = ({ stage, direction, channel, text, profileId, symbol, lexemes, context }) => {
      const sequence = symbolizer.sequenceOf(text);
      if (sequence === null) return { text, sequenceId: -1, edges: [], preserved: false, mechanisms: [], executedProgramIds: [], trace: [] };
      return runSequence({ stage, direction, channel, sequenceId: pool.find(sequence), text, profileId, symbol, lexemes, context });
    };

    // Scan once-symbolized input through the same SequenceId postings used by the VM. This is the
    // production candidate seam for #229: it never reconstructs Unicode to perform ordinary lookup,
    // and the returned candidates retain the actual ProgramId path that produced each edge.
    const transformText = (text, profileId, options = {}) => {
      const source = `${text ?? ""}`;
      const atoms = SymbolRegistryRuntime.atomsOf(source);
      const tokens = symbolizer.symbolize(source);
      const offsets = [0];
      for (const atom of atoms) offsets.push(offsets.at(-1) + atom.length);
      const stages = options.stages ?? STAGES;
      const directions = options.directions ?? DIRECTIONS;
      const channels = options.channels ?? CHANNELS;
      const lengths = [...inputLengths].sort((a, b) => a - b);
      const candidates = [], runs = [];
      const contextFor = typeof options.contextFor === "function" ? options.contextFor : () => options.context;
      const executedProgramIds = new Set();
      for (let start = 0; start < tokens.length; start += 1) {
        for (const length of lengths) {
          const end = start + length;
          if (end > tokens.length) break;
          const sequence = tokens.slice(start, end);
          if (!sequence.every((token) => typeof token === "number")) continue;
          const sequenceId = pool.find(sequence);
          if (sequenceId < 0) continue;
          const segment = source.slice(offsets[start], offsets[end]);
          const suppliedSymbol = typeof options.symbolFor === "function" ? options.symbolFor(offsets[start], offsets[end], segment) : undefined;
          const symbol = typeof suppliedSymbol === "string" ? symbolizer.idOf(suppliedSymbol) : suppliedSymbol;
          const lexemes = typeof options.lexemesFor === "function" ? options.lexemesFor(offsets[start], offsets[end], segment) : undefined;
          for (const stage of stages) for (const direction of directions) for (const channel of channels) {
            const result = runSequence({ stage, direction, channel, sequenceId, text: segment, profileId, symbol: symbol ?? (length === 1 ? tokens[start] : undefined), lexemes, context: contextFor(offsets[start], offsets[end], segment) });
            if (!result.executedProgramIds.length) continue;
            for (const id of result.executedProgramIds) executedProgramIds.add(id);
            runs.push({ start: offsets[start], end: offsets[end], stage, direction, channel, ...result });
            for (const edge of result.edges) {
              const programId = edge.programs.at(-1);
              const rootProgramId = edge.programs[0] ?? programId;
              const programScope = rootProgramId === undefined ? undefined : SCOPES[programSection.value("scope", rootProgramId)];
              const policy = programScope === "anywhere" ? "anywhere"
                : programScope === "whole-token" ? "whole_lexeme"
                  : stage === "orthographic" && length === 1 ? "anywhere"
                    : stage === "lexical" ? "lexical_boundary" : "whole_lexeme";
              candidates.push({
                start: offsets[start], end: offsets[end], output: edge.output,
                policy,
                precedence: stage === "profile" ? 1 : 0,
                origin: "program", ref: `program:${programId}`, programIds: [...edge.programs], candidate: Boolean(edge.candidate), stage, direction, channel,
                key: `program:${programId}:${stage}:${direction}:${channel}:${offsets[start]}:${offsets[end]}:${edge.output}`
              });
            }
          }
        }
      }
      return { candidates, contextual: [], lexicalMatchCount: 0, trace: { executedProgramIds: [...executedProgramIds], runs } };
    };

    // Bounded dual-run observation for the legacy adapter: all exact whole-text postings are
    // executed by the new VM and surfaced in the trace while cutover parity is being accepted.
    const traceText = (text, profileId) => {
      const runs = [];
      for (const stage of STAGES) for (const direction of DIRECTIONS) for (const channel of CHANNELS) {
        const result = run({ stage, direction, channel, text, profileId });
        if (result.executedProgramIds.length) runs.push({ stage, direction, channel, ...result });
      }
      return { executedProgramIds: [...new Set(runs.flatMap((x) => x.executedProgramIds))], runs };
    };
    return Object.freeze({ run, transformText, traceText, symbolId: (atom) => symbolizer.idOf(atom), sequenceId: (text) => { const sequence = symbolizer.sequenceOf(text); return sequence === null ? -1 : pool.find(sequence); }, programCount: programView.count, sequenceCount: pool.count });
  };

  return { createBrowserProgramRuntime };
});

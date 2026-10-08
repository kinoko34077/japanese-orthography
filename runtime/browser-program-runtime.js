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

    // #289: context rules may be selected by an observed token's basic form or by a
    // kana-insensitive spelling. Keep those alternate lookups restricted to Programs that
    // actually carry a TAR tokenContext predicate so unrelated exact/profile Programs cannot leak.
    const tokenContextByProgram = new Map();
    const arity = { 0: 0, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 2, 7: 0, 8: 1 };
    for (let programId = 0; programId < programView.count; programId += 1) {
      if (programView.direct(programId)) continue;
      const code = programView.code(programId);
      for (let pc = 0; pc < code.length;) {
        const op = code[pc];
        if (op === RuleProgramVM.OP.TEST_PRED) {
          const predicate = predicates[code[pc + 1]];
          if (predicate?.tokenContext) tokenContextByProgram.set(programId, predicate.tokenContext);
        }
        if (op === RuleProgramVM.OP.END) break;
        pc += 1 + (arity[op] ?? 0);
      }
    }
    // #291: TAR由来の限定pattern機構。適用条件とprofile権限は索引化済みRule ProgramのVMが担当し、
    // このscanは動的captureのみを供給する。出典に含まれる任意のregexをBrowserで実行しない。
    const acceptedPatternIds = new Set([
      "entry-mqactr77-ls", "entry-mq2edvi1-lz", "entry-mqb527lq-lp",
      "entry-mqavou0x-nd", "entry-mqb4rrlh-m3", "entry-mqb6ua4d-m5",
      "entry-mqb02914-lq"
    ]);
    const patterns = [];
    for (const [programId, rule] of tokenContextByProgram) {
      const pattern = rule?.tarPattern;
      if (!pattern) continue;
      if (!acceptedPatternIds.has(pattern.sourceRuleId)
        || STAGES[programSection.value("stage", programId)] !== "profile"
        || DIRECTIONS[programSection.value("direction", programId)] !== "to-modern"
        || CHANNELS[programSection.value("channel", programId)] !== "surface") {
        throw new Error("unsupported TAR pattern Program " + programId);
      }
      if (pattern.regex) {
        if (pattern.from !== "(\\d{4})年(\\d{1,2})月(\\d{1,2})日"
          || pattern.outputs.length !== 1 || pattern.outputs[0] !== "$1/$2/$3") {
          throw new Error("unsupported TAR regex contract");
        }
      } else if (!pattern.wildcard || !pattern.from.endsWith("*")
        || pattern.from.indexOf("*") !== pattern.from.length - 1
        || !pattern.outputs.length || !pattern.outputs.every((output) => output.endsWith("*"))) {
        throw new Error("unsupported TAR wildcard contract");
      }
      patterns.push({ programId, rule, pattern });
    }
    if (patterns.length !== 0 && patterns.length !== 7) throw new Error("TAR pattern Program accounting drift: " + patterns.length);

    const toHiragana = (value) => Array.from(String(value ?? ""), (ch) => {
      const code = ch.codePointAt(0);
      return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : ch;
    }).join("");
    const toKatakana = (value) => Array.from(String(value ?? ""), (ch) => {
      const code = ch.codePointAt(0);
      return code >= 0x3041 && code <= 0x3096 ? String.fromCodePoint(code + 0x60) : ch;
    }).join("");
    const sharedSuffix = (left, right) => {
      const a = Array.from(String(left ?? ""));
      const b = Array.from(String(right ?? ""));
      let n = 0;
      while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
      return n ? a.slice(a.length - n).join("") : "";
    };
    const usesBasicForm = (rule) => {
      const current = Array.isArray(rule?.conditions?.current)
        ? rule.conditions.current : rule?.conditions?.current ? [rule.conditions.current] : [];
      return rule?.matchTarget === "basic_form" || rule?.ruleType === "verb" || rule?.ruleType === "adjective"
        || current.some((condition) => condition && typeof condition === "object"
          && ("basic" in condition || "basic_form" in condition || condition.pos === "動詞"));
    };
    const adaptTarOutput = (output, rule, context) => {
      if (!rule || !usesBasicForm(rule)) return output;
      const window = context?.tokenWindow;
      const token = window?.tokens?.[window.index];
      if (!token || token.basic_form !== rule.from || token.surface_form === rule.from) return output;
      if (rule.ruleType === "adjective" && String(rule.from).endsWith("い") && String(output).endsWith("い")) {
        const fromStem = String(rule.from).slice(0, -1);
        const toStem = String(output).slice(0, -1);
        const variants = [
          [rule.from, output], [fromStem + "く", toStem + "く"], [fromStem + "かっ", toStem + "かっ"],
          [fromStem + "けれ", toStem + "けれ"], [fromStem + "かれ", toStem + "かれ"], [fromStem + "さ", toStem + "さ"]
        ];
        const hit = variants.find(([from]) => from === token.surface_form);
        return hit ? hit[1] : token.surface_form;
      }
      const suffix = sharedSuffix(rule.from, output);
      if (!suffix) return output;
      const fromStem = String(rule.from).slice(0, String(rule.from).length - suffix.length);
      const toStem = String(output).slice(0, String(output).length - suffix.length);
      return fromStem && String(token.surface_form).startsWith(fromStem)
        ? toStem + String(token.surface_form).slice(fromStem.length)
        : output;
    };

    const runSequence = ({ stage, direction, channel, sequenceId, text, profileId, symbol, lexemes, context, contextOnly = false }) => {
      if (sequenceId < 0) return { text, sequenceId, edges: [], preserved: false, mechanisms: [], executedProgramIds: [], trace: [] };
      const programIds = (index.get(keyOf(stage, direction, channel, sequenceId)) ?? [])
        .filter((programId) => !contextOnly || tokenContextByProgram.has(programId));
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
      const contextualLookup = options.context !== undefined || typeof options.contextFor === "function";
      const lengths = [...new Set([...inputLengths, ...(contextualLookup ? [tokens.length] : [])])].sort((a, b) => a - b);
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
          const segment = source.slice(offsets[start], offsets[end]);
          const suppliedSymbol = typeof options.symbolFor === "function" ? options.symbolFor(offsets[start], offsets[end], segment) : undefined;
          const symbol = typeof suppliedSymbol === "string" ? symbolizer.idOf(suppliedSymbol) : suppliedSymbol;
          const lexemes = typeof options.lexemesFor === "function" ? options.lexemesFor(offsets[start], offsets[end], segment) : undefined;
          const context = contextFor(offsets[start], offsets[end], segment);
          const lookupIds = new Map();
          if (sequenceId >= 0) lookupIds.set(sequenceId, false);
          const window = context?.tokenWindow;
          const current = window?.tokens?.[window.index];
          const alternateTexts = [
            typeof current?.basic_form === "string" ? current.basic_form : null,
            toHiragana(segment),
            toKatakana(segment)
          ].filter((value) => value && value !== segment);
          for (const alternate of alternateTexts) {
            const symbols = symbolizer.sequenceOf(alternate);
            const alternateId = symbols === null ? -1 : pool.find(symbols);
            if (alternateId >= 0 && !lookupIds.has(alternateId)) lookupIds.set(alternateId, true);
          }
          if (!lookupIds.size) continue;
          for (const stage of stages) for (const direction of directions) for (const channel of channels) {
            for (const [lookupId, contextOnly] of lookupIds) {
              const result = runSequence({ stage, direction, channel, sequenceId: lookupId, text: segment, profileId, symbol: symbol ?? (length === 1 ? tokens[start] : undefined), lexemes, context, contextOnly });
              if (!result.executedProgramIds.length) continue;
              for (const id of result.executedProgramIds) executedProgramIds.add(id);
              runs.push({ start: offsets[start], end: offsets[end], stage, direction, channel, lookupSequenceId: lookupId, ...result });
              for (const edge of result.edges) {
                const programId = edge.programs.at(-1);
                const rootProgramId = edge.programs[0] ?? programId;
                const programScope = rootProgramId === undefined ? undefined : SCOPES[programSection.value("scope", rootProgramId)];
                const policy = programScope === "anywhere" ? "anywhere"
                  : programScope === "whole-token" ? "whole_lexeme"
                    : stage === "orthographic" && length === 1 ? "anywhere"
                      : stage === "lexical" ? "lexical_boundary" : "whole_lexeme";
                const tarRule = rootProgramId === undefined ? null : tokenContextByProgram.get(rootProgramId);
                const output = tarRule ? adaptTarOutput(edge.output, tarRule, context) : edge.output;
                candidates.push({
                  start: offsets[start], end: offsets[end], output,
                  policy,
                  // Structured TAR semantics are more specific than the naked simple-exact migration
                  // lane. Within the structured lane, preserve the pinned TAR numeric priority.
                  precedence: tarRule ? 1000 + (Number(tarRule.priority) || 0) : stage === "profile" ? 1 : 0,
                  origin: "program", ref: `program:${programId}`, programIds: [...edge.programs], candidate: Boolean(edge.candidate), stage, direction, channel,
                  key: `program:${programId}:${stage}:${direction}:${channel}:${offsets[start]}:${offsets[end]}:${output}`
                });
              }
            }
          }
        }
      }
      // patternの入力はexact SequenceId spanではない。限定matchはcompile済みprofile Rule Program
      // （TEST_PROFILE / TEST_PRED / MECH）で許可する。
      // TARの末尾'*'は非anchor・最短captureであり、prefixだけを変換して末尾文字列を保持する。
      if (stages.includes("profile") && directions.includes("to-modern") && channels.includes("surface")) {
        for (const { programId, rule, pattern } of patterns) {
          const matches = [];
          if (pattern.regex) {
            for (const hit of source.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/gu)) {
              matches.push({ start: hit.index, end: hit.index + hit[0].length, outputs: [
                hit[1] + "/" + hit[2] + "/" + hit[3]
              ] });
            }
          } else {
            const prefix = pattern.from.slice(0, -1);
            let start = source.indexOf(prefix);
            while (start >= 0) {
              matches.push({
                start, end: start + prefix.length,
                outputs: pattern.outputs.map((output) => output.slice(0, -1))
              });
              start = source.indexOf(prefix, start + 1);
            }
          }
          for (const match of matches) {
            const segment = source.slice(match.start, match.end);
            const context = contextFor(match.start, match.end, segment);
            const state = { profileId, context, lexemes: new Set() };
            const evaluated = vm.run(programId, state);
            if (!evaluated.mechanisms?.length) continue;
            executedProgramIds.add(programId);
            const edges = match.outputs.map((output) => ({
              output, sequenceId: -1, candidate: match.outputs.length > 1,
              programs: [programId]
            }));
            runs.push({
              start: match.start, end: match.end, stage: "profile", direction: "to-modern",
              channel: "surface", lookupSequenceId: -1, text: segment, sequenceId: -1,
              edges, preserved: false, mechanisms: evaluated.mechanisms,
              executedProgramIds: [programId], trace: evaluated.trace
            });
            for (const [i, edge] of edges.entries()) {
              candidates.push({
                start: match.start, end: match.end, output: edge.output,
                policy: "anywhere", precedence: 1000 + (Number(rule.priority) || 0),
                origin: "program", ref: "program:" + programId, programIds: [programId],
                candidate: edge.candidate, stage: "profile", direction: "to-modern",
                channel: "surface",
                key: "program:pattern:" + programId + ":" + match.start + ":" + match.end + ":" + i
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

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.RuleProgramVM = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Compact Rule ISA + VM (#208 §8, #211 E). Every executable rule is a Program: a few numeric
  // opcodes over integer operands (SequenceIds, SymbolIds, lexeme ids, predicate / profile ids,
  // ProgramIds). No type-name strings exist at runtime: kind, stage and channel are small enums, and
  // the human-readable evidence type lives in the lazy evidence map (§10, unit G).
  //
  //   TEST_PROFILE  mask        the active profile's bit must be set
  //   TEST_SYMBOL   symbolId    the state's scope symbol (one character of a word) must match
  //   TEST_LEXSET   setId       the state's lexeme candidates must meet the lexeme set (lexical scope)
  //   TEST_PRED     predId      the state's context must satisfy the predicate (context / usage / period)
  //   CALL          programId   run another program (a reusable node) and continue with its edges
  //   EMIT          seqId flags emit one output edge (flags: CANDIDATE)
  //   PRESERVE                  emit the input unchanged and stop rewriting this unit
  //   MECH          mechanismId a render/normalisation mechanism (not text), executed by the renderer
  //   END
  //
  // Exact one-step rules without tests are lowered to direct postings (input SequenceId -> outputs);
  // they still have a ProgramId, so a trace looks the same whether a rule ran as bytecode or as a
  // direct map (§8.5).

  const OP = Object.freeze({ END: 0, TEST_PROFILE: 1, TEST_SYMBOL: 2, TEST_LEXSET: 3, TEST_PRED: 4, CALL: 5, EMIT: 6, PRESERVE: 7, MECH: 8 });
  const FLAG = Object.freeze({ CANDIDATE: 1 });
  const ARITY = { 0: 0, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 2, 7: 0, 8: 1 };

  /**
   * programs: { count, kind(i), stage(i), channel(i), direction(i), input(i), code(i): Uint32Array,
   *             direct(i): boolean, outputs(i): Uint32Array, flags(i): Uint8Array }
   * predicates: array of { constraint?, usage?, period? } (index = predId)
   */
  const createRuleVM = ({ programs, pool, predicates = [], profileBits = {}, lexemeSets = [], lexemeSetModes = [], mechanismCount = Infinity }) => {
    const MAX_DEPTH = 16;

    const verify = () => {
      for (let p = 0; p < programs.count; p += 1) {
        if (programs.direct(p)) {
          const outputs = programs.outputs(p);
          if (!outputs.length) throw new Error(`RuleProgramVM: direct program ${p} has no output`);
          for (const s of outputs) if (s >= pool.count) throw new RangeError(`RuleProgramVM: program ${p} emits unknown SequenceId ${s}`);
          continue;
        }
        const code = programs.code(p);
        let pc = 0;
        let ended = false;
        while (pc < code.length) {
          const op = code[pc];
          if (!(op in ARITY)) throw new Error(`RuleProgramVM: program ${p} has unknown opcode ${op}`);
          if (op !== OP.END && pc + ARITY[op] >= code.length) throw new RangeError(`RuleProgramVM: program ${p} truncated operand`);
          if (op === OP.CALL && code[pc + 1] >= programs.count) throw new RangeError(`RuleProgramVM: program ${p} calls unknown program ${code[pc + 1]}`);
          if (op === OP.EMIT && code[pc + 1] >= pool.count) throw new RangeError(`RuleProgramVM: program ${p} emits unknown SequenceId ${code[pc + 1]}`);
          if (op === OP.TEST_PRED && code[pc + 1] >= predicates.length) throw new RangeError(`RuleProgramVM: program ${p} tests unknown predicate ${code[pc + 1]}`);
          if (op === OP.TEST_LEXSET && code[pc + 1] >= lexemeSets.length) throw new RangeError(`RuleProgramVM: program ${p} tests unknown lexeme set ${code[pc + 1]}`);
          if (op === OP.MECH && code[pc + 1] >= mechanismCount) throw new RangeError(`RuleProgramVM: program ${p} names unknown mechanism ${code[pc + 1]}`);
          if (op === OP.END) { ended = true; break; }
          pc += 1 + ARITY[op];
        }
        if (!ended) throw new Error(`RuleProgramVM: program ${p} does not END`);
      }
    };

    const satisfies = (pred, context) => {
      if (!pred) return true;
      // Binding instances with the same symbol/input form a contextual candidate group. An
      // omitted context asks for the complete group; an explicit context selects exactly one
      // member (including the unqualified/null member) and never lets the unqualified member
      // leak into a qualified query (#246).
      if (pred.bindingGroup) {
        if (context === undefined) return true;
        const selectedContext = context === null ? null : (context?.usage ?? null);
        if ((pred.bindingContext || null) !== selectedContext) return false;
      }
      if (pred.constraint && !(context?.constraints ?? []).includes(pred.constraint)) return false;
      if (pred.usage && context?.usage !== pred.usage) return false;
      if (pred.period && context?.period !== pred.period) return false;
      // a sense condition excludes a rule only when the context states a different sense; without
      // sense evidence every sense stays a candidate (#208 §12)
      if (pred.sense && context?.sense !== undefined && context.sense !== pred.sense) return false;
      return true;
    };

    /**
     * Run program `p` on a state { profileId, symbol?, lexemes?: Set<number>, context? }.
     * Returns { edges: [{ output, sequenceId, candidate, programs: [...] }], preserved, trace }.
     */
    const run = (p, state, depth = 0, path = []) => {
      if (depth > MAX_DEPTH) throw new Error("RuleProgramVM: CALL depth exceeded");
      const trace = [...path, p];
      if (programs.direct(p)) {
        const outputs = programs.outputs(p);
        const flags = programs.flags(p);
        return { edges: [...outputs].map((s, i) => ({ sequenceId: s, output: pool.text(s), candidate: (flags[i] & FLAG.CANDIDATE) !== 0 || outputs.length > 1, programs: trace })), preserved: false, trace };
      }
      const code = programs.code(p);
      const edges = [];
      const mechanisms = [];
      let preserved = false;
      for (let pc = 0; pc < code.length;) {
        const op = code[pc];
        const arg = code[pc + 1];
        if (op === OP.END) break;
        if (op === OP.TEST_PROFILE) { if (!(arg & (profileBits[state.profileId] ?? 0))) return { edges: [], preserved: false, trace }; }
        else if (op === OP.TEST_SYMBOL) { if (state.symbol !== arg) return { edges: [], preserved: false, trace }; }
        else if (op === OP.TEST_LEXSET) {
          const allowed = new Set(lexemeSets[arg] ?? []);
          const hypotheses = state.lexemes ? [...state.lexemes] : [];
          const mode = lexemeSetModes[arg] ?? "all";
          const matches = mode === "some" ? hypotheses.some((l) => allowed.has(l))
            : mode === "none" ? hypotheses.every((l) => !allowed.has(l))
            : hypotheses.length > 0 && hypotheses.every((l) => allowed.has(l));
          if (!matches) return { edges: [], preserved: false, trace };
        }
        else if (op === OP.MECH) mechanisms.push(arg);
        else if (op === OP.TEST_PRED) { if (!satisfies(predicates[arg], state.context)) return { edges: [], preserved: false, trace }; }
        else if (op === OP.CALL) { const r = run(arg, state, depth + 1, trace); edges.push(...r.edges); preserved = preserved || r.preserved; }
        else if (op === OP.EMIT) edges.push({ sequenceId: arg, output: pool.text(arg), candidate: (code[pc + 2] & FLAG.CANDIDATE) !== 0, programs: trace });
        else if (op === OP.PRESERVE) preserved = true;
        pc += 1 + ARITY[op];
      }
      const multiple = new Set(edges.map((e) => e.sequenceId)).size > 1;
      return { edges: edges.map((e) => ({ ...e, candidate: e.candidate || multiple })), preserved, mechanisms, trace };
    };

    return { run, verify, OP, FLAG };
  };

  return { createRuleVM, OP, FLAG };
});

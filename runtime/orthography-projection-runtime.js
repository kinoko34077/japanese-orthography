(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.OrthographyProjectionRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Orthography Architecture v2 forward projection (#167, spec #163 §5–6).
  // Shared by tools/orthography-projection.ts and browser/worker-class hosts.
  //
  // Rule order: topological over declared dependencies; among ready rules the rule class
  // (diachronic -> phonological -> orthographic -> render) and then the rule id decide, so storage
  // order never matters. Each rule rewrites one channel ("surface" or "reading") of the canonical
  // state. Lossy steps record the pre-image in retainedDistinctions; nothing already known is lost.

  const CLASS_RANK = { diachronic: 0, phonological: 1, orthographic: 2, render: 3 };
  const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  const compileRuleOrder = (graph, policy = {}) => {
    const all = new Map((graph.rules ?? []).map((rule) => [rule.id, rule]));
    const disabled = new Set(policy.disabledRuleIds ?? []);
    const enabledOnly = policy.enabledRuleIds ? new Set(policy.enabledRuleIds) : null;
    for (const id of policy.enabledRuleIds ?? []) if (!all.has(id)) throw new Error(`Unknown enabled rule ${id}`);
    const active = [...all.values()].filter((rule) => !disabled.has(rule.id) && (!enabledOnly || enabledOnly.has(rule.id)));
    const activeIds = new Set(active.map((rule) => rule.id));

    // Cycles are rejected over the full graph, even through disabled rules.
    const state = new Map();
    const visit = (id, trail) => {
      if (state.get(id) === "done") return;
      if (state.get(id) === "visiting") throw new Error(`dependency cycle ${[...trail, id].join(" -> ")}`);
      state.set(id, "visiting");
      for (const dep of all.get(id)?.dependencies ?? []) {
        if (!all.has(dep)) throw new Error(`${id} depends on missing rule ${dep}`);
        visit(dep, [...trail, id]);
      }
      state.set(id, "done");
    };
    for (const id of [...all.keys()].sort(compareText)) visit(id, []);

    const rank = (rule) => [CLASS_RANK[rule.class] ?? 9, rule.id];
    const before = (a, b) => {
      const [ra, ia] = rank(a);
      const [rb, ib] = rank(b);
      return ra - rb || compareText(ia, ib);
    };
    const pending = new Map(active.map((rule) => [rule.id, new Set((rule.dependencies ?? []).filter((d) => activeIds.has(d)))]));
    const order = [];
    while (pending.size > 0) {
      const ready = [...pending.entries()].filter(([, deps]) => deps.size === 0).map(([id]) => all.get(id)).sort(before);
      const next = ready[0];
      order.push(next.id);
      pending.delete(next.id);
      for (const deps of pending.values()) deps.delete(next.id);
    }
    return order;
  };

  const channelOf = (rule) => rule.predicate?.channel ?? "surface";

  // ---- named mechanisms (#169): context-dependent conventions a substring table cannot express ----
  const HIRAGANA_START = 0x3041, HIRAGANA_END = 0x3096, KATAKANA_START = 0x30a1, KATAKANA_END = 0x30f6, SCRIPT_OFFSET = 0x60;
  const katakanaToHiragana = (c) => {
    if (c === "ヽ") return "ゝ";
    if (c === "ヾ") return "ゞ";
    const cp = c.codePointAt(0);
    return cp !== undefined && cp >= KATAKANA_START && cp <= KATAKANA_END ? String.fromCodePoint(cp - SCRIPT_OFFSET) : c;
  };
  const hiraganaToKatakana = (c) => {
    if (c === "ゝ") return "ヽ";
    if (c === "ゞ") return "ヾ";
    const cp = c.codePointAt(0);
    return cp !== undefined && cp >= HIRAGANA_START && cp <= HIRAGANA_END ? String.fromCodePoint(cp + SCRIPT_OFFSET) : c;
  };
  const isHiragana = (c) => /\p{Script=Hiragana}/u.test(c);
  const isKatakana = (c) => /\p{Script=Katakana}/u.test(c);
  const isHan = (c) => /\p{Script=Han}/u.test(c);
  const voiceKana = (c) => (!isHiragana(c) && !isKatakana(c) ? c : `${c.normalize("NFD")}゙`.normalize("NFC"));
  const iterationMarkFor = (c, voiced) => (isHiragana(c) ? (voiced ? "ゞ" : "ゝ") : isKatakana(c) ? (voiced ? "ヾ" : "ヽ") : null);
  const requirePrevious = (expanded, mark) => {
    const previous = expanded.at(-1);
    if (!previous) throw new RangeError(`Iteration mark ${mark} cannot appear at render-unit start`);
    return previous;
  };

  const MECHANISMS = {
    "script-fold-hiragana": (text) => Array.from(text, katakanaToHiragana).join(""),
    "script-render-katakana": (text) => Array.from(text, hiraganaToKatakana).join(""),
    "iteration-expand": (text, params) => {
      const source = [...text];
      const expanded = [];
      const boundaries = new Set(params.boundaryOffsets ?? []);
      for (let index = 0; index < source.length; index += 1) {
        const c = source[index];
        const atBoundary = boundaries.has(index);
        if (c === "ゝ" || c === "ヽ" || c === "々") {
          if (atBoundary) throw new RangeError(`Iteration mark ${c} cannot appear at render-unit start`);
          expanded.push(requirePrevious(expanded, c));
          continue;
        }
        if (c === "ゞ" || c === "ヾ") {
          if (atBoundary) throw new RangeError(`Iteration mark ${c} cannot appear at render-unit start`);
          expanded.push(voiceKana(requirePrevious(expanded, c)));
          continue;
        }
        if (c === "〳" || c === "〵") throw new RangeError("Span iteration marks require an explicit repeated span");
        expanded.push(c);
      }
      return expanded.join("");
    },
    "iteration-render": (text, params) => {
      const source = [...text];
      if (source.length < 2) return text;
      const rendered = [source[0]];
      const boundaries = new Set(params.boundaryOffsets ?? []);
      for (let index = 1; index < source.length; index += 1) {
        const previous = source[index - 1];
        const current = source[index];
        if (boundaries.has(index)) { rendered.push(current); continue; }
        if (isHan(previous) && current === previous) { rendered.push("々"); continue; }
        const unvoiced = iterationMarkFor(previous, false);
        if (unvoiced && current === previous) { rendered.push(unvoiced); continue; }
        const voiced = iterationMarkFor(previous, true);
        if (voiced && voiceKana(previous) !== previous && current === voiceKana(previous)) { rendered.push(voiced); continue; }
        rendered.push(current);
      }
      return rendered.join("");
    },
    "span-iteration-render": (text, params) => {
      const span = params.repeatedSpan ?? "";
      if (span.length === 0) throw new TypeError("Repeated span must not be empty");
      const doubled = `${span}${span}`;
      if (!text.endsWith(doubled)) return text;
      return `${text.slice(0, text.length - doubled.length)}${span}〳〵`;
    },
    "span-iteration-expand": (text, params) => {
      const span = params.repeatedSpan ?? "";
      if (span.length === 0) throw new TypeError("Repeated span must not be empty");
      if (text.startsWith("〳") || text.startsWith("〵")) throw new RangeError("Span iteration mark cannot appear at render-unit start");
      if (!text.endsWith("〳〵")) return text;
      const prefix = text.slice(0, -2);
      if (!prefix.endsWith(span)) throw new RangeError("Span iteration mark does not follow the declared repeated span");
      return `${prefix}${span}`;
    }
  };

  const predicateFailure = (rule, state, policy) => {
    const predicate = rule.predicate ?? {};
    if (predicate.policyFlags !== undefined && !predicate.policyFlags.every((flag) => policy.thresholds?.[flag] === true)) return "predicate_mismatch:policyFlag";
    if (predicate.period !== undefined && predicate.period !== (policy.period ?? null)) return "predicate_mismatch:period";
    if (predicate.lexicalIdentity !== undefined) {
      const allowed = Array.isArray(predicate.lexicalIdentity) ? predicate.lexicalIdentity : [predicate.lexicalIdentity];
      if (!allowed.includes(state.lexicalIdentity)) return "predicate_mismatch:lexicalIdentity";
    }
    if (predicate.morphology !== undefined) {
      const actual = state.morphology ?? {};
      if (!Object.entries(predicate.morphology).every(([key, value]) => actual[key] === value)) return "predicate_mismatch:morphology";
    }
    return null;
  };

  const rewrite = (text, rule) => {
    if (rule.to.length === 1) {
      let out = text;
      // longest inputs first so overlapping inputs resolve deterministically
      for (const from of [...rule.from].sort((a, b) => b.length - a.length || compareText(a, b))) out = out.split(from).join(rule.to[0]);
      return out;
    }
    if (rule.from.length === rule.to.length) {
      let out = text;
      rule.from.forEach((from, i) => { out = out.split(from).join(rule.to[i]); });
      return out;
    }
    return null;
  };

  const cloneState = (state) => ({
    lexicalIdentity: state.lexicalIdentity ?? null,
    surface: state.surface,
    reading: state.reading ?? null,
    morphology: state.morphology ? { ...state.morphology } : null,
    factIds: [...(state.factIds ?? [])],
    retainedDistinctions: { ...(state.retainedDistinctions ?? {}) }
  });

  // Literal facts that attest the projected surface/reading directly.
  const attestingFacts = (graph, state) => (graph.facts ?? [])
    .filter((fact) => (fact.kind === "literal_reading" || fact.kind === "literal_form")
      && fact.surface === state.surface
      && (fact.kind === "literal_form" ? state.reading === null : fact.reading === state.reading)
      && (state.lexicalIdentity === null || (fact.lexicalRefs ?? []).length === 0 || fact.lexicalRefs.includes(state.lexicalIdentity)))
    .map((fact) => fact.id)
    .sort(compareText);

  const projectOrthography = (input, graph, policy = {}) => {
    const rules = new Map((graph.rules ?? []).map((rule) => [rule.id, rule]));
    let state = cloneState(input);
    const steps = [];
    const blockedRules = [];
    for (const id of compileRuleOrder(graph, policy)) {
      const rule = rules.get(id);
      const channel = channelOf(rule);
      const text = state[channel];
      const mechanism = rule.predicate?.mechanism;
      if (mechanism !== undefined && !MECHANISMS[mechanism]) throw new Error(`Unknown projection mechanism ${mechanism} in ${id}`);
      if (typeof text !== "string" || (!mechanism && !rule.from.some((from) => text.includes(from)))) continue;
      const failure = predicateFailure(rule, state, policy);
      if (failure) { blockedRules.push({ ruleId: id, reason: failure }); continue; }
      const params = { ...(rule.predicate?.params ?? {}), ...(policy.ruleParams?.[id] ?? {}) };
      const next = mechanism ? MECHANISMS[mechanism](text, params) : rewrite(text, rule);
      if (next === null) { blockedRules.push({ ruleId: id, reason: "one_to_many_requires_selection" }); continue; }
      if (next === text) continue;
      const after = cloneState(state);
      after[channel] = next;
      if (rule.lossiness !== "lossless" && after.retainedDistinctions[channel] === undefined) {
        after.retainedDistinctions[channel] = text;
      }
      steps.push({ ruleId: id, before: state, after, evidenceRefs: [...(rule.evidenceRefs ?? [])].sort(compareText) });
      state = after;
    }
    const attestedBy = attestingFacts(graph, state);
    return {
      state,
      steps,
      blockedRules,
      attestedBy,
      // a direct source fact outranks the generated derivation that reached the same output
      authority: attestedBy.length > 0 ? "source_attested" : steps.length > 0 ? "generated" : "identity"
    };
  };

  return { compileRuleOrder, projectOrthography, MECHANISMS: Object.keys(MECHANISMS) };
});

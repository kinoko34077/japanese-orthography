(function (root, factory) {
  const projection = typeof module === "object" && module.exports
    ? require("./orthography-projection-runtime.js")
    : root.OrthographyProjectionRuntime;
  const api = factory(projection);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.OrthographyRestorationRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Projection) {
  "use strict";

  if (!Projection || typeof Projection.projectOrthography !== "function") {
    throw new Error("OrthographyRestorationRuntime requires OrthographyProjectionRuntime (load orthography-projection-runtime.js first)");
  }

  // Orthography Architecture v2 historical restoration (#170, spec #163 §3–4).
  //
  // 1. retained identity: a state that already carries finer distinctions renders them back.
  // 2. reverse traversal: source facts (form relations, historical literal readings) and reversible
  //    rules bound to the observed symbol are walked backwards; each candidate is either tied to the
  //    query's lexical candidates or verified by forward agreement.
  // 3. forward agreement: only if no source-backed candidate exists, predecessor hypotheses are
  //    enumerated from the input sets of lossy rules and kept when the ordinary forward projection
  //    reproduces the observation. Lossy rules are never executed as inverse functions.
  // Source-attested candidates outrank hypotheses; a lone identity hypothesis is not certainty.

  const HISTORICAL = "period:historical-kana";
  const MAX_HYPOTHESES = 256;
  const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const uniqueSorted = (values) => [...new Set(values)].sort(compareText);

  const baseState = (query, overrides = {}) => ({
    lexicalIdentity: query.lexicalCandidates?.length === 1 ? query.lexicalCandidates[0] : null,
    surface: query.observedSurface,
    reading: query.observedReading ?? null,
    morphology: query.context ? { ...query.context } : null,
    factIds: [],
    retainedDistinctions: {},
    ...overrides
  });

  const projectsTo = (state, graph, policy, query) => {
    const projected = Projection.projectOrthography(state, graph, policy).state;
    return projected.surface === query.observedSurface && (query.observedReading == null || projected.reading === query.observedReading);
  };

  const lexicallyTied = (refs, query) => (query.lexicalCandidates ?? []).some((id) => (refs ?? []).includes(id));

  const contextBindings = (bindings, context) => {
    if (!context || context.usage === undefined) return bindings;
    const ref = `context:usage:${context.usage}`;
    const exact = bindings.filter((b) => (b.contextRefs ?? []).includes(ref));
    if (exact.length > 0) return exact;
    if (bindings.some((b) => (b.contextRefs ?? []).length > 0)) return [];
    return bindings.filter((b) => (b.contextRefs ?? []).length === 0);
  };

  const reverseTraversal = (query, graph) => {
    const policy = query.targetPolicy ?? {};
    const out = [];
    const rules = new Map((graph.rules ?? []).map((r) => [r.id, r]));
    for (const fact of graph.facts ?? []) {
      if (!(fact.periodRefs ?? []).includes(HISTORICAL)) continue;
      if (fact.kind === "form_relation" && fact.target === query.observedSurface && fact.surface !== fact.target) {
        if ((query.lexicalCandidates ?? []).length > 0 && (fact.lexicalRefs ?? []).length > 0 && !lexicallyTied(fact.lexicalRefs, query)) continue;
        out.push({ state: baseState(query, { surface: fact.surface, factIds: [fact.id] }), basis: "reverse_traversal", ruleChain: [], sourceRefs: fact.sourceRefs, evidenceRefs: fact.evidenceRefs });
      }
      if (fact.kind === "literal_reading" && fact.surface === query.observedSurface && query.observedReading != null) {
        const candidate = baseState(query, { reading: fact.reading, factIds: [fact.id] });
        // tied to the analysed lexeme, or verified by forward agreement; otherwise not claimable
        if (!lexicallyTied(fact.lexicalRefs, query) && !projectsTo(candidate, graph, policy, query)) continue;
        out.push({ state: candidate, basis: "reverse_traversal", ruleChain: [], sourceRefs: fact.sourceRefs, evidenceRefs: fact.evidenceRefs });
      }
    }
    if (query.observedReading != null) {
      const symbol = `symbol:${query.observedSurface}`;
      const bindings = (graph.bindings ?? []).filter((b) => {
        const rule = rules.get(b.ruleId);
        return rule && rule.directionality === "reverse_traversable" && (b.lexicalRefs ?? []).includes(symbol) && rule.to.length === 1 && rule.to[0] === query.observedReading;
      });
      for (const binding of contextBindings(bindings, query.context)) {
        const rule = rules.get(binding.ruleId);
        const usage = (binding.contextRefs ?? []).map((ref) => /^context:usage:(.*)$/u.exec(ref)?.[1]).find(Boolean);
        for (const from of rule.from) {
          const candidate = baseState(query, { reading: from, morphology: usage ? { ...(query.context ?? {}), usage } : (query.context ? { ...query.context } : null) });
          if (!projectsTo(candidate, graph, policy, query)) continue;
          out.push({ state: candidate, basis: "reverse_traversal", ruleChain: [rule.id], sourceRefs: uniqueSorted([...binding.sourceRefs, ...rule.sourceRefs]), evidenceRefs: uniqueSorted([...binding.evidenceRefs, ...rule.evidenceRefs]) });
        }
      }
    }
    return out;
  };

  // predecessor sets: for every output character of a lossy rule, the rule's input alternatives
  const predecessorTable = (graph) => {
    const table = new Map();
    for (const rule of graph.rules ?? []) {
      if (rule.lossiness !== "many_to_one" || rule.predicate?.mechanism || rule.to.length !== 1) continue;
      const set = table.get(rule.to[0]) ?? new Set([rule.to[0]]);
      for (const from of rule.from) set.add(from);
      table.set(rule.to[0], set);
    }
    return table;
  };

  const forwardAgreement = (query, graph) => {
    const policy = query.targetPolicy ?? {};
    const channel = query.observedReading != null ? "reading" : "surface";
    const observed = channel === "reading" ? query.observedReading : query.observedSurface;
    const table = predecessorTable(graph);
    let hypotheses = [""];
    for (const char of Array.from(observed)) {
      const options = [...(table.get(char) ?? new Set([char]))].sort(compareText);
      hypotheses = hypotheses.flatMap((prefix) => options.map((o) => prefix + o));
      if (hypotheses.length > MAX_HYPOTHESES) return { overflow: true, candidates: [] };
    }
    const candidates = [];
    for (const hypothesis of hypotheses.sort(compareText)) {
      const candidate = baseState(query, channel === "reading" ? { reading: hypothesis } : { surface: hypothesis });
      if (!projectsTo(candidate, graph, policy, query)) continue;
      const chain = Projection.projectOrthography(candidate, graph, policy).steps.map((s) => s.ruleId);
      candidates.push({ state: candidate, basis: "forward_agreement", ruleChain: chain, sourceRefs: [], evidenceRefs: [] });
    }
    return { overflow: false, candidates };
  };

  const dedupe = (candidates) => {
    const seen = new Map();
    for (const c of candidates) {
      const key = JSON.stringify([c.state.surface, c.state.reading, c.ruleChain]);
      const existing = seen.get(key);
      if (!existing) { seen.set(key, { ...c, sourceRefs: uniqueSorted(c.sourceRefs), evidenceRefs: uniqueSorted(c.evidenceRefs) }); continue; }
      existing.sourceRefs = uniqueSorted([...existing.sourceRefs, ...c.sourceRefs]);
      existing.evidenceRefs = uniqueSorted([...existing.evidenceRefs, ...c.evidenceRefs]);
      existing.state.factIds = uniqueSorted([...existing.state.factIds, ...c.state.factIds]);
    }
    return [...seen.values()].sort((a, b) => compareText(JSON.stringify([a.state.surface, a.state.reading]), JSON.stringify([b.state.surface, b.state.reading])));
  };

  const distinctOutputs = (candidates) => new Set(candidates.map((c) => JSON.stringify([c.state.surface, c.state.reading]))).size;

  const restoreOrthography = (query, graph) => {
    const known = query.knownState;
    if (known && Object.keys(known.retainedDistinctions ?? {}).length > 0) {
      const state = { ...known, morphology: known.morphology ? { ...known.morphology } : null, factIds: [...(known.factIds ?? [])], retainedDistinctions: {} };
      for (const [channel, value] of Object.entries(known.retainedDistinctions)) state[channel] = value;
      return { status: "resolved", candidates: [{ state, basis: "retained_identity", ruleChain: [], sourceRefs: [], evidenceRefs: [] }] };
    }
    const attested = dedupe(reverseTraversal(query, graph));
    if (attested.length > 0) {
      return { status: distinctOutputs(attested) === 1 ? "resolved" : "candidates", candidates: attested };
    }
    const { overflow, candidates } = forwardAgreement(query, graph);
    const hypotheses = dedupe(candidates);
    if (overflow || hypotheses.length === 0) return { status: "unresolved", candidates: [] };
    const identityOnly = hypotheses.length === 1 && hypotheses[0].ruleChain.length === 0;
    if (identityOnly) return { status: "unresolved", candidates: hypotheses };
    return { status: distinctOutputs(hypotheses) === 1 ? "resolved" : "candidates", candidates: hypotheses };
  };

  return { restoreOrthography };
});

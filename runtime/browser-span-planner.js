(function (root, factory) {
  const arbitration = typeof module === "object" && module.exports ? require("./occurrence-arbitration.js") : root.OccurrenceArbitration;
  const api = factory(arbitration);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.BrowserSpanPlanner = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (OccurrenceArbitration) {
  "use strict";

  // Arbitrary-text conversion over an opened BrowserPack (#185 D, spec #184 §2).
  //
  //   text -> BrowserPack lexical matches (UTF-16 offsets)
  //        -> optimal lexical analysis DAG (unknown edges everywhere, fewest unknown chars then segments)
  //        -> profile candidates: v2 form relations / character rules / profile rules
  //        -> accepted occurrence arbitration (runtime/occurrence-arbitration.js, Phase 4.8E/#154)
  //        -> rendered text + per-occurrence spans
  //
  // The planner never decides a winner itself: overlap, boundary and ambiguity decisions are the
  // shared arbitration core's. Unknown text and punctuation pass through unchanged. Contextual
  // relations need context the free text does not carry, so they never apply silently.

  if (!OccurrenceArbitration || typeof OccurrenceArbitration.arbitrate !== "function") {
    throw new Error("BrowserSpanPlanner requires OccurrenceArbitration (load occurrence-arbitration.js first)");
  }

  const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const isHighSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;
  const charAt = (text, i) => (isHighSurrogate(text.charCodeAt(i)) && i + 1 < text.length ? text.slice(i, i + 2) : text[i]);

  // Optimal lexical analyses as a DAG (same cost model as lexicalOccurrenceContext in 4.8E/#154).
  const lexicalDag = (length, matches, charBoundaries) => {
    const raw = matches.map((m) => ({ start: m.start, end: m.end, cost: [0, 1], lexical: true }));
    for (const [start, end] of charBoundaries) raw.push({ start, end, cost: [1, 1], lexical: false });
    const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
    const cmp = (a, b) => a[0] - b[0] || a[1] - b[1];
    const forward = new Array(length + 1).fill(null);
    const backward = new Array(length + 1).fill(null);
    forward[0] = [0, 0];
    backward[length] = [0, 0];
    for (const e of [...raw].sort((a, b) => a.start - b.start)) {
      if (!forward[e.start]) continue;
      const next = add(forward[e.start], e.cost);
      if (!forward[e.end] || cmp(next, forward[e.end]) < 0) forward[e.end] = next;
    }
    for (const e of [...raw].sort((a, b) => b.end - a.end)) {
      if (!backward[e.end]) continue;
      const next = add(backward[e.end], e.cost);
      if (!backward[e.start] || cmp(next, backward[e.start]) < 0) backward[e.start] = next;
    }
    const best = forward[length];
    const edges = [];
    const seen = new Set();
    for (const e of raw) {
      if (!forward[e.start] || !backward[e.end] || cmp(add(add(forward[e.start], e.cost), backward[e.end]), best) !== 0) continue;
      const key = `${e.start}:${e.end}:${e.lexical}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ start: e.start, end: e.end, internal: [], units: e.lexical ? [{ start: e.start, end: e.end, lexemes: [], morphology: null }] : [] });
    }
    edges.sort((a, b) => a.start - b.start || a.end - b.end);
    return { dag: { length, edges } };
  };

  const ruleTables = (pack, policy) => {
    const disabled = new Set(policy.disabledRuleIds ?? []);
    const rules = [];
    for (let i = 0; i < pack.ruleCount(); i += 1) {
      const rule = pack.getRule(i);
      if (disabled.has(rule.id)) continue;
      rules.push(rule);
    }
    return rules;
  };

  /**
   * Plan and convert `text` under `profileId`. Returns the rendered text, the per-occurrence spans
   * (UTF-16 offsets), and the raw arbitration decisions the diagnostic layer (unit E) classifies.
   */
  const planAndTransform = async (pack, text, profileId, options = {}) => {
    const policySection = pack.getProfilePolicy(profileId);
    const policy = policySection.policy;
    const historicalTarget = policy.period === "historical";
    await pack.prepare(text);

    const matches = [];
    const charBoundaries = [];
    for (let i = 0; i < text.length;) {
      const ch = charAt(text, i);
      charBoundaries.push([i, i + ch.length]);
      for (const m of pack.findMatchesSync(text, i)) matches.push(m);
      i += ch.length;
    }
    const lexical = lexicalDag(text.length, matches, charBoundaries);
    const rules = ruleTables(pack, policy);

    const candidates = [];
    const contextual = [];
    const push = (candidate) => {
      candidate.key = `${candidate.origin}:${candidate.ref}:${candidate.start}:${candidate.output}`;
      candidates.push(candidate);
    };
    for (const m of matches) {
      const relations = m.facts.filter((f) => f.kind === "form_relation" && f.surface !== f.target && (historicalTarget ? f.viaTarget : !f.viaTarget));
      for (const fact of relations) {
        const output = historicalTarget ? fact.surface : fact.target;
        if (fact.contextual) { contextual.push({ start: m.start, end: m.end, output, fact }); continue; }
        push({ start: m.start, end: m.end, output, policy: "lexical_boundary", origin: "fact", ref: fact.detailRef, fact });
      }
      for (const fact of m.facts.filter((f) => f.safety)) {
        // accepted preserve/block constraint: the identity competes with any rewrite of this span
        push({ start: m.start, end: m.end, output: m.surface, policy: "lexical_boundary", origin: "safety", ref: fact.detailRef, fact });
      }
      for (const rule of rules.filter((r) => r.predicate?.exactToken === true && r.predicate?.channel === "surface" && r.from.includes(m.surface))) {
        push({ start: m.start, end: m.end, output: rule.to[0], policy: "whole_lexeme", origin: "rule", ref: rule.id, rule });
      }
    }
    // character-form rules (accepted 4.6B / safe-character): one code point, applicable anywhere
    const charRules = rules.filter((r) => r.class === "orthographic" && r.predicate?.channel === "surface" && !r.predicate?.exactToken && !r.predicate?.mechanism && r.from.length === 1 && r.to.length === 1);
    for (const [start, end] of charBoundaries) {
      const ch = text.slice(start, end);
      for (const rule of charRules) {
        const from = historicalTarget ? rule.to[0] : rule.from[0];
        const to = historicalTarget ? rule.from[0] : rule.to[0];
        if (ch === from && rule.directionality === "reverse_traversable") push({ start, end, output: to, policy: "anywhere", origin: "rule", ref: rule.id, rule });
      }
    }
    return assemble(text, profileId, lexical, candidates, contextual, {
      ...options, lexicalMatchCount: matches.length,
      matchedFacts: options.trace ? matches.flatMap((m) => m.facts.map((f) => ({ factIndex: f.factIndex, kind: f.kind, start: m.start, end: m.end }))) : []
    });
  };

  /**
   * Shared span assembly (#196 D): arbitrate the candidates over the lexical DAG and build rendered
   * text + per-occurrence spans. Used by this planner and by the resolver adapter, so both engines
   * report spans, regions and blocked candidates identically.
   */
  const assemble = (text, profileId, lexical, candidates, contextual, options = {}) => {
    for (const c of candidates) if (c.key === undefined) c.key = `${c.origin}:${c.ref}:${c.start}:${c.output}`;
    candidates.sort((a, b) => a.start - b.start || b.end - a.end || compareText(a.key, b.key));

    const decision = OccurrenceArbitration.arbitrate({
      length: text.length,
      lexical,
      candidates: candidates.map((c) => ({ key: c.key, start: c.start, end: c.end, output: c.output, policy: c.policy, source: c }))
    });

    // ---- assemble spans ---------------------------------------------------------------------------
    const byKey = new Map(candidates.map((c) => [c.key, c]));
    const regions = [];
    const accepted = new Map();
    for (const a of decision.accepted) {
      const list = accepted.get(`${a.start}:${a.end}`) ?? [];
      list.push(byKey.get(a.key));
      accepted.set(`${a.start}:${a.end}`, list);
    }
    for (const [range, winners] of accepted) {
      const [start, end] = range.split(":").map(Number);
      regions.push({ start, end, state: "applied", output: winners[0].output, winners });
    }
    for (const u of decision.unresolved) regions.push({ start: u.start, end: u.end, state: "unresolved", output: text.slice(u.start, u.end), reasons: u.reasons });
    for (const c of contextual) {
      if (!regions.some((r) => r.start < c.end && r.end > c.start)) regions.push({ start: c.start, end: c.end, state: "context_required", output: text.slice(c.start, c.end), contextual: [c] });
      else regions.find((r) => r.start < c.end && r.end > c.start).contextual = [...(regions.find((r) => r.start < c.end && r.end > c.start).contextual ?? []), c];
    }
    regions.sort((a, b) => a.start - b.start || a.end - b.end);
    // merge overlapping regions conservatively: an overlap with anything unresolved is unresolved
    const merged = [];
    for (const r of regions) {
      const last = merged[merged.length - 1];
      if (last && r.start < last.end) {
        last.end = Math.max(last.end, r.end);
        last.state = "unresolved";
        last.output = text.slice(last.start, last.end);
        last.reasons = [...new Set([...(last.reasons ?? []), ...(r.reasons ?? []), "overlapping_regions"])];
        last.winners = [];
        continue;
      }
      merged.push({ ...r });
    }

    const blockedFor = (start, end) => decision.blocked
      .filter((b) => b.candidate.start < end && b.candidate.end > start)
      .map((b) => ({ ...byKey.get(b.candidate.key), reason: b.reason }));

    const spans = [];
    let renderedText = "";
    let at = 0;
    let outAt = 0;
    for (const r of merged) {
      if (r.start > at) { renderedText += text.slice(at, r.start); outAt += r.start - at; }
      const output = r.state === "applied" ? r.output : text.slice(r.start, r.end);
      spans.push({
        start: r.start, end: r.end, sourceText: text.slice(r.start, r.end), renderedText: output,
        renderedStart: outAt, renderedEnd: outAt + output.length,
        state: r.state, reasons: r.reasons ?? [], winners: r.winners ?? [], contextual: r.contextual ?? [],
        blocked: blockedFor(r.start, r.end)
      });
      renderedText += output;
      outAt += output.length;
      at = r.end;
    }
    if (at < text.length) renderedText += text.slice(at);

    return {
      profileId, sourceText: text, renderedText, offsetUnit: "utf16-code-unit", spans,
      lexicalMatchCount: options.lexicalMatchCount ?? 0, candidateCount: candidates.length,
      // blocked candidates outside any reported span are ordinary non-applications (e.g. a lexical
      // boundary the relation does not fit); kept for diagnostics, never shown as changes
      quietlyBlocked: decision.blocked.filter((b) => !merged.some((r) => b.candidate.start < r.end && b.candidate.end > r.start)).map((b) => ({ ...byKey.get(b.candidate.key), reason: b.reason })),
      // opt-in measurement seam (#196 A): what was looked up, promoted and decided. No effect on output.
      ...(options.trace ? { trace: {
        matchedFacts: options.matchedFacts ?? [],
        candidates: candidates.map((c) => ({ key: c.key, origin: c.origin, ref: c.ref, factIndex: c.fact?.factIndex ?? null, start: c.start, end: c.end, output: c.output, policy: c.policy })),
        contextual: contextual.map((c) => ({ factIndex: c.fact.factIndex, start: c.start, end: c.end, output: c.output })),
        accepted: decision.accepted.map((a) => a.key),
        blocked: decision.blocked.map((b) => ({ key: b.candidate.key, reason: b.reason })),
        unresolved: decision.unresolved.map((u) => ({ start: u.start, end: u.end, reasons: u.reasons }))
      } } : {})
    };
  };

  return { planAndTransform, lexicalDag, assemble, ruleTables, charAt };
});

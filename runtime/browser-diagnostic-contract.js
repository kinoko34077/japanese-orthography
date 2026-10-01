(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.BrowserDiagnosticContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Diagnostic result contract (#185 E, spec #184 §4–5). Certainty is derived from the semantic
  // decision recorded by the planner/arbitration, never from whether the text changed:
  //
  //   unique       (green)  one applicable outcome, no competing candidate
  //   conditional  (orange) competition existed, or the source itself lists alternatives, and
  //                         explicit precedence/context/profile policy selected the outcome
  //   unresolved   (red)    unresolved conflict/ambiguity, missing context, evidence failure
  //   (no span)             unchanged / non-applicable / protected text: no highlight
  //
  // The compact summary is what the UI renders; `expandDetail` produces the full inspection payload
  // lazily from the pack (provenance shards are only fetched here).

  const COMPETITION_REASONS = new Set(["outranked_by_overlap", "shadowed_by_longer_match", "equivalent_overlap"]);
  const CERTAINTY = { unique: "unique", conditional: "conditional", unresolved: "unresolved" };

  const authorityOf = (winner, ruleOrigin) => {
    if (!winner) return "none";
    if (winner.origin === "fact") return "literal_fact";
    if (winner.origin === "safety") return "literal_fact";
    const origin = ruleOrigin ?? winner.rule?.origin ?? "historically_attested";
    if (origin === "project_defined") return "project_rule";
    if (origin === "kinotch_derived") return "derived_rule";
    return "source_rule";
  };

  const certaintyOf = (span) => {
    if (span.state !== "applied") return CERTAINTY.unresolved;
    const competed = span.blocked.some((b) => COMPETITION_REASONS.has(b.reason));
    const sourceAlternatives = span.winners.some((w) => w.fact?.candidate);
    return competed || sourceAlternatives ? CERTAINTY.conditional : CERTAINTY.unique;
  };

  const reasonCodes = (span) => [...new Set([...(span.reasons ?? []), ...span.blocked.map((b) => b.reason), ...(span.state === "context_required" ? ["context_required"] : [])])].sort();

  /** Compact per-occurrence summary for immediate rendering (plain JSON). */
  const summarize = (raw) => {
    const spans = raw.spans.map((span, index) => {
      const winner = span.winners[0];
      return {
        detailRef: String(index),
        start: span.start,
        end: span.end,
        renderedStart: span.renderedStart,
        renderedEnd: span.renderedEnd,
        sourceText: span.sourceText,
        renderedText: span.renderedText,
        status: span.state,
        certainty: certaintyOf(span),
        authority: authorityOf(winner),
        candidateCount: new Set([...span.winners, ...span.blocked, ...span.contextual].map((c) => c.output)).size,
        ruleCount: [...span.winners, ...span.blocked].filter((c) => c.origin === "rule").length,
        reasonCodes: reasonCodes(span),
        changed: span.renderedText !== span.sourceText
      };
    });
    const counts = { unique: 0, conditional: 0, unresolved: 0 };
    for (const s of spans) counts[s.certainty] += 1;
    return { profileId: raw.profileId, renderedText: raw.renderedText, offsetUnit: raw.offsetUnit, spans, counts, lexicalMatchCount: raw.lexicalMatchCount };
  };

  const ruleIndexCache = new WeakMap();
  const ruleById = (pack, id) => {
    let index = ruleIndexCache.get(pack);
    if (!index) {
      index = new Map();
      for (let i = 0; i < pack.ruleCount(); i += 1) index.set(pack.getRule(i).id, i);
      ruleIndexCache.set(pack, index);
    }
    const row = index.get(id);
    return row === undefined ? null : pack.getRule(row);
  };

  const describeCandidate = async (pack, candidate, accepted) => {
    const base = { output: candidate.output, accepted, policy: candidate.policy ?? null, reason: candidate.reason ?? null, start: candidate.start, end: candidate.end };
    if (candidate.origin === "rule") {
      const rule = ruleById(pack, candidate.ref);
      return {
        ...base, kind: "rule", basis: "rule_application", authority: authorityOf(candidate, rule?.origin),
        ruleChain: [candidate.ref], rule: rule && { id: rule.id, class: rule.class, directionality: rule.directionality, lossiness: rule.lossiness, from: rule.from, to: rule.to, origin: rule.origin },
        provenance: rule ? { sourceRefs: rule.sourceRefs, evidenceRefs: rule.evidenceRefs } : null
      };
    }
    const detail = await pack.loadDetail(candidate.ref);
    return {
      ...base, kind: candidate.origin === "safety" ? "safety_constraint" : "fact",
      basis: candidate.origin === "safety" ? "preserve_constraint" : "reverse_traversal",
      authority: "literal_fact", ruleChain: [],
      fact: { id: detail.factId, kind: candidate.fact?.kind ?? null, surface: candidate.fact?.surface ?? null, target: candidate.fact?.target ?? null, sourceCandidate: Boolean(candidate.fact?.candidate), tags: detail.tags },
      lexicalRefs: detail.lexicalRefs,
      provenance: { sourceRefs: detail.sourceRefs, evidenceRefs: detail.evidenceRefs }
    };
  };

  /** Full inspection payload for one span (`detailRef` from the summary). */
  const expandDetail = async (pack, raw, detailRef) => {
    const span = raw.spans[Number(detailRef)];
    if (!span) throw new RangeError(`unknown detailRef ${detailRef}`);
    const policy = pack.getProfilePolicy(raw.profileId);
    // lexical identity and readings of the span surface, from the same pack
    const matches = (await pack.findMatches(raw.sourceText, span.start)).filter((m) => m.end === span.end);
    const lexicalFacts = matches.flatMap((m) => m.facts.filter((f) => f.kind === "literal_form" || f.kind === "literal_reading"));
    const lexicalCandidates = [];
    const readings = { modern: [], historical: [] };
    for (const fact of lexicalFacts) {
      const detail = await pack.loadDetail(fact.detailRef);
      for (const ref of detail.lexicalRefs) if (!lexicalCandidates.includes(ref)) lexicalCandidates.push(ref);
      if (fact.kind === "literal_reading" && fact.reading) {
        const bucket = fact.historical ? readings.historical : readings.modern;
        if (!bucket.includes(fact.reading)) bucket.push(fact.reading);
      }
    }
    const accepted = [];
    for (const w of span.winners) accepted.push(await describeCandidate(pack, w, true));
    const rejected = [];
    for (const b of span.blocked) rejected.push(await describeCandidate(pack, b, false));
    for (const c of span.contextual) rejected.push({ ...(await describeCandidate(pack, { ...c, origin: "fact", ref: c.fact.detailRef }, false)), reason: "context_required" });
    const summary = summarize({ ...raw, spans: [span] }).spans[0];
    return {
      detailRef: String(detailRef),
      range: { start: span.start, end: span.end, renderedStart: span.renderedStart, renderedEnd: span.renderedEnd, offsetUnit: raw.offsetUnit },
      sourceText: span.sourceText,
      renderedText: span.renderedText,
      status: span.state,
      certainty: summary.certainty,
      authority: summary.authority,
      reasonCodes: summary.reasonCodes,
      lexicalIdentity: lexicalCandidates.length === 1 ? lexicalCandidates[0] : null,
      lexicalCandidates: lexicalCandidates.sort(),
      readings: { modern: readings.modern.sort(), historical: readings.historical.sort() },
      morphologyContext: { available: false, note: "貼り付けた文章には品詞・活用・文脈の情報がありません。文脈によって表記が変わる語は確定しません。" },
      basis: accepted[0]?.basis ?? null,
      ruleChain: accepted.flatMap((c) => c.ruleChain),
      acceptedCandidates: accepted,
      rejectedCandidates: rejected,
      retainedDistinctions: span.state === "applied" && span.renderedText !== span.sourceText ? { surface: span.sourceText } : {},
      provenance: {
        sourceRefs: [...new Set(accepted.flatMap((c) => c.provenance?.sourceRefs ?? []))].sort(),
        evidenceRefs: [...new Set(accepted.flatMap((c) => c.provenance?.evidenceRefs ?? []))].sort()
      },
      compatibilityAgreement: { status: "not_involved", note: "このブラウザ版は新方式（v2）の知識だけを使います。互換用に残している旧方式（UniDic 語彙ID の対応表, #173）は使っていないため、比較対象はありません。" },
      profileEffects: { profileId: raw.profileId, period: policy.policy.period ?? null, candidatePolicy: policy.policy.candidatePolicy ?? null, disabledRuleIds: policy.policy.disabledRuleIds ?? [] }
    };
  };

  return { summarize, expandDetail, certaintyOf, CERTAINTY };
});

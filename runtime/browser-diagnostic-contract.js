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
    if (winner.origin === "resolver") {
      const historical = winner.unit?.historical ?? {};
      const hasHistoricalProvenance = [historical.sourceRefs, historical.evidenceRefs, historical.canonicalIds]
        .some((refs) => Array.isArray(refs) && refs.length > 0);
      if (!hasHistoricalProvenance) return "none";
      return winner.authority ?? "source_rule"; // set by the resolver adapter (#196 D)
    }
    if (winner.origin === "program") {
      const historical = winner.unit?.historical;
      if (historical) {
        const hasHistoricalProvenance = [historical.sourceRefs, historical.evidenceRefs, historical.canonicalIds]
          .some((refs) => Array.isArray(refs) && refs.length > 0);
        if (historical.status !== "resolved" || !hasHistoricalProvenance) return "none";
      }
      return (winner.programIds?.length || winner.provenance?.canonicalIds?.length) ? "source_rule" : "none";
    }
    if (winner.origin === "fact") return "literal_fact";
    if (winner.origin === "safety") return "literal_fact";
    const origin = ruleOrigin ?? winner.rule?.origin ?? "historically_attested";
    if (origin === "project_defined") return "project_rule";
    if (origin === "kinotch_derived") return "derived_rule";
    return "source_rule";
  };

  const certaintyOf = (span) => {
    if (span.state !== "applied") return CERTAINTY.unresolved;
    const semanticWinner = span.winners.find((winner) => winner.unit && (winner.origin === "resolver" || winner.origin === "program"));
    if (semanticWinner) {
      const unit = semanticWinner.unit ?? {};
      const historical = unit.historical ?? {};
      // A serializer winner is not a semantic winner. Historical Ruby requires an admitted,
      // source-backed historical decision, while displayReading is presentation-only.
      const hasHistoricalProvenance = [historical.sourceRefs, historical.evidenceRefs, historical.canonicalIds]
        .some((refs) => Array.isArray(refs) && refs.length > 0);
      if (historical.status !== "resolved" || !hasHistoricalProvenance) return CERTAINTY.unresolved;
      const lexicalCandidates = Array.isArray(unit.lexicalCandidates) ? unit.lexicalCandidates : [];
      const lexicalAmbiguous = unit.kind === "candidates" || (!unit.lexicalIdentity && lexicalCandidates.length > 1);
      if (lexicalAmbiguous) return CERTAINTY.conditional;
      const semanticCompetition = span.blocked.some((b) => COMPETITION_REASONS.has(b.reason) && b.unit);
      if (semanticCompetition) return CERTAINTY.conditional;
    }
    const competed = span.blocked.some((b) => COMPETITION_REASONS.has(b.reason) && (!semanticWinner || b.unit));
    const sourceAlternatives = span.winners.some((w) => w.fact?.candidate || (w.origin === "program" && w.candidate));
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
        changed: span.renderedText !== span.sourceText,
        // #196 H: recognition is reported separately from certainty and change
        recognized: Boolean(span.winners[0]?.unit || span.blocked.some((b) => b.unit) || span.winners.length || span.contextual.length),
        resolved: (span.winners[0]?.unit?.kind ?? span.blocked.find((b) => b.unit)?.unit?.kind) === "resolved"
      };
    });
    const counts = { unique: 0, conditional: 0, unresolved: 0 };
    for (const s of spans) counts[s.certainty] += 1;
    const units = inspectableUnits(raw, spans);
    return {
      profileId: raw.profileId, renderedText: raw.renderedText, offsetUnit: raw.offsetUnit, spans, counts, lexicalMatchCount: raw.lexicalMatchCount,
      units, recognizedCount: units.length + spans.filter((s) => s.recognized).length, renderMode: raw.renderMode ?? "plain"
    };
  };

  /**
   * Recognized-but-unchanged lexical units for inspection (#196 H): units outside every reported span,
   * chosen longest-first left to right for display only (no semantic decision). They carry no
   * certainty: `recognized` is not `resolved`, and neither is `changed`.
   */
  const inspectableUnits = (raw, spans) => {
    if (!Array.isArray(raw.units)) return [];
    const ordered = raw.units.map((u, index) => ({ ...u, index }))
      .filter((u) => !spans.some((s) => u.start < s.end && u.end > s.start) && u.unit && (u.unit.lexicalIdentity || u.unit.lexicalCandidates.length))
      .sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const chosen = [];
    for (const u of ordered) if (!chosen.some((c) => u.start < c.end && u.end > c.start)) chosen.push(u);
    // rendered offsets: unchanged text shifts by the length change of every span before it
    return chosen.map((u) => {
      const delta = spans.filter((s) => s.end <= u.start).reduce((n, s) => n + (s.renderedEnd - s.renderedStart) - (s.end - s.start), 0);
      return {
        detailRef: `u:${u.index}`, start: u.start, end: u.end, renderedStart: u.start + delta, renderedEnd: u.end + delta, sourceText: u.surface,
        recognized: true, resolved: u.unit.kind === "resolved", changed: false,
        lexicalIdentity: u.unit.lexicalIdentity, reading: u.unit.reading, candidateCount: u.unit.lexicalCandidates.length || (u.unit.lexicalIdentity ? 1 : 0)
      };
    });
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
    if (candidate.origin === "resolver") {
      // accepted OrthographyResolver unit (#196 D): its semantic fields, plus the canonical relation
      // facts it was given for this surface (lazy provenance)
      const facts = [];
      for (const f of candidate.relationFacts ?? []) {
        const detail = await pack.loadDetail(f.detailRef);
        facts.push({ id: detail.factId, surface: f.surface, target: f.target, sourceCandidate: Boolean(f.candidate), tags: detail.tags, sourceRefs: detail.sourceRefs, evidenceRefs: detail.evidenceRefs });
      }
      const unit = candidate.unit ?? null;
      const historical = unit?.historical ?? {};
      const historicalFacts = historical.status === "resolved" ? facts : [];
      return {
        ...base, kind: "resolver_unit", basis: unit?.historical?.basis ?? (unit?.historical?.contextualKanji === "resolved" ? "contextual_kanji" : unit?.historical?.deterministicKanji ? "deterministic_kanji" : unit?.historical?.route ? `historical_${unit.historical.route}` : "resolver"),
        authority: authorityOf(candidate), ruleChain: [], unit, relationFacts: facts,
        provenance: { sourceRefs: [...new Set([...historicalFacts.flatMap((f) => f.sourceRefs), ...(unit?.historical?.sourceRefs ?? [])])].sort(), evidenceRefs: [...new Set([...historicalFacts.flatMap((f) => f.evidenceRefs), ...(unit?.historical?.evidenceRefs ?? [])])].sort(), canonicalIds: [...new Set([...historicalFacts.map((f) => f.id), ...(unit?.historical?.canonicalIds ?? [])])].sort() }
      };
    }
    if (candidate.origin === "program") {
      const programIds = [...new Set(candidate.programIds ?? [])];
      const programs = [];
      for (const programId of programIds) {
        const evidence = await pack.loadProgramEvidence(programId);
        if (evidence) programs.push(evidence);
      }
      const canonicalIds = [...new Set(programs.flatMap((program) => program.canonicalIds ?? []))].sort();
      return {
        ...base, kind: "rule_program", basis: "rule_program_execution", authority: authorityOf({ ...candidate, provenance: { canonicalIds } }),
        ruleChain: programIds.map((programId) => `program:${programId}`), programIds, programs,
        provenance: { sourceRefs: [], evidenceRefs: canonicalIds, canonicalIds }
      };
    }
    if (candidate.origin === "rule") {
      const rule = ruleById(pack, candidate.ref);
      return {
        ...base, kind: "rule", basis: "rule_application", authority: authorityOf({ ...candidate, rule }, rule?.origin),
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

  /**
   * Evidence recovered lazily from the cold evidence map (#211 G): canonical id -> source records,
   * dispositions, snapshots, period, and the Programs (with their human-readable type) compiled from it.
   */
  const evidenceFor = async (pack, canonicalId, options = {}) => {
    if (!pack.hasEvidence || !canonicalId) return null;
    const entry = await pack.loadEvidence(canonicalId);
    if (!entry) return null;
    const programIds = [...(entry.programs ?? [])];
    const programOffset = Number.isInteger(options.programOffset) && options.programOffset >= 0 ? options.programOffset : 0;
    const programPageSize = Number.isInteger(options.programPageSize) && options.programPageSize > 0 ? options.programPageSize : 8;
    const programs = [];
    for (const id of programIds.slice(programOffset, programOffset + programPageSize)) programs.push(await pack.loadProgramEvidence(id));
    return { ...entry, programIds, programCount: programIds.length, programOffset, programPageSize, programs, programsTruncated: programOffset + programs.length < programIds.length };
  };
  const withEvidence = async (pack, candidate) => {
    const ids = [...new Set([candidate.fact?.id, candidate.rule?.id, ...(candidate.provenance?.canonicalIds ?? [])].filter(Boolean))];
    const facts = candidate.relationFacts ?? [];
    const evidences = [];
    for (const id of ids) evidences.push(await evidenceFor(pack, id));
    const relationEvidence = [];
    for (const f of facts) relationEvidence.push(await evidenceFor(pack, f.id));
    return evidences.some(Boolean) || relationEvidence.some(Boolean) ? { ...candidate, evidence: evidences.find(Boolean) ?? relationEvidence.find(Boolean) } : candidate;
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
    for (const w of span.winners) accepted.push(await withEvidence(pack, await describeCandidate(pack, w, true)));
    const rejected = [];
    for (const b of span.blocked) rejected.push(await withEvidence(pack, await describeCandidate(pack, b, false)));
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
      morphologyContext: morphologyContextOf(span.winners[0]?.unit ?? span.blocked.find((b) => b.unit)?.unit ?? null),
      basis: accepted[0]?.basis ?? null,
      ruleChain: accepted.flatMap((c) => c.ruleChain),
      acceptedCandidates: accepted,
      rejectedCandidates: rejected,
      retainedDistinctions: span.state === "applied" && span.renderedText !== span.sourceText ? { surface: span.sourceText } : {},
      provenance: {
        sourceRefs: [...new Set(accepted.flatMap((c) => c.provenance?.sourceRefs ?? []))].sort(),
        evidenceRefs: [...new Set(accepted.flatMap((c) => c.provenance?.evidenceRefs ?? []))].sort()
      },
      resolverUnit: span.winners[0]?.unit ?? span.blocked.find((b) => b.unit)?.unit ?? null,
      compatibilityAgreement: { status: "not_involved", note: "このブラウザ版は新方式（v2）の知識だけを使います。互換用に残している旧方式（UniDic 語彙ID の対応表, #173）は使っていないため、比較対象はありません。" },
      profileEffects: { profileId: raw.profileId, period: policy.policy.period ?? null, candidatePolicy: policy.policy.candidatePolicy ?? null, disabledRuleIds: policy.policy.disabledRuleIds ?? [] }
    };
  };

  function morphologyContextOf(unit) {
    if (unit?.morphology) {
      return {
        available: true, partOfSpeech: [...unit.morphology.partOfSpeech], conjugationType: unit.morphology.conjugationType, conjugationForm: unit.morphology.conjugationForm,
        note: "辞書の品詞・活用情報です（文脈の意味までは判断しません）。文脈によって表記が変わる語は確定しません。"
      };
    }
    return { available: false, note: "この箇所には品詞・活用の情報がありません。文脈によって表記が変わる語は確定しません。" };
  }

  /**
   * Inspection payload for a recognized unit `u:<index>` (#196 H): lexical identity, forms, readings,
   * morphology and candidates from the lexical layer, provenance of the unit's own facts (lazy).
   */
  const expandUnitDetail = async (pack, lexical, raw, detailRef) => {
    const match = /^u:(\d+)$/u.exec(`${detailRef}`);
    const unit = match && raw.units?.[Number(match[1])];
    if (!unit) throw new RangeError(`unknown unit detailRef ${detailRef}`);
    const u = unit.unit;
    const identities = [...new Set([...(u.lexicalIdentity ? [u.lexicalIdentity] : []), ...u.lexicalCandidates.map((c) => c.lexicalIdentity)])];
    // lexeme records of those identities, found through the same surface / reading / base-form routes
    const keys = [...new Set([unit.surface, u.inflection?.baseSurface, ...u.lexicalCandidates.map((c) => c.inflection?.baseSurface).filter(Boolean)].filter(Boolean))];
    const found = new Map();
    for (const key of keys) {
      for (const c of [...await lexical.lookupSurface(key), ...await lexical.lookupReading(key)]) if (identities.includes(c.lexicalIdentity) && !found.has(c.lexicalIdentity)) found.set(c.lexicalIdentity, c.lexemeId);
    }
    const lexemes = [];
    for (const identity of identities) {
      const id = found.get(identity);
      if (id === undefined) { lexemes.push({ lexicalIdentity: identity, forms: [], readings: { modern: [], historical: [] }, morphology: [] }); continue; }
      const lexeme = await lexical.getLexeme(id);
      lexemes.push({
        lexicalIdentity: identity,
        lemma: lexeme.headSurface ?? lexeme.headReading,
        forms: lexeme.forms.map((f) => ({ surface: f.surface, flags: f.flags })),
        readings: {
          modern: [...new Set(lexeme.readings.filter((r) => r.period === "modern").map((r) => r.reading))],
          historical: lexeme.readings.filter((r) => r.period === "historical").map((r) => ({ surface: r.surface, reading: r.reading, route: r.route }))
        },
        morphology: lexeme.morphologyIds.map((m) => lexical.getMorphology(m)).map((m) => ({ source: m.source, partOfSpeech: m.partOfSpeech, conjugationType: m.conjugationType, conjugationForm: m.conjugationForm, reading: m.reading }))
      });
    }
    // provenance of the facts keyed by this surface (lazy detail shards)
    const sourceRefs = new Set();
    const evidenceRefs = new Set();
    for (const m of (await pack.findMatches(raw.sourceText, unit.start)).filter((x) => x.end === unit.end)) {
      for (const f of m.facts) {
        const detail = await pack.loadDetail(f.detailRef);
        if (!detail.lexicalRefs.length || detail.lexicalRefs.some((r) => identities.includes(r))) {
          for (const s of detail.sourceRefs) sourceRefs.add(s);
          for (const e of detail.evidenceRefs) evidenceRefs.add(e);
        }
      }
    }
    const policy = pack.getProfilePolicy(raw.profileId);
    return {
      kind: "unit", detailRef: String(detailRef),
      range: { start: unit.start, end: unit.end, offsetUnit: raw.offsetUnit },
      sourceText: unit.surface,
      recognition: { recognized: true, resolved: u.kind === "resolved", changed: unit.outputs.length > 0 },
      lexicalIdentity: u.lexicalIdentity, reading: u.reading, readingSource: u.readingSource, lexicalOrigin: u.lexicalOrigin,
      morphologyContext: morphologyContextOf(u),
      inflection: u.inflection ?? u.lexicalCandidates.find((c) => c.inflection)?.inflection ?? null,
      lexemes,
      candidateForms: unit.outputs,
      historical: u.historical,
      provenance: { sourceRefs: [...sourceRefs].sort(), evidenceRefs: [...evidenceRefs].sort() },
      profileEffects: { profileId: raw.profileId, period: policy.policy.period ?? null, disabledRuleIds: policy.policy.disabledRuleIds ?? [] },
      renderMode: raw.renderMode ?? "plain"
    };
  };

  return { summarize, expandDetail, expandUnitDetail, evidenceFor, certaintyOf, CERTAINTY };
});

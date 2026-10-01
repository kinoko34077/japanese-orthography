(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.OccurrenceArbitration = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Phase 4.8E occurrence-level applicability + overlap arbitration (#137).
  //
  // Input: every productive match in the text (not a left-to-right cursor), each with its span,
  // output, relation refs and applicability policy, plus optional lexical occurrence context
  // (the best analysis paths' boundaries and lexical units). Output: accepted matches, blocked
  // matches with reasons, and unresolved regions. Decisions depend only on spans, outputs,
  // policies and lexical evidence -- never on input/storage order.

  const POLICIES = new Set([
    "anywhere",
    "lexical_boundary",
    "left_boundary",
    "right_boundary",
    "whole_lexeme"
  ]);
  const MAX_COMPONENT_CANDIDATES = 24;
  const AMBIGUOUS_REASONS = new Set(["ambiguous_lexical_boundary", "ambiguous_lexical_identity", "ambiguous_morphology"]);

  const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
  const candidateSort = (a, b) => (
    a.start - b.start || b.end - a.end || compareText(a.output, b.output) || compareText(a.key, b.key)
  );

  const requirePolicy = (policy, key) => {
    if (!POLICIES.has(policy)) throw new TypeError(`Unknown applicability policy ${policy} for ${key}`);
    return policy;
  };

  // Lexical occurrence evidence comes in one of two shapes:
  //  - { dag: { length, edges } } — every edge lies on at least one optimal analysis; the set of
  //    complete paths through the DAG is exactly the set of optimal analyses (no enumeration cap).
  //    edge: { start, end, internal: number[], units: [{ start, end, lexemes: string[], morphology: object[] | null }] }
  //  - { paths: [{ boundaries, units, lexemes?, morphology? }] } — explicitly enumerated analyses.
  // A gate holds only if it holds on every optimal analysis; holding on some is ambiguity.
  const MORPHOLOGY_KEYS = new Set(["partOfSpeech", "conjugationType", "conjugationForm"]);

  const normalizeLexical = (lexical, length) => {
    if (lexical == null) return null;
    if (lexical.dag) {
      const edges = lexical.dag.edges ?? [];
      if (lexical.dag.length !== length) throw new TypeError("Lexical DAG length does not match input");
      for (const edge of edges) {
        if (!Number.isInteger(edge.start) || !Number.isInteger(edge.end) || edge.start < 0 || edge.end <= edge.start || edge.end > length) {
          throw new TypeError("Invalid lexical DAG edge");
        }
      }
      return { kind: "dag", length, edges };
    }
    if (!Array.isArray(lexical.paths) || lexical.paths.length === 0) {
      throw new TypeError("Lexical occurrence context requires a dag or at least one path");
    }
    return {
      kind: "paths",
      paths: lexical.paths.map((path) => ({
        boundaries: new Set([0, length, ...(path.boundaries ?? [])]),
        units: new Map((path.units ?? []).map(([s, e]) => [`${s}:${e}`, {
          lexemes: (path.lexemes ?? {})[`${s}:${e}`] ?? null,
          morphology: (path.morphology ?? {})[`${s}:${e}`] ?? null
        }]))
      }))
    };
  };

  const morphologyValue = (record, key) => {
    if (key === "partOfSpeech") return record.partOfSpeech ?? record.pos ?? null;
    return record[key] ?? null;
  };
  const morphologyRecordMatches = (required, record) => Object.entries(required).every(([key, value]) => {
    const actual = morphologyValue(record, key);
    if (key === "partOfSpeech") {
      const wanted = `${value}`.split(",");
      return Array.isArray(actual) && wanted.every((part, i) => actual[i] === part);
    }
    return actual === value;
  });

  // Tri-state evaluation of one unit against identity / morphology requirements.
  const unitVerdict = (unit, candidate) => {
    let verdict = "yes";
    const merge = (next) => {
      if (next === "no" || verdict === "no") verdict = "no";
      else if (next === "maybe") verdict = "maybe";
    };
    if (candidate.lexicalIdentity) {
      const lexemes = unit.lexemes ?? [];
      if (!lexemes.includes(candidate.lexicalIdentity)) merge("no");
      else if (lexemes.length > 1) merge("maybe");
    }
    if (candidate.requiredMorphology) {
      const records = unit.morphology ?? [];
      if (records.length === 0) merge("no");
      else {
        const matches = records.filter((record) => morphologyRecordMatches(candidate.requiredMorphology, record)).length;
        merge(matches === records.length ? "yes" : matches === 0 ? "no" : "maybe");
      }
    }
    return verdict;
  };

  const needsUnit = (candidate) => candidate.policy === "whole_lexeme" || Boolean(candidate.lexicalIdentity) || Boolean(candidate.requiredMorphology);
  const boundaryFacts = (candidate) => {
    switch (candidate.policy) {
      case "left_boundary": return ["left"];
      case "right_boundary": return ["right"];
      case "lexical_boundary": return ["left", "right"];
      default: return [];
    }
  };

  // Which outcomes are reachable over all optimal analyses: { all, some }.
  const quantify = (candidate, evidence, facts, unitCheck) => {
    if (facts.length === 0) return { all: true, some: true };
    const bit = new Map(facts.map((fact, i) => [fact, 1 << i]));
    const full = (1 << facts.length) - 1;
    const evaluateEdge = (edge) => {
      // masks this edge can contribute (two when a unit fact is only "maybe")
      let masks = [0];
      const add = (fact, verdict) => {
        if (verdict === "no") return;
        const b = bit.get(fact);
        masks = verdict === "yes" ? masks.map((m) => m | b) : [...masks, ...masks.map((m) => m | b)];
      };
      const covers = (p) => edge.start === p || edge.end === p || (edge.start < p && p < edge.end && (edge.internal ?? []).includes(p));
      if (bit.has("left")) add("left", covers(candidate.start) ? "yes" : "no");
      if (bit.has("right")) add("right", covers(candidate.end) ? "yes" : "no");
      if (bit.has("unit")) {
        const units = (edge.units ?? []).filter((u) => u.start === candidate.start && u.end === candidate.end);
        let verdict = "no";
        for (const unit of units) {
          const v = unitCheck(unit);
          if (v === "yes") { verdict = "yes"; break; }
          if (v === "maybe") verdict = "maybe";
        }
        add("unit", verdict);
      }
      return [...new Set(masks)];
    };
    if (evidence.kind === "paths") {
      const results = evidence.paths.map((path) => facts.every((fact) => {
        if (fact === "left") return path.boundaries.has(candidate.start);
        if (fact === "right") return path.boundaries.has(candidate.end);
        const unit = path.units.get(`${candidate.start}:${candidate.end}`);
        return unit ? unitCheck(unit) === "yes" : false;
      }));
      return { all: results.every(Boolean), some: results.some(Boolean) };
    }
    const reach = new Map([[0, new Set([0])]]);
    const edges = [...evidence.edges].sort((a, b) => a.start - b.start || a.end - b.end);
    for (const edge of edges) {
      const from = reach.get(edge.start);
      if (!from) continue;
      const to = reach.get(edge.end) ?? new Set();
      const contributions = evaluateEdge(edge);
      for (const mask of from) for (const c of contributions) to.add(mask | c);
      reach.set(edge.end, to);
    }
    const end = reach.get(evidence.length) ?? new Set();
    if (end.size === 0) return { all: false, some: false };
    return { all: [...end].every((m) => m === full), some: [...end].some((m) => m === full) };
  };

  const gate = (candidate, evidence) => {
    if (candidate.requiredMorphology && Object.keys(candidate.requiredMorphology).some((key) => !MORPHOLOGY_KEYS.has(key))) {
      return { ok: false, reason: "morphology_unsupported" };
    }
    const constrained = Boolean(candidate.lexicalIdentity || candidate.requiredMorphology);
    if (candidate.policy === "anywhere" && !constrained) return { ok: true };
    if (!evidence) {
      // Without lexical evidence identity/morphology cannot be verified (fail closed); pure boundary
      // policies fall back to the accepted Phase-4.7 substring behaviour.
      return constrained ? { ok: false, reason: "lexical_analysis_unavailable" } : { ok: true };
    }
    const boundaries = boundaryFacts(candidate);
    const facts = [...boundaries, ...(needsUnit(candidate) ? ["unit"] : [])];
    const total = quantify(candidate, evidence, facts, (u) => unitVerdict(u, candidate));
    if (total.all) return { ok: true };
    const structural = [...boundaries, ...(candidate.policy === "whole_lexeme" || constrained ? ["unit"] : [])];
    const shape = quantify(candidate, evidence, structural, () => "yes");
    if (!shape.all) {
      return shape.some || total.some
        ? { ok: false, reason: "ambiguous_lexical_boundary", ambiguous: true }
        : { ok: false, reason: "crosses_lexical_boundary" };
    }
    if (total.some) {
      return { ok: false, reason: candidate.requiredMorphology ? "ambiguous_morphology" : "ambiguous_lexical_identity", ambiguous: true };
    }
    if (candidate.lexicalIdentity) {
      const identity = quantify(candidate, evidence, structural, (u) => unitVerdict(u, { lexicalIdentity: candidate.lexicalIdentity }));
      if (!identity.some) return { ok: false, reason: "lexical_identity_mismatch" };
    }
    if (candidate.requiredMorphology) {
      const available = quantify(candidate, evidence, structural, (u) => ((u.morphology ?? []).length > 0 ? "yes" : "no"));
      return { ok: false, reason: available.some ? "morphology_mismatch" : "morphology_unavailable" };
    }
    return { ok: false, reason: "lexical_identity_mismatch" };
  };

  // All optimal non-overlapping selections of one overlap component (max covered length).
  const optimalSelections = (items) => {
    const sorted = [...items].sort(candidateSort);
    let best = -1;
    let selections = [];
    const walk = (i, lastEnd, chosen, covered) => {
      if (i === sorted.length) {
        if (covered > best) { best = covered; selections = [chosen]; } else if (covered === best) selections.push(chosen);
        return;
      }
      const item = sorted[i];
      if (item.start >= lastEnd) walk(i + 1, item.end, [...chosen, item], covered + (item.end - item.start));
      walk(i + 1, lastEnd, chosen, covered);
    };
    walk(0, -1, [], 0);
    // drop selections that are strict subsets of another optimal selection (cannot happen with
    // max coverage unless zero-length, kept for safety)
    return selections;
  };

  const arbitrate = (input) => {
    const length = input.length;
    const evidence = normalizeLexical(input.lexical, length);
    const accepted = [];
    const blocked = [];
    const unresolved = [];

    const candidates = input.candidates.map((candidate) => ({
      ...candidate,
      policy: requirePolicy(candidate.policy ?? "anywhere", candidate.key)
    })).sort(candidateSort);

    const live = [];
    for (const candidate of candidates) {
      const verdict = gate(candidate, evidence);
      if (verdict.ok) live.push(candidate);
      else blocked.push({ candidate, reason: verdict.reason });
    }

    // same-start: the longest admissible match shadows shorter ones (accepted 4.7 behaviour)
    const longestAt = new Map();
    for (const candidate of live) {
      longestAt.set(candidate.start, Math.max(longestAt.get(candidate.start) ?? 0, candidate.end - candidate.start));
    }
    const contenders = [];
    for (const candidate of live) {
      if (candidate.end - candidate.start < longestAt.get(candidate.start)) blocked.push({ candidate, reason: "shadowed_by_longer_match" });
      else contenders.push(candidate);
    }

    // connected overlap components
    contenders.sort(candidateSort);
    const components = [];
    for (const candidate of contenders) {
      const current = components.at(-1);
      if (current && candidate.start < current.end) {
        current.items.push(candidate);
        current.end = Math.max(current.end, candidate.end);
      } else {
        components.push({ start: candidate.start, end: candidate.end, items: [candidate] });
      }
    }

    for (const component of components) {
      if (component.items.length === 1) { accepted.push(component.items[0]); continue; }
      const sameSpan = component.items.every((c) => c.start === component.start && c.end === component.end);
      const selections = component.items.length > MAX_COMPONENT_CANDIDATES ? [] : optimalSelections(component.items);
      const render = (selection) => selection.map((c) => `${c.start}:${c.end}:${c.output}`).join("|");
      const outputs = new Set(selections.map((selection) => {
        let text = "";
        let at = component.start;
        for (const c of selection) { text += `${at}<${c.start}>${c.output}`; at = c.end; }
        return `${text}<${at}>`;
      }));
      if (selections.length >= 1 && new Set(selections.map(render)).size === 1) {
        // every relation producing the chosen occurrence (same span, same output) is applied together
        const chosen = new Set(selections[0].map((c) => `${c.start}:${c.end}:${c.output}`));
        for (const c of component.items) {
          if (chosen.has(`${c.start}:${c.end}:${c.output}`)) accepted.push(c);
          else blocked.push({ candidate: c, reason: "outranked_by_overlap" });
        }
        continue;
      }
      if (selections.length > 1 && outputs.size === 1) {
        // identical results through different relations: accept all of one canonical selection
        const canonical = [...selections].sort((a, b) => compareText(a.map((c) => c.key).join(), b.map((c) => c.key).join()))[0];
        const chosen = new Set(canonical);
        for (const c of component.items) {
          if (chosen.has(c)) accepted.push(c);
          else blocked.push({ candidate: c, reason: "equivalent_overlap" });
        }
        continue;
      }
      const reason = sameSpan ? "conflicting_productive_outputs" : "unresolved_shifted_overlap";
      for (const c of component.items) blocked.push({ candidate: c, reason });
      unresolved.push({ start: component.start, end: component.end, reason });
    }

    // ambiguous-boundary candidates leave their region explicitly unresolved when nothing else won
    for (const entry of blocked) {
      if (!AMBIGUOUS_REASONS.has(entry.reason)) continue;
      const { start, end } = entry.candidate;
      const overlapsAccepted = accepted.some((c) => c.start < end && c.end > start);
      const overlapsUnresolved = unresolved.some((u) => u.start < end && u.end > start);
      if (!overlapsAccepted && !overlapsUnresolved) unresolved.push({ start, end, reason: entry.reason });
    }

    accepted.sort(candidateSort);
    unresolved.sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    for (const region of unresolved) {
      const last = merged.at(-1);
      if (last && region.start < last.end) {
        last.end = Math.max(last.end, region.end);
        if (!last.reasons.includes(region.reason)) last.reasons.push(region.reason);
      } else merged.push({ start: region.start, end: region.end, reasons: [region.reason] });
    }
    unresolved.length = 0;
    unresolved.push(...merged);
    blocked.sort((a, b) => candidateSort(a.candidate, b.candidate) || compareText(a.reason, b.reason));
    return { accepted, blocked, unresolved };
  };

  return { arbitrate, POLICIES: [...POLICIES] };
});

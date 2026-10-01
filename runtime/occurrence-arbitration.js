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

  const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
  const candidateSort = (a, b) => (
    a.start - b.start || b.end - a.end || compareText(a.output, b.output) || compareText(a.key, b.key)
  );

  const requirePolicy = (policy, key) => {
    if (!POLICIES.has(policy)) throw new TypeError(`Unknown applicability policy ${policy} for ${key}`);
    return policy;
  };

  // lexical: { paths: [{ boundaries: number[], units: [[start, end]], lexemes?: { "s:e": [ids] } }] }
  const normalizeLexical = (lexical, length) => {
    if (lexical == null) return null;
    if (!Array.isArray(lexical.paths) || lexical.paths.length === 0) {
      throw new TypeError("Lexical occurrence context requires at least one path");
    }
    return lexical.paths.map((path) => {
      const boundaries = new Set([0, length, ...(path.boundaries ?? [])]);
      const units = new Set((path.units ?? []).map(([s, e]) => `${s}:${e}`));
      const lexemes = new Map(Object.entries(path.lexemes ?? {}));
      return { boundaries, units, lexemes };
    });
  };

  const admittedOnPath = (candidate, path) => {
    const left = path.boundaries.has(candidate.start);
    const right = path.boundaries.has(candidate.end);
    const unit = `${candidate.start}:${candidate.end}`;
    let ok;
    switch (candidate.policy) {
      case "left_boundary": ok = left; break;
      case "right_boundary": ok = right; break;
      case "whole_lexeme": ok = path.units.has(unit); break;
      default: ok = left && right;
    }
    if (ok && candidate.lexicalIdentity) {
      ok = (path.lexemes.get(unit) ?? []).includes(candidate.lexicalIdentity);
    }
    return ok;
  };

  const gate = (candidate, paths) => {
    if (candidate.policy === "anywhere" && !candidate.lexicalIdentity) return { ok: true };
    if (!paths) {
      // Without lexical evidence only an explicit lexical identity is unverifiable; boundary
      // policies fall back to the accepted Phase-4.7 substring behaviour.
      return candidate.lexicalIdentity ? { ok: false, reason: "lexical_analysis_unavailable" } : { ok: true };
    }
    const results = paths.map((path) => admittedOnPath(candidate, path));
    if (results.every(Boolean)) return { ok: true };
    if (results.some(Boolean)) return { ok: false, reason: "ambiguous_lexical_boundary", ambiguous: true };
    return { ok: false, reason: candidate.lexicalIdentity && candidate.policy === "anywhere" ? "lexical_identity_mismatch" : "crosses_lexical_boundary" };
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
    const paths = normalizeLexical(input.lexical, length);
    const accepted = [];
    const blocked = [];
    const unresolved = [];

    const candidates = input.candidates.map((candidate) => ({
      ...candidate,
      policy: requirePolicy(candidate.policy ?? "anywhere", candidate.key)
    })).sort(candidateSort);

    const live = [];
    for (const candidate of candidates) {
      const verdict = gate(candidate, paths);
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
      if (entry.reason !== "ambiguous_lexical_boundary") continue;
      const { start, end } = entry.candidate;
      const overlapsAccepted = accepted.some((c) => c.start < end && c.end > start);
      const overlapsUnresolved = unresolved.some((u) => u.start < end && u.end > start);
      if (!overlapsAccepted && !overlapsUnresolved) unresolved.push({ start, end, reason: "ambiguous_lexical_boundary" });
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

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.ProductiveRelationRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PRODUCTIVE_MODES = new Set([
    "substring_productive",
    "character_productive"
  ]);

  const requireNonEmptyString = (value, label) => {
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError(`Invalid ${label}`);
    }
  };

  const codePoints = (value) => Array.from(`${value ?? ""}`);

  const compareText = (left, right) => (
    left < right ? -1 : left > right ? 1 : 0
  );

  const sameArray = (left, right) => (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );

  const relationBlockedReason = (relation) => {
    if (relation.channel !== "surface" && relation.channel !== "character_form") {
      return "channel_not_surface";
    }
    if (relation.relationKind === "candidates") return "ambiguous_relation";
    if (relation.applicationMode === "exact_lexeme") {
      return "exact_lexeme_not_productive";
    }
    if (relation.applicationMode === "contextual") return "context_required";
    if (relation.applicationMode === "generated_pattern") {
      return "delegated_generated_pattern";
    }
    if (relation.relationKind === "identity") return "identity_metadata_only";
    return "mode_not_productive";
  };

  const normalizeRelation = (raw) => {
    requireNonEmptyString(raw?.id, "normalized relation id");
    if (!Array.isArray(raw?.fromForms) || raw.fromForms.length === 0) {
      throw new TypeError(`Relation ${raw.id} requires fromForms`);
    }
    if (!Array.isArray(raw?.toForms) || raw.toForms.length === 0) {
      throw new TypeError(`Relation ${raw.id} requires toForms`);
    }

    const fromForms = [...new Set(raw.fromForms.map((value) => {
      requireNonEmptyString(value, `relation ${raw.id} from form`);
      return value;
    }))].sort(compareText);

    const toForms = [...new Set(raw.toForms.map((value) => {
      requireNonEmptyString(value, `relation ${raw.id} to form`);
      return value;
    }))].sort(compareText);

    const relation = {
      id: raw.id,
      relationKind: raw.relationKind,
      channel: raw.channel,
      applicationMode: raw.applicationMode,
      fromForms,
      toForms
    };

    if (PRODUCTIVE_MODES.has(relation.applicationMode)) {
      if (relation.relationKind === "candidates" || toForms.length !== 1) {
        throw new Error(`Ambiguous productive relation: ${relation.id}`);
      }
      if (relation.relationKind !== "mapping") {
        throw new TypeError(`Productive relation must be mapping: ${relation.id}`);
      }
      if (relation.channel !== "surface" && relation.channel !== "character_form") {
        throw new TypeError(`Productive relation must target surface text: ${relation.id}`);
      }
      if (relation.applicationMode === "character_productive") {
        for (const source of fromForms) {
          if (codePoints(source).length !== 1 || codePoints(toForms[0]).length !== 1) {
            throw new TypeError(
              `character_productive relation must be one code point: ${relation.id}`
            );
          }
        }
      }
    }

    if (relation.applicationMode === "preserve_block") {
      if (relation.relationKind !== "preserve") {
        throw new TypeError(`preserve_block relation must be preserve: ${relation.id}`);
      }
      for (const source of fromForms) {
        if (!toForms.includes(source)) {
          throw new TypeError(
            `preserve_block relation must preserve its source form: ${relation.id}`
          );
        }
      }
    }

    return relation;
  };

  const createProductiveRelationRuntime = (graph) => {
    if (
      graph?.schemaVersion !== "1" ||
      graph?.kind !== "normalized_orthography_graph" ||
      !Array.isArray(graph?.relations)
    ) {
      throw new TypeError("Unsupported normalized orthography graph");
    }

    const relationIds = new Set();
    const relations = graph.relations.map((raw) => {
      const relation = normalizeRelation(raw);
      if (relationIds.has(relation.id)) {
        throw new Error(`Duplicate normalized relation id: ${relation.id}`);
      }
      relationIds.add(relation.id);
      return relation;
    });

    const productiveBySource = new Map();
    const preserveBySource = new Map();
    const passiveMatches = [];

    const addProductive = (source, relation) => {
      const existing = productiveBySource.get(source);
      const target = relation.toForms[0];
      if (!existing) {
        productiveBySource.set(source, {
          source,
          target,
          mode: relation.applicationMode,
          ruleRefs: [relation.id]
        });
        return;
      }
      if (existing.target !== target || existing.mode !== relation.applicationMode) {
        throw new Error(
          `Conflicting productive relation for ${source}: ${existing.ruleRefs[0]} vs ${relation.id}`
        );
      }
      existing.ruleRefs.push(relation.id);
      existing.ruleRefs.sort(compareText);
    };

    const addPreserve = (source, relation) => {
      const existing = preserveBySource.get(source);
      if (!existing) {
        preserveBySource.set(source, {
          source,
          ruleRefs: [relation.id]
        });
        return;
      }
      existing.ruleRefs.push(relation.id);
      existing.ruleRefs.sort(compareText);
    };

    for (const relation of relations) {
      if (PRODUCTIVE_MODES.has(relation.applicationMode)) {
        for (const source of relation.fromForms) addProductive(source, relation);
        continue;
      }
      if (relation.applicationMode === "preserve_block") {
        for (const source of relation.fromForms) addPreserve(source, relation);
        continue;
      }
      for (const source of relation.fromForms) {
        passiveMatches.push({ source, relation });
      }
    }

    const productiveRules = [...productiveBySource.values()].sort((left, right) => (
      codePoints(right.source).length - codePoints(left.source).length ||
      compareText(left.source, right.source) ||
      compareText(left.ruleRefs[0], right.ruleRefs[0])
    ));
    const preserveRules = [...preserveBySource.values()].sort((left, right) => (
      codePoints(right.source).length - codePoints(left.source).length ||
      compareText(left.source, right.source)
    ));
    passiveMatches.sort((left, right) => (
      codePoints(right.source).length - codePoints(left.source).length ||
      compareText(left.source, right.source) ||
      compareText(left.relation.id, right.relation.id)
    ));

    const bucketByFirstCodePoint = (entries, sourceOf) => {
      const buckets = new Map();
      for (const entry of entries) {
        const first = codePoints(sourceOf(entry))[0];
        if (!first) continue;
        const bucket = buckets.get(first) ?? [];
        bucket.push(entry);
        buckets.set(first, bucket);
      }
      return buckets;
    };

    const productiveBuckets = bucketByFirstCodePoint(
      productiveRules,
      (rule) => rule.source
    );
    const preserveBuckets = bucketByFirstCodePoint(
      preserveRules,
      (rule) => rule.source
    );
    const passiveBuckets = bucketByFirstCodePoint(
      passiveMatches,
      (entry) => entry.source
    );

    const matchesSource = (inputPoints, start, source) => {
      const sourcePoints = codePoints(source);
      if (start + sourcePoints.length > inputPoints.length) return false;
      for (let offset = 0; offset < sourcePoints.length; offset += 1) {
        if (inputPoints[start + offset] !== sourcePoints[offset]) return false;
      }
      return true;
    };

    const matchingProductive = (inputPoints, start) => (
      (productiveBuckets.get(inputPoints[start]) ?? [])
        .filter((rule) => matchesSource(inputPoints, start, rule.source))
    );
    const matchingPreserve = (inputPoints, start) => (
      (preserveBuckets.get(inputPoints[start]) ?? [])
        .filter((rule) => matchesSource(inputPoints, start, rule.source))
    );
    const matchingPassive = (inputPoints, start) => (
      (passiveBuckets.get(inputPoints[start]) ?? [])
        .filter((entry) => matchesSource(inputPoints, start, entry.source))
    );

    const normalizeLockedSegments = (inputPoints, options) => {
      const source = Array.isArray(options?.lockedSegments)
        ? [...options.lockedSegments]
        : [];
      source.sort((left, right) => left.start - right.start || left.end - right.end);

      const normalized = [];
      let previousEnd = 0;
      for (const segment of source) {
        if (
          !Number.isInteger(segment?.start) ||
          !Number.isInteger(segment?.end) ||
          segment.start < 0 ||
          segment.end <= segment.start ||
          segment.end > inputPoints.length
        ) {
          throw new TypeError("Invalid locked segment range");
        }
        if (segment.start < previousEnd) {
          throw new Error("Locked segments must not overlap");
        }
        requireNonEmptyString(segment.outputText, "locked segment outputText");
        requireNonEmptyString(segment.basis, "locked segment basis");

        const actualSource = inputPoints.slice(segment.start, segment.end).join("");
        if (segment.sourceText != null && segment.sourceText !== actualSource) {
          throw new Error("Locked segment sourceText does not match input");
        }

        normalized.push({
          start: segment.start,
          end: segment.end,
          sourceText: actualSource,
          outputText: segment.outputText,
          basis: segment.basis,
          ruleRefs: Array.isArray(segment.ruleRefs)
            ? [...new Set(segment.ruleRefs)].sort(compareText)
            : []
        });
        previousEnd = segment.end;
      }
      return normalized;
    };

    const appendSegment = (segments, segment) => {
      const previous = segments.at(-1);
      if (
        previous &&
        previous.end === segment.start &&
        previous.basis === segment.basis &&
        sameArray(previous.ruleRefs, segment.ruleRefs)
      ) {
        previous.sourceText += segment.sourceText;
        previous.outputText += segment.outputText;
        previous.end = segment.end;
        return;
      }
      segments.push({ ...segment, ruleRefs: [...segment.ruleRefs] });
    };

    const addBlocked = (blockedRules, seen, ruleRef, start, end, reason) => {
      const key = `${ruleRef}\u0000${start}\u0000${end}\u0000${reason}`;
      if (seen.has(key)) return;
      seen.add(key);
      blockedRules.push({ ruleRef, start, end, reason });
    };

    const recordPassiveAt = (inputPoints, start, blockedRules, blockedSeen) => {
      for (const entry of matchingPassive(inputPoints, start)) {
        addBlocked(
          blockedRules,
          blockedSeen,
          entry.relation.id,
          start,
          start + codePoints(entry.source).length,
          relationBlockedReason(entry.relation)
        );
      }
    };

    const recordLockedBlocks = (
      inputPoints,
      locked,
      blockedRules,
      blockedSeen
    ) => {
      for (let index = locked.start; index < locked.end; index += 1) {
        for (const rule of matchingProductive(inputPoints, index)) {
          const end = index + codePoints(rule.source).length;
          if (end <= locked.end) {
            for (const ruleRef of rule.ruleRefs) {
              addBlocked(
                blockedRules,
                blockedSeen,
                ruleRef,
                index,
                end,
                "upstream_locked_segment"
              );
            }
          }
        }
        for (const rule of matchingPreserve(inputPoints, index)) {
          const end = index + codePoints(rule.source).length;
          if (end <= locked.end) {
            for (const ruleRef of rule.ruleRefs) {
              addBlocked(
                blockedRules,
                blockedSeen,
                ruleRef,
                index,
                end,
                "upstream_locked_segment"
              );
            }
          }
        }
        for (const entry of matchingPassive(inputPoints, index)) {
          const end = index + codePoints(entry.source).length;
          if (end <= locked.end) {
            addBlocked(
              blockedRules,
              blockedSeen,
              entry.relation.id,
              index,
              end,
              "upstream_locked_segment"
            );
          }
        }
      }
    };

    const recordPreserveBlocks = (
      inputPoints,
      start,
      end,
      blockedRules,
      blockedSeen
    ) => {
      for (let index = start; index < end; index += 1) {
        for (const rule of matchingProductive(inputPoints, index)) {
          const ruleEnd = index + codePoints(rule.source).length;
          if (ruleEnd <= end) {
            for (const ruleRef of rule.ruleRefs) {
              addBlocked(
                blockedRules,
                blockedSeen,
                ruleRef,
                index,
                ruleEnd,
                "preserve_block"
              );
            }
          }
        }
      }
    };

    const transform = (value, options = {}) => {
      const input = `${value ?? ""}`;
      const inputPoints = codePoints(input);
      const lockedSegments = normalizeLockedSegments(inputPoints, options);
      const lockedByStart = new Map(lockedSegments.map((segment) => [
        segment.start,
        segment
      ]));
      const segments = [];
      const blockedRules = [];
      const blockedSeen = new Set();
      let index = 0;

      while (index < inputPoints.length) {
        const locked = lockedByStart.get(index);
        if (locked) {
          recordLockedBlocks(inputPoints, locked, blockedRules, blockedSeen);
          appendSegment(segments, {
            sourceText: locked.sourceText,
            outputText: locked.outputText,
            start: locked.start,
            end: locked.end,
            basis: locked.basis,
            ruleRefs: locked.ruleRefs
          });
          index = locked.end;
          continue;
        }

        const preserveMatches = matchingPreserve(inputPoints, index);
        if (preserveMatches.length > 0) {
          const selected = preserveMatches[0];
          const selectedEnd = index + codePoints(selected.source).length;

          recordPreserveBlocks(
            inputPoints,
            index,
            selectedEnd,
            blockedRules,
            blockedSeen
          );
          recordPassiveAt(inputPoints, index, blockedRules, blockedSeen);

          appendSegment(segments, {
            sourceText: selected.source,
            outputText: selected.source,
            start: index,
            end: selectedEnd,
            basis: "preserve_exact",
            ruleRefs: selected.ruleRefs
          });
          index = selectedEnd;
          continue;
        }

        const productiveMatches = matchingProductive(inputPoints, index);
        if (productiveMatches.length > 0) {
          const selected = productiveMatches[0];
          const selectedLength = codePoints(selected.source).length;
          const selectedEnd = index + selectedLength;

          for (const shadowed of productiveMatches.slice(1)) {
            for (const ruleRef of shadowed.ruleRefs) {
              addBlocked(
                blockedRules,
                blockedSeen,
                ruleRef,
                index,
                index + codePoints(shadowed.source).length,
                "shadowed_by_longer_match"
              );
            }
          }
          recordPassiveAt(inputPoints, index, blockedRules, blockedSeen);

          appendSegment(segments, {
            sourceText: selected.source,
            outputText: selected.target,
            start: index,
            end: selectedEnd,
            basis: selected.mode === "character_productive"
              ? "generated_character"
              : "generated_productive_span",
            ruleRefs: selected.ruleRefs
          });
          index = selectedEnd;
          continue;
        }

        recordPassiveAt(inputPoints, index, blockedRules, blockedSeen);
        appendSegment(segments, {
          sourceText: inputPoints[index],
          outputText: inputPoints[index],
          start: index,
          end: index + 1,
          basis: "implicit_identity",
          ruleRefs: []
        });
        index += 1;
      }

      return {
        input,
        output: segments.map((segment) => segment.outputText).join(""),
        segments,
        blockedRules
      };
    };

    return Object.freeze({
      transform
    });
  };

  return {
    createProductiveRelationRuntime
  };
});

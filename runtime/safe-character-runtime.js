(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SafeCharacterRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const requireNonEmptyString = (value, label) => {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(`Invalid ${label}`);
    }
  };

  const requireOneCodePoint = (value, label) => {
    requireNonEmptyString(value, label);
    if (Array.from(value).length !== 1) {
      throw new TypeError(`${label} must be one code point`);
    }
  };

  const createSafeCharacterRuntime = (slice) => {
    if (slice?.schemaVersion !== "1" || slice?.kind !== "japanese-orthography-safe-character-slice") {
      throw new TypeError("Unsupported safe-character slice");
    }

    const sourceIds = new Set();
    for (const source of Array.isArray(slice.sources) ? slice.sources : []) {
      requireNonEmptyString(source?.id, "safe-character source id");
      sourceIds.add(source.id);
    }

    const evidenceIds = new Set();
    for (const evidence of Array.isArray(slice.evidenceRecords) ? slice.evidenceRecords : []) {
      requireNonEmptyString(evidence?.id, "safe-character evidence id");
      requireNonEmptyString(evidence?.sourceRef, "safe-character evidence source ref");
      if (!sourceIds.has(evidence.sourceRef)) {
        throw new Error(`Unknown safe-character source ref: ${evidence.sourceRef}`);
      }
      evidenceIds.add(evidence.id);
    }

    const excluded = new Set();
    for (const modern of Array.isArray(slice.excludedModernCharacters) ? slice.excludedModernCharacters : []) {
      requireOneCodePoint(modern, "safe-character excluded modern character");
      excluded.add(modern);
    }

    const map = {};
    const seenModern = new Set();
    for (const mapping of Array.isArray(slice.mappings) ? slice.mappings : []) {
      requireOneCodePoint(mapping?.modern, "safe-character modern source");
      requireOneCodePoint(mapping?.historical, "safe-character historical target");
      if (excluded.has(mapping.modern)) {
        throw new Error(`Modern character ${mapping.modern} is excluded from unconditional safe-character mapping`);
      }
      if (seenModern.has(mapping.modern)) {
        throw new Error(`Duplicate safe-character modern source: ${mapping.modern}`);
      }
      seenModern.add(mapping.modern);
      if (!Array.isArray(mapping.evidenceRefs) || mapping.evidenceRefs.length === 0) {
        throw new TypeError("Safe-character mapping requires evidence refs");
      }
      for (const evidenceRef of mapping.evidenceRefs) {
        requireNonEmptyString(evidenceRef, "safe-character evidence ref");
        if (!evidenceIds.has(evidenceRef)) {
          throw new Error(`Unknown safe-character evidence ref: ${evidenceRef}`);
        }
      }
      map[mapping.modern] = mapping.historical;
    }

    const characterMap = Object.freeze({ ...map });
    const apply = (value) => Array.from(`${value ?? ""}`).map((char) => (
      Object.prototype.hasOwnProperty.call(characterMap, char) ? characterMap[char] : char
    )).join("");

    return { characterMap, apply };
  };

  return { createSafeCharacterRuntime };
});

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.HistoricalSinoRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const requireNonEmptyString = (value, label) => {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(`Invalid ${label}`);
    }
  };

  const requireGitSha = (value, label) => {
    if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
      throw new TypeError(`Invalid ${label}`);
    }
  };

  const validateSource = (source) => {
    requireNonEmptyString(source?.repository, "historical Sino source repository");
    requireGitSha(source?.commit, "historical Sino source commit SHA");
    requireNonEmptyString(source?.license, "historical Sino source license");
    requireNonEmptyString(source?.status, "historical Sino source status");
    if (!Array.isArray(source?.files) || source.files.length === 0) {
      throw new TypeError("Historical Sino source requires files");
    }
    for (const file of source.files) {
      requireNonEmptyString(file?.path, "historical Sino source file path");
      requireGitSha(file?.blobSha, "historical Sino source file blob SHA");
    }
  };

  const buildEvidenceIndex = (slice) => {
    const sourceFiles = new Set(slice.source.files.map((file) => file.path));
    if (!Array.isArray(slice.sourceRecords) || slice.sourceRecords.length === 0) {
      throw new TypeError("Historical Sino slice requires source records");
    }

    const evidenceIds = new Set();
    const addId = (record, label) => {
      requireNonEmptyString(record?.id, label);
      if (evidenceIds.has(record.id)) {
        throw new Error(`Duplicate historical Sino evidence id: ${record.id}`);
      }
      evidenceIds.add(record.id);
    };

    for (const record of slice.sourceRecords) {
      addId(record, "historical Sino source record id");
      requireNonEmptyString(record?.file, "historical Sino source record file");
      if (!sourceFiles.has(record.file)) {
        throw new Error(`Unknown historical Sino source record file: ${record.file}`);
      }
    }

    for (const record of Array.isArray(slice.projectEvidenceRecords) ? slice.projectEvidenceRecords : []) {
      addId(record, "historical Sino project evidence id");
    }

    return evidenceIds;
  };

  const normalizeEvidenceRefs = (value, evidenceIds, label) => {
    if (!Array.isArray(value) || value.length === 0) {
      throw new TypeError(`${label} requires evidence refs`);
    }
    const refs = [];
    for (const ref of value) {
      requireNonEmptyString(ref, `${label} evidence ref`);
      if (!evidenceIds.has(ref)) {
        throw new Error(`Unknown historical Sino evidence ref: ${ref}`);
      }
      if (!refs.includes(ref)) {
        refs.push(ref);
      }
    }
    return refs;
  };

  const normalizeComponent = (component, evidenceIds) => {
    requireNonEmptyString(component?.surface, "historical Sino component surface");
    requireNonEmptyString(component?.modernReading, "historical Sino component modern reading");
    requireNonEmptyString(component?.historicalReading, "historical Sino component historical reading");
    return {
      lexicalIdentity: null,
      surface: component.surface,
      lexicalReading: component.modernReading,
      lexicalOrigin: "sino",
      readingClass: component.readingClass ?? "on",
      historicalKana: component.historicalReading,
      evidenceRefs: normalizeEvidenceRefs(component.evidenceRefs, evidenceIds, "Historical Sino component")
    };
  };

  const normalizeRelation = (relation, evidenceIds) => {
    requireNonEmptyString(relation?.lexicalIdentity, "historical Sino lexical identity");
    requireNonEmptyString(relation?.surface, "historical Sino surface");
    requireNonEmptyString(relation?.modernReading, "historical Sino modern reading");
    requireNonEmptyString(relation?.historicalReading, "historical Sino historical reading");
    return {
      route: "sino",
      reading: relation.historicalReading,
      surface: relation.surface,
      components: Array.isArray(relation.components)
        ? relation.components.map((component) => normalizeComponent(component, evidenceIds))
        : [],
      evidenceRefs: normalizeEvidenceRefs(relation.evidenceRefs, evidenceIds, "Historical Sino relation")
    };
  };

  const createLegacyRuntime = (slice, options = {}) => {
    requireNonEmptyString(slice.lexicalNamespaceId, "historical Sino lexical namespace");
    validateSource(slice.source);
    const evidenceIds = buildEvidenceIndex(slice);
    const expectedNamespace = options.lexicalNamespaceId ?? slice.lexicalNamespaceId;
    if (slice.lexicalNamespaceId !== expectedNamespace) {
      throw new Error("Historical Sino lexical namespace mismatch");
    }

    const relationByIdentity = new Map();
    for (const relation of Array.isArray(slice.relations) ? slice.relations : []) {
      if (relationByIdentity.has(relation?.lexicalIdentity)) {
        throw new Error(`Duplicate historical Sino relation: ${relation.lexicalIdentity}`);
      }
      relationByIdentity.set(relation.lexicalIdentity, normalizeRelation(relation, evidenceIds));
    }

    const lookup = (candidate) => {
      if (candidate?.lexicalOrigin !== "sino") {
        return null;
      }
      requireNonEmptyString(candidate?.lexicalIdentity, "candidate lexical identity");
      return relationByIdentity.get(candidate.lexicalIdentity) ?? null;
    };

    return {
      lexicalNamespaceId: slice.lexicalNamespaceId,
      source: slice.source,
      lookup
    };
  };


  // --- Phase 4.6E: 字音 table component relations and word-level reconstruction ---

  const VOICED = {
    "か": "が", "き": "ぎ", "く": "ぐ", "け": "げ", "こ": "ご",
    "さ": "ざ", "し": "じ", "す": "ず", "せ": "ぜ", "そ": "ぞ",
    "た": "だ", "ち": "ぢ", "つ": "づ", "て": "で", "と": "ど",
    "は": "ば", "ひ": "び", "ふ": "ぶ", "へ": "べ", "ほ": "ぼ"
  };
  const SEMI_VOICED = { "は": "ぱ", "ひ": "ぴ", "ふ": "ぷ", "へ": "ぺ", "ほ": "ぽ" };
  // Modern spelling of the historical prefix left when a ふ-final reading is geminated.
  const MODERNIZE = { "ゐ": "い", "ゑ": "え", "を": "お", "ぢ": "じ", "づ": "ず" };
  const GEMINATING_CODAS = ["く", "き", "ち", "つ"];
  // (C)(y/w)V plus an optional coda: the shape of one Sino-Japanese syllable.
  const SINO_SYLLABLE = /^[ぁ-ゔ](?:[ゃゅょゎ])?(?:[いうくきちつんっ])?$/u;
  const HAN = /^\p{Script=Han}$/u;
  const MAX_RESULTS = 64;

  const modernize = (value) => Array.from(value, (char) => MODERNIZE[char] ?? char).join("").replace(/^くゎ/u, "か").replace(/^ぐゎ/u, "が");

  // Every modern surface form a table relation can take inside a word, with its historical spelling.
  const relationForms = (modern, historical) => {
    const base = [[modern, historical]];
    if (GEMINATING_CODAS.includes(modern.slice(-1))) {
      base.push([`${modern.slice(0, -1)}っ`, historical]);
    }
    if (historical.endsWith("ふ")) {
      const stem = historical.slice(0, -1);
      base.push([`${modernize(stem)}っ`, `${stem}っ`]);
    }
    const forms = [...base];
    for (const [m, h] of base) {
      for (const table of [VOICED, SEMI_VOICED]) {
        const m0 = m[0];
        const h0 = h[0];
        if (table[m0] && table[h0]) forms.push([table[m0] + m.slice(1), table[h0] + h.slice(1)]);
      }
    }
    return forms;
  };

  /**
   * Accepted Phase-4.6E component reconstruction over (character, modern reading, context) ->
   * historical readings relations. Shared by the v2 runtime and the browser resolver adapter
   * (#196 F), so both reconstruct Sino readings with the same code.
   */
  const createSinoComponentReconstructor = (componentRelations) => {
    if (!Array.isArray(componentRelations) || componentRelations.length === 0) {
      throw new TypeError("Historical Sino artifact requires component relations");
    }

    const relationsByCharacter = new Map();
    const formsByCharacter = new Map();
    const tableFormsByCharacter = new Map();
    for (const relation of componentRelations) {
      requireNonEmptyString(relation?.character, "historical Sino component character");
      requireNonEmptyString(relation?.modernReading, "historical Sino component modern reading");
      if (!Array.isArray(relation?.historicalReadings) || relation.historicalReadings.length === 0) {
        throw new TypeError("Historical Sino component requires historical readings");
      }
      if (!Array.isArray(relation?.evidenceRefs) || relation.evidenceRefs.length === 0) {
        throw new TypeError("Historical Sino component requires evidence refs");
      }
      const list = relationsByCharacter.get(relation.character) ?? [];
      list.push(relation);
      relationsByCharacter.set(relation.character, list);
      const forms = formsByCharacter.get(relation.character) ?? [];
      for (const historical of relation.historicalReadings) {
        for (const [modernForm, historicalForm] of relationForms(relation.modernReading, historical)) {
          forms.push({
            modernForm,
            historicalForm,
            context: relation.context ?? null,
            evidenceRefs: relation.evidenceRefs
          });
          const formsForCharacter = tableFormsByCharacter.get(relation.character) ?? new Set();
          formsForCharacter.add(modernForm);
          tableFormsByCharacter.set(relation.character, formsForCharacter);
        }
      }
      formsByCharacter.set(relation.character, forms);
    }

    const uniqueSorted = (values) => [...new Set(values)].sort();

    // Direct component contract: (character, modern reading, optional context) -> table reading(s).
    // `context` omitted: every usage; `context: null`: only the unqualified table entries.
    const resolveHistoricalSino = (query = {}) => {
      const { character, modernReading } = query;
      const hasContext = Object.prototype.hasOwnProperty.call(query, "context") && query.context !== undefined;
      const relations = (relationsByCharacter.get(`${character ?? ""}`.normalize("NFC")) ?? [])
        .filter((relation) => relation.modernReading === modernReading)
        .filter((relation) => !hasContext || (relation.context ?? null) === query.context);
      const readings = uniqueSorted(relations.flatMap((relation) => relation.historicalReadings));
      if (readings.length === 0) return null;
      if (readings.length > 1) return { status: "candidates", historicalReadings: readings };
      return {
        status: "resolved",
        historicalReading: readings[0],
        evidenceRefs: uniqueSorted(relations.flatMap((relation) => relation.evidenceRefs))
      };
    };

    // Options for one character covering one reading segment. Sounds the table does not list
    // keep modern spelling (source rule), except geminated codas whose base reading is unknown.
    const segmentOptions = (character, segment, contextOptions = {}) => {
      if (!SINO_SYLLABLE.test(segment)) return [];
      const allMatches = (formsByCharacter.get(character) ?? []).filter((form) => form.modernForm === segment);
      let matches = allMatches;
      const hasContext = Object.prototype.hasOwnProperty.call(contextOptions, "context")
        && contextOptions.context !== undefined;
      if (hasContext && allMatches.length > 0) {
        const context = contextOptions.context ?? null;
        const exactContext = allMatches.filter((form) => form.context === context);
        if (exactContext.length > 0) {
          matches = exactContext;
        } else if (allMatches.some((form) => form.context !== null)) {
          return [];
        } else {
          matches = allMatches.filter((form) => form.context === null);
        }
      }
      if (matches.length > 0) {
        return matches.map((form) => ({
          historical: form.historicalForm,
          context: form.context,
          evidenceRefs: form.evidenceRefs
        }));
      }
      if (tableFormsByCharacter.get(character)?.has(segment) || segment.endsWith("っ")) return [];
      return [{ historical: segment, context: null, evidenceRefs: [] }];
    };

    const reconstructWord = (surface, modernReading, contextOptions = {}) => {
      const characters = Array.from(`${surface ?? ""}`.normalize("NFC"));
      const reading = `${modernReading ?? ""}`;
      if (characters.length === 0 || reading === "" || !characters.every((char) => HAN.test(char))) return null;
      const hasContext = Object.prototype.hasOwnProperty.call(contextOptions, "context")
        && contextOptions.context !== undefined;
      const selectionContext = hasContext ? (contextOptions.context ?? null) : undefined;

      const results = new Map();
      let overflow = false;
      const walk = (charIndex, offset, parts, components) => {
        if (overflow) return;
        if (charIndex === characters.length) {
          if (offset !== reading.length) return;
          const historical = parts.join("");
          if (!results.has(historical)) results.set(historical, components);
          if (results.size > MAX_RESULTS) overflow = true;
          return;
        }
        for (let end = offset + 1; end <= Math.min(reading.length, offset + 4); end += 1) {
          const segment = reading.slice(offset, end);
          for (const option of segmentOptions(characters[charIndex], segment, contextOptions)) {
            walk(charIndex + 1, end, [...parts, option.historical], [...components, {
              surface: characters[charIndex], modernReading: segment, historicalReading: option.historical,
              context: option.context,
              evidenceRefs: option.evidenceRefs
            }]);
          }
        }
      };
      walk(0, 0, [], []);

      if (overflow || results.size === 0) return null;
      // A run of reading material with no table evidence is an opaque block, not ownership
      // evidence for each character at the current traversal position (#234). Coalesce it before
      // rendering so a traversal fallback cannot manufacture Ruby such as 本《ほ》企《んき》.
      const coalesceOpaque = (components) => {
        const merged = [];
        for (const component of components) {
          const opaque = !Array.isArray(component.evidenceRefs) || component.evidenceRefs.length === 0;
          const previous = merged[merged.length - 1];
          if (opaque && previous && previous.evidenceRefs.length === 0) {
            previous.surface += component.surface;
            previous.modernReading += component.modernReading;
            previous.historicalReading += component.historicalReading;
          } else {
            merged.push({ ...component, evidenceRefs: [...(component.evidenceRefs ?? [])] });
          }
        }
        return merged;
      };
      const evidencedResults = [...results.entries()].map(([historical, components]) => [historical, coalesceOpaque(components)]);
      const readings = evidencedResults.map(([historical]) => historical).sort();
      if (readings.length > 1) return { status: "candidates", historicalReadings: readings };
      const components = evidencedResults.find(([historical]) => historical === readings[0])[1];
      const resolved = {
        status: "resolved",
        historicalReading: readings[0],
        components,
        evidenceRefs: uniqueSorted(components.flatMap((component) => component.evidenceRefs))
      };
      if (hasContext) resolved.selectionContext = selectionContext;
      return resolved;
    };

    return { resolveHistoricalSino, reconstructWord };
  };

  const createV2Runtime = (artifact, options = {}) => {
    const identity = createLegacyRuntime(artifact.identitySlice, options);
    if (artifact.lexicalNamespaceId !== identity.lexicalNamespaceId) {
      throw new Error("Historical Sino lexical namespace mismatch");
    }
    if (!Array.isArray(artifact.componentRelations) || artifact.componentRelations.length === 0) {
      throw new TypeError("Historical Sino artifact requires component relations");
    }
    const { resolveHistoricalSino, reconstructWord } = createSinoComponentReconstructor(artifact.componentRelations);

    const lookup = (candidate, surface) => {
      const relation = identity.lookup(candidate);
      if (relation || candidate?.lexicalOrigin !== "sino" || typeof surface !== "string") return relation;
      const usageContext = typeof candidate?.morphology?.usage === "string"
        ? candidate.morphology.usage
        : (typeof candidate?.context?.usage === "string" ? candidate.context.usage : undefined);
      const reconstructed = reconstructWord(
        surface,
        candidate.reading,
        usageContext === undefined ? {} : { context: usageContext }
      );
      if (!reconstructed) return null;
      if (reconstructed.status === "candidates") {
        return { status: "candidates", route: "sino", readings: reconstructed.historicalReadings, evidenceRefs: [] };
      }
      const resolved = {
        route: "sino",
        reading: reconstructed.historicalReading,
        surface,
        components: reconstructed.components.map((component) => ({
          lexicalIdentity: null,
          surface: component.surface,
          lexicalReading: component.modernReading,
          lexicalOrigin: "sino",
          readingClass: "on",
          historicalKana: component.historicalReading,
          evidenceRefs: component.evidenceRefs
        })),
        evidenceRefs: reconstructed.evidenceRefs
      };
      if (reconstructed.selectionContext !== undefined) {
        resolved.selectionContext = reconstructed.selectionContext;
      }
      return resolved;
    };

    return {
      lexicalNamespaceId: identity.lexicalNamespaceId,
      source: identity.source,
      sources: artifact.sources,
      lookup,
      resolveHistoricalSino,
      reconstructWord
    };
  };

  const createHistoricalSinoRuntime = (document, options = {}) => {
    if (document?.schemaVersion === "1" && document?.kind === "japanese-orthography-historical-sino-slice") {
      return createLegacyRuntime(document, options);
    }
    if (document?.schemaVersion === "2" && document?.kind === "japanese-orthography-historical-sino-artifact") {
      return createV2Runtime(document, options);
    }
    throw new TypeError("Unsupported historical Sino slice");
  };

  return { createHistoricalSinoRuntime, createSinoComponentReconstructor };
});

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.HistoricalNativeRuntime = api;
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

  const canonicalStrings = (values) => [...new Set(values ?? [])].sort();

  const requireEvidenceRefs = (value) => {
    if (!Array.isArray(value) || value.length === 0) {
      throw new TypeError("Historical native relation requires evidence refs");
    }
    value.forEach(ref => requireNonEmptyString(ref, "historical native evidence ref"));
    return canonicalStrings(value);
  };

  const morphologyMatches = (required, actual) => {
    if (!required) return true;
    if (!actual) return false;
    if (required.conjugationType && required.conjugationType !== actual.conjugationType) return false;
    if (required.conjugationForm && required.conjugationForm !== actual.conjugationForm) return false;
    return true;
  };

  const validateLegacySource = (source) => {
    requireNonEmptyString(source?.repository, "historical native source repository");
    requireGitSha(source?.commit, "historical native source commit SHA");
    requireNonEmptyString(source?.license, "historical native source license");
    requireNonEmptyString(source?.status, "historical native source status");
    if (!Array.isArray(source?.files) || source.files.length === 0) {
      throw new TypeError("Historical native source requires files");
    }
    for (const file of source.files) {
      requireNonEmptyString(file?.path, "historical native source file path");
      requireGitSha(file?.blobSha, "historical native source file blob SHA");
    }
  };

  const buildLegacyEvidenceIndex = (slice) => {
    const sourceFiles = new Set(slice.source.files.map((file) => file.path));
    if (!Array.isArray(slice.sourceRecords) || slice.sourceRecords.length === 0) {
      throw new TypeError("Historical native slice requires source records");
    }
    const evidenceIds = new Set();
    for (const record of slice.sourceRecords) {
      requireNonEmptyString(record?.id, "historical native source record id");
      if (evidenceIds.has(record.id)) {
        throw new Error(`Duplicate historical native evidence id: ${record.id}`);
      }
      evidenceIds.add(record.id);
      requireNonEmptyString(record?.file, "historical native source record file");
      if (!sourceFiles.has(record.file)) {
        throw new Error(`Unknown historical native source record file: ${record.file}`);
      }
    }
    return evidenceIds;
  };

  const normalizeLegacyEvidenceRefs = (value, evidenceIds) => {
    const refs = requireEvidenceRefs(value);
    for (const ref of refs) {
      if (!evidenceIds.has(ref)) {
        throw new Error(`Unknown historical native evidence ref: ${ref}`);
      }
    }
    return refs;
  };

  const buildIdentityIndex = (relations, normalizeEvidence) => {
    const relationByIdentity = new Map();
    for (const relation of Array.isArray(relations) ? relations : []) {
      requireNonEmptyString(relation?.lexicalIdentity, "historical native lexical identity");
      requireNonEmptyString(relation?.surface, "historical native surface");
      requireNonEmptyString(relation?.historicalSurface, "historical native historical surface");
      if (relationByIdentity.has(relation.lexicalIdentity)) {
        throw new Error(`Duplicate historical native relation: ${relation.lexicalIdentity}`);
      }
      relationByIdentity.set(relation.lexicalIdentity, {
        route: "native",
        reading: null,
        surface: relation.historicalSurface,
        requiresMorphology: Boolean(relation.requiredMorphology),
        requiredMorphology: relation.requiredMorphology ?? null,
        evidenceRefs: normalizeEvidence(relation.evidenceRefs),
        sourceRefs: canonicalStrings(relation.sourceRefs ?? [])
      });
    }
    return relationByIdentity;
  };

  const createIdentityLookup = (relationByIdentity) => (candidate) => {
    if (candidate?.lexicalOrigin !== "native") return null;
    if (typeof candidate?.lexicalIdentity !== "string" || candidate.lexicalIdentity.trim() === "") {
      return null;
    }
    const relation = relationByIdentity.get(candidate.lexicalIdentity) ?? null;
    if (!relation) return null;
    if (!morphologyMatches(relation.requiredMorphology, candidate.morphology)) return null;
    return relation;
  };

  const createLegacyRuntime = (slice, options) => {
    requireNonEmptyString(slice.lexicalNamespaceId, "historical native lexical namespace");
    validateLegacySource(slice.source);
    const evidenceIds = buildLegacyEvidenceIndex(slice);
    const expectedNamespace = options.lexicalNamespaceId ?? slice.lexicalNamespaceId;
    if (slice.lexicalNamespaceId !== expectedNamespace) {
      throw new Error("Historical native lexical namespace mismatch");
    }

    const relationByIdentity = buildIdentityIndex(
      slice.relations,
      refs => normalizeLegacyEvidenceRefs(refs, evidenceIds)
    );

    return {
      lexicalNamespaceId: slice.lexicalNamespaceId,
      source: slice.source,
      sources: [slice.source],
      lookup: createIdentityLookup(relationByIdentity),
      lookupSurface() {
        return null;
      }
    };
  };

  const validateV2Sources = (sources) => {
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new TypeError("Historical native v2 artifact requires sources");
    }
    const ids = new Set();
    for (const source of sources) {
      requireNonEmptyString(source?.sourceId, "historical native source id");
      requireNonEmptyString(source?.path, "historical native source path");
      if (ids.has(source.sourceId)) {
        throw new Error(`Duplicate historical native source id: ${source.sourceId}`);
      }
      ids.add(source.sourceId);
      if (source.commit !== undefined) requireGitSha(source.commit, "historical native source commit SHA");
      if (source.blobSha !== undefined) requireGitSha(source.blobSha, "historical native source blob SHA");
    }
    return ids;
  };

  const validateSourceRefs = (value, sourceIds) => {
    if (!Array.isArray(value)) return [];
    const refs = canonicalStrings(value);
    for (const ref of refs) {
      requireNonEmptyString(ref, "historical native source ref");
      if (!sourceIds.has(ref)) {
        throw new Error(`Unknown historical native source ref: ${ref}`);
      }
    }
    return refs;
  };

  const buildExactIndex = (relations, targetKey, sourceIds) => {
    const index = new Map();
    for (const relation of Array.isArray(relations) ? relations : []) {
      requireNonEmptyString(relation?.surface, "historical native exact surface");
      requireNonEmptyString(relation?.[targetKey], `historical native ${targetKey}`);
      if (index.has(relation.surface)) {
        throw new Error(`Duplicate historical native exact relation: ${relation.surface}`);
      }
      index.set(relation.surface, {
        target: relation[targetKey],
        evidenceRefs: requireEvidenceRefs(relation.evidenceRefs),
        sourceRefs: validateSourceRefs(relation.sourceRefs, sourceIds)
      });
    }
    return index;
  };

  const buildCandidateIndex = (relations, sourceIds) => {
    const index = new Map();
    for (const relation of Array.isArray(relations) ? relations : []) {
      requireNonEmptyString(relation?.surface, "historical native candidate surface");
      if (!Array.isArray(relation?.alternatives) || relation.alternatives.length < 2) {
        throw new TypeError("Historical native candidate requires at least two alternatives");
      }
      if (index.has(relation.surface)) {
        throw new Error(`Duplicate historical native candidate relation: ${relation.surface}`);
      }
      index.set(relation.surface, {
        alternatives: canonicalStrings(relation.alternatives),
        evidenceRefs: requireEvidenceRefs(relation.evidenceRefs),
        sourceRefs: validateSourceRefs(relation.sourceRefs, sourceIds)
      });
    }
    return index;
  };

  const mergeRefs = (...collections) => canonicalStrings(collections.flatMap(value => value ?? []));

  const createV2Runtime = (artifact, options) => {
    requireNonEmptyString(artifact.lexicalNamespaceId, "historical native lexical namespace");
    const expectedNamespace = options.lexicalNamespaceId ?? artifact.lexicalNamespaceId;
    if (artifact.lexicalNamespaceId !== expectedNamespace) {
      throw new Error("Historical native lexical namespace mismatch");
    }

    const sourceIds = validateV2Sources(artifact.sources);
    const relationByIdentity = buildIdentityIndex(
      artifact.identityRelations,
      refs => requireEvidenceRefs(refs)
    );
    const surfaceIndex = buildExactIndex(artifact.surfaceRelations, "historicalSurface", sourceIds);
    const readingIndex = buildExactIndex(artifact.readingRelations, "historicalReading", sourceIds);
    const surfaceCandidates = buildCandidateIndex(artifact.ambiguousSurfaceCandidates, sourceIds);
    const readingCandidates = buildCandidateIndex(artifact.ambiguousReadingCandidates, sourceIds);

    const lookupSurface = (surface) => {
      if (typeof surface !== "string" || surface === "") return null;
      const exactSurface = surfaceIndex.get(surface) ?? null;
      const exactReading = readingIndex.get(surface) ?? null;
      const surfaceCandidate = surfaceCandidates.get(surface) ?? null;
      const readingCandidate = readingCandidates.get(surface) ?? null;

      if (surfaceCandidate || readingCandidate) {
        return {
          status: "candidates",
          route: "native",
          surface,
          reading: exactReading?.target ?? null,
          surfaceCandidates: surfaceCandidate?.alternatives ?? [],
          readingCandidates: readingCandidate?.alternatives ?? [],
          evidenceRefs: mergeRefs(
            exactSurface?.evidenceRefs,
            exactReading?.evidenceRefs,
            surfaceCandidate?.evidenceRefs,
            readingCandidate?.evidenceRefs
          ),
          sourceRefs: mergeRefs(
            exactSurface?.sourceRefs,
            exactReading?.sourceRefs,
            surfaceCandidate?.sourceRefs,
            readingCandidate?.sourceRefs
          )
        };
      }

      if (!exactSurface && !exactReading) return null;
      return {
        status: "resolved",
        route: "native",
        surface: exactSurface?.target ?? surface,
        reading: exactReading?.target ?? null,
        requiresMorphology: false,
        requiredMorphology: null,
        evidenceRefs: mergeRefs(exactSurface?.evidenceRefs, exactReading?.evidenceRefs),
        sourceRefs: mergeRefs(exactSurface?.sourceRefs, exactReading?.sourceRefs)
      };
    };

    return {
      lexicalNamespaceId: artifact.lexicalNamespaceId,
      source: null,
      sources: artifact.sources,
      lookup: createIdentityLookup(relationByIdentity),
      lookupSurface
    };
  };

  const createHistoricalNativeRuntime = (document, options = {}) => {
    if (
      document?.schemaVersion === "1" &&
      document?.kind === "japanese-orthography-historical-native-slice"
    ) {
      return createLegacyRuntime(document, options);
    }
    if (
      document?.schemaVersion === "2" &&
      document?.kind === "japanese-orthography-historical-native-artifact"
    ) {
      return createV2Runtime(document, options);
    }
    throw new TypeError("Unsupported historical native slice");
  };

  return { createHistoricalNativeRuntime };
});

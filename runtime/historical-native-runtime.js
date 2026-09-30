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

  const uniqueStrings = (value, label) => {
    if (!Array.isArray(value) || value.length === 0) {
      throw new TypeError(`Invalid ${label}`);
    }
    const output = [];
    for (const item of value) {
      requireNonEmptyString(item, label);
      if (!output.includes(item)) output.push(item);
    }
    return output;
  };

  const morphologyMatches = (required, actual) => {
    if (!required) return true;
    if (!actual) return false;
    if (required.conjugationType && required.conjugationType !== actual.conjugationType) return false;
    if (required.conjugationForm && required.conjugationForm !== actual.conjugationForm) return false;
    return true;
  };

  const validateV1Source = (source) => {
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

  const buildV1EvidenceIndex = (slice) => {
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

  const normalizeV1EvidenceRefs = (value, evidenceIds) => {
    const refs = uniqueStrings(value, "historical native evidence ref");
    for (const ref of refs) {
      if (!evidenceIds.has(ref)) {
        throw new Error(`Unknown historical native evidence ref: ${ref}`);
      }
    }
    return refs;
  };

  const buildIdentityIndex = (relations, normalizeEvidenceRefs) => {
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
        evidenceRefs: normalizeEvidenceRefs(relation.evidenceRefs)
      });
    }
    return relationByIdentity;
  };

  const createIdentityLookup = (relationByIdentity) => (candidate) => {
    if (candidate?.lexicalOrigin !== "native") return null;
    requireNonEmptyString(candidate?.lexicalIdentity, "candidate lexical identity");
    const relation = relationByIdentity.get(candidate.lexicalIdentity) ?? null;
    if (!relation) return null;
    if (!morphologyMatches(relation.requiredMorphology, candidate.morphology)) return null;
    return relation;
  };

  const createV1Runtime = (slice, options) => {
    requireNonEmptyString(slice.lexicalNamespaceId, "historical native lexical namespace");
    validateV1Source(slice.source);
    const evidenceIds = buildV1EvidenceIndex(slice);
    const expectedNamespace = options.lexicalNamespaceId ?? slice.lexicalNamespaceId;
    if (slice.lexicalNamespaceId !== expectedNamespace) {
      throw new Error("Historical native lexical namespace mismatch");
    }

    const relationByIdentity = buildIdentityIndex(
      slice.relations,
      (refs) => normalizeV1EvidenceRefs(refs, evidenceIds)
    );

    return {
      lexicalNamespaceId: slice.lexicalNamespaceId,
      source: slice.source,
      lookup: createIdentityLookup(relationByIdentity),
      lookupSurface() { return null; }
    };
  };

  const validateV2Sources = (artifact) => {
    if (!Array.isArray(artifact.sources) || artifact.sources.length === 0) {
      throw new TypeError("Historical native artifact requires sources");
    }
    const sourceIds = new Set();
    for (const source of artifact.sources) {
      requireNonEmptyString(source?.sourceId, "historical native source id");
      if (sourceIds.has(source.sourceId)) {
        throw new Error(`Duplicate historical native source id: ${source.sourceId}`);
      }
      sourceIds.add(source.sourceId);
      requireNonEmptyString(source?.sourceClass, "historical native source class");
      requireNonEmptyString(source?.path, "historical native source path");
      requireNonEmptyString(source?.coverageRole, "historical native coverage role");
      if (source.repository !== undefined) requireNonEmptyString(source.repository, "historical native source repository");
      if (source.commit !== undefined) requireGitSha(source.commit, "historical native source commit SHA");
      if (source.blobSha !== undefined) requireGitSha(source.blobSha, "historical native source blob SHA");
      if (source.license !== undefined) requireNonEmptyString(source.license, "historical native source license");
    }
    return sourceIds;
  };

  const normalizeV2RelationRefs = (relation, sourceIds) => {
    const sourceRefs = uniqueStrings(relation?.sourceRefs, "historical native source refs");
    for (const sourceRef of sourceRefs) {
      if (!sourceIds.has(sourceRef)) {
        throw new Error(`Unknown historical native source ref: ${sourceRef}`);
      }
    }
    const evidenceRefs = uniqueStrings(relation?.evidenceRefs, "historical native evidence refs");
    return { sourceRefs, evidenceRefs };
  };

  const buildExactSurfaceIndex = (relations, sourceIds) => {
    const index = new Map();
    for (const relation of Array.isArray(relations) ? relations : []) {
      requireNonEmptyString(relation?.surface, "historical native exact surface");
      requireNonEmptyString(relation?.historicalSurface, "historical native exact historical surface");
      if (index.has(relation.surface)) {
        throw new Error(`Duplicate historical native exact surface: ${relation.surface}`);
      }
      const refs = normalizeV2RelationRefs(relation, sourceIds);
      index.set(relation.surface, {
        historicalSurface: relation.historicalSurface,
        ...refs
      });
    }
    return index;
  };

  const buildExactReadingIndex = (relations, sourceIds) => {
    const index = new Map();
    for (const relation of Array.isArray(relations) ? relations : []) {
      requireNonEmptyString(relation?.surface, "historical native reading surface");
      requireNonEmptyString(relation?.historicalReading, "historical native historical reading");
      if (index.has(relation.surface)) {
        throw new Error(`Duplicate historical native reading surface: ${relation.surface}`);
      }
      const refs = normalizeV2RelationRefs(relation, sourceIds);
      index.set(relation.surface, {
        historicalReading: relation.historicalReading,
        ...refs
      });
    }
    return index;
  };

  const buildCandidateIndex = (relations, sourceIds, label) => {
    const index = new Map();
    for (const relation of Array.isArray(relations) ? relations : []) {
      requireNonEmptyString(relation?.surface, `historical native ${label} candidate surface`);
      if (index.has(relation.surface)) {
        throw new Error(`Duplicate historical native ${label} candidate: ${relation.surface}`);
      }
      const alternatives = uniqueStrings(
        relation?.alternatives,
        `historical native ${label} candidate alternatives`
      );
      if (alternatives.length < 2) {
        throw new TypeError(`Historical native ${label} candidate requires multiple alternatives`);
      }
      const refs = normalizeV2RelationRefs(relation, sourceIds);
      index.set(relation.surface, { alternatives, ...refs });
    }
    return index;
  };

  const mergeRefs = (...entries) => {
    const sourceRefs = [];
    const evidenceRefs = [];
    for (const entry of entries) {
      if (!entry) continue;
      for (const ref of entry.sourceRefs ?? []) if (!sourceRefs.includes(ref)) sourceRefs.push(ref);
      for (const ref of entry.evidenceRefs ?? []) if (!evidenceRefs.includes(ref)) evidenceRefs.push(ref);
    }
    sourceRefs.sort();
    evidenceRefs.sort();
    return { sourceRefs, evidenceRefs };
  };

  const createV2Runtime = (artifact, options) => {
    requireNonEmptyString(artifact.lexicalNamespaceId, "historical native lexical namespace");
    const expectedNamespace = options.lexicalNamespaceId ?? artifact.lexicalNamespaceId;
    if (artifact.lexicalNamespaceId !== expectedNamespace) {
      throw new Error("Historical native lexical namespace mismatch");
    }

    const sourceIds = validateV2Sources(artifact);
    const identityByIdentity = buildIdentityIndex(
      artifact.identityRelations,
      (refs) => uniqueStrings(refs, "historical native identity evidence refs")
    );
    const surfaceIndex = buildExactSurfaceIndex(artifact.surfaceRelations, sourceIds);
    const readingIndex = buildExactReadingIndex(artifact.readingRelations, sourceIds);
    const surfaceCandidateIndex = buildCandidateIndex(
      artifact.ambiguousSurfaceCandidates,
      sourceIds,
      "surface"
    );
    const readingCandidateIndex = buildCandidateIndex(
      artifact.ambiguousReadingCandidates,
      sourceIds,
      "reading"
    );

    const lookupSurface = (surface) => {
      requireNonEmptyString(surface, "historical native lookup surface");
      const exactSurface = surfaceIndex.get(surface) ?? null;
      const exactReading = readingIndex.get(surface) ?? null;
      const surfaceCandidates = surfaceCandidateIndex.get(surface) ?? null;
      const readingCandidates = readingCandidateIndex.get(surface) ?? null;

      if (!exactSurface && !exactReading && !surfaceCandidates && !readingCandidates) {
        return null;
      }

      const refs = mergeRefs(exactSurface, exactReading, surfaceCandidates, readingCandidates);
      if (surfaceCandidates || readingCandidates) {
        return {
          status: "candidates",
          route: "native",
          surface,
          reading: null,
          surfaceCandidates: [...(surfaceCandidates?.alternatives ?? [])],
          readingCandidates: [...(readingCandidates?.alternatives ?? [])],
          ...refs
        };
      }

      return {
        status: "resolved",
        route: "native",
        surface: exactSurface?.historicalSurface ?? surface,
        reading: exactReading?.historicalReading ?? null,
        surfaceCandidates: [],
        readingCandidates: [],
        ...refs
      };
    };

    return {
      lexicalNamespaceId: artifact.lexicalNamespaceId,
      source: artifact.sources,
      sources: artifact.sources,
      lookup: createIdentityLookup(identityByIdentity),
      lookupSurface
    };
  };

  const createHistoricalNativeRuntime = (artifact, options = {}) => {
    if (artifact?.schemaVersion === "1" && artifact?.kind === "japanese-orthography-historical-native-slice") {
      return createV1Runtime(artifact, options);
    }
    if (artifact?.schemaVersion === "2" && artifact?.kind === "japanese-orthography-historical-native-artifact") {
      return createV2Runtime(artifact, options);
    }
    throw new TypeError("Unsupported historical native slice");
  };

  return { createHistoricalNativeRuntime };
});

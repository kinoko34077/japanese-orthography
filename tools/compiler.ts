import { createHash } from 'node:crypto';
import { computeCanonicalSourceDigest, stableSerialize } from './normalize.ts';
import type { CanonicalWorkspace, CompiledArtifact, JsonValue } from './model.ts';

export interface CompilationBindings {
  lexicalNamespaceId: string;
  lexicalBindings: ReadonlyMap<string, readonly string[]>;
}

const sectionNames = [
  'hot-relations.json',
  'hot-safety.json',
  'cold-review.json',
  'audit-map.json'
] as const;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function serializeSection(value: JsonValue): string {
  return `${stableSerialize(value)}\n`;
}

function oneValue(values: Iterable<string>, label: string): string {
  const unique = [...new Set(values)];
  if (unique.length !== 1) throw new Error(`Expected exactly one ${label}, found ${unique.length}`);
  return unique[0]!;
}
function bindingIds(
  constraintId: string | undefined,
  bindings: CompilationBindings
): string[] | undefined {
  if (!constraintId) return undefined;
  const resolved = bindings.lexicalBindings.get(constraintId);
  if (!resolved) throw new Error(`Missing compilation binding for ${constraintId}`);
  return [...resolved].sort((a, b) => a.localeCompare(b, 'en'));
}

export function compileWorkspace(
  workspace: CanonicalWorkspace,
  bindings: CompilationBindings
): CompiledArtifact {
  const packId = oneValue(workspace.packMetadata.map((record) => record.value.packId), 'packId');
  const requiredNamespaceId = oneValue(
    workspace.packMetadata
      .map((record) => record.value.requiresLexicalNamespaceId)
      .filter((value): value is string => value !== undefined),
    'requiresLexicalNamespaceId'
  );
  if (bindings.lexicalNamespaceId !== requiredNamespaceId) {
    throw new Error(`Compilation namespace ${bindings.lexicalNamespaceId} does not match required ${requiredNamespaceId}`);
  }

  const hotRelations: JsonValue = workspace.positiveRelations
    .filter((record) => record.value.admission === 'admitted')
    .map((record) => {
      const relation = record.value;
      const ids = bindingIds(relation.lexicalConstraintSetId, bindings);
      const entry: Record<string, JsonValue> = { id: relation.id, match: relation.match, target: relation.target };
      if (relation.lexicalConstraintSetId) entry.lexicalConstraintSetId = relation.lexicalConstraintSetId;
      if (ids) entry.lexicalBindingIds = ids;
      return entry;
    });
  const hotSafety: JsonValue = workspace.safetyConstraints
    .filter((record) => record.value.admission === 'admitted')
    .map((record) => {
      const constraint = record.value;
      const ids = bindingIds(constraint.lexicalConstraintSetId, bindings);
      const entry: Record<string, JsonValue> = {
        id: constraint.id,
        match: constraint.match,
        effect: constraint.effect,
        precedence: constraint.effect === 'block_fallback' ? 'before_fallback' : 'contextual'
      };
      if (constraint.lexicalConstraintSetId) entry.lexicalConstraintSetId = constraint.lexicalConstraintSetId;
      if (ids) entry.lexicalBindingIds = ids;
      if (constraint.blocks) entry.blocks = constraint.blocks.map((ref) => ({ packId: ref.packId, relationId: ref.relationId }));
      return entry;
    });

  const coldReview: JsonValue = workspace.reviewHints.map((record) => record.value as unknown as JsonValue);
  const auditMap: JsonValue = {
    sources: workspace.sources.map((record) => record.value) as unknown as JsonValue,
    evidence: workspace.evidence.map((record) => record.value) as unknown as JsonValue,
    restorationUnits: workspace.restorationUnits.map((record) => record.value) as unknown as JsonValue,
    relations: workspace.positiveRelations.map((record) => ({
      id: record.value.id,
      unitId: record.value.unitId,
      evidenceRefs: record.value.evidenceRefs
    })) as unknown as JsonValue,
    safetyConstraints: workspace.safetyConstraints.map((record) => ({
      id: record.value.id,
      unitId: record.value.unitId ?? null,
      evidenceRefs: record.value.evidenceRefs
    })) as unknown as JsonValue,
    reviewHints: workspace.reviewHints.map((record) => ({
      id: record.value.id,
      evidenceRefs: record.value.evidenceRefs
    })) as unknown as JsonValue
  };

  const sectionValues: Record<(typeof sectionNames)[number], JsonValue> = {
    'hot-relations.json': hotRelations,
    'hot-safety.json': hotSafety,
    'cold-review.json': coldReview,
    'audit-map.json': auditMap
  };
  const sectionText = Object.fromEntries(
    sectionNames.map((name) => [name, serializeSection(sectionValues[name])])
  ) as Record<(typeof sectionNames)[number], string>;

  const canonicalSourceDigest = computeCanonicalSourceDigest(workspace);
  const bindingIdentity: JsonValue = [...bindings.lexicalBindings.entries()]
    .map(([id, values]) => [id, [...values].sort((a, b) => a.localeCompare(b, 'en'))] as unknown as JsonValue);
  const artifactGeneration = sha256(stableSerialize({
    artifactFormat: 'contextual-kanji-v1',
    canonicalSourceDigest,
    lexicalNamespaceId: bindings.lexicalNamespaceId,
    lexicalBindings: bindingIdentity
  }));
  const manifest: JsonValue = {
    schemaVersion: '1',
    packId,
    artifactGeneration,
    requiresLexicalNamespaceId: requiredNamespaceId,
    canonicalSourceDigest,
    sections: sectionNames.map((name) => ({
      id: name,
      required: name !== 'cold-review.json',
      digest: sha256(sectionText[name]),
      byteLength: Buffer.byteLength(sectionText[name], 'utf8')
    }))
  };

  return {
    'manifest.json': serializeSection(manifest),
    'hot-relations.json': sectionText['hot-relations.json'],
    'hot-safety.json': sectionText['hot-safety.json'],
    'cold-review.json': sectionText['cold-review.json'],
    'audit-map.json': sectionText['audit-map.json']
  };
}

import { createHash } from 'node:crypto';
import type { CanonicalWorkspace, JsonValue } from './model.ts';

function canonicalize(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    const items = value.map(canonicalize);
    return items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
  }
  if (typeof value === 'object') {
    const result: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort((a, b) => a.localeCompare(b, 'en'))) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) result[key] = canonicalize(child);
    }
    return result;
  }
  throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
}

export function stableSerialize(value: JsonValue): string {
  return JSON.stringify(canonicalize(value));
}
export function normalizeCanonicalKnowledge(workspace: CanonicalWorkspace): JsonValue {
  return canonicalize({
    sources: workspace.sources.map((record) => record.value),
    evidence: workspace.evidence.map((record) => record.value),
    lexicalEvidence: workspace.lexicalEvidence.map((record) => record.value),
    lexicalConstraintSets: workspace.lexicalConstraintSets.map((record) => record.value),
    restorationUnits: workspace.restorationUnits.map((record) => record.value),
    positiveRelations: workspace.positiveRelations.map((record) => record.value),
    safetyConstraints: workspace.safetyConstraints.map((record) => record.value),
    reviewHints: workspace.reviewHints.map((record) => record.value),
    packMetadata: workspace.packMetadata.map((record) => record.value)
  });
}

export function computeCanonicalSourceDigest(workspace: CanonicalWorkspace): string {
  const normalized = stableSerialize(normalizeCanonicalKnowledge(workspace));
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

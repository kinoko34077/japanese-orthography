import type { CanonicalWorkspace, Diagnostic, Located } from './model.ts';

export interface ExternalPackIndex {
  packId: string;
  exportedRelationIds: ReadonlySet<string>;
}

export interface LexicalNamespaceDescriptor {
  id: string;
  compatibleSourceNamespaces: ReadonlySet<string>;
}

function locationOf<T>(record: Located<T>): string {
  return `${record.location.file}#${record.location.pointer}`;
}

function error(code: string, message: string, path?: string): Diagnostic {
  return path === undefined
    ? { severity: 'ERROR', code, message }
    : { severity: 'ERROR', code, message, path };
}
export function validateIntegration(
  workspace: CanonicalWorkspace,
  externalPacks: readonly ExternalPackIndex[],
  lexicalNamespace: LexicalNamespaceDescriptor | null
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const externalPackById = new Map(externalPacks.map((pack) => [pack.packId, pack]));

  for (const record of workspace.safetyConstraints) {
    const constraint = record.value;
    if (constraint.admission !== 'admitted' || constraint.effect !== 'block_fallback') continue;
    if (!constraint.blocks || constraint.blocks.length === 0) {
      diagnostics.push(error(
        'E_FALLBACK_DEPENDENCY_MISSING',
        'block_fallback requires at least one explicit external relation identity',
        locationOf(record)
      ));
      continue;
    }
    for (const ref of constraint.blocks) {
      const pack = externalPackById.get(ref.packId);
      if (!pack || !pack.exportedRelationIds.has(ref.relationId)) {
        diagnostics.push(error(
          'E_EXTERNAL_RELATION_UNRESOLVED',
          `External relation is not exported: ${ref.packId}/${ref.relationId}`,
          locationOf(record)
        ));
      }
    }
  }
  const requiredNamespaceIds = new Set(
    workspace.packMetadata
      .map((record) => record.value.requiresLexicalNamespaceId)
      .filter((value): value is string => value !== undefined)
  );

  if (requiredNamespaceIds.size > 0) {
    if (!lexicalNamespace) {
      diagnostics.push(error(
        'E_LEXICAL_NAMESPACE_REQUIRED',
        `Required lexical namespace unavailable: ${[...requiredNamespaceIds].join(', ')}`
      ));
      return diagnostics;
    }
    if (!requiredNamespaceIds.has(lexicalNamespace.id)) {
      diagnostics.push(error(
        'E_LEXICAL_NAMESPACE_INCOMPATIBLE',
        `Lexical namespace ${lexicalNamespace.id} does not satisfy required namespace ${[...requiredNamespaceIds].join(', ')}`
      ));
    }

    const constraints = new Map(workspace.lexicalConstraintSets.map((record) => [record.value.id, record.value]));
    const lexicalEvidence = new Map(workspace.lexicalEvidence.map((record) => [record.value.id, record.value]));
    const usedConstraintIds = new Set<string>();
    for (const relation of workspace.positiveRelations) {
      if (relation.value.admission === 'admitted' && relation.value.lexicalConstraintSetId) {
        usedConstraintIds.add(relation.value.lexicalConstraintSetId);
      }
    }
    for (const constraint of workspace.safetyConstraints) {
      if (constraint.value.admission === 'admitted' && constraint.value.lexicalConstraintSetId) {
        usedConstraintIds.add(constraint.value.lexicalConstraintSetId);
      }
    }

    const incompatibleSources = new Set<string>();
    for (const constraintId of usedConstraintIds) {
      const constraint = constraints.get(constraintId);
      if (!constraint) continue;
      for (const lexicalRef of constraint.lexicalEvidenceRefs) {
        const lexical = lexicalEvidence.get(lexicalRef);
        if (!lexical) continue;
        if (!lexicalNamespace.compatibleSourceNamespaces.has(lexical.sourceRef)) {
          incompatibleSources.add(lexical.sourceRef);
        }
      }
    }
    for (const sourceRef of incompatibleSources) {
      diagnostics.push(error(
        'E_LEXICAL_NAMESPACE_INCOMPATIBLE',
        `Lexical namespace ${lexicalNamespace.id} does not cover source namespace ${sourceRef}`
      ));
    }
  }

  return diagnostics;
}

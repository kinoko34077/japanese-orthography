import type {
  CanonicalWorkspace,
  Diagnostic,
  EvidenceRecord,
  Located,
  PositiveRelation,
  SafetyConstraint
} from './model.ts';

function locationOf<T>(record: Located<T>): string {
  return `${record.location.file}#${record.location.pointer}`;
}

function error(code: string, message: string, path?: string): Diagnostic {
  return path === undefined
    ? { severity: 'ERROR', code, message }
    : { severity: 'ERROR', code, message, path };
}

function review(code: string, message: string, path?: string): Diagnostic {
  return path === undefined
    ? { severity: 'REVIEW', code, message }
    : { severity: 'REVIEW', code, message, path };
}

function scalarLength(value: string): number {
  return [...value].length;
}
function firstById<T extends { id: string }>(records: readonly Located<T>[]): Map<string, Located<T>> {
  const map = new Map<string, Located<T>>();
  for (const record of records) {
    if (!map.has(record.value.id)) map.set(record.value.id, record);
  }
  return map;
}

function checkDuplicateIds<T extends { id: string }>(
  diagnostics: Diagnostic[],
  namespace: string,
  records: readonly Located<T>[]
): void {
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.value.id)) {
      diagnostics.push(error(
        'E_DUPLICATE_ID',
        `Duplicate ${namespace} id: ${record.value.id}`,
        locationOf(record)
      ));
    } else {
      seen.add(record.value.id);
    }
  }
}

function evidenceFor(refs: readonly string[], evidence: Map<string, Located<EvidenceRecord>>): Located<EvidenceRecord>[] {
  return refs.flatMap((ref) => evidence.get(ref) ? [evidence.get(ref)!] : []);
}
export function validatePackLocal(workspace: CanonicalWorkspace): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  checkDuplicateIds(diagnostics, 'source', workspace.sources);
  checkDuplicateIds(diagnostics, 'evidence', workspace.evidence);
  checkDuplicateIds(diagnostics, 'lexical evidence', workspace.lexicalEvidence);
  checkDuplicateIds(diagnostics, 'lexical constraint', workspace.lexicalConstraintSets);
  checkDuplicateIds(diagnostics, 'restoration unit', workspace.restorationUnits);
  checkDuplicateIds(diagnostics, 'positive relation', workspace.positiveRelations);
  checkDuplicateIds(diagnostics, 'safety constraint', workspace.safetyConstraints);
  checkDuplicateIds(diagnostics, 'review hint', workspace.reviewHints);

  const sources = firstById(workspace.sources);
  const evidence = firstById(workspace.evidence);
  const lexicalEvidence = firstById(workspace.lexicalEvidence);
  const constraints = firstById(workspace.lexicalConstraintSets);
  const units = firstById(workspace.restorationUnits);

  for (const record of workspace.evidence) {
    if (!sources.has(record.value.sourceRef)) {
      diagnostics.push(error('E_UNRESOLVED_EVIDENCE', `Unresolved sourceRef: ${record.value.sourceRef}`, locationOf(record)));
    }
    const claim = record.value.claim;
    if (claim.type === 'mapping' && (claim.projectedFrom !== undefined || claim.projectedTo !== undefined)) {
      if (!claim.projectionNotes || claim.projectionNotes.length === 0) {
        diagnostics.push(error('E_PROJECTION_AUDIT_MISSING', 'Projected mapping requires projectionNotes', locationOf(record)));
      }
    }
  }
  for (const record of workspace.lexicalEvidence) {
    if (!sources.has(record.value.sourceRef)) {
      diagnostics.push(error('E_UNRESOLVED_EVIDENCE', `Unresolved lexical sourceRef: ${record.value.sourceRef}`, locationOf(record)));
    }
    for (const ref of record.value.evidenceRefs) {
      if (!evidence.has(ref)) {
        diagnostics.push(error('E_UNRESOLVED_EVIDENCE', `Unresolved lexical evidenceRef: ${ref}`, locationOf(record)));
      }
    }
  }

  for (const record of workspace.lexicalConstraintSets) {
    for (const ref of record.value.lexicalEvidenceRefs) {
      if (!lexicalEvidence.has(ref)) {
        diagnostics.push(error('E_DANGLING_LOCAL_REF', `Unresolved lexicalEvidenceRef: ${ref}`, locationOf(record)));
      }
    }
  }

  for (const record of workspace.positiveRelations) {
    const relation = record.value;
    if (!units.has(relation.unitId)) {
      diagnostics.push(error('E_DANGLING_LOCAL_REF', `Unresolved unitId: ${relation.unitId}`, locationOf(record)));
    }
    if (relation.lexicalConstraintSetId && !constraints.has(relation.lexicalConstraintSetId)) {
      diagnostics.push(error('E_DANGLING_LOCAL_REF', `Unresolved lexicalConstraintSetId: ${relation.lexicalConstraintSetId}`, locationOf(record)));
    }
    for (const ref of relation.evidenceRefs) {
      if (!evidence.has(ref)) diagnostics.push(error('E_UNRESOLVED_EVIDENCE', `Unresolved evidenceRef: ${ref}`, locationOf(record)));
    }
  }
  for (const record of workspace.safetyConstraints) {
    const constraint = record.value;
    if (constraint.unitId && !units.has(constraint.unitId)) {
      diagnostics.push(error('E_DANGLING_LOCAL_REF', `Unresolved unitId: ${constraint.unitId}`, locationOf(record)));
    }
    if (constraint.lexicalConstraintSetId && !constraints.has(constraint.lexicalConstraintSetId)) {
      diagnostics.push(error('E_DANGLING_LOCAL_REF', `Unresolved lexicalConstraintSetId: ${constraint.lexicalConstraintSetId}`, locationOf(record)));
    }
    for (const ref of constraint.evidenceRefs) {
      if (!evidence.has(ref)) diagnostics.push(error('E_UNRESOLVED_EVIDENCE', `Unresolved evidenceRef: ${ref}`, locationOf(record)));
    }
  }

  for (const record of workspace.reviewHints) {
    const hint = record.value;
    if (hint.lexicalConstraintSetId && !constraints.has(hint.lexicalConstraintSetId)) {
      diagnostics.push(error('E_DANGLING_LOCAL_REF', `Unresolved lexicalConstraintSetId: ${hint.lexicalConstraintSetId}`, locationOf(record)));
    }
    for (const ref of hint.evidenceRefs) {
      if (!evidence.has(ref)) diagnostics.push(error('E_UNRESOLVED_EVIDENCE', `Unresolved evidenceRef: ${ref}`, locationOf(record)));
    }
  }

  for (const record of workspace.positiveRelations) {
    const constraintId = record.value.lexicalConstraintSetId;
    if (!constraintId) continue;
    const constraint = constraints.get(constraintId)?.value;
    if (!constraint) continue;
    const resolved = constraint.lexicalEvidenceRefs.filter((ref) => lexicalEvidence.has(ref));
    if (resolved.length === 0) diagnostics.push(error('E_REQUIRED_LEXICAL_BINDING_MISSING', `No resolvable lexical evidence for ${constraintId}`, locationOf(record)));
  }
  const executableKeys = new Map<string, Located<PositiveRelation>>();
  for (const record of workspace.positiveRelations) {
    const relation = record.value;
    if (relation.admission !== 'admitted') continue;
    if (typeof (relation as { target: unknown }).target !== 'string') {
      diagnostics.push(error('E_SILENT_MULTI_TARGET_COLLAPSE', 'PositiveRelation target must be exactly one string', locationOf(record)));
      continue;
    }
    const key = [relation.direction, relation.channel, relation.match, relation.lexicalConstraintSetId ?? '', relation.target].join('\u0000');
    if (executableKeys.has(key)) {
      diagnostics.push(error('E_DUPLICATE_EXECUTABLE_AUTHORITY', `Duplicate executable relation authority for ${relation.match}`, locationOf(record)));
    } else {
      executableKeys.set(key, record);
    }
  }

  const ownedUnitIds = new Set<string>();
  for (const relation of workspace.positiveRelations) ownedUnitIds.add(relation.value.unitId);
  for (const constraint of workspace.safetyConstraints) {
    if (constraint.value.unitId) ownedUnitIds.add(constraint.value.unitId);
  }
  for (const unit of workspace.restorationUnits) {
    if (!ownedUnitIds.has(unit.value.id)) {
      diagnostics.push(error('E_ORPHAN_RESTORATION_UNIT', `RestorationUnit has no owned relation/safety linkage: ${unit.value.id}`, locationOf(unit)));
    }
  }

  const evidenceIsOracleOnly = (refs: readonly string[]): boolean => {
    const resolved = evidenceFor(refs, evidence);
    return resolved.length > 0 && resolved.every((record) => sources.get(record.value.sourceRef)?.value.kind === 'candidate_oracle');
  };
  for (const record of workspace.positiveRelations) {
    if (record.value.admission === 'admitted' && evidenceIsOracleOnly(record.value.evidenceRefs)) {
      diagnostics.push(error('E_REVIEW_ONLY_AUTHORITY', 'Candidate-oracle-only evidence cannot grant executable authority', locationOf(record)));
    }
  }
  for (const record of workspace.safetyConstraints) {
    if (record.value.admission === 'admitted' && evidenceIsOracleOnly(record.value.evidenceRefs)) {
      diagnostics.push(error('E_REVIEW_ONLY_AUTHORITY', 'Candidate-oracle-only evidence cannot grant safety authority', locationOf(record)));
    }
  }

  for (const record of workspace.positiveRelations) {
    const relation = record.value;
    if (relation.admission !== 'admitted' || typeof (relation as { target: unknown }).target !== 'string') continue;
    if (scalarLength(relation.match) !== 1 || scalarLength(relation.target) !== 1 || relation.lexicalConstraintSetId) continue;

    const mappings = evidenceFor(relation.evidenceRefs, evidence)
      .map((item) => item.value.claim)
      .filter((claim): claim is Extract<EvidenceRecord['claim'], { type: 'mapping' }> => claim.type === 'mapping');
    const reverseOnly = mappings.some((claim) =>
      claim.direction === 'historical_to_modern' && claim.rawFrom === relation.target && claim.rawTo === relation.match
    );
    const direct = mappings.some((claim) =>
      claim.direction === 'modern_to_historical' && claim.rawFrom === relation.match && claim.rawTo === relation.target
    );

    diagnostics.push(error(
      reverseOnly && !direct ? 'E_UNSAFE_SINGLE_CHAR_REVERSE' : 'E_PURE_CHARACTER_CONTAMINATION',
      reverseOnly && !direct
        ? 'Single-character reverse authority is supported only by historical-to-modern substitution evidence'
        : 'Contextual pack contains an unguarded pure character relation',
      locationOf(record)
    ));
  }
  for (const record of workspace.positiveRelations) {
    const relation = record.value;
    if (relation.admission !== 'admitted' || typeof (relation as { target: unknown }).target !== 'string') continue;
    for (const evidenceRecord of evidenceFor(relation.evidenceRefs, evidence)) {
      const claim = evidenceRecord.value.claim;
      if (claim.type !== 'mapping') continue;
      const rawModern = claim.direction === 'modern_to_historical' ? claim.rawFrom : claim.rawTo;
      const rawTarget = claim.direction === 'modern_to_historical' ? claim.rawTo : claim.rawFrom;
      const projectedModern = claim.direction === 'modern_to_historical' ? claim.projectedFrom : claim.projectedTo;
      const projectedTarget = claim.direction === 'modern_to_historical' ? claim.projectedTo : claim.projectedFrom;
      const modernMatches = relation.match === (projectedModern ?? rawModern);
      if (!modernMatches) continue;

      if (projectedTarget !== undefined && projectedTarget !== rawTarget) {
        if (relation.target === rawTarget) {
          diagnostics.push(error('E_LAYER_LEAKAGE', 'Contextual target retains rendering that source projection assigns downstream', locationOf(record)));
        } else if (relation.target !== projectedTarget) {
          diagnostics.push(review('R_LAYER_LEAKAGE_SUSPECTED', 'Canonical target differs from both raw and projected source target', locationOf(record)));
        }
      } else if (projectedTarget === undefined && relation.target !== rawTarget) {
        diagnostics.push(review('R_LAYER_LEAKAGE_SUSPECTED', 'Canonical target differs from raw source target without explicit projection', locationOf(record)));
      }
    }
  }

  const admittedRelations = workspace.positiveRelations.filter((record) =>
    record.value.admission === 'admitted' && typeof (record.value as { target: unknown }).target === 'string'
  );
  const longerDiagnosed = new Set<string>();
  for (const longer of admittedRelations) {
    for (const shorter of admittedRelations) {
      if (longer === shorter) continue;
      if (scalarLength(longer.value.match) <= scalarLength(shorter.value.match)) continue;
      if (!longer.value.match.includes(shorter.value.match)) continue;
      if ((longer.value.lexicalConstraintSetId ?? '') !== (shorter.value.lexicalConstraintSetId ?? '')) continue;

      const candidateTargets = new Set(
        admittedRelations
          .filter((record) =>
            record.value.match === shorter.value.match &&
            (record.value.lexicalConstraintSetId ?? '') === (shorter.value.lexicalConstraintSetId ?? '')
          )
          .map((record) => record.value.target)
      );
      const index = longer.value.match.indexOf(shorter.value.match);
      const uniqueOccurrence = index >= 0 && longer.value.match.indexOf(shorter.value.match, index + 1) === -1;
      const derivedTargets = uniqueOccurrence
        ? [...candidateTargets].map((target) =>
          longer.value.match.slice(0, index) + target + longer.value.match.slice(index + shorter.value.match.length)
        )
        : [];
      const key = longer.value.id;
      if (candidateTargets.size === 1 && derivedTargets.includes(longer.value.target) && !longerDiagnosed.has(key)) {
        diagnostics.push(error('E_REDUNDANT_LONGER_RULE', 'Longer rule is exactly derivable from a shorter single-target authority', locationOf(longer)));
        longerDiagnosed.add(key);
      } else if (candidateTargets.size === 1 && longer.value.unitId === shorter.value.unitId && !derivedTargets.includes(longer.value.target) && !longerDiagnosed.has(key)) {
        diagnostics.push(review('R_REDUNDANT_LONGER_RULE_UNPROVEN', 'Longer same-unit rule may add context, but redundancy cannot be proven from explicit constraints', locationOf(longer)));
        longerDiagnosed.add(key);
      }
    }
  }

  return diagnostics;
}

import type { IntakeWorkspace } from './load-intake.ts';
import type { CanonicalWorkspace, Diagnostic, PositiveRelation } from './model.ts';
import type { IntakeRecord } from './intake-model.ts';

function error(code: string, relation: { value: PositiveRelation; location: { file: string; pointer: string } }, message: string): Diagnostic {
  return {
    severity: 'ERROR',
    code,
    path: `${relation.location.file}${relation.location.pointer}`,
    message
  };
}

export function validatePhase46AuthorityClosure(
  workspace: CanonicalWorkspace,
  intake: IntakeWorkspace
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const records = new Map<string, IntakeRecord>();
  for (const record of intake.records) records.set(record.value.id, record.value);

  for (const relation of workspace.positiveRelations) {
    const { responsibility, intakeRecordRef } = relation.value;
    const hasResponsibility = responsibility !== undefined;
    const hasIntakeRef = intakeRecordRef !== undefined;

    if (!hasResponsibility && !hasIntakeRef) continue;
    if (!hasResponsibility || !hasIntakeRef) {
      diagnostics.push(error(
        'E_PHASE46_AUTHORITY_LINK_INCOMPLETE',
        relation,
        `Phase 4.6 relation ${relation.value.id} must declare responsibility and intakeRecordRef together`
      ));
      continue;
    }

    const record = records.get(intakeRecordRef);
    if (!record) {
      diagnostics.push(error(
        'E_PHASE46_UNKNOWN_INTAKE_RECORD',
        relation,
        `Phase 4.6 relation ${relation.value.id} references unknown intake record ${intakeRecordRef}`
      ));
      continue;
    }

    if (responsibility !== record.responsibility) {
      diagnostics.push(error(
        'E_PHASE46_RESPONSIBILITY_MISMATCH',
        relation,
        `Phase 4.6 relation ${relation.value.id} responsibility ${responsibility} does not match intake ${record.responsibility}`
      ));
    }

    if (relation.value.match !== record.modernSurface) {
      diagnostics.push(error(
        'E_PHASE46_MODERN_SURFACE_MISMATCH',
        relation,
        `Phase 4.6 relation ${relation.value.id} modern surface ${relation.value.match} does not match intake ${record.modernSurface ?? '<missing>'}`
      ));
    }

    if (record.disposition === 'admitted') {
      if (relation.value.target !== record.historicalSurface) {
        diagnostics.push(error(
          'E_PHASE46_TARGET_MISMATCH',
          relation,
          `Phase 4.6 relation ${relation.value.id} target ${relation.value.target} does not match admitted intake target ${record.historicalSurface ?? '<missing>'}`
        ));
      }
      continue;
    }

    if (record.disposition === 'candidate_ambiguous') {
      if (!record.alternatives?.includes(relation.value.target)) {
        diagnostics.push(error(
          'E_PHASE46_TARGET_NOT_IN_ALTERNATIVES',
          relation,
          `Phase 4.6 relation ${relation.value.id} target ${relation.value.target} is not present in intake alternatives`
        ));
      }
      continue;
    }

    if (relation.value.admission === 'admitted') {
      diagnostics.push(error(
        'E_PHASE46_EXCLUDED_HOT_AUTHORITY',
        relation,
        `Phase 4.6 relation ${relation.value.id} is admitted hot authority but intake disposition is ${record.disposition}`
      ));
    }
  }

  return diagnostics;
}

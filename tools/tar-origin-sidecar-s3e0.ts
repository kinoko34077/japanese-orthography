/**
 * #349 / #312 S3-E0：固定原典と正規Rule IRで証明済みの枝だけを統合するsidecar。
 * 読取専用。sourceCaseId/ProgramIdを永続的な利用者設定キーへ転用しない。
 */
import { auditTarBranchProvenance, type BranchOrigin } from './audit-tar-branch-provenance.ts';
import { joinSharedOutputEditableOrigins, type SharedOutputOrigin } from './tar-shared-output-or.ts';

const PIN = '198f8560613d23417cb0f87172ae8662e722ca30';
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const valid = (s: unknown): s is string => typeof s === 'string' && s.length > 0;
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('TAR origin sidecar: ' + message);
}

export interface OriginSidecarRow {
  /** 生成時の実行ID。ビルド更新で変わる。永続設定に使わない。 */
  programId: number;
  canonicalRuleId: string;
  input: string;
  output: string;
  /** 対象は候補分岐か同一出力へ複数entryが合流した分岐に限る。 */
  kind: 'candidate' | 'shared-output';
  /** 固定TAR snapshotに結合した可編集entry。snapshot間の移行は未証明。 */
  editableEntryKeys: string[];
  /** 設定元ではない補助証拠（flat参照等）。 */
  evidenceOnlyKeys: string[];
  /** 対応監査専用であり、永続設定キーではない。 */
  sourceCaseIds: string[];
  /** 監査上の枝別優先値。実行時precedenceの正本へ置換してはならない。 */
  provenancePriority: number | null;
}

export interface SidecarInputs {
  sourceCommit: string;
  irDigest: string;
  programs: number;
  candidateOrigins: readonly BranchOrigin[];
  simpleShared: readonly SharedOutputOrigin[];
}
const parseOriginKey = (raw: string, expectedKind: string): void => {
  let tuple: unknown;
  try { tuple = JSON.parse(raw); } catch { throw new Error('TAR origin sidecar: invalid origin key JSON'); }
  check(Array.isArray(tuple) && tuple[0] === PIN && tuple[1] === expectedKind
    && valid(tuple[2]), 'origin snapshot or kind mismatch');
  if (expectedKind === 'structured') {
    check(tuple.length === 4 && valid(tuple[3]), 'invalid structured entry');
  } else {
    check(expectedKind === 'flat' && tuple.length === 5 && tuple[3] === 'locator'
      && valid(tuple[4]), 'invalid flat entry');
  }
};

/** #327候補120枝と#344同一出力3枝のみ。推測対応、未知key、重複枝は拒否。 */
export function projectTarOriginSidecar(input: SidecarInputs) {
  check(input.sourceCommit === PIN && /^[0-9a-f]{64}$/u.test(input.irDigest)
    && Number.isSafeInteger(input.programs) && input.programs > 0,
    'unverified IR/source identity');
  const rows: OriginSidecarRow[] = [];
  const seenBranches = new Set<string>();
  const seenOrigins = new Set<string>();
  const seenCases = new Set<string>();
  const branchKey = (p: number, r: string, from: string, to: string) =>
    JSON.stringify([p, r, from, to]);
  const add = (row: OriginSidecarRow) => {
    check(Number.isSafeInteger(row.programId) && row.programId >= 0
      && row.programId < input.programs && valid(row.canonicalRuleId)
      && valid(row.input) && valid(row.output), 'invalid branch');
    const key = branchKey(row.programId, row.canonicalRuleId, row.input, row.output);
    check(!seenBranches.has(key), 'duplicate output branch');
    seenBranches.add(key);
    check(row.editableEntryKeys.length > 0
      && new Set(row.editableEntryKeys).size === row.editableEntryKeys.length,
      'no or duplicate editable origin');
    for (const origin of row.editableEntryKeys) {
      check(!seenOrigins.has(origin), 'editable origin reused across branches');
      seenOrigins.add(origin);
    }
    check(row.sourceCaseIds.length > 0 && new Set(row.sourceCaseIds).size === row.sourceCaseIds.length,
      'invalid or duplicate source case');
    for (const sourceCaseId of row.sourceCaseIds) {
      check(valid(sourceCaseId) && !seenCases.has(sourceCaseId), 'source case reused across branches');
      seenCases.add(sourceCaseId);
    }
    rows.push(row);
  };
  for (const entry of input.candidateOrigins) {
    check(valid(entry.sourceCaseId)
      && (entry.originKind === 'flat' || entry.originKind === 'structured'),
      'invalid candidate source case');
    parseOriginKey(entry.entryKey, entry.originKind);
    add({
      programId: entry.programId, canonicalRuleId: entry.canonicalRuleId,
      input: entry.input, output: entry.output, kind: 'candidate',
      editableEntryKeys: [entry.entryKey], evidenceOnlyKeys: [],
      sourceCaseIds: [entry.sourceCaseId], provenancePriority: entry.priority
    });
  }
  for (const shared of input.simpleShared) {
    const origins = joinSharedOutputEditableOrigins(shared);
    check(origins.caseJoins.length === 2 && origins.editableKeys.length === 2,
      'shared entry identity not proven');
    for (const origin of origins.editableKeys) parseOriginKey(origin, 'structured');
    for (const origin of origins.evidenceOnlyKeys) parseOriginKey(origin, 'flat');
    add({
      programId: shared.programId, canonicalRuleId: shared.canonicalRuleId,
      input: shared.input, output: shared.output, kind: 'shared-output',
      editableEntryKeys: origins.editableKeys,
      evidenceOnlyKeys: origins.evidenceOnlyKeys,
      sourceCaseIds: origins.caseJoins.map(x => x.sourceCaseId), provenancePriority: null
    });
  }
  rows.sort((a, b) => a.programId - b.programId
    || cmp(a.canonicalRuleId, b.canonicalRuleId) || cmp(a.output, b.output));
  return {
    kind: 'tar-origin-sidecar-s3e0-readonly',
    sourceCommit: PIN, irDigest: input.irDigest, programs: input.programs,
    candidateBranches: rows.filter(r => r.kind === 'candidate').length,
    sharedOutputBranches: rows.filter(r => r.kind === 'shared-output').length,
    editableOriginCount: seenOrigins.size,
    evidenceOnlyRefCount: rows.reduce((n, r) => n + r.evidenceOnlyKeys.length, 0),
    rows,
    runtimeConnected: false,
    note: 'Only previously proven fixed-snapshot TAR candidate/shared branches; not an all-entry toggle map, no migration guarantee.'
  };
}

/** 正規IR digest照合済みの#327監査を再利用し、実原典の全123枝を出力する。 */
export async function auditTarOriginSidecar(root: string) {
  const report = await auditTarBranchProvenance(root);
  const sidecar = projectTarOriginSidecar({
    sourceCommit: report.sourceCommit, irDigest: report.irDigest,
    programs: report.programs, candidateOrigins: report.candidateOrigins,
    simpleShared: report.simpleShared
  });
  check(report.candidateGroups === 60 && report.candidateBranchOrigins === 120
    && sidecar.candidateBranches === 120 && sidecar.sharedOutputBranches === 3
    && sidecar.editableOriginCount === 126 && sidecar.evidenceOnlyRefCount === 3,
    'fixed TAR proof coverage drift');
  return sidecar;
}

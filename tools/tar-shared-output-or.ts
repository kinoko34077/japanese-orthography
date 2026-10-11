/**
 * #344 / #312 S3-D: 固定TAR原典のsimple-exact shared-output branchに限る読取専用PoC。
 * 本番Rule Program/workerの実行権限ではない。sourceCaseIdもProgramIdも設定の永続keyにしない。
 */
export interface SharedOutputOrigin {
  programId: number;
  canonicalRuleId: string;
  input: string;
  output: string;
  sourceCaseIds: readonly string[];
  sourceKeys: readonly string[];
}
export interface SharedOutputSelection {
  programId: number;
  canonicalRuleId: string;
  input: string;
  output: string;
  activeSourceKeys: string[];
}
function check(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error('TAR shared output OR: ' + reason);
}
const validId = (s: unknown): s is string => typeof s === 'string' && s.length > 0;

/**
 * origination provenance is a set of editable entries for one existing Program output.
 * Permissions are a REQUIRED separate fail-closed gate, not an inferred user setting.
 * An origin must be both policy-allowed and user-enabled for the shared output to survive.
 */
export function enabledSharedOutputBranches(
  relations: readonly SharedOutputOrigin[],
  eligibilityByEntry: Readonly<Record<string, boolean>>,
  enabledByEntry: Readonly<Record<string, boolean | null>> = {}
): SharedOutputSelection[] {
  const known = new Set<string>();
  const branches = new Set<string>();
  for (const r of relations) {
    check(Number.isSafeInteger(r.programId) && r.programId >= 0
      && validId(r.canonicalRuleId) && validId(r.input) && validId(r.output)
      && Array.isArray(r.sourceCaseIds) && r.sourceCaseIds.length === 2
      && new Set(r.sourceCaseIds).size === 2 && r.sourceCaseIds.every(validId)
      && Array.isArray(r.sourceKeys) && r.sourceKeys.length === 2
      && new Set(r.sourceKeys).size === 2 && r.sourceKeys.every(validId),
      'shared branch identity/cardinality unproven');
    const branch = JSON.stringify([r.programId, r.output]);
    check(!branches.has(branch), 'same output branch mapped twice');
    branches.add(branch);
    for (const key of r.sourceKeys) known.add(key);
  }
  for (const [key, value] of Object.entries(eligibilityByEntry)) {
    check(known.has(key) && typeof value === 'boolean', 'invalid or unknown entry eligibility');
  }
  check(known.size === Object.keys(eligibilityByEntry).length,
    'missing eligibility for an editable entry');
  for (const [key, value] of Object.entries(enabledByEntry)) {
    check(known.has(key) && (value === null || typeof value === 'boolean'),
      'unknown editable entry key or invalid setting');
  }
  return relations.flatMap((r) => {
    const active = r.sourceKeys.filter((key) =>
      eligibilityByEntry[key] === true && enabledByEntry[key] !== false);
    return active.length ? [{
      programId: r.programId, canonicalRuleId: r.canonicalRuleId,
      input: r.input, output: r.output, activeSourceKeys: [...active].sort()
    }] : [];
  }).sort((a, b) => a.programId - b.programId
    || (a.output < b.output ? -1 : a.output > b.output ? 1 : 0));
}

/**
 * #344 / #312 S3-D: 固定TAR原典のsimple-exact shared-output枝の純粋・読取専用PoC。
 * 本番Rule Program/worker未接続。sourceCaseIdとProgramIdを永続toggle IDにしない。
 */
const PIN = '198f8560613d23417cb0f87172ae8662e722ca30';
export interface SharedOutputOrigin {
  programId: number;
  canonicalRuleId: string;
  input: string;
  output: string;
  sourceCaseIds: readonly string[];
  /** #327 auditが保存した全出典。flat evidence-onlyも含むので全件をeditableとしてはならない。 */
  sourceKeys: readonly string[];
}
export interface SharedOutputSelection {
  programId: number;
  canonicalRuleId: string;
  input: string;
  output: string;
  activeSourceKeys: string[];
  /** ON/OFFに寄与しないが証拠として追跡可能な参照。 */
  evidenceOnlySourceKeys: string[];
}
function check(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error('TAR shared output OR: ' + reason);
}
const validId = (s: unknown): s is string => typeof s === 'string' && s.length > 0;
type ParsedKey = { raw: string; kind: 'structured' | 'flat'; sourceId?: string };
const parseSourceKey = (raw: string): ParsedKey => {
  let tuple: unknown;
  try { tuple = JSON.parse(raw); } catch { throw new Error('TAR shared output OR: invalid source key'); }
  check(Array.isArray(tuple) && tuple[0] === PIN && validId(tuple[2]), 'invalid source snapshot key');
  if (tuple[1] === 'structured') {
    check(tuple.length === 4 && validId(tuple[3]), 'invalid structured entry key');
    return {raw, kind:'structured', sourceId:tuple[3]};
  }
  check(tuple[1] === 'flat' && tuple.length === 5 && tuple[3] === 'locator'
    && validId(tuple[4]), 'invalid supporting provenance key');
  return {raw, kind:'flat'};
};

/**
 * SourceCaseが実際に指すstructured entryのみを可編集originとして抽出。
 * extra flat sourceRefは監査の証拠でありOR権限は持たない。
 * 位置依存keyはPIN固定。原典更新のID移行は別工程で証明する。
 */
export function joinSharedOutputEditableOrigins(r: SharedOutputOrigin) {
  check(Number.isSafeInteger(r.programId) && r.programId >= 0
    && validId(r.canonicalRuleId) && validId(r.input) && validId(r.output)
    && Array.isArray(r.sourceCaseIds) && r.sourceCaseIds.length === 2
    && new Set(r.sourceCaseIds).size === 2 && r.sourceCaseIds.every(validId)
    && Array.isArray(r.sourceKeys) && r.sourceKeys.length >= 2
    && new Set(r.sourceKeys).size === r.sourceKeys.length && r.sourceKeys.every(validId),
    'shared branch identity/cardinality unproven');
  const parsed = r.sourceKeys.map(parseSourceKey);
  const matched = new Set<string>();
  const caseJoins = r.sourceCaseIds.map((sourceCaseId) => {
    const sourceCase = /^tar:structured:([^:]+):from\[(\d+)\]$/u.exec(sourceCaseId);
    check(sourceCase !== null, 'unrecognized sourceCase identity');
    const entry = parsed.filter(x => x.kind === 'structured' && x.sourceId === sourceCase[1]);
    check(entry.length === 1, 'case-to-editable-entry join ambiguous/missing');
    const key = entry[0]!.raw;
    check(!matched.has(key), 'two sourceCases collapse into one editable entry');
    matched.add(key);
    return { sourceCaseId, entryKey: key };
  });
  check(parsed.filter(x => x.kind === 'structured').every(x => matched.has(x.raw)),
    'unexpected additional structured origin');
  return {
    caseJoins,
    editableKeys:[...matched].sort(),
    evidenceOnlyKeys:parsed.filter(x=>x.kind==='flat').map(x=>x.raw).sort()
  };
}

/**
 * 編集origin単位のユーザ設定と必須のprofile/sourceLock等の権限を積で制限する。
 * ORは許可済編集origin上のみ。補助出典からOFF規則を復活させない。
 */
export function enabledSharedOutputBranches(
  relations: readonly SharedOutputOrigin[],
  eligibilityByEntry: Readonly<Record<string, boolean>>,
  enabledByEntry: Readonly<Record<string, boolean | null>> = {}
): SharedOutputSelection[] {
  const known = new Set<string>();
  const branches = new Set<string>();
  const joined = relations.map((r) => {
    const origins = joinSharedOutputEditableOrigins(r);
    const branch = JSON.stringify([r.programId, r.output]);
    check(!branches.has(branch), 'same output branch mapped twice');
    branches.add(branch);
    for (const key of origins.editableKeys) known.add(key);
    return { r, origins };
  });
  for (const [key,value] of Object.entries(eligibilityByEntry)) {
    check(known.has(key) && typeof value === 'boolean', 'invalid or unknown entry eligibility');
  }
  check(known.size === Object.keys(eligibilityByEntry).length,
    'missing eligibility for an editable entry');
  for (const [key,value] of Object.entries(enabledByEntry)) {
    check(known.has(key) && (value === null || typeof value === 'boolean'),
      'unknown editable entry key or invalid setting');
  }
  return joined.flatMap(({r,origins})=>{
    const active = origins.editableKeys.filter((key)=>
      eligibilityByEntry[key] === true && enabledByEntry[key] !== false);
    return active.length ? [{
      programId:r.programId,canonicalRuleId:r.canonicalRuleId,
      input:r.input,output:r.output,activeSourceKeys:active,
      evidenceOnlySourceKeys:origins.evidenceOnlyKeys
    }] : [];
  }).sort((a,b)=>a.programId-b.programId
    || (a.output < b.output ? -1 : a.output > b.output ? 1 : 0));
}

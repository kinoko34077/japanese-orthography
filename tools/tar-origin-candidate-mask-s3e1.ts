/**
 * #349 S3-E1: 信頼済みproducerが枝別証明を提供した場合に限る、調停前の純粋mask PoC。
 * 現行WorkerはcertifiedOriginを生成しないため、production接続は行わない。
 */
import type { OriginSidecarRow } from './tar-origin-sidecar-s3e0.ts';

const PIN = '198f8560613d23417cb0f87172ae8662e722ca30';
const valid = (s: unknown): s is string => typeof s === 'string' && s.length > 0;
function check(value: unknown, reason: string): asserts value {
  if (!value) throw new Error('TAR candidate origin mask: ' + reason);
}
const keyOf = (row: Pick<OriginSidecarRow, 'programId' | 'canonicalRuleId' | 'input' | 'output'>) =>
  JSON.stringify([row.programId,row.canonicalRuleId,row.input,row.output]);

/** Producerの証明が現行候補へ入ることは未実装。合成fixture専用の厳密契約。 */
export interface CertifiedBranch {
  sourceCommit: string;
  irDigest: string;
  programId: number;
  canonicalRuleId: string;
  input: string;
  output: string;
  stage: string;
  direction: string;
  channel: string;
  editableEntryKeys: readonly string[];
}
export interface OriginCandidate {
  key: string;
  start: number;
  end: number;
  output: string;
  origin: string;
  programIds?: readonly number[];
  stage?: string;
  direction?: string;
  channel?: string;
  certifiedOrigin?: CertifiedBranch;
}
export interface SidecarForMask {
  sourceCommit: string;
  irDigest: string;
  rows: readonly OriginSidecarRow[];
}
export type MaskDiagnostic = { candidateKey: string; reason: 'uncertified_origin' | 'branch_proof_mismatch' };

/**
 * 原典保護・親group/profile allowをまとめた不可逆eligibleとユーザ設定の論理積。
 * sidecar全entryのeligibleが明示されない場合は例外（許可推測なし）。
 * 未証明候補は変換の既存意味を壊さず通過、unsupportedとして報告する。
 */
export function maskCertifiedCandidatesBeforeArbitration<T extends OriginCandidate>(
  sourceText: string,
  candidates: readonly T[],
  sidecar: SidecarForMask,
  eligibilityByEntry: Readonly<Record<string, boolean>>,
  enabledByEntry: Readonly<Record<string, boolean | null>> = {}
): { candidates: T[]; blockedKeys: string[]; unsupported: MaskDiagnostic[] } {
  check(sidecar.sourceCommit === PIN && /^[0-9a-f]{64}$/u.test(sidecar.irDigest),
    'sidecar source/digest invalid');
  const rows = new Map<string, OriginSidecarRow>();
  const candidateProgramIds = new Set<number>();
  const entries = new Set<string>();
  for (const row of sidecar.rows) {
    check(Number.isSafeInteger(row.programId) && row.programId >= 0
      && valid(row.canonicalRuleId) && valid(row.input) && valid(row.output)
      && Array.isArray(row.editableEntryKeys) && row.editableEntryKeys.length > 0,
      'invalid sidecar row');
    const key = keyOf(row);
    check(!rows.has(key), 'duplicate sidecar branch');
    rows.set(key,row);
    candidateProgramIds.add(row.programId);
    for (const entry of row.editableEntryKeys) {
      check(valid(entry) && !entries.has(entry), 'duplicate/missing editable entry');
      entries.add(entry);
    }
  }
  check(entries.size === Object.keys(eligibilityByEntry).length
    && Object.entries(eligibilityByEntry).every(([id,value]) => entries.has(id) && typeof value === 'boolean'),
    'missing/unknown immutable eligibility');
  check(Object.entries(enabledByEntry).every(([id,value]) =>
    entries.has(id) && (value === null || typeof value === 'boolean')),
    'unknown/invalid user override');

  const retained: T[] = [];
  const blockedKeys: string[] = [];
  const unsupported: MaskDiagnostic[] = [];
  for (const candidate of candidates) {
    const possible = candidate.origin === 'program'
      && (candidate.programIds ?? []).some(id => candidateProgramIds.has(id));
    if (!possible) { retained.push(candidate); continue; }
    const proof = candidate.certifiedOrigin;
    if (!proof) {
      unsupported.push({candidateKey:candidate.key,reason:'uncertified_origin'});
      retained.push(candidate);
      continue;
    }
    const row = rows.get(keyOf(proof));
    // proof文字列だけで実行権限を主張しない。実候補が単一Programの未合成枝で、
    // 出力、入力、stage、direction、channelおよびorigin集合と完全一致すること。
    const correct = !!row
      && proof.sourceCommit === sidecar.sourceCommit && proof.irDigest === sidecar.irDigest
      && candidate.programIds?.length === 1 && candidate.programIds[0] === proof.programId
      && candidate.output === proof.output && candidate.start >= 0
      && Number.isSafeInteger(candidate.start) && Number.isSafeInteger(candidate.end)
      && candidate.end > candidate.start && candidate.end <= sourceText.length
      && sourceText.slice(candidate.start,candidate.end) === proof.input
      && candidate.stage === proof.stage && candidate.direction === proof.direction
      && candidate.channel === proof.channel
      && [proof.stage,proof.direction,proof.channel].every(valid)
      && Array.isArray(proof.editableEntryKeys)
      && proof.editableEntryKeys.length === row.editableEntryKeys.length
      && proof.editableEntryKeys.every((id,i) => id === row.editableEntryKeys[i]);
    if (!correct) {
      unsupported.push({candidateKey:candidate.key,reason:'branch_proof_mismatch'});
      retained.push(candidate);
      continue;
    }
    // 同一出力を共有する複数entryはOR。sourceLockedOff/profile deny/parent OFF
    // はeligible=falseで強制され、user trueでは再活性化できない。
    const enabled = row.editableEntryKeys.some(id =>
      eligibilityByEntry[id] === true && enabledByEntry[id] !== false);
    if (enabled) retained.push(candidate);
    else blockedKeys.push(candidate.key);
  }
  return {candidates:retained,blockedKeys,unsupported};
}

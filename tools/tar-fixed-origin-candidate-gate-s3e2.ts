/**
 * JO #349 S3-E2-P7: ビルドで固定したTAR出典123枝に限る、内部候補制御の結合。
 * 実ブラウザ側の利用者設定やUIを有効化するものではない。
 */
import type { RuleIR } from './rule-ir.ts';
import type { OriginSidecarRow } from './tar-origin-sidecar-s3e0.ts';
import { createAuditedTarEmissionJoin } from './tar-audited-emission-join-s3e2.ts';
import { auditTarOriginPackIdentity } from './tar-pack-identity-admission-s3e2.ts';

type Programs = Parameters<typeof createAuditedTarEmissionJoin>[2];
type Snapshot = { sourceCommit: string; irDigest: string; rows: readonly OriginSidecarRow[] };
type SourceCandidate = {
  start: number; end: number; output: string; origin?: string;
  programIds?: readonly number[]; emission?: unknown;
  stage?: string; direction?: string; channel?: string;
};
type VerifiedPack = { packDigest: string };
type GateInput<T extends SourceCandidate> = {
  pack: VerifiedPack;
  sourceText: string; profileId: string;
  candidates: readonly T[];
};
type Settings = {
  revision: number;
  eligibilityByEntry: Readonly<Record<string, boolean>>;
  enabledByEntry?: Readonly<Record<string, boolean | null>>;
};
function check(ok: unknown, why: string): asserts ok {
  if (!ok) throw new Error('TAR fixed origin gate: ' + why);
}

/**
 * 事前に信用できる原典/IR/Packロックで構築したclosureだけが対象。
 * pack.packDigestは照合鍵であり、pack object自身の認証ではない。
 * 呼出側が検証済みopenBrowserPack由来のpackを渡す必要がある。
 */
export function createFixedTarOriginCandidateGate(input: {
  sidecar: Snapshot;
  ir: RuleIR;
  programs: Programs;
  manifest: unknown;
  expectedPackDigest: string;
  settings: Settings;
}) {
  const admission = auditTarOriginPackIdentity({
    sourceCommit: input.sidecar.sourceCommit,
    sidecarIrDigest: input.sidecar.irDigest,
    ir: input.ir,
    programs: input.programs,
    manifest: input.manifest,
    expectedPackDigest: input.expectedPackDigest
  });
  const join = createAuditedTarEmissionJoin(input.sidecar, input.ir, input.programs);
  const entries = new Set(input.sidecar.rows.flatMap(row => row.editableEntryKeys));
  const eligible = new Map(Object.entries(input.settings.eligibilityByEntry));
  const overrides = new Map(Object.entries(input.settings.enabledByEntry ?? {}));
  check(Number.isSafeInteger(input.settings.revision) && input.settings.revision >= 0,
    'invalid settings revision');
  check(entries.size === 126 && eligible.size === entries.size,
    'fixed editable entry scope or eligibility count drift');
  for (const [id, value] of eligible) {
    check(entries.has(id) && typeof value === 'boolean', 'unverified immutable eligibility');
  }
  for (const [id, value] of overrides) {
    check(entries.has(id) && (value === null || typeof value === 'boolean'),
      'unknown or invalid user setting');
  }
  const revision = input.settings.revision;
  const packDigest = admission.packDigest;
  const permitted = (keys: readonly string[]) => keys.some(id =>
    eligible.get(id) === true && overrides.get(id) !== false);

  /** P6 trustedCandidateGateの内部引数を受け、候補の同一参照・順序を維持する。 */
  const filter = <T extends SourceCandidate>(request: GateInput<T>): T[] => {
    check(request.pack && request.pack.packDigest === packDigest,
      'runtime Pack identity mismatch');
    check(typeof request.sourceText === 'string'
      && Array.isArray(request.candidates), 'invalid raw candidate input');
    return request.candidates.filter(candidate => {
      // 他の規則はOFFにしたふりをしない。根拠不明の候補は従来通り残す。
      if (candidate.origin !== 'program'
        || !Number.isSafeInteger(candidate.start) || !Number.isSafeInteger(candidate.end)
        || candidate.start < 0 || candidate.end <= candidate.start
        || candidate.end > request.sourceText.length) return true;
      const proof = join.match({
        edge: { output: candidate.output, programs: candidate.programIds,
          emission: candidate.emission },
        input: request.sourceText.slice(candidate.start, candidate.end),
        stage: candidate.stage ?? '', direction: candidate.direction ?? '',
        channel: candidate.channel ?? '', profileId: request.profileId
      });
      return proof.status !== 'matched' || permitted(proof.entry.editableEntryKeys);
    });
  };
  return Object.freeze({
    kind: 'fixed-tar-origin-candidate-gate-s3e2-p7-build-internal',
    revision, packDigest, sourceCommit: join.sourceCommit, irDigest: join.irDigest,
    supportedBranches: join.verifiedBranches, supportedPrograms: join.verifiedPrograms,
    runtimeOriginAuthenticated: false,
    filter
  });
}

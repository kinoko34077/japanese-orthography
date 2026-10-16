/**
 * JO #349 S3-E2-P10b2b-1：正本identity／実hot bytes／実VM生候補の内部合成監査。
 * 本番のtoggle・任意candidateの信頼タグは付与しない。実本番Packのpositive proofも未完了。
 */
import { createRequire } from 'node:module';
import type { RuleIR } from './rule-ir.ts';
import { openVerifiedTarHotPack } from './tar-verified-hot-pack-s3e2.ts';
import { auditTarOriginPackIdentity } from './tar-pack-identity-admission-s3e2.ts';
import { createAuditedTarEmissionJoin } from './tar-audited-emission-join-s3e2.ts';

const { createBrowserProgramRuntime } =
  createRequire(import.meta.url)('../runtime/browser-program-runtime.js');

type Sidecar = Parameters<typeof createAuditedTarEmissionJoin>[0];
type Programs = Parameters<typeof createAuditedTarEmissionJoin>[2];
type HotInput = Parameters<typeof openVerifiedTarHotPack>[0];
type InspectOptions = {
  stages?: string[];
  directions?: string[];
  channels?: string[];
  context?: unknown;
};
const unsupported = (reason: string) => Object.freeze({ status: 'unsupported' as const, reason });

/**
 * Pack、runtime、joinのインスタンスは呼出側に渡さず、この関数内で生成する。
 * inspectは内部で実行した候補だけを所有照合する。外部candidateを受け取らない。
 */
export async function createClosedTarOriginAudit(input: HotInput & {
  sidecar: Sidecar;
  ir: RuleIR;
  programs: Programs;
}) {
  // 実bytes取得前に、固定原典・IR・Program・独立Pack lockを検査する。
  const admission = auditTarOriginPackIdentity({
    sourceCommit: input.sidecar.sourceCommit,
    sidecarIrDigest: input.sidecar.irDigest,
    ir: input.ir,
    programs: input.programs,
    manifest: input.manifest,
    expectedPackDigest: input.expectedPackDigest
  });
  const join = createAuditedTarEmissionJoin(input.sidecar, input.ir, input.programs);
  const verified = await openVerifiedTarHotPack({
    manifest: input.manifest,
    expectedPackDigest: input.expectedPackDigest,
    sectionProvider: input.sectionProvider
  });
  if (verified.packDigest !== admission.packDigest || verified.pack.packDigest !== admission.packDigest) {
    throw new Error('TAR closed producer audit: verified Pack identity drift');
  }
  // VMは照合済みの実Packからのみ生成。外部pack/runtimeの差替え口を作らない。
  const runtime = await createBrowserProgramRuntime(verified.pack, { traceEmissions: true });
  if (typeof runtime.ownsTracedEmission !== 'function') {
    throw new Error('TAR closed producer audit: VM emission ownership missing');
  }
  const inspect = (sourceText: string, profileId: string, options: InspectOptions = {}) => {
    if (typeof sourceText !== 'string' || typeof profileId !== 'string') {
      throw new TypeError('TAR closed producer audit: invalid input');
    }
    const observation = runtime.transformText(sourceText, profileId, options);
    return Object.freeze(observation.candidates.map((candidate: {
      start: number; end: number; output: string; origin: string;
      programIds?: number[]; emission?: unknown;
      stage: string; direction: string; channel: string;
    }) => {
      if (!runtime.ownsTracedEmission(candidate)) return unsupported('not owned by verified VM runtime');
      if (candidate.origin !== 'program' || !Number.isSafeInteger(candidate.start)
        || !Number.isSafeInteger(candidate.end) || candidate.start < 0
        || candidate.end <= candidate.start || candidate.end > sourceText.length) {
        return unsupported('invalid literal candidate');
      }
      // 固定123枝の一意joinが成立しない候補は未証明として保持する。
      const matched = join.match({
        edge: { output: candidate.output, programs: candidate.programIds,
          emission: candidate.emission },
        input: sourceText.slice(candidate.start, candidate.end),
        stage: candidate.stage, direction: candidate.direction,
        channel: candidate.channel, profileId
      });
      return matched.status === 'matched'
        ? Object.freeze({ status: 'matched' as const, entry: matched.entry,
          start: candidate.start, end: candidate.end })
        : unsupported(matched.reason);
    }));
  };
  return Object.freeze({
    kind: 'tar-closed-origin-audit-s3e2-p10b2b1-readonly',
    packDigest: admission.packDigest,
    irDigest: admission.irDigest,
    sourceCommit: admission.sourceCommit,
    verifiedBranches: join.verifiedBranches,
    runtimeOriginAuthenticated: false as const,
    inspect
  });
}

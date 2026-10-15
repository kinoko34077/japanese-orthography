/**
 * #349 S3-E2-P4: 固定TAR sidecarの正規IRを既存BrowserPack v3 identityへ結ぶ監査ゲート。
 * 既存manifest lockを検証するが、実配信されたsection本文や実行中の由来は認証しない。
 */
import type { RuleIR } from './rule-ir.ts';
import type { CompiledPrograms } from './rule-program-compiler.ts';
import { ruleProgramDigest } from './rule-program-compiler.ts';
import { validateBrowserPackManifest } from './browser-pack-model.ts';

const PIN = '198f8560613d23417cb0f87172ae8662e722ca30';
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('TAR Pack identity admission: ' + message);
}

/** 引数のexpectedPackDigestは、manifestとは独立した正規受入記録から与える。 */
export function auditTarOriginPackIdentity(input: {
  sourceCommit:string;
  sidecarIrDigest:string;
  ir:RuleIR;
  programs:Pick<CompiledPrograms,'count'>;
  manifest:unknown;
  expectedPackDigest:string;
}) {
  const m=validateBrowserPackManifest(input.manifest);
  assert(input.sourceCommit===PIN && input.sidecarIrDigest===input.ir.digest,
    'fixed source or IR identity drift');
  assert(/^[a-f0-9]{64}$/u.test(input.expectedPackDigest)
    && m.packDigest===input.expectedPackDigest,'Pack identity not admitted by independent lock');
  assert(m.compilerVersion==='3' && m.profiles.some(p=>p.profileId==='kinotch-fixed'),
    'incompatible Pack version or profile');
  assert(m.ruleRuntime?.programDigest===ruleProgramDigest(input.ir),
    'IR does not match compiler program identity');
  assert(input.programs.count===input.ir.rules.length,'Program count differs from IR');
  const required=['symbol-registry','rule-programs','rule-program-index',
    'sequence-pool','rule-runtime-meta'] as const;
  for(const kind of required){
    const sections=m.sections.filter(s=>s.kind===kind);
    assert(sections.length===1,'missing or ambiguous required Pack section: '+kind);
    assert(sections[0]!.byteLength>0,'empty required Pack section: '+kind);
    if(kind==='rule-programs')
      assert(sections[0]!.rowCount===input.programs.count,'pack Program rows differ from IR');
  }
  return Object.freeze({
    kind:'tar-pack-identity-admission-s3e2-p4-readonly',
    packDigest:m.packDigest,
    programDigest:m.ruleRuntime!.programDigest,
    irDigest:input.ir.digest,
    sourceCommit:input.sourceCommit,
    programCount:input.programs.count,
    runtimeOriginAuthenticated:false,
    note:'Manifest/IR semantic lock only. BrowserPack section bytes are verified by pack loader, not this audit.'
  });
}

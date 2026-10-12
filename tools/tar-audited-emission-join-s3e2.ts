/**
 * JO #349 S3-E2-P3: 固定TARの監査済み出力枝とVM発行位置の結合（本番未接続）。
 * 本関数の入力はビルド側で生成した正規IR/Program/固定原典に限る。
 * 実行時の任意候補に付いた偽造originやbranchOrdinalの認証には使用しない。
 */
import type { OriginSidecarRow } from './tar-origin-sidecar-s3e0.ts';
import type { RuleIR } from './rule-ir.ts';
import type { CompiledPrograms } from './rule-program-compiler.ts';
import { auditTarCompiledEmissions } from './tar-compiled-emission-audit-s3e2.ts';

type Snapshot = {
  sourceCommit:string; irDigest:string; rows:readonly OriginSidecarRow[];
};
type IrView = Pick<RuleIR,'digest'|'rules'>;
type ProgramView = Parameters<typeof auditTarCompiledEmissions>[2];
type EmissionEdge = {
  output?: unknown; programs?: unknown; emission?: unknown;
};
const keyOf = (programId:number,branchOrdinal:number) => `${programId}:${branchOrdinal}`;
const unsupported = (reason:string) => ({ status:'unsupported' as const, reason });
function assert(ok:unknown,why:string):asserts ok {
  if(!ok) throw new Error('TAR emission origin join: '+why);
}

/**
 * 監査済み123枝限定。プログラム出力位置→原典編集entryをビルド内部で投影する。
 * 実ブラウザPackのidentityは別途証明が必要なため、本番の認証済みタグではない。
 */
export function createAuditedTarEmissionJoin(sidecar:Snapshot,ir:IrView,programs:ProgramView){
  const verified=auditTarCompiledEmissions(sidecar,ir,programs);
  const table=new Map<string,Readonly<{
    sourceCommit:string; irDigest:string;
    programId:number; branchOrdinal:number;
    canonicalRuleId:string; input:string; output:string;
    editableEntryKeys:readonly string[];
    kind:OriginSidecarRow['kind'];
  }>>();
  const programIds=new Set<number>();
  for(const row of sidecar.rows){
    const rule=ir.rules[row.programId]!;
    const positions=rule.branches.flatMap((b,index)=>
      b.canonicalId===row.canonicalRuleId && b.output===row.output ? [index]:[]);
    assert(positions.length===1,'branch origin has no unique compiler emission position');
    // 同一文字列の複数EMITは出力文字列からの逆引きで識別不能。
    // 実行位置があっても本PoCは一意に証明された123枝だけを認める。
    assert(rule.branches.filter(b=>b.output===row.output).length===1,
      'ambiguous same output in one Program');
    const branchOrdinal=positions[0]!;
    const key=keyOf(row.programId,branchOrdinal);
    assert(!table.has(key),'duplicate emission position');
    assert(row.editableEntryKeys.length>0 && new Set(row.editableEntryKeys).size===row.editableEntryKeys.length,
      'missing or repeated editable source entry');
    programIds.add(row.programId);
    table.set(key,Object.freeze({
      sourceCommit:sidecar.sourceCommit,irDigest:sidecar.irDigest,
      programId:row.programId,branchOrdinal,
      canonicalRuleId:row.canonicalRuleId,input:row.input,output:row.output,
      editableEntryKeys:Object.freeze([...row.editableEntryKeys]),kind:row.kind
    }));
  }
  assert(verified.checkedBranches===123 && verified.checkedPrograms===63
    && table.size===123 && programIds.size===63,'accepted fixed-TAR audit scope drift');

  return Object.freeze({
    sourceCommit:sidecar.sourceCommit,
    irDigest:sidecar.irDigest,
    verifiedBranches:table.size,
    verifiedPrograms:programIds.size,
    /**
     * 候補はtrusted VMが返したもののみを想定。呼出側で真正性を保証しない場合、
     * この一致は原典認証にも、本番のmask実行許可にもならない。
     */
    match(candidate:{
      edge:EmissionEdge; input:string;
      stage:string; direction:string; channel:string; profileId:string;
    }){
      if(candidate.profileId!=='kinotch-fixed'
        || candidate.stage!=='profile'||candidate.direction!=='to-modern'
        || candidate.channel!=='surface') return unsupported('outside fixed TAR lane');
      const {edge}=candidate;
      if(!Array.isArray(edge.programs)||edge.programs.length!==1
        || !Number.isSafeInteger(edge.programs[0])) return unsupported('multi-program or unverified trace');
      const emission=edge.emission;
      if(!emission || typeof emission!=='object') return unsupported('missing VM emission');
      const m=emission as Record<string,unknown>;
      if(!Number.isSafeInteger(m.programId)||!Number.isSafeInteger(m.branchOrdinal)
        || Number(m.branchOrdinal)<0||edge.programs[0]!==m.programId)
        return unsupported('invalid emission identity');
      const entry=table.get(keyOf(Number(m.programId),Number(m.branchOrdinal)));
      if(!entry)return unsupported('outside audited branches');
      if(candidate.input!==entry.input||edge.output!==entry.output)
        return unsupported('actual input/output drift');
      return {status:'matched' as const,entry};
    }
  });
}

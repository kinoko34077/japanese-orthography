import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { auditTarCompiledEmissions } from '../tools/tar-compiled-emission-audit-s3e2.ts';
import { createAuditedTarEmissionJoin } from '../tools/tar-audited-emission-join-s3e2.ts';
import { auditTarOriginPackIdentity } from '../tools/tar-pack-identity-admission-s3e2.ts';
import { sealBrowserPackManifest } from '../tools/browser-pack-model.ts';
import { auditTarOriginSidecar } from '../tools/tar-origin-sidecar-s3e0.ts';
import { normalizeAcceptedOrthographySources, assertNoSilentSourceDrop } from '../tools/orthography-source-normalization.ts';
import { withProfileRules } from '../tools/orthography-policy.ts';
import { compileRuleIR, type RuleIR } from '../tools/rule-ir.ts';
import { compilePrograms, createVM, type CompiledPrograms } from '../tools/rule-program-compiler.ts';
import { SYMBOL_REGISTRY, type SymbolRegistry } from '../tools/symbol-registry.ts';

const require = createRequire(import.meta.url);
const { OP } = require('../runtime/rule-program-vm.js');
const PIN = '198f8560613d23417cb0f87172ae8662e722ca30';
const sample=()=>{
  const rule = (id:string,output:string,candidate:boolean) => ({
    ruleId:id,canonicalIds:[id],input:'あ',stage:'profile',
    direction:'to-modern',channel:'surface',origin:'tar',scope:'anywhere',
    branches:[{output,candidate,canonicalId:id}]
  });
  const group=rule('rule:tar:sample','甲',true);
  group.branches.push({output:'乙',candidate:true,canonicalId:group.ruleId});
  const shared=rule('rule:tar:shared','丙',false);
  const idOf=new Map([['あ',0],['甲',1],['乙',2],['丙',3]]);
  const p={
    count:2,direct:[true,false],outputs:[[1,2],[]],flags:[[1,1],[]],
    code:[[],[OP.TEST_PROFILE,7,OP.EMIT,3,0,OP.END]],
    stage:[4,4],direction:[1,1],channel:[0,0],inputs:[[0],[0]],
    evidence:[{ruleId:group.ruleId,canonicalIds:[group.ruleId]},
              {ruleId:shared.ruleId,canonicalIds:[shared.ruleId]}],
    index:new Map([['profile|to-modern|surface|0',[0,1]]]),
    pool:{idOf}
  };
  const rows=[['甲',0,group.ruleId],['乙',0,group.ruleId],['丙',1,shared.ruleId]]
    .map(([output,programId,canonicalRuleId])=>({
      output,programId,canonicalRuleId,input:'あ',kind:programId===1?'shared-output':'candidate',
      editableEntryKeys:['sample'],evidenceOnlyKeys:[],sourceCaseIds:['sample'],provenancePriority:1
    }));
  return {
    sidecar:{sourceCommit:PIN,irDigest:'a'.repeat(64),rows},
    ir:{digest:'a'.repeat(64),rules:[group,shared]} as unknown as RuleIR,
    p:p as unknown as CompiledPrograms
  };
};

test('#349 E2-P0 直載せとbytecode両方のEMITを枝ごとに検証する',()=>{
  const fixture=sample();
  const result=auditTarCompiledEmissions(fixture.sidecar as never,fixture.ir,fixture.p);
  assert.equal(result.checkedBranches,3);
  assert.equal(result.checkedPrograms,2);
  assert.equal(result.directBranches,2);
  assert.equal(result.bytecodeBranches,1);
  assert.equal(result.runtimeOriginTagPresent,false);
});

test('#349 E2-P0 Program/出力/フラグ/依存CALL/方向の不一致はすべて拒否',()=>{
  const v=sample();
  assert.throws(()=>auditTarCompiledEmissions({...v.sidecar,sourceCommit:'unknown'} as never,v.ir,v.p),/identity/);
  assert.throws(()=>auditTarCompiledEmissions(v.sidecar as never,v.ir,{
    ...v.p,outputs:[[1,3],[]]
  }),/compiled output\/flags drift/);
  assert.throws(()=>auditTarCompiledEmissions(v.sidecar as never,v.ir,{
    ...v.p,code:[[],[OP.CALL,0,OP.END]]
  }),/unsupported/);
  assert.throws(()=>auditTarCompiledEmissions(v.sidecar as never,v.ir,{
    ...v.p,direction:[0,1]
  }),/direction\/channel drift/);
  assert.throws(()=>auditTarCompiledEmissions(v.sidecar as never,v.ir,{
    ...v.p,index:new Map()
  }),/posting/);
});

test('#349 E2-P0 固定TAR 123枝と正本compilerの実出力列を全件照合', async()=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  const sidecar=await auditTarOriginSidecar(root);
  const normalized=await normalizeAcceptedOrthographySources(root);
  assertNoSilentSourceDrop(normalized);
  const full=withProfileRules(normalized.graph);
  const ir=compileRuleIR(full);
  const expected=JSON.parse(await readFile(resolve(root,'data/reports/rule-program-summary.json'),'utf8'));
  assert.equal(ir.digest,sidecar.irDigest);
  assert.equal(ir.digest,expected.irDigest);
  const registry=JSON.parse(await readFile(resolve(root,SYMBOL_REGISTRY),'utf8')) as SymbolRegistry;
  const refs=[...new Set(full.facts
    .filter(f=>f.kind==='literal_form'||f.kind==='literal_reading')
    .flatMap(f=>f.lexicalRefs))].sort();
  const byLexeme=new Map(refs.map((s,i)=>[s,i]));
  const program=compilePrograms(ir,registry,ref=>byLexeme.get(ref)??null);
  assert.equal(program.count,expected.programs);
  const report=auditTarCompiledEmissions(sidecar,ir,program);
  assert.equal(report.checkedBranches,123);
  assert.equal(report.checkedPrograms,63);
  assert.equal(report.directBranches+report.bytecodeBranches,123);

  // E2-P1: 静的compilerだけでなく、実行中の正規VM.runが実際に出力した
  // 63 Programの123枝を全件照合。CALLや変形出力を出さない固定範囲に限定する。
  const vm=createVM(program,registry);
  vm.verify();
  const originsByProgram=new Map<number,Set<string>>();
  for(const row of sidecar.rows){
    const outputs=originsByProgram.get(row.programId)??new Set<string>();
    assert.ok(!outputs.has(row.output),'一つのProgram内で枝別の出力識別が重複');
    outputs.add(row.output);
    originsByProgram.set(row.programId,outputs);
  }
  assert.equal(originsByProgram.size,63);
  let executedBranches=0;
  for(const [programId,expectedOutputs] of originsByProgram){
    const result=vm.run(programId,{profileId:'kinotch-fixed'});
    assert.equal(result.preserved,false);
    assert.deepEqual(
      result.edges.map((edge:{output:string})=>edge.output).sort(),
      [...expectedOutputs].sort(),
      `Program ${programId}: 実VM出力の枝別一致`
    );
    for(const edge of result.edges){
      assert.deepEqual(edge.programs,[programId],`Program ${programId}: 実行された単独Programの追跡`);
      assert.equal(typeof edge.sequenceId,'number');
    }
    executedBranches+=result.edges.length;
  }
  assert.equal(executedBranches,123);

  // E2-P3: 正規IR/Programで検証した123枝を、opt-inの実VM発行位置へ対応付ける。
  // E2-P4: 正規の固定IR・Programと受入済みv3 manifestの意味識別子を結合する。
  const packManifest=JSON.parse(await readFile(resolve(root,'data/browser-pack-v3/manifest.json'),'utf8'));
  const packReport=JSON.parse(await readFile(resolve(root,'data/reports/browser-pack-v3-compiled.json'),'utf8'));
  const admitted=auditTarOriginPackIdentity({
    sourceCommit:sidecar.sourceCommit,sidecarIrDigest:sidecar.irDigest,
    ir,programs:program,manifest:packManifest,expectedPackDigest:packReport.packDigest
  });
  assert.equal(admitted.packDigest,packManifest.packDigest);
  assert.equal(admitted.programCount,195302);
  assert.equal(admitted.runtimeOriginAuthenticated,false);
  const resealedUnrelatedIr=sealBrowserPackManifest({
    ...packManifest,
    ruleRuntime:{...packManifest.ruleRuntime,programDigest:'0'.repeat(64)}
  });
  assert.throws(()=>auditTarOriginPackIdentity({
    sourceCommit:sidecar.sourceCommit,sidecarIrDigest:sidecar.irDigest,
    ir,programs:program,manifest:resealedUnrelatedIr,
    expectedPackDigest:resealedUnrelatedIr.packDigest
  }),/IR does not match compiler program identity/,'manifestと受入digestを共に変更しても異なるProgramを認証しない');
  assert.throws(()=>auditTarOriginPackIdentity({
    sourceCommit:'wrong',sidecarIrDigest:sidecar.irDigest,
    ir,programs:program,manifest:packManifest,expectedPackDigest:packReport.packDigest
  }),/source or IR identity drift/);
  assert.throws(()=>auditTarOriginPackIdentity({
    sourceCommit:sidecar.sourceCommit,sidecarIrDigest:sidecar.irDigest,
    ir,programs:program,manifest:packManifest,expectedPackDigest:'0'.repeat(64)
  }),/Pack identity not admitted/);
  assert.throws(()=>auditTarOriginPackIdentity({
    sourceCommit:sidecar.sourceCommit,sidecarIrDigest:sidecar.irDigest,
    ir,programs:{count:program.count-1},manifest:packManifest,expectedPackDigest:packReport.packDigest
  }),/Program count differs/);

  const join=createAuditedTarEmissionJoin(sidecar,ir,program);
  assert.equal(join.verifiedPrograms,63);
  assert.equal(join.verifiedBranches,123);
  const tracedVm=createVM(program,registry,{traceEmissions:true});
  tracedVm.verify();
  let matched=0;
  for(const [programId,expectedOutputs] of originsByProgram){
    const input=sidecar.rows.find(row=>row.programId===programId)!.input;
    const result=tracedVm.run(programId,{profileId:'kinotch-fixed'});
    assert.equal(result.edges.length,expectedOutputs.size);
    for(const edge of result.edges){
      const witness=join.match({
        edge,input,stage:'profile',direction:'to-modern',
        channel:'surface',profileId:'kinotch-fixed'
      });
      assert.equal(witness.status,'matched');
      if(witness.status==='matched'){
        assert.equal(witness.entry.programId,programId);
        assert.equal(witness.entry.output,edge.output);
        assert.ok(witness.entry.editableEntryKeys.length>=1);
      }
      matched+=1;
    }
  }
  assert.equal(matched,123);
  const sampleRow=sidecar.rows[0]!;
  const real=tracedVm.run(sampleRow.programId,{profileId:'kinotch-fixed'}).edges
    .find((edge:{output:string})=>edge.output===sampleRow.output)!;
  const input=sampleRow.input;
  const check=(edge:unknown,inputText=input,profileId='kinotch-fixed')=>join.match({
    edge:edge as {output?:unknown;programs?:unknown;emission?:unknown},
    input:inputText,profileId,stage:'profile',direction:'to-modern',channel:'surface'
  });
  assert.equal(check(real).status,'matched');
  assert.equal(check(real,input+'異').status,'unsupported','元文字列が違う場合は拒否');
  assert.equal(check(real,input,'historical').status,'unsupported','profile違いでは拒否');
  assert.equal(check({...real,output:'偽'}).status,'unsupported','出力改竄では拒否');
  assert.equal(check({...real,emission:{programId:sampleRow.programId,branchOrdinal:999}}).status,
    'unsupported','未監査の枝番号は拒否');
  assert.equal(check({...real,programs:[sampleRow.programId, sampleRow.programId]}).status,
    'unsupported','複合経路を認証済みにしない');
  assert.equal(check({...real,emission:undefined}).status,'unsupported','証拠なしの候補は拒否');
  assert.ok(report.results.every(r=>r.stage==='profile'
    && r.direction==='to-modern'&&r.channel==='surface'));
});

/**
 * JO #349 S3-E2-P0: 固定TAR sidecarと正規compiler出力の実際のemitを照合する読取専用監査。
 * 本番VMにはentry originを付与しない。証明は静的なProgram/EMITの枝対応まで。
 */
import type { OriginSidecarRow } from './tar-origin-sidecar-s3e0.ts';
import type { RuleIR } from './rule-ir.ts';
import type { CompiledPrograms } from './rule-program-compiler.ts';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { OP, FLAG } = require('../runtime/rule-program-vm.js');
const PIN = '198f8560613d23417cb0f87172ae8662e722ca30';
const arity: Record<number, number> = { [OP.END]:0,[OP.TEST_PROFILE]:1,
  [OP.TEST_SYMBOL]:1,[OP.TEST_LEXSET]:1,[OP.TEST_PRED]:1,[OP.CALL]:1,
  [OP.EMIT]:2,[OP.PRESERVE]:0,[OP.MECH]:1 };
function assert(ok: unknown, why: string): asserts ok {
  if (!ok) throw new Error('TAR compiled-emission audit: ' + why);
}
type IRView = Pick<RuleIR,'digest'|'rules'>;
type ProgramView = Pick<CompiledPrograms,
  'count'|'direct'|'outputs'|'flags'|'code'|'evidence'|'stage'|'direction'|'channel'|'inputs'|'index'|'pool'>;

function emitted(program: ProgramView, id: number) {
  const result: {seq:number; flag:boolean}[] = [];
  if (program.direct[id]) {
    const values = program.outputs[id] ?? [];
    const flags = program.flags[id] ?? [];
    assert(values.length > 0 && values.length === flags.length, 'direct output/flag mismatch');
    values.forEach((seq,i) => result.push({seq,flag:(flags[i]! & FLAG.CANDIDATE)!==0}));
  } else {
    const code = program.code[id] ?? [];
    let ended = false;
    for (let pc=0;pc<code.length;) {
      const op = code[pc]!;
      assert(Number.isInteger(arity[op]) && pc+arity[op]!<code.length,
        'unknown or truncated opcode');
      // 出典を保てないCALL・動的mechanismは枝の認証対象から外す。
      assert(op!==OP.CALL && op!==OP.MECH && op!==OP.PRESERVE,
        'indirect/mechanism/preserve emitter unsupported');
      if(op===OP.END) { ended=true; assert(pc===code.length-1,'code after END');break; }
      if(op===OP.EMIT) result.push({seq:code[pc+1]!,flag:(code[pc+2]! & FLAG.CANDIDATE)!==0});
      pc += arity[op]!+1;
    }
    assert(ended && result.length>0,'bytecode without literal emissions or END');
  }
  return result;
}

/** 実compilerのProgram ID・postings・emit列と原典の枝集合を全一致照合する。 */
export function auditTarCompiledEmissions(
  sidecar: {sourceCommit:string;irDigest:string;rows:readonly OriginSidecarRow[]},
  ir: IRView,
  programs: ProgramView
) {
  assert(sidecar.sourceCommit===PIN && sidecar.irDigest===ir.digest
    && ir.rules.length===programs.count && programs.count===programs.evidence.length,
    'unverified source/IR/compiler identity');
  const checkedPrograms = new Set<number>();
  const checkedRows = new Set<string>();
  const results: Array<{programId:number;output:string;emitter:'direct'|'bytecode';
    stage:string;direction:string;channel:string;scope:string}> = [];
  for(const row of sidecar.rows) {
    const id=row.programId;
    assert(Number.isSafeInteger(id)&&id>=0&&id<ir.rules.length,'unknown Program ID');
    const rule=ir.rules[id]!;
    assert(rule.ruleId===row.canonicalRuleId && rule.input===row.input
      && rule.canonicalIds.includes(row.canonicalRuleId), 'IR program/input identity mismatch');
    // 今回の123枝はTARのliteral profile-stage表層だけ。別レーンは別監査。
    assert(rule.origin==='tar' && rule.stage==='profile' && rule.direction==='to-modern'
      && rule.channel==='surface','unsupported rule origin/stage/direction/channel');
    const identity=JSON.stringify([id,row.canonicalRuleId,row.input,row.output]);
    assert(!checkedRows.has(identity),'duplicate sidecar branch');
    checkedRows.add(identity);
    const branches=rule.branches.filter(b=>b.output===row.output
      && b.canonicalId===row.canonicalRuleId);
    assert(branches.length===1,'IR branch output origin not unique');
    assert(programs.evidence[id]?.ruleId===rule.ruleId
      && programs.evidence[id]?.canonicalIds.includes(row.canonicalRuleId),
      'compiled evidence canonical Rule mismatch');
    const stageIndex=4, directionIndex=1,channelIndex=0; // profile,to-modern,surface
    assert(programs.stage[id]===stageIndex && programs.direction[id]===directionIndex
      && programs.channel[id]===channelIndex, 'compiled stage/direction/channel drift');
    const sourceSeq=programs.pool.idOf.get(row.input);
    assert(sourceSeq!==undefined && programs.inputs[id]?.includes(sourceSeq)
      && programs.index.get(`profile|to-modern|surface|${sourceSeq}`)?.includes(id),
      'missing compiled input posting');
    const expected=rule.branches.map(b=>{
      const seq=programs.pool.idOf.get(b.output);
      assert(seq!==undefined,'unrepresentable literal output');
      return {seq,flag:Boolean(b.candidate)};
    });
    const actual=emitted(programs,id);
    assert(JSON.stringify(actual)===JSON.stringify(expected),'compiled output/flags drift');
    const emittedBranch=expected.find(x=>x.seq===programs.pool.idOf.get(row.output));
    assert(!!emittedBranch,'branch has no compiler emission');
    checkedPrograms.add(id);
    results.push({
      programId:id,output:row.output,emitter:programs.direct[id]?'direct':'bytecode',
      stage:rule.stage,direction:rule.direction,channel:rule.channel,scope:rule.scope
    });
  }
  assert(checkedRows.size===results.length,'branch count drift');
  return {
    kind:'tar-compiled-emission-audit-s3e2-p0-readonly',
    sourceCommit:PIN,irDigest:ir.digest,
    checkedBranches:results.length,checkedPrograms:checkedPrograms.size,
    directBranches:results.filter(r=>r.emitter==='direct').length,
    bytecodeBranches:results.filter(r=>r.emitter==='bytecode').length,
    runtimeOriginTagPresent:false,
    results,
    caveat:'IR/compiled static emit parity only; not a runtime executed-edge tag, worker seam or end-user toggle.'
  };
}

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runBoundedBaseline } from './bench-jo312-baseline.ts';

type MemorySnapshot = {rss:number;heapUsed:number;heapTotal:number;external:number;arrayBuffers:number};
type Phase = {
  case:string;wallMs:number;inputSha256:string;outputSha256:string;
  fetchedSections:number;fetchedBytes:number;
  memoryAfter:MemorySnapshot;
};
type Baseline = {
  packDigest:string;inputSha256:string;memoryBefore:MemorySnapshot;cases:Phase[];
  packSource:string;profileId:string;
};
const fields=['rss','heapUsed','heapTotal','external','arrayBuffers'] as const;
const finite=(n:number)=>Number.isFinite(n)&&n>=0;
const checkMemory=(x:MemorySnapshot)=>{
  if(!x||fields.some(k=>!finite(x[k])))throw new Error('invalid memory observation');
};
export function phaseMemoryDeltas(raw:Baseline) {
  if(!raw?.packDigest||!Array.isArray(raw.cases)||raw.cases.length!==3)
    throw new Error('invalid bounded S1 baseline');
  if(JSON.stringify(raw.cases.map(c=>c.case))!==JSON.stringify(['cold','warm-repeat','warm-new-text']))
    throw new Error('unexpected measurement phase sequence');
  checkMemory(raw.memoryBefore);
  const rows=[];
  let previous=raw.memoryBefore;
  for(const entry of raw.cases) {
    checkMemory(entry.memoryAfter);
    if(!finite(entry.wallMs)||!Number.isInteger(entry.fetchedSections)||entry.fetchedSections<0
      ||!Number.isInteger(entry.fetchedBytes)||entry.fetchedBytes<0
      ||!entry.inputSha256||!entry.outputSha256)throw new Error('invalid phase observation');
    const delta={} as Record<typeof fields[number],number>;
    const sinceStart={} as Record<typeof fields[number],number>;
    for(const k of fields){
      delta[k]=entry.memoryAfter[k]-previous[k];
      sinceStart[k]=entry.memoryAfter[k]-raw.memoryBefore[k];
    }
    rows.push({
      phase:entry.case,wallMs:entry.wallMs,
      fetchedSections:entry.fetchedSections,fetchedBytes:entry.fetchedBytes,
      inputSha256:entry.inputSha256,outputSha256:entry.outputSha256,
      deltaFromPrevious:delta,deltaFromProcessBefore:sinceStart
    });
    previous=entry.memoryAfter;
  }
  return {
    kind:'jo312-s5-runtime-residency-phase-observation',packDigest:raw.packDigest,
    profileId:raw.profileId,packSource:raw.packSource,
    phases:rows,
    memoryBefore:raw.memoryBefore,
    memoryAfter:previous,
    note:'Process memoryUsage per phase boundary only; deltas may be negative due to GC; cold includes first-use and Node/VM costs. Not peak resident memory, browser heap or all-pack-resident lower bound. Published source downloads decoded bodies; wire bytes differ.'
  };
}
export function measureBoundedRuntimeResidency(
  lengths:readonly number[],profileId='kinotch-fixed',timeoutMs=25000,heapMb=768
){
  const measured=runBoundedBaseline(lengths,profileId,timeoutMs,heapMb,'published');
  return {
    kind:'jo312-s5-bounded-runtime-residency',inputs:lengths,
    records:measured.records.map(record=>{
      if(record.status!=='success')return record;
      try {
        return {...record,result:phaseMemoryDeltas(record.result as Baseline)};
      } catch(e){
        return {length:record.length,profileId:record.profileId,status:'error' as const,error:String(e)};
      }
    }),
    note:'Reuses #314 process timeout / V8 old-space limit. One child per input length, never a proof of 20MB target. RSS limit is not enforced by V8 heap size.'
  };
}
const script=fileURLToPath(import.meta.url);
if(process.argv[1]&&resolve(process.argv[1])===script){
  const parse=(name:string,defaultValue:string)=>process.argv
    .find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3)??defaultValue;
  const lengths=parse('lengths','250,1000').split(',').map(Number);
  const timeout=Number(parse('timeout-ms','25000'));
  const heap=Number(parse('heap-mb','768'));
  if(lengths.length<1||lengths.length>3||lengths.some(x=>!Number.isSafeInteger(x)||x<1||x>10000))
    throw new Error('invalid bounded input lengths');
  process.stdout.write(JSON.stringify(measureBoundedRuntimeResidency(lengths,
    parse('profile','kinotch-fixed'),timeout,heap),null,2)+'\n');
}

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Section = { sectionId:string; kind:string; loading:string; byteLength:number; encoding?:string; rowCount?:number };
type Manifest = { packDigest:string; sections:Section[] };
type Stat = { sections:number; bytes:number; gzipBytes:number };
type Report = { packDigest:string; sizes:{
  total:number; totalGzip:number;
  byKind:Record<string,Stat>;
  byLoading:Record<string,Stat>;
}};
const HOT_KINDS = [
  'symbol-registry','sequence-pool','rule-programs','rule-program-index',
  'rule-predicates','rule-lexeme-sets','rule-runtime-meta'
] as const;
const LEXICAL_KINDS = [
  'lexeme-forms','lexeme-readings','lexeme-table',
  'reading-index','surface-index','morphology-table','sino-component-index'
] as const;
function must(condition:unknown,reason:string):asserts condition {
  if (!condition) throw new Error('JO#328 pack memory accounting: '+reason);
}
export function auditMemoryEnvelope(manifest:Manifest,report:Report){
  must(manifest.packDigest===report.packDigest && /^[0-9a-f]{64}$/u.test(manifest.packDigest),
    'incompatible pack digest');
  const ids=new Set<string>();
  const byKind=new Map<string,{sections:number;bytes:number}>();
  const byLoading=new Map<string,{sections:number;bytes:number}>();
  let fullBytes=0;
  for(const section of manifest.sections){
    must(typeof section.sectionId==='string' && !ids.has(section.sectionId),'duplicate/invalid section ID');
    ids.add(section.sectionId);
    must(Number.isSafeInteger(section.byteLength) && section.byteLength>=0 &&
      (section.rowCount === undefined ? section.encoding === 'json' :
        Number.isSafeInteger(section.rowCount) && section.rowCount>=0),
      'invalid byteLength/rowCount for '+section.sectionId);
    must(['eager','lazy','on-demand'].includes(section.loading),'unknown loading '+section.sectionId);
    fullBytes+=section.byteLength;
    for(const [map,key] of [[byKind,section.kind],[byLoading,section.loading]] as const){
      const row=map.get(key)??{sections:0,bytes:0};
      row.sections++;row.bytes+=section.byteLength;map.set(key,row);
    }
  }
  must(fullBytes===report.sizes.total,'full raw bytes mismatch');
  const match=(label:string,actual:Map<string,{sections:number;bytes:number}>,expected:Record<string,Stat>)=>{
    must(actual.size===Object.keys(expected).length,'missing '+label+' categories');
    for(const [kind,stats] of actual){
      const accepted=expected[kind];
      must(accepted && accepted.sections===stats.sections && accepted.bytes===stats.bytes,
        label+' count/bytes differ at '+kind);
      must(Number.isSafeInteger(accepted.gzipBytes) && accepted.gzipBytes>=0,'invalid gzip '+kind);
    }
    const gzip=Object.values(expected).reduce((sum,row)=>sum+row.gzipBytes,0);
    must(gzip===report.sizes.totalGzip,label+' compressed bytes mismatch');
  };
  match('kind',byKind,report.sizes.byKind);
  match('loading',byLoading,report.sizes.byLoading);
  const kinds=Object.fromEntries([...byKind].map(([kind,data])=>
    [kind,{...data,gzipBytes:report.sizes.byKind[kind]!.gzipBytes}]));
  const sizeOf=(kinds:readonly string[])=>kinds.reduce((sum,kind)=>{
    must(byKind.has(kind),'required kind absent: '+kind);
    return sum+byKind.get(kind)!.bytes;
  },0);
  const coreBytes=sizeOf(HOT_KINDS);
  const lexicalBytes=sizeOf(LEXICAL_KINDS);
  const eager=new Set(manifest.sections.filter(s=>s.loading==='eager').map(s=>s.sectionId));
  const core=new Set(manifest.sections.filter(s=>HOT_KINDS.includes(s.kind as any)).map(s=>s.sectionId));
  const union=new Set([...eager,...core]);
  const byId=new Map(manifest.sections.map(s=>[s.sectionId,s]));
  const corePlusEager=[...union].reduce((sum,id)=>sum+byId.get(id)!.byteLength,0);
  return {
    kind:'jo312-s5-memory-envelope', packDigest:manifest.packDigest,
    sectionCount:manifest.sections.length,fullRawBytes:fullBytes,fullGzipBytes:report.sizes.totalGzip,
    targetBytes:20_000_000,
    coreKinds:[...HOT_KINDS],coreRawBytes:coreBytes,
    lexicalKinds:[...LEXICAL_KINDS],lexicalRawBytes:lexicalBytes,
    corePlusEagerRawBytes:corePlusEager,corePlusEagerRawSectionCount:union.size,
    corePlusEagerVsTargetBytes:corePlusEager-20_000_000,
    eagerRawBytes:byLoading.get('eager')!.bytes,
    categories:kinds,
    note:'All numbers are on-disk binary-columnar raw payload lengths, NOT decoded JS heap, network transfer, process RSS, required resident upper/lower bounds or best-possible compressed runtime. 20MB target remains unverified.'
  };
}
export async function auditAcceptedMemoryEnvelope(root:string){
  const [manifest,report]=await Promise.all([
    readFile(resolve(root,'data/browser-pack-v3/manifest.json'),'utf8').then(JSON.parse) as Promise<Manifest>,
    readFile(resolve(root,'data/reports/browser-pack-v3-measurements.json'),'utf8').then(JSON.parse) as Promise<Report>
  ]);
  return auditMemoryEnvelope(manifest,report);
}
if (process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  process.stdout.write(JSON.stringify(await auditAcceptedMemoryEnvelope(process.cwd()),null,2)+'\n');
}

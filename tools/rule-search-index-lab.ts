import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

/** #321: production非接続。現行長さ別探索とprefix trieの候補発見だけを比較する。 */
export type SearchPosting = { stage: number; direction: number; channel: number; programs: number[] };
export type SearchKey = { sequenceId: number; symbols: readonly number[]; postings: readonly SearchPosting[] };
export type SearchHit = { start: number; end: number; sequenceId: number; postings: readonly SearchPosting[] };
export type SearchSnapshot = { keys: SearchKey[]; find: (symbols: readonly number[]) => number; packDigest: string };
type TrieNode = { next: Map<number, TrieNode>; key?: SearchKey };
const validId = (v: number) => Number.isSafeInteger(v) && v >= 0;

export function assertSearchKeys(keys: readonly SearchKey[]): void {
  const ids = new Set<number>();
  for (const key of keys) {
    if (!validId(key.sequenceId) || ids.has(key.sequenceId) || key.symbols.length < 1
      || !key.symbols.every(validId) || !Array.isArray(key.postings)
      || !key.postings.every(p => validId(p.stage) && validId(p.direction) && validId(p.channel)
        && p.programs.every(validId))) throw new Error('invalid or duplicate search key');
    ids.add(key.sequenceId);
  }
}

export function compareSearchKeys(
  keys: readonly SearchKey[],
  find: (symbols: readonly number[]) => number
) {
  assertSearchKeys(keys);
  const byId = new Map(keys.map(k => [k.sequenceId, k] as const));
  const lengths = [...new Set(keys.map(k => k.symbols.length))].sort((a,b)=>a-b);
  const baseline = (tokens: readonly number[]): SearchHit[] => {
    const hits: SearchHit[] = [];
    for (let start=0;start<tokens.length;start++) {
      for (const len of lengths) {
        if (start+len > tokens.length) break;
        const id = find(tokens.slice(start,start+len));
        const key = byId.get(id);
        if (key) hits.push({ start, end:start+len, sequenceId:id, postings:key.postings });
      }
    }
    return hits;
  };
  const root: TrieNode = { next: new Map() };
  let nodes=1, edges=0;
  for (const key of keys) {
    let node = root;
    for (const symbol of key.symbols) {
      let child = node.next.get(symbol);
      if (!child) { child={next:new Map()};node.next.set(symbol,child);nodes++;edges++; }
      node=child;
    }
    if (node.key) throw new Error('duplicate SymbolId sequence with different SequenceIds');
    node.key=key;
  }
  const trie = (tokens: readonly number[]): SearchHit[] => {
    const hits: SearchHit[] = [];
    for (let start=0;start<tokens.length;start++) {
      let node:TrieNode | undefined=root;
      for (let end=start;end<tokens.length;end++) {
        node=node.next.get(tokens[end]!);
        if (!node) break;
        if (node.key) hits.push({start,end:end+1,sequenceId:node.key.sequenceId,postings:node.key.postings});
      }
    }
    return hits;
  };
  const signature = (hit: SearchHit) => JSON.stringify([hit.start,hit.end,hit.sequenceId,
    hit.postings.map(p=>[p.stage,p.direction,p.channel,p.programs])]);
  const parity = (tokens: readonly number[]) => {
    if (!tokens.every(validId)) throw new Error('invalid token stream');
    const a=baseline(tokens).map(signature);
    const b=trie(tokens).map(signature);
    const mismatch=a.findIndex((entry,i)=>entry!==b[i]);
    if (a.length!==b.length || mismatch>=0) throw new Error('candidate drift: '+JSON.stringify({
      baseline:a.length,trie:b.length,mismatch,
      expected:a[mismatch]??null,actual:b[mismatch]??null
    }));
    return { candidates:a.length, digest:createHash('sha256').update(JSON.stringify(a)).digest('hex') };
  };
  return { baseline,trie,parity,nodes,edges,keyCount:keys.length,lengthCount:lengths.length };
}

const require = createRequire(import.meta.url);
const { decodeSection } = require('../runtime/browser-pack-binary.js');
const { createSequencePool } = require('../runtime/sequence-pool-runtime.js');
export async function readAcceptedSearchSnapshot(root: string): Promise<SearchSnapshot> {
  const dir=resolve(root,'data/browser-pack-v3');
  const manifest=JSON.parse(await readFile(resolve(dir,'manifest.json'),'utf8')) as {
    packDigest: string; sections: Array<{sectionId:string;path:string}>;
  };
  const fetch=async(id:string) => {
    const meta=manifest.sections.find(s=>s.sectionId===id);
    if (!meta) throw new Error('missing pack section '+id);
    const bytes=await readFile(resolve(dir,meta.path));
    return decodeSection(bytes);
  };
  const [registry, seq, index]=await Promise.all([
    fetch('symbol-registry'),fetch('sequence-pool'),fetch('rule-program-index')
  ]);
  const atoms:string[]=[];
  for(let i=0;i<registry.rowCount('atoms');i++) atoms.push(registry.string('atoms',i));
  const pool=createSequencePool(seq,atoms);
  const keys=new Map<number,SearchKey>();
  for(let i=0;i<index.rowCount('stage');i++) {
    const sequenceId=index.value('input',i);
    let key=keys.get(sequenceId);
    if(!key) {
      key={sequenceId,symbols:[...pool.symbols(sequenceId)],postings:[]};
      keys.set(sequenceId,key);
    }
    (key.postings as SearchPosting[]).push({
      stage:index.value('stage',i),direction:index.value('direction',i),
      channel:index.value('channel',i),programs:[...index.list('programs',i)]
    });
  }
  return {keys:[...keys.values()],find:(symbols)=>pool.find(symbols),packDigest:manifest.packDigest};
}

export function makeSyntheticSymbols(keys:readonly SearchKey[],length:number):number[] {
  if (!Number.isSafeInteger(length) || length<1 || length>10_000) throw new Error('invalid synthetic length');
  const available=keys.filter(k=>k.symbols.length>0 && k.symbols.length<=8);
  if(!available.length)throw new Error('no suitable search sequences');
  const out:number[]=[];
  let seed=0x1234abcd;
  while(out.length<length) {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const k=available[seed%available.length]!;
    out.push(...k.symbols);
    if((seed&7)===0) out.push(65534);
  }
  return out.slice(0,length);
}

export async function measureSearchCandidates(root:string,lengths:readonly number[]) {
  const source=await readAcceptedSearchSnapshot(root);
  const before=process.memoryUsage();
  const builtAt=performance.now();
  const matcher=compareSearchKeys(source.keys,source.find);
  const buildMs=performance.now()-builtAt;
  const after=process.memoryUsage();
  const results=[];
  for(const length of lengths) {
    const tokens=makeSyntheticSymbols(source.keys,length);
    const inputDigest=createHash('sha256').update(JSON.stringify(tokens)).digest('hex');
    const startBase=performance.now(),left=matcher.baseline(tokens),baseMs=performance.now()-startBase;
    const startTrie=performance.now(),right=matcher.trie(tokens),trieMs=performance.now()-startTrie;
    const parity=matcher.parity(tokens);
    if(left.length!==right.length)throw new Error('candidate mismatch');
    results.push({length,inputDigest,baseMs,trieMs,...parity});
  }
  return {
    kind:'jo321-symbolid-search-poc',packDigest:source.packDigest,keys:matcher.keyCount,
    inputLengths:matcher.lengthCount,trieNodes:matcher.nodes,trieEdges:matcher.edges,
    buildMs,memoryBefore:before,memoryAfter:after,results,
    scope:'Only exact SymbolId key candidate discovery; excludes tokenContext alternatives, VM, stages, lexical/Ruby, browser/network. Synthetic SymbolId input; no long-text speed claim. Timing single-shot; no p95 or peak RSS.'
  };
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const lengths=(process.argv.find(x=>x.startsWith('--lengths='))?.slice(10)??'250,1000,3000')
    .split(',').map(Number);
  if(lengths.length<1||lengths.length>4||lengths.some(x=>!Number.isSafeInteger(x)||x<1||x>10000))
    throw new Error('invalid bounded lengths');
  process.stdout.write(JSON.stringify(await measureSearchCandidates(process.cwd(),lengths),null,2)+'\n');
}

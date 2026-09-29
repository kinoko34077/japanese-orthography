import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { compileLexicalSourceSlice, serializeLexicalArtifact, type UniDicSourceSlice } from './lexical-compiler.ts';

const sourcePath = 'data/lexical/sources/unidic-cwj-202512-first-slice.json';
const runtimePath = 'runtime/lexical-runtime.js';

const sourceText = await readFile(sourcePath, 'utf8');
const runtimeSource = await readFile(runtimePath, 'utf8');
const sourceSlice = JSON.parse(sourceText) as UniDicSourceSlice;
const artifact = compileLexicalSourceSlice(sourceSlice);
const artifactText = serializeLexicalArtifact(artifact);
const normalizedProjectionText = JSON.stringify({
  lemmas: artifact.lemmas,
  morphologies: artifact.morphologies,
  candidates: artifact.candidates,
  surfaceIndex: artifact.surfaceIndex
});
const surfaceIndexText = JSON.stringify(artifact.surfaceIndex);

const heapBefore = process.memoryUsage().heapUsed;
const initStart = performance.now();
const sandbox: Record<string, any> = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(runtimeSource, sandbox, { filename: runtimePath });
const runtime = sandbox.LexicalRuntime.createLexicalRuntime(artifact);
const coldInitializationMs = performance.now() - initStart;
const retainedHeapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;

const firstStart = performance.now();
runtime.lookup('学校');
const firstLookupMs = performance.now() - firstStart;

const corpus = ['学校', '今日', '台風', '味わおう', '未知語'];
const repeatedOperations = 50_000;
const repeatedStart = performance.now();
for (let index = 0; index < repeatedOperations; index += 1) {
  runtime.lookup(corpus[index % corpus.length]);
}
const repeatedTotalMs = performance.now() - repeatedStart;

const decodeOperations = 20_000;
const decodeStart = performance.now();
for (let index = 0; index < decodeOperations; index += 1) {
  runtime.lookup('今日');
}
const decodeTotalMs = performance.now() - decodeStart;

const sourceSliceBytes = Buffer.byteLength(sourceText, 'utf8');
const runtimeModuleBytes = Buffer.byteLength(runtimeSource, 'utf8');
const runtimeArtifactBytes = Buffer.byteLength(artifactText, 'utf8');

const report = {
  schemaVersion: 1,
  scope: 'real-lexical-evidence-acceptance-slice',
  productionThreshold: null,
  caveat: 'Development baseline for the bounded acceptance slice; not a production/full-corpus threshold.',
  lexicalNamespaceId: artifact.lexicalNamespaceId,
  artifactContentId: artifact.artifactContentId,
  sourceSliceBytes,
  normalizedProjectionBytes: Buffer.byteLength(normalizedProjectionText, 'utf8'),
  runtimeArtifactBytes,
  surfaceIndexBytes: Buffer.byteLength(surfaceIndexText, 'utf8'),
  runtimeModuleBytes,
  coldInitializationMs,
  retainedHeapDeltaBytes,
  firstLookupMs,
  repeatedLookup: {
    operations: repeatedOperations,
    totalMs: repeatedTotalMs,
    meanMicros: repeatedTotalMs * 1000 / repeatedOperations,
    opsPerSecond: repeatedOperations * 1000 / Math.max(repeatedTotalMs, Number.EPSILON)
  },
  candidateDecode: {
    operations: decodeOperations,
    totalMs: decodeTotalMs,
    meanMicros: decodeTotalMs * 1000 / decodeOperations,
    includesSurfaceIndexSearch: true
  },
  observableLoadCopies: {
    count: 3,
    bytes: sourceSliceBytes + runtimeModuleBytes + runtimeArtifactBytes,
    internalRuntimeCopiesObserved: false
  }
};

process.stdout.write(`${JSON.stringify(report)}\n`);

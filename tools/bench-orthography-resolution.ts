import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

type Fixture = {
  lexicalRecords: Array<Record<string, any>>;
  historicalRelations: Array<Record<string, any>>;
  safeKanjiMap: Record<string, string>;
};

type Resolver = {
  resolveUnit: (input: string, options?: { protected?: boolean }) => any;
  render: (unit: any, options?: { mode?: string }) => string;
};

type ResolverApi = {
  createResolver: (config: Record<string, any>) => Resolver;
};

const loadUmd = (
  source: string,
  filename: string,
  globals: Record<string, unknown> = {}
): Record<string, any> => {
  const sandbox: Record<string, any> = { ...globals };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename });
  return sandbox;
};

const toText = (buffer: Buffer): string => buffer.toString("utf8");

const safeRate = (count: number, elapsedMs: number): number => (
  elapsedMs > 0 ? count / (elapsedMs / 1000) : Number.POSITIVE_INFINITY
);

const run = async () => {
  const heapBefore = process.memoryUsage().heapUsed;
  const coldStart = performance.now();

  const [sharedBuffer, resolverBuffer, fixtureBuffer, contextualBuffer, safetyBuffer] = await Promise.all([
    readFile("runtime/transform-shared.js"),
    readFile("runtime/orthography-resolver.js"),
    readFile("test/fixtures/orthography-resolution/first-slice.json"),
    readFile("test/golden/contextual-kanji/hot-relations.json"),
    readFile("test/golden/contextual-kanji/hot-safety.json")
  ]);

  const sharedSource = toText(sharedBuffer);
  const resolverSource = toText(resolverBuffer);
  const fixture = JSON.parse(toText(fixtureBuffer)) as Fixture;
  const contextualRelations = JSON.parse(toText(contextualBuffer)) as Array<Record<string, any>>;
  const contextualSafety = JSON.parse(toText(safetyBuffer)) as Array<Record<string, any>>;

  const sharedSandbox = loadUmd(sharedSource, "runtime/transform-shared.js");
  const resolverSandbox = loadUmd(resolverSource, "runtime/orthography-resolver.js", {
    TransformShared: sharedSandbox.TransformShared
  });
  const api = resolverSandbox.OrthographyResolver as ResolverApi;

  let lexicalLookupCount = 0;
  const resolver = api.createResolver({
    lexicalLookup(surface: string) {
      lexicalLookupCount += 1;
      return fixture.lexicalRecords.filter((record) => record.surface === surface);
    },
    historicalLookup(candidate: Record<string, any>) {
      return fixture.historicalRelations.find(
        (relation) => relation.lexicalIdentity === candidate.lexicalIdentity
      ) ?? null;
    },
    contextualRelations,
    contextualSafety,
    safeKanjiMap: fixture.safeKanjiMap
  });

  const coldInitializationMs = performance.now() - coldStart;
  const heapAfterInitialization = process.memoryUsage().heapUsed;
  const retainedHeapDeltaBytes = heapAfterInitialization - heapBefore;

  const corpus = [
    "学校",
    "｜学校《がっこう》",
    "学《がく》校《こう》",
    "台風",
    "合弁",
    "武弁",
    "合わない",
    "未知語"
  ];

  for (let index = 0; index < 100; index += 1) {
    resolver.resolveUnit(corpus[index % corpus.length]!);
  }

  const resolveIterations = 2000;
  const resolveOperations = resolveIterations * corpus.length;
  const resolveStart = performance.now();
  for (let iteration = 0; iteration < resolveIterations; iteration += 1) {
    for (const input of corpus) {
      resolver.resolveUnit(input);
    }
  }
  const resolveTotalMs = performance.now() - resolveStart;

  const transformIterations = 1000;
  const corpusCharacters = corpus.reduce((sum, input) => sum + Array.from(input).length, 0);
  const transformInputCharacters = transformIterations * corpusCharacters;
  const transformStart = performance.now();
  for (let iteration = 0; iteration < transformIterations; iteration += 1) {
    for (const input of corpus) {
      const unit = resolver.resolveUnit(input);
      resolver.render(unit, { mode: "plain" });
    }
  }
  const transformTotalMs = performance.now() - transformStart;

  const explicitCopyBuffers = [
    sharedBuffer,
    resolverBuffer,
    fixtureBuffer,
    contextualBuffer,
    safetyBuffer
  ];

  const report = {
    schemaVersion: 1,
    scope: "orthography-resolution-first-slice",
    caveat: "Deterministic first-slice baseline only; not a production threshold or full-corpus performance claim.",
    productionThreshold: null,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
    runtimeModuleBytes: resolverBuffer.byteLength,
    sharedRuntimeDependencyBytes: sharedBuffer.byteLength,
    fixtureBytes: fixtureBuffer.byteLength,
    reusedContextualBytes: contextualBuffer.byteLength + safetyBuffer.byteLength,
    coldInitializationMs,
    retainedHeapDeltaBytes,
    explicitLoadCopies: {
      count: explicitCopyBuffers.length,
      bytes: explicitCopyBuffers.reduce((sum, buffer) => sum + buffer.byteLength, 0),
      description: "Harness-observable Buffer-to-UTF8 decode inputs; VM/compiler internal copies are not exposed by Node.",
      internalRuntimeCopiesObserved: false
    },
    resolve: {
      corpusSize: corpus.length,
      iterations: resolveIterations,
      operations: resolveOperations,
      totalMs: resolveTotalMs,
      meanMicros: (resolveTotalMs * 1000) / resolveOperations,
      opsPerSecond: safeRate(resolveOperations, resolveTotalMs),
      lexicalLookupCalls: lexicalLookupCount
    },
    transform: {
      corpusSize: corpus.length,
      iterations: transformIterations,
      inputCharacters: transformInputCharacters,
      totalMs: transformTotalMs,
      charactersPerSecond: safeRate(transformInputCharacters, transformTotalMs)
    },
    cache: null
  };

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
};

await run();

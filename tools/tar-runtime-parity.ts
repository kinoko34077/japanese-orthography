import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildAcceptedBrowserPackV3 } from './generate-browser-pack.ts';
import { KINOTCH_PROFILE } from './orthography-policy.ts';
import { TAR_PARITY_FIXTURE, type TarParityCase } from './tar-parity.ts';
import { normalizeCheckoutText } from './verification-text.ts';

const require = createRequire(import.meta.url);
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { createTransformService } = require('../runtime/browser-transform-worker.js');

export const TAR_RUNTIME_PARITY_REPORT = 'data/reports/tar-runtime-parity.json';
export const TAR_RUNTIME_PARITY_SUMMARY = 'data/reports/tar-runtime-parity-summary.json';

export type RuntimeParityStatus =
  | 'PASS'
  | 'FAIL'
  | 'CONTEXT_REQUIRED'
  | 'CANDIDATE_REQUIRED'
  | 'PATTERN_REQUIRED'
  | 'DISABLED';

interface FixtureDocument {
  schemaVersion: string;
  kind: string;
  originVocabulary: string[];
  accounting: { fixtureRecords: number };
  records: TarParityCase[];
}

interface RuntimeParityRecord {
  caseId: string;
  origin: 'kinotch' | 'tar';
  status: RuntimeParityStatus;
  family: string;
  input: string;
  expectedOutputs: string[];
  actualOutput: string | null;
  sourceKind: TarParityCase['sourceKind'];
  sourceEnabled: boolean | null;
  sourceRefs: TarParityCase['sourceRefs'];
  reason: string | null;
}

const hasPayload = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return String(value).trim().length > 0;
};

const familyOf = (record: TarParityCase): string => {
  if (record.nodePath.length > 0) return record.nodePath.join(' > ');
  const flat = record.sourceRefs.find((ref) => ref.kind === 'flat');
  return flat?.groupLabel || flat?.sourceCategory || 'flat-only';
};

const requiresContext = (record: TarParityCase): boolean =>
  Boolean(record.ruleType)
  || hasPayload(record.conditions)
  || hasPayload(record.sequence)
  || hasPayload(record.matchOptions)
  || hasPayload(record.matchTarget);

const preStatus = (record: TarParityCase): RuntimeParityStatus | null => {
  if (record.sourceEnabled === false) return 'DISABLED';
  if (record.regex || record.wildcard) return 'PATTERN_REQUIRED';
  if (record.expectedOutputs.length !== 1) return 'CANDIDATE_REQUIRED';
  if (requiresContext(record)) return 'CONTEXT_REQUIRED';
  return null;
};

const counts = <T extends string>(values: readonly T[]): Record<T, number> => {
  const out = {} as Record<T, number>;
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
};

export async function buildTarRuntimeParityArtifacts(rootDir: string) {
  const fixture = JSON.parse(await readFile(resolve(rootDir, TAR_PARITY_FIXTURE), 'utf8')) as FixtureDocument;
  if (fixture.accounting.fixtureRecords !== fixture.records.length) throw new Error('TAR runtime parity fixture count mismatch');
  if (fixture.records.some((record) => record.origin !== 'kinotch' && record.origin !== 'tar')) {
    throw new Error('TAR runtime parity encountered unknown origin');
  }

  const tentative = new Map<string, RuntimeParityStatus | null>();
  for (const record of fixture.records) tentative.set(record.id, preStatus(record));

  // If several otherwise-simple active TAR intents share one naked input but disagree on output,
  // a bare input cannot prove which old rule wins. Keep the case for the precedence/candidate gate.
  const simpleByInput = new Map<string, TarParityCase[]>();
  for (const record of fixture.records) {
    if (tentative.get(record.id) !== null) continue;
    const rows = simpleByInput.get(record.from) ?? [];
    rows.push(record);
    simpleByInput.set(record.from, rows);
  }
  const conflictInputs = new Set<string>();
  for (const [input, rows] of simpleByInput) {
    const outputs = new Set(rows.flatMap((record) => record.expectedOutputs));
    if (outputs.size > 1) conflictInputs.add(input);
  }

  const executable = fixture.records.filter((record) =>
    tentative.get(record.id) === null && !conflictInputs.has(record.from)
  );
  const uniqueInputs = [...new Set(executable.map((record) => record.from))].sort((a, b) => a.localeCompare(b, 'ja'));

  const build = await buildAcceptedBrowserPackV3(rootDir);
  const service = createTransformService({
    executionMode: 'vm-authoritative',
    openPack: async () => openBrowserPack(build.manifest, async (section: { path: string }) => {
      const body = build.files.get(section.path);
      if (!body) throw new Error('missing in-memory BrowserPack section ' + section.path);
      return body;
    })
  });

  const actualByInput = new Map<string, string>();
  let requestId = 0;
  for (const input of uniqueInputs) {
    const reply = await service.handle({
      type: 'transform',
      requestId: ++requestId,
      text: input,
      profileId: KINOTCH_PROFILE.profileId,
      renderMode: 'plain',
      executionMode: 'vm-authoritative'
    });
    if (reply?.type !== 'result') throw new Error('runtime parity execution failed for ' + JSON.stringify(input) + ': ' + (reply?.message ?? 'unknown error'));
    actualByInput.set(input, String(reply.result?.renderedText ?? ''));
    if (requestId % 250 === 0) console.log('TAR runtime parity executed ' + requestId + '/' + uniqueInputs.length + ' unique simple inputs');
  }
  if (service.opens() !== 1) throw new Error('TAR runtime parity must reuse one BrowserPack instance');

  const records: RuntimeParityRecord[] = fixture.records.map((record) => {
    let status: RuntimeParityStatus | null = tentative.get(record.id) ?? null;
    let actualOutput: string | null = null;
    let reason: string | null = null;

    if (status === null && conflictInputs.has(record.from)) {
      status = 'CANDIDATE_REQUIRED';
      reason = 'multiple active simple TAR intents share this input with different expected outputs';
    } else if (status === null) {
      actualOutput = actualByInput.get(record.from) ?? null;
      if (actualOutput === null) throw new Error('missing runtime result for ' + record.id);
      status = record.expectedOutputs.includes(actualOutput) ? 'PASS' : 'FAIL';
      if (status === 'FAIL') reason = 'vm-authoritative plain output differs from TAR expected output';
    } else if (status === 'CONTEXT_REQUIRED') {
      reason = 'TAR rule has type/context/sequence/match semantics that naked input cannot validate';
    } else if (status === 'CANDIDATE_REQUIRED') {
      reason = 'TAR rule requires candidate/alternative semantics';
    } else if (status === 'PATTERN_REQUIRED') {
      reason = 'TAR rule requires regex/wildcard pattern semantics';
    } else if (status === 'DISABLED') {
      reason = 'TAR source rule is disabled';
    }

    if (status === null) throw new Error('TAR runtime parity status remained unresolved for ' + record.id);

    return {
      caseId: record.id,
      origin: record.origin,
      status,
      family: familyOf(record),
      input: record.from,
      expectedOutputs: record.expectedOutputs,
      actualOutput,
      sourceKind: record.sourceKind,
      sourceEnabled: record.sourceEnabled,
      sourceRefs: record.sourceRefs,
      reason
    };
  });

  const statusCounts = counts(records.map((record) => record.status));
  const familyFail: Record<string, number> = {};
  for (const record of records) if (record.status === 'FAIL') familyFail[record.family] = (familyFail[record.family] ?? 0) + 1;
  const familyFailSorted = Object.fromEntries(Object.entries(familyFail).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')));

  const report = {
    schemaVersion: '1',
    kind: 'tar-runtime-parity',
    owner: 'japanese-orthography#285',
    finalExecutionParity: false,
    sourceFixture: TAR_PARITY_FIXTURE,
    baseline: {
      profileId: KINOTCH_PROFILE.profileId,
      executionMode: 'vm-authoritative',
      browserPackCompilerVersion: build.manifest.compilerVersion,
      browserPackDigest: build.manifest.packDigest
    },
    accounting: {
      fixtureRecords: fixture.records.length,
      reportRecords: records.length,
      dropped: fixture.records.length - records.length,
      uniqueSimpleInputsExecuted: uniqueInputs.length,
      executableCasesTested: records.filter((record) => record.status === 'PASS' || record.status === 'FAIL').length,
      conflictingSimpleInputsDeferred: conflictInputs.size
    },
    statuses: statusCounts,
    familyFail: familyFailSorted,
    records
  };

  const summary = {
    schemaVersion: '1',
    kind: 'tar-runtime-parity-summary',
    owner: 'japanese-orthography#285',
    finalExecutionParity: false,
    requiredNextGates: ['context-parity', 'candidate-parity', 'pattern-parity', 'runtime-fail-repair'],
    sourceFixtureDigest: createHash('sha256').update(JSON.stringify(fixture.records)).digest('hex'),
    reportDigest: createHash('sha256').update(JSON.stringify(records)).digest('hex'),
    baseline: report.baseline,
    accounting: report.accounting,
    statuses: report.statuses,
    familyFail: report.familyFail,
    origins: counts(records.map((record) => record.origin))
  };

  return {
    report,
    summary,
    texts: {
      [TAR_RUNTIME_PARITY_REPORT]: JSON.stringify(report, null, 2) + '\n',
      [TAR_RUNTIME_PARITY_SUMMARY]: JSON.stringify(summary, null, 2) + '\n'
    }
  };
}

async function main(): Promise<void> {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const artifacts = await buildTarRuntimeParityArtifacts(rootDir);
  if (artifacts.report.accounting.fixtureRecords !== 4036) throw new Error('expected 4036 TAR parity fixture records');
  if (artifacts.report.accounting.dropped !== 0) throw new Error('TAR runtime parity dropped fixture records');

  if (process.argv.includes('--check')) {
    for (const [path, text] of Object.entries(artifacts.texts)) {
      const committed = normalizeCheckoutText(await readFile(resolve(rootDir, path), 'utf8'));
      if (committed !== text) throw new Error('stale ' + path + '; run npm run generate:tar-runtime-parity');
    }
    console.log('TAR runtime parity OK: ' + artifacts.report.accounting.reportRecords + ' cases; statuses ' + JSON.stringify(artifacts.summary.statuses));
    return;
  }

  for (const [path, text] of Object.entries(artifacts.texts)) {
    await mkdir(dirname(resolve(rootDir, path)), { recursive: true });
    await writeFile(resolve(rootDir, path), text);
  }
  console.log(JSON.stringify(artifacts.summary, null, 2));
}

if (process.argv[1]?.endsWith('tar-runtime-parity.ts')) await main();

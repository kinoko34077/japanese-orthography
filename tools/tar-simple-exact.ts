import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const TAR_COMMIT = '198f8560613d23417cb0f87172ae8662e722ca30';
const BASELINE_MAIN = '7e9c807f45ecc286064080033ca456f2f4b0eb81';
const BASELINE_REPORT_DIGEST = '7c36e2fee0084a95b3cc72014a4689848f96e029decc5a6c9525117f2e76ee30';
const TAR_FIXTURE = 'data/migrations/tar/' + TAR_COMMIT + '/parity-fixture.json';
const TAR_RUNTIME_REPORT = 'data/reports/tar-runtime-parity.json';
const TAR_RUNTIME_SUMMARY = 'data/reports/tar-runtime-parity-summary.json';
export const TAR_SIMPLE_EXACT_CORPUS = 'data/migrations/tar/' + TAR_COMMIT + '/simple-exact-rules.json';

type SourceRef = {
  kind: 'structured' | 'flat';
  path: string;
  locator: string;
  sourceId?: string;
  groupId?: string;
  groupLabel?: string;
  status?: string;
  sourceCategory?: string;
};

type FixtureRecord = {
  id: string;
  origin: 'kinotch' | 'tar';
  from: string;
  expectedOutputs: string[];
  sourceEnabled: boolean | null;
  regex: boolean;
  wildcard: boolean;
  ruleType?: string | null;
  conditions: unknown;
  sequence: unknown;
  matchOptions: unknown;
  matchTarget: unknown;
  sourceRefs: SourceRef[];
};

type RuntimeRecord = {
  caseId: string;
  status: string;
  family: string;
  input: string;
  expectedOutputs: string[];
  sourceRefs: SourceRef[];
};

export interface TarSimpleExactRecord {
  id: string;
  origin: 'tar';
  from: string;
  to: string;
  sourceCaseIds: string[];
  sourceRefs: SourceRef[];
  families: string[];
}

const readJson = async (rootDir: string, path: string) =>
  JSON.parse(await readFile(resolve(rootDir, path), 'utf8')) as any;

const hasPayload = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return String(value).trim().length > 0;
};

const isSimpleExact = (record: FixtureRecord): boolean =>
  record.sourceEnabled !== false
  && !record.regex
  && !record.wildcard
  && !record.ruleType
  && !hasPayload(record.conditions)
  && !hasPayload(record.sequence)
  && !hasPayload(record.matchOptions)
  && !hasPayload(record.matchTarget)
  && record.expectedOutputs.length === 1;

const stableId = (from: string, to: string) =>
  'tar:exact:' + createHash('sha256').update(from + '\0' + to).digest('hex').slice(0, 16);

const uniqRefs = (refs: SourceRef[]): SourceRef[] => {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const ref of refs) {
    const key = JSON.stringify(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
};

export async function buildTarSimpleExactBootstrap(rootDir: string) {
  const [summary, report, fixture] = await Promise.all([
    readJson(rootDir, TAR_RUNTIME_SUMMARY),
    readJson(rootDir, TAR_RUNTIME_REPORT),
    readJson(rootDir, TAR_FIXTURE)
  ]);
  if (summary.reportDigest !== BASELINE_REPORT_DIGEST) {
    throw new Error('TAR simple-exact bootstrap requires accepted #285 runtime report digest ' + BASELINE_REPORT_DIGEST);
  }
  if (summary.baseline?.profileId !== 'kinotch-fixed' || summary.baseline?.executionMode !== 'vm-authoritative') {
    throw new Error('TAR simple-exact bootstrap requires #285 kinotch-fixed/vm-authoritative baseline');
  }

  const fixtureById = new Map<string, FixtureRecord>(fixture.records.map((record: FixtureRecord) => [record.id, record]));
  const selected = (report.records as RuntimeRecord[]).filter((record) => record.status === 'PASS' || record.status === 'FAIL');
  const baselinePassCases = selected.filter((record) => record.status === 'PASS').length;
  const baselineFailCases = selected.filter((record) => record.status === 'FAIL').length;
  if (selected.length !== 3166 || baselinePassCases !== 31 || baselineFailCases !== 3135) {
    throw new Error('expected #285 simple baseline PASS=31 / FAIL=3135 / total=3166');
  }

  const grouped = new Map<string, TarSimpleExactRecord>();
  const outputsByInput = new Map<string, Set<string>>();
  for (const runtime of selected) {
    const source = fixtureById.get(runtime.caseId);
    if (!source) throw new Error('runtime simple case references missing fixture case ' + runtime.caseId);
    if (!isSimpleExact(source)) throw new Error('runtime selected case is not simple exact: ' + runtime.caseId);
    const to = source.expectedOutputs[0]!;
    if (runtime.input !== source.from || runtime.expectedOutputs.length !== 1 || runtime.expectedOutputs[0] !== to) {
      throw new Error('runtime/fixture mismatch for ' + runtime.caseId);
    }
    const pair = JSON.stringify([source.from, to]);
    let target = grouped.get(pair);
    if (!target) {
      target = {
        id: stableId(source.from, to),
        origin: 'tar',
        from: source.from,
        to,
        sourceCaseIds: [],
        sourceRefs: [],
        families: []
      };
      grouped.set(pair, target);
    }
    target.sourceCaseIds.push(source.id);
    target.sourceRefs.push(...source.sourceRefs);
    if (!target.families.includes(runtime.family)) target.families.push(runtime.family);

    const outputs = outputsByInput.get(source.from) ?? new Set<string>();
    outputs.add(to);
    outputsByInput.set(source.from, outputs);
  }

  const conflicts = [...outputsByInput].filter(([, outputs]) => outputs.size > 1);
  if (conflicts.length !== 0) throw new Error('TAR simple-exact baseline has conflicting outputs for ' + conflicts.length + ' inputs');

  const records = [...grouped.values()]
    .map((record) => ({
      ...record,
      sourceCaseIds: [...new Set(record.sourceCaseIds)].sort(),
      sourceRefs: uniqRefs(record.sourceRefs),
      families: [...new Set(record.families)].sort()
    }))
    .sort((a, b) => a.from.localeCompare(b.from, 'ja') || a.to.localeCompare(b.to, 'ja'));

  if (records.length !== 3163) throw new Error('expected 3163 unique simple exact relations, got ' + records.length);

  return {
    schemaVersion: '1',
    kind: 'tar-simple-exact-rules',
    owner: 'japanese-orthography#287',
    originVocabulary: ['kinotch', 'tar'],
    selection: {
      sourceCommit: TAR_COMMIT,
      baselineMain: BASELINE_MAIN,
      runtimeReport: TAR_RUNTIME_REPORT,
      runtimeReportDigest: BASELINE_REPORT_DIGEST
    },
    accounting: {
      baselineExecutableCases: selected.length,
      baselinePassCases,
      baselineFailCases,
      uniqueRelations: records.length,
      uniqueInputs: outputsByInput.size,
      conflictingInputs: conflicts.length,
      duplicateCaseExcess: selected.length - records.length
    },
    recordsDigest: createHash('sha256').update(JSON.stringify(records)).digest('hex'),
    records
  };
}

export async function validateTarSimpleExactCorpus(rootDir: string) {
  const [doc, fixture] = await Promise.all([
    readJson(rootDir, TAR_SIMPLE_EXACT_CORPUS),
    readJson(rootDir, TAR_FIXTURE)
  ]);
  if (doc.kind !== 'tar-simple-exact-rules' || doc.owner !== 'japanese-orthography#287') throw new Error('invalid TAR simple-exact corpus identity');
  if (doc.selection?.sourceCommit !== TAR_COMMIT || doc.selection?.baselineMain !== BASELINE_MAIN || doc.selection?.runtimeReportDigest !== BASELINE_REPORT_DIGEST) {
    throw new Error('TAR simple-exact corpus baseline drift');
  }
  if (!Array.isArray(doc.records) || doc.records.length !== 3163) throw new Error('TAR simple-exact corpus must contain 3163 relations');

  const fixtureById = new Map<string, FixtureRecord>(fixture.records.map((record: FixtureRecord) => [record.id, record]));
  const ids = new Set<string>();
  const inputs = new Set<string>();
  const caseIds = new Set<string>();
  for (const record of doc.records as TarSimpleExactRecord[]) {
    if (record.origin !== 'tar') throw new Error(record.id + ': origin must be tar');
    if (record.id !== stableId(record.from, record.to)) throw new Error(record.id + ': unstable rule id');
    if (ids.has(record.id)) throw new Error('duplicate TAR simple-exact rule id ' + record.id);
    if (inputs.has(record.from)) throw new Error('conflicting/duplicate TAR simple-exact input ' + JSON.stringify(record.from));
    if (!record.sourceCaseIds.length || !record.sourceRefs.length) throw new Error(record.id + ': missing provenance');
    ids.add(record.id);
    inputs.add(record.from);

    for (const caseId of record.sourceCaseIds) {
      if (caseIds.has(caseId)) throw new Error('TAR simple-exact source case assigned twice: ' + caseId);
      caseIds.add(caseId);
      const source = fixtureById.get(caseId);
      if (!source) throw new Error(record.id + ': missing fixture case ' + caseId);
      if (!isSimpleExact(source)) throw new Error(record.id + ': fixture case is no longer simple exact: ' + caseId);
      if (source.origin !== 'tar' || source.from !== record.from || source.expectedOutputs[0] !== record.to) {
        throw new Error(record.id + ': fixture semantics drift for ' + caseId);
      }
    }
  }

  if (caseIds.size !== 3166) throw new Error('TAR simple-exact corpus must cover all 3166 baseline executable simple cases');
  const digest = createHash('sha256').update(JSON.stringify(doc.records)).digest('hex');
  if (doc.recordsDigest !== digest) throw new Error('TAR simple-exact corpus recordsDigest drift');
  if (doc.accounting?.uniqueRelations !== 3163
    || doc.accounting?.baselineExecutableCases !== 3166
    || doc.accounting?.baselinePassCases !== 31
    || doc.accounting?.baselineFailCases !== 3135
    || doc.accounting?.conflictingInputs !== 0) {
    throw new Error('TAR simple-exact accounting drift');
  }
  return doc;
}

async function main() {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  if (process.argv.includes('--bootstrap')) {
    const doc = await buildTarSimpleExactBootstrap(rootDir);
    await mkdir(dirname(resolve(rootDir, TAR_SIMPLE_EXACT_CORPUS)), { recursive: true });
    await writeFile(resolve(rootDir, TAR_SIMPLE_EXACT_CORPUS), JSON.stringify(doc, null, 2) + '\n');
    console.log('TAR simple-exact bootstrap wrote ' + doc.records.length + ' rules; digest ' + doc.recordsDigest);
    return;
  }
  const doc = await validateTarSimpleExactCorpus(rootDir);
  console.log('TAR simple-exact OK: ' + doc.records.length + ' rules / ' + doc.accounting.baselineExecutableCases + ' baseline simple cases');
}

if (process.argv[1]?.endsWith('tar-simple-exact.ts')) await main();

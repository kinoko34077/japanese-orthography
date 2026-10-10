import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const TAR_PROFILE_HOME = 'data/profiles/kinotch/tar-operational-rules';
export const TAR_PROFILE_INDEX = TAR_PROFILE_HOME + '/source-case-index.json';
export const TAR_PROFILE_MANIFEST = TAR_PROFILE_HOME + '/manifest.json';
const SOURCE_COMMIT = '198f8560613d23417cb0f87172ae8662e722ca30';
const MIGRATION_HOME = 'data/migrations/tar/' + SOURCE_COMMIT;
const FIXTURE = MIGRATION_HOME + '/parity-fixture.json';
const STATIC_SUMMARY = 'data/reports/tar-parity-summary.json';
const RUNTIME_SUMMARY = 'data/reports/tar-runtime-parity-summary.json';
const RUNTIME_REPORT = 'data/reports/tar-runtime-parity.json';
const CORPUS = ['simple-exact', 'context', 'candidate', 'pattern'] as const;

type SourceCaseReference = {
  sourceCaseId: string;
  corpusPath: string;
  recordIndex: number;
  recordId: string;
};

type ProfileIndex = {
  schemaVersion: string;
  kind: string;
  profileId: string;
  sourceCommit: string;
  entries: SourceCaseReference[];
  disabledSourceCaseIds: string[];
};

type ProfileManifest = {
  schemaVersion: string;
  kind: string;
  owner: string;
  profileId: string;
  authority: string;
  origin: string;
  source: { repository: string; commit: string; paths: string[]; flatRecords: number; structuredRuleObjects: number };
  referenceIndex: string;
  canonicalCorpora: Array<{ path: string; records: number; cases: number }>;
  evidence: { fixture: string; staticSummary: string; runtimeSummary: string; runtimeReport: string };
  accounting: { fixtureCases: number; indexedCases: number; disabledCases: number; dropped: number };
  policy: { genericRuleAdmission: boolean; disabledRulesActivated: boolean; ruleBodiesDuplicated: boolean };
};

const read = async (root: string, path: string): Promise<any> =>
  JSON.parse(await readFile(resolve(root, path), 'utf8'));

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('TAR profile home: ' + message);
};

const ordered = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const serialize = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

export async function buildTarProfileHome(root: string): Promise<{ index: ProfileIndex; manifest: ProfileManifest }> {
  const paths = CORPUS.map((kind) => MIGRATION_HOME + '/' + kind + '-rules.json');
  const [corpora, fixture, staticSummary, runtimeSummary, runtimeReport] = await Promise.all([
    Promise.all(paths.map((path) => read(root, path))),
    read(root, FIXTURE), read(root, STATIC_SUMMARY), read(root, RUNTIME_SUMMARY), read(root, RUNTIME_REPORT)
  ]);

  ensure(Array.isArray(fixture.records) && fixture.records.length === 4036, 'fixture must contain 4036 source cases');
  ensure(fixture.accounting?.flatRecords === 3438 && fixture.accounting?.structuredRuleObjects === 2279,
    'pinned flat/structured source counts differ');
  ensure(fixture.accounting?.unaccountedFlat === 0 && fixture.accounting?.unaccountedStructured === 0,
    'unaccounted source records');
  ensure(staticSummary.sourceCommit === SOURCE_COMMIT &&
    staticSummary.accounting?.fixtureRecords === 4036 &&
    staticSummary.accounting?.flatRecords === 3438 &&
    staticSummary.accounting?.structuredRuleObjects === 2279,
    'static source/parity summary mismatch');
  ensure(staticSummary.fixtureDigest === runtimeSummary.sourceFixtureDigest, 'source fixture digest drift');
  ensure(runtimeSummary.finalExecutionParity === true &&
    Array.isArray(runtimeSummary.requiredNextGates) && runtimeSummary.requiredNextGates.length === 0 &&
    runtimeSummary.accounting?.fixtureRecords === 4036 &&
    runtimeSummary.accounting?.reportRecords === 4036 &&
    runtimeSummary.accounting?.dropped === 0 &&
    runtimeSummary.accounting?.executableCasesTested === 4008 &&
    runtimeSummary.statuses?.PASS === 4008 && runtimeSummary.statuses?.DISABLED === 28,
    'runtime parity acceptance mismatch');
  ensure(runtimeReport.accounting?.fixtureRecords === 4036 &&
    runtimeReport.accounting?.reportRecords === 4036 &&
    runtimeReport.accounting?.dropped === 0 &&
    runtimeReport.statuses?.PASS === 4008 && runtimeReport.statuses?.DISABLED === 28 &&
    Array.isArray(runtimeReport.records) && runtimeReport.records.length === 4036,
    'runtime parity report mismatch');

  const fixtureById = new Map<string, any>();
  for (const record of fixture.records as any[]) {
    ensure(typeof record.id === 'string' && !fixtureById.has(record.id), 'invalid or duplicate fixture case');
    fixtureById.set(record.id, record);
  }
  const runtimeById = new Map<string, any>();
  for (const record of runtimeReport.records as any[]) {
    ensure(typeof record.caseId === 'string' && !runtimeById.has(record.caseId), 'invalid/duplicate runtime case');
    runtimeById.set(record.caseId, record);
  }
  ensure(runtimeById.size === fixtureById.size, 'runtime/fixture case counts diverge');

  const entries: SourceCaseReference[] = [];
  const corpusCounts: number[] = [];
  for (const [corpusIndex, doc] of corpora.entries()) {
    const path = paths[corpusIndex];
    ensure(typeof path === 'string' && Array.isArray(doc.records), 'invalid canonical corpus');
    const expectedCount = [3163, 670, 165, 7][corpusIndex];
    ensure(doc.records.length === expectedCount, 'canonical record count drift in ' + path);
    let cases = 0;
    for (const [recordIndex, record] of (doc.records as any[]).entries()) {
      const ids: unknown = corpusIndex === 0 ? record.sourceCaseIds : [record.sourceCaseId];
      const id = corpusIndex === 3 ? record.sourceRuleId : record.id;
      ensure(Array.isArray(ids) && ids.length > 0 && typeof id === 'string' && id.length > 0,
        'missing canonical record identity in ' + path);
      for (const sourceCaseId of ids) {
        ensure(typeof sourceCaseId === 'string' && sourceCaseId.length > 0,
          'invalid sourceCaseId in ' + path);
        entries.push({ sourceCaseId, corpusPath: path, recordIndex, recordId: id });
        cases += 1;
      }
    }
    corpusCounts.push(cases);
  }
  ensure(JSON.stringify(corpusCounts) === JSON.stringify([3166, 670, 165, 7]),
    'normalized rule source-case distribution drift');
  entries.sort((a, b) => ordered(a.sourceCaseId, b.sourceCaseId));
  ensure(entries.length === 4008, 'normalized source-case count must be 4008');

  const indexed = new Set<string>();
  for (const entry of entries) {
    ensure(!indexed.has(entry.sourceCaseId), 'duplicate active sourceCaseId ' + entry.sourceCaseId);
    indexed.add(entry.sourceCaseId);
    const record = fixtureById.get(entry.sourceCaseId);
    ensure(record && record.sourceEnabled !== false && record.migrationRequired === true,
      'index points to unknown/inactive source case ' + entry.sourceCaseId);
  }
  const disabled = (fixture.records as any[]).filter((record) => record.sourceEnabled === false)
    .map((record) => record.id as string).sort(ordered);
  ensure(disabled.length === 28 && new Set(disabled).size === 28, 'disabled source cases must be 28 unique');
  for (const [caseId, fixtureRecord] of fixtureById) {
    const isDisabled = fixtureRecord.sourceEnabled === false;
    ensure(indexed.has(caseId) !== isDisabled, 'missing or illegally activated source case ' + caseId);
    const runtimeRecord = runtimeById.get(caseId);
    ensure(runtimeRecord && runtimeRecord.status === (isDisabled ? 'DISABLED' : 'PASS'),
      'runtime status differs from source enablement at ' + caseId);
  }

  const index: ProfileIndex = {
    schemaVersion: '1',
    kind: 'tar-kinotch-profile-source-case-index',
    profileId: 'kinotch-fixed',
    sourceCommit: SOURCE_COMMIT,
    entries,
    disabledSourceCaseIds: disabled
  };
  const manifest: ProfileManifest = {
    schemaVersion: '1',
    kind: 'tar-kinotch-profile-rule-home-manifest',
    owner: 'japanese-orthography#299',
    profileId: 'kinotch-fixed',
    authority: 'compatibility_profile',
    origin: 'tar',
    source: {
      repository: 'kinoko34077/txt-auto-replace',
      commit: SOURCE_COMMIT,
      paths: ['tongwentang_pref6_current_json/', 'transform-settings (8).json'],
      flatRecords: 3438,
      structuredRuleObjects: 2279
    },
    referenceIndex: 'source-case-index.json',
    canonicalCorpora: paths.map((path, i) => ({
      path,
      records: corpora[i].records.length as number,
      cases: corpusCounts[i] as number
    })),
    evidence: {
      fixture: FIXTURE, staticSummary: STATIC_SUMMARY,
      runtimeSummary: RUNTIME_SUMMARY, runtimeReport: RUNTIME_REPORT
    },
    accounting: { fixtureCases: 4036, indexedCases: 4008, disabledCases: 28, dropped: 0 },
    policy: { genericRuleAdmission: false, disabledRulesActivated: false, ruleBodiesDuplicated: false }
  };
  return { index, manifest };
}

export function assertTarProfileHomeMatches(
  expected: { index: ProfileIndex; manifest: ProfileManifest },
  committed: { index: unknown; manifest: unknown }
): void {
  ensure(JSON.stringify(expected.index) === JSON.stringify(committed.index), 'source-case-index.json drift');
  ensure(JSON.stringify(expected.manifest) === JSON.stringify(committed.manifest), 'manifest.json drift');
}

export async function validateTarProfileHome(root: string): Promise<{ indexed: number; disabled: number }> {
  const [expected, index, manifest] = await Promise.all([
    buildTarProfileHome(root), read(root, TAR_PROFILE_INDEX), read(root, TAR_PROFILE_MANIFEST)
  ]);
  assertTarProfileHomeMatches(expected, { index, manifest });
  return { indexed: expected.index.entries.length, disabled: expected.index.disabledSourceCaseIds.length };
}

export async function writeTarProfileHome(root: string): Promise<void> {
  const built = await buildTarProfileHome(root);
  await mkdir(resolve(root, TAR_PROFILE_HOME), { recursive: true });
  for (const [path, document] of [
    [TAR_PROFILE_INDEX, built.index], [TAR_PROFILE_MANIFEST, built.manifest]
  ] as const) {
    const target = resolve(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, serialize(document), 'utf8');
  }
}

if (process.argv[1]?.endsWith('tar-profile-home.ts')) {
  const root = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  if (process.argv.includes('--generate')) {
    await writeTarProfileHome(root);
    console.log('TAR normalized profile home generated');
  } else {
    const result = await validateTarProfileHome(root);
    console.log('TAR normalized profile home verified:', result.indexed, 'active /', result.disabled, 'disabled');
  }
}

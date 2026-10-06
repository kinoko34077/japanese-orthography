import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { normalizeAcceptedOrthographySources } from './orthography-source-normalization.ts';
import { KINOTCH_PROFILE, withProfileRules } from './orthography-policy.ts';
import { compileRuleIR, type IRRule } from './rule-ir.ts';
import { normalizeCheckoutText } from './verification-text.ts';

export const TAR_PARITY_COMMIT = '198f8560613d23417cb0f87172ae8662e722ca30';
export const TAR_PARITY_SOURCE_ROOT = 'data/sources/txt-auto-replace/' + TAR_PARITY_COMMIT;
export const TAR_PARITY_FIXTURE = 'data/migrations/tar/' + TAR_PARITY_COMMIT + '/parity-fixture.json';
export const TAR_PARITY_DIFF = 'data/reports/tar-parity-diff.json';
export const TAR_PARITY_SUMMARY = 'data/reports/tar-parity-summary.json';

const STRUCTURED_PATH = 'transform-settings (8).json';
const FLAT_FILES = [
  'tongwentang_pref6_current_json/10-surface-normalization.json',
  'tongwentang_pref6_current_json/20-lexical-replacements.json',
  'tongwentang_pref6_current_json/30-okurigana-abbreviation.json',
  'tongwentang_pref6_current_json/40-legacy-kanji.json',
  'tongwentang_pref6_current_json/50-official-homophone-restoration.json',
  'tongwentang_pref6_current_json/55-homophone-kanji.json',
  'tongwentang_pref6_current_json/60-general-character-replacements.json',
  'tongwentang_pref6_current_json/90-review-needed.json',
  'tongwentang_pref6_current_json/存在したもの.json'
] as const;

const SOURCE_BLOBS: Record<string, string> = {
  [STRUCTURED_PATH]: '6198c575074c6218d67ef8df31b7377a98e653fe',
  'tongwentang_pref6_current_json/10-surface-normalization.json': 'c826e226003fb4f4d5850cba6d9fc1aa0af87b8e',
  'tongwentang_pref6_current_json/20-lexical-replacements.json': 'a926d45374afe40aab4281d658eaf869f237e20e',
  'tongwentang_pref6_current_json/30-okurigana-abbreviation.json': '939f4b49e148eb1c4004afe9d3d7a5dff23e4c54',
  'tongwentang_pref6_current_json/40-legacy-kanji.json': '640b64fc2f7976c8781747572dce0f9df5112089',
  'tongwentang_pref6_current_json/50-official-homophone-restoration.json': '7faa6e958ce3b255f93c0cbe6fd08d8b93b82b31',
  'tongwentang_pref6_current_json/55-homophone-kanji.json': '318c3914c7d30814ad9112f03018eeff0cdef52c',
  'tongwentang_pref6_current_json/60-general-character-replacements.json': '35c30d0e416e2ef569f0a1f2c6d60e324cc02cb2',
  'tongwentang_pref6_current_json/90-review-needed.json': '824c022253fd424bde99528e29dfe0ec0544cb9a',
  'tongwentang_pref6_current_json/存在したもの.json': '95d463579b3f15598d41d6ef2110e903f93251d1',
  'tongwentang_pref6_current_json/_META.json': '4b20e40fb2bc26257da85c502d52d32997ad9608',
  'tongwentang_pref6_current_json/README.md': '5493794e3a00f27b159b1eb49224ec8e124d9594'
};

export type MigrationOrigin = 'kinotch' | 'tar';
export type ParityStatus = 'PASS' | 'FAIL' | 'AMBIGUOUS' | 'DISABLED';

interface SourceRef {
  kind: 'structured' | 'flat';
  path: string;
  locator: string;
  sourceId?: string | undefined;
  groupId?: string | undefined;
  groupLabel?: string | undefined;
  status?: string | undefined;
  sourceCategory?: string | undefined;
}

export interface TarParityCase {
  id: string;
  origin: MigrationOrigin;
  sourceKind: 'structured' | 'flat-only';
  sourceRefs: SourceRef[];
  from: string;
  rawTo: string;
  expectedOutputs: string[];
  sourceEnabled: boolean | null;
  migrationRequired: boolean;
  priority: number;
  regex: boolean;
  wildcard: boolean;
  nodePath: string[];
  nodeKind: string | null;
  conditions: unknown;
  sequence: unknown;
  matchOptions: unknown;
  matchTarget: unknown;
}

interface FlatRecord {
  id: string;
  path: string;
  locator: string;
  from: string;
  to: string;
  groupId: string | null;
  groupLabel: string | null;
  status: string | null;
  sourceCategory: string | null;
}

const asText = (value: unknown): string => String(value ?? '').trim();

function splitCandidates(value: unknown): string[] {
  const source = asText(value);
  if (!source) return [];
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  let bracketDepth = 0;
  let escaped = false;

  for (const char of source) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted) {
      if (char === '[') bracketDepth++;
      else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
      else if (char === ',' && bracketDepth === 0) {
        const cell = current.trim();
        if (cell) cells.push(cell);
        current = '';
        continue;
      }
    }
    current += char;
  }
  if (escaped) current += '\\';
  const tail = current.trim();
  if (tail) cells.push(tail);
  return cells;
}

const normalizeExpectedOutputs = (value: unknown, regex = false): string[] => {
  const raw = String(value ?? '');
  if (regex) return [raw];
  const candidates = splitCandidates(raw);
  return candidates.length > 0 ? candidates : [raw];
};

const pairKey = (from: string, to: string) => from + '\u0000' + to;

function hasPayload(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return asText(value).length > 0;
}

async function readJson(rootDir: string, relativePath: string): Promise<any> {
  return JSON.parse(await readFile(resolve(rootDir, TAR_PARITY_SOURCE_ROOT, relativePath), 'utf8'));
}

function readCommittedBlobSha(path: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD:' + path], { encoding: 'utf8' }).trim();
}

export function verifyTarParitySourceBlobs(): void {
  for (const [path, sha] of Object.entries(SOURCE_BLOBS)) {
    const vendored = TAR_PARITY_SOURCE_ROOT + '/' + path;
    if (readCommittedBlobSha(vendored) !== sha) throw new Error('TAR source drift: ' + path);
  }
}

function collectStructured(settings: any): { cases: TarParityCase[]; ruleObjects: number; ownEnabled: number } {
  const cases: TarParityCase[] = [];
  let ruleObjects = 0;
  let ownEnabled = 0;

  const walk = (nodes: any[], locatorPrefix: string, labelPath: string[], parentEnabled: boolean) => {
    for (let nodeIndex = 0; nodeIndex < (nodes ?? []).length; nodeIndex++) {
      const node = nodes[nodeIndex] ?? {};
      const nodeLocator = locatorPrefix + '[' + nodeIndex + ']';
      const nodePath = [...labelPath, asText(node.label || node.id)].filter(Boolean);
      const nodeEnabled = parentEnabled && node.enabled !== false;

      for (const bucket of ['entries', 'rules'] as const) {
        const records = Array.isArray(node[bucket]) ? node[bucket] : [];
        for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
          const rule = records[recordIndex] ?? {};
          const locator = nodeLocator + '.' + bucket + '[' + recordIndex + ']';
          const from = asText(rule.from);
          const hasTo = Object.prototype.hasOwnProperty.call(rule, 'to') && rule.to !== null && rule.to !== undefined;
          const rawTo = hasTo ? String(rule.to) : '';
          if (!from || !hasTo) throw new Error('structured TAR rule lacks from/to at ' + locator);

          ruleObjects++;
          if (rule.enabled !== false) ownEnabled++;

          const regex = rule.regex === true || rule.is_regex === true;
          const fromOptions = regex
            ? [from]
            : (Array.isArray(rule.from_options) && rule.from_options.length > 0
                ? rule.from_options.map(asText).filter(Boolean)
                : splitCandidates(from));
          const expectedOutputs = normalizeExpectedOutputs(rawTo, regex);
          if (fromOptions.length === 0) {
            throw new Error('structured TAR rule has no normalized alternatives at ' + locator);
          }

          for (let optionIndex = 0; optionIndex < fromOptions.length; optionIndex++) {
            const option = fromOptions[optionIndex]!;
            cases.push({
              id: 'tar:structured:' + (asText(rule.id) || locator) + ':from[' + optionIndex + ']',
              origin: 'tar',
              sourceKind: 'structured',
              sourceRefs: [{
                kind: 'structured',
                path: STRUCTURED_PATH,
                locator,
                sourceId: asText(rule.id) || undefined
              }],
              from: option,
              rawTo,
              expectedOutputs,
              sourceEnabled: nodeEnabled && rule.enabled !== false,
              migrationRequired: nodeEnabled && rule.enabled !== false,
              priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 0,
              regex,
              wildcard: option.includes('*'),
              nodePath,
              nodeKind: asText(node.kind) || null,
              conditions: rule.conditions ?? null,
              sequence: rule.sequence ?? null,
              matchOptions: rule.match_options ?? null,
              matchTarget: rule.match_target ?? rule.matchTarget ?? null
            });
          }
        }
      }
      walk(Array.isArray(node.children) ? node.children : [], nodeLocator + '.children', nodePath, nodeEnabled);
    }
  };

  walk(Array.isArray(settings.roots) ? settings.roots : [], 'roots', [], true);
  return { cases, ruleObjects, ownEnabled };
}

async function collectFlat(rootDir: string): Promise<FlatRecord[]> {
  const out: FlatRecord[] = [];
  for (const file of FLAT_FILES) {
    const doc = await readJson(rootDir, file);
    const groups = Array.isArray(doc.groups) ? doc.groups : [];
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex] ?? {};
      const entries = Array.isArray(group.entries) ? group.entries : [];
      for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
        const entry = entries[entryIndex] ?? {};
        const from = asText(entry.from);
        const hasTo = Object.prototype.hasOwnProperty.call(entry, 'to') && entry.to !== null && entry.to !== undefined;
        const to = hasTo ? String(entry.to) : '';
        const locator = 'groups[' + groupIndex + '].entries[' + entryIndex + ']';
        if (!from || !hasTo) throw new Error('flat TAR record lacks from/to at ' + file + '#' + locator);
        out.push({
          id: 'tar:flat:' + file + '#' + locator,
          path: file,
          locator,
          from,
          to,
          groupId: asText(group.id) || null,
          groupLabel: asText(group.label) || null,
          status: asText(group.status) || asText(entry.status) || null,
          sourceCategory: asText(entry.source_category) || null
        });
      }
    }
  }
  return out;
}

const activeForKinotch = (rule: IRRule): boolean =>
  rule.enabledBy === null || rule.enabledBy.includes(KINOTCH_PROFILE.profileId);

function statusFor(caseRecord: TarParityCase, matchingRules: IRRule[]): ParityStatus {
  if (caseRecord.sourceEnabled === false) return 'DISABLED';
  if (matchingRules.length === 0) return 'FAIL';

  const complex = caseRecord.sourceKind === 'flat-only'
    || caseRecord.regex
    || caseRecord.wildcard
    || caseRecord.expectedOutputs.length !== 1
    || hasPayload(caseRecord.conditions)
    || hasPayload(caseRecord.sequence)
    || hasPayload(caseRecord.matchOptions)
    || hasPayload(caseRecord.matchTarget)
    || caseRecord.rawTo.includes('[');

  return complex ? 'AMBIGUOUS' : 'PASS';
}

function countBy<T extends string>(values: T[]): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}

export async function buildTarParityArtifacts(rootDir: string) {
  const settings = await readJson(rootDir, STRUCTURED_PATH);
  const structured = collectStructured(settings);
  const flat = await collectFlat(rootDir);

  const structuredByPair = new Map<string, TarParityCase[]>();
  for (const record of structured.cases) {
    const key = pairKey(record.from, record.rawTo);
    const rows = structuredByPair.get(key) ?? [];
    rows.push(record);
    structuredByPair.set(key, rows);
  }

  const accountedFlat = new Set<string>();
  for (const record of flat) {
    const matches = structuredByPair.get(pairKey(record.from, record.to)) ?? [];
    for (const target of matches) {
      target.sourceRefs.push({
        kind: 'flat',
        path: record.path,
        locator: record.locator,
        sourceId: record.id,
        groupId: record.groupId ?? undefined,
        groupLabel: record.groupLabel ?? undefined,
        status: record.status ?? undefined,
        sourceCategory: record.sourceCategory ?? undefined
      });
    }
    if (matches.length > 0) accountedFlat.add(record.id);
  }

  const flatOnly: TarParityCase[] = flat
    .filter((record) => !accountedFlat.has(record.id))
    .map((record) => ({
      id: record.id,
      origin: 'tar' as const,
      sourceKind: 'flat-only' as const,
      sourceRefs: [{
        kind: 'flat' as const,
        path: record.path,
        locator: record.locator,
        sourceId: record.id,
        groupId: record.groupId ?? undefined,
        groupLabel: record.groupLabel ?? undefined,
        status: record.status ?? undefined,
        sourceCategory: record.sourceCategory ?? undefined
      }],
      from: record.from,
      rawTo: record.to,
      expectedOutputs: normalizeExpectedOutputs(record.to),
      sourceEnabled: null,
      migrationRequired: true,
      priority: 0,
      regex: false,
      wildcard: record.from.includes('*'),
      nodePath: [],
      nodeKind: null,
      conditions: null,
      sequence: null,
      matchOptions: null,
      matchTarget: null
    }));

  const records = [...structured.cases, ...flatOnly].sort((a, b) => a.id.localeCompare(b.id, 'en'));

  const structuredLocators = new Set(structured.cases.map((record) => record.sourceRefs[0]!.locator));
  const referencedFlat = new Set(records.flatMap((record) => record.sourceRefs.filter((ref) => ref.kind === 'flat').map((ref) => ref.sourceId!)));
  const unaccountedStructured = structured.ruleObjects - structuredLocators.size;
  const unaccountedFlat = flat.length - referencedFlat.size;
  if (unaccountedStructured !== 0 || unaccountedFlat !== 0) {
    throw new Error('TAR parity accounting gap: structured=' + unaccountedStructured + ', flat=' + unaccountedFlat);
  }

  const { graph } = await normalizeAcceptedOrthographySources(rootDir);
  const ir = compileRuleIR(withProfileRules(graph));
  const byInput = new Map<string, IRRule[]>();
  for (const rule of ir.rules) {
    if (!activeForKinotch(rule)) continue;
    const rows = byInput.get(rule.input) ?? [];
    rows.push(rule);
    byInput.set(rule.input, rows);
  }

  const diffRecords = records.map((record) => {
    const matching = (byInput.get(record.from) ?? []).filter((rule) =>
      rule.branches.some((branch) => record.expectedOutputs.includes(branch.output))
    );
    return {
      caseId: record.id,
      origin: record.origin,
      status: statusFor(record, matching),
      from: record.from,
      expectedOutputs: record.expectedOutputs,
      sourceEnabled: record.sourceEnabled,
      migrationRequired: record.migrationRequired,
      sourceKind: record.sourceKind,
      matchingRuleIds: matching.map((rule) => rule.ruleId).sort()
    };
  });

  const fixture = {
    schemaVersion: '1',
    kind: 'tar-parity-fixture',
    owner: 'japanese-orthography#283',
    originVocabulary: ['kinotch', 'tar'],
    source: {
      repository: 'kinoko34077/txt-auto-replace',
      commit: TAR_PARITY_COMMIT,
      structuredSettings: STRUCTURED_PATH,
      flatFiles: [...FLAT_FILES],
      interpreterSemantics: [
        { path: 'transform-engine.js', blobSha: '9ed98ce3b8075828ee431ef30cfa7d9bcdd31f49' },
        { path: 'transform-shared.js', blobSha: '24518621cb7816f8daee6bc67911a14bed74cac6' }
      ]
    },
    accounting: {
      structuredRuleObjects: structured.ruleObjects,
      structuredOwnEnabled: structured.ownEnabled,
      structuredSemanticEdges: structured.cases.length,
      flatRecords: flat.length,
      flatCrossReferenced: accountedFlat.size,
      flatOnly: flatOnly.length,
      fixtureRecords: records.length,
      unaccountedStructured,
      unaccountedFlat
    },
    records
  };

  const diff = {
    schemaVersion: '1',
    kind: 'tar-parity-diff',
    owner: 'japanese-orthography#283',
    baseline: {
      profileId: KINOTCH_PROFILE.profileId,
      ruleIrDigest: ir.digest,
      ruleCount: ir.rules.length
    },
    statuses: countBy(diffRecords.map((record) => record.status)),
    records: diffRecords
  };

  const summary = {
    schemaVersion: '1',
    kind: 'tar-parity-summary',
    owner: 'japanese-orthography#283',
    sourceCommit: TAR_PARITY_COMMIT,
    fixtureDigest: createHash('sha256').update(JSON.stringify(fixture.records)).digest('hex'),
    diffDigest: createHash('sha256').update(JSON.stringify(diff.records)).digest('hex'),
    accounting: fixture.accounting,
    statuses: diff.statuses,
    origins: countBy(records.map((record) => record.origin)),
    baseline: diff.baseline
  };

  return {
    fixture,
    diff,
    summary,
    texts: {
      [TAR_PARITY_FIXTURE]: JSON.stringify(fixture, null, 2) + '\n',
      [TAR_PARITY_DIFF]: JSON.stringify(diff, null, 2) + '\n',
      [TAR_PARITY_SUMMARY]: JSON.stringify(summary, null, 2) + '\n'
    }
  };
}

async function main(): Promise<void> {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  verifyTarParitySourceBlobs();
  const artifacts = await buildTarParityArtifacts(rootDir);

  if (artifacts.fixture.accounting.flatRecords !== 3438) throw new Error('expected 3438 flat TAR records');
  if (artifacts.fixture.accounting.structuredRuleObjects !== 2279) throw new Error('expected 2279 structured TAR rule objects');
  if (artifacts.fixture.accounting.structuredSemanticEdges !== 2354) throw new Error('expected 2354 structured semantic edges');

  if (process.argv.includes('--check')) {
    for (const [path, text] of Object.entries(artifacts.texts)) {
      const committed = normalizeCheckoutText(await readFile(resolve(rootDir, path), 'utf8'));
      if (committed !== text) throw new Error('stale ' + path + '; run npm run generate:tar-parity');
    }
    console.log('TAR parity OK: ' + artifacts.fixture.accounting.fixtureRecords + ' cases; statuses ' + JSON.stringify(artifacts.summary.statuses));
    return;
  }

  for (const [path, text] of Object.entries(artifacts.texts)) {
    await mkdir(dirname(resolve(rootDir, path)), { recursive: true });
    await writeFile(resolve(rootDir, path), text);
  }
  console.log(JSON.stringify(artifacts.summary, null, 2));
}

if (process.argv[1]?.endsWith('tar-parity.ts')) await main();

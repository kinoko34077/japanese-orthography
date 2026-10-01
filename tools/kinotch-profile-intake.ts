import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildCoverageSummary, type ParserRemainder } from './intake-accounting.ts';
import type { IntakeBundleDocument, IntakeRecord, Responsibility, SourceSnapshot } from './intake-model.ts';
import { normalizeCheckoutText } from './verification-text.ts';

// Phase 4.6F: responsibility classification of every active KiNoTch-local consumer relation
// (txt-auto-replace stages 10/15/20/30/31/60). Classification only; no runtime authority is created.

export const CONSUMER_COMMIT = '198f8560613d23417cb0f87172ae8662e722ca30';
const VENDOR_DIR = `data/sources/txt-auto-replace/${CONSUMER_COMMIT}/transforms`;
export const PHASE46F_INTAKE_PATH = 'data/intake/phase46f-kinotch-profile.json';
export const PHASE46F_COVERAGE_REPORT_PATH = 'data/reports/phase46f-kinotch-profile-coverage.json';
const STAGE60_CLASSIFICATION_PATH = 'data/profiles/kinotch/legacy-stage60-classification.json';

const STAGES: Array<{ stage: string; file: string; blobSha: string }> = [
  { stage: '10', file: '10-surface-normalization.json5', blobSha: 'b28c66e4a31e151e1f0dff7b9707d908360f08d1' },
  { stage: '15', file: '15-katakana-long-vowel-abbreviation.json5', blobSha: '747a072d88ccc99d16940abc64882bafa1e1bdbb' },
  { stage: '20', file: '20-lexical-replacements.json5', blobSha: '32d4acff7532b5dd21d0bab1d1ba414298f27687' },
  { stage: '30', file: '30-okurigana-abbreviation.json5', blobSha: '00f0147412598bdbc5d8c63dd8cc23f8d23bde45' },
  { stage: '31', file: '31-okurigana-abbreviation-stage4.json5', blobSha: '49a372cf6e7f30e681c895c47a42dfca183611b7' },
  { stage: '60', file: '60-general-character-replacements.json5', blobSha: 'be5a147a241744fe33ab8e525c3f1dd0d38e1ecd' }
];

export const PHASE46F_SNAPSHOTS: SourceSnapshot[] = STAGES.map(({ stage, file, blobSha }) => ({
  sourceId: `phase46f-txt-auto-stage${stage}`,
  sourceClass: 'external-repository',
  repository: 'kinoko34077/txt-auto-replace',
  commit: CONSUMER_COMMIT,
  path: `transforms/${file}`,
  blobSha,
  coverageRole: 'coverage-contract'
}));

interface Extracted {
  locator: string;
  from: string;
  to: string;
  runtimeMode?: string;
}

interface StageParse {
  records: Extracted[];
  remainders: ParserRemainder[];
}

// Minimal JSON5 reader for the consumer rule files (comments, unquoted keys, trailing commas).
export function parseJson5(text: string): any {
  const withoutComments = text.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*/g, (match, quoted) => quoted ?? '');
  const quotedKeys = withoutComments.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
  return JSON.parse(quotedKeys.replace(/,(\s*[}\]])/g, '$1'));
}

function ruleFrom(rule: any): string | null {
  if (typeof rule?.from === 'string') return rule.from;
  if (Array.isArray(rule?.sequence)) return rule.sequence.map((part: any) => part?.surface ?? '').join('+');
  return null;
}

export function extractStage(document: any): StageParse {
  const records: Extracted[] = [];
  const remainders: ParserRemainder[] = [];
  if (typeof document?.runtime_mode === 'string') {
    records.push({ locator: `runtime_mode:${document.runtime_mode}`, from: '*', to: '*', runtimeMode: document.runtime_mode });
  }
  (Array.isArray(document?.rules) ? document.rules : []).forEach((rule: any, index: number) => {
    const from = ruleFrom(rule);
    if (!from || typeof rule?.to !== 'string') {
      remainders.push({ sourceRecordId: `rules[${index}]`, kind: 'mapping', detail: 'unrecognized rule shape' });
      return;
    }
    records.push({ locator: `rules[${index}]`, from, to: rule.to });
  });
  if (Array.isArray(document?.phrase_rules) && document.phrase_rules.length > 0) {
    remainders.push({ sourceRecordId: 'phrase_rules', kind: 'mapping', detail: 'phrase rules are not classified yet' });
  }
  for (const [from, to] of Object.entries(document?.character_map ?? {})) {
    records.push({ locator: `character_map.${from}`, from, to: String(to) });
  }
  return { records, remainders };
}

type Classification = { responsibility: Responsibility; disposition: IntakeRecord['disposition']; exclusionReason?: string };

const STAGE60_BUCKETS: Record<string, Classification> = {
  kinotch_semantic_override: { responsibility: 'kinotch_semantic', disposition: 'admitted' },
  kinotch_style_render: { responsibility: 'kinotch_style', disposition: 'admitted' },
  generic_deterministic_candidate: {
    responsibility: 'character_form', disposition: 'excluded_unresolved', exclusionReason: 'requires_per_entry_source_admission'
  },
  generic_lexical_contextual: {
    responsibility: 'merged_character', disposition: 'excluded_unresolved', exclusionReason: 'requires_lexical_context'
  },
  unresolved: {
    responsibility: 'preserve_unresolved', disposition: 'excluded_unresolved', exclusionReason: 'nfc_unstable_compatibility_ideograph'
  }
};

// Stage 20 sequence/token rules choosing among lexical spellings are semantic; the rest are style.
const STAGE20_SEMANTIC = new Set(['面倒+ごと', '時+ごと']);

function classify(stage: string, record: Extracted, stage60: Map<string, string>, admittedCharacterForms: Set<string>): Classification {
  if (stage === '15' && !record.runtimeMode) {
    return { responsibility: 'preserve_unresolved', disposition: 'admitted' }; // long-vowel exclusion (e.g. バッター)
  }
  if (stage === '20' && STAGE20_SEMANTIC.has(record.from)) return { responsibility: 'kinotch_semantic', disposition: 'admitted' };
  if (stage !== '60') return { responsibility: 'kinotch_style', disposition: 'admitted' };

  const bucket = stage60.get(record.from);
  if (!bucket || !STAGE60_BUCKETS[bucket]) {
    return { responsibility: 'preserve_unresolved', disposition: 'excluded_unresolved', exclusionReason: 'unclassified_stage60_entry' };
  }
  if (bucket === 'generic_deterministic_candidate' && admittedCharacterForms.has(`${record.from}>${record.to}`)) {
    return { responsibility: 'character_form', disposition: 'admitted' };
  }
  return STAGE60_BUCKETS[bucket]!;
}

export async function buildPhase46fArtifacts(rootDir: string) {
  const stage60 = new Map<string, string>(
    (JSON.parse(await readFile(resolve(rootDir, STAGE60_CLASSIFICATION_PATH), 'utf8')).entries as any[])
      .map((entry) => [entry.from, entry.bucket])
  );
  const safe = JSON.parse(await readFile(resolve(rootDir, 'data/deterministic/safe-character-first-slice.json'), 'utf8'));
  const admittedCharacterForms = new Set<string>((safe.mappings as any[]).map((mapping) => `${mapping.modern}>${mapping.historical}`));

  const records: IntakeRecord[] = [];
  const parses = new Map<string, StageParse>();
  for (const [index, { stage, file }] of STAGES.entries()) {
    const snapshot = PHASE46F_SNAPSHOTS[index]!;
    const parse = extractStage(parseJson5(normalizeCheckoutText(await readFile(resolve(rootDir, VENDOR_DIR, file), 'utf8'))));
    parses.set(snapshot.sourceId, parse);
    for (const record of parse.records) {
      const classification = classify(stage, record, stage60, admittedCharacterForms);
      records.push({
        id: `phase46f:${snapshot.sourceId}:${record.locator}`,
        sourceRef: snapshot.sourceId,
        sourceLocator: record.locator,
        sourceRecordKind: record.runtimeMode ? 'explanatory' : 'mapping',
        responsibility: classification.responsibility,
        disposition: classification.disposition,
        modernSurface: record.from,
        historicalSurface: record.to,
        ...(classification.exclusionReason ? { exclusionReason: classification.exclusionReason } : {}),
        evidenceRefs: [`${snapshot.sourceId}:${record.locator}`]
      });
    }
  }

  const bundle: IntakeBundleDocument = { schemaVersion: '1', kind: 'orthography_intake_bundle', snapshots: PHASE46F_SNAPSHOTS, records };
  const summaries = PHASE46F_SNAPSHOTS.map((snapshot) => {
    const parse = parses.get(snapshot.sourceId)!;
    const summary = buildCoverageSummary({
      snapshot, discoveredRecordIds: parse.records.map((record) => record.locator), records, remainders: parse.remainders
    });
    const byResponsibility: Record<string, number> = {};
    for (const record of records.filter((entry) => entry.sourceRef === snapshot.sourceId)) {
      const key = `${record.responsibility}/${record.disposition}`;
      byResponsibility[key] = (byResponsibility[key] ?? 0) + 1;
    }
    const { discoveredRecordIds, admittedRecordIds, ambiguousRecordIds, excludedRecordIds, ...counts } = summary;
    return { ...counts, byResponsibility };
  });
  const coverageReport = { schemaVersion: '1', kind: 'phase46f_kinotch_profile_coverage_report', sources: summaries };

  return {
    bundle,
    parses,
    coverageReport,
    texts: {
      [PHASE46F_INTAKE_PATH]: `${JSON.stringify(bundle)}\n`,
      [PHASE46F_COVERAGE_REPORT_PATH]: `${JSON.stringify(coverageReport, null, 2)}\n`
    } as Record<string, string>
  };
}

function isMain(metaUrl: string): boolean {
  return process.argv[1] !== undefined && metaUrl === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMain(import.meta.url)) {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const { texts } = await buildPhase46fArtifacts(rootDir);
  for (const [path, text] of Object.entries(texts)) {
    await mkdir(dirname(resolve(rootDir, path)), { recursive: true });
    await writeFile(resolve(rootDir, path), text, 'utf8');
  }
}

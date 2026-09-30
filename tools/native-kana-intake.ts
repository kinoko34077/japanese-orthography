import {
  buildCoverageSummary,
  canonicalizeAlternatives,
  type CoverageSummary
} from './intake-accounting.ts';
import type {
  IntakeBundleDocument,
  IntakeRecord,
  SourceSnapshot
} from './intake-model.ts';
import type {
  NativeKanaExtractedRecord,
  NativeKanaParseResult
} from './native-kana-source-parser.ts';

export interface Phase46dNativeParsedSources {
  kkh: NativeKanaParseResult;
  dictionary: NativeKanaParseResult;
  animalPlant: NativeKanaParseResult;
  exceptionVerbs: NativeKanaParseResult;
  guide: NativeKanaParseResult;
}

export const PHASE46D_NATIVE_SOURCE_SNAPSHOTS: SourceSnapshot[] = [
  {
    sourceId: 'phase46d-kkh-kana',
    sourceClass: 'external-repository',
    repository: 'okikae/kkh',
    commit: '19b24f88ab55809a186d88c465959548495b26a2',
    path: 'kana-jisyo',
    blobSha: '6a69cdc140994a0b8d5f6acb86d7b3b8c3ef20be',
    license: 'BSD-2-Clause',
    coverageRole: 'coverage-contract'
  },
  {
    sourceId: 'phase46d-native-dictionary',
    sourceClass: 'committed-reference',
    repository: 'kinoko34077/japanese-orthography',
    commit: '3bc0ade448f9eec824dc3f4ec5fb364f1557c4b9',
    path: '仮名遣等資料/仮名遣い辞典本文.html',
    blobSha: '45380ff7690e177afa7c980f3f4ffd873b38d928',
    coverageRole: 'coverage-contract'
  },
  {
    sourceId: 'phase46d-animal-plant',
    sourceClass: 'committed-reference',
    repository: 'kinoko34077/japanese-orthography',
    commit: '3bc0ade448f9eec824dc3f4ec5fb364f1557c4b9',
    path: '仮名遣等資料/動物名・植物名歴史的仮名遣い辞典.html',
    blobSha: '9eb26e76343526fe5cc8b17d1113f80414c4bf21',
    coverageRole: 'coverage-contract'
  },
  {
    sourceId: 'phase46d-exception-verbs',
    sourceClass: 'committed-reference',
    repository: 'kinoko34077/japanese-orthography',
    commit: '3bc0ade448f9eec824dc3f4ec5fb364f1557c4b9',
    path: '仮名遣等資料/例外動詞一覧：歴史的仮名遣い教室.html',
    blobSha: '57a50297fb2454e702d6f7b3450cd3cdd7e9cb9a',
    coverageRole: 'coverage-contract'
  },
  {
    sourceId: 'phase46d-native-guide',
    sourceClass: 'committed-reference',
    repository: 'kinoko34077/japanese-orthography',
    commit: '3bc0ade448f9eec824dc3f4ec5fb364f1557c4b9',
    path: '仮名遣等資料/歴史的仮名遣いで書きたい.html',
    blobSha: '232cb508e1fdae0c5ec2e17a57409f20cde28756',
    coverageRole: 'coverage-contract'
  }
];

function evidenceRef(record: NativeKanaExtractedRecord): string {
  return `${record.sourceRef}:${record.sourceLocator}`;
}

function intakeId(record: NativeKanaExtractedRecord): string {
  return `phase46d:${record.sourceRef}:${record.sourceLocator}`;
}

function baseRecord(record: NativeKanaExtractedRecord): Pick<
  IntakeRecord,
  'id' | 'sourceRef' | 'sourceLocator' | 'sourceRecordKind' | 'responsibility' | 'evidenceRefs'
> {
  return {
    id: intakeId(record),
    sourceRef: record.sourceRef,
    sourceLocator: record.sourceLocator,
    sourceRecordKind: record.sourceRecordKind,
    responsibility: 'historical_kana_native',
    evidenceRefs: [evidenceRef(record)]
  };
}

function classifyKkh(records: NativeKanaExtractedRecord[]): IntakeRecord[] {
  const targets = new Map<string, Set<string>>();
  for (const record of records) {
    if (!record.enabled || !record.modernSurface || !record.historicalSurface) continue;
    const group = targets.get(record.modernSurface) ?? new Set<string>();
    group.add(record.historicalSurface);
    targets.set(record.modernSurface, group);
  }

  return records.map(record => {
    const base = baseRecord(record);
    if (!record.enabled) {
      return {
        ...base,
        disposition: 'excluded_unresolved',
        ...(record.modernSurface ? { modernSurface: record.modernSurface } : {}),
        ...(record.historicalSurface ? { historicalSurface: record.historicalSurface } : {}),
        exclusionReason: 'source_disabled'
      };
    }

    const modernSurface = record.modernSurface ?? '';
    const historicalSurface = record.historicalSurface ?? '';
    const alternatives = canonicalizeAlternatives([...(targets.get(modernSurface) ?? new Set<string>())]);
    if (alternatives.length > 1) {
      return {
        ...base,
        disposition: 'candidate_ambiguous',
        modernSurface,
        alternatives
      };
    }

    return {
      ...base,
      disposition: 'admitted',
      modernSurface,
      historicalSurface
    };
  });
}

function stripHeadwordAnnotations(value: string): string {
  return value
    .replace(/[\s　]*（[^）]*）/g, '')
    .replace(/[\s ]*\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitReadingAlternatives(value: string): string[] {
  const assertedNotePatterns = [
    /「([^」]+)」説も/g,
    /「([^」]+)」は古形/g,
    /「([^」]+)」が新形/g,
    /古語は「([^」]+)」も/g
  ];
  const noteAlternatives = assertedNotePatterns.flatMap(pattern => (
    [...value.matchAll(pattern)].flatMap(match => (match[1] ?? '').split('、'))
  ));

  const outsideNotes = value
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '');
  const baseAlternatives = outsideNotes.split('、');

  return canonicalizeAlternatives(
    [...baseAlternatives, ...noteAlternatives]
      .map(item => item.replace(/^[\s　]+|[\s　]+$/g, ''))
      .filter(Boolean)
  );
}

function classifyDictionaryRecord(record: NativeKanaExtractedRecord): IntakeRecord {
  const base = baseRecord(record);
  const modernSurface = stripHeadwordAnnotations(record.modernSurface ?? '');
  const rawReading = record.historicalReading ?? '';
  const alternatives = splitReadingAlternatives(rawReading);

  if (
    modernSurface.length === 0 ||
    modernSurface.includes('、') ||
    /[～…]/.test(modernSurface) ||
    alternatives.length === 0
  ) {
    return {
      ...base,
      disposition: 'excluded_unresolved',
      ...(modernSurface ? { modernSurface } : {}),
      exclusionReason: 'source_structure_requires_manual_disambiguation'
    };
  }

  if (alternatives.length > 1) {
    return {
      ...base,
      disposition: 'candidate_ambiguous',
      modernSurface,
      alternatives
    };
  }

  return {
    ...base,
    disposition: 'admitted',
    modernSurface,
    historicalReading: alternatives[0]!
  };
}

function classifyExceptionRecord(record: NativeKanaExtractedRecord): IntakeRecord {
  return {
    ...baseRecord(record),
    disposition: 'excluded_unresolved',
    exclusionReason: 'requires_modern_surface_derivation'
  };
}

function classifyGuideRecord(record: NativeKanaExtractedRecord): IntakeRecord {
  const heading = record.guideKind === 'rule-heading';
  return {
    ...baseRecord(record),
    disposition: 'excluded_unresolved',
    exclusionReason: heading
      ? 'non_transformational_explanation'
      : 'requires_modern_surface_derivation'
  };
}

export function buildPhase46dNativeKanaIntake(parsed: Phase46dNativeParsedSources): IntakeBundleDocument {
  return {
    schemaVersion: '1',
    kind: 'orthography_intake_bundle',
    snapshots: PHASE46D_NATIVE_SOURCE_SNAPSHOTS.map(snapshot => ({ ...snapshot })),
    records: [
      ...classifyKkh(parsed.kkh.records),
      ...parsed.dictionary.records.map(classifyDictionaryRecord),
      ...parsed.animalPlant.records.map(classifyDictionaryRecord),
      ...parsed.exceptionVerbs.records.map(classifyExceptionRecord),
      ...parsed.guide.records.map(classifyGuideRecord)
    ]
  };
}

function parsedBySource(parsed: Phase46dNativeParsedSources): Map<string, NativeKanaParseResult> {
  return new Map([
    ['phase46d-kkh-kana', parsed.kkh],
    ['phase46d-native-dictionary', parsed.dictionary],
    ['phase46d-animal-plant', parsed.animalPlant],
    ['phase46d-exception-verbs', parsed.exceptionVerbs],
    ['phase46d-native-guide', parsed.guide]
  ]);
}

export interface Phase46dNativeKanaCoverageReport {
  schemaVersion: '1';
  kind: 'phase46d_native_kana_coverage_report';
  totalRecords: number;
  sources: CoverageSummary[];
}

export function buildPhase46dNativeKanaCoverageReport(
  bundle: IntakeBundleDocument,
  parsed: Phase46dNativeParsedSources
): Phase46dNativeKanaCoverageReport {
  const sourceMap = parsedBySource(parsed);
  const sources = bundle.snapshots.map(snapshot => {
    const source = sourceMap.get(snapshot.sourceId);
    if (!source) throw new Error(`Missing Phase 4.6D parse result for ${snapshot.sourceId}`);
    return buildCoverageSummary({
      snapshot,
      discoveredRecordIds: source.discoveredRecordIds,
      records: bundle.records,
      remainders: source.remainders
    });
  });
  return {
    schemaVersion: '1',
    kind: 'phase46d_native_kana_coverage_report',
    totalRecords: bundle.records.length,
    sources
  };
}

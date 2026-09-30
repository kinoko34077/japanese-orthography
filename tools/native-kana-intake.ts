import { canonicalizeAlternatives } from './intake-accounting.ts';
import type { IntakeRecord, SourceSnapshot } from './intake-model.ts';
import type { NativeKanaExtractedRecord, NativeKanaParseResult } from './native-kana-source-parser.ts';

export const PHASE46D_NATIVE_SNAPSHOTS: SourceSnapshot[] = [
  {
    sourceId: 'phase46d-kkh-kana-jisyo',
    sourceClass: 'external-repository',
    repository: 'okikae/kkh',
    commit: '19b24f88ab55809a186d88c465959548495b26a2',
    path: 'kana-jisyo',
    blobSha: '6a69cdc140994a0b8d5f6acb86d7b3b8c3ef20be',
    license: 'BSD-2-Clause',
    coverageRole: 'coverage-contract'
  },
  {
    sourceId: 'phase46d-committed-native-dictionary',
    sourceClass: 'committed-reference',
    repository: 'kinoko34077/japanese-orthography',
    commit: '8b1a9c207491d19a82a3cf1c09eb32cf6e7a94cb',
    path: '仮名遣等資料/仮名遣い辞典本文.html',
    blobSha: '45380ff7690e177afa7c980f3f4ffd873b38d928',
    coverageRole: 'coverage-contract'
  },
  {
    sourceId: 'phase46d-committed-exception-verbs',
    sourceClass: 'committed-reference',
    repository: 'kinoko34077/japanese-orthography',
    commit: '8b1a9c207491d19a82a3cf1c09eb32cf6e7a94cb',
    path: '仮名遣等資料/例外動詞一覧：歴史的仮名遣い教室.html',
    blobSha: '57a50297fb2454e702d6f7b3450cd3cdd7e9cb9a',
    coverageRole: 'coverage-contract'
  },
  {
    sourceId: 'phase46d-committed-animal-plant',
    sourceClass: 'committed-reference',
    repository: 'kinoko34077/japanese-orthography',
    commit: '8b1a9c207491d19a82a3cf1c09eb32cf6e7a94cb',
    path: '仮名遣等資料/動物名・植物名歴史的仮名遣い辞典.html',
    blobSha: '9eb26e76343526fe5cc8b17d1113f80414c4bf21',
    coverageRole: 'coverage-contract'
  },
  {
    sourceId: 'phase46d-committed-native-guide',
    sourceClass: 'committed-reference',
    repository: 'kinoko34077/japanese-orthography',
    commit: '8b1a9c207491d19a82a3cf1c09eb32cf6e7a94cb',
    path: '仮名遣等資料/歴史的仮名遣いで書きたい.html',
    blobSha: '232cb508e1fdae0c5ec2e17a57409f20cde28756',
    coverageRole: 'coverage-contract'
  }
];

export interface NativeKanaParsedSource {
  snapshot: SourceSnapshot;
  parseResult: NativeKanaParseResult;
}

function evidenceRef(record: NativeKanaExtractedRecord): string {
  return 'source:' + record.sourceRef + ':' + record.sourceLocator;
}

function recordId(record: NativeKanaExtractedRecord): string {
  return 'phase46d:' + record.sourceRef + ':' + record.sourceLocator;
}

function excluded(record: NativeKanaExtractedRecord, reason: string): IntakeRecord {
  return {
    id: recordId(record),
    sourceRef: record.sourceRef,
    sourceLocator: record.sourceLocator,
    sourceRecordKind: record.sourceRecordKind,
    responsibility: 'preserve_unresolved',
    disposition: 'excluded_unresolved',
    ...(record.modernSurface !== undefined ? { modernSurface: record.modernSurface } : {}),
    ...(record.historicalSurface !== undefined ? { historicalSurface: record.historicalSurface } : {}),
    ...(record.historicalReading !== undefined ? { historicalReading: record.historicalReading } : {}),
    exclusionReason: reason,
    evidenceRefs: [evidenceRef(record)]
  };
}

function classifyKkh(parseResult: NativeKanaParseResult): IntakeRecord[] {
  const targetsByModern = new Map<string, string[]>();
  for (const record of parseResult.records) {
    if (!record.enabled || !record.modernSurface || !record.historicalSurface) continue;
    const targets = targetsByModern.get(record.modernSurface) ?? [];
    targets.push(record.historicalSurface);
    targetsByModern.set(record.modernSurface, targets);
  }

  return parseResult.records.map(record => {
    if (!record.enabled) return excluded(record, 'source_disabled');
    if (!record.modernSurface || !record.historicalSurface) {
      return excluded(record, 'source_structure_requires_manual_disambiguation');
    }
    const alternatives = canonicalizeAlternatives(targetsByModern.get(record.modernSurface) ?? []);
    if (alternatives.length !== 1) {
      return {
        id: recordId(record),
        sourceRef: record.sourceRef,
        sourceLocator: record.sourceLocator,
        sourceRecordKind: 'alternative',
        responsibility: 'historical_kana_native',
        disposition: 'candidate_ambiguous',
        modernSurface: record.modernSurface,
        alternatives,
        evidenceRefs: [evidenceRef(record)]
      };
    }
    return {
      id: recordId(record),
      sourceRef: record.sourceRef,
      sourceLocator: record.sourceLocator,
      sourceRecordKind: 'mapping',
      responsibility: 'historical_kana_native',
      disposition: 'admitted',
      modernSurface: record.modernSurface,
      historicalSurface: alternatives[0]!,
      evidenceRefs: [evidenceRef(record)]
    };
  });
}

function structuralSurface(value: string): boolean {
  return /[、，,（）()～〜／/]/u.test(value);
}

function readingAlternatives(value: string): string[] | null {
  if (/[（）()～〜]/u.test(value)) return null;
  const alternatives = canonicalizeAlternatives(value.split('、').map(item => item.trim()).filter(Boolean));
  if (alternatives.length === 0) return null;
  if (alternatives.some(item => /\s/u.test(item))) return null;
  return alternatives;
}

function classifyDictionary(parseResult: NativeKanaParseResult): IntakeRecord[] {
  return parseResult.records.map(record => {
    const modern = record.modernSurface?.trim() ?? '';
    const reading = record.historicalReading?.trim() ?? '';
    if (!modern || !reading || structuralSurface(modern)) {
      return excluded(record, 'source_structure_requires_manual_disambiguation');
    }
    const alternatives = readingAlternatives(reading);
    if (!alternatives) return excluded(record, 'source_structure_requires_manual_disambiguation');

    if (alternatives.length > 1) {
      return {
        id: recordId(record),
        sourceRef: record.sourceRef,
        sourceLocator: record.sourceLocator,
        sourceRecordKind: 'alternative',
        responsibility: 'historical_kana_native',
        disposition: 'candidate_ambiguous',
        modernSurface: modern,
        alternatives,
        evidenceRefs: [evidenceRef(record)]
      };
    }

    return {
      id: recordId(record),
      sourceRef: record.sourceRef,
      sourceLocator: record.sourceLocator,
      sourceRecordKind: 'mapping',
      responsibility: 'historical_kana_native',
      disposition: 'admitted',
      modernSurface: modern,
      historicalReading: alternatives[0]!,
      evidenceRefs: [evidenceRef(record)]
    };
  });
}

function classifyNonMapping(parseResult: NativeKanaParseResult, reason: string): IntakeRecord[] {
  return parseResult.records.map(record => excluded(record, reason));
}

export function classifyPhase46dNativeKanaSource(source: NativeKanaParsedSource): IntakeRecord[] {
  switch (source.snapshot.sourceId) {
    case 'phase46d-kkh-kana-jisyo':
      return classifyKkh(source.parseResult);
    case 'phase46d-committed-native-dictionary':
    case 'phase46d-committed-animal-plant':
      return classifyDictionary(source.parseResult);
    case 'phase46d-committed-exception-verbs':
      return classifyNonMapping(source.parseResult, 'requires_modern_surface_derivation');
    case 'phase46d-committed-native-guide':
      return classifyNonMapping(source.parseResult, 'non_transformational_explanation');
    default:
      throw new Error('Unknown Phase 4.6D native source: ' + source.snapshot.sourceId);
  }
}

export function classifyPhase46dNativeKana(sources: NativeKanaParsedSource[]): IntakeRecord[] {
  return sources.flatMap(classifyPhase46dNativeKanaSource);
}

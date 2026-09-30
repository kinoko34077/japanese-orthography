import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildCoverageSummary } from './intake-accounting.ts';
import type { IntakeBundleDocument, SourceSnapshot } from './intake-model.ts';
import {
  PHASE46D_NATIVE_SNAPSHOTS,
  classifyPhase46dNativeKana,
  type NativeKanaParsedSource
} from './native-kana-intake.ts';
import {
  decodeNativeKanaHtml,
  parseColonDictionaryHtml,
  parseExceptionVerbHtml,
  parseKkhKanaJisyo,
  parseNativeGuideHtml
} from './native-kana-source-parser.ts';

export interface NativeKanaCoverageReport {
  schemaVersion: '1';
  kind: 'phase46d_native_kana_coverage_report';
  sources: Array<{
    sourceId: string;
    discovered: number;
    admitted: number;
    ambiguous: number;
    excluded: number;
    unclassified: number;
    unexpected: number;
    unparsedMappingRecords: number;
  }>;
}

export interface Phase46dNativeKanaDocuments {
  intake: IntakeBundleDocument;
  coverageReport: NativeKanaCoverageReport;
  sources: NativeKanaParsedSource[];
}

export interface Phase46dGeneratedArtifact {
  path: string;
  value: IntakeBundleDocument | NativeKanaCoverageReport;
}

export const PHASE46D_INTAKE_SHARD_SIZE = 800;

function snapshot(sourceId: string): SourceSnapshot {
  const value = PHASE46D_NATIVE_SNAPSHOTS.find(item => item.sourceId === sourceId);
  if (!value) throw new Error('Missing Phase 4.6D source snapshot: ' + sourceId);
  return value;
}

async function html(rootDir: string, path: string): Promise<string> {
  return decodeNativeKanaHtml(await readFile(join(rootDir, path)));
}

export function serializeGeneratedJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

export async function buildPhase46dNativeKanaDocuments(rootDir: string): Promise<Phase46dNativeKanaDocuments> {
  const kkh = await readFile(
    join(rootDir, 'data/sources/kkh/19b24f88ab55809a186d88c465959548495b26a2/kana-jisyo'),
    'utf8'
  );
  const [dictionary, exceptions, animalPlant, guide] = await Promise.all([
    html(rootDir, '仮名遣等資料/仮名遣い辞典本文.html'),
    html(rootDir, '仮名遣等資料/例外動詞一覧：歴史的仮名遣い教室.html'),
    html(rootDir, '仮名遣等資料/動物名・植物名歴史的仮名遣い辞典.html'),
    html(rootDir, '仮名遣等資料/歴史的仮名遣いで書きたい.html')
  ]);

  const sources: NativeKanaParsedSource[] = [
    {
      snapshot: snapshot('phase46d-kkh-kana-jisyo'),
      parseResult: parseKkhKanaJisyo(kkh, 'phase46d-kkh-kana-jisyo')
    },
    {
      snapshot: snapshot('phase46d-committed-native-dictionary'),
      parseResult: parseColonDictionaryHtml(dictionary, 'phase46d-committed-native-dictionary')
    },
    {
      snapshot: snapshot('phase46d-committed-exception-verbs'),
      parseResult: parseExceptionVerbHtml(exceptions, 'phase46d-committed-exception-verbs')
    },
    {
      snapshot: snapshot('phase46d-committed-animal-plant'),
      parseResult: parseColonDictionaryHtml(animalPlant, 'phase46d-committed-animal-plant')
    },
    {
      snapshot: snapshot('phase46d-committed-native-guide'),
      parseResult: parseNativeGuideHtml(guide, 'phase46d-committed-native-guide')
    }
  ];

  const intake: IntakeBundleDocument = {
    schemaVersion: '1',
    kind: 'orthography_intake_bundle',
    snapshots: PHASE46D_NATIVE_SNAPSHOTS.map(item => structuredClone(item)),
    records: classifyPhase46dNativeKana(sources)
  };

  const coverageReport: NativeKanaCoverageReport = {
    schemaVersion: '1',
    kind: 'phase46d_native_kana_coverage_report',
    sources: sources.map(source => {
      const summary = buildCoverageSummary({
        snapshot: source.snapshot,
        discoveredRecordIds: source.parseResult.discoveredRecordIds,
        records: intake.records,
        remainders: source.parseResult.remainders
      });
      return {
        sourceId: summary.sourceId,
        discovered: summary.discovered,
        admitted: summary.admitted,
        ambiguous: summary.ambiguous,
        excluded: summary.excluded,
        unclassified: summary.unclassified,
        unexpected: summary.unexpected,
        unparsedMappingRecords: summary.unparsedMappingRecords
      };
    })
  };

  return { intake, coverageReport, sources };
}

export function buildPhase46dNativeKanaMaterialization(
  generated: Phase46dNativeKanaDocuments
): Phase46dGeneratedArtifact[] {
  const rootBundle: IntakeBundleDocument = {
    schemaVersion: '1',
    kind: 'orthography_intake_bundle',
    snapshots: structuredClone(generated.intake.snapshots),
    records: []
  };
  const artifacts: Phase46dGeneratedArtifact[] = [{
    path: 'data/intake/phase46d-native-kana.json',
    value: rootBundle
  }];

  for (let offset = 0, shard = 1; offset < generated.intake.records.length; offset += PHASE46D_INTAKE_SHARD_SIZE, shard += 1) {
    artifacts.push({
      path: 'data/intake/phase46d-native-kana/records-' + String(shard).padStart(3, '0') + '.json',
      value: {
        schemaVersion: '1',
        kind: 'orthography_intake_bundle',
        snapshots: [],
        records: generated.intake.records.slice(offset, offset + PHASE46D_INTAKE_SHARD_SIZE)
      }
    });
  }

  artifacts.push({
    path: 'data/reports/phase46d-native-kana-coverage.json',
    value: generated.coverageReport
  });
  return artifacts;
}

export async function writePhase46dNativeKanaDocuments(rootDir: string): Promise<void> {
  const generated = await buildPhase46dNativeKanaDocuments(rootDir);
  const shardDir = join(rootDir, 'data/intake/phase46d-native-kana');
  await rm(shardDir, { recursive: true, force: true });

  for (const artifact of buildPhase46dNativeKanaMaterialization(generated)) {
    const absolute = join(rootDir, artifact.path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, serializeGeneratedJson(artifact.value), 'utf8');
  }

  const shardNames = (await readdir(shardDir)).filter(name => name.endsWith('.json')).sort();
  if (shardNames.length !== Math.ceil(generated.intake.records.length / PHASE46D_INTAKE_SHARD_SIZE)) {
    throw new Error('Phase 4.6D shard write count mismatch');
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  await writePhase46dNativeKanaDocuments(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
}

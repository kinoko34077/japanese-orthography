import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import {
  parseColonDictionaryHtml,
  parseExceptionVerbHtml,
  parseKkhKanaJisyo,
  parseNativeGuideHtml
} from './native-kana-source-parser.ts';
import {
  buildPhase46dNativeKanaCoverageReport,
  buildPhase46dNativeKanaIntake,
  type Phase46dNativeParsedSources
} from './native-kana-intake.ts';

export const PHASE46D_INTAKE_PATH = 'data/intake/phase46d-native-kana.json';
export const PHASE46D_COVERAGE_REPORT_PATH = 'data/reports/phase46d-native-kana-coverage.json';

async function sourceText(path: string): Promise<string> {
  const bytes = await readFile(path);
  const header = bytes.subarray(0, 2048).toString('latin1').toLowerCase();
  if (header.includes('charset=x-sjis') || header.includes('charset=shift_jis')) {
    return new TextDecoder('shift_jis').decode(bytes);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export async function loadPhase46dNativeParseResults(rootDir: string): Promise<Phase46dNativeParsedSources> {
  const [kkh, dictionary, animalPlant, exceptionVerbs, guide] = await Promise.all([
    sourceText(resolve(rootDir, 'data/sources/kkh/19b24f88ab55809a186d88c465959548495b26a2/kana-jisyo')),
    sourceText(resolve(rootDir, '仮名遣等資料/仮名遣い辞典本文.html')),
    sourceText(resolve(rootDir, '仮名遣等資料/動物名・植物名歴史的仮名遣い辞典.html')),
    sourceText(resolve(rootDir, '仮名遣等資料/例外動詞一覧：歴史的仮名遣い教室.html')),
    sourceText(resolve(rootDir, '仮名遣等資料/歴史的仮名遣いで書きたい.html'))
  ]);

  return {
    kkh: parseKkhKanaJisyo(kkh, 'phase46d-kkh-kana'),
    dictionary: parseColonDictionaryHtml(dictionary, 'phase46d-native-dictionary'),
    animalPlant: parseColonDictionaryHtml(animalPlant, 'phase46d-animal-plant'),
    exceptionVerbs: parseExceptionVerbHtml(exceptionVerbs, 'phase46d-exception-verbs'),
    guide: parseNativeGuideHtml(guide, 'phase46d-native-guide')
  };
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export async function buildPhase46dNativeArtifacts(rootDir: string) {
  const parsed = await loadPhase46dNativeParseResults(rootDir);
  const bundle = buildPhase46dNativeKanaIntake(parsed);
  const coverageReport = buildPhase46dNativeKanaCoverageReport(bundle, parsed);
  return {
    parsed,
    bundle,
    coverageReport,
    intakeText: canonicalJson(bundle),
    coverageReportText: canonicalJson(coverageReport)
  };
}

export async function writePhase46dNativeArtifacts(rootDir: string): Promise<void> {
  const artifacts = await buildPhase46dNativeArtifacts(rootDir);
  for (const [relativePath, text] of [
    [PHASE46D_INTAKE_PATH, artifacts.intakeText],
    [PHASE46D_COVERAGE_REPORT_PATH, artifacts.coverageReportText]
  ] as const) {
    const absolutePath = resolve(rootDir, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, text, 'utf8');
  }
}

function isMain(metaUrl: string): boolean {
  return process.argv[1] !== undefined && metaUrl === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMain(import.meta.url)) {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  await writePhase46dNativeArtifacts(rootDir);
}

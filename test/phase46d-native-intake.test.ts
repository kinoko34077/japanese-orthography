import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { TextDecoder } from 'node:util';
import test from 'node:test';
import {
  parseColonDictionaryHtml,
  parseExceptionVerbHtml,
  parseKkhKanaJisyo,
  parseNativeGuideHtml,
  type NativeKanaParseResult
} from '../tools/native-kana-source-parser.ts';
import {
  buildCoverageSummary,
  validateCoverageAccounting
} from '../tools/intake-accounting.ts';

const repositoryRoot = process.cwd();

async function sourceText(path: string): Promise<string> {
  const bytes = await readFile(path);
  const header = bytes.subarray(0, 2048).toString('latin1').toLowerCase();
  if (header.includes('charset=x-sjis') || header.includes('charset=shift_jis')) {
    return new TextDecoder('shift_jis').decode(bytes);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function loadClassifier(): Promise<Record<string, any> | null> {
  try {
    return await import('../tools/' + 'native-kana-intake.ts') as Record<string, any>;
  } catch {
    return null;
  }
}

async function loadGenerator(): Promise<Record<string, any> | null> {
  try {
    return await import('../tools/' + 'generate-native-kana.ts') as Record<string, any>;
  } catch {
    return null;
  }
}

interface ParsedSources {
  kkh: NativeKanaParseResult;
  dictionary: NativeKanaParseResult;
  animalPlant: NativeKanaParseResult;
  exceptionVerbs: NativeKanaParseResult;
  guide: NativeKanaParseResult;
}

async function parsedSources(): Promise<ParsedSources> {
  const [kkh, dictionary, animalPlant, exceptionVerbs, guide] = await Promise.all([
    sourceText('data/sources/kkh/19b24f88ab55809a186d88c465959548495b26a2/kana-jisyo'),
    sourceText('仮名遣等資料/仮名遣い辞典本文.html'),
    sourceText('仮名遣等資料/動物名・植物名歴史的仮名遣い辞典.html'),
    sourceText('仮名遣等資料/例外動詞一覧：歴史的仮名遣い教室.html'),
    sourceText('仮名遣等資料/歴史的仮名遣いで書きたい.html')
  ]);
  return {
    kkh: parseKkhKanaJisyo(kkh, 'phase46d-kkh-kana'),
    dictionary: parseColonDictionaryHtml(dictionary, 'phase46d-native-dictionary'),
    animalPlant: parseColonDictionaryHtml(animalPlant, 'phase46d-animal-plant'),
    exceptionVerbs: parseExceptionVerbHtml(exceptionVerbs, 'phase46d-exception-verbs'),
    guide: parseNativeGuideHtml(guide, 'phase46d-native-guide')
  };
}

test('Phase 4.6D classifier exposes canonical snapshots, intake builder, and coverage report builder', async () => {
  const classifier = await loadClassifier();
  assert.ok(classifier, 'native kana intake classifier module must exist');
  assert.ok(Array.isArray(classifier.PHASE46D_NATIVE_SOURCE_SNAPSHOTS));
  assert.equal(typeof classifier.buildPhase46dNativeKanaIntake, 'function');
  assert.equal(typeof classifier.buildPhase46dNativeKanaCoverageReport, 'function');
});

test('KKH coverage classifies 6953 unique mappings, 198 ambiguous records, and 257 disabled records', async () => {
  const classifier = await loadClassifier();
  assert.ok(classifier, 'native kana intake classifier module must exist');
  const parsed = await parsedSources();
  const bundle = classifier.buildPhase46dNativeKanaIntake(parsed);

  assert.equal(bundle.records.length, 10338);
  const kkh = bundle.records.filter((record: any) => record.sourceRef === 'phase46d-kkh-kana');
  assert.equal(kkh.length, 7408);
  assert.equal(kkh.filter((record: any) => record.disposition === 'admitted').length, 6953);
  assert.equal(kkh.filter((record: any) => record.disposition === 'candidate_ambiguous').length, 198);
  assert.equal(kkh.filter((record: any) => record.disposition === 'excluded_unresolved').length, 257);
  assert.equal(kkh.filter((record: any) => record.sourceRecordKind === 'disabled').length, 257);
  assert.equal(kkh.filter((record: any) => record.exclusionReason === 'source_disabled').length, 257);

  const taste = kkh.filter((record: any) => record.modernSurface === '味わおう');
  assert.equal(taste.length, 2);
  for (const record of taste) {
    assert.equal(record.disposition, 'candidate_ambiguous');
    assert.deepEqual([...record.alternatives].sort(), ['味はゝう', '味ははう'].sort());
  }
});

test('committed dictionaries admit unique readings, preserve alternatives, and exclude opaque paired structures', async () => {
  const classifier = await loadClassifier();
  assert.ok(classifier, 'native kana intake classifier module must exist');
  const bundle = classifier.buildPhase46dNativeKanaIntake(await parsedSources());

  const dictionary = bundle.records.filter((record: any) => record.sourceRef === 'phase46d-native-dictionary');
  assert.equal(dictionary.length, 1195);

  const ai = dictionary.find((record: any) => record.modernSurface === '藍');
  assert.equal(ai?.disposition, 'admitted');
  assert.equal(ai?.historicalReading, 'あゐ');

  const aiso = dictionary.find((record: any) => record.modernSurface === '愛想');
  assert.equal(aiso?.disposition, 'candidate_ambiguous');
  assert.deepEqual([...aiso.alternatives].sort(), ['あいそ', 'あいさう'].sort());

  const paired = dictionary.find((record: any) => record.modernSurface === '味、味わう');
  assert.equal(paired?.disposition, 'excluded_unresolved');
  assert.equal(paired?.exclusionReason, 'source_structure_requires_manual_disambiguation');

  const animal = bundle.records.find((record: any) => (
    record.sourceRef === 'phase46d-animal-plant' && record.modernSurface === 'アイゴ'
  ));
  assert.equal(animal?.disposition, 'admitted');
  assert.equal(animal?.historicalReading, 'アヰゴ');
});

test('exception-verb and native-guide records consume coverage without manufacturing unsupported modern mappings', async () => {
  const classifier = await loadClassifier();
  assert.ok(classifier, 'native kana intake classifier module must exist');
  const bundle = classifier.buildPhase46dNativeKanaIntake(await parsedSources());

  const exception = bundle.records.filter((record: any) => record.sourceRef === 'phase46d-exception-verbs');
  assert.equal(exception.length, 111);
  assert.equal(exception.every((record: any) => record.disposition === 'excluded_unresolved'), true);
  assert.equal(exception.every((record: any) => record.exclusionReason === 'requires_modern_surface_derivation'), true);

  const guide = bundle.records.filter((record: any) => record.sourceRef === 'phase46d-native-guide');
  assert.equal(guide.length, 255);
  assert.equal(guide.every((record: any) => record.disposition === 'excluded_unresolved'), true);
  assert.equal(guide.filter((record: any) => record.sourceRecordKind === 'explanatory').length, 16);
  assert.equal(guide.filter((record: any) => record.exclusionReason === 'non_transformational_explanation').length, 16);
  assert.equal(guide.filter((record: any) => record.exclusionReason === 'requires_modern_surface_derivation').length, 239);
});

test('all five coverage-contract snapshots partition exactly with no parser remainder', async () => {
  const classifier = await loadClassifier();
  assert.ok(classifier, 'native kana intake classifier module must exist');
  const parsed = await parsedSources();
  const bundle = classifier.buildPhase46dNativeKanaIntake(parsed);

  const parsedBySource = new Map<string, NativeKanaParseResult>([
    ['phase46d-kkh-kana', parsed.kkh],
    ['phase46d-native-dictionary', parsed.dictionary],
    ['phase46d-animal-plant', parsed.animalPlant],
    ['phase46d-exception-verbs', parsed.exceptionVerbs],
    ['phase46d-native-guide', parsed.guide]
  ]);

  const summaries = [];
  for (const snapshot of bundle.snapshots) {
    const source = parsedBySource.get(snapshot.sourceId);
    assert.ok(source, snapshot.sourceId);
    const input = {
      snapshot,
      discoveredRecordIds: source.discoveredRecordIds,
      records: bundle.records,
      remainders: source.remainders
    };
    assert.deepEqual(validateCoverageAccounting(input), [], snapshot.sourceId);
    const summary = buildCoverageSummary(input);
    assert.equal(summary.unclassified, 0, snapshot.sourceId);
    assert.equal(summary.unexpected, 0, snapshot.sourceId);
    assert.equal(summary.unparsedMappingRecords, 0, snapshot.sourceId);
    assert.equal(summary.discovered, summary.admitted + summary.ambiguous + summary.excluded, snapshot.sourceId);
    summaries.push(summary);
  }

  assert.deepEqual(
    summaries.map(summary => [summary.sourceId, summary.discovered]),
    [
      ['phase46d-kkh-kana', 7408],
      ['phase46d-native-dictionary', 1195],
      ['phase46d-animal-plant', 1369],
      ['phase46d-exception-verbs', 111],
      ['phase46d-native-guide', 255]
    ]
  );
});

test('generated Phase 4.6D intake and coverage report are canonical outputs of the source pipeline', async () => {
  const generator = await loadGenerator();
  assert.ok(generator, 'native kana generator module must exist');
  assert.equal(typeof generator.buildPhase46dNativeArtifacts, 'function');

  const generated = await generator.buildPhase46dNativeArtifacts(repositoryRoot);
  const [intake, report] = await Promise.all([
    readFile('data/intake/phase46d-native-kana.json', 'utf8'),
    readFile('data/reports/phase46d-native-kana-coverage.json', 'utf8')
  ]);
  assert.equal(intake, generated.intakeText);
  assert.equal(report, generated.coverageReportText);
});

test('native coverage validation CLI succeeds on canonical Phase 4.6D artifacts', () => {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', join(repositoryRoot, 'tools', 'validate-native-kana.ts')],
    { cwd: repositoryRoot, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Phase 4\.6D native kana validation OK: 10338 records/);
});

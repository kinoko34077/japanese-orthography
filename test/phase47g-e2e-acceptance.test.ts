import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createSchemaValidator } from '../tools/schema-validator.ts';
import {
  applyFullSizeSokuonPreference,
  collapsePresentationCandidates,
  expandIterationMarks,
  foldKanaScript,
  renderIterationMarks
} from '../tools/kana-orthography.ts';
import {
  parseOfficialHomophoneDomainTable,
  resolveHomophoneDomainContext
} from '../tools/contextual-orthography.ts';
import {
  buildNativeResidualCandidateCensus,
  selectHistoricalCandidate
} from '../tools/candidate-preference.ts';
import {
  projectSafeCharacterSlice,
  resolveProductiveOrthography
} from '../tools/productive-orthography.ts';
import {
  projectPhase46dNativeArtifact
} from '../tools/normalized-relation-compiler.ts';
import {
  canonicalStringifyNormalizedGraph,
  type NormalizedOrthographyRelation
} from '../tools/normalized-relation-model.ts';
import {
  canonicalStringifyCompactArtifact,
  compileCompactOrthographyArtifact,
  createCompactOrthographyRuntime,
  inflateCompactOrthographyArtifact
} from '../tools/compact-orthography.ts';
import {
  createApplicabilityLedger,
  ledgerEntryFromCandidateSelection,
  ledgerEntryFromProductiveResolution,
  queryApplicabilityLedgerByRule
} from '../tools/applicability-ledger.ts';

const validate = createSchemaValidator();

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

async function loadUmd(path: string) {
  const source = await readFile(path, 'utf8');
  const sandbox: Record<string, any> = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: path });
  return sandbox;
}

async function nativeRuntime() {
  const [artifact, sandbox] = await Promise.all([
    json('data/historical/native/phase46d-native-kana.json'),
    loadUmd('runtime/historical-native-runtime.js')
  ]);
  return {
    artifact,
    runtime: sandbox.HistoricalNativeRuntime.createHistoricalNativeRuntime(
      artifact,
      { lexicalNamespaceId: artifact.lexicalNamespaceId }
    )
  };
}

async function sinoRuntime() {
  const [artifact, sandbox] = await Promise.all([
    json('data/historical/sino/phase46e-sino-kana.json'),
    loadUmd('runtime/historical-sino-runtime.js')
  ]);
  return sandbox.HistoricalSinoRuntime.createHistoricalSinoRuntime(artifact);
}

test('Phase 4.7 E2E: accepted Phase-4.6 exact/candidate channels survive unchanged', async () => {
  const { runtime } = await nativeRuntime();

  const exact = runtime.lookupSurface('植え');
  assert.equal(exact?.status, 'resolved');
  assert.equal(exact?.surface, '植ゑ');

  const mixedSurface = runtime.lookupSurface('向こう');
  assert.equal(mixedSurface?.status, 'candidates');
  assert.equal(mixedSurface?.surface, '向かう');
  assert.deepEqual(
    Array.from(mixedSurface?.readingCandidates ?? []),
    ['むかう', 'むかふ']
  );

  const mixedReading = runtime.lookupSurface('うじうじ');
  assert.equal(mixedReading?.status, 'candidates');
  assert.equal(mixedReading?.reading, 'うぢうぢ');
  assert.deepEqual(
    Array.from(mixedReading?.surfaceCandidates ?? []),
    ['うじ〳〵', 'うぢうぢ']
  );
});

test('Phase 4.7 E2E: dictionary-sensitive relations remain guarded and preserve wins', async () => {
  const unsafe: NormalizedOrthographyRelation = {
    id: 'unsafe:ben',
    relationKind: 'candidates',
    channel: 'character_form',
    applicationMode: 'contextual',
    fromForms: ['弁'],
    toForms: ['辨', '瓣', '辯', '辦'],
    basis: 'source_candidates',
    evidenceRefs: ['ev:ben']
  };
  const unsafeResult = resolveProductiveOrthography('弁護士', [unsafe]);
  assert.equal(unsafeResult.output, '弁護士');
  assert.ok(unsafeResult.blockedRules.some(rule =>
    rule.relationId === 'unsafe:ben' &&
    rule.reason === 'non_productive_application_mode'
  ));

  const slice = await json('data/deterministic/safe-character-first-slice.json');
  const safe = projectSafeCharacterSlice(slice);
  const preserve: NormalizedOrthographyRelation = {
    id: 'preserve:gakkou',
    relationKind: 'preserve',
    channel: 'surface',
    applicationMode: 'preserve_block',
    fromForms: ['学校'],
    toForms: ['学校'],
    basis: 'preserve_exact',
    identitySemantics: 'preserve',
    evidenceRefs: ['ev:preserve']
  };
  const preserved = resolveProductiveOrthography('学校外', [...safe, preserve]);
  assert.equal(preserved.output, '学校外');
  assert.ok(preserved.blockedRules.some(rule =>
    rule.reason === 'overlaps_preserve_block'
  ));
});

test('Phase 4.7 E2E: unknown strings receive only safe productive transformations with mixed trace', async () => {
  const slice = await json('data/deterministic/safe-character-first-slice.json');
  const safe = projectSafeCharacterSlice(slice);
  const result = resolveProductiveOrthography('超学校円X', safe);

  assert.equal(result.output, '超學校圓X');
  assert.ok(result.appliedRules.some(rule =>
    rule.input === '学' && rule.output === '學'
  ));
  assert.ok(result.appliedRules.some(rule =>
    rule.input === '円' && rule.output === '圓'
  ));
  assert.ok(result.segments.some(segment =>
    segment.input.includes('超') && segment.basis === 'unresolved'
  ));
  assert.ok(result.segments.some(segment =>
    segment.input.includes('X') && segment.basis === 'unresolved'
  ));
});

test('Phase 4.7 E2E: productive longest-match is deterministic and conflicts never use relation order', () => {
  const char: NormalizedOrthographyRelation = {
    id: 'char:gaku',
    relationKind: 'mapping',
    channel: 'character_form',
    applicationMode: 'character_productive',
    fromForms: ['学'],
    toForms: ['學'],
    basis: 'source_exact',
    evidenceRefs: ['ev:gaku']
  };
  const span: NormalizedOrthographyRelation = {
    id: 'span:gakkou',
    relationKind: 'mapping',
    channel: 'surface',
    applicationMode: 'substring_productive',
    fromForms: ['学校'],
    toForms: ['學校'],
    basis: 'source_exact',
    evidenceRefs: ['ev:gakkou']
  };
  assert.equal(
    resolveProductiveOrthography('新学校', [char, span]).output,
    '新學校'
  );

  const a: NormalizedOrthographyRelation = {
    ...span,
    id: 'conflict:a',
    fromForms: ['装丁'],
    toForms: ['装釘']
  };
  const b: NormalizedOrthographyRelation = {
    ...span,
    id: 'conflict:b',
    fromForms: ['装丁'],
    toForms: ['装幀']
  };
  const first = resolveProductiveOrthography('新装丁案', [a, b]);
  const second = resolveProductiveOrthography('新装丁案', [b, a]);
  assert.deepEqual(first, second);
  assert.equal(first.output, '新装丁案');
});

test('Phase 4.7 E2E: script and iteration rendering stay representational and boundary-scoped', () => {
  assert.equal(foldKanaScript('アカウ', { scriptFoldable: true }), 'あかう');
  assert.equal(foldKanaScript('アカウ', { scriptFoldable: false }), 'アカウ');

  assert.deepEqual(
    collapsePresentationCandidates(
      ['ああいふ', 'あゝいふ'],
      { scriptFoldable: false }
    ),
    [{ canonical: 'ああいふ', attestations: ['ああいふ', 'あゝいふ'] }]
  );

  assert.equal(renderIterationMarks('人人'), '人々');
  assert.equal(expandIterationMarks('人々'), '人人');
  assert.throws(
    () => expandIterationMarks('ゝあ'),
    /render-unit start/
  );

  assert.equal(
    applyFullSizeSokuonPreference(
      'しょっちう',
      { sameHistoricalRepresentation: false }
    ),
    'しょっちう'
  );
  assert.equal(
    applyFullSizeSokuonPreference(
      'しょっちう',
      { sameHistoricalRepresentation: true }
    ),
    'しょつちう'
  );
});

test('Phase 4.7 E2E: specialist metadata and Buddhist 字音 context select only when context exists', async () => {
  const tableText = await readFile(
    '仮名遣等資料/同音漢字書きかえ_対応表一式/同音漢字書きかえ_熟語対応表.csv',
    'utf8'
  );
  const rows = parseOfficialHomophoneDomainTable(tableText);

  const mining = resolveHomophoneDomainContext(rows, '溶接', { domains: ['鉱'] });
  assert.equal(mining.status, 'matched');
  assert.equal(mining.authority, 'metadata_only');
  assert.deepEqual(mining.historicalCandidates, ['熔接']);
  assert.equal(resolveHomophoneDomainContext(rows, '溶接').status, 'context_required');

  const sino = await sinoRuntime();
  const absent = sino.reconstructWord('法', 'ほう');
  assert.equal(absent.status, 'candidates');
  assert.deepEqual(
    JSON.parse(JSON.stringify(absent.historicalReadings)),
    ['はふ', 'ほふ']
  );
  const buddhist = sino.reconstructWord('法', 'ほう', { context: '仏教用語' });
  assert.equal(buddhist.status, 'resolved');
  assert.equal(buddhist.historicalReading, 'ほふ');
});

test('Phase 4.7 E2E: cross-channel and preference layers preserve original candidates and unresolved state', async () => {
  const cross = selectHistoricalCandidate({
    sourceCandidates: ['うじ〳〵', 'うぢうぢ'],
    exactCrossChannel: {
      value: 'うぢうぢ',
      ruleRef: 'cross:exact-reading',
      evidenceRefs: ['ev:reading']
    }
  });
  assert.equal(cross.selectedResult, 'うぢうぢ');
  assert.equal(cross.basis, 'cross_channel_selected');
  assert.deepEqual(cross.sourceCandidates, ['うじ〳〵', 'うぢうぢ']);

  const preferred = selectHistoricalCandidate({
    sourceCandidates: ['はふ', 'ほふ'],
    diachronicRules: [{
      id: 'dia:test',
      admissibleCandidates: ['はふ', 'ほふ'],
      preferred: 'はふ'
    }]
  });
  assert.equal(preferred.selectedResult, 'はふ');
  assert.equal(preferred.basis, 'generated_diachronic');
  assert.deepEqual(preferred.sourceCandidates, ['はふ', 'ほふ']);

  const unresolved = selectHistoricalCandidate({
    sourceCandidates: ['むかう', 'むかふ']
  });
  assert.equal(unresolved.status, 'candidates');
  assert.equal(unresolved.selectedResult, null);

  const artifact = await json('data/historical/native/phase46d-native-kana.json');
  const census = buildNativeResidualCandidateCensus(artifact);
  assert.ok(census.residualEntries > 0);
  assert.ok(census.residualEntries < census.totalEntries);
});

test('Phase 4.7 E2E: compact runtime is reproducible and ledger exposes applied/blocked rules', async () => {
  const native = await json('data/historical/native/phase46d-native-kana.json');
  const graph = projectPhase46dNativeArtifact(native);
  const compact = compileCompactOrthographyArtifact(graph);
  const inflated = inflateCompactOrthographyArtifact(compact);

  assert.equal(
    canonicalStringifyNormalizedGraph(inflated),
    canonicalStringifyNormalizedGraph(graph)
  );

  const reversed = structuredClone(graph);
  reversed.sources.reverse();
  reversed.relations.reverse();
  assert.equal(
    canonicalStringifyCompactArtifact(compileCompactOrthographyArtifact(reversed)),
    canonicalStringifyCompactArtifact(compact)
  );

  const runtime = createCompactOrthographyRuntime(compact);
  assert.deepEqual(
    runtime.lookup('reading', 'うじうじ')[0]?.toForms,
    ['うぢうぢ']
  );

  const relation: NormalizedOrthographyRelation = {
    id: 'safe:gaku',
    relationKind: 'mapping',
    channel: 'character_form',
    applicationMode: 'character_productive',
    fromForms: ['学'],
    toForms: ['學'],
    basis: 'source_exact',
    evidenceRefs: ['ev:gaku']
  };
  const blocked: NormalizedOrthographyRelation = {
    id: 'unsafe:tai',
    relationKind: 'mapping',
    channel: 'surface',
    applicationMode: 'exact_lexeme',
    fromForms: ['台'],
    toForms: ['臺'],
    basis: 'source_exact',
    evidenceRefs: ['ev:tai']
  };
  const productive = resolveProductiveOrthography('学台', [relation, blocked]);
  const preference = selectHistoricalCandidate({
    sourceCandidates: ['はふ', 'ほふ'],
    diachronicRules: [{
      id: 'dia:law',
      admissibleCandidates: ['はふ', 'ほふ'],
      preferred: 'はふ'
    }]
  });
  const ledger = createApplicabilityLedger([
    ledgerEntryFromProductiveResolution(productive),
    ledgerEntryFromCandidateSelection({ input: '法' }, preference)
  ]);

  assert.deepEqual(validate(ledger, 'orthography-applicability-ledger-v1'), []);
  assert.equal(queryApplicabilityLedgerByRule(ledger, 'safe:gaku').length, 1);
  assert.equal(queryApplicabilityLedgerByRule(ledger, 'unsafe:tai').length, 1);
  assert.equal(queryApplicabilityLedgerByRule(ledger, 'dia:law').length, 1);
  assert.ok(ledger.entries.some(entry =>
    entry.blockedRules.some(rule =>
      rule.ruleRef === 'unsafe:tai' &&
      rule.reason === 'non_productive_application_mode'
    )
  ));
});

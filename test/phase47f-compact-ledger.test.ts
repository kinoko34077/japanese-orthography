import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createSchemaValidator } from '../tools/schema-validator.ts';
import {
  canonicalStringifyNormalizedGraph
} from '../tools/normalized-relation-model.ts';
import {
  projectPhase46dNativeArtifact
} from '../tools/normalized-relation-compiler.ts';
import {
  canonicalStringifyCompactArtifact,
  compileCompactOrthographyArtifact,
  createCompactOrthographyRuntime,
  inflateCompactOrthographyArtifact,
  measureCompactOrthographyArtifact
} from '../tools/compact-orthography.ts';
import {
  createApplicabilityLedger,
  ledgerEntryFromCandidateSelection,
  ledgerEntryFromProductiveResolution,
  queryApplicabilityLedgerByRule
} from '../tools/applicability-ledger.ts';
import { selectHistoricalCandidate } from '../tools/candidate-preference.ts';
import { resolveProductiveOrthography } from '../tools/productive-orthography.ts';

const validate = createSchemaValidator();

async function nativeGraph() {
  const artifact = JSON.parse(
    await readFile('data/historical/native/phase46d-native-kana.json', 'utf8')
  ) as Record<string, any>;
  return projectPhase46dNativeArtifact(artifact);
}

test('compact runtime artifact round-trips the accepted normalized native graph losslessly', async () => {
  const graph = await nativeGraph();
  const compact = compileCompactOrthographyArtifact(graph);
  const inflated = inflateCompactOrthographyArtifact(compact);

  assert.equal(
    canonicalStringifyNormalizedGraph(inflated),
    canonicalStringifyNormalizedGraph(graph)
  );
  assert.equal(compact.schemaVersion, '2');
  assert.equal(compact.kind, 'compact_orthography_runtime');
  assert.ok(compact.strings.length > 0);
  assert.equal(compact.relations.length, graph.relations.length);
});

test('compact compilation is deterministic and source-order independent', async () => {
  const graph = await nativeGraph();
  const reversed = structuredClone(graph);
  reversed.sources.reverse();
  reversed.relations.reverse();
  for (const relation of reversed.relations) {
    relation.fromForms.reverse();
    relation.toForms.reverse();
    relation.sourceRefs?.reverse();
    relation.evidenceRefs.reverse();
  }

  assert.equal(
    canonicalStringifyCompactArtifact(compileCompactOrthographyArtifact(reversed)),
    canonicalStringifyCompactArtifact(compileCompactOrthographyArtifact(graph))
  );
});

test('generated indexes retrieve the same normalized relations by channel and source form', async () => {
  const graph = await nativeGraph();
  const compact = compileCompactOrthographyArtifact(graph);
  const runtime = createCompactOrthographyRuntime(compact);

  const surface = runtime.lookup('surface', 'うじうじ');
  assert.equal(surface.length, 1);
  assert.equal(surface[0]?.relationKind, 'candidates');
  assert.deepEqual(surface[0]?.toForms, ['うじ〳〵', 'うぢうぢ']);

  const reading = runtime.lookup('reading', 'うじうじ');
  assert.equal(reading.length, 1);
  assert.equal(reading[0]?.relationKind, 'mapping');
  assert.deepEqual(reading[0]?.toForms, ['うぢうぢ']);

  const missing = runtime.lookup('surface', '不存在');
  assert.deepEqual(missing, []);
});

test('compact native projection is smaller than canonical normalized JSON and records byte measurements', async () => {
  const graph = await nativeGraph();
  const compact = compileCompactOrthographyArtifact(graph);
  const measurement = measureCompactOrthographyArtifact(graph, compact);

  assert.ok(measurement.canonicalBytes > 0);
  assert.ok(measurement.compactBytes > 0);
  assert.ok(measurement.compactBytes < measurement.canonicalBytes);
  assert.ok(measurement.ratio > 0 && measurement.ratio < 1);

  console.log(
    'Phase 4.7F compact-size',
    JSON.stringify(measurement)
  );
});

test('candidate selection produces a schema-valid applicability ledger with applied and blocked preference rules', () => {
  const selection = selectHistoricalCandidate({
    sourceCandidates: ['はふ', 'ほふ'],
    diachronicRules: [{
      id: 'dia:prefer-hafu',
      admissibleCandidates: ['はふ', 'ほふ'],
      preferred: 'はふ',
      evidenceRefs: ['ev:dia']
    }],
    manualPriority: {
      id: 'manual:law',
      candidateSet: ['はふ', 'ほふ'],
      preferred: 'ほふ',
      rationale: 'residual fallback'
    }
  });

  const entry = ledgerEntryFromCandidateSelection({
    input: '法',
    lexicalIdentity: 'test:law',
    context: { usage: 'general' }
  }, selection);
  const ledger = createApplicabilityLedger([entry]);

  assert.deepEqual(validate(ledger, 'orthography-applicability-ledger-v1'), []);
  assert.equal(ledger.entries[0]?.selectedResult, 'はふ');
  assert.equal(ledger.entries[0]?.basis, 'generated_diachronic');
  assert.equal(ledger.entries[0]?.generationApplied, true);
  assert.equal(ledger.entries[0]?.preferenceApplied, true);
  assert.ok(ledger.entries[0]?.ruleRefs.includes('dia:prefer-hafu'));
  assert.ok(ledger.entries[0]?.ruleRefs.includes('manual:law'));
  assert.ok(ledger.entries[0]?.blockedRules.some((rule: any) =>
    rule.ruleRef === 'manual:law'
  ));
  assert.equal(queryApplicabilityLedgerByRule(ledger, 'manual:law').length, 1);
});

test('productive resolution ledger preserves applied and blocked rule reasons', () => {
  const relations = [{
    id: 'char:gaku',
    relationKind: 'mapping' as const,
    channel: 'character_form' as const,
    applicationMode: 'character_productive' as const,
    fromForms: ['学'],
    toForms: ['學'],
    basis: 'source_exact' as const,
    sourceRefs: ['source:gaku'],
    evidenceRefs: ['ev:gaku']
  }, {
    id: 'exact:tai',
    relationKind: 'mapping' as const,
    channel: 'surface' as const,
    applicationMode: 'exact_lexeme' as const,
    fromForms: ['台'],
    toForms: ['臺'],
    basis: 'source_exact' as const,
    evidenceRefs: ['ev:tai']
  }];

  const resolution = resolveProductiveOrthography('新学台', relations);
  const ledger = createApplicabilityLedger([
    ledgerEntryFromProductiveResolution(resolution)
  ]);

  assert.deepEqual(validate(ledger, 'orthography-applicability-ledger-v1'), []);
  assert.equal(ledger.entries[0]?.selectedResult, '新學台');
  assert.equal(ledger.entries[0]?.generationApplied, true);
  assert.equal(ledger.entries[0]?.preferenceApplied, false);
  assert.ok(ledger.entries[0]?.ruleRefs.includes('char:gaku'));
  assert.ok(ledger.entries[0]?.ruleRefs.includes('exact:tai'));
  assert.ok(ledger.entries[0]?.blockedRules.some((rule: any) =>
    rule.ruleRef === 'exact:tai' &&
    rule.reason === 'non_productive_application_mode'
  ));
  assert.equal(queryApplicabilityLedgerByRule(ledger, 'char:gaku').length, 1);
  assert.equal(queryApplicabilityLedgerByRule(ledger, 'exact:tai').length, 1);
});

test('ledger canonicalization is deterministic independent of entry input order', () => {
  const a = ledgerEntryFromCandidateSelection(
    { input: '甲' },
    selectHistoricalCandidate({ sourceCandidates: ['甲', '乙'] })
  );
  const b = ledgerEntryFromCandidateSelection(
    { input: '乙' },
    selectHistoricalCandidate({
      sourceCandidates: ['丙', '丁'],
      manualPriority: {
        id: 'manual:b',
        candidateSet: ['丁', '丙'],
        preferred: '丁',
        rationale: 'test'
      }
    })
  );

  assert.deepEqual(
    createApplicabilityLedger([b, a]),
    createApplicabilityLedger([a, b])
  );
});

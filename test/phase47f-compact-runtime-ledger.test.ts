import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createSchemaValidator } from '../tools/schema-validator.ts';
import {
  canonicalizeNormalizedGraph,
  type NormalizedOrthographyGraph,
  type NormalizedOrthographyRelation
} from '../tools/normalized-relation-model.ts';
import { projectPhase46dNativeArtifact } from '../tools/normalized-relation-compiler.ts';
import { resolveProductiveOrthography } from '../tools/productive-orthography.ts';
import { selectHistoricalCandidate } from '../tools/candidate-preference.ts';
import {
  canonicalStringifyCompactRuntime,
  compileCompactOrthographyRuntime,
  decodeCompactOrthographyRuntime,
  lookupCompactRelations,
  measureCompactRuntime
} from '../tools/compact-orthography-runtime.ts';
import {
  buildApplicabilityLedger,
  candidateSelectionToLedgerEntry,
  productiveResolutionToLedgerEntries,
  queryApplicabilityLedgerByRule
} from '../tools/applicability-ledger.ts';

const validate = createSchemaValidator();

function relation(
  id: string,
  from: string,
  to: string,
  applicationMode: NormalizedOrthographyRelation['applicationMode'],
  basis: NormalizedOrthographyRelation['basis'] = 'source_exact'
): NormalizedOrthographyRelation {
  return {
    id,
    relationKind: 'mapping',
    channel: applicationMode === 'character_productive' ? 'character_form' : 'surface',
    applicationMode,
    fromForms: [from],
    toForms: [to],
    basis,
    sourceRefs: ['source:test'],
    evidenceRefs: [`evidence:${id}`]
  };
}

function graph(relations: NormalizedOrthographyRelation[]): NormalizedOrthographyGraph {
  return {
    schemaVersion: '1',
    kind: 'normalized_orthography_graph',
    lexicalNamespaceId: 'test-namespace',
    sources: [{
      sourceId: 'source:test',
      sourceClass: 'committed_reference',
      title: 'test',
      versionRef: 'test',
      license: 'test',
      coverageRole: 'supporting_only',
      observedAt: '2026-10-01'
    }],
    relations
  };
}

test('compact runtime deterministically round-trips accepted normalized semantics', () => {
  const source = graph([
    {
      ...relation('span:bengo', '弁護', '辯護', 'substring_productive'),
      lexicalIdentity: 'lex:bengo',
      requiredMorphology: { pos: 'noun' }
    },
    {
      ...relation('char:gaku', '学', '學', 'character_productive'),
      sourceRefs: undefined
    }
  ]);

  const first = compileCompactOrthographyRuntime(source);
  const second = compileCompactOrthographyRuntime({
    ...source,
    sources: [...source.sources].reverse(),
    relations: [...source.relations].reverse()
  });

  assert.equal(canonicalStringifyCompactRuntime(first), canonicalStringifyCompactRuntime(second));
  assert.deepEqual(
    decodeCompactOrthographyRuntime(first),
    canonicalizeNormalizedGraph(source)
  );
  assert.ok(first.strings.length > 0);
  assert.ok(first.fromIndex.length > 0);
});

test('compact runtime indexes source forms without changing relation applicability', () => {
  const source = graph([
    relation('exact:ben', '弁', '辯', 'exact_lexeme'),
    relation('span:bengo', '弁護', '辯護', 'substring_productive'),
    relation('char:gaku', '学', '學', 'character_productive')
  ]);
  const compact = compileCompactOrthographyRuntime(source);

  assert.deepEqual(
    lookupCompactRelations(compact, '弁護').map(entry => entry.id),
    ['span:bengo']
  );
  assert.deepEqual(
    lookupCompactRelations(compact, '弁').map(entry => [entry.id, entry.applicationMode]),
    [['exact:ben', 'exact_lexeme']]
  );
});

test('real Phase-4.6D projection is smaller in compact generated form and decodes losslessly', async () => {
  const artifact = JSON.parse(
    await readFile('data/historical/native/phase46d-native-kana.json', 'utf8')
  ) as Record<string, any>;
  const normalized = projectPhase46dNativeArtifact(artifact);
  const compact = compileCompactOrthographyRuntime(normalized);
  const measurement = measureCompactRuntime(normalized, compact);

  assert.deepEqual(decodeCompactOrthographyRuntime(compact), normalized);
  assert.ok(measurement.canonicalBytes > 0);
  assert.ok(measurement.compactBytes > 0);
  assert.ok(measurement.compactBytes < measurement.canonicalBytes);
  assert.ok(measurement.ratio > 0 && measurement.ratio < 1);
});

test('candidate decision becomes a schema-valid ledger entry with applied and blocked rules', () => {
  const decision = selectHistoricalCandidate({
    sourceCandidates: ['はふ', 'ほふ'],
    diachronicRules: [{
      id: 'dia:prefer-hafu',
      admissibleCandidates: ['はふ', 'ほふ'],
      preferred: 'はふ',
      evidenceRefs: ['research:dia']
    }],
    manualPriority: {
      id: 'manual:lower',
      candidateSet: ['はふ', 'ほふ'],
      preferred: 'ほふ',
      rationale: 'lower-priority residual only'
    }
  });

  const entry = candidateSelectionToLedgerEntry({
    input: 'ほう',
    lexicalIdentity: 'lex:法',
    context: { domain: 'general' },
    decision
  });
  const ledger = buildApplicabilityLedger([entry]);

  assert.deepEqual(validate(ledger, 'orthography-applicability-ledger-v1'), []);
  assert.deepEqual(ledger.entries[0]?.ruleRefs, ['dia:prefer-hafu']);
  assert.deepEqual(ledger.entries[0]?.blockedRules, [{
    ruleRef: 'manual:lower',
    reason: 'not_selected_by_precedence_or_applicability'
  }]);
  assert.equal(ledger.entries[0]?.generationApplied, true);
  assert.equal(ledger.entries[0]?.preferenceApplied, true);
});

test('productive trace projects applied and blocked rules into queryable ledger entries', () => {
  const relations = [
    relation('char:gaku', '学', '學', 'character_productive'),
    relation('span:gakkou', '学校', '學校', 'substring_productive')
  ];
  const resolution = resolveProductiveOrthography('新学校', relations);
  const ledger = buildApplicabilityLedger(
    productiveResolutionToLedgerEntries(resolution)
  );

  assert.deepEqual(validate(ledger, 'orthography-applicability-ledger-v1'), []);

  const applied = queryApplicabilityLedgerByRule(ledger, 'span:gakkou', 'applied');
  assert.equal(applied.length, 1);
  assert.equal(applied[0]?.selectedResult, '學校');
  assert.equal(applied[0]?.basis, 'generated_productive_span');

  const blocked = queryApplicabilityLedgerByRule(ledger, 'char:gaku', 'blocked');
  assert.equal(blocked.length, 1);
  assert.deepEqual(blocked[0]?.blockedRules, [{
    ruleRef: 'char:gaku',
    reason: 'shadowed_by_longer_match'
  }]);
});

test('ledger construction and queries are deterministic under entry order', () => {
  const a = candidateSelectionToLedgerEntry({
    input: 'まおす',
    decision: selectHistoricalCandidate({
      sourceCandidates: ['まうす', 'まをす']
    })
  });
  const b = candidateSelectionToLedgerEntry({
    input: 'ほう',
    decision: selectHistoricalCandidate({
      sourceCandidates: ['はふ', 'ほふ'],
      manualPriority: {
        id: 'manual:hou',
        candidateSet: ['はふ', 'ほふ'],
        preferred: 'はふ',
        rationale: 'reviewed residual'
      }
    })
  });

  const first = buildApplicabilityLedger([a, b]);
  const second = buildApplicabilityLedger([b, a]);
  assert.deepEqual(first, second);
  assert.deepEqual(
    queryApplicabilityLedgerByRule(first, 'manual:hou', 'either'),
    queryApplicabilityLedgerByRule(second, 'manual:hou', 'either')
  );
});

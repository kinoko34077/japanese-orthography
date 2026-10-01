import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createSchemaValidator } from '../tools/schema-validator.ts';
import {
  canonicalStringifyNormalizedGraph,
  canonicalizeNormalizedGraph,
  relationCardinality
} from '../tools/normalized-relation-model.ts';
import {
  projectPhase46dNativeArtifact,
  restorePhase46dNativeRelations
} from '../tools/normalized-relation-compiler.ts';

const validate = createSchemaValidator();

function minimalGraph(): Record<string, any> {
  return {
    schemaVersion: '1',
    kind: 'normalized_orthography_graph',
    lexicalNamespaceId: 'test-namespace',
    sources: [],
    relations: [{
      id: 'test:ben',
      relationKind: 'candidates',
      channel: 'character_form',
      applicationMode: 'contextual',
      fromForms: ['弁'],
      toForms: ['辨', '瓣', '辯', '辦'],
      basis: 'source_candidates',
      evidenceRefs: ['test:evidence']
    }]
  };
}

function minimalLedger(): Record<string, any> {
  return {
    schemaVersion: '1',
    kind: 'orthography_applicability_ledger',
    entries: [{
      input: '弁',
      sourceCandidates: ['辨', '瓣', '辯', '辦'],
      generatedCandidates: [],
      selectedResult: null,
      basis: 'unresolved',
      ruleRefs: ['test:ben'],
      sourceRefs: [],
      evidenceRefs: ['test:evidence'],
      generationApplied: false,
      preferenceApplied: false,
      blockedRules: [{
        ruleRef: 'test:ben',
        reason: 'lexical_context_required'
      }]
    }]
  };
}

test('Phase 4.7A schemas accept normalized graph and applicability ledger', () => {
  assert.deepEqual(validate(minimalGraph(), 'normalized-orthography-graph-v1'), []);
  assert.deepEqual(validate(minimalLedger(), 'orthography-applicability-ledger-v1'), []);
});

test('Phase 4.7A schema rejects unknown application modes and result bases', () => {
  const graph = minimalGraph();
  graph.relations[0].applicationMode = 'unsafe_magic';
  assert.ok(validate(graph, 'normalized-orthography-graph-v1').length > 0);

  const ledger = minimalLedger();
  ledger.entries[0].basis = 'guessed';
  assert.ok(validate(ledger, 'orthography-applicability-ledger-v1').length > 0);
});

test('relation cardinality is derived independently from semantic applicability', () => {
  const relation = minimalGraph().relations[0];
  assert.equal(relationCardinality(relation), 'one_to_many');
  assert.equal(relation.applicationMode, 'contextual');

  relation.applicationMode = 'exact_lexeme';
  assert.equal(relationCardinality(relation), 'one_to_many');
});

test('Phase 4.6D native artifact projects losslessly into normalized relations', async () => {
  const artifact = JSON.parse(
    await readFile('data/historical/native/phase46d-native-kana.json', 'utf8')
  ) as Record<string, any>;
  const graph = projectPhase46dNativeArtifact(artifact);

  assert.deepEqual(validate(graph, 'normalized-orthography-graph-v1'), []);
  assert.equal(
    graph.relations.length,
    artifact.identityRelations.length +
      artifact.surfaceRelations.length +
      artifact.readingRelations.length +
      artifact.ambiguousSurfaceCandidates.length +
      artifact.ambiguousReadingCandidates.length
  );

  const mukouSurface = graph.relations.find((relation: any) =>
    relation.channel === 'surface' &&
    relation.relationKind === 'mapping' &&
    relation.fromForms[0] === '向こう'
  );
  assert.deepEqual(mukouSurface?.toForms, ['向かう']);
  assert.equal(mukouSurface?.basis, 'source_exact');

  const mukouReading = graph.relations.find((relation: any) =>
    relation.channel === 'reading' &&
    relation.relationKind === 'candidates' &&
    relation.fromForms[0] === '向こう'
  );
  assert.deepEqual(mukouReading?.toForms, ['むかう', 'むかふ']);
  assert.equal(mukouReading?.basis, 'source_candidates');

  const ujReading = graph.relations.find((relation: any) =>
    relation.channel === 'reading' &&
    relation.relationKind === 'mapping' &&
    relation.fromForms[0] === 'うじうじ'
  );
  assert.deepEqual(ujReading?.toForms, ['うぢうぢ']);

  const ujSurface = graph.relations.find((relation: any) =>
    relation.channel === 'surface' &&
    relation.relationKind === 'candidates' &&
    relation.fromForms[0] === 'うじうじ'
  );
  assert.deepEqual(ujSurface?.toForms, ['うじ〳〵', 'うぢうぢ']);

  const restored = restorePhase46dNativeRelations(graph);
  assert.deepEqual(restored.identityRelations, artifact.identityRelations);
  assert.deepEqual(restored.surfaceRelations, artifact.surfaceRelations);
  assert.deepEqual(restored.readingRelations, artifact.readingRelations);
  assert.deepEqual(restored.ambiguousSurfaceCandidates, artifact.ambiguousSurfaceCandidates);
  assert.deepEqual(restored.ambiguousReadingCandidates, artifact.ambiguousReadingCandidates);
});

test('normalized projection is deterministic and source-order independent', async () => {
  const artifact = JSON.parse(
    await readFile('data/historical/native/phase46d-native-kana.json', 'utf8')
  ) as Record<string, any>;
  const reversed = structuredClone(artifact);
  reversed.sources.reverse();
  reversed.identityRelations.reverse();
  reversed.surfaceRelations.reverse();
  reversed.readingRelations.reverse();
  reversed.ambiguousSurfaceCandidates.reverse();
  reversed.ambiguousReadingCandidates.reverse();

  assert.equal(
    canonicalStringifyNormalizedGraph(projectPhase46dNativeArtifact(artifact)),
    canonicalStringifyNormalizedGraph(projectPhase46dNativeArtifact(reversed))
  );
});


test('identity semantics distinguish implicit, source-attested, and explicit preserve states', () => {
  const graph = minimalGraph();

  graph.relations = [{
    id: 'identity:implicit',
    relationKind: 'identity',
    channel: 'surface',
    applicationMode: 'generated_pattern',
    fromForms: ['士'],
    toForms: ['士'],
    basis: 'implicit_identity',
    identitySemantics: 'implicit',
    evidenceRefs: []
  }, {
    id: 'identity:attested',
    relationKind: 'identity',
    channel: 'surface',
    applicationMode: 'exact_lexeme',
    fromForms: ['候補'],
    toForms: ['候補'],
    basis: 'attested_identity',
    identitySemantics: 'attested',
    evidenceRefs: ['source:attested-identity']
  }, {
    id: 'identity:preserve',
    relationKind: 'preserve',
    channel: 'surface',
    applicationMode: 'preserve_block',
    fromForms: ['武弁'],
    toForms: ['武弁'],
    basis: 'preserve_exact',
    identitySemantics: 'preserve',
    evidenceRefs: ['source:preserve']
  }];

  assert.deepEqual(validate(graph, 'normalized-orthography-graph-v1'), []);

  const invalid = structuredClone(graph);
  delete invalid.relations[0].identitySemantics;
  assert.ok(validate(invalid, 'normalized-orthography-graph-v1').length > 0);

  invalid.relations[0].identitySemantics = 'implicit';
  invalid.relations[2].applicationMode = 'exact_lexeme';
  assert.ok(validate(invalid, 'normalized-orthography-graph-v1').length > 0);
});


test('canonical normalized graph rejects duplicate relation IDs', () => {
  const graph = minimalGraph();
  graph.relations.push(structuredClone(graph.relations[0]));
  assert.throws(
    () => canonicalizeNormalizedGraph(graph as any),
    /Duplicate normalized relation id/
  );
});

test('canonical normalized graph rejects contradictory identity and preserve semantics', () => {
  const identity = minimalGraph();
  identity.relations = [{
    id: 'identity:broken',
    relationKind: 'identity',
    channel: 'surface',
    applicationMode: 'exact_lexeme',
    fromForms: ['士'],
    toForms: ['師'],
    basis: 'implicit_identity',
    identitySemantics: 'implicit',
    evidenceRefs: []
  }];
  assert.throws(
    () => canonicalizeNormalizedGraph(identity as any),
    /identity relation must preserve the same form set/
  );

  identity.relations[0].toForms = ['士'];
  delete identity.relations[0].identitySemantics;
  assert.throws(
    () => canonicalizeNormalizedGraph(identity as any),
    /identity relation requires identity semantics/
  );

  const preserve = minimalGraph();
  preserve.relations = [{
    id: 'preserve:broken',
    relationKind: 'preserve',
    channel: 'surface',
    applicationMode: 'preserve_block',
    fromForms: ['弁'],
    toForms: ['辯'],
    basis: 'preserve_exact',
    identitySemantics: 'preserve',
    evidenceRefs: ['ev:preserve']
  }];
  assert.throws(
    () => canonicalizeNormalizedGraph(preserve as any),
    /preserve relation must preserve the same form set/
  );

  preserve.relations[0].toForms = ['弁'];
  preserve.relations[0].basis = 'source_exact';
  assert.throws(
    () => canonicalizeNormalizedGraph(preserve as any),
    /preserve relation requires preserve_exact basis/
  );
});

test('canonical normalized graph rejects invalid productive and preserve application modes', () => {
  const graph = minimalGraph();

  graph.relations = [{
    id: 'productive:ambiguous',
    relationKind: 'candidates',
    channel: 'surface',
    applicationMode: 'substring_productive',
    fromForms: ['装丁'],
    toForms: ['装幀', '装釘'],
    basis: 'source_candidates',
    evidenceRefs: ['ev:productive']
  }];
  assert.throws(
    () => canonicalizeNormalizedGraph(graph as any),
    /productive relation must be deterministic mapping/
  );

  graph.relations = [{
    id: 'productive:character-span',
    relationKind: 'mapping',
    channel: 'character_form',
    applicationMode: 'character_productive',
    fromForms: ['学校'],
    toForms: ['學校'],
    basis: 'source_exact',
    evidenceRefs: ['ev:character']
  }];
  assert.throws(
    () => canonicalizeNormalizedGraph(graph as any),
    /character_productive relation must map single code points/
  );

  graph.relations = [{
    id: 'preserve:wrong-kind',
    relationKind: 'mapping',
    channel: 'surface',
    applicationMode: 'preserve_block',
    fromForms: ['学校'],
    toForms: ['学校'],
    basis: 'source_exact',
    evidenceRefs: ['ev:preserve']
  }];
  assert.throws(
    () => canonicalizeNormalizedGraph(graph as any),
    /preserve_block requires preserve relation kind/
  );
});

test('normalized graph schema rejects expressible semantic contradictions', () => {
  const preserveMode = minimalGraph();
  preserveMode.relations = [{
    id: 'preserve:wrong-kind',
    relationKind: 'mapping',
    channel: 'surface',
    applicationMode: 'preserve_block',
    fromForms: ['学校'],
    toForms: ['学校'],
    basis: 'source_exact',
    evidenceRefs: ['ev:preserve']
  }];
  assert.ok(validate(preserveMode, 'normalized-orthography-graph-v1').length > 0);

  const preserveBasis = minimalGraph();
  preserveBasis.relations = [{
    id: 'preserve:wrong-basis',
    relationKind: 'preserve',
    channel: 'surface',
    applicationMode: 'preserve_block',
    fromForms: ['学校'],
    toForms: ['学校'],
    basis: 'source_exact',
    identitySemantics: 'preserve',
    evidenceRefs: ['ev:preserve']
  }];
  assert.ok(validate(preserveBasis, 'normalized-orthography-graph-v1').length > 0);

  const mappingCandidates = minimalGraph();
  mappingCandidates.relations = [{
    id: 'mapping:multi-target',
    relationKind: 'mapping',
    channel: 'surface',
    applicationMode: 'exact_lexeme',
    fromForms: ['弁'],
    toForms: ['辨', '辯'],
    basis: 'source_exact',
    evidenceRefs: ['ev:mapping']
  }];
  assert.ok(validate(mappingCandidates, 'normalized-orthography-graph-v1').length > 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEntityGraph } from '../tools/lexical-entity-graph.ts';
import type { LexicalArtifact } from '../tools/lexical-compiler.ts';
import { buildLexicalSpanGraph } from '../tools/lexical-span-analysis.ts';
import type { NormalizedOrthographyRelation } from '../tools/normalized-relation-model.ts';
import { resolveOccurrenceOrthography } from '../tools/occurrence-orthography.ts';

function fixtures(rows: Array<[string,string]>) {
  const lemmas = rows.map(([surface, reading], i) => ({
    lemmaIndex: i, sourceLemmaId: i + 1, lemma: surface, lForm: reading,
    lexicalReading: reading, lexicalOrigin: 'sino' as const,
    lexicalIdentity: `unidic:test:lemma:${i + 1}`
  }));
  const morphologies = [{
    morphologyId: 0,
    pos: ['名詞','普通名詞','一般','*'] as [string,string,string,string],
    cType: '*', cForm: '*'
  }];
  const grouped = rows.map(([surface, reading], lemmaIndex) => ({ surface, reading, lemmaIndex }))
    .sort((a,b) => a.surface < b.surface ? -1 : a.surface > b.surface ? 1 : 0);
  const candidates = grouped.map(({ reading, lemmaIndex }) => ({ lemmaIndex, morphologyId: 0, modernReadings: [reading] }));
  const surfaceIndex = grouped.map(({ surface }, i) => ({ surface, candidateOffset: i, candidateCount: 1 }));
  const artifact: LexicalArtifact = {
    schemaVersion: '1', kind: 'japanese-orthography-lexical-artifact',
    compilerSemantics: 'unidic-cwj-pmin-slice-v1',
    source: { dictionary: 'UniDic-CWJ', version: 'test', lexCsvSha256: 'a'.repeat(64), lexicalNamespaceEvidence: 'test' },
    lexicalNamespaceId: 'b'.repeat(64), artifactContentId: 'c'.repeat(64), sections: [],
    lemmas, morphologies, candidates, surfaceIndex, readingIndex: []
  };
  const entity = buildEntityGraph({
    sources: [{ key: 'test', sourceClass: 'fixture' }],
    evidence: [], contexts: [], patterns: [], bindings: [],
    lexemes: rows.map(([form, reading]) => ({
      key: `${form}/${reading}`, forms: [form], readings: [{ path: [reading] }], categories: [], sourceRefs: []
    })),
    morphemes: [], relations: []
  });
  return { artifact, entity };
}

function relation(id: string, from: string, to: string): NormalizedOrthographyRelation {
  return {
    id, relationKind: 'mapping', channel: 'surface', applicationMode: 'substring_productive',
    fromForms: [from], toForms: [to], basis: 'generated_productive_span', evidenceRefs: []
  };
}

test('弁護 applies as a recognized component of 弁護士', () => {
  const { artifact, entity } = fixtures([
    ['国選','こくせん'], ['弁護','べんご'], ['士','し'], ['弁護士','べんごし']
  ]);
  const spans = buildLexicalSpanGraph('国選弁護士', artifact, entity);
  const result = resolveOccurrenceOrthography('国選弁護士', [relation('bengo','弁護','辯護')], spans);
  assert.equal(result.output, '国選辯護士');
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0]!.evidence, 'component');
});

test('勘弁護衛 does not receive 弁護 merely because the raw substring exists', () => {
  const { artifact, entity } = fixtures([
    ['勘弁','かんべん'], ['弁護','べんご'], ['護衛','ごえい']
  ]);
  const spans = buildLexicalSpanGraph('勘弁護衛', artifact, entity);
  const result = resolveOccurrenceOrthography('勘弁護衛', [relation('bengo','弁護','辯護')], spans);
  assert.equal(result.output, '勘弁護衛');
  assert.equal(result.applied.length, 0);
  assert.ok(result.blocked.some((b) => b.relationId === 'bengo' && b.reason === 'policy_mismatch'));
});

test('shifted AB/BC overlaps are both visible and deterministically arbitrated', () => {
  const { artifact, entity } = fixtures([['AB','ab'], ['BC','bc']]);
  const spans = buildLexicalSpanGraph('ABC', artifact, entity);
  const result = resolveOccurrenceOrthography(
    'ABC',
    [relation('r-ab','AB','X'), relation('r-bc','BC','Y')],
    spans,
    { policies: { 'r-ab': 'anywhere', 'r-bc': 'anywhere' } }
  );
  assert.equal(result.output, 'XC');
  assert.deepEqual(result.applied.map((a) => a.relationId), ['r-ab']);
  assert.ok(result.blocked.some((b) => b.relationId === 'r-bc' && b.reason === 'overlap_lost_arbitration'));
});

test('lexicalIdentity and morphology constraints are enforced at the matched occurrence', () => {
  const { artifact, entity } = fixtures([['思う','おもう']]);
  const spans = buildLexicalSpanGraph('思う', artifact, entity);
  const base = relation('omou','思う','思ふ');
  base.lexicalIdentity = 'unidic:test:lemma:1';
  base.requiredMorphology = { conjugationType: '五段-ワア行' };
  const result = resolveOccurrenceOrthography('思う', [base], spans);
  assert.equal(result.output, '思う');
  assert.ok(result.blocked.some((b) => b.reason === 'morphology_constraint_mismatch'));
});


test('same-start equal-authority arbitration preserves longest-match semantics', () => {
  const { artifact, entity } = fixtures([['AB','ab'], ['ABC','abc'], ['C','c']]);
  const spans = buildLexicalSpanGraph('ABC', artifact, entity);
  const result = resolveOccurrenceOrthography(
    'ABC',
    [relation('r-ab','AB','X'), relation('r-abc','ABC','Z'), relation('r-c','C','Q')],
    spans,
    { policies: { 'r-ab': 'anywhere', 'r-abc': 'anywhere', 'r-c': 'anywhere' } }
  );
  assert.equal(result.output, 'Z');
  assert.deepEqual(result.applied.map((a) => a.relationId), ['r-abc']);
  assert.ok(result.blocked.some((b) => b.relationId === 'r-ab' && b.reason === 'overlap_lost_arbitration'));
});

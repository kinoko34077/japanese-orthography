import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountSourceRecords,
  canonicalizeOrthographyKnowledge,
  summarizeSourceDispositions,
  validateOrthographyKnowledge,
  type OrthographyKnowledgeGraph
} from '../tools/orthography-knowledge-model.ts';

function graph(): OrthographyKnowledgeGraph {
  return {
    schemaVersion: '2',
    kind: 'japanese-orthography-knowledge-graph',
    lexicalNamespaceId: 'test',
    sources: [{ sourceId: 'src:kkh' }, { sourceId: 'src:jmdict' }],
    facts: [
      // ateji / irregular reading: a literal fact with no productive rule behind it
      { id: 'fact:ateji:独逸', kind: 'literal_form', lexicalRefs: ['lexeme:ドイツ/どいつ'], surface: '独逸', sourceRefs: ['src:jmdict'], evidenceRefs: ['jmdict:2026-10-01:seq:1'], tags: ['ateji'] },
      { id: 'fact:reading:今日', kind: 'literal_reading', lexicalRefs: ['lexeme:今日/きょう'], surface: '今日', reading: 'けふ', sourceRefs: ['src:kkh'], evidenceRefs: ['kkh:L1'] }
    ],
    rules: [
      { id: 'rule:yotsugana-di', class: 'orthographic', directionality: 'forward_infer_reverse', lossiness: 'many_to_one', from: ['ぢ', 'じ'], to: ['じ'], dependencies: [], sourceRefs: ['src:kkh'], evidenceRefs: ['naikaku-1946'] },
      { id: 'rule:kau-kou', class: 'diachronic', directionality: 'reverse_traversable', lossiness: 'lossless', from: ['かう'], to: ['こう'], dependencies: ['rule:yotsugana-di'], sourceRefs: ['src:kkh'], evidenceRefs: ['kkh:jion'] }
    ],
    bindings: [
      { id: 'binding:校', ruleId: 'rule:kau-kou', lexicalRefs: ['symbol:校'], sourceRefs: ['src:kkh'], evidenceRefs: ['kkh:jion:校'] }
    ],
    dispositions: [
      { sourceRecordId: 'jmdict:1', disposition: 'literal_fact', targetIds: ['fact:ateji:独逸'] },
      { sourceRecordId: 'kkh:L1', disposition: 'literal_fact', targetIds: ['fact:reading:今日'] },
      { sourceRecordId: 'kkh:jion:校', disposition: 'rule_binding', targetIds: ['binding:校'] },
      { sourceRecordId: 'kkh:rule:kau', disposition: 'rule_definition', targetIds: ['rule:kau-kou'] },
      { sourceRecordId: 'naikaku-1946', disposition: 'rule_definition', targetIds: ['rule:yotsugana-di'] },
      { sourceRecordId: 'kkh:L2', disposition: 'derived_only', targetIds: ['rule:kau-kou'], reason: 'reproduced by rule:kau-kou' },
      { sourceRecordId: 'txt:stage10:1', disposition: 'profile_policy', targetIds: ['profile:kinotch:punctuation'], reason: 'KiNoTch style choice' },
      { sourceRecordId: 'kkh:L3', disposition: 'excluded_with_reason', targetIds: [], reason: 'commented-out upstream line' }
    ]
  };
}

test('a well-formed graph validates and literal facts need no rule', () => {
  assert.deepEqual(validateOrthographyKnowledge(graph()), []);
  const g = graph();
  assert.ok(g.facts.some((f) => f.tags?.includes('ateji')));
  assert.ok(!g.bindings.some((b) => b.lexicalRefs.includes('lexeme:ドイツ/どいつ')));
});

test('storage order is semantically irrelevant (deterministic canonical order)', () => {
  const shuffled = graph();
  shuffled.facts.reverse();
  shuffled.rules.reverse();
  shuffled.dispositions.reverse();
  shuffled.sources.reverse();
  shuffled.facts[0]!.evidenceRefs = ['z', 'a', 'z'];
  const base = graph();
  base.facts.find((f) => f.id === shuffled.facts[0]!.id)!.evidenceRefs = ['a', 'z'];
  assert.equal(JSON.stringify(canonicalizeOrthographyKnowledge(shuffled)), JSON.stringify(canonicalizeOrthographyKnowledge(base)));
});

test('ids are unique across facts, rules and bindings', () => {
  const g = graph();
  g.bindings[0]!.id = 'rule:kau-kou';
  assert.match(validateOrthographyKnowledge(g).join('\n'), /duplicate id rule:kau-kou/);
});

test('dangling rule bindings, dependencies and dependency cycles are rejected', () => {
  const dangling = graph();
  dangling.bindings[0]!.ruleId = 'rule:missing';
  assert.match(validateOrthographyKnowledge(dangling).join('\n'), /binding:校 references missing rule rule:missing/);
  const dep = graph();
  dep.rules[1]!.dependencies = ['rule:nope'];
  assert.match(validateOrthographyKnowledge(dep).join('\n'), /rule:kau-kou depends on missing rule rule:nope/);
  const cycle = graph();
  cycle.rules[0]!.dependencies = ['rule:kau-kou'];
  assert.match(validateOrthographyKnowledge(cycle).join('\n'), /dependency cycle/);
});

test('no admitted fact, rule or binding may lack provenance', () => {
  for (const mutate of [
    (g: OrthographyKnowledgeGraph) => { g.facts[0]!.sourceRefs = []; },
    (g: OrthographyKnowledgeGraph) => { g.rules[0]!.evidenceRefs = []; },
    (g: OrthographyKnowledgeGraph) => { g.bindings[0]!.sourceRefs = ['src:unknown']; }
  ]) {
    const g = graph();
    mutate(g);
    assert.match(validateOrthographyKnowledge(g).join('\n'), /provenance|unknown source/);
  }
});

test('every source record needs one explicit, well-formed disposition', () => {
  const missingReason = graph();
  missingReason.dispositions.find((d) => d.disposition === 'excluded_with_reason')!.reason = '';
  assert.match(validateOrthographyKnowledge(missingReason).join('\n'), /kkh:L3 excluded_with_reason requires a reason/);
  const wrongTarget = graph();
  wrongTarget.dispositions[0]!.targetIds = ['rule:kau-kou'];
  assert.match(validateOrthographyKnowledge(wrongTarget).join('\n'), /jmdict:1 literal_fact target rule:kau-kou is not a fact/);
  const twice = graph();
  twice.dispositions.push({ sourceRecordId: 'kkh:L1', disposition: 'excluded_with_reason', targetIds: [], reason: 'x' });
  assert.match(validateOrthographyKnowledge(twice).join('\n'), /kkh:L1 has more than one disposition/);
  // a record known to the source adapter but absent from the ledger is reported, never silently dropped
  assert.deepEqual(accountSourceRecords(graph(), ['jmdict:1', 'kkh:L1', 'kkh:L9']), { missing: ['kkh:L9'], unexpected: ['kkh:L2', 'kkh:L3', 'kkh:jion:校', 'kkh:rule:kau', 'naikaku-1946', 'txt:stage10:1'] });
  assert.deepEqual(summarizeSourceDispositions(graph()), {
    literal_fact: 2, rule_definition: 2, rule_binding: 1, profile_policy: 1, derived_only: 1, excluded_with_reason: 1
  });
});

test('many_to_one rules are allowed but may not claim to be reverse-traversable functions', () => {
  const g = graph();
  assert.equal(g.rules[0]!.lossiness, 'many_to_one');
  g.rules[0]!.directionality = 'reverse_traversable';
  assert.match(validateOrthographyKnowledge(g).join('\n'), /rule:yotsugana-di is many_to_one and cannot be reverse_traversable/);
  const shape = graph();
  shape.rules[0]!.to = ['じ', 'ぢ'];
  assert.match(validateOrthographyKnowledge(shape).join('\n'), /rule:yotsugana-di many_to_one requires several inputs and one output/);
});

test('fact kinds carry the payload they declare', () => {
  const g = graph();
  delete g.facts[1]!.reading;
  assert.match(validateOrthographyKnowledge(g).join('\n'), /fact:reading:今日 literal_reading requires reading/);
  const wrongSchema = { ...graph(), schemaVersion: '1' } as unknown as OrthographyKnowledgeGraph;
  assert.match(validateOrthographyKnowledge(wrongSchema).join('\n'), /schemaVersion/);
});

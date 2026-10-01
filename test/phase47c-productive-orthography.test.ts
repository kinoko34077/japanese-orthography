import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { NormalizedOrthographyRelation } from '../tools/normalized-relation-model.ts';
import {
  projectSafeCharacterSlice,
  resolveProductiveOrthography
} from '../tools/productive-orthography.ts';

function relation(
  id: string,
  fromForms: string[],
  toForms: string[],
  applicationMode:
    | 'exact_lexeme'
    | 'substring_productive'
    | 'character_productive'
    | 'contextual'
    | 'preserve_block',
  relationKind: 'mapping' | 'candidates' | 'preserve' = 'mapping'
): NormalizedOrthographyRelation {
  return {
    id,
    relationKind,
    channel: 'surface',
    applicationMode,
    fromForms,
    toForms,
    basis: relationKind === 'preserve' ? 'preserve_exact' : 'source_exact',
    evidenceRefs: [`ev:${id}`],
    ...(relationKind === 'preserve' ? { identitySemantics: 'preserve' as const } : {})
  };
}

test('accepted safe-character relations generate historical forms inside unknown words', async () => {
  const slice = JSON.parse(
    await readFile('data/deterministic/safe-character-first-slice.json', 'utf8')
  ) as Record<string, any>;
  const relations = projectSafeCharacterSlice(slice);

  const result = resolveProductiveOrthography('超学校円応竜宝X', relations);

  assert.equal(result.output, '超學校圓應龍寶X');
  assert.deepEqual(
    result.appliedRules.map(entry => [entry.relationId, entry.input, entry.output, entry.basis]),
    [
      ['safe-character:phase46b-character-gaku', '学', '學', 'generated_character'],
      ['safe-character:phase46b-character-en', '円', '圓', 'generated_character'],
      ['safe-character:phase46b-character-ou', '応', '應', 'generated_character'],
      ['safe-character:phase46b-character-ryu', '竜', '龍', 'generated_character'],
      ['safe-character:phase46b-character-takara', '宝', '寶', 'generated_character']
    ]
  );
  assert.ok(result.segments.some(segment =>
    segment.input === '超' && segment.basis === 'unresolved'
  ));
  assert.ok(result.segments.some(segment =>
    segment.input === '校' && segment.basis === 'unresolved'
  ));
});

test('substring_productive applies inside larger unknown strings while exact/contextual relations do not leak', () => {
  const relations = [
    relation('span:bengo', ['弁護'], ['辯護'], 'substring_productive'),
    relation('unsafe:ben', ['弁'], ['辯', '辨', '瓣', '辦'], 'contextual', 'candidates'),
    relation('exact:tai', ['台'], ['臺'], 'exact_lexeme')
  ];

  const result = resolveProductiveOrthography('勘弁護衛台', relations);

  assert.equal(result.output, '勘辯護衛台');
  assert.deepEqual(result.appliedRules.map(entry => entry.relationId), ['span:bengo']);
  assert.ok(result.blockedRules.some(entry =>
    entry.relationId === 'unsafe:ben' && entry.reason === 'non_productive_application_mode'
  ));
  assert.ok(result.blockedRules.some(entry =>
    entry.relationId === 'exact:tai' && entry.reason === 'non_productive_application_mode'
  ));
});

test('longest productive match wins over shorter productive relations deterministically', () => {
  const relations = [
    relation('char:gaku', ['学'], ['學'], 'character_productive'),
    relation('span:gakkou', ['学校'], ['學校'], 'substring_productive')
  ];

  const result = resolveProductiveOrthography('新学校');

  const withRelations = resolveProductiveOrthography('新学校', relations);
  assert.equal(withRelations.output, '新學校');
  assert.deepEqual(withRelations.appliedRules.map(entry => entry.relationId), ['span:gakkou']);
  assert.equal(result.output, '新学校');
});

test('same-length conflicting productive outputs remain unresolved and never use source order', () => {
  const a = relation('conflict:a', ['装丁'], ['装釘'], 'substring_productive');
  const b = relation('conflict:b', ['装丁'], ['装幀'], 'substring_productive');

  const first = resolveProductiveOrthography('新装丁案', [a, b]);
  const second = resolveProductiveOrthography('新装丁案', [b, a]);

  assert.equal(first.output, '新装丁案');
  assert.deepEqual(first, second);
  assert.ok(first.blockedRules.some(entry =>
    entry.relationId === 'conflict:a' && entry.reason === 'conflicting_productive_outputs'
  ));
  assert.ok(first.blockedRules.some(entry =>
    entry.relationId === 'conflict:b' && entry.reason === 'conflicting_productive_outputs'
  ));
});

test('preserve_block wins over overlapping productive mappings', () => {
  const relations = [
    relation('char:gaku', ['学'], ['學'], 'character_productive'),
    relation('preserve:gakkou', ['学校'], ['学校'], 'preserve_block', 'preserve')
  ];

  const result = resolveProductiveOrthography('学校外', relations);

  assert.equal(result.output, '学校外');
  assert.ok(result.appliedRules.some(entry =>
    entry.relationId === 'preserve:gakkou' && entry.basis === 'preserve_exact'
  ));
  assert.ok(result.blockedRules.some(entry =>
    entry.relationId === 'char:gaku' && entry.reason === 'overlaps_preserve_block'
  ));
});

test('non-deterministic productive relation is blocked instead of picking a candidate', () => {
  const ambiguous = relation(
    'ambiguous:koufun',
    ['興奮'],
    ['亢奮', '昂奮'],
    'substring_productive',
    'candidates'
  );

  const result = resolveProductiveOrthography('再興奮中', [ambiguous]);

  assert.equal(result.output, '再興奮中');
  assert.ok(result.blockedRules.some(entry =>
    entry.relationId === 'ambiguous:koufun' &&
    entry.reason === 'non_deterministic_productive_relation'
  ));
});

test('mixed generated and unresolved segments retain per-span basis and source evidence', () => {
  const span = relation('span:bengo', ['弁護'], ['辯護'], 'substring_productive');
  span.sourceRefs = ['source:lexical'];
  span.evidenceRefs = ['evidence:bengo'];

  const result = resolveProductiveOrthography('新弁護AI', [span]);

  assert.equal(result.output, '新辯護AI');
  assert.deepEqual(result.segments, [
    { start: 0, end: 1, input: '新', output: '新', basis: 'unresolved', relationIds: [] },
    {
      start: 1,
      end: 3,
      input: '弁護',
      output: '辯護',
      basis: 'generated_productive_span',
      relationIds: ['span:bengo'],
      sourceRefs: ['source:lexical'],
      evidenceRefs: ['evidence:bengo']
    },
    { start: 3, end: 5, input: 'AI', output: 'AI', basis: 'unresolved', relationIds: [] }
  ]);
});


test('productive execution is channel-scoped and reading rules require explicit opt-in', () => {
  const readingRule = relation('reading:kou', ['こう'], ['かう'], 'substring_productive');
  readingRule.channel = 'reading';

  const surface = resolveProductiveOrthography('こう', [readingRule]);
  assert.equal(surface.output, 'こう');
  assert.ok(surface.blockedRules.some(entry =>
    entry.relationId === 'reading:kou' && entry.reason === 'unsupported_productive_channel'
  ));

  const reading = resolveProductiveOrthography('こう', [readingRule], {
    allowedChannels: ['reading']
  });
  assert.equal(reading.output, 'かう');
  assert.deepEqual(reading.appliedRules.map(entry => entry.relationId), ['reading:kou']);
});

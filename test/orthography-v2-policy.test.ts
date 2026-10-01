import assert from 'node:assert/strict';
import test from 'node:test';
import { kanaConventionGraph } from '../tools/kana-rule-normalization.ts';
import { validateOrthographyKnowledge, type OrthographyKnowledgeGraph } from '../tools/orthography-knowledge-model.ts';
import {
  HISTORICAL_PROFILE,
  KINOTCH_PROFILE,
  KINOTCH_PROFILE_RULES,
  MODERN_PROFILE,
  resolveProjectionPolicy,
  selectForms,
  withProfileRules,
  type OrthographyProfilePolicy
} from '../tools/orthography-policy.ts';
import { projectOrthography, type CanonicalOrthographyState } from '../tools/orthography-projection.ts';
import { compileKinotchOrthographyPolicy } from '../tools/profile-compiler.ts';

const state = (surface: string, reading: string | null): CanonicalOrthographyState => ({
  lexicalIdentity: null, surface, reading, morphology: null, factIds: [], retainedDistinctions: {}
});
const prov = { sourceRefs: ['src:jmdict'], evidenceRefs: ['jmdict:seq:1'] };

function graph(): OrthographyKnowledgeGraph {
  const g = withProfileRules(kanaConventionGraph());
  g.sources.push({ sourceId: 'src:jmdict' });
  g.facts.push(
    { id: 'fact:literal_form:独逸||', kind: 'literal_form', lexicalRefs: ['lexeme:独逸/ドイツ'], surface: '独逸', tags: ['ateji', 'rK'], ...prov },
    { id: 'fact:literal_form:独乙||', kind: 'literal_form', lexicalRefs: ['lexeme:独逸/ドイツ'], surface: '独乙', tags: ['ateji', 'rK'], ...prov },
    { id: 'fact:literal_reading:|ドイツ|', kind: 'literal_reading', lexicalRefs: ['lexeme:独逸/ドイツ'], reading: 'ドイツ', ...prov }
  );
  return g;
}

test('one canonical graph projects differently under modern, historical-heavy and KiNoTch policies', () => {
  const g = graph();
  assert.deepEqual(validateOrthographyKnowledge(g), []);
  const run = (profile: OrthographyProfilePolicy, s: CanonicalOrthographyState) => projectOrthography(s, g, resolveProjectionPolicy(profile, g)).state;
  assert.equal(run(MODERN_PROFILE, state('鼻血', 'はなぢ')).reading, 'はなじ');
  assert.equal(run(HISTORICAL_PROFILE, state('鼻血', 'はなぢ')).reading, 'はなぢ');
  assert.equal(run(HISTORICAL_PROFILE, state('時時', null)).surface, '時々');
  assert.equal(run(MODERN_PROFILE, state('時時', null)).surface, '時時');
  // こと -> ヿ stays behaviourally available, only under the KiNoTch profile, and only for the exact token
  assert.equal(run(KINOTCH_PROFILE, state('こと', null)).surface, 'ヿ');
  assert.equal(run(KINOTCH_PROFILE, state('ことば', null)).surface, 'ことば');
  assert.equal(run(HISTORICAL_PROFILE, state('こと', null)).surface, 'こと');
  assert.deepEqual(compileKinotchOrthographyPolicy(g), resolveProjectionPolicy(KINOTCH_PROFILE, g));
});

test('disabling a modernization merger exposes the retained fine distinction', () => {
  const g = graph();
  const policy = resolveProjectionPolicy({ ...MODERN_PROFILE, profileId: 'modern-without-yotsugana', disableRules: ['rule:kana:yotsugana-di'] }, g);
  assert.equal(projectOrthography(state('鼻血', 'はなぢ'), g, policy).state.reading, 'はなぢ');
  assert.throws(() => resolveProjectionPolicy({ ...MODERN_PROFILE, disableRules: ['rule:missing'] }, g), /unknown rule rule:missing/);
});

test('attested ateji is selectable by policy without becoming kinotch_derived', () => {
  const g = graph();
  assert.deepEqual(selectForms('lexeme:独逸/ドイツ', g, MODERN_PROFILE), []);
  const atejiProfile = { ...MODERN_PROFILE, profileId: 'ateji', thresholds: { ateji: true, rareKanji: true } };
  assert.deepEqual(selectForms('lexeme:独逸/ドイツ', g, atejiProfile).map((f) => f.surface), ['独乙', '独逸']);
  for (const fact of selectForms('lexeme:独逸/ドイツ', g, atejiProfile)) assert.equal(fact.origin ?? 'historically_attested', 'historically_attested');
  // a profile that refuses attested knowledge cannot see it
  assert.deepEqual(selectForms('lexeme:独逸/ドイツ', g, { ...atejiProfile, allowOrigins: ['kinotch_derived'] }), []);
});

test('origins are validated: derived rules must say so and project rules cannot claim attestation', () => {
  const g = graph();
  const derived = { id: 'rule:kinotch:inverse-ji', class: 'orthographic' as const, directionality: 'forward_only' as const, lossiness: 'lossless' as const, from: ['じ'], to: ['ぢ'], dependencies: [], sourceRefs: ['src:jmdict'], evidenceRefs: ['ev'], origin: 'kinotch_derived' as const };
  g.rules.push(derived);
  assert.match(validateOrthographyKnowledge(g).join('\n'), /rule:kinotch:inverse-ji kinotch_derived requires derivedFrom and derivationMechanism/);
  Object.assign(derived, { derivedFrom: ['rule:kana:yotsugana-di'], derivationMechanism: 'inverse' });
  assert.deepEqual(validateOrthographyKnowledge(g), []);
  // never selected unless the profile allows kinotch_derived
  assert.ok(resolveProjectionPolicy(HISTORICAL_PROFILE, g).disabledRuleIds!.includes(derived.id));
  assert.ok(!resolveProjectionPolicy({ ...HISTORICAL_PROFILE, allowOrigins: ['historically_attested', 'kinotch_derived'], enableRules: [derived.id] }, g).disabledRuleIds!.includes(derived.id));
  const lying = { ...derived, id: 'rule:project:claims-attested', origin: 'historically_attested' as const };
  g.rules.push(lying);
  assert.match(validateOrthographyKnowledge(g).join('\n'), /rule:project:claims-attested is derived and cannot claim historically_attested/);
  for (const rule of KINOTCH_PROFILE_RULES) assert.notEqual(rule.origin, 'historically_attested');
});

test('unknown modern-usage threshold data fails closed instead of inventing a tier', () => {
  const g = graph();
  assert.throws(() => resolveProjectionPolicy({ ...MODERN_PROFILE, thresholds: { modernUsageTier: 'common' } }, g), /no modern-usage source/);
  assert.throws(() => resolveProjectionPolicy({ ...MODERN_PROFILE, thresholds: { unknownSwitch: true } }, g), /unknown threshold unknownSwitch/);
});

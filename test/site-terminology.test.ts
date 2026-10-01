import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { plannerPack } from './fixtures/browser-pack-fixture.ts';

const require = createRequire(import.meta.url);
const { createTerminology } = require('../site/terminology.js');
const { planAndTransform } = require('../runtime/browser-span-planner.js');
const { summarize, expandDetail } = require('../runtime/browser-diagnostic-contract.js');
const { REASONS } = { REASONS: ['conflicting_productive_outputs', 'unresolved_shifted_overlap', 'shadowed_by_longer_match', 'outranked_by_overlap', 'equivalent_overlap', 'crosses_lexical_boundary', 'ambiguous_lexical_boundary', 'context_required', 'lexical_identity_mismatch', 'lexical_analysis_unavailable', 'overlapping_regions'] };
const dictionary = JSON.parse(await readFile('site/terminology-ja.json', 'utf8'));
const terms = createTerminology(dictionary);

// every field / value the UI shows (from the E summary + detail contracts)
const UI_FIELDS = ['certainty', 'status', 'lexicalIdentity', 'lexicalCandidates', 'readings', 'morphologyContext', 'basis', 'authority', 'ruleChain', 'candidates', 'acceptedCandidates', 'rejectedCandidates', 'reasonCode', 'retainedDistinctions', 'provenance', 'compatibilityAgreement', 'profileEffects', 'range'];
const UI_VALUES = {
  certainty: ['unique', 'conditional', 'unresolved'],
  status: ['applied', 'unresolved', 'context_required'],
  basis: ['reverse_traversal', 'rule_application', 'preserve_constraint'],
  authority: ['literal_fact', 'source_rule', 'project_rule', 'derived_rule', 'none'],
  reason: REASONS,
  profile: ['modern', 'historical', 'kinotch-fixed'],
  readings: ['modern', 'historical'],
  provenance: ['sourceRefs', 'evidenceRefs']
};

test('every diagnostic field and value has a Japanese label, its English term and a short explanation', () => {
  const missing: string[] = [];
  const check = (key: string) => {
    const t = terms.term(key);
    if (t.unsupported || !t.ja || !t.en || !t.short || /^[\x00-\x7f]+$/.test(t.ja)) missing.push(key);
  };
  UI_FIELDS.forEach(check);
  for (const [group, values] of Object.entries(UI_VALUES)) for (const value of values) check(`${group}.${value}`);
  assert.deepEqual(missing, []);
});

test('labels show the Japanese label first and keep the English/internal term visible', () => {
  const html = terms.labelHtml('authority');
  assert.ok(html.indexOf('<span class="term-ja">根拠の種類') < html.indexOf('<span class="term-en"'));
  assert.match(html, /<span class="term-en" lang="en">authority<\/span>/);
});

test('the help control works for hover, keyboard focus and tap (accessible button + tooltip)', () => {
  const html = terms.labelHtml('basis', { idPrefix: 't' });
  assert.match(html, /<button type="button" class="term-help" aria-label="復元方法の説明" aria-describedby="t-\d+" aria-expanded="false">ⓘ<\/button>/);
  assert.match(html, /role="tooltip" id="t-\d+" hidden/);
  const source = require('node:fs').readFileSync('site/terminology.js', 'utf8');
  for (const event of ['mouseenter', 'focus', 'click', 'keydown']) assert.ok(source.includes(`"${event}"`), event);
});

test('unknown internal keys are flagged visibly, never shown as if they were labels', () => {
  const t = terms.term('someNewInternalField');
  assert.equal(t.unsupported, true);
  assert.equal(t.ja, '未対応の項目');
  assert.equal(t.en, 'someNewInternalField');
  assert.match(terms.labelHtml('someNewInternalField'), /term-unsupported/);
  assert.throws(() => createTerminology({ schemaVersion: '2' }), /Unsupported terminology/);
});

test('every reason code and field the runtime actually emits is covered', async () => {
  const { pack } = await plannerPack();
  const emitted = new Set<string>();
  for (const [text, profile] of [['装丁と台風と溶接と円', 'historical'], ['熔接', 'modern'], ['勘弁護衛', 'historical'], ['こと', 'kinotch-fixed']] as const) {
    const raw = await planAndTransform(pack, text, profile);
    const summary = summarize(raw);
    for (const span of summary.spans) {
      span.reasonCodes.forEach((r: string) => emitted.add(`reason.${r}`));
      emitted.add(`certainty.${span.certainty}`);
      emitted.add(`status.${span.status}`);
      emitted.add(`authority.${span.authority}`);
      const detail = await expandDetail(pack, raw, span.detailRef);
      if (detail.basis) emitted.add(`basis.${detail.basis}`);
      for (const c of [...detail.acceptedCandidates, ...detail.rejectedCandidates]) if (c.reason) emitted.add(`reason.${c.reason}`);
    }
    raw.quietlyBlocked.forEach((b: any) => emitted.add(`reason.${b.reason}`));
    emitted.add(`profile.${profile}`);
  }
  assert.deepEqual([...emitted].filter((k) => terms.term(k).unsupported), []);
});

test('the BrowserPack carries the same terminology dictionary', async () => {
  const manifest = JSON.parse(await readFile('data/browser-pack/manifest.json', 'utf8'));
  const section = manifest.sections.find((s: any) => s.kind === 'terminology');
  const { createHash } = await import('node:crypto');
  const sortKeys = (v: any): any => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
  const body = `${JSON.stringify(sortKeys(dictionary))}\n`;
  assert.equal(createHash('sha256').update(body).digest('hex'), section.sha256);
});

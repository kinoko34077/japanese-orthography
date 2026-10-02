import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  BROWSER_CAPABILITY_REPORT, CAPABILITY_PROBES, factRoute, measureCapabilityUtilization, type CapabilityReport
} from '../tools/measure-browser-capability-utilization.ts';
import { plannerFixture, plannerPack } from './fixtures/browser-pack-fixture.ts';

const graph = plannerFixture();
const { build } = await plannerPack(graph);
const report = await measureCapabilityUtilization(graph, build, [
  { id: 'surface:溶接', text: '溶接', covers: ['surface'] },
  { id: 'surface:台風', text: '台風', covers: ['contextual'] },
  { id: 'reading:ようせつ', text: 'ようせつ', covers: ['reading'] }
], ['historical']);

test('static routes classify every canonical fact exactly once', () => {
  const kinds = report.canonical.factsByKindAndV1Route;
  let total = 0;
  for (const row of Object.values(kinds)) {
    const { total: t, ...routes } = row as Record<string, number>;
    assert.equal(Object.values(routes).reduce((a, b) => a + b, 0), t);
    total += t!;
  }
  assert.equal(total, graph.facts.length);
  const taifu = graph.facts.find((f) => f.surface === '颱風')!;
  assert.equal(factRoute(taifu), 'context_required_only');
  const weld = graph.facts.find((f) => f.surface === '熔接')!;
  assert.equal(factRoute(weld), 'transform_candidate');
});

test('probe rows trace lookup -> promotion -> arbitration -> outcome', () => {
  const row = (id: string) => report.probes.rows.find((r) => r.probeId === id)!;
  const weld = row('surface:溶接');
  assert.equal(weld.renderedText, '熔接');
  assert.ok(weld.promotedFacts >= 1 && weld.accepted >= 1);
  assert.ok(weld.promotedFacts <= weld.reachedFacts);
  assert.equal(weld.enteredArbitration, weld.candidates);
  const taifu = row('surface:台風');
  assert.equal(taifu.changed, false);
  assert.equal(taifu.contextualFacts, 1);
  // v1 baseline gap: a reading does not reach the lexeme that carries 溶接/熔接
  const reading = row('reading:ようせつ');
  assert.equal(reading.reachedFacts, 0);
  assert.equal(reading.changed, false);
  assert.equal(report.canonical.readings.readingIndexInV1, false);
});

test('section requests are measured per cold probe', () => {
  for (const r of report.probes.rows) {
    assert.ok(r.sectionRequests.eager > 0);
    assert.equal(r.sectionRequests.total, r.sectionRequests.eager + r.sectionRequests.onDemand);
    assert.equal(r.transferredBytes.eager, report.probes.eagerBytes);
  }
});

test('the committed v1 report covers every required probe and profile with consistent counts', async () => {
  const committed = JSON.parse(await readFile(new URL(`../${BROWSER_CAPABILITY_REPORT}`, import.meta.url), 'utf8')) as CapabilityReport;
  assert.equal(committed.owner, 'japanese-orthography#196 A');
  const committedManifest = JSON.parse(await readFile(new URL('../data/browser-pack/manifest.json', import.meta.url), 'utf8'));
  assert.equal(committed.packDigest, committedManifest.packDigest, 'report must describe the committed pack');
  for (const probe of CAPABILITY_PROBES) {
    for (const profile of committed.probes.profiles) {
      assert.ok(committed.probes.rows.some((r) => r.probeId === probe.id && r.profileId === profile), `${probe.id}/${profile}`);
    }
  }
  for (const required of ['学校', 'がっこう', '今日', 'ドイツ', 'みる', '分かる', '台風', '装丁']) {
    assert.ok(CAPABILITY_PROBES.some((p) => p.text === required), required);
  }
  assert.ok(CAPABILITY_PROBES.some((p) => p.covers.includes('ruby')));
  assert.ok(CAPABILITY_PROBES.some((p) => p.covers.includes('unknown') && p.covers.includes('emoji')));
  for (const r of committed.probes.rows) {
    assert.ok(r.promotedFacts <= r.reachedFacts);
    assert.ok(r.accepted + r.blocked <= r.enteredArbitration);
  }
  const lex = committed.canonical.lexicalIdentities;
  assert.equal(lex.storedButNotExecutable, lex.storedInPack - lex.withExecutableFact);
});

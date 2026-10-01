import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { kanaConventionGraph } from '../tools/kana-rule-normalization.ts';
import { canonicalizeOrthographyKnowledge, type OrthographyKnowledgeGraph } from '../tools/orthography-knowledge-model.ts';
import {
  buildOrthographyHotArtifact,
  inflateHotArtifact,
  inflateOrVerifyHotArtifact,
  provenanceOf
} from '../tools/orthography-hot-artifact.ts';
import { HISTORICAL_PROFILE, KINOTCH_PROFILE, MODERN_PROFILE, resolveProjectionPolicy, withProfileRules } from '../tools/orthography-policy.ts';
import { projectOrthography } from '../tools/orthography-projection.ts';
import { normalizeAcceptedOrthographySources } from '../tools/orthography-source-normalization.ts';
import { ORTHOGRAPHY_V2_MEASUREMENTS } from '../tools/measure-orthography-v2.ts';

const prov = { sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] };
function fixture(): OrthographyKnowledgeGraph {
  const g = withProfileRules(kanaConventionGraph());
  g.sources.push({ sourceId: 'src:fixture' });
  g.facts.push(
    { id: 'fact:literal_reading:鼻血|はなぢ|', kind: 'literal_reading', lexicalRefs: ['lexeme:鼻血/はなぢ'], surface: '鼻血', reading: 'はなぢ', periodRefs: ['period:historical-kana'], ...prov },
    { id: 'fact:literal_form:独逸||', kind: 'literal_form', lexicalRefs: ['lexeme:独逸/ドイツ'], surface: '独逸', tags: ['ateji'], ...prov },
    { id: 'fact:literal_reading:井戸|ゐど|', kind: 'literal_reading', lexicalRefs: [], surface: '井戸', reading: 'ゐど', periodRefs: ['period:historical-kana'], sourceRefs: ['src:fixture'], evidenceRefs: ['ev:other'] }
  );
  return canonicalizeOrthographyKnowledge(g);
}

test('identical canonical input and profile give a byte-identical artifact', () => {
  const a = JSON.stringify(buildOrthographyHotArtifact(fixture(), MODERN_PROFILE));
  const b = JSON.stringify(buildOrthographyHotArtifact(canonicalizeOrthographyKnowledge(structuredClone(fixture())), MODERN_PROFILE));
  assert.equal(a, b);
});

test('source or profile changes change the content identity (source lock)', () => {
  const base = buildOrthographyHotArtifact(fixture(), MODERN_PROFILE);
  const changed = fixture();
  changed.sources.push({ sourceId: 'src:extra' });
  const other = buildOrthographyHotArtifact(changed, MODERN_PROFILE);
  assert.notEqual(other.sourceSetDigest, base.sourceSetDigest);
  assert.notEqual(other.canonicalGraphSha256, base.canonicalGraphSha256);
  const kinotch = buildOrthographyHotArtifact(fixture(), KINOTCH_PROFILE);
  assert.notEqual(kinotch.profileDigest, base.profileDigest);
  assert.equal(kinotch.canonicalGraphSha256, base.canonicalGraphSha256);
});

test('pre-expanded projections equal on-demand projection results', () => {
  const graph = fixture();
  for (const profile of [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE]) {
    const artifact = buildOrthographyHotArtifact(graph, profile);
    const inflated = inflateHotArtifact(artifact);
    const policy = resolveProjectionPolicy(profile, graph);
    for (const fact of graph.facts.filter((f) => f.periodRefs?.includes('period:historical-kana') && f.reading)) {
      const onDemand = projectOrthography({ lexicalIdentity: null, surface: fact.surface!, reading: fact.reading!, morphology: null, factIds: [], retainedDistinctions: {} }, graph, policy).state;
      assert.deepEqual(inflated.projectedReadings[fact.id], { surface: onDemand.surface, reading: onDemand.reading }, `${profile.profileId} ${fact.id}`);
    }
  }
  assert.deepEqual(inflateHotArtifact(buildOrthographyHotArtifact(graph, MODERN_PROFILE)).projectedReadings['fact:literal_reading:井戸|ゐど|'], { surface: '井戸', reading: 'いど' });
  // the hot rule order is the policy's compiled order, and inflated facts are the canonical facts
  const inflated = inflateHotArtifact(buildOrthographyHotArtifact(graph, KINOTCH_PROFILE));
  assert.deepEqual(inflated.graph.facts, graph.facts);
  assert.ok(inflated.ruleOrder.includes('rule:profile:kinotch:koto-ligature'));
  assert.ok(!inflateHotArtifact(buildOrthographyHotArtifact(graph, MODERN_PROFILE)).ruleOrder.includes('rule:profile:kinotch:koto-ligature'));
});

test('hot items map back to canonical source and evidence ids', () => {
  const artifact = buildOrthographyHotArtifact(fixture(), MODERN_PROFILE);
  const inflated = inflateHotArtifact(artifact);
  const index = inflated.graph.facts.findIndex((f) => f.id === 'fact:literal_reading:井戸|ゐど|');
  assert.deepEqual(provenanceOf(artifact, 'fact', index), { sourceRefs: ['src:fixture'], evidenceRefs: ['ev:other'] });
  const ruleIndex = inflated.graph.rules.findIndex((r) => r.id === 'rule:kana:yotsugana-di');
  assert.deepEqual(provenanceOf(artifact, 'rule', ruleIndex).evidenceRefs, ['naikaku-kokuji-1986-gendai-kanazukai']);
});

test('corruption and schema drift fail closed (TS and VM-loaded runtime)', async () => {
  const artifact = buildOrthographyHotArtifact(fixture(), MODERN_PROFILE);
  assert.doesNotThrow(() => inflateOrVerifyHotArtifact(artifact));
  const range = structuredClone(artifact) as any;
  range.facts.surface[0] = range.strings.length + 3;
  assert.throws(() => inflateOrVerifyHotArtifact(range), /out of range/);
  const drift = structuredClone(artifact) as any;
  drift.schema['facts.surface'] = 'rule';
  assert.throws(() => inflateOrVerifyHotArtifact(drift), /schema mismatch/);
  const rows = structuredClone(artifact) as any;
  rows.facts.kind.push(0);
  assert.throws(() => inflateOrVerifyHotArtifact(rows), /row count/);
  const lock = structuredClone(artifact) as any;
  lock.strings[lock.strings.indexOf('はなぢ')] = 'はなじ';
  assert.throws(() => inflateOrVerifyHotArtifact(lock), /canonical graph digest mismatch/);
  const sandbox: Record<string, any> = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(await readFile('runtime/orthography-hot-runtime.js', 'utf8'), sandbox);
  assert.throws(() => sandbox.OrthographyHotRuntime.verifyHotArtifact(JSON.parse(JSON.stringify(range))), /out of range/);
  assert.equal(JSON.stringify(sandbox.OrthographyHotRuntime.inflateHotArtifact(JSON.parse(JSON.stringify(artifact))).graph), JSON.stringify(inflateHotArtifact(artifact).graph));
});

test('measurement report records the real v2 artifacts deterministically', async () => {
  const report = JSON.parse(await readFile(ORTHOGRAPHY_V2_MEASUREMENTS, 'utf8'));
  const { graph } = await normalizeAcceptedOrthographySources(process.cwd());
  const full = withProfileRules(graph);
  const modern = buildOrthographyHotArtifact(full, MODERN_PROFILE);
  assert.equal(modern.canonicalGraphSha256, report.canonicalGraph.sha256);
  assert.equal(JSON.stringify(inflateHotArtifact(modern).graph.facts.length), JSON.stringify(report.counts.facts));
  assert.ok(report.hotArtifacts.modern.bytes < report.canonicalGraph.bytes);
  assert.equal(report.baseline.phase48.hotRuntimeBytes, 21810629);
});

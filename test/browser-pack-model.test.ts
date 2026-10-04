import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  BROWSER_PACK_COMPILER_VERSION,
  BROWSER_PACK_REQUIRED_SECTION_KINDS,
  BROWSER_PACK_SECTION_KINDS,
  browserPackIdentity,
  browserPackSectionId,
  chooseElementWidth,
  sealBrowserPackManifest,
  sectionByteLength,
  serializeBrowserPackManifest,
  validateBrowserPackManifest,
  verifyBrowserPackSections,
  type BrowserPackManifestV1,
  type BrowserPackSectionDescriptor,
  type BrowserPackSectionKind
} from '../tools/browser-pack-model.ts';
import { BROWSER_PACK_MEASUREMENTS } from '../tools/measure-browser-pack.ts';
import { ORTHOGRAPHY_V2_MEASUREMENTS } from '../tools/measure-orthography-v2.ts';

const body = (text: string) => new TextEncoder().encode(text);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** One descriptor built from its real bytes, so digest and byteLength are never hand-written. */
function section(kind: BrowserPackSectionKind, text: string, extra: Partial<BrowserPackSectionDescriptor> = {}): BrowserPackSectionDescriptor {
  const bytes = body(text);
  const spec = BROWSER_PACK_SECTION_KINDS[kind];
  const sectionId = browserPackSectionId(kind, { shard: extra.shard, profileId: extra.profileId });
  return {
    sectionId,
    kind,
    path: `${sectionId.replace(/[@/]/gu, '-')}.${spec.encoding === 'json' ? 'json' : 'bin'}`,
    encoding: spec.encoding,
    loading: spec.loading,
    byteLength: bytes.byteLength,
    sha256: sha(bytes),
    ...extra
  };
}

const bodies = new Map<string, Uint8Array>();

function fixtureSections(): BrowserPackSectionDescriptor[] {
  bodies.clear();
  const built: [BrowserPackSectionDescriptor, string][] = [
    [section('shard-directory', 'dir', { rowCount: 3 }), 'dir'],
    [section('string-pool', 'pool'), 'pool'],
    [section('facts', 'facts', { rowCount: 3 }), 'facts'],
    [section('rules', 'rules', { rowCount: 2 }), 'rules'],
    [section('bindings', 'bindings', { rowCount: 1, requires: ['rules'] }), 'bindings'],
    [section('provenance-index', 'prov', { rowCount: 2 }), 'prov'],
    [section('sino-component-index', 'sino', { rowCount: 0 }), 'sino'],
    [section('lexical-index', 'lexA', { rowCount: 2, shard: { key: 'surface', index: 0, count: 2, from: 'あ', to: 'な' } }), 'lexA'],
    [section('lexical-index', 'lexB', { rowCount: 2, shard: { key: 'surface', index: 1, count: 2, from: 'に', to: '鼻' } }), 'lexB'],
    [section('detail-shard', 'detail', { rowCount: 4, shard: { key: 'detail', index: 0, count: 1, from: '0', to: '9' } }), 'detail'],
    [section('terminology', '{"ja":{}}'), '{"ja":{}}'],
    [section('profile-policy', '{"modern":1}', { profileId: 'modern' }), '{"modern":1}'],
    [section('profile-policy', '{"historical":1}', { profileId: 'historical' }), '{"historical":1}'],
    [section('profile-policy', '{"kinotch":1}', { profileId: 'kinotch' }), '{"kinotch":1}']
  ];
  for (const [descriptor, text] of built) bodies.set(descriptor.sectionId, body(text));
  return built.map(([descriptor]) => descriptor);
}

function fixture(): BrowserPackManifestV1 {
  return sealBrowserPackManifest({
    schemaVersion: '1',
    kind: 'japanese-orthography-browser-pack',
    compilerVersion: BROWSER_PACK_COMPILER_VERSION,
    canonicalGraphSha256: 'a'.repeat(64),
    sourceSetDigest: 'b'.repeat(64),
    lexicalNamespaceId: 'unidic-cwj-202512',
    profiles: [
      { profileId: 'modern', profileDigest: 'c'.repeat(64), policySectionId: 'profile-policy@modern' },
      { profileId: 'historical', profileDigest: 'd'.repeat(64), policySectionId: 'profile-policy@historical' },
      { profileId: 'kinotch', profileDigest: 'e'.repeat(64), policySectionId: 'profile-policy@kinotch' }
    ],
    sections: fixtureSections(),
    runtimeContract: { schemaVersion: '1', externalOffsetUnit: 'utf16-code-unit' }
  });
}

const clone = (manifest: BrowserPackManifestV1) => structuredClone(manifest) as Record<string, any>;
/** Re-seal after a semantic edit so the test exercises the edited rule, not the pack digest. */
const reseal = (manifest: Record<string, any>) => sealBrowserPackManifest(manifest as never);
const find = (manifest: Record<string, any>, kind: string) => manifest.sections.find((s: BrowserPackSectionDescriptor) => s.kind === kind);

test('a canonical manifest serializes deterministically and ignores input key/section order', () => {
  const base = fixture();
  const shuffled = clone(base);
  shuffled.sections.reverse();
  shuffled.profiles.reverse();
  const reordered = Object.fromEntries(Object.keys(shuffled).reverse().map((key) => [key, shuffled[key]])) as BrowserPackManifestV1;
  assert.equal(serializeBrowserPackManifest(reordered), serializeBrowserPackManifest(base));
  assert.equal(browserPackIdentity(reordered), base.packDigest);
  assert.equal(serializeBrowserPackManifest(validateBrowserPackManifest(base)), serializeBrowserPackManifest(base));
});

test('section identity is derived from kind, shard and profile, and a hand-edited id is rejected', () => {
  assert.equal(browserPackSectionId('facts', {}), 'facts');
  assert.equal(browserPackSectionId('lexical-index', { shard: { key: 'surface', index: 1, count: 2, from: 'に', to: '鼻' } }), 'lexical-index@surface/1');
  assert.equal(browserPackSectionId('profile-policy', { profileId: 'kinotch' }), 'profile-policy@kinotch');
  const renamed = clone(fixture());
  find(renamed, 'facts').sectionId = 'facts-renamed';
  assert.throws(() => validateBrowserPackManifest(reseal(renamed)), /section id/);
  const duplicated = clone(fixture());
  duplicated.sections.push({ ...find(duplicated, 'facts') });
  assert.throws(() => validateBrowserPackManifest(reseal(duplicated)), /duplicate section/);
  // two sections may not share one file: a cache entry would be ambiguous and one digest wrong
  const sharedPath = clone(fixture());
  find(sharedPath, 'rules').path = find(sharedPath, 'facts').path;
  assert.throws(() => validateBrowserPackManifest(reseal(sharedPath)), /duplicate section path/);
});

test('pack identity covers section digests, canonical identity and profile digests', () => {
  const base = fixture();
  const sectionChanged = clone(base);
  find(sectionChanged, 'facts').sha256 = sha(body('other facts'));
  assert.notEqual(browserPackIdentity(sectionChanged as never), base.packDigest);
  const graphChanged = clone(base);
  graphChanged.canonicalGraphSha256 = 'f'.repeat(64);
  assert.notEqual(browserPackIdentity(graphChanged as never), base.packDigest);
  const profileChanged = clone(base);
  profileChanged.profiles[0].profileDigest = '0'.repeat(64);
  assert.notEqual(browserPackIdentity(profileChanged as never), base.packDigest);
  const tampered = clone(base);
  find(tampered, 'facts').sha256 = sha(body('other facts'));
  assert.throws(() => validateBrowserPackManifest(tampered), /pack digest mismatch/);
});

test('unknown schema, manifest kind, compiler version, section kind, encoding and offset unit fail closed', () => {
  for (const [field, value, message] of [
    ['schemaVersion', '2', /schemaVersion/],
    ['kind', 'something-else', /manifest kind/],
    ['compilerVersion', '99', /compiler version/]
  ] as const) {
    const bad = clone(fixture());
    bad[field] = value;
    assert.throws(() => validateBrowserPackManifest(reseal(bad)), message, field);
  }
  const unknownKind = clone(fixture());
  find(unknownKind, 'facts').kind = 'mystery-table';
  assert.throws(() => validateBrowserPackManifest(reseal(unknownKind)), /unknown section kind/);
  const unknownEncoding = clone(fixture());
  find(unknownEncoding, 'facts').encoding = 'protobuf';
  assert.throws(() => validateBrowserPackManifest(reseal(unknownEncoding)), /encoding/);
  const otherOffsets = clone(fixture());
  otherOffsets.runtimeContract.externalOffsetUnit = 'codepoint';
  assert.throws(() => validateBrowserPackManifest(reseal(otherOffsets)), /offset unit/);
});

test('the loading class of a section is fixed by its kind, and knowledge is never merely lazy', () => {
  // the three availability classes stay distinct: a missing knowledge shard must be fail-closed,
  // a missing detail shard is an ordinary deferral
  assert.equal(BROWSER_PACK_SECTION_KINDS['detail-shard'].loading, 'lazy');
  assert.equal(BROWSER_PACK_SECTION_KINDS.facts.loading, 'on-demand');
  assert.equal(BROWSER_PACK_SECTION_KINDS['shard-directory'].loading, 'eager');
  assert.equal(BROWSER_PACK_SECTION_KINDS.rules.loading, 'eager');
  for (const kind of BROWSER_PACK_REQUIRED_SECTION_KINDS) {
    if (BROWSER_PACK_SECTION_KINDS[kind].contentClass === 'knowledge') assert.notEqual(BROWSER_PACK_SECTION_KINDS[kind].loading, 'lazy', kind);
  }
  const eagerDetail = clone(fixture());
  find(eagerDetail, 'detail-shard').loading = 'eager';
  assert.throws(() => validateBrowserPackManifest(reseal(eagerDetail)), /loading class/);
  const lazyFacts = clone(fixture());
  find(lazyFacts, 'facts').loading = 'lazy';
  assert.throws(() => validateBrowserPackManifest(reseal(lazyFacts)), /loading class/);
  const eagerFacts = clone(fixture());
  find(eagerFacts, 'facts').loading = 'eager';
  assert.throws(() => validateBrowserPackManifest(reseal(eagerFacts)), /loading class/);
});

test('shard metadata must be complete, ordered and only on shardable kinds', () => {
  const onRules = clone(fixture());
  const rules = find(onRules, 'rules');
  rules.shard = { key: 'rule', index: 0, count: 1, from: 'a', to: 'z' };
  rules.sectionId = 'rules@rule/0';
  assert.throws(() => validateBrowserPackManifest(reseal(onRules)), /not shardable/);
  const incomplete = clone(fixture());
  incomplete.sections = incomplete.sections.filter((s: BrowserPackSectionDescriptor) => s.sectionId !== 'lexical-index@surface/1');
  assert.throws(() => validateBrowserPackManifest(reseal(incomplete)), /shard set/);
  const overlapping = clone(fixture());
  overlapping.sections.find((s: BrowserPackSectionDescriptor) => s.sectionId === 'lexical-index@surface/1').shard.from = 'あ';
  assert.throws(() => validateBrowserPackManifest(reseal(overlapping)), /shard range/);
  const inverted = clone(fixture());
  inverted.sections.find((s: BrowserPackSectionDescriptor) => s.sectionId === 'lexical-index@surface/0').shard.from = 'ん';
  assert.throws(() => validateBrowserPackManifest(reseal(inverted)), /shard range/);
});

test('profiles share one knowledge graph and own only their policy section', () => {
  const base = fixture();
  const knowledge = base.sections.filter((s) => BROWSER_PACK_SECTION_KINDS[s.kind].contentClass === 'knowledge');
  assert.ok(knowledge.length > 0);
  for (const s of knowledge) assert.equal(s.profileId, undefined);
  const profileScoped = clone(base);
  const facts = find(profileScoped, 'facts');
  facts.profileId = 'modern';
  facts.sectionId = 'facts@modern';
  assert.throws(() => validateBrowserPackManifest(reseal(profileScoped)), /profile-scoped/);
  const wrongRef = clone(base);
  wrongRef.profiles[0].policySectionId = 'facts';
  assert.throws(() => validateBrowserPackManifest(reseal(wrongRef)), /policy section/);
  const danglingRef = clone(base);
  danglingRef.profiles[0].policySectionId = 'profile-policy@absent';
  assert.throws(() => validateBrowserPackManifest(reseal(danglingRef)), /policy section/);
  const orphanPolicy = clone(base);
  orphanPolicy.profiles = orphanPolicy.profiles.slice(0, 2);
  assert.throws(() => validateBrowserPackManifest(reseal(orphanPolicy)), /unreferenced/);
});

test('availability only strengthens along a dependency, knowledge never depends on a profile, and no cycles', () => {
  // an on-demand knowledge shard may lean on the eager core ...
  const onEager = clone(fixture());
  find(onEager, 'facts').requires = ['shard-directory', 'string-pool'];
  assert.doesNotThrow(() => validateBrowserPackManifest(reseal(onEager)));
  // ... but never the other way round, or the eager shell could not open
  const eagerOnDemand = clone(fixture());
  find(eagerOnDemand, 'shard-directory').requires = ['facts'];
  assert.throws(() => validateBrowserPackManifest(reseal(eagerOnDemand)), /may not require/);
  const onDetail = clone(fixture());
  find(onDetail, 'facts').requires = ['detail-shard@detail/0'];
  assert.throws(() => validateBrowserPackManifest(reseal(onDetail)), /may not require/);
  // profile neutrality holds regardless of load order: profile-policy is eager, yet still forbidden
  const onPolicy = clone(fixture());
  find(onPolicy, 'facts').requires = ['profile-policy@modern'];
  assert.throws(() => validateBrowserPackManifest(reseal(onPolicy)), /may not require profile section/);
  const dangling = clone(fixture());
  find(dangling, 'facts').requires = ['facts-missing'];
  assert.throws(() => validateBrowserPackManifest(reseal(dangling)), /unknown section/);
  const cycle = clone(fixture());
  find(cycle, 'facts').requires = ['provenance-index'];
  find(cycle, 'provenance-index').requires = ['facts'];
  assert.throws(() => validateBrowserPackManifest(reseal(cycle)), /cycle/);
});

test('every required section kind must be present', () => {
  assert.doesNotThrow(() => validateBrowserPackManifest(fixture()));
  for (const kind of BROWSER_PACK_REQUIRED_SECTION_KINDS) {
    const missing = clone(fixture());
    missing.sections = missing.sections.filter((s: BrowserPackSectionDescriptor) => s.kind !== kind);
    if (kind === 'profile-policy') missing.profiles = [];
    assert.throws(() => validateBrowserPackManifest(reseal(missing)), /missing required section|at least one profile/, kind);
  }
});

test('section bodies are digest-locked; demand-loaded sections may be absent and eager ones may not', () => {
  const manifest = fixture();
  assert.doesNotThrow(() => verifyBrowserPackSections(manifest, bodies));
  for (const absent of ['detail-shard@detail/0', 'facts', 'lexical-index@surface/0']) {
    const without = new Map(bodies);
    without.delete(absent);
    assert.doesNotThrow(() => verifyBrowserPackSections(manifest, without), absent);
  }
  for (const absent of ['shard-directory', 'rules', 'bindings', 'terminology', 'profile-policy@modern']) {
    const without = new Map(bodies);
    without.delete(absent);
    assert.throws(() => verifyBrowserPackSections(manifest, without), /missing eager section/, absent);
  }
  const corrupt = new Map(bodies);
  corrupt.set('facts', body('fakts'));
  assert.throws(() => verifyBrowserPackSections(manifest, corrupt), /digest mismatch/);
  const truncated = new Map(bodies);
  truncated.set('facts', body('fact'));
  assert.throws(() => verifyBrowserPackSections(manifest, truncated), /byte length/);
  const surprise = new Map(bodies);
  surprise.set('surprise', body('x'));
  assert.throws(() => verifyBrowserPackSections(manifest, surprise), /unknown section/);
});

test('the element width model follows cardinality and sizes rows and lists explicitly', () => {
  assert.equal(chooseElementWidth(0), 1);
  assert.equal(chooseElementWidth(255), 1);
  assert.equal(chooseElementWidth(256), 2);
  assert.equal(chooseElementWidth(65_535), 2);
  assert.equal(chooseElementWidth(65_536), 4);
  assert.throws(() => chooseElementWidth(2 ** 32), /cardinality/);
  assert.throws(() => chooseElementWidth(-1), /cardinality/);
  // a scalar column costs rows * width; a list column adds its own u32 offset array
  assert.equal(sectionByteLength(10, [{ name: 'kind', width: 1 }]), 10);
  assert.equal(sectionByteLength(10, [{ name: 'surface', width: 4 }, { name: 'kind', width: 2 }]), 60);
  assert.equal(sectionByteLength(10, [{ name: 'lexicalRefs', width: 4, elements: 25 }]), (10 + 1) * 4 + 25 * 4);
  assert.throws(() => sectionByteLength(10, [{ name: 'bad', width: 3 as never }]), /width/);
});

test('the baseline report measures the accepted full-v2 artifact against a reproducible candidate', async () => {
  const report = JSON.parse(await readFile(BROWSER_PACK_MEASUREMENTS, 'utf8'));
  const v2 = JSON.parse(await readFile(ORTHOGRAPHY_V2_MEASUREMENTS, 'utf8'));
  assert.equal(report.kind, 'browser-pack-v1-measurements');
  // the baseline is the accepted v2 artifact this pack derives from, not a restated constant
  assert.equal(report.baseline.canonicalGraphSha256, v2.canonicalGraph.sha256);
  assert.equal(report.baseline.hotArtifactBytes, v2.hotArtifacts.modern.bytes);
  assert.equal(report.baseline.hotArtifactGzipBytes, v2.hotArtifacts.modern.gzipBytes);
  assert.equal(report.baseline.hotInflateHeapMb, v2.performanceObserved.hotHeapDeltaMb);
  assert.equal(report.baseline.hotInflateMs, v2.performanceObserved.hotStartupMs);
  for (const key of ['facts', 'rules', 'bindings', 'sources'] as const) assert.equal(report.counts[key], v2.counts[key], key);
  assert.ok(report.counts.strings > 0);
  // every candidate section's recorded size is reproducible from its recorded shape
  assert.ok(report.candidate.sections.length > 0);
  for (const s of report.candidate.sections) {
    assert.ok(s.kind in BROWSER_PACK_SECTION_KINDS, s.kind);
    if (s.columns) assert.equal(s.bytes, sectionByteLength(s.rowCount, s.columns), s.sectionId);
  }
  const sum = (loading: string) => report.candidate.sections
    .filter((s: { kind: BrowserPackSectionKind }) => BROWSER_PACK_SECTION_KINDS[s.kind].loading === loading)
    .reduce((total: number, s: { bytes: number }) => total + s.bytes, 0);
  assert.equal(report.candidate.eagerBytes, sum('eager'));
  assert.equal(report.candidate.onDemandBytes, sum('on-demand'));
  assert.equal(report.candidate.lazyBytes, sum('lazy'));
  // the gate this unit exists for. Two separate claims, because the baseline showed they differ:
  // the eager shell must be small in *bytes* ...
  assert.ok(report.candidate.eagerBytes < 1_000_000, `eager shell is ${report.candidate.eagerBytes} bytes`);
  // ... and opening the pack must not inflate a JS object graph the way full v2 does, even with
  // every shard resident, which is the claim the view model actually makes
  assert.equal(report.candidate.measuredOpen.declaredBytes, report.candidate.eagerBytes);
  assert.equal(report.candidate.measuredFullyResident.declaredBytes, report.candidate.eagerBytes + report.candidate.onDemandBytes + report.candidate.lazyBytes);
  assert.ok(report.candidate.measuredFullyResident.viewObjectHeapMb < v2.performanceObserved.hotHeapDeltaMb / 100);
  for (const open of [report.candidate.measuredOpen, report.candidate.measuredFullyResident]) {
    assert.ok(open.sectionBytesResident >= open.declaredBytes);
    assert.ok(open.views > 0);
  }
  // the knowledge that cannot be eager is demand-loaded, and its shard plan is recorded so unit B
  // does not have to guess a split; encoding alone does not reach the §10 mobile target
  assert.ok(report.candidate.onDemandBytes > report.candidate.eagerBytes);
  assert.ok(report.candidate.shardPlan.targetShardBytes > 0);
  for (const planned of report.candidate.shardPlan.sections) {
    assert.equal(BROWSER_PACK_SECTION_KINDS[planned.kind as BrowserPackSectionKind].shardable, true, planned.kind);
    assert.equal(planned.shardCount, Math.ceil(planned.bytes / report.candidate.shardPlan.targetShardBytes), planned.sectionId);
  }
  // the finding that the binary encoding alone is not the win must stay on the record
  assert.ok(report.findings.length >= 3);
  for (const finding of report.findings) assert.equal(typeof finding.finding, 'string');
  // metrics that cannot exist before their owning unit are declared pending, never estimated
  assert.ok(report.pendingMetrics.length >= 4);
  for (const pending of report.pendingMetrics) {
    assert.match(pending.owner, /^#185 [B-I]$/);
    assert.equal(typeof pending.metric, 'string');
  }
});

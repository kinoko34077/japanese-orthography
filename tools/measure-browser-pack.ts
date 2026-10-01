import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  BROWSER_PACK_COMPILER_VERSION,
  BROWSER_PACK_SECTION_KINDS,
  browserPackSectionId,
  chooseElementWidth,
  sectionByteLength,
  type BrowserPackColumnShape,
  type BrowserPackElementWidth,
  type BrowserPackSectionKind,
  type BrowserPackSectionLoading
} from './browser-pack-model.ts';
import { ORTHOGRAPHY_V2_MEASUREMENTS } from './measure-orthography-v2.ts';
import { buildOrthographyHotArtifact, knowledgeDigest, type OrthographyHotArtifact } from './orthography-hot-artifact.ts';
import { HISTORICAL_PROFILE, KINOTCH_PROFILE, MODERN_PROFILE, resolveProjectionPolicy, withProfileRules } from './orthography-policy.ts';
import { normalizeAcceptedOrthographySources } from './orthography-source-normalization.ts';

// BrowserPack A (#185 A, spec #184 §10): the baseline this unit exists to establish. The accepted
// full-v2 side is re-derived live and cross-checked against the accepted v2 report, so the baseline
// can never silently become a copied constant. The BrowserPack candidate side is a projection of the
// real v2 cardinalities through the declared width model (`browser-pack-model.ts`) — every recorded
// size is reproducible from the shape recorded beside it, which is what stops unit B from designing a
// binary layout nobody measured. Metrics that genuinely cannot exist before their owning unit are
// listed as pending rather than estimated.

export const BROWSER_PACK_MEASUREMENTS = 'data/reports/browser-pack-v1-measurements.json';

interface CandidateSection {
  readonly sectionId: string;
  readonly kind: BrowserPackSectionKind;
  readonly loading: BrowserPackSectionLoading;
  readonly rowCount: number;
  readonly bytes: number;
  readonly columns?: readonly BrowserPackColumnShape[] | undefined;
  readonly gzipBytes?: number | undefined;
  readonly pendingOwner?: string | undefined;
  readonly note?: string | undefined;
}

const OFFSET_WIDTH = 4;
const utf8 = new TextEncoder();
const listElements = (rows: readonly unknown[]) => rows.reduce<number>((total, row) => total + (Array.isArray(row) ? row.length : 0), 0);

/** A list column plus the one-byte-per-row presence flag that keeps "absent" distinct from "empty". */
function optionalList(name: string, rows: readonly unknown[], width: BrowserPackElementWidth): BrowserPackColumnShape[] {
  return [{ name, width, elements: listElements(rows) }, { name: `${name}Presence`, width: 1 }];
}

function requiredList(name: string, rows: readonly unknown[], width: BrowserPackElementWidth): BrowserPackColumnShape {
  return { name, width, elements: listElements(rows) };
}

function candidate(kind: BrowserPackSectionKind, rowCount: number, columns: readonly BrowserPackColumnShape[], note?: string): CandidateSection {
  return {
    sectionId: browserPackSectionId(kind, {}),
    kind,
    loading: BROWSER_PACK_SECTION_KINDS[kind].loading,
    rowCount,
    bytes: sectionByteLength(rowCount, columns),
    columns,
    note
  };
}

/** Project every candidate pack section from the real columnar shape of the accepted hot artifact. */
function planCandidateSections(artifact: OrthographyHotArtifact, policies: readonly [string, string][]): CandidateSection[] {
  const strings = artifact.strings;
  const facts = artifact.facts as Record<string, unknown[]>;
  const rules = artifact.rules as Record<string, unknown[]>;
  const bindings = artifact.bindings as Record<string, unknown[]>;
  const provenance = artifact.provenance as unknown as { sourceRefs: number[][]; evidenceRefs: number[][] };
  const factRows = facts.kind!.length;
  const ruleRows = rules.id!.length;
  const bindingRows = bindings.id!.length;
  const provenanceRows = provenance.sourceRefs.length;

  // a string id column must also encode the "absent" sentinel, hence maxValue = pool length
  const strId = chooseElementWidth(strings.length);
  const enumWidth = chooseElementWidth(Math.max(...Object.values(artifact.enums).map((values) => values.length)));
  const factRef = chooseElementWidth(factRows);
  const ruleRef = chooseElementWidth(ruleRows);
  const provRef = chooseElementWidth(provenanceRows);

  const poolBytes = strings.reduce((total, value) => total + utf8.encode(value).byteLength, 0);
  const poolColumns: BrowserPackColumnShape[] = [{ name: 'utf8', width: 1, elements: poolBytes }];
  const poolSection: CandidateSection = {
    sectionId: browserPackSectionId('string-pool', {}),
    kind: 'string-pool',
    loading: BROWSER_PACK_SECTION_KINDS['string-pool'].loading,
    rowCount: strings.length,
    bytes: sectionByteLength(strings.length, poolColumns),
    columns: poolColumns,
    // the pool is the one binary section whose real bytes exist before the compiler, so its transfer
    // size is measurable now; the column sections stay transfer-unmeasured until unit B emits bytes
    gzipBytes: gzipSync(Buffer.concat(strings.map((value) => Buffer.from(value, 'utf8'))), { level: 9 }).length
  };

  // lexical surface index: distinct fact surfaces. The accepted v2 graph already carries the
  // normalized JMdict forms/readings, so this is the real surface universe a span planner matches.
  const surfaceFacts = new Map<number, number[]>();
  (facts.surface as number[]).forEach((surfaceId, row) => {
    if (surfaceId < 0) return;
    const list = surfaceFacts.get(surfaceId);
    if (list === undefined) surfaceFacts.set(surfaceId, [row]);
    else list.push(row);
  });
  const surfaceRows = [...surfaceFacts.values()];

  return [
    poolSection,
    candidate('facts', factRows, [
      { name: 'id', width: strId },
      { name: 'kind', width: enumWidth },
      { name: 'surface', width: strId },
      { name: 'reading', width: strId },
      { name: 'target', width: strId },
      { name: 'origin', width: enumWidth },
      { name: 'derivationMechanism', width: enumWidth },
      requiredList('lexicalRefs', facts.lexicalRefs!, strId),
      ...optionalList('tags', facts.tags!, strId),
      ...optionalList('periodRefs', facts.periodRefs!, strId),
      ...optionalList('derivedFrom', facts.derivedFrom!, strId)
    ]),
    candidate('rules', ruleRows, [
      { name: 'id', width: strId },
      { name: 'class', width: enumWidth },
      { name: 'directionality', width: enumWidth },
      { name: 'lossiness', width: enumWidth },
      { name: 'origin', width: enumWidth },
      { name: 'derivationMechanism', width: enumWidth },
      { name: 'predicate', width: strId },
      requiredList('from', rules.from!, strId),
      requiredList('to', rules.to!, strId),
      requiredList('dependencies', rules.dependencies!, strId),
      ...optionalList('derivedFrom', rules.derivedFrom!, strId)
    ]),
    candidate('bindings', bindingRows, [
      { name: 'id', width: strId },
      { name: 'ruleId', width: ruleRef },
      requiredList('lexicalRefs', bindings.lexicalRefs!, strId),
      ...optionalList('contextRefs', bindings.contextRefs!, strId)
    ]),
    candidate('lexical-index', surfaceRows.length, [
      { name: 'surface', width: strId },
      requiredList('facts', surfaceRows, factRef)
    ], 'ordered by surface string id so a shard is binary-searchable without an auxiliary trie; unit B fixes the shard split from these bytes'),
    candidate('provenance-index', factRows + ruleRows + bindingRows, [{ name: 'detailRef', width: provRef }],
      'one compact detailRef per knowledge row in fact/rule/binding order; it travels with the knowledge shards, while the evidence it points at stays in the lazy detail shard'),
    candidate('detail-shard', provenanceRows, [
      requiredList('sourceRefs', provenance.sourceRefs, strId),
      requiredList('evidenceRefs', provenance.evidenceRefs, strId)
    ], 'lazy: never fetched to render the UI shell or a compact diagnostic summary'),
    {
      sectionId: browserPackSectionId('shard-directory', {}),
      kind: 'shard-directory',
      loading: BROWSER_PACK_SECTION_KINDS['shard-directory'].loading,
      rowCount: 0,
      bytes: 0,
      pendingOwner: '#185 B',
      note: 'one row per on-demand shard (covered key range plus the shard it names); its row count follows the shard split that unit B fixes from candidate.shardPlan, so no size is estimated here'
    },
    ...policies.map(([profileId, text]): CandidateSection => ({
      sectionId: browserPackSectionId('profile-policy', { profileId }),
      kind: 'profile-policy',
      loading: BROWSER_PACK_SECTION_KINDS['profile-policy'].loading,
      rowCount: 1,
      bytes: Buffer.byteLength(text),
      gzipBytes: gzipSync(text, { level: 9 }).length,
      note: 'resolved projection policy only; it carries no knowledge table, which is what keeps the three profiles on one pack'
    })),
    {
      sectionId: browserPackSectionId('terminology', {}),
      kind: 'terminology',
      loading: BROWSER_PACK_SECTION_KINDS.terminology.loading,
      rowCount: 0,
      bytes: 0,
      pendingOwner: '#185 F',
      note: 'the Japanese-first label/help dictionary is authored by unit F; no size is estimated here'
    }
  ];
}

/**
 * Target bytes per on-demand shard. 256 KiB is a transfer-shaped unit, not a semantic one: large
 * enough that a conversion does not fan out into hundreds of requests, small enough that a first
 * conversion on a mobile connection fetches a bounded amount. Unit B owns the final split and may
 * move this once it can measure real reference locality.
 */
const TARGET_SHARD_BYTES = 256 * 1024;

function planShards(sections: readonly CandidateSection[]): Record<string, unknown> {
  const shardable = sections.filter((section) => section.loading !== 'eager' && BROWSER_PACK_SECTION_KINDS[section.kind].shardable && section.bytes > 0);
  const planned = shardable.map((section) => ({
    sectionId: section.sectionId,
    kind: section.kind,
    loading: section.loading,
    bytes: section.bytes,
    rowCount: section.rowCount,
    shardCount: Math.ceil(section.bytes / TARGET_SHARD_BYTES),
    rowsPerShard: Math.ceil(section.rowCount / Math.ceil(section.bytes / TARGET_SHARD_BYTES))
  }));
  return {
    targetShardBytes: TARGET_SHARD_BYTES,
    sections: planned,
    totalShards: planned.reduce((total, section) => total + section.shardCount, 0),
    note: 'shard counts are the arithmetic consequence of the measured section bytes at the target shard size; they are a budget for unit B, not an accepted physical layout'
  };
}

interface LayoutEntry {
  readonly view: string;
  readonly width: BrowserPackElementWidth;
  readonly byteOffset: number;
  readonly byteLength: number;
}

/** Sequential layout of the selected views, each aligned to its element width. */
function planLayout(sections: readonly CandidateSection[], include: (section: CandidateSection) => boolean): { entries: LayoutEntry[]; allocatedBytes: number } {
  const entries: LayoutEntry[] = [];
  let offset = 0;
  const place = (view: string, width: BrowserPackElementWidth, byteLength: number) => {
    const pad = offset % width === 0 ? 0 : width - (offset % width);
    offset += pad;
    entries.push({ view, width, byteOffset: offset, byteLength });
    offset += byteLength;
  };
  for (const section of sections) {
    if (!include(section)) continue;
    if (section.columns === undefined) {
      place(section.sectionId, 1, section.bytes);
      continue;
    }
    for (const column of section.columns) {
      if (column.elements !== undefined) place(`${section.sectionId}.${column.name}.offsets`, OFFSET_WIDTH, (section.rowCount + 1) * OFFSET_WIDTH);
      place(`${section.sectionId}.${column.name}`, column.width, (column.elements ?? section.rowCount) * column.width);
    }
  }
  return { entries, allocatedBytes: offset };
}

/**
 * Open a projected footprint as real TypedArray views, the way the browser runtime will.
 *
 * V8 keeps ArrayBuffer storage off the JS heap, so a `heapUsed` delta alone would flatter this:
 * what it measures here is only the per-view *object* overhead, and the section bytes themselves are
 * the ArrayBuffer whose exact size we already know (`sectionBytesResident`). That is precisely the
 * claim worth making against full v2 — there is no third term, no object graph proportional to the
 * data. Process-level `arrayBuffers`/`external` deltas are not reported: at these window sizes they
 * are dominated by unrelated GC churn and came out negative, which would be noise presented as fact.
 */
interface OpenMeasurement {
  readonly declaredBytes: number;
  readonly sectionBytesResident: number;
  readonly alignmentPaddingBytes: number;
  readonly views: number;
  readonly openMs: number;
  readonly viewObjectHeapMb: number;
}

function measureOpen(sections: readonly CandidateSection[], include: (section: CandidateSection) => boolean): OpenMeasurement {
  const declaredBytes = sections.filter(include).reduce((total, section) => total + section.bytes, 0);
  const { entries, allocatedBytes } = planLayout(sections, include);
  const planned = entries.reduce((total, entry) => total + entry.byteLength, 0);
  if (planned !== declaredBytes) throw new Error(`layout covers ${planned} bytes but the sections declare ${declaredBytes}`);
  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  const buffer = new ArrayBuffer(allocatedBytes);
  const views = entries.map((entry) => {
    const Ctor = entry.width === 1 ? Uint8Array : entry.width === 2 ? Uint16Array : Uint32Array;
    return new Ctor(buffer, entry.byteOffset, entry.byteLength / entry.width);
  });
  const openMs = performance.now() - started;
  const heapMb = (process.memoryUsage().heapUsed - heapBefore) / 2 ** 20;
  if (views.length !== entries.length) throw new Error('view count mismatch');
  return {
    declaredBytes,
    sectionBytesResident: allocatedBytes,
    alignmentPaddingBytes: allocatedBytes - declaredBytes,
    views: views.length,
    openMs: Number(openMs.toFixed(3)),
    viewObjectHeapMb: Math.round(heapMb * 10) / 10
  };
}

export async function buildBrowserPackMeasurements(rootDir: string): Promise<Record<string, unknown>> {
  const accepted = JSON.parse(await readFile(resolve(rootDir, ORTHOGRAPHY_V2_MEASUREMENTS), 'utf8'));
  const { graph: normalized } = await normalizeAcceptedOrthographySources(rootDir);
  const graph = withProfileRules(normalized);
  const artifact = buildOrthographyHotArtifact(graph, MODERN_PROFILE);

  // fail closed rather than record a baseline that no longer describes the accepted v2 state
  const liveDigest = knowledgeDigest(graph);
  if (liveDigest !== accepted.canonicalGraph.sha256) throw new Error(`live v2 canonical graph ${liveDigest} does not match the accepted ${ORTHOGRAPHY_V2_MEASUREMENTS}; regenerate that report first`);
  const hotBytes = Buffer.byteLength(JSON.stringify(artifact));
  if (hotBytes !== accepted.hotArtifacts.modern.bytes) throw new Error(`live modern hot artifact is ${hotBytes} bytes, the accepted report says ${accepted.hotArtifacts.modern.bytes}`);

  const policies = ([['modern', MODERN_PROFILE], ['historical', HISTORICAL_PROFILE], ['kinotch', KINOTCH_PROFILE]] as const)
    .map(([name, profile]) => [name, JSON.stringify(resolveProjectionPolicy(profile, graph))] as [string, string]);
  const sections = planCandidateSections(artifact, policies);
  // the shell open (what the user waits for) and the worst case of every shard resident at once
  const measuredOpen = { node: process.version, ...measureOpen(sections, (section) => section.loading === 'eager') };
  const measuredFullyResident = measureOpen(sections, () => true);
  const bytesOf = (loading: BrowserPackSectionLoading) => sections.filter((section) => section.loading === loading).reduce((total, section) => total + section.bytes, 0);
  const eagerBytes = measuredOpen.declaredBytes;
  const onDemandBytes = bytesOf('on-demand');
  const lazyBytes = bytesOf('lazy');
  const shardPlan = planShards(sections);
  const poolSection = sections.find((section) => section.kind === 'string-pool')!;
  const factsSection = sections.find((section) => section.kind === 'facts')!;

  return {
    schemaVersion: '1',
    kind: 'browser-pack-v1-measurements',
    owner: 'japanese-orthography#185 A',
    spec: 'japanese-orthography#184',
    note: 'Baseline values are re-derived live from the accepted v2 sources and cross-checked against data/reports/orthography-v2-measurements.json; the full-v2 inflate heap/time are cited observations from that accepted report. Candidate section bytes are projections of the real v2 cardinalities through the browser-pack width model and are reproducible from the shapes recorded beside them. Timing and heap values are informational machine-dependent observations.',
    compilerVersion: BROWSER_PACK_COMPILER_VERSION,
    baseline: {
      source: ORTHOGRAPHY_V2_MEASUREMENTS,
      canonicalGraphSha256: liveDigest,
      canonicalGraphBytes: accepted.canonicalGraph.bytes,
      hotArtifactBytes: hotBytes,
      hotArtifactGzipBytes: accepted.hotArtifacts.modern.gzipBytes,
      hotInflateMs: accepted.performanceObserved.hotStartupMs,
      hotInflateHeapMb: accepted.performanceObserved.hotHeapDeltaMb
    },
    counts: {
      facts: (artifact.facts as Record<string, unknown[]>).kind!.length,
      rules: (artifact.rules as Record<string, unknown[]>).id!.length,
      bindings: (artifact.bindings as Record<string, unknown[]>).id!.length,
      sources: artifact.sources.length,
      strings: artifact.strings.length
    },
    candidate: { sections, eagerBytes, onDemandBytes, lazyBytes, shardPlan, measuredOpen, measuredFullyResident },
    reduction: {
      totalVsHotArtifactBytes: Number(((eagerBytes + onDemandBytes + lazyBytes) / hotBytes).toFixed(4)),
      eagerVsHotArtifactBytes: Number((eagerBytes / hotBytes).toFixed(6)),
      // the decisive comparison: even with every shard resident, the JS heap carries only view
      // objects, against the 965 MB object graph a full v2 inflate builds
      fullyResidentHeapVsHotInflateHeap: Number(((measuredFullyResident.viewObjectHeapMb) / accepted.performanceObserved.hotHeapDeltaMb).toFixed(6))
    },
    findings: [
      {
        finding: `Binary columnar encoding alone buys no bytes at all. The whole candidate pack is ${eagerBytes + onDemandBytes + lazyBytes} bytes against the ${hotBytes}-byte v2 hot artifact — slightly larger, because dense 4-byte row ids and offset arrays cost about what the JSON they replace did. What the encoding does buy is heap: even with every shard resident the JS heap carries only ${measuredFullyResident.viewObjectHeapMb} MB of view objects over a ${measuredFullyResident.sectionBytesResident}-byte ArrayBuffer, against the ${accepted.performanceObserved.hotHeapDeltaMb} MB object graph a full v2 inflate builds. #184 §12.2 (no full object-graph inflate) is therefore met by the view model, but the §10 "practical on a contemporary mobile browser" requirement is met only by demand-loaded shards — the eager shell is ${eagerBytes} bytes — and never by the encoding choice.`,
        evidence: 'candidate.sections, candidate.measuredOpen, candidate.measuredFullyResident, baseline.hotInflateHeapMb',
        consequence: 'unit B must compile sharded on-demand knowledge sections plus a small eager shard directory; a fully eager pack is not admissible'
      },
      {
        finding: `Two sections dominate: the string pool at ${poolSection.bytes} bytes (${poolSection.gzipBytes} gzipped) and the facts table at ${factsSection.bytes} bytes, together ${Math.round(((poolSection.bytes + factsSection.bytes) / (eagerBytes + onDemandBytes + lazyBytes)) * 1000) / 10}% of the pack. Both scale with the ${(artifact.facts as Record<string, unknown[]>).kind!.length} normalized v2 facts, which are overwhelmingly JMdict forms and readings.`,
        evidence: 'candidate.sections[string-pool], candidate.sections[facts], counts.facts',
        consequence: 'the shard key must partition these two together; sharding anything else first moves no meaningful bytes'
      },
      {
        finding: 'String ids are global to the pool, so a facts shard can reference a string in any pool shard. Reference locality across the chosen shard split is not measured by this unit and is the main open risk to the per-conversion fetch volume.',
        evidence: 'tools/orthography-hot-artifact.ts interns one pool for the whole artifact; candidate.sections[facts].columns reference it by id',
        consequence: 'unit B must either renumber strings per shard or hold a small globally eager pool for high-frequency strings, and must measure the resulting fetch fan-out before the layout is accepted'
      }
    ],
    pendingMetrics: [
      { metric: 'transfer/compressed bytes of the binary column sections', owner: '#185 B', reason: 'no section bytes exist until the compiler emits them; only the string pool and the policy JSON are measurable now' },
      { metric: 'shard-directory size and per-conversion shard fetch fan-out', owner: '#185 B', reason: 'both follow the shard split and the string-reference locality it produces; see findings[2]' },
      { metric: 'lexical match throughput', owner: '#185 C', reason: 'requires the browser runtime index' },
      { metric: 'end-to-end arbitrary-text conversion throughput', owner: '#185 D', reason: 'requires the span planner and Worker transform' },
      { metric: 'diagnostic detail open latency', owner: '#185 E', reason: 'requires the lazy detail expansion path' },
      { metric: 'terminology section size', owner: '#185 F', reason: 'the Japanese-first dictionary is authored there' },
      { metric: 'cold versus cached second-use startup', owner: '#185 H', reason: 'requires the cache/update layer' }
    ]
  };
}

if (process.argv[1]?.endsWith('measure-browser-pack.ts')) {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const report = await buildBrowserPackMeasurements(rootDir);
  await writeFile(resolve(rootDir, BROWSER_PACK_MEASUREMENTS), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

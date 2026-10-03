import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { BrowserPackBuild } from './browser-pack-compiler.ts';
import { encodeBundle, encodeSection, type ColumnInput } from './browser-pack-encoding.ts';
import { BROWSER_PACK_V3_COMPILER_VERSION, browserPackSectionId, sealBrowserPackManifest, type BrowserPackManifestV1, type BrowserPackSectionDescriptor } from './browser-pack-model.ts';
import { symbolRegistryDigest, type SymbolRegistry } from './symbol-registry.ts';
import { buildEvidence, evidenceAggregateDigest, evidenceLayer } from './evidence-map.ts';
import { EVIDENCE_SCHEMA_VERSION } from './evidence-map.ts';
import { RULE_PROGRAM_COMPILER_VERSION, RULE_PROGRAM_FORMAT_VERSION, RULE_PROGRAM_ISA_VERSION, ruleProgramDigest } from './rule-program-compiler.ts';
import type { OrthographyKnowledgeGraph } from './orthography-knowledge-model.ts';
import type { RuleIR } from './rule-ir.ts';

// #208 §7 / §9 — #211 F: BrowserPack v3 = the v2 pack with every hot string column symbol-encoded.
//
// The v2 build is transcoded section by section: integer columns are kept; every UTF-8 string column
// X becomes `X$tok` (per-row token lists) + `X$raw` (deduplicated raw pieces). Orthographic atoms are
// SymbolIds of the append-only registry (fixed uint16 while ids fit, #211 C); ASCII runs and atoms the
// registry does not cover are raw pieces, so identifiers stay as compact as UTF-8 and nothing is lost.
// The registry ships as one small eager section. Section ids, kinds, shards and paths are unchanged,
// so every v2 runtime path reads v3 through the same `string(name, i)` accessor (semantic identity).

const require = createRequire(import.meta.url);
const { decodeSection, decodeBundle } = require('../runtime/browser-pack-binary.js');
const { atomsOf } = require('../runtime/symbol-registry-runtime.js');

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const isAscii = (atom: string) => atom.length === 1 && atom.charCodeAt(0) < 0x80;

/** Symbol-encode one logical string column. */
export function symbolStringColumns(name: string, values: readonly string[], registry: SymbolRegistry): ColumnInput[] {
  const idOf = new Map(registry.atoms.map((a, i) => [a, i + 1]));
  const tombstoned = new Set(registry.tombstones);
  const base = registry.atoms.length;
  const pieces: string[] = [];
  const pieceId = new Map<string, number>();
  const tokens = values.map((value) => {
    const out: number[] = [];
    let run = '';
    const flush = () => {
      if (!run) return;
      let p = pieceId.get(run);
      if (p === undefined) { p = pieces.length; pieces.push(run); pieceId.set(run, p); }
      out.push(base + 1 + p);
      run = '';
    };
    for (const atom of atomsOf(value) as string[]) {
      const id = idOf.get(atom);
      if (id !== undefined && !tombstoned.has(id) && !isAscii(atom)) { flush(); out.push(id); }
      else run += atom;
    }
    flush();
    return out;
  });
  return [{ name: `${name}$tok`, kind: 'list', values: tokens }, { name: `${name}$raw`, kind: 'strings', values: pieces }];
}

/** Re-encode a decoded v2 section with symbol-encoded string columns (column order preserved). */
function transcodeColumns(section: any, registry: SymbolRegistry): ColumnInput[] {
  const out: ColumnInput[] = [];
  for (const column of Object.values<any>(section.columns)) {
    if (column.utf8) {
      const values: string[] = [];
      for (let i = 0; i < column.rowCount; i += 1) values.push(section.string(column.name, i));
      out.push(...symbolStringColumns(column.name, values, registry));
    } else if (column.list) {
      const lists: number[][] = [];
      for (let i = 0; i < column.rowCount; i += 1) lists.push(Array.from(column.values.subarray(column.offsets[i], column.offsets[i + 1])));
      out.push({ name: column.name, kind: 'list', values: lists, width: column.width });
    } else {
      out.push({ name: column.name, kind: 'scalar', values: Array.from(column.values), width: column.width });
    }
  }
  return out;
}

export const registrySection = (registry: SymbolRegistry) => encodeSection([
  { name: 'generation', kind: 'scalar', values: [registry.generations[registry.generations.length - 1]?.generation ?? 0] },
  { name: 'atoms', kind: 'strings', values: registry.atoms },
  { name: 'tombstones', kind: 'scalar', values: registry.tombstones }
]);

export function transcodeToV3(v2: BrowserPackBuild, registry: SymbolRegistry, options: { evidence?: { graph: OrthographyKnowledgeGraph; ir: RuleIR } } = {}): BrowserPackBuild {
  if (!options.evidence) throw new Error('BrowserPack v3 requires an evidence identity input');
  const files = new Map<string, Uint8Array>();
  const sections: BrowserPackSectionDescriptor[] = [];
  // cold evidence sections (#211 G) are built v2-style, then transcoded with everything else
  const extra: Array<{ s: BrowserPackSectionDescriptor; body: Uint8Array }> = [];
  const evidence = buildEvidence(options.evidence.graph, options.evidence.ir);
  evidenceLayer(options.evidence.ir, { built: evidence })({
      graph: options.evidence.graph,
      add: (kind, body, x = {}) => {
        const sectionId = browserPackSectionId(kind, { shard: x.shard, profileId: x.profileId });
        extra.push({ body, s: { sectionId, kind, path: `${sectionId.replace(/[@/]/g, '-')}.bin`, encoding: 'binary-columnar', loading: 'lazy', byteLength: body.byteLength, sha256: sha(body), ...(x.rowCount !== undefined ? { rowCount: x.rowCount } : {}), ...(x.shard ? { shard: x.shard } : {}) } });
        return sectionId;
      }
  });
  const sources = [...v2.manifest.sections.filter((s) => s.kind !== 'provenance-index').map((s) => ({ s, body: v2.files.get(s.path)! })), ...extra];
  for (const { s, body } of sources) {
    let next = body;
    if (s.encoding === 'binary-columnar') next = encodeSection(transcodeColumns(decodeSection(body), registry));
    else if (s.encoding === 'binary-bundle') {
      const bundle = decodeBundle(body);
      next = encodeBundle(Object.entries<any>(bundle.parts).map(([name, part]) => [name, encodeSection(transcodeColumns(part, registry))] as const));
    }
    files.set(s.path, next);
    sections.push({ ...s, byteLength: next.byteLength, sha256: sha(next) });
  }
  const reg = registrySection(registry);
  const sectionId = browserPackSectionId('symbol-registry', {});
  files.set('symbol-registry.bin', reg);
  sections.push({ sectionId, kind: 'symbol-registry', path: 'symbol-registry.bin', encoding: 'binary-columnar', loading: 'eager', byteLength: reg.byteLength, sha256: sha(reg), rowCount: registry.atoms.length });
  const { packDigest: _ignored, ...rest } = v2.manifest as BrowserPackManifestV1;
  const manifest = sealBrowserPackManifest({ ...rest, compilerVersion: BROWSER_PACK_V3_COMPILER_VERSION, sections,
    symbolRegistry: { generation: registry.generations[registry.generations.length - 1]?.generation ?? 0, digest: symbolRegistryDigest(registry) },
    ruleRuntime: { isaVersion: RULE_PROGRAM_ISA_VERSION, compilerVersion: RULE_PROGRAM_COMPILER_VERSION, programFormatVersion: RULE_PROGRAM_FORMAT_VERSION, programDigest: ruleProgramDigest(options.evidence.ir) },
    evidence: { schemaVersion: EVIDENCE_SCHEMA_VERSION, aggregateDigest: evidenceAggregateDigest(evidence.entries, evidence.programs) }
  });
  return { manifest, files };
}

/**
 * Semantic identity of v3 and v2 on a probe set (#211 F): summaries, units and every span detail must
 * be deep-equal for every profile and render mode. Returns the number of compared conversions.
 */
export async function assertV3Equivalent(v2: BrowserPackBuild, v3: BrowserPackBuild, texts: readonly string[], profiles: readonly string[] = ['modern', 'historical', 'kinotch-fixed']): Promise<number> {
  const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
  const { createBrowserLexicalRuntime } = require('../runtime/browser-lexical-runtime.js');
  const { transformWithResolver } = require('../runtime/browser-resolver-adapter.js');
  const { summarize, expandDetail } = require('../runtime/browser-diagnostic-contract.js');
  const open = async (b: BrowserPackBuild) => { const pack = await openBrowserPack(b.manifest, async (s: { path: string }) => b.files.get(s.path)!); return { pack, lexical: createBrowserLexicalRuntime(pack) }; };
  const [a, b] = [await open(v2), await open(v3)];
  // v3 adds the recovered cold evidence (#211 G) to details; everything else must be identical
  const strip = (x: unknown): unknown => JSON.parse(JSON.stringify(x, (k, v) => (k === 'evidence' ? undefined : v)));
  const same = (x: unknown, y: unknown) => JSON.stringify(strip(x)) === JSON.stringify(strip(y));
  let compared = 0;
  for (const profile of profiles) for (const mode of ['plain', 'ruby-whole-explicit']) for (const text of texts) {
    const [ra, rb] = [await transformWithResolver(a.pack, a.lexical, text, profile, { renderMode: mode }), await transformWithResolver(b.pack, b.lexical, text, profile, { renderMode: mode })];
    if (!same(summarize(ra), summarize(rb)) || !same(ra.units ?? null, rb.units ?? null)) throw new Error(`v3 differs from v2 for ${profile}/${mode}/${text}`);
    for (const i of ra.spans.keys()) if (!same(await expandDetail(a.pack, ra, String(i)), await expandDetail(b.pack, rb, String(i)))) throw new Error(`v3 detail differs for ${profile}/${mode}/${text} span ${i}`);
    compared += 1;
  }
  return compared;
}

import { createHash } from 'node:crypto';

// BrowserPack A (#185 A, spec #184): the pack/runtime boundary, fixed before any binary layout is
// designed. This module owns only identity and admissibility — the section vocabulary, deterministic
// canonical serialization, the pack identity lock, and the fail-closed validator. It deliberately
// holds no knowledge: `orthography-v2` remains the single semantic authority and BrowserPack is
// derived runtime data. The chosen physical encoding (columnar rows, tries, shard layout) lives
// behind `encoding` and the width model below and must never reach a site-level transform or
// diagnostic contract, so a later unit can replace it without changing this manifest's meaning.

export const BROWSER_PACK_COMPILER_VERSION = '1';
export const BROWSER_PACK_SCHEMA_VERSION = '1';
export const BROWSER_PACK_MANIFEST_KIND = 'japanese-orthography-browser-pack';
/** External offsets stay UTF-16 code units so UI/DOM ranges need no re-indexing (#184 §4). */
export const BROWSER_PACK_EXTERNAL_OFFSET_UNIT = 'utf16-code-unit';

export type BrowserPackContentClass = 'knowledge' | 'detail' | 'profile' | 'presentation';
export type BrowserPackSectionEncoding = 'binary-columnar' | 'binary-bundle' | 'json';

/**
 * Availability of a section, strongest first.
 *
 * `eager`      must be present to open the pack at all; the UI shell waits on exactly this set.
 * `on-demand`  needed for a *correct* conversion, but only the shards the input text reaches.
 * `lazy`       never needed for a correct conversion; evidence fetched when a span is inspected.
 *
 * The unit-A baseline is why `on-demand` exists as its own class rather than being folded into
 * `lazy`: the eager core cannot hold all 555k normalized v2 facts and stay usable on mobile, but
 * treating knowledge as merely "lazy" would let a runtime skip a shard and silently convert a span
 * against incomplete evidence. Keeping the classes distinct makes a missing knowledge shard a
 * fail-closed condition and a missing detail shard an ordinary deferral.
 */
export type BrowserPackSectionLoading = 'eager' | 'on-demand' | 'lazy';

const LOADING_STRENGTH: Record<BrowserPackSectionLoading, number> = { eager: 0, 'on-demand': 1, lazy: 2 };

export interface BrowserPackSectionKindSpec {
  /** `knowledge` is the profile-neutral conversion core; `detail` is inspection-time evidence. */
  readonly contentClass: BrowserPackContentClass;
  readonly encoding: BrowserPackSectionEncoding;
  /** Fixed per kind: a pack may not promote diagnostics nor demote the conversion core. */
  readonly loading: BrowserPackSectionLoading;
  readonly shardable: boolean;
  /** `true` requires a `profileId`; `false` forbids one, which is what keeps knowledge shared. */
  readonly profileScoped: boolean;
  readonly description: string;
}

const SECTION_KINDS = {
  'shard-directory': { contentClass: 'knowledge', encoding: 'binary-columnar', loading: 'eager', shardable: false, profileScoped: false, description: 'eager range directory mapping a lookup key to the on-demand shard that covers it' },
  'string-pool': { contentClass: 'knowledge', encoding: 'binary-columnar', loading: 'on-demand', shardable: true, profileScoped: false, description: 'shared UTF-8 string pool addressed by numeric row ids' },
  facts: { contentClass: 'knowledge', encoding: 'binary-columnar', loading: 'on-demand', shardable: true, profileScoped: false, description: 'columnar v2 facts needed by browser conversion' },
  rules: { contentClass: 'knowledge', encoding: 'binary-columnar', loading: 'eager', shardable: false, profileScoped: false, description: 'columnar v2 rules; every conversion can reach any rule, and the whole table is small' },
  bindings: { contentClass: 'knowledge', encoding: 'binary-columnar', loading: 'eager', shardable: false, profileScoped: false, description: 'columnar rule bindings' },
  'lexical-index': { contentClass: 'knowledge', encoding: 'binary-columnar', loading: 'on-demand', shardable: true, profileScoped: false, description: 'lexical surface index for span candidate discovery' },
  'provenance-index': { contentClass: 'knowledge', encoding: 'binary-columnar', loading: 'on-demand', shardable: true, profileScoped: false, description: 'compact provenance/detail references resolvable to canonical ids' },
  'detail-shard': { contentClass: 'detail', encoding: 'binary-columnar', loading: 'lazy', shardable: true, profileScoped: false, description: 'diagnostic/provenance detail payload opened only when a span is inspected' },
  'profile-policy': { contentClass: 'profile', encoding: 'json', loading: 'eager', shardable: false, profileScoped: true, description: 'one profile policy descriptor; carries no knowledge tables' },
  terminology: { contentClass: 'presentation', encoding: 'json', loading: 'eager', shardable: false, profileScoped: false, description: 'Japanese-first label/help dictionary' },
  // ---- BrowserPack v2 lexical layer (#196 B): lexeme-centric, surface and reading converge -------
  'lexical-directory': { contentClass: 'knowledge', encoding: 'binary-columnar', loading: 'eager', shardable: false, profileScoped: false, description: 'eager range directory for the surface index, reading index and lexeme tables' },
  'morphology-table': { contentClass: 'knowledge', encoding: 'binary-columnar', loading: 'eager', shardable: false, profileScoped: false, description: 'compact morphology rows (POS, conjugation type/form) addressed by dense id' },
  'surface-index': { contentClass: 'knowledge', encoding: 'binary-columnar', loading: 'on-demand', shardable: true, profileScoped: false, description: 'surface -> lexeme ids' },
  'reading-index': { contentClass: 'knowledge', encoding: 'binary-columnar', loading: 'on-demand', shardable: true, profileScoped: false, description: 'reading -> lexeme ids (secondary index over the same lexeme table)' },
  'lexeme-table': { contentClass: 'knowledge', encoding: 'binary-columnar', loading: 'on-demand', shardable: true, profileScoped: false, description: 'lexical identity, headword and morphology ids by dense lexeme id' },
  'lexeme-forms': { contentClass: 'knowledge', encoding: 'binary-columnar', loading: 'on-demand', shardable: true, profileScoped: false, description: 'written forms of each lexeme (aligned with the lexeme-table shard)' },
  'lexeme-readings': { contentClass: 'knowledge', encoding: 'binary-columnar', loading: 'on-demand', shardable: true, profileScoped: false, description: 'modern/historical readings of each lexeme form (aligned with the lexeme-table shard)' },
  // ---- BrowserPack v2 physical layout (#196 I) -----------------------------------------------------
  'knowledge-bundle': { contentClass: 'knowledge', encoding: 'binary-bundle', loading: 'on-demand', shardable: true, profileScoped: false, description: 'one fetch per knowledge shard: its string-pool, facts and lexical-index sections as zero-copy parts' },
  // ---- BrowserPack v3 (#208 / #211 F) ---------------------------------------------------------------
  'symbol-registry': { contentClass: 'knowledge', encoding: 'binary-columnar', loading: 'eager', shardable: false, profileScoped: false, description: 'append-only Symbol Registry atoms; every v3 string column is a SymbolId token list over it' },
  // ---- cold evidence (#211 G): never needed for conversion ---------------------------------------
  'evidence-map': { contentClass: 'detail', encoding: 'binary-columnar', loading: 'lazy', shardable: true, profileScoped: false, description: 'canonical id -> source records, dispositions, snapshots, period and the Programs compiled from it' },
  'program-evidence': { contentClass: 'detail', encoding: 'binary-columnar', loading: 'lazy', shardable: true, profileScoped: false, description: 'ProgramId -> IR rule, human-readable evidence type, stage/kind and canonical ids' }
} as const;

export type BrowserPackSectionKind = keyof typeof SECTION_KINDS;

export const BROWSER_PACK_SECTION_KINDS: Record<BrowserPackSectionKind, BrowserPackSectionKindSpec> = SECTION_KINDS;

/** Kinds added by the BrowserPack v2 lexical layer (#196 B). */
export const BROWSER_PACK_V2_LEXICAL_SECTION_KINDS: readonly BrowserPackSectionKind[] = ['lexeme-forms', 'lexeme-readings', 'lexeme-table', 'lexical-directory', 'morphology-table', 'reading-index', 'surface-index'];
/** v2 replaces these per-shard v1 sections by one `knowledge-bundle` per shard. */
export const BROWSER_PACK_V2_BUNDLED_KINDS: readonly BrowserPackSectionKind[] = ['facts', 'lexical-index', 'string-pool'];
export const BROWSER_PACK_V2_COMPILER_VERSION = '2';
export const BROWSER_PACK_V3_COMPILER_VERSION = '3';

/** Every v1 kind is required: a pack missing any one of them cannot serve the #184 acceptance flow. */
export const BROWSER_PACK_REQUIRED_SECTION_KINDS: readonly BrowserPackSectionKind[] = (Object.keys(SECTION_KINDS) as BrowserPackSectionKind[]).filter((k) => !BROWSER_PACK_V2_LEXICAL_SECTION_KINDS.includes(k) && !['knowledge-bundle', 'symbol-registry', 'evidence-map', 'program-evidence'].includes(k)).sort();

/** Required kinds by compiler version: v2 = v1 + the lexical layer; v1 packs may not carry v2 kinds. */
export function requiredSectionKinds(compilerVersion: string): readonly BrowserPackSectionKind[] {
  const v2 = [...BROWSER_PACK_REQUIRED_SECTION_KINDS.filter((k) => !BROWSER_PACK_V2_BUNDLED_KINDS.includes(k)), 'knowledge-bundle' as const, ...BROWSER_PACK_V2_LEXICAL_SECTION_KINDS];
  if (compilerVersion === BROWSER_PACK_V2_COMPILER_VERSION) return v2.sort();
  // v3: + symbol registry + cold evidence; the per-shard provenance-index (never read by the runtime) is gone
  if (compilerVersion === BROWSER_PACK_V3_COMPILER_VERSION) return [...v2.filter((k) => k !== 'provenance-index'), 'symbol-registry' as const, 'evidence-map' as const, 'program-evidence' as const].sort();
  return BROWSER_PACK_REQUIRED_SECTION_KINDS;
}

export interface BrowserPackShardDescriptor {
  /** What the shard set partitions, e.g. `surface` for the lexical index. */
  readonly key: string;
  readonly index: number;
  readonly count: number;
  /** Inclusive partition bounds; shards of one key are ordered and non-overlapping. */
  readonly from: string;
  readonly to: string;
}

export interface BrowserPackSectionDescriptor {
  readonly sectionId: string;
  readonly kind: BrowserPackSectionKind;
  readonly path: string;
  readonly encoding: BrowserPackSectionEncoding;
  readonly loading: BrowserPackSectionLoading;
  readonly byteLength: number;
  readonly sha256: string;
  readonly rowCount?: number | undefined;
  readonly shard?: BrowserPackShardDescriptor | undefined;
  readonly profileId?: string | undefined;
  readonly requires?: readonly string[] | undefined;
}

export interface BrowserPackProfileDescriptor {
  readonly profileId: string;
  readonly profileDigest: string;
  readonly policySectionId: string;
}

export interface BrowserPackManifestV1 {
  readonly schemaVersion: '1';
  readonly kind: 'japanese-orthography-browser-pack';
  readonly compilerVersion: string;
  /** Identity lock on the accepted v2 knowledge this pack was compiled from. */
  readonly canonicalGraphSha256: string;
  readonly sourceSetDigest: string;
  readonly lexicalNamespaceId: string;
  /** Derived digest over the whole canonical manifest body; changes with any section or identity. */
  readonly packDigest: string;
  readonly profiles: readonly BrowserPackProfileDescriptor[];
  readonly sections: readonly BrowserPackSectionDescriptor[];
  readonly runtimeContract: { readonly schemaVersion: string; readonly externalOffsetUnit: string };
  /** v3 semantic identity locks required by #208 §14. */
  readonly symbolRegistry?: { readonly generation: number; readonly digest: string };
  readonly ruleRuntime?: { readonly isaVersion: string; readonly compilerVersion: string; readonly programFormatVersion: string; readonly programDigest: string };
  readonly evidence?: { readonly schemaVersion: string; readonly aggregateDigest: string };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as object).sort(cmp).map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]));
  return value;
};

/** `kind` plus whatever makes the section distinct; never author-chosen, so renames cannot hide. */
export function browserPackSectionId(kind: BrowserPackSectionKind, keys: { shard?: BrowserPackShardDescriptor | undefined; profileId?: string | undefined }): string {
  if (keys.shard !== undefined && keys.profileId !== undefined) throw new Error(`section ${kind} cannot be both sharded and profile-scoped`);
  if (keys.shard !== undefined) return `${kind}@${keys.shard.key}/${keys.shard.index}`;
  if (keys.profileId !== undefined) return `${kind}@${keys.profileId}`;
  return kind;
}

/** Canonical form: sorted keys, sections by id, profiles by id. Input ordering never matters. */
export function canonicalizeBrowserPackManifest(manifest: BrowserPackManifestV1): BrowserPackManifestV1 {
  const sections = [...manifest.sections].sort((a, b) => cmp(a.sectionId, b.sectionId));
  const profiles = [...manifest.profiles].sort((a, b) => cmp(a.profileId, b.profileId));
  return sortKeys({ ...manifest, sections, profiles }) as BrowserPackManifestV1;
}

export function serializeBrowserPackManifest(manifest: BrowserPackManifestV1): string {
  return `${JSON.stringify(canonicalizeBrowserPackManifest(manifest), null, 2)}\n`;
}

/** The pack's identity: a digest over the canonical body with `packDigest` itself excluded. */
export function browserPackIdentity(manifest: BrowserPackManifestV1): string {
  const { packDigest: _ignored, ...body } = canonicalizeBrowserPackManifest(manifest) as BrowserPackManifestV1 & Record<string, unknown>;
  return createHash('sha256').update(JSON.stringify(sortKeys(body))).digest('hex');
}

export function sealBrowserPackManifest(input: Omit<BrowserPackManifestV1, 'packDigest'> & { packDigest?: string | undefined }): BrowserPackManifestV1 {
  const unsealed = { ...input, packDigest: '' } as BrowserPackManifestV1;
  return canonicalizeBrowserPackManifest({ ...unsealed, packDigest: browserPackIdentity(unsealed) });
}

const HEX64 = /^[0-9a-f]{64}$/u;

function assertDigest(value: unknown, label: string): void {
  if (typeof value !== 'string' || !HEX64.test(value)) throw new Error(`${label} must be a sha256 hex digest`);
}

function assertShard(section: BrowserPackSectionDescriptor, spec: BrowserPackSectionKindSpec): void {
  const { shard } = section;
  if (shard === undefined) return;
  if (!spec.shardable) throw new Error(`section ${section.sectionId}: kind ${section.kind} is not shardable`);
  if (!Number.isInteger(shard.count) || shard.count < 1) throw new Error(`section ${section.sectionId}: shard count must be a positive integer`);
  if (!Number.isInteger(shard.index) || shard.index < 0 || shard.index >= shard.count) throw new Error(`section ${section.sectionId}: shard index out of its shard set`);
  if (cmp(shard.from, shard.to) > 0) throw new Error(`section ${section.sectionId}: shard range from/to is inverted`);
}

/** Each kind+key shard set must be index-complete and its ranges ordered and non-overlapping. */
function assertShardSets(sections: readonly BrowserPackSectionDescriptor[]): void {
  const sets = new Map<string, BrowserPackSectionDescriptor[]>();
  for (const section of sections) {
    if (section.shard === undefined) continue;
    const key = `${section.kind}@${section.shard.key}`;
    const list = sets.get(key) ?? [];
    list.push(section);
    sets.set(key, list);
  }
  for (const [key, list] of sets) {
    const count = list[0]!.shard!.count;
    const indexes = list.map((s) => s.shard!.index).sort((a, b) => a - b);
    if (list.some((s) => s.shard!.count !== count)) throw new Error(`shard set ${key}: members disagree on shard count`);
    if (indexes.length !== count || indexes.some((index, at) => index !== at)) throw new Error(`shard set ${key}: expected indexes 0..${count - 1}, found ${indexes.join(',')}`);
    const ordered = [...list].sort((a, b) => a.shard!.index - b.shard!.index);
    for (let at = 1; at < ordered.length; at += 1) {
      if (cmp(ordered[at]!.shard!.from, ordered[at - 1]!.shard!.to) <= 0) throw new Error(`shard set ${key}: shard range ${at} overlaps its predecessor`);
    }
  }
}

function assertRequires(sections: readonly BrowserPackSectionDescriptor[]): void {
  const byId = new Map(sections.map((s) => [s.sectionId, s]));
  for (const section of sections) {
    for (const required of section.requires ?? []) {
      const target = byId.get(required);
      if (target === undefined) throw new Error(`section ${section.sectionId} requires unknown section ${required}`);
      if (target.sectionId === section.sectionId) throw new Error(`section ${section.sectionId} requires itself`);
      const spec = BROWSER_PACK_SECTION_KINDS[target.kind];
      const own = BROWSER_PACK_SECTION_KINDS[section.kind];
      // availability may only strengthen along a dependency: nothing may be unopenable because
      // something less available than itself has not arrived yet
      if (LOADING_STRENGTH[spec.loading] > LOADING_STRENGTH[own.loading]) {
        throw new Error(`${own.loading} section ${section.sectionId} may not require ${spec.loading} section ${required}`);
      }
      // and knowledge stays profile-neutral by construction, whatever the load order
      if (own.contentClass === 'knowledge' && spec.contentClass === 'profile') {
        throw new Error(`knowledge section ${section.sectionId} may not require profile section ${required}`);
      }
    }
  }
  const state = new Map<string, 'open' | 'done'>();
  const walk = (id: string): void => {
    const at = state.get(id);
    if (at === 'done') return;
    if (at === 'open') throw new Error(`section requires cycle at ${id}`);
    state.set(id, 'open');
    for (const required of byId.get(id)!.requires ?? []) walk(required);
    state.set(id, 'done');
  };
  for (const section of sections) walk(section.sectionId);
}

export function validateBrowserPackManifest(manifest: unknown): BrowserPackManifestV1 {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('manifest must be an object');
  const candidate = manifest as BrowserPackManifestV1;
  if (candidate.schemaVersion !== BROWSER_PACK_SCHEMA_VERSION) throw new Error(`unsupported schemaVersion ${String(candidate.schemaVersion)}`);
  if (candidate.kind !== BROWSER_PACK_MANIFEST_KIND) throw new Error(`unsupported manifest kind ${String(candidate.kind)}`);
  if (![BROWSER_PACK_COMPILER_VERSION, BROWSER_PACK_V2_COMPILER_VERSION, BROWSER_PACK_V3_COMPILER_VERSION].includes(candidate.compilerVersion)) throw new Error(`unsupported compiler version ${String(candidate.compilerVersion)}`);
  assertDigest(candidate.canonicalGraphSha256, 'canonicalGraphSha256');
  assertDigest(candidate.sourceSetDigest, 'sourceSetDigest');
  if (typeof candidate.lexicalNamespaceId !== 'string' || candidate.lexicalNamespaceId === '') throw new Error('lexicalNamespaceId must be a non-empty string');
  if (candidate.runtimeContract?.schemaVersion !== BROWSER_PACK_SCHEMA_VERSION) throw new Error(`unsupported runtime contract schemaVersion ${String(candidate.runtimeContract?.schemaVersion)}`);
  if (candidate.runtimeContract.externalOffsetUnit !== BROWSER_PACK_EXTERNAL_OFFSET_UNIT) throw new Error(`unsupported external offset unit ${String(candidate.runtimeContract.externalOffsetUnit)}`);
  if (candidate.compilerVersion === BROWSER_PACK_V3_COMPILER_VERSION) {
    const registry = candidate.symbolRegistry;
    if (!registry || !Number.isInteger(registry.generation) || registry.generation < 1) throw new Error('symbol registry identity must declare a positive generation');
    assertDigest(registry.digest, 'symbol registry identity digest');
    const ruleRuntime = candidate.ruleRuntime;
    if (!ruleRuntime || typeof ruleRuntime.isaVersion !== 'string' || ruleRuntime.isaVersion === '' || typeof ruleRuntime.compilerVersion !== 'string' || ruleRuntime.compilerVersion === '' || typeof ruleRuntime.programFormatVersion !== 'string' || ruleRuntime.programFormatVersion === '') throw new Error('rule runtime identity must declare ISA, compiler, and program-format versions');
    assertDigest(ruleRuntime.programDigest, 'rule runtime program digest');
    const evidence = candidate.evidence;
    if (!evidence || evidence.schemaVersion !== '1') throw new Error('evidence identity must declare schemaVersion 1');
    assertDigest(evidence.aggregateDigest, 'evidence identity aggregate digest');
  } else if (candidate.symbolRegistry !== undefined || candidate.ruleRuntime !== undefined || candidate.evidence !== undefined) {
    throw new Error(`v3 identity locks are not part of compiler version ${candidate.compilerVersion}`);
  }
  if (!Array.isArray(candidate.sections) || candidate.sections.length === 0) throw new Error('manifest must declare sections');
  if (!Array.isArray(candidate.profiles) || candidate.profiles.length === 0) throw new Error('manifest must declare at least one profile');

  const seen = new Set<string>();
  const paths = new Set<string>();
  // `Array.isArray` above widens these to `any[]`, so re-state the element type we are checking
  const declared: readonly BrowserPackSectionDescriptor[] = candidate.sections;
  for (const section of declared) {
    const spec = BROWSER_PACK_SECTION_KINDS[section.kind] as BrowserPackSectionKindSpec | undefined;
    if (spec === undefined) throw new Error(`unknown section kind ${String(section.kind)}`);
    if (section.encoding !== spec.encoding) throw new Error(`section ${section.sectionId}: kind ${section.kind} uses encoding ${spec.encoding}, not ${String(section.encoding)}`);
    if (section.loading !== spec.loading) throw new Error(`section ${section.sectionId}: kind ${section.kind} has loading class ${spec.loading}, not ${String(section.loading)}`);
    if (spec.profileScoped && section.profileId === undefined) throw new Error(`section ${section.sectionId}: kind ${section.kind} must be profile-scoped`);
    if (!spec.profileScoped && section.profileId !== undefined) throw new Error(`section ${section.sectionId} is profile-scoped, but ${section.kind} sections are shared by every profile`);
    assertShard(section, spec);
    const expected = browserPackSectionId(section.kind, { shard: section.shard, profileId: section.profileId });
    if (section.sectionId !== expected) throw new Error(`section id ${String(section.sectionId)} does not match its derived identity ${expected}`);
    if (seen.has(section.sectionId)) throw new Error(`duplicate section ${section.sectionId}`);
    seen.add(section.sectionId);
    if (typeof section.path !== 'string' || section.path === '' || section.path.startsWith('/') || section.path.includes('..')) throw new Error(`section ${section.sectionId}: path must be a relative pack path`);
    // two sections sharing one file would make a cache entry ambiguous and one of the two digests
    // wrong; reject it here rather than discovering it as corruption at fetch time
    if (paths.has(section.path)) throw new Error(`duplicate section path ${section.path}`);
    paths.add(section.path);
    if (!Number.isInteger(section.byteLength) || section.byteLength < 0) throw new Error(`section ${section.sectionId}: byteLength must be a non-negative integer`);
    assertDigest(section.sha256, `section ${section.sectionId} sha256`);
    if (section.rowCount !== undefined && (!Number.isInteger(section.rowCount) || section.rowCount < 0)) throw new Error(`section ${section.sectionId}: rowCount must be a non-negative integer`);
  }
  const required = requiredSectionKinds(candidate.compilerVersion);
  for (const section of declared) {
    if (!required.includes(section.kind)) throw new Error(`section kind ${section.kind} is not part of compiler version ${candidate.compilerVersion}`);
  }
  for (const kind of required) {
    if (!candidate.sections.some((section) => section.kind === kind)) throw new Error(`missing required section kind ${kind}`);
  }
  assertShardSets(candidate.sections);
  assertRequires(candidate.sections);

  const policies = new Map(candidate.sections.filter((s) => s.kind === 'profile-policy').map((s) => [s.sectionId, s]));
  const claimed = new Set<string>();
  const profileIds = new Set<string>();
  for (const profile of candidate.profiles) {
    if (typeof profile.profileId !== 'string' || profile.profileId === '') throw new Error('profileId must be a non-empty string');
    if (profileIds.has(profile.profileId)) throw new Error(`duplicate profile ${profile.profileId}`);
    profileIds.add(profile.profileId);
    assertDigest(profile.profileDigest, `profile ${profile.profileId} profileDigest`);
    const policy = policies.get(profile.policySectionId);
    if (policy === undefined) throw new Error(`profile ${profile.profileId}: policy section ${String(profile.policySectionId)} is not a profile-policy section of this pack`);
    if (policy.profileId !== profile.profileId) throw new Error(`profile ${profile.profileId}: policy section ${policy.sectionId} belongs to another profile`);
    if (claimed.has(policy.sectionId)) throw new Error(`policy section ${policy.sectionId} is claimed by more than one profile`);
    claimed.add(policy.sectionId);
  }
  for (const sectionId of policies.keys()) {
    if (!claimed.has(sectionId)) throw new Error(`unreferenced profile-policy section ${sectionId}`);
  }

  assertDigest(candidate.packDigest, 'packDigest');
  const canonical = canonicalizeBrowserPackManifest(candidate);
  if (browserPackIdentity(canonical) !== candidate.packDigest) throw new Error('pack digest mismatch: the manifest body does not hash to its declared packDigest');
  return canonical;
}

/**
 * Source lock on the bodies. An `on-demand` or `lazy` section may legitimately be absent — that is
 * the point of demand loading; an `eager` one may not, a mismatching one is corruption, and an
 * unlisted one is a version mix. Nothing here combines sections across two pack identities. Whether
 * the *particular* on-demand shards an input needs are present is a conversion-time question that
 * unit D answers against the shard directory; it cannot be decided from the manifest alone.
 */
export function verifyBrowserPackSections(manifest: BrowserPackManifestV1, bodies: ReadonlyMap<string, Uint8Array>): void {
  const byId = new Map(manifest.sections.map((s) => [s.sectionId, s]));
  for (const sectionId of bodies.keys()) {
    if (!byId.has(sectionId)) throw new Error(`unknown section ${sectionId} is not declared by pack ${manifest.packDigest}`);
  }
  for (const section of manifest.sections) {
    const bytes = bodies.get(section.sectionId);
    if (bytes === undefined) {
      if (section.loading === 'eager') throw new Error(`missing eager section ${section.sectionId}`);
      continue;
    }
    if (bytes.byteLength !== section.byteLength) throw new Error(`section ${section.sectionId}: byte length ${bytes.byteLength} does not match the declared ${section.byteLength}`);
    if (createHash('sha256').update(bytes).digest('hex') !== section.sha256) throw new Error(`section ${section.sectionId}: digest mismatch`);
  }
}

// ---------------------------------------------------------------------------
// Width model
//
// #184 §1.4 selects a simple reviewable binary design — string pool, numeric row ids, packed
// columnar arrays sized by cardinality. These two functions are that policy made executable, so the
// unit-A measurements and the unit-B compiler cannot drift apart on what a section costs.

export type BrowserPackElementWidth = 1 | 2 | 4;

export interface BrowserPackColumnShape {
  readonly name: string;
  readonly width: BrowserPackElementWidth;
  /** Total elements across every row, for a variable-length list column. */
  readonly elements?: number | undefined;
}

const OFFSET_WIDTH = 4;

/** Narrowest unsigned width that can hold `maxValue` (a row id, enum ordinal or count). */
export function chooseElementWidth(maxValue: number): BrowserPackElementWidth {
  if (!Number.isInteger(maxValue) || maxValue < 0 || maxValue > 0xff_ff_ff_ff) throw new Error(`value cardinality ${maxValue} is outside the addressable range 0..4294967295`);
  if (maxValue <= 0xff) return 1;
  if (maxValue <= 0xff_ff) return 2;
  return 4;
}

/** Bytes for one section: scalar columns are dense rows, list columns add a u32 offset array. */
export function sectionByteLength(rowCount: number, columns: readonly BrowserPackColumnShape[]): number {
  if (!Number.isInteger(rowCount) || rowCount < 0) throw new Error(`rowCount ${rowCount} must be a non-negative integer`);
  let bytes = 0;
  for (const column of columns) {
    if (column.width !== 1 && column.width !== 2 && column.width !== 4) throw new Error(`column ${column.name}: unsupported element width ${String(column.width)}`);
    if (column.elements === undefined) {
      bytes += rowCount * column.width;
      continue;
    }
    if (!Number.isInteger(column.elements) || column.elements < 0) throw new Error(`column ${column.name}: elements must be a non-negative integer`);
    bytes += (rowCount + 1) * OFFSET_WIDTH + column.elements * column.width;
  }
  return bytes;
}

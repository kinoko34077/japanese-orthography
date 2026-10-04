import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadJmdictIntake } from './jmdict-intake.ts';
import { lexemeKeys } from './jmdict-lexical-graph.ts';
import { SINO_MECHANISM_RULES } from './sino-rule-normalization.ts';
import { KANA_CONVENTION_RULES, KANA_CONVENTIONS_SOURCE } from './kana-rule-normalization.ts';
import {
  accountSourceRecords,
  canonicalizeOrthographyKnowledge,
  MIGRATION_DISPOSITIONS,
  type MigrationDisposition,
  type OrthographyFact,
  type OrthographyFactKind,
  type OrthographyKnowledgeGraph,
  type OrthographyRule,
  type OrthographyRuleBinding
} from './orthography-knowledge-model.ts';

// ARCH-V2 B (#166): source adapters from the accepted libraries/snapshots into the v2 canonical
// knowledge graph. Source files are only read; they remain the provenance roots. Every record an
// adapter enumerates gets exactly one disposition. Records that are not a justified reusable
// pattern stay literal facts. Ledger record ids are `<source path without data/ and .json>#<local id>`.

export interface NormalizationResult {
  graph: OrthographyKnowledgeGraph;
  accounting: {
    inputRecords: number;
    disposedRecords: number;
    bySource: Record<string, Record<MigrationDisposition, number>>;
    unaccounted: string[];
  };
}

type Json = Record<string, any>;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

class GraphBuilder {
  readonly sources = new Map<string, Json>();
  readonly facts = new Map<string, OrthographyFact>();
  readonly rules = new Map<string, OrthographyRule>();
  readonly bindings = new Map<string, OrthographyRuleBinding>();
  readonly dispositions: { sourceRecordId: string; disposition: MigrationDisposition; targetIds: string[]; reason?: string }[] = [];
  readonly enumerated: string[] = [];

  source(sourceId: string, meta: Json) {
    if (!this.sources.has(sourceId)) this.sources.set(sourceId, { sourceId, ...meta });
    return sourceId;
  }

  /** The adapter declares every record it read before deciding its disposition. */
  record(sourceId: string, localId: string) {
    const id = `${sourceId}#${localId}`;
    this.enumerated.push(id);
    return id;
  }

  private mergeRefs<T extends { sourceRefs: string[]; evidenceRefs: string[] }>(target: T, sourceId: string, evidence: string[]) {
    target.sourceRefs = [...new Set([...target.sourceRefs, sourceId])];
    target.evidenceRefs = [...new Set([...target.evidenceRefs, ...evidence])];
  }

  // Text equality is not always assertion identity (#250 R1). Callers supply assertionKey only
  // where source-scoped metadata/provenance would otherwise smear across lexical assertions.
  fact(spec: { kind: OrthographyFactKind; surface?: string; reading?: string; basisReading?: string | undefined; displayPriority?: string[] | undefined; target?: string; lexicalRefs?: string[]; tags?: string[] | undefined; periodRefs?: string[]; assertionKey?: string | undefined; origin?: 'project_defined' }, sourceId: string, evidence: string[]) {
    const baseId = `fact:${spec.kind}:${spec.surface ?? ''}|${spec.reading ?? ''}|${spec.target ?? ''}`;
    const id = spec.assertionKey ? `${baseId}|@${spec.assertionKey}` : baseId;
    let fact = this.facts.get(id);
    if (!fact) {
      fact = {
        id, kind: spec.kind, lexicalRefs: [], sourceRefs: [], evidenceRefs: [],
        ...(spec.surface !== undefined ? { surface: spec.surface } : {}),
        ...(spec.reading !== undefined ? { reading: spec.reading } : {}),
        ...(spec.basisReading !== undefined ? { basisReading: spec.basisReading } : {}),
        ...(spec.displayPriority?.length ? { displayPriority: [...new Set(spec.displayPriority)] } : {}),
        ...(spec.target !== undefined ? { target: spec.target } : {})
      };
      this.facts.set(id, fact);
    } else if (spec.basisReading !== undefined && fact.basisReading !== undefined && fact.basisReading !== spec.basisReading) {
      throw new Error(`conflicting basisReading for ${id}: ${fact.basisReading} / ${spec.basisReading}`);
    }
    this.mergeRefs(fact, sourceId, evidence);
    if (spec.basisReading !== undefined) fact.basisReading = spec.basisReading;
    if (spec.displayPriority?.length) fact.displayPriority = [...new Set([...(fact.displayPriority ?? []), ...spec.displayPriority])];
    fact.lexicalRefs = [...new Set([...fact.lexicalRefs, ...(spec.lexicalRefs ?? [])])];
    if (spec.tags?.length) fact.tags = [...new Set([...(fact.tags ?? []), ...spec.tags])];
    if (spec.origin) fact.origin = spec.origin;
    if (spec.periodRefs?.length) fact.periodRefs = [...new Set([...(fact.periodRefs ?? []), ...spec.periodRefs])];
    return id;
  }

  rule(spec: Omit<OrthographyRule, 'sourceRefs' | 'evidenceRefs'>, sourceId: string, evidence: string[]) {
    let rule = this.rules.get(spec.id);
    if (!rule) { rule = { ...spec, sourceRefs: [], evidenceRefs: [] }; this.rules.set(spec.id, rule); }
    else if (JSON.stringify([rule.class, rule.from, rule.to, rule.lossiness, rule.directionality]) !== JSON.stringify([spec.class, spec.from, spec.to, spec.lossiness, spec.directionality])) {
      throw new Error(`conflicting definitions for ${spec.id}`);
    }
    this.mergeRefs(rule, sourceId, evidence);
    return spec.id;
  }

  binding(spec: { id: string; ruleId: string; lexicalRefs: string[]; contextRefs?: string[] }, sourceId: string, evidence: string[]) {
    let binding = this.bindings.get(spec.id);
    if (!binding) {
      binding = { id: spec.id, ruleId: spec.ruleId, lexicalRefs: [...spec.lexicalRefs], ...(spec.contextRefs?.length ? { contextRefs: [...spec.contextRefs] } : {}), sourceRefs: [], evidenceRefs: [] };
      this.bindings.set(spec.id, binding);
    }
    this.mergeRefs(binding, sourceId, evidence);
    return spec.id;
  }

  dispose(recordId: string, disposition: MigrationDisposition, targetIds: string[] = [], reason?: string) {
    this.dispositions.push({ sourceRecordId: recordId, disposition, targetIds: [...new Set(targetIds)], ...(reason ? { reason } : {}) });
  }
}

const readJson = async (rootDir: string, path: string) => JSON.parse(await readFile(resolve(rootDir, path), 'utf8')) as Json;
const sourceIdFor = (path: string) => path.replace(/^data\//, '').replace(/\.json$/, '');
// a record's own evidence refs; the record id is the fallback (the ledger already links id -> target)
const evidenceOf = (record: Json, recordId: string) => (Array.isArray(record.evidenceRefs) && record.evidenceRefs.length ? [...record.evidenceRefs] : [recordId]);
const HISTORICAL = ['period:historical-kana'];
const MODERN = ['period:modern'];

const INTAKE_FILES = ['phase46b-character-form', 'phase46c-homophone-rewrite', 'phase46d-native-kana', 'phase46e-sino-kana', 'phase46-legacy-safety', 'phase46f-kinotch-profile'];

export async function normalizeAcceptedOrthographySources(rootDir: string): Promise<NormalizationResult> {
  const b = new GraphBuilder();

  // --- JMdict (Phase 4.8A pinned lexical source): forms and restriction-respecting readings -------
  const { extract, accounting: jmAccounting } = await loadJmdictIntake(rootDir);
  const jm = b.source(`jmdict/${jmAccounting.createdDate}`, { path: 'data/lexical/sources/jmdict/2026-10-01', license: 'CC-BY-SA-4.0', role: 'lexical-identity' });
  const keys = lexemeKeys(extract);
  const lexemesByForm = new Map<string, string[]>();
  const formOwners = new Map<string, Set<string>>();
  const readingOwners = new Map<string, Set<string>>();
  const modernReadingsByForm = new Map<string, Set<string>>();
  const lexemesByFormReading = new Map<string, Set<string>>();
  const addOwner = (index: Map<string, Set<string>>, key: string, lexeme: string) => {
    const set = index.get(key) ?? new Set<string>();
    set.add(lexeme);
    index.set(key, set);
  };
  for (const entry of extract) {
    const lexeme = `lexeme:${keys.get(entry.seq)!}`;
    for (const k of entry.k ?? []) {
      lexemesByForm.set(k.t, [...(lexemesByForm.get(k.t) ?? []), lexeme]);
      addOwner(formOwners, k.t, lexeme);
      for (const r of entry.r) {
        if (r.nokanji || (r.restr && !r.restr.includes(k.t))) continue;
        const key = `${k.t}\u0000${r.t}`;
        addOwner(readingOwners, key, lexeme);
        addOwner(lexemesByFormReading, key, lexeme);
        const readings = modernReadingsByForm.get(k.t) ?? new Set<string>();
        readings.add(r.t);
        modernReadingsByForm.set(k.t, readings);
      }
    }
    if (!entry.k?.length) for (const r of entry.r) addOwner(readingOwners, `\u0000${r.t}`, lexeme);
  }
  const lexicalRefsFor = (form: string | undefined) => (form ? lexemesByForm.get(form) ?? [] : []);
  const lexicalRefsForReading = (form: string | undefined, reading: string | undefined) =>
    form && reading ? [...(lexemesByFormReading.get(`${form}\u0000${reading}`) ?? [])] : [];
  const soleModernReading = (form: string | undefined) => {
    const readings = form ? modernReadingsByForm.get(form) : undefined;
    return readings?.size === 1 ? [...readings][0] : undefined;
  };
  const historicalAssertionKey = (form: string | undefined, reading: string, basisReading: string | undefined) =>
    basisReading !== undefined || Boolean(form && modernReadingsByForm.get(form)?.has(reading))
      ? `historical:${basisReading ?? 'unbound'}`
      : undefined;

  for (const entry of extract) {
    const recordId = b.record(jm, String(entry.seq));
    const lexeme = `lexeme:${keys.get(entry.seq)!}`;
    const evidence = [`jmdict:${jmAccounting.createdDate}:seq:${entry.seq}`];
    const targets: string[] = [];
    for (const k of entry.k ?? []) {
      const formAssertion = (formOwners.get(k.t)?.size ?? 0) > 1 ? `jmdict-form:${lexeme}` : undefined;
      targets.push(b.fact({ kind: 'literal_form', surface: k.t, lexicalRefs: [lexeme], tags: k.inf, periodRefs: MODERN, assertionKey: formAssertion }, jm, evidence));
      for (const r of entry.r) {
        if (r.nokanji || (r.restr && !r.restr.includes(k.t))) continue;
        const readingAssertion = (readingOwners.get(`${k.t}\u0000${r.t}`)?.size ?? 0) > 1 ? `jmdict-reading:${lexeme}` : undefined;
        targets.push(b.fact({ kind: 'literal_reading', surface: k.t, reading: r.t, lexicalRefs: [lexeme], displayPriority: r.pri, periodRefs: MODERN, assertionKey: readingAssertion }, jm, evidence));
      }
    }
    if (!entry.k?.length) for (const r of entry.r) {
      const readingAssertion = (readingOwners.get(`\u0000${r.t}`)?.size ?? 0) > 1 ? `jmdict-reading:${lexeme}` : undefined;
     targets.push(b.fact({ kind: 'literal_reading', reading: r.t, lexicalRefs: [lexeme], tags: r.inf, displayPriority: r.pri, periodRefs: MODERN, assertionKey: readingAssertion }, jm, evidence));
    }
    b.dispose(recordId, 'literal_fact', targets);
  }

  // --- Phase-4.6 intake (record-level authority over the pinned raw sources) --------------------
  for (const file of INTAKE_FILES) {
    const path = `data/intake/${file}.json`;
    const sourceId = b.source(sourceIdFor(path), { path, role: 'phase46-intake' });
    for (const r of (await readJson(rootDir, path)).records as Json[]) {
      const recordId = b.record(sourceId, r.id);
      const evidence = evidenceOf(r, r.id);
      if (r.disposition === 'excluded_unresolved') { b.dispose(recordId, 'excluded_with_reason', [], `phase46 intake excluded: ${r.exclusionReason ?? 'excluded_unresolved'}`); continue; }
      if (file === 'phase46f-kinotch-profile') {
        // KiNoTch consumer rules: generic reclassification requires a bounded provenance review (#163 §15, #47)
        b.dispose(recordId, 'profile_policy', [`profile:kinotch:${r.responsibility}`], `KiNoTch profile rule (${r.responsibility}); not generic authority until reviewed under #47`);
        continue;
      }
      if (file === 'phase46b-character-form') {
        const ruleId = b.rule({ id: `rule:char:${r.historicalSurface}>${r.modernSurface}`, class: 'orthographic', directionality: 'reverse_traversable', lossiness: 'lossless', from: [r.historicalSurface], to: [r.modernSurface], dependencies: [], predicate: { channel: 'surface' } }, sourceId, evidence);
        b.dispose(recordId, 'rule_definition', [ruleId]);
        continue;
      }
      if (file === 'phase46e-sino-kana') {
        const ruleId = b.rule({ id: `rule:sino:${r.historicalReading}>${r.modernReading}`, class: 'diachronic', directionality: 'reverse_traversable', lossiness: 'lossless', from: [r.historicalReading], to: [r.modernReading], dependencies: [], predicate: { channel: 'reading' } }, sourceId, evidence);
        const usage = r.morphology?.usage as string | undefined;
        const bindingId = b.binding({ id: `binding:sino:${r.modernSurface}:${r.historicalReading}>${r.modernReading}@${usage ?? 'none'}`, ruleId, lexicalRefs: [`symbol:${r.modernSurface}`], ...(usage ? { contextRefs: [`context:usage:${usage}`] } : {}) }, sourceId, evidence);
        b.dispose(recordId, 'rule_binding', [bindingId]);
        continue;
      }
      // lexical / native / merged-character records: literal facts (no unsupported generalisation)
      const candidate = r.disposition !== 'admitted';
      const tags = [r.responsibility, ...(candidate ? ['candidate'] : [])];
      const lexicalRefs = lexicalRefsFor(r.modernSurface);
      const targets: string[] = [];
      const basisReading = typeof r.modernReading === 'string' && r.modernReading ? r.modernReading : soleModernReading(r.modernSurface);
      const readingRefs = basisReading ? lexicalRefsForReading(r.modernSurface, basisReading) : [];
      if (r.historicalReading) targets.push(b.fact({
        kind: 'literal_reading', surface: r.modernSurface, reading: r.historicalReading, basisReading,
        lexicalRefs: readingRefs, tags, periodRefs: HISTORICAL,
        assertionKey: historicalAssertionKey(r.modernSurface, r.historicalReading, basisReading)
      }, sourceId, evidence));
      if (r.historicalSurface) targets.push(b.fact({ kind: 'form_relation', surface: r.historicalSurface, target: r.modernSurface, lexicalRefs, tags, periodRefs: HISTORICAL }, sourceId, evidence));
      for (const alt of r.alternatives ?? []) {
        if (file === 'phase46d-native-kana' && r.sourceRef !== 'phase46d-kkh-kana') {
          targets.push(b.fact({
            kind: 'literal_reading', surface: r.modernSurface, reading: alt, basisReading,
            lexicalRefs: readingRefs, tags: [...tags, 'candidate'], periodRefs: HISTORICAL,
            assertionKey: historicalAssertionKey(r.modernSurface, alt, basisReading)
          }, sourceId, evidence));
        } else {
          targets.push(b.fact({ kind: 'form_relation', surface: alt, target: r.modernSurface, lexicalRefs, tags: [...tags, 'candidate'], periodRefs: HISTORICAL }, sourceId, evidence));
        }
      }
      if (targets.length === 0) throw new Error(`${recordId}: admitted record carries no orthographic payload`);
      b.dispose(recordId, 'literal_fact', targets);
    }
  }

  // --- 字音 in-word derivation conventions (accepted Phase-4.6E runtime) as first-class rules ----
  {
    const sourceId = b.source('derivation/phase46e-sino-conventions', { path: 'runtime/historical-sino-runtime.js', role: 'derivation-convention', owner: 'japanese-orthography#168' });
    for (const rule of SINO_MECHANISM_RULES) {
      const recordId = b.record(sourceId, rule.id.slice('rule:sino-mech:'.length));
      const { sourceRefs, evidenceRefs, ...spec } = rule;
      b.dispose(recordId, 'rule_definition', [b.rule(spec, sourceId, evidenceRefs)]);
    }
  }

  // --- kana / presentation conventions (Phase 4.7B behaviour, modern kana orthography) ----------
  {
    const sourceId = b.source(KANA_CONVENTIONS_SOURCE, { path: 'tools/kana-rule-normalization.ts', role: 'derivation-convention', owner: 'japanese-orthography#169' });
    for (const rule of KANA_CONVENTION_RULES) {
      const recordId = b.record(sourceId, rule.id.slice(rule.id.indexOf(':') + 1));
      const { sourceRefs, evidenceRefs, ...spec } = rule;
      b.dispose(recordId, 'rule_definition', [b.rule(spec, sourceId, evidenceRefs)]);
    }
  }

  // --- deterministic safe-character slice (Phase 2D): same rules as 4.6B, separate provenance -----
  {
    const path = 'data/deterministic/safe-character-first-slice.json';
    const sourceId = b.source(sourceIdFor(path), { path, role: 'safe-character-slice' });
    const slice = await readJson(rootDir, path);
    for (const m of slice.mappings as Json[]) {
      const recordId = b.record(sourceId, m.modern);
      const ruleId = b.rule({ id: `rule:char:${m.historical}>${m.modern}`, class: 'orthographic', directionality: 'reverse_traversable', lossiness: 'lossless', from: [m.historical], to: [m.modern], dependencies: [], predicate: { channel: 'surface' } }, sourceId, evidenceOf(m, recordId));
      b.dispose(recordId, 'rule_definition', [ruleId]);
    }
    for (const x of slice.exclusionRecords as Json[]) {
      b.dispose(b.record(sourceId, `exclusion:${x.modern}`), 'excluded_with_reason', [], x.reason);
    }
  }

  // --- KKH first slices and the 4.6E identity slice --------------------------------------------
  const kkhSlice = async (path: string, sourceId: string, slice: Json) => {
    for (const r of slice.sourceRecords as Json[]) {
      const recordId = b.record(sourceId, r.id);
      if (!r.enabled) { b.dispose(recordId, 'excluded_with_reason', [], 'disabled upstream source line'); continue; }
      const evidence = [`kkh:${r.file}:${r.raw}`];
      const targets: string[] = [];
      if (r.historicalSurface) targets.push(b.fact({ kind: 'form_relation', surface: r.historicalSurface, target: r.surface, lexicalRefs: lexicalRefsFor(r.surface), tags: ['kkh'], periodRefs: HISTORICAL }, sourceId, evidence));
      if (r.historicalReading) {
        const basisReading = typeof r.modernReading === 'string' && r.modernReading ? r.modernReading : undefined;
        const wholeWord = basisReading !== undefined;
        targets.push(b.fact({
          kind: 'literal_reading', surface: r.surface, reading: r.historicalReading, basisReading,
          lexicalRefs: wholeWord ? lexicalRefsForReading(r.surface, basisReading) : [],
          tags: [wholeWord ? 'whole-word' : 'component-jion'], periodRefs: HISTORICAL,
          assertionKey: historicalAssertionKey(r.surface, r.historicalReading, basisReading)
        }, sourceId, evidence));
      }
      b.dispose(recordId, 'literal_fact', targets);
    }
    for (const r of (slice.projectEvidenceRecords ?? []) as Json[]) {
      const recordId = b.record(sourceId, r.id);
      const evidence = [`${r.repository}#${r.issueNumber}:comment-${r.commentId}`];
      const targets = Object.entries(r.modernComponentReadings ?? {}).map(([surface, reading]) =>
        b.fact({ kind: 'literal_reading', surface, reading: reading as string, tags: ['project-canonical-component'], periodRefs: MODERN, origin: 'project_defined' }, sourceId, evidence));
      b.dispose(recordId, 'literal_fact', targets);
    }
    (slice.relations ?? []).forEach((rel: Json, i: number) => {
      b.dispose(b.record(sourceId, `relation:${i}:${rel.surface}`), 'derived_only', [], 'project join of the slice source records to UniDic identity; no independent authority');
    });
    return path;
  };
  for (const path of ['data/historical/native/kkh-kana-first-slice.json', 'data/historical/sino/kkh-jion-first-slice.json']) {
    await kkhSlice(path, b.source(sourceIdFor(path), { path, role: 'kkh-first-slice' }), await readJson(rootDir, path));
  }
  const sinoArtifactPath = 'data/historical/sino/phase46e-sino-kana.json';
  const sinoArtifact = await readJson(rootDir, sinoArtifactPath);
  await kkhSlice(sinoArtifactPath, b.source(`${sourceIdFor(sinoArtifactPath)}#identitySlice`, { path: sinoArtifactPath, role: 'phase46e-identity-slice' }), sinoArtifact.identitySlice);

  // --- generated artifacts: derived rows with no independent authority -------------------------
  {
    const sourceId = b.source(sourceIdFor(sinoArtifactPath), { path: sinoArtifactPath, role: 'generated-artifact' });
    for (const r of sinoArtifact.componentRelations as Json[]) {
      b.dispose(b.record(sourceId, `componentRelations:${r.character}:${r.modernReading}:${r.context ?? 'none'}`), 'derived_only', [], 'generated from phase46e intake rows');
    }
    // Phase AのXLSX分類は歴史的綴りを発明しない。HTML catch-all規則と一意な分類証拠が
    // 両方ある場合だけcompact identity relationを認め、単体historical Sino runtimeと同じ
    // positive evidence gateをbrowser packでも適用できるよう生成関係をgraphへ投影する。
    const classSource = b.source('phase46e-sino-reading-class', {
      path: '仮名遣等資料/字音仮名_まとめ.xlsx', role: 'phase46e-reading-class'
    });
    for (const r of sinoArtifact.componentRelations as Json[]) {
      const evidence = (r.evidenceRefs as string[] | undefined) ?? [];
      if (!evidence.some((ref) => ref.startsWith('phase46e-sino-reading-class:'))
        || !evidence.includes('phase46e-sino-table:row:179:catch-all')
        || r.context != null || r.historicalReadings?.length !== 1
        || r.historicalReadings[0] !== r.modernReading) continue;
      const ruleId = b.rule({
        id: `rule:sino:${r.historicalReadings[0]}>${r.modernReading}`,
        class: 'diachronic', directionality: 'reverse_traversable', lossiness: 'lossless',
        from: [r.historicalReadings[0]], to: [r.modernReading], dependencies: [],
        predicate: { channel: 'reading' }
      }, classSource, evidence);
      const bindingId = b.binding({
        id: `binding:sino:${r.character}:${r.historicalReadings[0]}>${r.modernReading}@phase46e-reading-class`,
        ruleId, lexicalRefs: [`symbol:${r.character}`]
      }, classSource, evidence);
      b.dispose(b.record(classSource, `identity:${r.character}:${r.modernReading}`), 'rule_binding', [bindingId]);
    }
    const nativePath = 'data/historical/native/phase46d-native-kana.json';
    const nativeId = b.source(sourceIdFor(nativePath), { path: nativePath, role: 'generated-artifact' });
    const native = await readJson(rootDir, nativePath);
    for (const section of ['identityRelations', 'surfaceRelations', 'readingRelations', 'ambiguousSurfaceCandidates', 'ambiguousReadingCandidates']) {
      (native[section] as Json[]).forEach((r, i) => b.dispose(b.record(nativeId, `${section}:${i}:${r.surface}`), 'derived_only', [], 'generated from phase46d intake rows'));
    }
    const joinPath = 'data/historical/phase48f-lexical-authority-join.json';
    const joinId = b.source(sourceIdFor(joinPath), { path: joinPath, role: 'generated-artifact' });
    for (const row of (await readJson(rootDir, joinPath)).records as unknown[][]) {
      b.dispose(b.record(joinId, String(row[0])), 'derived_only', [], 'generated 4.8F binding of an intake record');
    }
  }

  // --- contextual-kanji packs + lexical constraints (Phase 1/2C contextual authority) -----------
  for (const pack of ['fu-family', 'homophone-rewrite', 'merged-ben', 'merged-tai']) {
    const path = `data/packs/contextual-kanji/${pack}.json`;
    const sourceId = b.source(sourceIdFor(path), { path, role: 'contextual-kanji-pack' });
    const data = await readJson(rootDir, path);
    for (const unit of data.restorationUnits as Json[]) b.dispose(b.record(sourceId, unit.id), 'derived_only', [], 'restoration unit groups relations that are dispositioned individually');
    for (const rel of data.positiveRelations as Json[]) {
      const recordId = b.record(sourceId, rel.id);
      const context = rel.lexicalConstraintSetId ? [`context:${rel.lexicalConstraintSetId}`] : [];
      b.dispose(recordId, 'literal_fact', [b.fact({ kind: 'form_relation', surface: rel.target, target: rel.match, lexicalRefs: lexicalRefsFor(rel.match), tags: ['contextual_kanji', ...context], periodRefs: HISTORICAL }, sourceId, evidenceOf(rel, recordId))]);
    }
    for (const safe of data.safetyConstraints as Json[]) {
      const recordId = b.record(sourceId, safe.id);
      const context = safe.lexicalConstraintSetId ? [`context:${safe.lexicalConstraintSetId}`] : [];
      b.dispose(recordId, 'literal_fact', [b.fact({ kind: 'form_relation', surface: safe.match, target: safe.match, lexicalRefs: lexicalRefsFor(safe.match), tags: [`safety:${safe.effect}`, ...context] }, sourceId, evidenceOf(safe, recordId))]);
    }
    for (const hint of data.reviewHints as Json[]) b.dispose(b.record(sourceId, hint.id), 'excluded_with_reason', [], `review hint (${hint.reason}); not admitted authority`);
  }
  {
    const path = 'data/lexical/constraints/contextual-kanji.json';
    const sourceId = b.source(sourceIdFor(path), { path, role: 'context-registry' });
    const data = await readJson(rootDir, path);
    for (const ev of data.lexicalEvidence as Json[]) b.dispose(b.record(sourceId, ev.id), 'derived_only', [], 'lexical-evidence registry entry referenced through contextual facts');
    for (const set of data.constraintSets as Json[]) b.dispose(b.record(sourceId, set.id), 'derived_only', [], 'context constraint set referenced as context:<id> on contextual facts');
    const bindingPath = 'data/lexical/bindings/contextual-kanji-unidic-first-slice.json';
    const bindingId = b.source(sourceIdFor(bindingPath), { path: bindingPath, role: 'context-binding' });
    const bindingFile = await readJson(rootDir, bindingPath);
    const bindings = Array.isArray(bindingFile.bindings) ? bindingFile.bindings : [bindingFile.bindings];
    bindings.forEach((entry: Json, i: number) => b.dispose(b.record(bindingId, `binding:${i}`), 'derived_only', [], 'binding of an accepted contextual relation to a UniDic identity'));
  }
  {
    const path = 'data/lexical/sources/unidic-cwj-202512-first-slice.json';
    const sourceId = b.source(sourceIdFor(path), { path, role: 'morphological-analysis-evidence' });
    ((await readJson(rootDir, path)).records as Json[]).forEach((r, i) => b.dispose(b.record(sourceId, `${i}:${r.surface}:${r.sourceLemmaId}`), 'excluded_with_reason', [], 'morphological analysis evidence consumed by span analysis (4.8D); not an orthography knowledge record'));
  }

  // --- KiNoTch profile sources: profile policy over generic knowledge ---------------------------
  {
    const dictionaries = ['homophone-kanji', 'official-homophone-restoration', 'legacy-kanji'];
    for (const name of dictionaries) {
      const path = `data/profiles/kinotch/${name}.json`;
      const sourceId = b.source(sourceIdFor(path), { path, role: 'kinotch-profile' });
      const data = await readJson(rootDir, path);
      const groups = Array.isArray(data.groups) ? data.groups : [{ id: 'root', phraseRules: data.phraseRules ?? [] }];
      for (const group of groups as Json[]) for (const rule of group.phraseRules as Json[]) {
        b.dispose(b.record(sourceId, `${group.id}:${rule.match}`), 'profile_policy', [`profile:kinotch:${name}`], `profile phrase rule selecting ${(rule.targets ?? []).join('/')}; generic reclassification requires #47 review`);
      }
    }
    const tokenPath = 'data/profiles/kinotch/token-style-overlay.json';
    const tokenId = b.source(sourceIdFor(tokenPath), { path: tokenPath, role: 'kinotch-profile' });
    for (const rule of (await readJson(rootDir, tokenPath)).rules as Json[]) b.dispose(b.record(tokenId, rule.from), 'profile_policy', ['profile:kinotch:token-style-overlay'], 'KiNoTch token style overlay');
    const legacyPath = 'data/profiles/kinotch/legacy-stage60-classification.json';
    const legacyId = b.source(sourceIdFor(legacyPath), { path: legacyPath, role: 'kinotch-legacy-classification' });
    for (const entry of (await readJson(rootDir, legacyPath)).entries as Json[]) {
      const recordId = b.record(legacyId, `${entry.from}>${entry.to}`);
      if (String(entry.bucket).startsWith('kinotch_')) b.dispose(recordId, 'profile_policy', [`profile:kinotch:${entry.bucket}`], `legacy stage-60 ${entry.bucket}`);
      else b.dispose(recordId, 'excluded_with_reason', [], `legacy stage-60 ${entry.bucket}: admission requires per-entry primary-source evidence (#47)`);
    }
  }

  const graph = canonicalizeOrthographyKnowledge({
    schemaVersion: '2',
    kind: 'japanese-orthography-knowledge-graph',
    lexicalNamespaceId: `jmdict-lexeme-contract:${jmAccounting.createdDate}`,
    sources: [...b.sources.values()],
    facts: [...b.facts.values()],
    rules: [...b.rules.values()],
    bindings: [...b.bindings.values()],
    dispositions: b.dispositions
  });

  const bySource: Record<string, Record<MigrationDisposition, number>> = {};
  for (const d of graph.dispositions) {
    const source = d.sourceRecordId.slice(0, d.sourceRecordId.indexOf('#'));
    bySource[source] ??= Object.fromEntries(MIGRATION_DISPOSITIONS.map((x) => [x, 0])) as Record<MigrationDisposition, number>;
    bySource[source]![d.disposition] += 1;
  }
  const { missing, unexpected } = accountSourceRecords(graph, b.enumerated);
  return {
    graph,
    accounting: {
      inputRecords: new Set(b.enumerated).size,
      disposedRecords: graph.dispositions.length,
      bySource: Object.fromEntries(Object.entries(bySource).sort(([a], [x]) => cmp(a, x))),
      unaccounted: [...missing, ...unexpected.map((id) => `unexpected:${id}`)]
    }
  };
}

export function assertNoSilentSourceDrop(result: NormalizationResult): void {
  const { missing, unexpected } = accountSourceRecords(result.graph, result.graph.dispositions.map((d) => d.sourceRecordId));
  const problems = [
    ...result.accounting.unaccounted,
    ...missing,
    ...unexpected,
    ...(result.accounting.inputRecords !== result.accounting.disposedRecords ? [`input ${result.accounting.inputRecords} != disposed ${result.accounting.disposedRecords}`] : []),
    ...(result.graph.dispositions.length !== result.accounting.disposedRecords ? [`ledger ${result.graph.dispositions.length} != disposed ${result.accounting.disposedRecords}`] : [])
  ];
  if (problems.length) throw new Error(`silent source drop: ${problems.slice(0, 5).join('; ')}`);
}

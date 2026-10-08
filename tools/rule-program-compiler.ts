import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { encodeSection } from './browser-pack-encoding.ts';
import { withProfileRules } from './orthography-policy.ts';
import { normalizeAcceptedOrthographySources } from './orthography-source-normalization.ts';
import { compileRuleIR, RULE_DIRECTIONS, RULE_KINDS, RULE_SCOPES, RULE_STAGES, type IRRule, type RuleIR } from './rule-ir.ts';
import { buildSequencePool } from './sequence-pool.ts';
import { SYMBOL_REGISTRY, type SymbolRegistry } from './symbol-registry.ts';

// #208 §8 / #211 E — lowering the Rule IR to compact Programs.
//
// Each IR rule becomes one Program (ProgramId = its index). Type information becomes small enums;
// texts become SequenceIds of the shared pool; lexical scopes become lexeme-set ids; predicates and
// render mechanisms become table indexes. Exact rules without any test are lowered to direct postings.
// The verifier (VM.verify) checks every operand range at build time; the evidence list keeps
// ProgramId -> IR rule -> canonical ids (split into a lazy artifact in unit G).

const require = createRequire(import.meta.url);
const { createRuleVM, OP, FLAG } = require('../runtime/rule-program-vm.js');
const { createSymbolizer } = require('../runtime/symbol-registry-runtime.js');
const { decodeSection } = require('../runtime/browser-pack-binary.js');
const { createSequencePool } = require('../runtime/sequence-pool-runtime.js');

export const RULE_PROGRAM_SUMMARY = 'data/reports/rule-program-summary.json';
export const RULE_PROGRAM_ISA_VERSION = 'rule-program-isa-v1';
export const RULE_PROGRAM_FORMAT_VERSION = 'rule-program-format-v1';
export const RULE_PROGRAM_COMPILER_VERSION = 'rule-program-compiler-v1';
export const PROFILE_IDS = ['modern', 'historical', 'kinotch-fixed'] as const;
export const CHANNELS = ['surface', 'reading'] as const;

/** Semantic identity of the Rule Program input, independent of pack sharding and section bytes. */
export function ruleProgramDigest(ir: RuleIR): string {
  return createHash('sha256').update(JSON.stringify({
    isaVersion: RULE_PROGRAM_ISA_VERSION,
    formatVersion: RULE_PROGRAM_FORMAT_VERSION,
    compilerVersion: RULE_PROGRAM_COMPILER_VERSION,
    irDigest: ir.digest
  })).digest('hex');
}

export interface CompiledPrograms {
  count: number;
  kind: number[]; stage: number[]; direction: number[]; channel: number[]; scope: number[];
  inputs: number[][]; direct: boolean[]; outputs: number[][]; flags: number[][]; code: number[][];
  evidence: Array<{ ruleId: string; canonicalIds: string[]; evidenceType: string }>;
  predicates: Array<Record<string, unknown>>;
  mechanisms: string[];
  lexemeSets: number[][];
  lexemeSetModes: Array<'all' | 'some' | 'none'>;
  profileBits: Record<string, number>;
  pool: ReturnType<typeof buildSequencePool>;
  /** `${stage}|${direction}|${channel}|${inputSeq}` -> ProgramIds */
  index: Map<string, number[]>;
}

export function compilePrograms(ir: RuleIR, registry: SymbolRegistry, lexemeIdOf: (ref: string) => number | null): CompiledPrograms {
  const symbolizer = createSymbolizer(registry);
  const isText = (v: string) => symbolizer.sequenceOf(v) !== null;
  const texts = new Set<string>();
  for (const r of ir.rules) {
    for (const v of r.input.split('|')) if (v && isText(v)) texts.add(v);
    for (const b of r.branches) if (isText(b.output)) texts.add(b.output);
  }
  const pool = buildSequencePool(texts, registry);
  const seq = (v: string) => pool.idOf.get(v)!;
  const programOf = new Map(ir.rules.map((r, i) => [r.ruleId, i]));
  const profileBits = Object.fromEntries(PROFILE_IDS.map((p, i) => [p, 1 << i]));
  const predicates: Array<Record<string, unknown>> = [];
  const predicateId = new Map<string, number>();
  const mechanisms: string[] = [];
  const lexemeSets: number[][] = [];
  const lexemeSetModes: Array<'all' | 'some' | 'none'> = [];
  const lexemeSetId = new Map<string, number>();
  const out: CompiledPrograms = {
    count: ir.rules.length, kind: [], stage: [], direction: [], channel: [], scope: [], inputs: [], direct: [], outputs: [], flags: [], code: [],
    evidence: [], predicates, mechanisms, lexemeSets, lexemeSetModes, profileBits, pool, index: new Map()
  };
  const enumOf = <T extends string>(values: readonly T[], v: T) => { const i = values.indexOf(v); if (i < 0) throw new Error(`unknown enum value ${v}`); return i; };

  ir.rules.forEach((r: IRRule, id) => {
    out.kind.push(enumOf(RULE_KINDS, r.kind));
    out.stage.push(enumOf(RULE_STAGES, r.stage));
    out.direction.push(enumOf(RULE_DIRECTIONS, r.direction));
    out.channel.push(enumOf(CHANNELS, r.channel));
    out.scope.push(enumOf(RULE_SCOPES, r.scope));
    const inputs = r.input.split('|').filter((v) => v && isText(v)).map(seq);
    out.inputs.push(inputs);
    out.evidence.push({ ruleId: r.ruleId, canonicalIds: [...r.canonicalIds], evidenceType: r.evidenceType });

    const allProfiles = r.enabledBy === null || r.enabledBy.length === PROFILE_IDS.length;
    // TAR pattern templates are dynamic mechanisms even when the literal atoms happen to be registered.
    const textual = !r.predicate?.tokenContext?.tarPattern && r.branches.every((b) => isText(b.output));
    const symbols = r.lexicalScope.filter((x) => x.startsWith('symbol:'));
    const lexemes = r.lexicalScope.filter((x) => !x.startsWith('symbol:'));
    const direct = allProfiles && !symbols.length && !lexemes.length && !r.predicate && !r.dependsOn.length && textual && r.kind !== 'preserve';
    out.direct.push(direct);
    if (direct) {
      out.outputs.push(r.branches.map((b) => seq(b.output)));
      out.flags.push(r.branches.map((b) => (b.candidate ? FLAG.CANDIDATE : 0)));
      out.code.push([]);
    } else {
      const code: number[] = [];
      if (!allProfiles) code.push(OP.TEST_PROFILE, r.enabledBy!.reduce((m, p) => m | (profileBits[p] ?? 0), 0));
      for (const s of symbols) {
        const sym = symbolizer.idOf(s.slice('symbol:'.length));
        if (sym === null) throw new Error(`${r.ruleId}: scope symbol ${s} is not in the registry`);
        code.push(OP.TEST_SYMBOL, sym);
      }
      if (lexemes.length) {
        const ids = lexemes.map(lexemeIdOf).filter((x): x is number => x !== null).sort((a, b) => a - b);
        // a scope naming no known lexeme can never match: keep the test (fail closed), with an empty set
        // An unresolved lexical span is a hypothesis set. The safe default is `all`: a
        // lexeme-scoped rule may run only when every surviving hypothesis is in its scope.
        // This prevents a rule from silently applying to one member of an unresolved set.
        const mode = 'all' as const;
        const key = `${mode}:${ids.join(',')}`;
        let set = lexemeSetId.get(key);
        if (set === undefined) { set = lexemeSets.length; lexemeSets.push(ids); lexemeSetModes.push(mode); lexemeSetId.set(key, set); }
        code.push(OP.TEST_LEXSET, set);
      }
      const bindingGroup = r.ruleId.startsWith('binding:')
        ? `binding:${JSON.stringify([r.stage, r.direction, r.channel, r.input, r.lexicalScope.filter((x) => x.startsWith('symbol:')).sort()])}`
        : null;
      const predicate = bindingGroup
        ? { ...(r.predicate ?? {}), bindingGroup, bindingContext: r.predicate?.usage ?? '' }
        : r.predicate;
      if (predicate) {
        const key = JSON.stringify(predicate);
        let p = predicateId.get(key);
        if (p === undefined) { p = predicates.length; predicates.push({ ...predicate } as Record<string, unknown>); predicateId.set(key, p); }
        code.push(OP.TEST_PRED, p);
      }
      if (r.kind === 'preserve') code.push(OP.PRESERVE);
      else if (r.dependsOn.length && r.ruleId.startsWith('binding:')) for (const dep of r.dependsOn) code.push(OP.CALL, programOf.get(dep)!);
      else if (!textual) {
        let m = mechanisms.indexOf(r.ruleId);
        if (m < 0) { m = mechanisms.length; mechanisms.push(r.ruleId); }
        code.push(OP.MECH, m);
      } else {
        for (const b of r.branches) code.push(OP.EMIT, seq(b.output), b.candidate ? FLAG.CANDIDATE : 0);
      }
      code.push(OP.END);
      out.outputs.push([]); out.flags.push([]); out.code.push(code);
    }
    for (const input of inputs) {
      const key = `${r.stage}|${r.direction}|${r.channel}|${input}`;
      out.index.set(key, [...(out.index.get(key) ?? []), id]);
    }
  });
  return out;
}

/** Hot binary sections of a compiled program set (no type-name strings; integers only). */
export function programSections(p: CompiledPrograms) {
  const bytesOf = (value: unknown) => [...new TextEncoder().encode(String(value ?? ''))];
  const programs = encodeSection([
    { name: 'kind', kind: 'scalar', values: p.kind }, { name: 'stage', kind: 'scalar', values: p.stage }, { name: 'direction', kind: 'scalar', values: p.direction },
    { name: 'channel', kind: 'scalar', values: p.channel }, { name: 'scope', kind: 'scalar', values: p.scope }, { name: 'direct', kind: 'scalar', values: p.direct.map(Number) },
    { name: 'inputs', kind: 'list', values: p.inputs }, { name: 'outputs', kind: 'list', values: p.outputs }, { name: 'flags', kind: 'list', values: p.flags },
    { name: 'code', kind: 'list', values: p.code }
  ]);
  const indexRows = [...p.index.entries()].map(([key, programs]) => {
    const [stage, direction, channel, input] = key.split('|');
    return { stage: RULE_STAGES.indexOf(stage as typeof RULE_STAGES[number]), direction: RULE_DIRECTIONS.indexOf(direction as typeof RULE_DIRECTIONS[number]), channel: CHANNELS.indexOf(channel as typeof CHANNELS[number]), input: Number(input), programs };
  }).sort((a, b) => a.stage - b.stage || a.direction - b.direction || a.channel - b.channel || a.input - b.input);
  const predicates = encodeSection([
    { name: 'bindingGroup', kind: 'list', values: p.predicates.map((x) => bytesOf(x.bindingGroup ?? '')) },
    { name: 'bindingContext', kind: 'list', values: p.predicates.map((x) => bytesOf(x.bindingContext ?? '')) },
    { name: 'constraint', kind: 'list', values: p.predicates.map((x) => bytesOf(x.constraint ?? '')) },
    { name: 'usage', kind: 'list', values: p.predicates.map((x) => bytesOf(x.usage ?? '')) },
    { name: 'period', kind: 'list', values: p.predicates.map((x) => bytesOf(x.period ?? '')) },
    { name: 'sense', kind: 'list', values: p.predicates.map((x) => bytesOf(x.sense ?? '')) },
    { name: 'tokenContext', kind: 'list', values: p.predicates.map((x) => bytesOf(x.tokenContext ? JSON.stringify(x.tokenContext) : '')) }
  ]);
  const meta = encodeSection([
    { name: 'profileIds', kind: 'list', values: PROFILE_IDS.map(bytesOf) },
    { name: 'profileBits', kind: 'scalar', values: PROFILE_IDS.map((profile) => p.profileBits[profile] ?? 0) },
    { name: 'mechanisms', kind: 'list', values: p.mechanisms.map(bytesOf) }
  ]);
  return {
    programs,
    pool: p.pool.section,
    index: encodeSection([
      { name: 'stage', kind: 'scalar', values: indexRows.map((x) => x.stage) },
      { name: 'direction', kind: 'scalar', values: indexRows.map((x) => x.direction) },
      { name: 'channel', kind: 'scalar', values: indexRows.map((x) => x.channel) },
      { name: 'input', kind: 'scalar', values: indexRows.map((x) => x.input) },
      { name: 'programs', kind: 'list', values: indexRows.map((x) => x.programs) }
    ]),
    predicates,
    lexemeSets: encodeSection([
      { name: 'lexemes', kind: 'list', values: p.lexemeSets },
      { name: 'mode', kind: 'scalar', values: p.lexemeSetModes.map((mode) => ({ all: 0, some: 1, none: 2 }[mode])) }
    ]),
    meta
  };
}

/** Runtime view over the compiled program arrays (the same accessors the binary sections give). */
export function programView(p: CompiledPrograms) {
  return {
    count: p.count,
    direct: (i: number) => p.direct[i]!, outputs: (i: number) => Uint32Array.from(p.outputs[i]!), flags: (i: number) => Uint8Array.from(p.flags[i]!), code: (i: number) => Uint32Array.from(p.code[i]!)
  };
}

export function createVM(p: CompiledPrograms, registry: SymbolRegistry) {
  const pool = createSequencePool(decodeSection(p.pool.section), registry.atoms);
  return createRuleVM({ programs: programView(p), pool, predicates: p.predicates, profileBits: p.profileBits, lexemeSets: p.lexemeSets, lexemeSetModes: p.lexemeSetModes, mechanismCount: p.mechanisms.length });
}

export function summarizePrograms(p: CompiledPrograms, ir: RuleIR) {
  const s = programSections(p);
  const size = (b: Uint8Array) => ({ bytes: b.byteLength, gzipBytes: gzipSync(b, { level: 9 }).length });
  const codeWords = p.code.reduce((n, c) => n + c.length, 0);
  return {
    schemaVersion: '1', kind: 'rule-program-summary', owner: 'japanese-orthography#211 E (spec #208 §8)',
    irDigest: ir.digest,
    programs: p.count,
    directPrograms: p.direct.filter(Boolean).length,
    bytecodePrograms: p.direct.filter((d) => !d).length,
    codeWords, predicates: p.predicates.length, mechanisms: p.mechanisms.length, lexemeSets: p.lexemeSets.length,
    sequences: p.pool.sequences.length, indexKeys: p.index.size,
    sections: { programs: size(s.programs), pool: size(s.pool), index: size(s.index), predicates: size(s.predicates), lexemeSets: size(s.lexemeSets), meta: size(s.meta) },
    digest: createHash('sha256').update(s.programs).update(s.pool).update(s.index).update(s.predicates).update(s.lexemeSets).update(s.meta).digest('hex')
  };
}

if (process.argv[1]?.endsWith('rule-program-compiler.ts')) {
  const root = resolve(process.cwd());
  const { graph } = await normalizeAcceptedOrthographySources(root);
  const full = withProfileRules(graph);
  const ir = compileRuleIR(full);
  const registry = JSON.parse(await readFile(resolve(root, SYMBOL_REGISTRY), 'utf8')) as SymbolRegistry;
  const refs = [...new Set(full.facts.filter((f) => f.kind === 'literal_form' || f.kind === 'literal_reading').flatMap((f) => f.lexicalRefs))].sort();
  const lexemeIds = new Map(refs.map((r, i) => [r, i]));
  const programs = compilePrograms(ir, registry, (ref) => lexemeIds.get(ref) ?? null);
  createVM(programs, registry).verify();
  const summary = summarizePrograms(programs, ir);
  const text = `${JSON.stringify(summary, null, 2)}\n`;
  if (process.argv.includes('--check')) {
    const committed = (await readFile(resolve(root, RULE_PROGRAM_SUMMARY), 'utf8')).replace(/\r\n/g, '\n');
    if (committed !== text) throw new Error(`stale ${RULE_PROGRAM_SUMMARY}; run npm run generate:rule-programs`);
    console.log(`rule programs OK: ${summary.programs} programs (${summary.directPrograms} direct), digest ${summary.digest}`);
  } else {
    await writeFile(resolve(root, RULE_PROGRAM_SUMMARY), text);
    console.log(JSON.stringify(summary, null, 1));
  }
}

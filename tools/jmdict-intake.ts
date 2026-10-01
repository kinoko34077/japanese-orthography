import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

// Phase 4.8A JMdict intake contract (#133).
// JMdict supplies lexical identity evidence (entries, written forms, readings,
// restrictions, category tags). It is never historical-orthography authority and
// its ent_seq is source-local provenance, not a repository semantic identifier.

export const JMDICT_INTAKE_DIR = 'data/lexical/sources/jmdict/2026-10-01';
export const JMDICT_EXTRACT_FILE = 'jmdict-lexical-intake.json.gz';

export type Disposition = 'included' | 'excluded' | 'structural';

export const JMDICT_FIELD_CONTRACT = {
  version: 1,
  historicalAuthority: false,
  identity: {
    sourceLocalRef: 'jmdict:<createdDate>:seq:<ent_seq>',
    projectSemanticId: false,
    note: 'ent_seq is retained as source-local provenance only; repository semantic IDs require an explicit mapping (4.8B).'
  },
  elements: {
    JMdict: 'structural',
    entry: 'structural',
    'entry/ent_seq': 'included',
    'entry/k_ele': 'included',
    'entry/k_ele/keb': 'included',
    'entry/k_ele/ke_inf': 'included',
    'entry/k_ele/ke_pri': 'included',
    'entry/r_ele': 'included',
    'entry/r_ele/reb': 'included',
    'entry/r_ele/re_nokanji': 'included',
    'entry/r_ele/re_restr': 'included',
    'entry/r_ele/re_inf': 'included',
    'entry/r_ele/re_pri': 'included',
    'entry/sense': 'included',
    'entry/sense/stagk': 'included',
    'entry/sense/stagr': 'included',
    'entry/sense/pos': 'included',
    'entry/sense/field': 'included',
    'entry/sense/misc': 'included',
    'entry/sense/dial': 'included',
    'entry/sense/gloss': 'excluded',
    'entry/sense/xref': 'excluded',
    'entry/sense/ant': 'excluded',
    'entry/sense/s_inf': 'excluded',
    'entry/sense/lsource': 'excluded',
    'entry/sense/example': 'excluded',
    'entry/sense/example/ex_srce': 'excluded',
    'entry/sense/example/ex_text': 'excluded',
    'entry/sense/example/ex_sent': 'excluded',
    'entry/sense/gram': 'excluded',
    'entry/info': 'excluded',
    'entry/info/audit': 'excluded',
    'entry/info/audit/upd_date': 'excluded',
    'entry/info/audit/upd_detl': 'excluded',
    'entry/sense/pri': 'excluded'
  } as Record<string, Disposition>,
  attributes: {
    'entry/sense/gloss@xml:lang': 'excluded',
    'entry/sense/gloss@g_type': 'excluded',
    'entry/sense/gloss@g_gend': 'excluded',
    'entry/sense/lsource@xml:lang': 'excluded',
    'entry/sense/lsource@ls_type': 'excluded',
    'entry/sense/lsource@ls_wasei': 'excluded',
    'entry/sense/example/ex_srce@exsrc_type': 'excluded',
    'entry/sense/example/ex_sent@xml:lang': 'excluded',
    'entry/sense/example/ex_sent@ex_srce': 'excluded'
  } as Record<string, Disposition>,
  exclusionRationale: 'Glosses, cross-references, antonyms, sense notes, loanword sources, examples and grammar notes are not required for lexical identity/form/reading/category evidence and stay out of the hot lexical graph.'
} as const;

export interface JmdictKanji { t: string; inf?: string[]; pri?: string[] }
export interface JmdictReading { t: string; nokanji?: true; restr?: string[]; inf?: string[]; pri?: string[] }
export interface JmdictSense { stagk?: string[]; stagr?: string[]; pos?: string[]; field?: string[]; misc?: string[]; dial?: string[] }
export interface JmdictEntry { seq: number; k?: JmdictKanji[]; r: JmdictReading[]; s: JmdictSense[] }

export interface FieldCount { seen: number; disposition: Disposition }
export interface JmdictAccounting {
  createdDate: string;
  entries: number;
  entityTableSha256: string;
  elements: Record<string, FieldCount>;
  attributes: Record<string, FieldCount>;
  undispositioned: string[];
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const LIST_FIELDS = new Set(['ke_inf', 'ke_pri', 're_restr', 're_inf', 're_pri', 'stagk', 'stagr', 'pos', 'field', 'misc', 'dial']);
const TOKEN = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>|<!--[\s\S]*?-->|([^<]+)/g;
const ATTR = /([\w:.-]+)="[^"]*"/g;

export function jmdictSourceLocalRef(createdDate: string, seq: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(createdDate)) throw new Error(`invalid JMdict created date ${createdDate}`);
  if (!Number.isSafeInteger(seq) || seq <= 0) throw new Error(`invalid ent_seq ${seq}`);
  return `jmdict:${createdDate}:seq:${seq}`;
}

function parseEntities(prolog: string): Map<string, string> {
  const entities = new Map<string, string>();
  for (const match of prolog.matchAll(/<!ENTITY\s+(\S+)\s+"([^"]*)">/g)) entities.set(match[1]!, match[2]!);
  return entities;
}

export function extractJmdictIntake(xml: string): { extract: JmdictEntry[]; accounting: JmdictAccounting } {
  const bodyStart = xml.indexOf('<JMdict>');
  if (bodyStart < 0) throw new Error('JMdict root element not found');
  const entities = parseEntities(xml.slice(0, bodyStart));
  const entityTableSha256 = createHash('sha256')
    .update([...entities].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}\t${v}`).join('\n'))
    .digest('hex');
  const created = /<!-- JMdict created: (\d{4}-\d{2}-\d{2}) -->/.exec(xml);
  if (!created) throw new Error('JMdict created date comment not found');

  const elements: Record<string, FieldCount> = {};
  const attributes: Record<string, FieldCount> = {};
  const count = (table: Record<string, FieldCount>, key: string, kind: 'element' | 'attribute') => {
    const contract = kind === 'element' ? JMDICT_FIELD_CONTRACT.elements : JMDICT_FIELD_CONTRACT.attributes;
    const disposition = contract[key];
    if (!disposition) throw new Error(`undispositioned ${kind} ${key}`);
    (table[key] ??= { seen: 0, disposition }).seen += 1;
  };

  const decode = (raw: string, path: string): { text: string; entity?: string } => {
    const whole = /^&([\w-]+);$/.exec(raw);
    if (whole && !(whole[1]! in NAMED)) {
      if (!entities.has(whole[1]!)) throw new Error(`undeclared entity &${whole[1]}; in ${path}`);
      return { text: whole[1]!, entity: whole[1]! };
    }
    return {
      text: raw.replace(/&(#x[0-9a-fA-F]+|#\d+|[\w-]+);/g, (_, ref: string) => {
        if (ref.startsWith('#x')) return String.fromCodePoint(Number.parseInt(ref.slice(2), 16));
        if (ref.startsWith('#')) return String.fromCodePoint(Number.parseInt(ref.slice(1), 10));
        const named = NAMED[ref];
        if (named === undefined) throw new Error(`undeclared entity &${ref}; in ${path}`);
        return named;
      })
    };
  };

  const extract: JmdictEntry[] = [];
  const seqs = new Set<number>();
  const stack: string[] = [];
  let text = '';
  let entry: JmdictEntry | undefined;
  let kanji: JmdictKanji | undefined;
  let reading: JmdictReading | undefined;
  let sense: JmdictSense | undefined;

  const finishEntry = (current: JmdictEntry) => {
    if (!current.seq) throw new Error('entry without ent_seq');
    if (seqs.has(current.seq)) throw new Error(`duplicate ent_seq ${current.seq}`);
    seqs.add(current.seq);
    if (current.r.length === 0) throw new Error(`entry ${current.seq} has no reading`);
    const kebs = new Set((current.k ?? []).map((k) => k.t));
    for (const r of current.r) for (const restr of r.restr ?? []) {
      if (!kebs.has(restr)) throw new Error(`entry ${current.seq}: re_restr ${restr} does not name a keb`);
    }
    const rebs = new Set(current.r.map((r) => r.t));
    for (const s of current.s) {
      for (const k of s.stagk ?? []) if (!kebs.has(k)) throw new Error(`entry ${current.seq}: stagk ${k} does not name a keb`);
      for (const r of s.stagr ?? []) if (!rebs.has(r)) throw new Error(`entry ${current.seq}: stagr ${r} does not name a reb`);
    }
    extract.push(current);
  };

  const body = xml.slice(bodyStart);
  for (const match of body.matchAll(TOKEN)) {
    const [raw, closing, name, attrs, selfClosing, chars] = match;
    if (raw.startsWith('<!--')) continue;
    if (chars !== undefined) {
      if (stack.length === 0 || ['JMdict', 'entry', 'k_ele', 'r_ele', 'sense'].includes(stack.at(-1)!)) {
        if (chars.trim() !== '') throw new Error(`unexpected text ${JSON.stringify(chars.trim().slice(0, 20))} in ${stack.join('/')}`);
        continue;
      }
      text += chars;
      continue;
    }
    if (closing) {
      if (stack.at(-1) !== name) throw new Error(`mismatched </${name}> in ${stack.join('/')}`);
      const path = stack.slice(1).join('/');
      stack.pop();
      const value = text;
      text = '';
      const disposition = JMDICT_FIELD_CONTRACT.elements[path];
      if (disposition !== 'included') {
        if (name === 'entry') finishEntry(entry!), (entry = undefined);
        continue;
      }
      if (name === 'k_ele') { if (!kanji?.t) throw new Error('k_ele without keb'); (entry!.k ??= []).push(kanji); kanji = undefined; continue; }
      if (name === 'r_ele') { if (!reading?.t) throw new Error('r_ele without reb'); entry!.r.push(reading); reading = undefined; continue; }
      if (name === 'sense') { entry!.s.push(sense!); sense = undefined; continue; }
      const decoded = decode(value, path);
      if (name === 'ent_seq') {
        const seq = Number(decoded.text);
        jmdictSourceLocalRef(created[1]!, seq);
        entry!.seq = seq;
      } else if (name === 'keb') kanji!.t = decoded.text;
      else if (name === 'reb') reading!.t = decoded.text;
      else if (LIST_FIELDS.has(name!)) {
        const key = name!.replace(/^(ke|re)_/, '') as keyof JmdictKanji & keyof JmdictReading & keyof JmdictSense;
        const target = (stack.at(-1) === 'k_ele' ? kanji : stack.at(-1) === 'r_ele' ? reading : sense) as unknown as Record<string, string[]>;
        if (!target) throw new Error(`${path} outside its parent`);
        (target[key] ??= []).push(decoded.text);
      } else throw new Error(`included element ${path} has no extractor`);
      continue;
    }
    stack.push(name!);
    const path = stack.slice(1).join('/') || 'JMdict';
    count(elements, path, 'element');
    for (const attr of (attrs ?? '').matchAll(ATTR)) count(attributes, `${path}@${attr[1]}`, 'attribute');
    text = '';
    if (path === 'entry') entry = { seq: 0, r: [], s: [] };
    else if (path === 'entry/k_ele') kanji = { t: '' };
    else if (path === 'entry/r_ele') reading = { t: '' };
    else if (path === 'entry/sense') sense = {};
    if (selfClosing) {
      stack.pop();
      if (path === 'entry/r_ele/re_nokanji') reading!.nokanji = true;
      else if (JMDICT_FIELD_CONTRACT.elements[path] === 'included') throw new Error(`unexpected empty element ${path}`);
    }
  }
  if (stack.length !== 0) throw new Error(`unterminated elements ${stack.join('/')}`);
  // Canonical order is ent_seq ascending; upstream file order carries no lexical meaning.
  extract.sort((a, b) => a.seq - b.seq);

  return {
    extract,
    accounting: { createdDate: created[1]!, entries: extract.length, entityTableSha256, elements, attributes, undispositioned: [] }
  };
}

function recount(extract: readonly JmdictEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  const add = (key: string, n: number) => { if (n) counts[key] = (counts[key] ?? 0) + n; };
  for (const entry of extract) {
    add('entry/ent_seq', 1);
    for (const k of entry.k ?? []) { add('entry/k_ele', 1); add('entry/k_ele/keb', 1); add('entry/k_ele/ke_inf', k.inf?.length ?? 0); add('entry/k_ele/ke_pri', k.pri?.length ?? 0); }
    for (const r of entry.r) {
      add('entry/r_ele', 1); add('entry/r_ele/reb', 1); add('entry/r_ele/re_nokanji', r.nokanji ? 1 : 0);
      add('entry/r_ele/re_restr', r.restr?.length ?? 0); add('entry/r_ele/re_inf', r.inf?.length ?? 0); add('entry/r_ele/re_pri', r.pri?.length ?? 0);
    }
    for (const s of entry.s) {
      add('entry/sense', 1);
      for (const field of ['stagk', 'stagr', 'pos', 'field', 'misc', 'dial'] as const) add(`entry/sense/${field}`, s[field]?.length ?? 0);
    }
  }
  return counts;
}

/** Returns diagnostics; empty means the extract is a lossless projection of the accounted source under the contract. */
export function validateJmdictIntake(extract: readonly JmdictEntry[], accounting: JmdictAccounting): string[] {
  const diagnostics: string[] = [];
  if (extract.length !== accounting.entries) diagnostics.push(`entry count ${extract.length} != accounted ${accounting.entries}`);
  if (accounting.undispositioned.length) diagnostics.push(`undispositioned fields ${accounting.undispositioned.join(', ')}`);
  for (const [table, contract] of [[accounting.elements, JMDICT_FIELD_CONTRACT.elements], [accounting.attributes, JMDICT_FIELD_CONTRACT.attributes]] as const) {
    for (const [key, field] of Object.entries(table)) {
      if (contract[key] !== field.disposition) diagnostics.push(`disposition drift ${key}: ${field.disposition} vs contract ${contract[key] ?? 'none'}`);
    }
  }
  const actual = recount(extract);
  for (const [key, field] of Object.entries(accounting.elements)) {
    if (field.disposition !== 'included') continue;
    if ((actual[key] ?? 0) !== field.seen) diagnostics.push(`${key} included ${field.seen} but extract holds ${actual[key] ?? 0}`);
  }
  for (const key of Object.keys(actual)) if (!accounting.elements[key]) diagnostics.push(`extract holds unaccounted ${key}`);
  let previous = 0;
  for (const entry of extract) {
    if (entry.seq <= previous) { diagnostics.push(`ent_seq order/duplicate at ${entry.seq}`); break; }
    previous = entry.seq;
  }
  return diagnostics;
}

export function serializeJmdictExtract(extract: readonly JmdictEntry[]): string {
  return `[\n${extract.map((entry) => JSON.stringify(entry)).join(',\n')}\n]\n`;
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export async function loadJmdictIntake(rootDir: string): Promise<{ extract: JmdictEntry[]; accounting: JmdictAccounting; manifest: Record<string, any> }> {
  const dir = resolve(rootDir, JMDICT_INTAKE_DIR);
  const manifest = JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8')) as Record<string, any>;
  const text = gunzipSync(await readFile(resolve(dir, JMDICT_EXTRACT_FILE))).toString('utf8');
  if (sha256(text) !== manifest.extract.sha256) throw new Error(`JMdict extract sha256 drift: ${sha256(text)} != ${manifest.extract.sha256}`);
  return { extract: JSON.parse(text) as JmdictEntry[], accounting: manifest.accounting as JmdictAccounting, manifest };
}

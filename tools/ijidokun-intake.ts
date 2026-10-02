import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// #208 §5 / #211 H — period-aware 異字同訓 intake.
//
// Each official version is an independent pinned snapshot (PDF + extracted text, both SHA-256
// locked; see data/sources/bunka/ijidokun/manifest.json). The parser turns each version into its own
// record set — one record per (reading family, written form group):
//
//   reading family   あがる・あげる
//   forms            上がる・上げる
//   sense            the version's semantic condition (2014 gives one per form group; 1972 gives none)
//   examples         the version's usage examples
//   alternatives     forms the version shows as allowed alternatives in an example: 揚（上）がる
//   dispositions     default (the listed form for its sense) / allowed-alternative / kana-preferred
//   notes            the version's notes (＊)
//
// Versions never overwrite each other. The period diff compares families and form groups and records
// what was added, removed or changed between versions; it never infers that a record continues.
//
//   npm run generate:ijidokun            -> data/periods/ijidokun-periods.json + data/reports/ijidokun-period-diff.json
//   npm run validate:ijidokun            -> snapshot digests + regenerated outputs must match

export const IJIDOKUN_DIR = 'data/sources/bunka/ijidokun';
export const IJIDOKUN_INTAKE = 'data/periods/ijidokun-periods.json';
export const IJIDOKUN_DIFF = 'data/reports/ijidokun-period-diff.json';

export type UsageDisposition = 'default' | 'allowed-alternative' | 'marked' | 'domain-limited' | 'rare' | 'kana-preferred' | 'unresolved';

export interface IjidokunRecord {
  recordId: string;
  period: string;
  sourceId: string;
  locator: string;
  readingFamily: string;
  forms: string[];
  sense: string | null;
  examples: string[];
  alternatives: Array<{ preferred: string; alternative: string; example: string }>;
  dispositions: UsageDisposition[];
  notes: string[];
}

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const KANA_FAMILY = /^[ぁ-ゖー・]+$/u;
const toHalfDigits = (s: string) => s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
const splitExamples = (text: string) => text.split(/(?<=。)/u).map((x) => x.trim()).filter(Boolean);
/** 揚（上）がる -> preferred 揚がる, alternative 上がる (the version allows both in this example) */
const alternativesIn = (example: string) => {
  const out: Array<{ preferred: string; alternative: string; example: string }> = [];
  for (const m of example.matchAll(/([\p{Script=Han}]+)（([\p{Script=Han}]+)）([ぁ-ゖ]*)/gu)) {
    out.push({ preferred: `${m[1]}${m[3]}`, alternative: `${m[2]}${m[3]}`, example });
  }
  return out;
};
const recordId = (period: string, family: string, forms: string[]) => `ijidokun:${period}:${family}:${forms.join('・')}`;

/** 1972 「異字同訓」の漢字の用法: family heading lines, then `forms─ examples` entries. */
export function parse1972(text: string, sourceId: string): IjidokunRecord[] {
  const records: IjidokunRecord[] = [];
  let family: string | null = null;
  let current: IjidokunRecord | null = null;
  let page = 1;
  const flush = () => { if (current) { current.examples = splitExamples(current.examples.join('')); current.alternatives = current.examples.flatMap(alternativesIn); records.push(current); current = null; } };
  // pdftotext marks a page break with a form feed: it starts a new line, it is not indentation
  for (const raw of text.replace(/\f/gu, '\n').split(/\r?\n/u)) {
    const line = raw.trimEnd();
    const pageMark = /^\s*-\s*(\d+)\s*-\s*$/u.exec(line);
    if (pageMark) { page = Number(pageMark[1]) + 1; continue; }
    if (!line.trim()) continue;
    if (!/^\s/u.test(line) && KANA_FAMILY.test(line.trim()) && records.length + (current ? 1 : 0) >= 0) {
      if (line.trim().length <= 1 && !family) continue;
      flush();
      family = line.trim();
      continue;
    }
    const entry = /^\s+(.+?)─\s*(.*)$/u.exec(line);
    if (entry && family) {
      flush();
      const forms = entry[1]!.trim().split('・').map((f) => f.trim()).filter(Boolean);
      current = { recordId: recordId('1972', family, forms), period: '1972', sourceId, locator: `p.${page}`, readingFamily: family, forms, sense: null, examples: [entry[2]!.trim()], alternatives: [], dispositions: ['default'], notes: [] };
      continue;
    }
    if (current && /^\s+/u.test(line)) current.examples.push(line.trim());
  }
  flush();
  return records;
}

/** 2014 「異字同訓」の漢字の使い分け例: numbered family headings, 【forms】sense, examples, ＊ notes. */
export function parse2014(text: string, sourceId: string): IjidokunRecord[] {
  const records: IjidokunRecord[] = [];
  let family: string | null = null;
  let number = '';
  let current: IjidokunRecord | null = null;
  let familyRecords: IjidokunRecord[] = [];
  let notes: string[] = [];
  let inNote = false;
  const formMarks = new Map<IjidokunRecord, number>();
  const closeFamily = () => {
    flush();
    // notes belong to the whole family entry; a note recommending kana marks every form group
    const joined = notes.join('');
    for (const r of familyRecords) {
      r.notes = notes.filter((n) => r.forms.some((f) => n.includes(f.replace(/[ぁ-ゖ]+$/u, ''))) || n.includes(r.readingFamily));
      if (/仮名で(書|表記)/u.test(joined) && r.notes.some((n) => /仮名で(書|表記)/u.test(n))) r.dispositions.push('kana-preferred');
      const marks = formMarks.get(r);
      if (marks) {
        const own = notes.filter((n) => n.startsWith('*'.repeat(marks)) && !n.startsWith('*'.repeat(marks + 1)));
        for (const n of own) if (!r.notes.includes(n)) r.notes.push(n);
        // the form's own note says another written form is the general current practice
        if (own.some((n) => /一般的/u.test(n))) r.dispositions.push('marked');
      }
    }
    familyRecords = [];
    notes = [];
  };
  const flush = () => { if (current) { current.examples = splitExamples(current.examples.join('')); current.alternatives = current.examples.flatMap(alternativesIn); familyRecords.push(current); records.push(current); current = null; } };
  const lines = text.replace(/\f/gu, '\n').split(/\r?\n/u);
  let started = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^([ぁ-ゖー・]+)\s{2,}([０-９]{3})\s*$/u.exec(line);
    if (heading) {
      if (family) closeFamily();
      started = true;
      family = heading[1]!;
      number = toHalfDigits(heading[2]!);
      inNote = false;
      continue;
    }
    if (!started) continue;
    // the reprinted 1972 / 2010 reference material starts after the main table
    if (/委員名簿|小委員会の設置について|審議経過|総会参考資料|＜\s*参\s*考\s*資\s*料\s*＞/u.test(line)) break;
    if (!line.trim() || /^\s*-?\s*\d+\s*-?\s*$/u.test(line)) continue;
    const entry = /^【(.+?)】\s*(.*)$/u.exec(line.trim());
    if (entry && family) {
      flush();
      inNote = false;
      // `【虞**】`: asterisks after a form point at the note with the same number of asterisks
      const rawForms = entry[1]!.split('・').map((f) => f.trim()).filter(Boolean);
      const marks = Math.max(0, ...rawForms.map((f) => /(\*+)$/u.exec(f)?.[1]?.length ?? 0));
      const forms = rawForms.map((f) => f.replace(/\*+$/u, ''));
      current = { recordId: recordId('2014', family, forms), period: '2014', sourceId, locator: `item ${number}`, readingFamily: family, forms, sense: entry[2]!.trim() || null, examples: [], alternatives: [], dispositions: ['default'], notes: [] };
      if (marks) formMarks.set(current, marks);
      continue;
    }
    if (/^\s*[*＊]/u.test(line)) { flush(); inNote = true; notes.push(line.trim()); continue; }
    if (inNote) { notes[notes.length - 1] += line.trim(); continue; }
    if (current) current.examples.push(line.trim());
  }
  if (family) closeFamily();
  return records;
}

export function periodDiff(a: IjidokunRecord[], b: IjidokunRecord[]) {
  const families = (rs: IjidokunRecord[]) => new Map<string, IjidokunRecord[]>([...new Set(rs.map((r) => r.readingFamily))].map((f) => [f, rs.filter((r) => r.readingFamily === f)]));
  const fa = families(a);
  const fb = families(b);
  const key = (r: IjidokunRecord) => r.forms.join('・');
  const formsOf = (rs: IjidokunRecord[]) => new Set(rs.flatMap((r) => r.forms));
  const changes = [];
  for (const family of [...new Set([...fa.keys(), ...fb.keys()])].sort()) {
    const ra = fa.get(family) ?? [];
    const rb = fb.get(family) ?? [];
    if (!ra.length) { changes.push({ family, change: 'family-added', to: rb.map(key) }); continue; }
    if (!rb.length) { changes.push({ family, change: 'family-absent', from: ra.map(key) }); continue; }
    const ka = new Set(ra.map(key));
    const kb = new Set(rb.map(key));
    const fsA = formsOf(ra);
    const fsB = formsOf(rb);
    const addedForms = [...fsB].filter((f) => !fsA.has(f));
    const absentForms = [...fsA].filter((f) => !fsB.has(f));
    if ([...ka].some((k) => !kb.has(k)) || [...kb].some((k) => !ka.has(k)) || addedForms.length || absentForms.length) {
      changes.push({ family, change: 'form-groups-changed', from: [...ka], to: [...kb], addedForms, absentForms });
    }
  }
  return {
    from: a[0]?.period ?? null, to: b[0]?.period ?? null,
    families: { from: fa.size, to: fb.size, both: [...fa.keys()].filter((f) => fb.has(f)).length },
    records: { from: a.length, to: b.length },
    changes,
    note: 'records are compared per reading family and form group; a record present in both versions is two records, never one continued record'
  };
}

export async function loadIjidokun(rootDir: string) {
  const manifest = JSON.parse(await readFile(resolve(rootDir, IJIDOKUN_DIR, 'manifest.json'), 'utf8'));
  const parsed: Record<string, IjidokunRecord[]> = {};
  for (const source of manifest.sources) {
    const pdf = await readFile(resolve(rootDir, IJIDOKUN_DIR, source.file));
    if (sha256(pdf) !== source.sha256 || pdf.byteLength !== source.bytes) throw new Error(`${source.sourceId}: snapshot digest drift`);
    const text = (await readFile(resolve(rootDir, IJIDOKUN_DIR, source.extraction.file), 'utf8')).replace(/\r\n/g, '\n');
    if (sha256(text) !== source.extraction.sha256) throw new Error(`${source.sourceId}: extracted text digest drift`);
    parsed[source.period] = source.period === '1972' ? parse1972(text, source.sourceId) : parse2014(text, source.sourceId);
  }
  return { manifest, parsed };
}

if (process.argv[1]?.endsWith('ijidokun-intake.ts')) {
  const root = resolve(process.cwd());
  const { manifest, parsed } = await loadIjidokun(root);
  const intake = { schemaVersion: '1', kind: 'ijidokun-period-intake', owner: 'japanese-orthography#211 H (spec #208 §5)', sources: manifest.sources.map((s: Record<string, unknown>) => s.sourceId), periods: Object.fromEntries(Object.entries(parsed).map(([p, rs]) => [p, rs])) };
  const diff = { schemaVersion: '1', kind: 'ijidokun-period-diff', owner: 'japanese-orthography#211 H', ...periodDiff(parsed['1972'] ?? [], parsed['2014'] ?? []) };
  const texts = [`${JSON.stringify(intake, null, 1)}\n`, `${JSON.stringify(diff, null, 2)}\n`];
  if (process.argv.includes('--check')) {
    for (const [path, text] of [[IJIDOKUN_INTAKE, texts[0]], [IJIDOKUN_DIFF, texts[1]]] as const) {
      if ((await readFile(resolve(root, path), 'utf8')).replace(/\r\n/g, '\n') !== text) throw new Error(`stale ${path}; run npm run generate:ijidokun`);
    }
    console.log(`ijidokun OK: ${Object.entries(parsed).map(([p, rs]) => `${p}=${rs.length}`).join(' ')}`);
  } else {
    await writeFile(resolve(root, IJIDOKUN_INTAKE), texts[0]!);
    await writeFile(resolve(root, IJIDOKUN_DIFF), texts[1]!);
    console.log(JSON.stringify({ records: Object.fromEntries(Object.entries(parsed).map(([p, rs]) => [p, rs.length])), diff: diff.families, changes: diff.changes.length }));
  }
}

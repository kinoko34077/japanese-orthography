import type { ParserRemainder } from './intake-accounting.ts';
import type { SourceRecordKind } from './intake-model.ts';

// Deterministic extraction of 仮名遣等資料/字音仮名遣い表.html (Phase 4.6E coverage oracle).
// One record per listed character token; the table's structural rows are not records.

export interface SinoTableRecord {
  sourceRef: string;
  sourceLocator: string;
  sourceRecordKind: SourceRecordKind;
  rowIndex: number;
  pronunciation: string;
  modernReading: string;
  historicalReading: string;
  token: string;
  character: string | null;
  context: string | null;
  sameAsModern: boolean;
  exclusionReason: string | null;
}

export interface SinoTableParseResult {
  records: SinoTableRecord[];
  discoveredRecordIds: string[];
  remainders: ParserRemainder[];
  headingReadings: string[];
}

const HAN = /^\p{Script=Han}$/u;
const CONTEXT_TOKEN = /^(\p{Script=Han})（([^（）]+)）$/u;
const PARENTHESIZED_TOKEN = /^\((\p{Script=Han})\)$/u;
const CATCH_ALL = 'その他';

export function katakanaToHiragana(value: string): string {
  return Array.from(value, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : char;
  }).join('');
}

function cellText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ');
}

function compact(value: string): string {
  return value.replace(/[\s　]+/gu, '');
}

function mainTable(html: string): string {
  const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)].map((match) => match[1]!);
  const table = tables.find((body) => body.includes('発<br>') || /<td[^>]*>\s*<font[^>]*>発/.test(body));
  if (!table) throw new Error('字音仮名遣い表: main table not found');
  return table;
}

export function parseSinoTableHtml(html: string, sourceRef: string): SinoTableParseResult {
  const rows = [...mainTable(html).matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]!);
  const records: SinoTableRecord[] = [];
  const remainders: ParserRemainder[] = [];
  const headings = new Set<string>();
  let current: { pronunciation: string; modernReading: string } | null = null;

  rows.forEach((row, rowIndex) => {
    const cells = [...row.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi)].map((match) => match[2]!);
    let historicalCell: string;
    let charactersCell: string;
    if (cells.length === 4) {
      const pronunciation = compact(cellText(cells[0]!));
      const modern = compact(cellText(cells[1]!));
      if (modern === '現代仮名' || pronunciation === '発音') {
        current = null;
        return; // structural header row
      }
      current = { pronunciation, modernReading: modern === CATCH_ALL ? CATCH_ALL : katakanaToHiragana(modern) };
      historicalCell = cells[2]!;
      charactersCell = cells[3]!;
    } else if (cells.length === 2 && current) {
      historicalCell = cells[0]!;
      charactersCell = cells[1]!;
    } else {
      remainders.push({ sourceRecordId: `row:${rowIndex}`, kind: 'mapping', detail: `unexpected cell count ${cells.length}` });
      return;
    }

    const { pronunciation, modernReading } = current!;
    const historicalReading = compact(cellText(historicalCell));
    const sameAsModern = /#C0C0C0/i.test(charactersCell);
    const tokens = cellText(charactersCell).split(/[\s　]+/u).filter(Boolean);

    if (modernReading === CATCH_ALL) {
      const locator = `row:${rowIndex}:catch-all`;
      records.push({
        sourceRef, sourceLocator: locator, sourceRecordKind: 'explanatory', rowIndex,
        pronunciation, modernReading, historicalReading, token: tokens.join(''),
        character: null, context: null, sameAsModern, exclusionReason: 'catch_all_statement'
      });
      return;
    }
    headings.add(modernReading);

    tokens.forEach((token, tokenIndex) => {
      const sourceLocator = `row:${rowIndex}:token:${tokenIndex}`;
      const base = {
        sourceRef, sourceLocator, rowIndex, pronunciation, modernReading, historicalReading, token, sameAsModern
      };
      const context = CONTEXT_TOKEN.exec(token);
      const parenthesized = PARENTHESIZED_TOKEN.exec(token);
      if (HAN.test(token)) {
        records.push({
          ...base, sourceRecordKind: sameAsModern ? 'identity' : 'mapping',
          character: token.normalize('NFC'), context: null, exclusionReason: null
        });
      } else if (context) {
        records.push({
          ...base, sourceRecordKind: 'mapping', character: context[1]!.normalize('NFC'), context: context[2]!, exclusionReason: null
        });
      } else if (parenthesized) {
        records.push({
          ...base, sourceRecordKind: 'mapping', character: parenthesized[1]!.normalize('NFC'), context: null,
          exclusionReason: 'parenthesized_uncertain_entry'
        });
      } else {
        remainders.push({ sourceRecordId: sourceLocator, kind: 'mapping', detail: `unrecognized token ${token}` });
      }
    });
  });

  return {
    records,
    discoveredRecordIds: records.map((record) => record.sourceLocator),
    remainders,
    headingReadings: [...headings].sort()
  };
}

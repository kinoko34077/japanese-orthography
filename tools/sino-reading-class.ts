import { inflateRawSync } from 'node:zlib';
import { katakanaToHiragana } from './sino-table-parser.ts';

export const SINO_READING_CLASS_COLUMNS = {
  C: 'go_only',
  D: 'go_kan_common',
  E: 'kan_only',
  F: 'customary'
} as const;

export type SinoReadingClass = typeof SINO_READING_CLASS_COLUMNS[keyof typeof SINO_READING_CLASS_COLUMNS];

export interface SinoReadingClassEntry {
  character: string;
  modernReading: string;
  classes: SinoReadingClass[];
  evidenceRefs: string[];
}

export interface SinoReadingClassParseResult {
  headers: Record<string, string>;
  entries: SinoReadingClassEntry[];
  remainders: SinoReadingClassRemainder[];
  rowCount: number;
}

export interface SinoReadingClassRemainder {
  row: number;
  column: string;
  text: string;
}

const HAN = /^\p{Script=Han}$/u;
const textDecoder = new TextDecoder('utf-8', { fatal: true });

function u16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function u32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function zipText(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

function zipEntry(input: Uint8Array, name: string): Uint8Array {
  const endSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const localSignature = 0x04034b50;
  let end = -1;
  for (let offset = input.length - 22; offset >= 0; offset -= 1) {
    if (u32(input, offset) === endSignature) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error('XLSX ZIP end record not found');
  const count = u16(input, end + 10);
  const centralOffset = u32(input, end + 16);
  let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (u32(input, offset) !== centralSignature) throw new Error('XLSX ZIP central directory is invalid');
    const method = u16(input, offset + 10);
    const compressedSize = u32(input, offset + 20);
    const nameLength = u16(input, offset + 28);
    const extraLength = u16(input, offset + 30);
    const commentLength = u16(input, offset + 32);
    const localOffset = u32(input, offset + 42);
    const entryName = zipText(input.subarray(offset + 46, offset + 46 + nameLength));
    if (entryName === name) {
      if (u32(input, localOffset) !== localSignature) throw new Error(`XLSX ZIP local entry is invalid: ${name}`);
      const localNameLength = u16(input, localOffset + 26);
      const localExtraLength = u16(input, localOffset + 28);
      const compressed = input.subarray(
        localOffset + 30 + localNameLength + localExtraLength,
        localOffset + 30 + localNameLength + localExtraLength + compressedSize
      );
      if (method === 0) return compressed.slice();
      if (method === 8) return new Uint8Array(inflateRawSync(compressed));
      throw new Error(`Unsupported XLSX ZIP compression method ${method}: ${name}`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`XLSX ZIP entry not found: ${name}`);
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function xmlText(fragment: string): string {
  return [...fragment.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
    .map((match) => decodeXml(match[1]!.replace(/<[^>]+>/g, '')))
    .join('');
}

function attributes(fragment: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of fragment.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) result.set(match[1]!, decodeXml(match[2]!));
  return result;
}

function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map((match) => xmlText(match[1]!));
}

interface SheetRow {
  number: number;
  cells: Map<string, string>;
}

function sheetRows(xml: string, strings: readonly string[]): SheetRow[] {
  const rows: SheetRow[] = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gi)) {
    const rowAttributes = attributes(rowMatch[1]!);
    const rowNumber = Number.parseInt(rowAttributes.get('r') ?? '', 10);
    if (!Number.isInteger(rowNumber) || rowNumber < 1) throw new Error('XLSX worksheet row number is invalid');
    const cells = new Map<string, string>();
    for (const cellMatch of rowMatch[2]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
      const cellAttributes = attributes(cellMatch[1]!);
      const reference = cellAttributes.get('r');
      if (!reference) throw new Error(`XLSX worksheet cell at row ${rowNumber} has no reference`);
      const column = reference.replace(/[0-9]/g, '');
      const body = cellMatch[2] ?? '';
      const valueMatch = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i);
      let value = valueMatch ? decodeXml(valueMatch[1]!.trim()) : '';
      if (cellAttributes.get('t') === 's' && value !== '') {
        const index = Number.parseInt(value, 10);
        if (!Number.isInteger(index) || strings[index] === undefined) throw new Error(`XLSX shared string index is invalid: ${value}`);
        value = strings[index];
      } else if (cellAttributes.get('t') === 'inlineStr') {
        value = xmlText(body);
      }
      cells.set(column, value);
    }
    rows.push({ number: rowNumber, cells });
  }
  return rows.sort((a, b) => a.number - b.number);
}

function compact(value: string): string {
  return value.replace(/[\s　]+/gu, '');
}

function modernReading(value: string): string {
  return katakanaToHiragana(compact(value));
}

export function parseSinoReadingClassWorkbook(input: Uint8Array, sourceRef: string): SinoReadingClassParseResult {
  if (input.byteLength === 0) throw new Error('XLSX workbook is empty');
  const strings = sharedStrings(zipText(zipEntry(input, 'xl/sharedStrings.xml')));
  const rows = sheetRows(zipText(zipEntry(input, 'xl/worksheets/sheet1.xml')), strings);
  const header = rows.find((row) => row.number === 1);
  if (!header) throw new Error('XLSX worksheet header row is missing');
  const expectedHeaders: Record<string, string> = { A: '現代音', B: '広韻', C: '呉音のみ', D: '呉音漢音共通', E: '漢音のみ', F: '慣用音等' };
  for (const [column, expected] of Object.entries(expectedHeaders)) {
    if (header.cells.get(column) !== expected) throw new Error(`XLSX reading-class header mismatch at ${column}: expected ${expected}`);
  }

  const byKey = new Map<string, { character: string; modernReading: string; classes: Set<SinoReadingClass>; evidenceRefs: Set<string> }>();
  const remainders: SinoReadingClassRemainder[] = [];
  let currentReading: string | null = null;
  for (const row of rows.filter((candidate) => candidate.number > 1)) {
    const ownReading = modernReading(row.cells.get('A') ?? '');
    if (ownReading) currentReading = ownReading;
    const reading = currentReading;
    const classCells = (Object.entries(SINO_READING_CLASS_COLUMNS) as [keyof typeof SINO_READING_CLASS_COLUMNS, SinoReadingClass][])
      .map(([column, classification]) => ({ column, classification, value: compact(row.cells.get(column) ?? '') }))
      .filter(({ value }) => value !== '');
    if (classCells.length === 0) continue;
    if (!reading) throw new Error(`XLSX reading-class row ${row.number} has classifications without modern reading`);
    for (const { column, classification, value } of classCells) {
      for (const character of Array.from(value)) {
        if (!HAN.test(character)) continue;
        const key = `${character}\u0000${reading}`;
        const entry = byKey.get(key) ?? {
          character, modernReading: reading, classes: new Set<SinoReadingClass>(), evidenceRefs: new Set<string>()
        };
        entry.classes.add(classification);
        entry.evidenceRefs.add(`${sourceRef}:row:${row.number}:column:${column}:char:${character}`);
        byKey.set(key, entry);
      }
      const nonHan = Array.from(value).filter((character) => !HAN.test(character)).join('');
      if (nonHan) remainders.push({ row: row.number, column, text: nonHan });
    }
  }

  const entries = [...byKey.values()].map((entry) => ({
    character: entry.character,
    modernReading: entry.modernReading,
    classes: [...entry.classes].sort(),
    evidenceRefs: [...entry.evidenceRefs].sort()
  })).sort((a, b) => a.character.localeCompare(b.character) || a.modernReading.localeCompare(b.modernReading));
  return { headers: expectedHeaders, entries, remainders, rowCount: rows.length };
}

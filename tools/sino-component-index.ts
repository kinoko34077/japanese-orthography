import { encodeSection, StringTable } from './browser-pack-encoding.ts';

/**
 * 字音分類を汎用 rules/bindings の eager 表現から切り離すための compact projection。
 * 値そのものは削らず、分類はbit flag、文字列はsection内の共有tableへ正規化する。
 */
export const SINO_READING_CLASS_FLAGS = {
  go_only: 1,
  go_kan_common: 2,
  kan_only: 4,
  customary: 8
} as const;

export type SinoReadingClass = keyof typeof SINO_READING_CLASS_FLAGS;

export interface SinoComponentIndexRow {
  readonly character: string;
  readonly modernReading: string;
  readonly classFlags: number;
  readonly sourceRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export function encodeSinoComponentIndex(rows: readonly SinoComponentIndexRow[]): Uint8Array {
  const strings = new StringTable();
  return encodeSection([
    { name: 'strings', kind: 'strings', values: strings.values },
    { name: 'character', kind: 'scalar', values: rows.map((row) => strings.id(row.character)) },
    { name: 'modernReading', kind: 'scalar', values: rows.map((row) => strings.id(row.modernReading)) },
    { name: 'classFlags', kind: 'scalar', values: rows.map((row) => row.classFlags) },
    { name: 'sourceRefs', kind: 'list', values: rows.map((row) => row.sourceRefs.map((ref) => strings.id(ref))) },
    { name: 'evidenceRefs', kind: 'list', values: rows.map((row) => row.evidenceRefs.map((ref) => strings.id(ref))) }
  ]);
}


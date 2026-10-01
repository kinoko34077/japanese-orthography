import { chooseElementWidth, type BrowserPackElementWidth } from './browser-pack-model.ts';

// BrowserPack B (#185 B): deterministic writer for the binary-columnar section container decoded by
// runtime/browser-pack-binary.js. Widths follow the A width model (`chooseElementWidth`).

export type ColumnInput =
  | { readonly name: string; readonly kind: 'scalar'; readonly values: readonly number[]; readonly width?: BrowserPackElementWidth }
  | { readonly name: string; readonly kind: 'list'; readonly values: readonly (readonly number[])[]; readonly width?: BrowserPackElementWidth }
  | { readonly name: string; readonly kind: 'strings'; readonly values: readonly string[] };

const FLAG_LIST = 1;
const FLAG_UTF8 = 2;
const utf8 = new TextEncoder();
const align4 = (n: number) => (n + 3) & ~3;

const maxOf = (values: Iterable<number>) => {
  let max = 0;
  for (const v of values) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`BrowserPack encoding: ${v} is not a non-negative integer`);
    if (v > max) max = v;
  }
  return max;
};

interface Planned { name: Uint8Array; width: BrowserPackElementWidth; flags: number; rows: number; elements: number; data: number[]; offsets: number[] | null }

export function encodeSection(columns: readonly ColumnInput[]): Uint8Array {
  const planned: Planned[] = columns.map((column) => {
    const name = utf8.encode(column.name);
    if (column.kind === 'scalar') {
      return { name, width: column.width ?? chooseElementWidth(maxOf(column.values)), flags: 0, rows: column.values.length, elements: 0, data: [...column.values], offsets: null };
    }
    const lists = column.kind === 'strings' ? column.values.map((s) => [...utf8.encode(s)]) : column.values.map((l) => [...l]);
    const offsets = [0];
    for (const list of lists) offsets.push(offsets[offsets.length - 1]! + list.length);
    const data = lists.flat();
    const width = column.kind === 'strings' ? 1 : (column.width ?? chooseElementWidth(maxOf(data)));
    return { name, width, flags: FLAG_LIST | (column.kind === 'strings' ? FLAG_UTF8 : 0), rows: lists.length, elements: data.length, data, offsets };
  });
  const headerBytes = 8 + planned.reduce((n, p) => n + 2 + p.name.length + 18, 0);
  let cursor = align4(headerBytes);
  const placement = planned.map((p) => {
    const dataOffset = cursor;
    cursor = align4(cursor + (p.offsets ? p.elements : p.rows) * p.width);
    let offsetsOffset = 0;
    if (p.offsets) { offsetsOffset = cursor; cursor = align4(cursor + p.offsets.length * 4); }
    return { dataOffset, offsetsOffset };
  });
  const buffer = new ArrayBuffer(cursor);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  bytes.set([0x42, 0x50, 0x4b, 0x31], 0);
  view.setUint32(4, planned.length, true);
  let at = 8;
  planned.forEach((p, i) => {
    view.setUint16(at, p.name.length, true); at += 2;
    bytes.set(p.name, at); at += p.name.length;
    view.setUint8(at, p.width); at += 1;
    view.setUint8(at, p.flags); at += 1;
    view.setUint32(at, p.rows, true); at += 4;
    view.setUint32(at, p.elements, true); at += 4;
    view.setUint32(at, placement[i]!.dataOffset, true); at += 4;
    view.setUint32(at, placement[i]!.offsetsOffset, true); at += 4;
    const { dataOffset, offsetsOffset } = placement[i]!;
    p.data.forEach((v, k) => {
      const o = dataOffset + k * p.width;
      if (p.width === 1) view.setUint8(o, v); else if (p.width === 2) view.setUint16(o, v, true); else view.setUint32(o, v, true);
    });
    if (p.offsets) p.offsets.forEach((v, k) => view.setUint32(offsetsOffset + k * 4, v, true));
  });
  return bytes;
}

/** Deterministic local string table: first-use order, id 0 reserved for "absent". */
export class StringTable {
  private readonly ids = new Map<string, number>();
  readonly values: string[] = [''];
  id(value: string | undefined | null): number {
    if (value === undefined || value === null) return 0;
    let id = this.ids.get(value);
    if (id === undefined) { id = this.values.length; this.values.push(value); this.ids.set(value, id); }
    return id;
  }
}

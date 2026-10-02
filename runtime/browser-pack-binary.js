(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.BrowserPackBinary = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // BrowserPack v1 binary-columnar section container (#185 B). Decoding only: every column becomes a
  // TypedArray *view* over the section's ArrayBuffer (no copy, no object graph). Layout:
  //
  //   "BPK1"  u32 columnCount
  //   per column: u16 nameLength, name (UTF-8), u8 width (1|2|4), u8 flags (bit0 list, bit1 utf8),
  //               u32 rowCount, u32 elementCount, u32 dataOffset, u32 offsetsOffset
  //   data regions, each 4-byte aligned; list columns carry u32 offsets[rowCount + 1]
  //
  // All integers are little-endian. Anything malformed fails closed.

  const MAGIC = [0x42, 0x50, 0x4b, 0x31]; // "BPK1"
  const FLAG_LIST = 1;
  const FLAG_UTF8 = 2;
  const decoder = typeof TextDecoder === "function" ? new TextDecoder("utf-8", { fatal: true }) : null;

  const typedView = (buffer, byteOffset, width, length) => {
    if (width === 1) return new Uint8Array(buffer, byteOffset, length);
    if (width === 2) return new Uint16Array(buffer, byteOffset, length);
    if (width === 4) return new Uint32Array(buffer, byteOffset, length);
    throw new RangeError(`BrowserPack section: unsupported element width ${width}`);
  };

  const decodeSection = (input) => {
    // Views are created directly over the caller's buffer when it is 4-byte aligned (a section inside
    // a bundle shares the bundle's ArrayBuffer: no copy); otherwise the bytes are copied once.
    let buffer = input;
    let base = 0;
    let length = input.byteLength;
    if (!(input instanceof ArrayBuffer)) {
      if (input.byteOffset % 4 === 0) { buffer = input.buffer; base = input.byteOffset; }
      else buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    }
    const bytes = new Uint8Array(buffer, base, length);
    const view = new DataView(buffer, base, length);
    if (bytes.length < 8 || MAGIC.some((b, i) => bytes[i] !== b)) throw new TypeError("BrowserPack section: bad magic");
    const columnCount = view.getUint32(4, true);
    let at = 8;
    const columns = {};
    const need = (n) => { if (at + n > bytes.length) throw new RangeError("BrowserPack section: truncated header"); };
    for (let c = 0; c < columnCount; c += 1) {
      need(2);
      const nameLength = view.getUint16(at, true); at += 2;
      need(nameLength + 18);
      const name = decoder ? decoder.decode(bytes.subarray(at, at + nameLength)) : String.fromCharCode(...bytes.subarray(at, at + nameLength));
      at += nameLength;
      const width = view.getUint8(at); at += 1;
      const flags = view.getUint8(at); at += 1;
      const rowCount = view.getUint32(at, true); at += 4;
      const elementCount = view.getUint32(at, true); at += 4;
      const dataOffset = view.getUint32(at, true); at += 4;
      const offsetsOffset = view.getUint32(at, true); at += 4;
      if (Object.prototype.hasOwnProperty.call(columns, name)) throw new TypeError(`BrowserPack section: duplicate column ${name}`);
      const list = (flags & FLAG_LIST) !== 0;
      const count = list ? elementCount : rowCount;
      if (dataOffset % width !== 0 || dataOffset + count * width > bytes.length) throw new RangeError(`BrowserPack section: column ${name} data out of range`);
      const values = typedView(buffer, base + dataOffset, width, count);
      let offsets = null;
      if (list) {
        if (offsetsOffset % 4 !== 0 || offsetsOffset + (rowCount + 1) * 4 > bytes.length) throw new RangeError(`BrowserPack section: column ${name} offsets out of range`);
        offsets = new Uint32Array(buffer, base + offsetsOffset, rowCount + 1);
        if (offsets[0] !== 0 || offsets[rowCount] !== elementCount) throw new RangeError(`BrowserPack section: column ${name} offsets do not span its elements`);
        for (let i = 0; i < rowCount; i += 1) if (offsets[i] > offsets[i + 1]) throw new RangeError(`BrowserPack section: column ${name} offsets are not monotone`);
      }
      columns[name] = { name, width, list, utf8: (flags & FLAG_UTF8) !== 0, rowCount, values, offsets };
    }
    const column = (name) => {
      const found = columns[name];
      if (!found) throw new TypeError(`BrowserPack section: missing column ${name}`);
      return found;
    };
    return {
      columns,
      column,
      rowCount: (name) => column(name).rowCount,
      /** scalar value of row i */
      value: (name, i) => {
        const col = column(name);
        if (col.list || i < 0 || i >= col.rowCount) throw new RangeError(`BrowserPack section: ${name}[${i}] out of range`);
        return col.values[i];
      },
      /** list value of row i as a TypedArray view */
      list: (name, i) => {
        const col = column(name);
        if (!col.list || i < 0 || i >= col.rowCount) throw new RangeError(`BrowserPack section: ${name}[${i}] out of range`);
        return col.values.subarray(col.offsets[i], col.offsets[i + 1]);
      },
      /** UTF-8 string row i of a utf8 column */
      string: (name, i) => {
        const col = column(name);
        if (!col.utf8 || i < 0 || i >= col.rowCount) throw new RangeError(`BrowserPack section: ${name}[${i}] out of range`);
        const slice = col.values.subarray(col.offsets[i], col.offsets[i + 1]);
        return decoder ? decoder.decode(slice) : decodeURIComponent(escape(String.fromCharCode(...slice)));
      }
    };
  };

  // Bundle container (#196 I): several sections of one shard in one fetch / one ArrayBuffer.
  //   "BPKB", u32 partCount, per part: u16 nameLength, name (UTF-8), u32 offset, u32 length;
  //   parts are 8-byte aligned and decoded as zero-copy views into the bundle buffer.
  const BUNDLE_MAGIC = [0x42, 0x50, 0x4b, 0x42];
  const decodeBundle = (input) => {
    const buffer = input instanceof ArrayBuffer ? input : (input.byteOffset % 8 === 0 ? input.buffer : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
    const base = input instanceof ArrayBuffer || input.byteOffset % 8 !== 0 ? 0 : input.byteOffset;
    const length = input.byteLength;
    const bytes = new Uint8Array(buffer, base, length);
    const view = new DataView(buffer, base, length);
    if (length < 8 || BUNDLE_MAGIC.some((b, i) => bytes[i] !== b)) throw new TypeError("BrowserPack bundle: bad magic");
    const partCount = view.getUint32(4, true);
    let at = 8;
    const parts = {};
    for (let p = 0; p < partCount; p += 1) {
      if (at + 2 > length) throw new RangeError("BrowserPack bundle: truncated header");
      const nameLength = view.getUint16(at, true); at += 2;
      if (at + nameLength + 8 > length) throw new RangeError("BrowserPack bundle: truncated header");
      const name = decoder ? decoder.decode(bytes.subarray(at, at + nameLength)) : String.fromCharCode(...bytes.subarray(at, at + nameLength));
      at += nameLength;
      const offset = view.getUint32(at, true); at += 4;
      const partLength = view.getUint32(at, true); at += 4;
      if (offset % 8 !== 0 || offset + partLength > length) throw new RangeError(`BrowserPack bundle: part ${name} out of range`);
      if (Object.prototype.hasOwnProperty.call(parts, name)) throw new TypeError(`BrowserPack bundle: duplicate part ${name}`);
      parts[name] = decodeSection(new Uint8Array(buffer, base + offset, partLength));
    }
    return { parts, part: (name) => { if (!parts[name]) throw new TypeError(`BrowserPack bundle: missing part ${name}`); return parts[name]; } };
  };

  return { decodeSection, decodeBundle, MAGIC, FLAG_LIST, FLAG_UTF8 };
});

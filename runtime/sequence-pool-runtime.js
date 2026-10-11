(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SequencePoolRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Sequence Pool runtime (#208 §7, #211 C). Every textual runtime payload is a Sequence: a list of
  // SymbolIds stored once. A pool section has one list column `symbols` (row = SequenceId, element =
  // SymbolId, fixed uint16 while the registry stays below 65,536 ids). Sequences are sorted by their
  // SymbolId lists, so a symbolized key is found by binary search — no Unicode string is needed on
  // the lookup path. Text is produced only at the edge (`text`), from the Symbol Registry atoms.

  const compareSymbols = (a, b) => {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
  };

  const createSequencePool = (section, atoms) => {
    const count = section.rowCount("symbols");
    if (!Array.isArray(atoms)) throw new TypeError("SequencePoolRuntime: registry atoms required");
    const symbols = (id) => {
      if (!Number.isInteger(id) || id < 0 || id >= count) throw new RangeError(`SequencePoolRuntime: SequenceId ${id} out of range`);
      return section.list("symbols", id);
    };
    const cache = new Map();
    const text = (id) => {
      let s = cache.get(id);
      if (s === undefined) {
        s = "";
        for (const symbol of symbols(id)) {
          const atom = atoms[symbol - 1];
          if (atom === undefined) throw new RangeError(`SequencePoolRuntime: SymbolId ${symbol} out of range`);
          s += atom;
        }
        cache.set(id, s);
      }
      return s;
    };
    /** SequenceId of a SymbolId list, or -1. */
    const find = (key) => {
      let lo = 0;
      let hi = count - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const c = compareSymbols(symbols(mid), key);
        if (c === 0) return mid;
        if (c < 0) lo = mid + 1;
        else hi = mid - 1;
      }
      return -1;
    };
    return { count, symbols, text, find };
  };

  // #325: Rule Programの直接indexに無いprefixならraw pool.findを安全に省略する。
  // フルSymbolId列ではなく先頭2字だけを保持。上下文脈やkana別表記への検索は除外対象ではない。
  const createIndexPrefixGuard = (indexedSequenceIds, symbolsOf) => {
    const singles = new Set();
    const pairs = new Map();
    for (const sequenceId of indexedSequenceIds) {
      const symbols = symbolsOf(sequenceId);
      if (symbols.length === 1) {
        singles.add(symbols[0]);
      } else if (symbols.length >= 2) {
        const first = symbols[0];
        let followers = pairs.get(first);
        if (!followers) { followers = new Set(); pairs.set(first, followers); }
        followers.add(symbols[1]);
      }
    }
    return Object.freeze({
      mayContain: (length, first, second) => {
        // 空キーが存在する構成や未知条件では必ず旧検索に戻る。
        if (length === 0) return true;
        if (length === 1) return singles.has(first);
        return length >= 2 && (pairs.get(first)?.has(second) ?? false);
      },
      prefixGroups: pairs.size,
      singleSymbols: singles.size
    });
  };

  return { createSequencePool, compareSymbols, createIndexPrefixGuard };
});

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SymbolRegistryRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Append-only Symbol Registry runtime (#208 §6, #211 B). The registry maps every orthographic atom
  // the accepted knowledge needs to a stable integer SymbolId (ids start at 1; 0 is never assigned).
  // Unicode stays the external/canonical identity; SymbolIds are the hot-runtime identity.
  //
  // An orthographic atom is one base code point plus any following combining marks / variation
  // selectors (IVS, VS1-16, ZWJ-joined marks are kept with their base), so a source-significant
  // variation sequence is one atom and is never collapsed into its base character.
  //
  // `symbolize` never loses input: atoms the registry does not know become raw passthrough tokens and
  // `desymbolize` restores the exact Unicode.

  const isExtender = (cp) =>
    (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef) || // variation selectors
    (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x3099 && cp <= 0x309a) || // combining diacritics, kana voicing marks
    (cp >= 0x1ab0 && cp <= 0x1aff) || (cp >= 0x1dc0 && cp <= 0x1dff) || (cp >= 0x20d0 && cp <= 0x20ff) || (cp >= 0xfe20 && cp <= 0xfe2f) ||
    cp === 0x200d; // ZWJ binds to its neighbour

  /** Split Unicode text into orthographic atoms (UTF-16 strings). */
  const atomsOf = (text) => {
    const atoms = [];
    for (const ch of `${text ?? ""}`) {
      const cp = ch.codePointAt(0);
      if (atoms.length && isExtender(cp)) atoms[atoms.length - 1] += ch;
      else atoms.push(ch);
    }
    return atoms;
  };

  const createSymbolizer = (registry) => {
    if (!registry || registry.kind !== "japanese-orthography-symbol-registry" || !Array.isArray(registry.atoms)) {
      throw new TypeError("SymbolRegistryRuntime: unsupported registry");
    }
    const idOf = new Map();
    registry.atoms.forEach((atom, index) => {
      if (typeof atom !== "string" || atom === "") throw new TypeError(`SymbolRegistryRuntime: invalid atom at id ${index + 1}`);
      if (idOf.has(atom)) throw new Error(`SymbolRegistryRuntime: atom ${atom} has two ids`);
      idOf.set(atom, index + 1);
    });
    const tombstoned = new Set(registry.tombstones ?? []);
    const maxId = registry.atoms.length;

    /** Unicode -> tokens: a known atom is its SymbolId (number); anything else a raw string token. */
    const symbolize = (text) => atomsOf(text).map((atom) => {
      const id = idOf.get(atom);
      return id !== undefined && !tombstoned.has(id) ? id : atom;
    });
    /** Tokens -> the exact Unicode they came from. */
    const desymbolize = (tokens) => tokens.map((t) => {
      if (typeof t === "string") return t;
      if (!Number.isInteger(t) || t < 1 || t > maxId) throw new RangeError(`SymbolRegistryRuntime: SymbolId ${t} out of range`);
      return registry.atoms[t - 1];
    }).join("");
    /** SymbolId sequence (no raw tokens) for registry-covered text, else null. */
    const sequenceOf = (text) => {
      const tokens = symbolize(text);
      return tokens.every((t) => typeof t === "number") ? tokens : null;
    };
    return { symbolize, desymbolize, sequenceOf, atomOf: (id) => desymbolize([id]), idOf: (atom) => idOf.get(atom) ?? null, maxId };
  };

  return { atomsOf, createSymbolizer, isExtender };
});

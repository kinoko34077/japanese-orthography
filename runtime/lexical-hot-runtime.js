(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.LexicalHotRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Phase 4.8G browser/worker-class runtime over the hot lexical + reading-DAG artifact.
  // Lookups return typed ids (lexeme:/reading-path:); Sino reconstruction reproduces the accepted
  // 4.6E semantics from the shared convergence patterns (see tools/sino-dag-projection.ts).

  const SCHEMA = {
    "lexemes.primaryForm": "string",
    "lexemes.primaryReading": "string",
    "lexemes.ordinal": "count",
    "lexemes.readings": "string[]",
    "forms.text": "string",
    "forms.lexemes": "lexeme[]",
    "readings.text": "string",
    "readings.lexemes": "lexeme[]",
    "patterns.from": "string",
    "patterns.to": "string",
    "patterns.base": "pattern|-1",
    "patterns.derivations": "pattern[]",
    "bindings.symbol": "string",
    "bindings.modern": "string",
    "bindings.context": "string|-1",
    "bindings.patterns": "pattern[]",
    "bindings.evidence": "string[]"
  };
  const SINO_SYLLABLE = /^[ぁ-ゔ](?:[ゃゅょゎ])?(?:[いうくきちつんっ])?$/u;
  const HAN = /^\p{Script=Han}$/u;
  const MAX_RESULTS = 64;

  const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const uniqueSorted = (values) => [...new Set(values)].sort(compareText);

  const createLexicalHotRuntime = (artifact) => {
    if (artifact?.schemaVersion !== "1" || artifact?.kind !== "japanese-orthography-lexical-hot-runtime") {
      throw new TypeError("Unsupported lexical hot runtime artifact");
    }
    const schemaKeys = Object.keys(SCHEMA);
    if (
      !artifact.schema ||
      Object.keys(artifact.schema).length !== schemaKeys.length ||
      schemaKeys.some((key) => artifact.schema[key] !== SCHEMA[key])
    ) {
      throw new TypeError("Lexical hot runtime schema mismatch");
    }
    const strings = artifact.strings;
    const sizes = {
      string: strings.length,
      lexeme: artifact.lexemes.primaryForm.length,
      pattern: artifact.patterns.from.length
    };
    // Every column is range-checked against the table its schema names.
    for (const [path, type] of Object.entries(SCHEMA)) {
      const [table, column] = path.split(".");
      const values = artifact[table]?.[column];
      if (!Array.isArray(values)) throw new TypeError(`Lexical hot runtime missing ${path}`);
      const target = type.replace(/\[\]$|\|-1$/u, "");
      const optional = type.endsWith("|-1");
      const check = (value) => {
        if (optional && value === -1) return;
        if (target === "count") {
          if (!Number.isInteger(value) || value < 0) throw new RangeError(`Lexical hot runtime ${path} invalid count ${value}`);
          return;
        }
        if (!Number.isInteger(value) || value < 0 || value >= sizes[target]) {
          throw new RangeError(`Lexical hot runtime ${path} index ${value} out of ${target} range`);
        }
      };
      for (const value of values) {
        if (type.endsWith("[]")) {
          if (!Array.isArray(value)) throw new TypeError(`Lexical hot runtime ${path} expects lists`);
          value.forEach(check);
        } else check(value);
      }
    }

    for (const column of ["primaryReading", "ordinal", "readings"]) {
      if (artifact.lexemes[column].length !== sizes.lexeme) throw new TypeError(`Lexical hot runtime lexemes.${column} length mismatch`);
    }
    const lexemeId = (index) => {
      const ordinal = artifact.lexemes.ordinal[index];
      return `lexeme:${strings[artifact.lexemes.primaryForm[index]]}/${strings[artifact.lexemes.primaryReading[index]]}${ordinal ? `#${ordinal}` : ""}`;
    };
    const buildIndex = (table) => {
      const map = new Map();
      table.text.forEach((text, i) => map.set(strings[text], table.lexemes[i]));
      return map;
    };
    const formIndex = buildIndex(artifact.forms);
    const readingIndex = buildIndex(artifact.readings);

    const lookupForm = (text) => (formIndex.get(text) ?? []).map((index) => ({
      lexeme: lexemeId(index),
      readings: artifact.lexemes.readings[index].map((r) => `reading-path:${strings[r]}`)
    }));
    const lookupReading = (text) => (readingIndex.get(text) ?? []).map(lexemeId);

    // character -> every (modern surface form, historical, context, evidence) reachable from its bindings
    const matchesByCharacter = new Map();
    const tableForms = new Set();
    const { patterns, bindings } = artifact;
    bindings.symbol.forEach((symbol, b) => {
      const character = strings[symbol];
      const list = matchesByCharacter.get(character) ?? [];
      const context = bindings.context[b] === -1 ? null : strings[bindings.context[b]];
      const evidence = bindings.evidence[b].map((e) => strings[e]);
      for (const p of bindings.patterns[b]) {
        for (const q of [p, ...patterns.derivations[p]]) {
          list.push({ modern: strings[patterns.to[q]], historical: strings[patterns.from[q]], context, evidence });
          tableForms.add(strings[patterns.to[q]]);
        }
      }
      matchesByCharacter.set(character, list);
    });

    const segmentOptions = (character, segment, query) => {
      if (!SINO_SYLLABLE.test(segment)) return [];
      const all = (matchesByCharacter.get(character) ?? []).filter((m) => m.modern === segment);
      let matches = all;
      if (query.context !== undefined && all.length > 0) {
        const exact = all.filter((m) => m.context === query.context);
        if (exact.length > 0) matches = exact;
        else if (all.some((m) => m.context !== null)) return [];
        else matches = all.filter((m) => m.context === null);
      }
      if (matches.length > 0) return matches;
      if (tableForms.has(segment) || segment.endsWith("っ")) return [];
      return [{ historical: segment, context: null, evidence: [] }];
    };

    const reconstructWord = (surface, modernReading, query = {}) => {
      const characters = Array.from(`${surface ?? ""}`.normalize("NFC"));
      const reading = `${modernReading ?? ""}`;
      if (characters.length === 0 || reading === "" || !characters.every((c) => HAN.test(c))) return null;
      const results = new Map();
      let overflow = false;
      const walk = (i, offset, parts, components) => {
        if (overflow) return;
        if (i === characters.length) {
          if (offset !== reading.length) return;
          if (!results.has(parts)) results.set(parts, components);
          if (results.size > MAX_RESULTS) overflow = true;
          return;
        }
        for (let end = offset + 1; end <= Math.min(reading.length, offset + 4); end += 1) {
          const segment = reading.slice(offset, end);
          for (const option of segmentOptions(characters[i], segment, query)) {
            walk(i + 1, end, parts + option.historical, [...components, {
              surface: characters[i], modernReading: segment, historicalReading: option.historical,
              context: option.context, evidenceRefs: option.evidence
            }]);
          }
        }
      };
      walk(0, 0, "", []);
      if (overflow || results.size === 0) return null;
      const readings = [...results.keys()].sort(compareText);
      if (readings.length > 1) return { status: "candidates", historicalReadings: readings };
      const components = results.get(readings[0]);
      const resolved = {
        status: "resolved",
        historicalReading: readings[0],
        components,
        evidenceRefs: uniqueSorted(components.flatMap((c) => c.evidenceRefs))
      };
      if (query.context !== undefined) resolved.selectionContext = query.context;
      return resolved;
    };

    return Object.freeze({ lookupForm, lookupReading, reconstructWord, provenance: artifact.provenance });
  };

  return { createLexicalHotRuntime };
});

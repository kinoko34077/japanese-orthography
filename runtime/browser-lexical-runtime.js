(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.BrowserLexicalRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Browser lexical runtime (#196 C) over the BrowserPack v2 lexical layer (#196 B).
  //
  //   surface-index / reading-index  ->  dense lexeme ids  ->  lexeme-table / -forms / -readings
  //
  // Both routes converge on the same lexeme records, and candidates come back in the accepted
  // LexicalRuntime candidate shape (lexicalIdentity, lemma, reading, modernReadings, morphology,
  // viableBindingIds, evidenceRefs) so the accepted resolver can consume them unchanged. Ambiguity
  // is returned, never resolved: index postings are complete id lists, and a field that would need
  // a choice among equals (a reading, a morphology row, a reconstructed surface) is `null` instead.
  // Shards are fetched through the pack's digest-verified loader; nothing is inflated eagerly.

  const INDEX_KINDS = ["surface", "reading", "lexeme"];
  const MORPHOLOGY_SOURCES = ["jmdict", "unidic"];
  const FORM_FLAGS = { listed: 1, ateji: 2, iK: 4, oK: 8, io: 16, rK: 32, sK: 64 };
  const PERIODS = { 1: "modern", 2: "historical" };
  const ROUTES = [null, "native", "sino"];
  const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const isHighSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;

  const lexemeHead = (identity) => {
    const match = /^lexeme:([^/]*)\/([^#]*)(?:#\d+)?$/u.exec(identity);
    return match ? { surface: match[1], reading: match[2] } : { surface: null, reading: null };
  };

  const createBrowserLexicalRuntime = (pack) => {
    if (!pack || typeof pack.loadSection !== "function" || !pack.hasSection("lexical-directory")) {
      throw new TypeError("BrowserLexicalRuntime requires a BrowserPack v2 (lexical layer) pack");
    }
    const directory = pack.eagerSection("lexical-directory");
    const morph = pack.eagerSection("morphology-table");
    if (!directory || !morph) throw new Error("BrowserLexicalRuntime: lexical eager sections are not loaded");

    // ---- eager: shard ranges + morphology --------------------------------------------------------
    const ranges = { surface: [], reading: [], lexeme: [] };
    let lexemeCount = 0;
    const maxKeyLength = { surface: 1, reading: 1 };
    const dstr = (id) => directory.string("strings", id);
    for (let i = 0; i < directory.rowCount("indexKind"); i += 1) {
      const kind = INDEX_KINDS[directory.value("indexKind", i)];
      if (!kind) throw new Error("BrowserLexicalRuntime: unknown directory index kind");
      ranges[kind].push({ index: directory.value("index", i), from: dstr(directory.value("from", i)), to: dstr(directory.value("to", i)) });
      if (kind !== "lexeme") maxKeyLength[kind] = Math.max(maxKeyLength[kind], directory.value("maxKeyLength", i));
      else lexemeCount += directory.value("keys", i);
    }
    for (const kind of INDEX_KINDS) ranges[kind].sort((a, b) => compareText(a.from, b.from));
    const shardFor = (kind, key) => {
      const list = ranges[kind];
      let lo = 0;
      let hi = list.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (compareText(key, list[mid].from) < 0) hi = mid - 1;
        else if (compareText(key, list[mid].to) > 0) lo = mid + 1;
        else return list[mid];
      }
      return null;
    };
    const lexemeShardFor = (id) => shardFor("lexeme", String(id).padStart(8, "0"));

    const morphologies = [];
    for (let i = 0; i < morph.rowCount("source"); i += 1) {
      const s = (id) => (id === 0 ? null : morph.string("strings", id));
      morphologies.push(Object.freeze({
        morphologyId: i,
        source: MORPHOLOGY_SOURCES[morph.value("source", i)],
        partOfSpeech: [...morph.list("pos", i)].map((id) => morph.string("strings", id)),
        conjugationType: s(morph.value("conjugationType", i)),
        conjugationForm: s(morph.value("conjugationForm", i)),
        surface: s(morph.value("surface", i)),
        reading: s(morph.value("reading", i)),
        lexicalOrigin: s(morph.value("lexicalOrigin", i))
      }));
    }

    // ---- on-demand shards --------------------------------------------------------------------------
    const indexShards = new Map(); // `${kind}/${index}` -> Map(key -> ids)
    const lexemeShards = new Map(); // index -> { first, table, forms, readings }
    const loadIndexShard = async (kind, index) => {
      const cacheKey = `${kind}/${index}`;
      if (indexShards.has(cacheKey)) return indexShards.get(cacheKey);
      const body = await pack.loadSection(`${kind}-index@${kind}/${index}`);
      const keys = new Map(); // key -> { ids, postings (lazily decoded) }
      const offsets = body.column("lexemes").offsets;
      const str = (id) => { const v = body.string("strings", id); if (v === undefined) throw new Error("BrowserLexicalRuntime: dangling string id"); return v; };
      for (let row = 0; row < body.rowCount("key"); row += 1) {
        const ids = [...body.list("lexemes", row)];
        for (const id of ids) if (id >= lexemeCount) throw new Error(`BrowserLexicalRuntime: dangling lexeme id ${id}`);
        const first = offsets[row];
        let postings = null;
        keys.set(str(body.value("key", row)), {
          ids,
          postings: () => postings ?? (postings = ids.map((lexemeId, j) => {
            const at = first + j;
            const morphologyIds = [...body.list("pMorphology", at)];
            for (const m of morphologyIds) if (m >= morphologies.length) throw new Error(`BrowserLexicalRuntime: dangling morphology id ${m}`);
            const tuples = kind === "surface" ? [...body.list("pHistorical", at)] : [];
            if (tuples.length % 5 !== 0) throw new Error("BrowserLexicalRuntime: malformed historical posting");
            const historical = [];
            for (let i = 0; i < tuples.length; i += 5) historical.push({
              reading: str(tuples[i]), route: ROUTES[tuples[i + 1]] ?? null, factIndex: tuples[i + 2],
              basisReading: tuples[i + 3] === 0 ? null : str(tuples[i + 3]), candidate: tuples[i + 4] === 1
            });
            const modern = [...body.list("pModern", at)].map(str);
            const priorityTuples = [...body.list("pDisplayPriority", at)];
            const displayReadingPreferences = [];
            for (let i = 0; i < priorityTuples.length;) {
              const reading = str(priorityTuples[i++]);
              const count = priorityTuples[i++];
              const priorities = priorityTuples.slice(i, i + count).map(str);
              i += count;
              displayReadingPreferences.push({ reading, priorities });
            }
            return { lexemeId, lexicalIdentity: str(body.value("pIdentity", at)), morphologyIds, modern, displayReadingPreferences, historical };
            return { lexemeId, lexicalIdentity: str(body.value("pIdentity", at)), morphologyIds, modern, displayReadingPreferences, historical };
          }))
        });
      }
      indexShards.set(cacheKey, keys);
      return keys;
    };
    const loadLexemeShard = async (id) => {
      if (!Number.isInteger(id) || id < 0 || id >= lexemeCount) throw new RangeError(`BrowserLexicalRuntime: lexeme id ${id} out of range`);
      const range = lexemeShardFor(id);
      if (!range) throw new Error(`BrowserLexicalRuntime: no lexeme shard for id ${id}`);
      if (lexemeShards.has(range.index)) return lexemeShards.get(range.index);
      const [table, forms, readings] = await Promise.all([
        pack.loadSection(`lexeme-table@lexeme/${range.index}`),
        pack.loadSection(`lexeme-forms@lexeme/${range.index}`),
        pack.loadSection(`lexeme-readings@lexeme/${range.index}`)
      ]);
      const shard = { first: Number(range.from), table, forms, readings };
      lexemeShards.set(range.index, shard);
      return shard;
    };

    const lexemeSync = (id) => {
      const range = lexemeShardFor(id);
      const shard = range && lexemeShards.get(range.index);
      if (!shard) throw new Error(`BrowserLexicalRuntime: lexeme ${id} not prepared`);
      const row = id - shard.first;
      const t = shard.table;
      const identity = t.string("strings", t.value("identity", row));
      const head = lexemeHead(identity);
      const fs = (sid) => shard.forms.string("strings", sid);
      const rs = (sid) => (sid === 0 ? null : shard.readings.string("strings", sid));
      const formSurface = [...shard.forms.list("surface", row)];
      const formFlags = [...shard.forms.list("flags", row)];
      const formFact = [...shard.forms.list("factIndex", row)];
      const rSurface = [...shard.readings.list("surface", row)];
      const rReading = [...shard.readings.list("reading", row)];
      const rPeriod = [...shard.readings.list("period", row)];
      const rFact = [...shard.readings.list("factIndex", row)];
      const rRoute = [...shard.readings.list("route", row)];
      const rBasis = [...shard.readings.list("basisReading", row)];
      const rCandidate = [...shard.readings.list("candidate", row)];
      const rPriority = [...shard.readings.list("displayPriority", row)];
      const priorityByReading = new Map();
      for (let i = 0; i < rPriority.length;) {
        const reading = rs(rPriority[i++]);
        const count = rPriority[i++];
        const priorities = rPriority.slice(i, i + count).map((id) => rs(id));
        i += count;
        priorityByReading.set(reading, [...new Set([...(priorityByReading.get(reading) ?? []), ...priorities])].sort(compareText));
      }
      for (const m of t.list("morphology", row)) if (m >= morphologies.length) throw new Error(`BrowserLexicalRuntime: dangling morphology id ${m}`);
      return {
        lexemeId: id,
        lexicalIdentity: identity,
        headSurface: head.surface,
        headReading: head.reading,
        morphologyIds: [...t.list("morphology", row)],
        forms: formSurface.map((sid, i) => ({
          surface: fs(sid),
          flags: Object.keys(FORM_FLAGS).filter((name) => (formFlags[i] & FORM_FLAGS[name]) !== 0),
          factIndex: formFact[i]
        })),
        readings: rSurface.map((sid, i) => ({
          surface: rs(sid), reading: rs(rReading[i]), basisReading: rs(rBasis[i]), displayPriority: priorityByReading.get(rs(rReading[i])) ?? [],
          period: PERIODS[rPeriod[i]], route: ROUTES[rRoute[i]] ?? null,
          candidate: rCandidate[i] === 1, factIndex: rFact[i]
        }))
      };
    };

    // morphology for a candidate: the unique UniDic row of that reading (the accepted resolver's
    // morphology source), else the unique JMdict POS row; several rows of the deciding source stay
    // unresolved (`null`). A UniDic row of another reading never applies.
    const chooseMorphologyRow = (ids, reading, surface) => {
      const rows = ids.map((id) => morphologies[id]);
      const inScope = (m) => (m.surface === null || m.surface === surface) && (m.reading === null || m.reading === reading);
      const unidic = rows.filter((m) => m.source === "unidic" && inScope(m));
      if (unidic.length) return unidic.length === 1 ? unidic[0] : null;
      const jmdict = rows.filter((m) => m.source === "jmdict" && inScope(m));
      return jmdict.length === 1 ? jmdict[0] : null;
    };
    const morphologyOf = (row) => row && { partOfSpeech: [...row.partOfSpeech], conjugationType: row.conjugationType, conjugationForm: row.conjugationForm, source: row.source };
    // same rule as the accepted LexicalRuntime.chooseReading: single reading, else the lemma's own
    const chooseReading = (headReading, modernReadings) => {
      if (modernReadings.length === 0) return null;
      if (modernReadings.length === 1) return modernReadings[0];
      return modernReadings.includes(headReading) ? headReading : null;
    };

    /** Accepted-LexicalRuntime-shaped candidate for `lexeme` observed as `surface` (or via `reading`). */
    const candidate = (lexeme, surface, viaReading) => {
      const modernFor = (s) => [...new Set(lexeme.readings.filter((r) => r.period === "modern" && r.surface === s).map((r) => r.reading))].sort(compareText);
      const historical = lexeme.readings.filter((r) => r.period === "historical");
      let resolvedSurface = surface;
      if (viaReading !== undefined) {
        // reading route: the surface is reconstructed only when the identity names it, or it is unique
        const carriers = [...new Set(lexeme.readings.filter((r) => r.reading === viaReading && r.surface !== null).map((r) => r.surface))].sort(compareText);
        resolvedSurface = lexeme.headReading === viaReading && carriers.includes(lexeme.headSurface) ? lexeme.headSurface : carriers.length === 1 ? carriers[0] : null;
      }
      const modernReadings = resolvedSurface === null ? (viaReading ? [viaReading] : []) : modernFor(resolvedSurface);
      const reading = viaReading !== undefined ? viaReading : chooseReading(lexeme.headReading, modernReadings);
      const displayReadingPreferences = [...new Map(lexeme.readings
        .filter((r) => r.period === "modern" && (resolvedSurface === null || r.surface === resolvedSurface))
        .map((r) => [r.reading, [...r.displayPriority]]))]
        .map(([value, priorities]) => ({ reading: value, priorities }));
      const morphologyRow = chooseMorphologyRow(lexeme.morphologyIds, reading, resolvedSurface);
      return {
        lexicalIdentity: lexeme.lexicalIdentity,
        lemma: lexeme.headSurface ?? lexeme.headReading,
        surface: resolvedSurface,
        reading,
        displayPriority: displayReadingPreferences.find((entry) => entry.reading === reading)?.priorities ?? [],
        displayReadingPreferences,
        lexicalReading: lexeme.headReading,
        modernReadings,
        historicalReadings: historical.map((r) => ({
          surface: r.surface, reading: r.reading, basisReading: r.basisReading,
          route: r.route, candidate: r.candidate, factIndex: r.factIndex
        })),
        lexicalOrigin: morphologyRow?.lexicalOrigin ?? "unknown",
        morphology: morphologyOf(morphologyRow),
        morphologyCandidates: lexeme.morphologyIds.map((id) => ({ ...morphologies[id], partOfSpeech: [...morphologies[id].partOfSpeech] })),
        forms: lexeme.forms.map((f) => ({ surface: f.surface, flags: [...f.flags] })),
        components: [],
        viableBindingIds: [lexeme.lexicalIdentity],
        evidenceRefs: [lexeme.lexicalIdentity],
        lexemeId: lexeme.lexemeId,
        factRefs: [...lexeme.forms.map((f) => f.factIndex), ...lexeme.readings.map((r) => r.factIndex)]
      };
    };

    /**
     * Candidate built from an index posting (#196 I): the posting carries the identity, the readings
     * of this key, the historical readings of this surface, forms and morphology ids, so conversion
     * never fetches whole lexeme records. Same shape and choice rules as `candidate(lexeme, ...)`.
     */
    const postingCandidate = (kind, key, posting) => {
      const head = lexemeHead(posting.lexicalIdentity);
      let surface = key;
      let modernReadings = posting.modern;
      let reading;
      if (kind === "reading") {
        const carriers = posting.modern; // surfaces carrying this reading
        surface = head.reading === key && carriers.includes(head.surface) ? head.surface : carriers.length === 1 ? carriers[0] : null;
        modernReadings = [key];
        reading = key;
      } else {
        reading = chooseReading(head.reading, modernReadings);
      }
      const morphologyRow = chooseMorphologyRow(posting.morphologyIds, reading, surface);
      return {
        lexicalIdentity: posting.lexicalIdentity,
        lemma: head.surface ?? head.reading,
        surface,
        reading,
        displayPriority: posting.displayReadingPreferences.find((entry) => entry.reading === reading)?.priorities ?? [],
        displayReadingPreferences: posting.displayReadingPreferences,
        lexicalReading: head.reading,
        modernReadings: [...modernReadings],
        historicalReadings: kind === "surface" ? posting.historical.map((h) => ({
          surface: key, reading: h.reading, basisReading: h.basisReading,
          route: h.route, candidate: h.candidate, factIndex: h.factIndex
        })) : [],
        lexicalOrigin: morphologyRow?.lexicalOrigin ?? "unknown",
        morphology: morphologyOf(morphologyRow),
        morphologyCandidates: posting.morphologyIds.map((id) => ({ ...morphologies[id], partOfSpeech: [...morphologies[id].partOfSpeech] })),
        morphologyIds: [...posting.morphologyIds],
        // whole form lists are lexeme-record detail (getForms); conversion postings do not carry them
        forms: null,
        components: [],
        viableBindingIds: [posting.lexicalIdentity],
        evidenceRefs: [posting.lexicalIdentity],
        lexemeId: posting.lexemeId,
        factRefs: posting.historical.map((h) => h.factIndex)
      };
    };

    const entryFor = async (kind, key) => {
      const range = shardFor(kind, key);
      if (!range) return null;
      return (await loadIndexShard(kind, range.index)).get(key) ?? null;
    };
    const entryForSync = (kind, key) => {
      const range = shardFor(kind, key);
      if (!range) return null;
      const shard = indexShards.get(`${kind}/${range.index}`);
      if (!shard) throw new Error(`BrowserLexicalRuntime: ${kind} shard ${range.index} not prepared for "${key}"`);
      return shard.get(key) ?? null;
    };
    const candidatesOf = (kind, key, entry) => (entry ? entry.postings().map((p) => postingCandidate(kind, key, p)) : []);

    const getLexeme = async (id) => { await loadLexemeShard(id); return lexemeSync(id); };
    /** Synchronous lookups for the span planner / resolver adapter (after `prepare`). */
    const lookupSurfaceSync = (surface) => candidatesOf("surface", `${surface ?? ""}`, entryForSync("surface", `${surface ?? ""}`));
    const lookupReadingSync = (reading) => candidatesOf("reading", `${reading ?? ""}`, entryForSync("reading", `${reading ?? ""}`));
    /** Re-derive a candidate for one specific modern reading (per-reading candidates, like UniDic rows). */
      const withReading = (c, reading) => {
      const row = chooseMorphologyRow(c.morphologyIds, reading, c.surface);
      const historicalReadings = (c.historicalReadings ?? []).filter((h) =>
        h.basisReading === null ? c.modernReadings.length <= 1 : h.basisReading === reading
      );
      return {
        ...c, reading, modernReadings: [reading], displayPriority: (c.displayReadingPreferences ?? []).find((entry) => entry.reading === reading)?.priorities ?? [], historicalReadings,
        morphology: morphologyOf(row), lexicalOrigin: row?.lexicalOrigin ?? "unknown"
      };
    };
    const lookupSurface = async (surface) => candidatesOf("surface", `${surface ?? ""}`, await entryFor("surface", `${surface ?? ""}`));
    const lookupReading = async (reading) => candidatesOf("reading", `${reading ?? ""}`, await entryFor("reading", `${reading ?? ""}`));

    const keysAt = (text, start, limit) => {
      const keys = [];
      for (let end = start + 1; end <= Math.min(text.length, start + limit); end += 1) {
        if (isHighSurrogate(text.charCodeAt(end - 1))) continue; // never split a surrogate pair
        keys.push(text.slice(start, end));
      }
      return keys;
    };

    /**
     * Fetch every index shard any substring of `text` can live in, so `matchesAtSync` and the
     * synchronous lookups can be used during span planning. Index postings are self-contained: no
     * lexeme shard is fetched for conversion. Offsets are UTF-16 code units.
     */
    const prepare = async (text, options = {}) => {
      const kinds = options.reading ? ["surface", "reading"] : ["surface"];
      const needed = new Set();
      for (const kind of kinds) {
        for (let start = 0; start < text.length; start += 1) {
          for (const key of keysAt(text, start, maxKeyLength[kind])) {
            const range = shardFor(kind, key);
            if (range) needed.add(`${kind}/${range.index}`);
          }
        }
      }
      await Promise.all([...needed].map((k) => { const [kind, index] = k.split("/"); return loadIndexShard(kind, Number(index)); }));
      return { indexShards: needed.size };
    };
    /** Prepare explicit lookup keys (e.g. deinflected base forms) of one index kind. */
    const prepareKeys = async (keys, kind = "surface") => {
      const needed = new Set();
      for (const key of keys) { const range = shardFor(kind, key); if (range) needed.add(range.index); }
      await Promise.all([...needed].map((index) => loadIndexShard(kind, index)));
      return { indexShards: needed.size };
    };
    /** Lexical units starting at `start` whose surface is an index key (after `prepare`). */
    const matchesAtSync = (text, start, kind = "surface") => keysAt(text, start, maxKeyLength[kind])
      .map((key) => ({ start, end: start + key.length, key, entry: entryForSync(kind, key) }))
      .filter((m) => m.entry && m.entry.ids.length > 0)
      .map((m) => ({ start: m.start, end: m.end, surface: m.key, candidates: candidatesOf(kind, m.key, m.entry) }));

    return Object.freeze({
      lexemeCount,
      maxKeyLength: { ...maxKeyLength },
      lookupSurface,
      lookupReading,
      lookupSurfaceSync,
      lookupReadingSync,
      withReading,
      getLexeme,
      getForms: async (id) => (await getLexeme(id)).forms,
      getReadings: async (id) => (await getLexeme(id)).readings,
      getMorphology: (morphologyId) => {
        const m = morphologies[morphologyId];
        if (!m) throw new RangeError(`BrowserLexicalRuntime: morphology id ${morphologyId} out of range`);
        return { ...m, partOfSpeech: [...m.partOfSpeech] };
      },
      prepare,
      prepareKeys,
      matchesAtSync,
      loadedShards: () => ({ index: indexShards.size, lexeme: lexemeShards.size })
    });
  };

  return { createBrowserLexicalRuntime, lexemeHead };
});

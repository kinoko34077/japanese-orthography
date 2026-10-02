(function (root, factory) {
  const binary = typeof module === "object" && module.exports ? require("./browser-pack-binary.js") : root.BrowserPackBinary;
  const api = factory(binary);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.BrowserPackRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (BrowserPackBinary) {
  "use strict";

  // BrowserPack v1 runtime (#185 C): opens a pack from its manifest and a section provider and
  // answers lexical lookups directly over TypedArray views. Only eager sections are fetched at
  // open; knowledge shards are fetched for the keys an input reaches; detail shards only when a
  // span is inspected. Every fetched section is digest-checked against the manifest (fail closed),
  // so sections of two pack identities can never be combined. The trie/columnar layout stays
  // internal: callers see matches, facts, rules and details as plain values.

  if (!BrowserPackBinary || typeof BrowserPackBinary.decodeSection !== "function") {
    throw new Error("BrowserPackRuntime requires BrowserPackBinary (load browser-pack-binary.js first)");
  }
  const { decodeSection, decodeBundle } = BrowserPackBinary;

  const SCHEMA_VERSION = "1";
  const MANIFEST_KIND = "japanese-orthography-browser-pack";
  const OFFSET_UNIT = "utf16-code-unit";
  const FACT_KINDS = ["literal_form", "literal_reading", "form_relation", "reading_relation", "render_equivalence"];
  const ORIGINS = ["historically_attested", "project_defined", "kinotch_derived"];
  const RULE_CLASSES = ["diachronic", "phonological", "orthographic", "render"];
  const DIRECTIONALITIES = ["forward_only", "reverse_traversable", "forward_infer_reverse"];
  const LOSSINESS = ["lossless", "many_to_one", "one_to_many", "contextual"];
  const FLAGS = { historical: 1, modern: 2, candidate: 4, contextual: 8, safety: 16, ateji: 32 };

  const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const sortKeys = (value) => {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort(compareText).map((k) => [k, sortKeys(value[k])]));
    return value;
  };
  const toHex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const subtle = () => {
    const crypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
    if (!crypto || !crypto.subtle) throw new Error("BrowserPack runtime requires WebCrypto (crypto.subtle) to verify sections");
    return crypto.subtle;
  };
  const sha256 = async (bytes) => toHex(await subtle().digest("SHA-256", bytes));
  const utf8 = new TextEncoder();

  // Same canonical identity as tools/browser-pack-model.ts browserPackIdentity().
  const packIdentity = async (manifest) => {
    const canonical = sortKeys({
      ...manifest,
      sections: [...manifest.sections].sort((a, b) => compareText(a.sectionId, b.sectionId)),
      profiles: [...manifest.profiles].sort((a, b) => compareText(a.profileId, b.profileId))
    });
    delete canonical.packDigest;
    return sha256(utf8.encode(JSON.stringify(sortKeys(canonical))));
  };

  const openBrowserPack = async (manifest, sectionProvider, options = {}) => {
    if (manifest?.schemaVersion !== SCHEMA_VERSION || manifest?.kind !== MANIFEST_KIND) throw new TypeError("Unsupported BrowserPack manifest");
    if (manifest.runtimeContract?.schemaVersion !== SCHEMA_VERSION || manifest.runtimeContract?.externalOffsetUnit !== OFFSET_UNIT) {
      throw new TypeError("Unsupported BrowserPack runtime contract");
    }
    if (typeof sectionProvider !== "function") throw new TypeError("openBrowserPack requires a section provider");
    if ((await packIdentity(manifest)) !== manifest.packDigest) throw new Error("BrowserPack manifest digest mismatch");

    const byId = new Map(manifest.sections.map((s) => [s.sectionId, s]));
    const stats = { sectionsLoaded: 0, bytesLoaded: 0, loaded: [] };
    const cache = new Map();
    const fetchVerified = async (sectionId) => {
      if (cache.has(sectionId)) return cache.get(sectionId);
      const section = byId.get(sectionId);
      if (!section) throw new Error(`BrowserPack: unknown section ${sectionId}`);
      const promise = (async () => {
        const body = await sectionProvider(section);
        const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
        if (bytes.byteLength !== section.byteLength) throw new Error(`BrowserPack: section ${sectionId} byte length mismatch`);
        if ((await sha256(bytes)) !== section.sha256) throw new Error(`BrowserPack: section ${sectionId} digest mismatch`);
        stats.sectionsLoaded += 1;
        stats.bytesLoaded += bytes.byteLength;
        stats.loaded.push(sectionId);
        if (section.encoding === "json") return JSON.parse(new TextDecoder().decode(bytes));
        return section.encoding === "binary-bundle" ? decodeBundle(bytes) : decodeSection(bytes);
      })();
      cache.set(sectionId, promise);
      try {
        return await promise;
      } catch (error) {
        cache.delete(sectionId); // a failed or corrupt fetch is never cached; the next call refetches
        throw error;
      }
    };

    // ---- eager open -------------------------------------------------------------------------------
    const eager = manifest.sections.filter((s) => s.loading === "eager");
    const loadedEager = new Map();
    for (const section of eager) loadedEager.set(section.sectionId, await fetchVerified(section.sectionId));
    const directory = loadedEager.get("shard-directory");
    const rules = loadedEager.get("rules");
    const bindings = loadedEager.get("bindings");
    const terminology = loadedEager.get("terminology");
    const policies = new Map(manifest.profiles.map((p) => [p.profileId, loadedEager.get(p.policySectionId)]));

    const shardCount = directory.rowCount("index");
    const ranges = [];
    let maxKeyLength = 1;
    for (let i = 0; i < shardCount; i += 1) {
      ranges.push({ index: directory.value("index", i), from: directory.string("strings", directory.value("from", i)), to: directory.string("strings", directory.value("to", i)) });
      maxKeyLength = Math.max(maxKeyLength, directory.value("maxKeyLength", i));
    }
    const shardFor = (key) => {
      let lo = 0;
      let hi = ranges.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const r = ranges[mid];
        if (compareText(key, r.from) < 0) hi = mid - 1;
        else if (compareText(key, r.to) > 0) lo = mid + 1;
        else return r.index;
      }
      return -1;
    };

    // ---- knowledge shards ---------------------------------------------------------------------------
    const shards = new Map();
    const resolved = new Map(); // shard index -> opened shard, usable synchronously
    const loadShard = async (index) => {
      if (shards.has(index)) return shards.get(index);
      const promise = (async () => {
        const id = (kind) => `${kind}@surface/${index}`;
        let pool, facts, lexical;
        if (byId.has(id("knowledge-bundle"))) {
          const bundle = await fetchVerified(id("knowledge-bundle")); // v2: one fetch per shard
          [pool, facts, lexical] = [bundle.part("string-pool"), bundle.part("facts"), bundle.part("lexical-index")];
        } else {
          [pool, facts, lexical] = await Promise.all([fetchVerified(id("string-pool")), fetchVerified(id("facts")), fetchVerified(id("lexical-index"))]);
        }
        const keyRow = new Map();
        for (let i = 0; i < lexical.rowCount("key"); i += 1) keyRow.set(pool.string("strings", lexical.value("key", i)), i);
        const shard = { index, pool, facts, lexical, keyRow };
        resolved.set(index, shard);
        return shard;
      })();
      shards.set(index, promise);
      try {
        return await promise;
      } catch (error) {
        shards.delete(index);
        throw error;
      }
    };
    const factAt = (shard, row) => {
      const s = (col) => {
        const id = shard.facts.value(col, row);
        return id === 0 ? null : shard.pool.string("strings", id);
      };
      const flags = shard.facts.value("flags", row);
      return {
        kind: FACT_KINDS[shard.facts.value("kind", row)],
        surface: s("surface"),
        reading: s("reading"),
        target: s("target"),
        historical: (flags & FLAGS.historical) !== 0,
        modern: (flags & FLAGS.modern) !== 0,
        candidate: (flags & FLAGS.candidate) !== 0,
        contextual: (flags & FLAGS.contextual) !== 0,
        safety: (flags & FLAGS.safety) !== 0,
        ateji: (flags & FLAGS.ateji) !== 0,
        origin: ORIGINS[shard.facts.value("origin", row)],
        viaTarget: shard.facts.value("role", row) === 1,
        factIndex: shard.facts.value("factIndex", row),
        detailRef: `${shard.index}:${row}`
      };
    };

    const isHighSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;
    const keysAt = (text, start) => {
      const keys = [];
      for (let end = start + 1; end <= Math.min(text.length, start + maxKeyLength); end += 1) {
        if (isHighSurrogate(text.charCodeAt(end - 1))) continue; // never split a surrogate pair
        keys.push(text.slice(start, end));
      }
      return keys;
    };

    /** Fetch every knowledge shard any lexical key of `text` can live in. */
    const prepare = async (text) => {
      const needed = new Set();
      for (let start = 0; start < text.length; start += 1) {
        for (const key of keysAt(text, start)) {
          const index = shardFor(key);
          if (index >= 0) needed.add(index);
        }
      }
      await Promise.all([...needed].sort((a, b) => a - b).map(loadShard));
      return [...needed].sort((a, b) => a - b);
    };

    /** Lexical matches starting at UTF-16 offset `start` (requires `prepare`d shards). */
    const findMatchesSync = (text, start) => {
      const matches = [];
      for (const key of keysAt(text, start)) {
        const index = shardFor(key);
        if (index < 0) continue;
        const shard = resolved.get(index);
        if (!shard) throw new Error(`BrowserPack: shard ${index} not prepared for "${key}"`);
        const row = shard.keyRow.get(key);
        if (row === undefined) continue;
        matches.push({ start, end: start + key.length, surface: key, facts: [...shard.lexical.list("rows", row)].map((r) => factAt(shard, r)) });
      }
      return matches;
    };
    const findMatches = async (text, start) => {
      await Promise.all(keysAt(text, start).map(shardFor).filter((i) => i >= 0).map(loadShard));
      return findMatchesSync(text, start);
    };

    const ruleAt = (row) => {
      const s = (id) => rules.string("strings", id);
      const predicate = rules.value("predicate", row);
      return {
        id: s(rules.value("id", row)),
        class: RULE_CLASSES[rules.value("class", row)],
        directionality: DIRECTIONALITIES[rules.value("directionality", row)],
        lossiness: LOSSINESS[rules.value("lossiness", row)],
        from: [...rules.list("from", row)].map(s),
        to: [...rules.list("to", row)].map(s),
        dependencies: [...rules.list("dependencies", row)].map(s),
        predicate: predicate === 0 ? null : JSON.parse(s(predicate)),
        origin: ORIGINS[rules.value("origin", row)],
        sourceRefs: [...rules.list("sourceRefs", row)].map(s),
        evidenceRefs: [...rules.list("evidenceRefs", row)].map(s)
      };
    };
    const bindingAt = (row) => {
      const s = (id) => bindings.string("strings", id);
      return {
        id: s(bindings.value("id", row)),
        rule: bindings.value("rule", row),
        lexicalRefs: [...bindings.list("lexicalRefs", row)].map(s),
        contextRefs: [...bindings.list("contextRefs", row)].map(s),
        sourceRefs: [...bindings.list("sourceRefs", row)].map(s),
        evidenceRefs: [...bindings.list("evidenceRefs", row)].map(s)
      };
    };

    const loadDetail = async (detailRef) => {
      const match = /^(\d+):(\d+)$/u.exec(`${detailRef}`);
      if (!match) throw new TypeError(`BrowserPack: malformed detailRef ${detailRef}`);
      const [shardIndex, row] = [Number(match[1]), Number(match[2])];
      const detail = await fetchVerified(`detail-shard@surface/${shardIndex}`);
      const s = (id) => detail.string("strings", id);
      const compact = Object.prototype.hasOwnProperty.call(detail.columns, "evidencePrefix");
      let factId;
      let evidenceRefs;
      if (compact) {
        // v2 compact detail (#196 I): id derived from the facts row, evidence = prefix + suffix
        const explicit = detail.value("factId", row);
        if (explicit !== 0) factId = s(explicit);
        else {
          const fact = factAt(await loadShard(shardIndex), row);
          factId = `fact:${fact.kind}:${fact.surface ?? ""}|${fact.reading ?? ""}|${fact.target ?? ""}`;
        }
        const prefix = [...detail.list("evidencePrefix", row)].map(s);
        evidenceRefs = [...detail.list("evidenceSuffix", row)].map((x, i) => `${prefix[i]}${s(x)}`);
      } else {
        factId = s(detail.value("factId", row));
        evidenceRefs = [...detail.list("evidenceRefs", row)].map(s);
      }
      return {
        factId,
        lexicalRefs: [...detail.list("lexicalRefs", row)].map(s),
        tags: [...detail.list("tags", row)].map(s),
        sourceRefs: [...detail.list("sourceRefs", row)].map(s),
        evidenceRefs
      };
    };

    return Object.freeze({
      packDigest: manifest.packDigest,
      canonicalGraphSha256: manifest.canonicalGraphSha256,
      profiles: manifest.profiles.map((p) => p.profileId),
      externalOffsetUnit: OFFSET_UNIT,
      maxKeyLength,
      prepare,
      findMatches,
      findMatchesSync,
      ruleCount: () => rules.rowCount("id"),
      getRule: ruleAt,
      bindingCount: () => bindings.rowCount("id"),
      getBinding: bindingAt,
      getProfilePolicy: (profileId) => {
        const section = policies.get(profileId);
        if (!section) throw new Error(`BrowserPack: unknown profile ${profileId}`);
        return section;
      },
      getTerminology: () => terminology,
      loadDetail,
      // layer access (#196 C): digest-verified, cached section loading for additional pack layers
      compilerVersion: manifest.compilerVersion,
      hasSection: (sectionId) => byId.has(sectionId),
      sectionsOfKind: (kind) => manifest.sections.filter((s) => s.kind === kind).map((s) => ({ sectionId: s.sectionId, shard: s.shard ? { ...s.shard } : undefined, rowCount: s.rowCount })),
      loadSection: fetchVerified,
      eagerSection: (sectionId) => loadedEager.get(sectionId),
      stats: () => ({ ...stats, loaded: [...stats.loaded] })
    });
  };

  return { openBrowserPack };
});

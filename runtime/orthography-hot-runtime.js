(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.OrthographyHotRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Orthography Architecture v2 hot artifact: verification and inflation (#172).
  // The artifact is a derived, source-locked projection of the canonical knowledge graph; every
  // column declares the table/enum it indexes and is range-checked before use.

  const ENUMS = {
    factKind: ["literal_form", "literal_reading", "form_relation", "reading_relation", "render_equivalence"],
    ruleClass: ["diachronic", "phonological", "orthographic", "render"],
    directionality: ["forward_only", "reverse_traversable", "forward_infer_reverse"],
    lossiness: ["lossless", "many_to_one", "one_to_many", "contextual"],
    origin: ["historically_attested", "project_defined", "kinotch_derived"],
    derivationMechanism: ["inverse", "analogy", "composition", "other"]
  };

  // column -> type. string/str[] index `strings`; enum:<name> indexes ENUMS; ref:<table> indexes a
  // table's rows; a trailing "|-1" allows absence.
  const SCHEMA = {
    "facts.id": "string|-1",
    "facts.kind": "enum:factKind",
    "facts.surface": "string|-1",
    "facts.reading": "string|-1",
    "facts.basisReading": "string|-1",
    "facts.target": "string|-1",
    "facts.lexicalRefs": "string[]",
    "facts.tags": "string[]|-1",
    "facts.periodRefs": "string[]|-1",
    "facts.origin": "enum:origin|-1",
    "facts.derivedFrom": "string[]|-1",
    "facts.derivationMechanism": "enum:derivationMechanism|-1",
    "facts.provenance": "ref:provenance",
    "rules.id": "string",
    "rules.class": "enum:ruleClass",
    "rules.directionality": "enum:directionality",
    "rules.lossiness": "enum:lossiness",
    "rules.from": "string[]",
    "rules.to": "string[]",
    "rules.dependencies": "string[]",
    "rules.predicate": "string|-1",
    "rules.origin": "enum:origin|-1",
    "rules.derivedFrom": "string[]|-1",
    "rules.derivationMechanism": "enum:derivationMechanism|-1",
    "rules.provenance": "ref:provenance",
    "bindings.id": "string",
    "bindings.ruleId": "ref:rules",
    "bindings.lexicalRefs": "string[]",
    "bindings.contextRefs": "string[]|-1",
    "bindings.provenance": "ref:provenance",
    "provenance.sourceRefs": "string[]",
    "provenance.evidenceRefs": "string[]",
    "projected.fact": "ref:facts",
    "projected.surface": "string",
    "projected.reading": "string|-1",
    "order.rule": "ref:rules"
  };

  const tableSize = (artifact, table) => {
    const columns = Object.keys(SCHEMA).filter((path) => path.startsWith(`${table}.`));
    return (artifact[table]?.[columns[0].split(".")[1]] ?? []).length;
  };

  const verifyHotArtifact = (artifact) => {
    if (artifact?.schemaVersion !== "2" || artifact?.kind !== "japanese-orthography-hot-runtime") {
      throw new TypeError("Unsupported orthography hot artifact");
    }
    const keys = Object.keys(SCHEMA);
    if (!artifact.schema || Object.keys(artifact.schema).length !== keys.length || keys.some((k) => artifact.schema[k] !== SCHEMA[k])) {
      throw new TypeError("Orthography hot artifact schema mismatch");
    }
    if (JSON.stringify(artifact.enums) !== JSON.stringify(ENUMS)) throw new TypeError("Orthography hot artifact schema mismatch: enums");
    if (!Array.isArray(artifact.strings)) throw new TypeError("Orthography hot artifact strings missing");
    const rowCounts = new Map();
    for (const path of keys) {
      const [table, column] = path.split(".");
      const values = artifact[table]?.[column];
      if (!Array.isArray(values)) throw new TypeError(`Orthography hot artifact missing ${path}`);
      if (!rowCounts.has(table)) rowCounts.set(table, values.length);
      else if (rowCounts.get(table) !== values.length) throw new TypeError(`Orthography hot artifact ${table} row count mismatch at ${path}`);
    }
    for (const [path, spec] of Object.entries(SCHEMA)) {
      const [table, column] = path.split(".");
      const optional = spec.endsWith("|-1");
      const base = optional ? spec.slice(0, -3) : spec;
      const list = base.endsWith("[]");
      const target = list ? base.slice(0, -2) : base;
      const size = target === "string" ? artifact.strings.length
        : target.startsWith("enum:") ? ENUMS[target.slice(5)].length
          : tableSize(artifact, target.slice(4));
      const check = (value) => {
        if (!Number.isInteger(value) || value < 0 || value >= size) throw new RangeError(`Orthography hot artifact ${path} index ${value} out of range`);
      };
      for (const value of artifact[table][column]) {
        if (optional && value === -1) continue;
        if (list) {
          if (!Array.isArray(value)) throw new TypeError(`Orthography hot artifact ${path} expects lists`);
          value.forEach(check);
        } else check(value);
      }
    }
  };

  const inflateHotArtifact = (artifact) => {
    verifyHotArtifact(artifact);
    const s = artifact.strings;
    const str = (i) => (i === -1 ? undefined : s[i]);
    const strs = (list) => (list === -1 ? undefined : list.map((i) => s[i]));
    const en = (name, i) => (i === -1 ? undefined : ENUMS[name][i]);
    const prov = (i) => ({ sourceRefs: strs(artifact.provenance.sourceRefs[i]), evidenceRefs: strs(artifact.provenance.evidenceRefs[i]) });
    const put = (target, key, value) => { if (value !== undefined) target[key] = value; };
    const F = artifact.facts;
    const facts = F.kind.map((kind, i) => {
      const fact = {};
      const k = ENUMS.factKind[kind];
      const surface = str(F.surface[i]);
      const reading = str(F.reading[i]);
      const basisReading = str(F.basisReading[i]);
      const target = str(F.target[i]);
      fact.id = F.id[i] === -1 ? `fact:${k}:${surface ?? ""}|${reading ?? ""}|${target ?? ""}` : s[F.id[i]];
      fact.kind = k;
      fact.lexicalRefs = strs(F.lexicalRefs[i]);
      put(fact, "surface", surface);
      put(fact, "reading", reading);
      put(fact, "basisReading", basisReading);
      put(fact, "target", target);
      put(fact, "tags", strs(F.tags[i]));
      put(fact, "periodRefs", strs(F.periodRefs[i]));
      put(fact, "origin", en("origin", F.origin[i]));
      put(fact, "derivedFrom", strs(F.derivedFrom[i]));
      put(fact, "derivationMechanism", en("derivationMechanism", F.derivationMechanism[i]));
      Object.assign(fact, prov(F.provenance[i]));
      return fact;
    });
    const R = artifact.rules;
    const rules = R.id.map((id, i) => {
      const rule = {
        id: s[id], class: ENUMS.ruleClass[R.class[i]], directionality: ENUMS.directionality[R.directionality[i]],
        lossiness: ENUMS.lossiness[R.lossiness[i]], from: strs(R.from[i]), to: strs(R.to[i]), dependencies: strs(R.dependencies[i])
      };
      if (R.predicate[i] !== -1) rule.predicate = JSON.parse(s[R.predicate[i]]);
      put(rule, "origin", en("origin", R.origin[i]));
      put(rule, "derivedFrom", strs(R.derivedFrom[i]));
      put(rule, "derivationMechanism", en("derivationMechanism", R.derivationMechanism[i]));
      Object.assign(rule, prov(R.provenance[i]));
      return rule;
    });
    const B = artifact.bindings;
    const bindings = B.id.map((id, i) => {
      const binding = { id: s[id], ruleId: rules[B.ruleId[i]].id, lexicalRefs: strs(B.lexicalRefs[i]) };
      put(binding, "contextRefs", strs(B.contextRefs[i]));
      Object.assign(binding, prov(B.provenance[i]));
      return binding;
    });
    const projectedReadings = {};
    artifact.projected.fact.forEach((f, i) => {
      projectedReadings[facts[f].id] = { surface: s[artifact.projected.surface[i]], reading: str(artifact.projected.reading[i]) ?? null };
    });
    return {
      graph: {
        schemaVersion: "2", kind: "japanese-orthography-knowledge-graph", lexicalNamespaceId: artifact.lexicalNamespaceId,
        sources: artifact.sources.map((source) => ({ ...source })), facts, rules, bindings, dispositions: []
      },
      ruleOrder: artifact.order.rule.map((i) => rules[i].id),
      policy: JSON.parse(artifact.policy),
      projectedReadings
    };
  };

  return { verifyHotArtifact, inflateHotArtifact, SCHEMA, ENUMS };
});

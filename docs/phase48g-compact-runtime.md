# Phase 4.8G — Unified compact runtime and measurements

Owner: #139 (parent #132). Code: `tools/lexical-entity-graph.ts` (derived-column compaction),
`tools/lexical-hot-artifact.ts`, `runtime/lexical-hot-runtime.js` (UMD, browser/worker-class),
`tools/measure-compact-runtime.ts`; report:
`data/reports/phase48g-compact-runtime-measurements.json` (`npm run measure:compact-runtime`).

## Representations

| Layer | Content | Type safety |
| --- | --- | --- |
| canonical lexical graph | typed ids, readable | `ENTITY_SCHEMA` validation |
| compact graph (cold) | per-namespace dense tables; columns that equal a declared derivation of the key (`form.text`, `form.symbols`, `symbol.text`, `reading-atom.kana`, `reading-path.atoms`) are omitted | embedded schema; forged `derived` entries and out-of-range indexes rejected; inflate == canonical (sha256) |
| hot runtime artifact | interned strings; lexeme primary form/reading/ordinal + readings; form -> lexemes; reading -> lexemes; shared DAG patterns (with derivations) and (character, modern, context) bindings | `HOT_SCHEMA` names the table each column indexes; runtime refuses schema drift and range-checks every column at load |

Provenance (JMdict source refs, categories, restrictions, evidence detail) stays in the cold
compact graph; the hot artifact records the canonical graph sha256, JMdict snapshot and
CC BY-SA 4.0 notice.

## Equivalence proofs (tests)

- `inflate(compact)` hashes identically to the canonical graph.
- Hot `lookupForm` / `lookupReading` equal the canonical graph runtime for all 229,114 forms and
  236,621 readings.
- Hot `reconstructWord` (loaded in a VM sandbox) equals the accepted 4.6E runtime for the JMdict
  Sino vocabulary sample (>15,000 pairs, incl. `法` with/without context), including components,
  evidence and selection context.

## Measurements (deterministic sizes)

| Artifact | bytes | gzip |
| --- | --- | --- |
| raw selected JMdict extract | 28.1 MB | 4.7 MB |
| canonical lexical graph | 115.7 MB | 13.0 MB |
| compact graph (4.8C, before derived columns) | 51.0 MB | 11.0 MB |
| compact graph (4.8G) | 40.4 MB | 8.4 MB |
| hot runtime artifact | 21.6 MB | 6.2 MB |
| accepted 4.6E artifact vs DAG hot tables | 0.49 MB vs 0.07 MB | — |

Observed on the measuring machine (informational, Node 26): hot runtime startup about 0.7 s and
about 100 MB heap; about 1.3 M form lookups/s; about 140 k word reconstructions/s; compact cold
inflate about 15 s. No binary/public API format is frozen.

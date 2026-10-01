# Phase 4.8C — JMdict lexical graph compiler and 4.6E reading-DAG projection

Owner: #135 (parent #132). Code: `tools/jmdict-lexical-graph.ts`, `tools/sino-dag-projection.ts`,
`tools/lexical-graph-measurements.ts`; report: `data/reports/phase48c-lexical-graph-measurements.json`
(`npm run measure:lexical-graph`).

## JMdict -> typed graph (mapping contract, snapshot-scoped)

| JMdict | Graph |
| --- | --- |
| entry | `lexeme:<primary form>/<primary reading>` (+ `#n`, n by ent_seq, for the 620 pairs shared by several entries) |
| keb | `form:<keb>` (symbols = its characters) |
| reb | `reading-path:<reb>` (one whole-word reading atom) |
| re_restr / re_nokanji | `restrictions[]` (reading -> allowed forms; empty = no kanji form) |
| sense pos/misc/field/dial | `category:jmdict-<kind>:<tag>` (union over senses) |
| ent_seq | `sourceRefs: jmdict:2026-10-01:seq:<n>` (provenance only) |
| ke_inf, ke_pri, re_inf, re_pri, stagk, stagr | cold: reachable through sourceRefs in the committed 4.8A extract |

The compiler refuses any included 4.8A field without a declared graph disposition. Same-entry
variants stay one lexeme (`装丁/装幀/装釘/装訂`); homophones stay separate lexemes (`そうてい`).
The canonical graph hash is recorded in the measurement report and re-checked by tests on every
platform (determinism anchor).

## 4.6E -> shared reading DAG

- 2,000 accepted component relations project onto **177 primary patterns** (one per table pair)
  and **94 derived patterns** shared across characters, with 2,000 bindings
  `(character, table modern reading, context)`.
- In-word variants (coda gemination, ふ-final gemination, voicing, semi-voicing) are derived
  patterns: the primary pattern lists them in `derivations`, a variant that is not itself a table
  pair records `base` + `mechanism` (`ぱふ>ぽう` = semi-voicing of `はふ>ほう`, i.e. the
  `ぶんはふ -> ぶんぽう` class for `文法`).
- Bindings carry table authority only, so a variant never acts as a direct table reading.
- Equivalence: direct component resolution matches `resolveHistoricalSino` for all 2,000
  relations x {no context, null, 仏教用語}; word reconstruction (status, readings, components,
  evidence, selectionContext) matches `reconstructWord` for 18,495 JMdict kanji/reading pairs.
  `法 / ほう` stays `はふ | ほふ`; `仏教用語 -> ほふ`; no non-Buddhist default is introduced.
- The 4.6E artifact/runtime is **not** retired.

## Measurements (real compiled data)

| Artifact | bytes | gzip |
| --- | --- | --- |
| raw selected JMdict extract (4.8A) | 28.1 MB | 4.7 MB |
| canonical lexical graph | 115.7 MB | 13.0 MB |
| compact graph (per-namespace dense tables) | 51.0 MB | 11.0 MB |
| hot lookup projection (form/reading -> lexeme index) | 12.7 MB | 3.2 MB |
| 4.6E source relations / DAG canonical / DAG compact | 0.30 / 0.64 / 0.17 MB | — |

The compact graph is larger than the raw extract because it materialises symbol decomposition,
typed reading atoms/paths and categories per lexeme; 4.8G owns hot/cold size work.

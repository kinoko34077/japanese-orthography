# Phase 4.8 reconciliation (#154)

Owner: #154 (review record #157, parent #146). Base: accepted Claude Phase-4.8 main
`999bb8634f786169893aa38a247d384b2902610b`. GPT PRs #149/#150 were used only as comparison
evidence; nothing was merged or cherry-picked from them. Regressions:
`test/phase48-reconcile.test.ts` (plus added parity in `test/phase48g-compact-runtime.test.ts`).

| Finding | Disposition |
| --- | --- |
| A2 tied-best truncation (>16) | Fixed. `lexicalOccurrenceContext` now returns `{ dag }`: the DAG of all optimal analyses. Gates are quantified over every complete path by DP (no enumeration cap). |
| A3 unknown-edge suppression | Fixed. An unknown-character edge exists at every offset; cost = (unknown chars, segments) minimised globally (DAG and `paths()`). |
| A5 / F3 candidate-composition union | Fixed. Each lexical span becomes distinct (lexeme, reading, composition) edges; a split supported by only some viable candidates is `ambiguous_lexical_boundary`. |
| A4 lexicalIdentity without evidence | Fixed. Both callers always carry `lexicalIdentity`; without lexical evidence → `lexical_analysis_unavailable` (TS + runtime). |
| R2 / F5 requiredMorphology | Implemented in the shared core: keys `partOfSpeech` (prefix list), `conjugationType`, `conjugationForm` (accepted lexical-runtime vocabulary; UniDic `cType`/`cForm`). Reasons: `morphology_mismatch`, `morphology_unavailable`, `ambiguous_morphology`, `morphology_unsupported`, `lexical_analysis_unavailable`. Native `exact_lexeme` relations are untouched. |
| A8 / F7 compact applicability | Fixed. Compact relation rows gain column 12 (`applicability`, enum-validated); artifact `schemaVersion` is `2`, and version-1 rows are rejected rather than defaulted. |
| R3 / H1 hot form+reading | `lookupFormReading(form, reading)` honours all 11,418 JMdict restrictions; full-graph parity test. Hot artifact 21.58 → 21.81 MB (+226 KB restriction tables), gzip 6.15 → 6.22 MB. |
| A6 / H2 row shape | Hot runtime rejects any table whose parallel columns differ in row count. |
| A1 / F6 4.6D historicalReading | Routed as `native-source` reading authority. The source names the form, not the modern reading: bound when JMdict gives the form exactly one reading (`unique` / `homograph`), `reading_unassigned` candidates when it has several, `unbound` when no lexeme exists. Reading-only records create no written-form authority. Script variants in the data (`藍`: `あゐ` / `アヰ`) stay as separate candidates. |
| A7 / H3 component authority | All reading-aligned prefix/suffix component authorities are collected; distinct results become `source_candidates`; traversal order is not authority. |
| H4 scanner window | The scan window is derived from the indexed surfaces (no fixed 24 cap). |
| R4 parity | Hot reconstruction == accepted 4.6E runtime for all 2,000 relations × {omitted, null, 仏教用語}; the >15k JMdict word parity is kept. |
| R5 overlap DP | **Deferred.** The current exact search with the fail-closed cap of 24 candidates is retained. Replacing it needs a proof that DP selection is identical to exhaustive optimal-set enumeration, including the "distinct optimal outputs stay unresolved" rule, which would require enumerating all optima anyway. It is not needed for any accepted case. |

Unchanged: `法 / ほう` → `はふ | ほふ`; `仏教用語` → `ほふ`; no non-Buddhist default; JMdict is never
historical-winner authority; same-start longest match; shifted overlaps without evidence stay unresolved.

# Phase 4.8F — Lexical entities joined to accepted historical authority

Owner: #138 (parent #132). Code: `tools/lexical-historical-join.ts`; artifact:
`data/historical/phase48f-lexical-authority-join.json` (`npm run generate:lexical-join`, checked by
`validate:lexical-join` in `npm run check`); tests: `test/phase48f-lexical-historical-join.test.ts`.

## Join artifact

Every accepted Phase-4.6 intake record (12,738) is bound to its typed scope:

| Intake | Binding |
| --- | --- |
| 4.6C lexical kanji (4) | JMdict lexeme by form — 4 unique |
| 4.6D native kana (10,338) | JMdict lexeme by surface — 1,876 unique, 201 homograph (no lexeme chosen), 7,420 unbound (mostly inflected surfaces; morphology is not invented), 841 excluded |
| 4.6E 字音 (2,013) | `symbol:<char>` + shared `pattern:<historical>><modern>` — 2,011 bound, 2 excluded |
| 4.6B / legacy merged characters | `symbol:<char>` |
| 4.6F KiNoTch profile | profile scope, not generic authority |

Bindings add **no** authority; they make the accepted records addressable by lexical entity.

## Lexeme history resolver

`resolveHistory({ form, reading, context? })` returns:

- `lexemes` and `lexicalEquivalents` — JMdict grouping, **evidence only**. `装丁` lists
  `装幀 / 装訂 / 装釘`, but its written-form authority is solely the accepted 4.6C record
  (`source_candidates`: `装幀 | 装釘`); `装訂` is never promoted, and the other family members gain
  no written-form authority from JMdict.
- `writtenForm` — accepted 4.6C/4.6D records for the form (`source_exact` / `source_candidates`), or
  component reuse through a reading-aligned composition (`溶接工` -> `熔接工`, basis
  `generated_productive_span`, citing the `溶接` record).
- `reading` — whole-word source authority first (`学校 がっこう -> がくかう`, `source_exact`, with the
  DAG result as cross-check); otherwise reverse traversal of the shared 4.6E DAG
  (`generated_productive_span` when resolved, `source_candidates` when ambiguous). Components
  name the shared pattern (`さう>そう` for the whole `そうてい` family) and, for derived variants,
  the base pattern (`文法`: `ぱふ>ぽう` from `はふ>ほう`).

## 法 / ほう

- No context: `はふ | ほふ` (and `文法` stays `ぶんぱふ | ぶんぽふ`).
- `仏教用語`: `ほふ`.
- An explicit `null` context selects only the unqualified table row — the accepted 4.6E query
  semantics, not a new default. An unknown context (e.g. `法律用語`) resolves to nothing.
- The working hypothesis "non-Buddhist -> はふ" is **not admitted**; no verification source was
  added in 4.8.

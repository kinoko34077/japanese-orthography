# Phase 4.6 — Orthography Classification and Source-Completeness Design

Status: design specification for `kinoko34077/japanese-orthography#70`  
Date: 2026-09-30  
Baseline: `japanese-orthography@5dea2af61646949227c1191886febb6800b12796`  
Consumer baseline: `txt-auto-replace@198f8560613d23417cb0f87172ae8662e722ca30`

## 1. Purpose

Phase 4.6 improves restoration accuracy for Japanese historical orthography while preserving the existing separation between generic linguistic authority and KiNoTch-specific policy.

The selected user requirement is stronger than sample-based dictionary expansion:

> For selected committed historical-kana and 字音 source snapshots, every relation that the material explicitly makes recoverable must be represented, classified, and reproducible. Material records may be ambiguous or explicitly excluded, but they must not disappear silently.

This design does **not** claim that the selected sources are globally exhaustive, historically uncontested, or sufficient for every modern Japanese input. It defines a deterministic completeness contract relative to pinned source snapshots.

## 2. Existing architectural constraints

The repository already distinguishes:

- native historical kana;
- Sino-Japanese historical readings / 字音仮名遣い;
- contextual lexical kanji restoration;
- deterministic safe-character rendering;
- generic semantic authority;
- KiNoTch-specific semantic/style policy;
- unresolved and candidate outcomes.

Phase 4.6 extends those distinctions rather than replacing them with one large replacement table.

Consumer-local DOM/UI/storage/HTTP concerns remain outside this repository. `txt-auto-replace` continues to consume explicitly source-locked artifacts rather than silently following newer `main`.

## 3. Non-goals

Phase 4.6 does not:

- bulk-admit every legacy Stage-40/50/55/60 rule into generic authority;
- mechanically reverse one-character modernization tables;
- force a single historical target where the source or lexical evidence is ambiguous;
- treat AI-derived research CSV/XLSX bundles as authority without independent verification;
- publish or release a stable package/API;
- start Phase 5 `kinotch-api` integration;
- change credentials, permissions, deployment, publication, or shared history;
- use unpublished/full lyric fixtures;
- use RDC.

## 4. Responsibility taxonomy

Every Phase-4.6 intake record belongs to exactly one primary responsibility class.

| Responsibility | Meaning | Typical example | Generic automatic authority |
| --- | --- | --- | --- |
| `character_form` | Same-character modern/old form relation | `学 -> 學` | allowed after evidence/admission |
| `lexical_historical_kanji` | Word-level historical spelling / homophone rewrite restoration | `溶接 -> 熔接` | lexical evidence required |
| `merged_character` | Modern character merged multiple historical characters | `弁 -> 辨/瓣/辯/辦` | never unconditional by character alone |
| `historical_kana_native` | Native-Japanese historical kana | `思う -> 思ふ` | lexical/morphology-aware |
| `historical_kana_sino` | Sino-Japanese historical reading / 字音 | `がっこう -> がくかう` | reading/lexical evidence-aware |
| `kinotch_semantic` | Project-specific semantic replacement | project policy | profile only |
| `kinotch_style` | Project-specific style/render replacement | `こと -> ヿ` | profile only |
| `preserve_unresolved` | Preserve, excluded, unsupported, or unresolved | unsafe/unknown relation | no automatic replacement |

Legacy file/stage names are migration evidence, not responsibility definitions.

## 5. Source classes and authority

### 5.1 Committed reference material

`仮名遣等資料/` remains a reference/evidence area. Presence in that directory does not by itself grant generic runtime authority.

For Phase 4.6, selected files can additionally receive a **coverage-contract** role. Coverage-contract status means that every extractable record in that pinned snapshot must be accounted for; it does not mean every record becomes an admitted automatic transformation.

Initial selected source roles:

| Source | Role in Phase 4.6 |
| --- | --- |
| `仮名遣等資料/字音仮名遣い表.html` | required 字音 coverage oracle |
| `仮名遣等資料/字音仮名_まとめ.xlsx` | structured companion; usable only after reconciliation with HTML |
| `仮名遣等資料/仮名遣い辞典本文.html` | native historical-kana coverage/cross-check source |
| `仮名遣等資料/歴史的仮名遣いで書きたい.html` | native rule/explanation source, not blind global rewrite authority |
| `仮名遣等資料/例外動詞一覧：歴史的仮名遣い教室.html` | exception source for native historical-kana rules |
| `仮名遣等資料/動物名・植物名歴史的仮名遣い辞典.html` | lexical native historical-kana source |
| official homophone CSV extraction | modernization evidence; reverse restoration requires lexical admission |
| AI-derived homophone/multi-to-one bundles | candidate/review material only |

### 5.2 `okikae/kkh`

`okikae/kkh` is reusable external source data under BSD-2-Clause.

Phase 4.6 adopts the following role split:

- `kana-jisyo`: preferred reusable source for explicit modern-kana -> historical-kana mappings where semantics align;
- `kanji-jisyo`: candidate/evidence source for old/new character relations, subject to independent responsibility/admission checks;
- `jion-jisyo`: supplemental evidence only because the file explicitly labels itself Beta/incomplete.

The KKH **data** may be source-locked and parsed. The KKH sequential replacement algorithm is not adopted as canonical resolver semantics.

Commented/disabled KKH records are not silently activated. Duplicate modern surfaces, source notes, alternatives, and ordering dependencies must be represented explicitly during intake.

### 5.3 UniDic

Current modern UniDic remains the lexical identity / modern reading / morphology source already used by the project.

NINJAL old-kana colloquial UniDic may be used as a research or analysis provider for historical-form lexical/morphological evidence. It is not a direct modern->historical converter. It is not vendored or made a mandatory runtime dependency in Phase 4.6 without a separate license/source decision.

### 5.4 Other external sources

- CJKVI Joyo variants: character-form evidence/audit input.
- Yosina: Unicode/variant normalization or old->new comparison oracle; never reverse-restoration authority by itself.
- DHSJR: research evidence for historical Sino-Japanese readings; no silent redistribution into unrestricted generic runtime data.
- kyujipy/other converters: audit/candidate oracle only unless individual relations are admitted through project evidence rules.

## 6. Source snapshot contract

Every ingested external or committed coverage source must be pinned by a source descriptor containing at least:

```ts
interface SourceSnapshot {
  sourceId: string;
  sourceClass: 'committed-reference' | 'external-repository' | 'official' | 'dictionary' | 'research';
  repository?: string;
  commit?: string;
  path: string;
  blobSha?: string;
  license?: string;
  coverageRole: 'coverage-contract' | 'supplemental' | 'candidate-only';
}
```

Generated/admitted data must never depend on an unpinned moving external branch.

## 7. Intake record model

Phase 4.6 introduces one cross-domain intake/admission representation. Exact file/schema naming is an implementation-plan detail, but the semantic fields are mandatory.

```ts
type Responsibility =
  | 'character_form'
  | 'lexical_historical_kanji'
  | 'merged_character'
  | 'historical_kana_native'
  | 'historical_kana_sino'
  | 'kinotch_semantic'
  | 'kinotch_style'
  | 'preserve_unresolved';

type Disposition =
  | 'admitted'
  | 'candidate_ambiguous'
  | 'excluded_unresolved';

interface IntakeRecord {
  id: string;
  sourceRef: string;
  sourceLocator: string;
  responsibility: Responsibility;
  disposition: Disposition;
  modernSurface?: string;
  historicalSurface?: string;
  modernReading?: string;
  historicalReading?: string;
  lexicalIdentity?: string;
  morphology?: Record<string, string>;
  alternatives?: string[];
  exclusionReason?: string;
  evidenceRefs: string[];
}
```

A source record can produce more than one `IntakeRecord` when the source explicitly provides multiple alternatives, but provenance must make the expansion reversible and countable.

## 8. Material-completeness contract

### 8.1 Definition

For every source snapshot with `coverageRole = coverage-contract`, extraction and classification must satisfy:

```text
source records discovered
= successfully parsed records
= admitted + candidate_ambiguous + excluded_unresolved
```

No unmatched/unparsed source record is allowed to pass CI silently.

### 8.2 Exact restoration requirement

For each coverage-contract record whose source applicability and output are unique under the provided evidence identity:

```text
resolve(source identity + required lexical/reading/morphology evidence)
== exact historical target from the source record
```

This must be tested across the full selected material snapshot, not a hand-selected sample.

### 8.3 Ambiguity requirement

If a source record explicitly permits multiple historical targets, or if the available input evidence cannot safely select one source target:

- all source-supported applicable targets remain represented;
- the resolver returns candidates/unresolved according to existing typed semantics;
- implementation must not choose a target merely because it appears first in a source file.

### 8.4 Explicit exclusion requirement

A record may be `excluded_unresolved` only with a machine-readable reason. Examples:

- malformed source row;
- source contradiction requiring manual research;
- insufficient lexical identity;
- Unicode normalization instability;
- source license prevents the intended generated artifact;
- source entry is explanatory/non-transformational rather than a mapping.

A growing exclusion count is visible test output, not hidden success.

### 8.5 Snapshot drift

When a pinned source snapshot changes, CI must report at least:

- old/new discovered-record counts;
- added/removed source record IDs;
- disposition changes;
- newly unparsed records;
- exact-restoration regressions.

Source update is therefore an explicit reviewed change rather than silent dictionary growth.

## 9. Native historical-kana design

### 9.1 Input sources

Native historical-kana data is built from:

1. source-locked KKH `kana-jisyo` for reusable explicit word/form mappings;
2. committed historical-kana dictionary/reference snapshots for coverage and gap detection;
3. existing UniDic lexical identity and morphology for safe selection/reconstruction.

### 9.2 KKH parsing

KKH active mapping records such as:

```text
思う /思ふ ;ハ行四段
味わおう /味はゝう ;ハ行四段「踊り字」
味わおう /味ははう ;ハ行四段「意志推量：おう」
```

must be parsed as explicit source records, not executed sequentially as string substitutions.

Parser rules:

- active mapping line -> source record;
- commented mapping line -> retained as disabled source evidence, not automatic authority;
- same modern surface with multiple active targets -> explicit alternatives/candidate set unless another evidence identity separates them;
- comments/labels may contribute morphology/style metadata but cannot be silently interpreted as a universal rule unless encoded and tested;
- source ordering must not determine semantic winner.

### 9.3 Resolver behavior

Native historical-kana resolution remains lexical/morphology-aware.

Priority:

```text
exact lexical identity + morphology relation
-> exact lexical surface relation
-> safe generated inflection backed by an admitted paradigm
-> candidates/unresolved
```

Literal substring replacement is not an accepted fallback for ambiguous homographs.

### 9.4 Coverage guarantee

Phase 4.6D must produce a machine-generated coverage report for every selected native source snapshot.

Required CI properties:

- zero unparsed coverage-contract records;
- zero unclassified coverage-contract records;
- every unique admitted source mapping passes exact direct resolution;
- every explicit alternative source mapping is preserved in the corresponding candidate set or separated by stronger lexical/morphological identity;
- disabled source records remain disabled unless separately admitted with evidence.

## 10. 字音仮名遣い design

### 10.1 Coverage source

`仮名遣等資料/字音仮名遣い表.html` is the selected committed coverage oracle for Phase 4.6E.

The source explicitly describes itself as a lookup table for writing Sino-Japanese readings in historical kana and notes that relevant readings not affected by historical-kana distinctions are the same as modern kana.

KKH `jion-jisyo` is supplemental because it explicitly declares itself Beta/incomplete.

### 10.2 Core relation

The minimum semantic unit is not `character -> one historical reading`.

It is:

```text
(character, identified modern Sino-Japanese reading, optional reading class/context)
-> one or more historical readings
```

Example shape:

```json
{
  "character": "校",
  "modernReading": "こう",
  "historicalReadings": ["かう", "けう"],
  "sourceRefs": ["..."]
}
```

Whole-word evidence can select the applicable component reading when the source or lexical evidence makes it explicit.

### 10.3 Table extraction

The HTML extractor must produce stable records containing at least:

- modern reading heading/group;
- historical reading shown by the table;
- listed character(s);
- source locator/anchor or deterministic ordinal;
- source note/class where present;
- whether the row represents “same as modern spelling”.

The extractor must be deterministic from the pinned source blob.

### 10.4 Workbook reconciliation

`字音仮名_まとめ.xlsx` is not independently preferred over the HTML source merely because it is structured.

Before it can drive generated data, a reconciliation step must report:

- rows present in both with equal values;
- rows only in HTML;
- rows only in workbook;
- conflicting values;
- normalization-only differences.

Any conflict blocks automatic preference until explicitly resolved.

### 10.5 Direct component completeness

For every unique table relation, the direct component API/runtime path must satisfy:

```text
resolveHistoricalSino({ character, modernReading })
-> exact source historical reading
```

If the table gives multiple historical readings for the same `(character, modernReading)` identity, the result must expose the complete source-supported candidate set unless stronger admitted context selects one.

This direct component completeness test is the primary proof that every table mapping is represented.

### 10.6 Word-level reconstruction

For ordinary text, word-level 字音 restoration uses:

1. lexical/token reading from accepted lexical evidence;
2. reading segmentation/alignment against component records;
3. whole-word historical-reading evidence when available;
4. only evidence-compatible combinations of component historical readings.

A dynamic-programming or equivalent alignment implementation is acceptable, but it must preserve ambiguity rather than score one candidate into false certainty.

If modern lexical reading can be segmented uniquely through admitted table relations, the historical reading must be reconstructed exactly.

If multiple segmentations/reading identities remain possible, return candidates/unresolved.

### 10.7 “Same as modern” rows

The source statement that unlisted/non-problematic sounds retain modern spelling is represented as an explicit identity relation only where the input is already identified as a Sino-Japanese reading in the relevant scope. It must not become a blanket “leave any kana unchanged” proof for native vocabulary.

## 11. Character-form and merged-character design

### 11.1 Deterministic character forms

Safe one-to-one same-character-form relations can be expanded from source-backed variant evidence.

Each admitted mapping needs:

- source evidence;
- confirmation that the relation is same-character form rather than lexical substitution;
- Unicode normalization behavior check;
- negative controls for known merged/contextual characters.

### 11.2 Merged characters

Characters such as `弁` do not have one unconditional historical target.

They remain lexical/contextual. Existing accepted relations such as business/botanical `合弁` and preserve cases remain the model.

### 11.3 Legacy compatibility defects

Current compatibility mappings such as unconditional `弁 -> 辨` and suspicious `穗 -> 瓣` / `舖 -> 辯` must be classified before correction.

Compatibility snapshots remain audit/regression evidence. Correct generic/project authority must not be made to preserve a known bad relation solely because a legacy snapshot contains it.

Consumer behavior corrections occur through a separate source-locked consumer unit/PR after upstream authority is accepted.

## 12. Homophone rewrite restoration

The Cultural Affairs Agency “同音の漢字による書きかえ” source records modernization direction:

```text
historical -> modern
```

Reverse restoration therefore requires a lexical unit or sufficiently specific context.

Phase 4.6C may generate reverse candidates from the official table, but admission requires lexical evidence and ambiguity checks.

One-character reverse rows never automatically establish universal `modern character -> historical character` authority.

## 13. Generic/profile separation

Generic core may own:

- source-backed character-form relations;
- source-backed lexical historical-kanji relations;
- source-backed native historical-kana relations;
- source-backed 字音 relations;
- preserve/candidate semantics.

KiNoTch profile owns:

- semantic preferences not established as generic historical truth;
- style/render substitutions;
- author-specific compatibility choices.

The same source surface may have different generic and profile behavior, but the authority layer must be explicit in trace output.

## 14. Compilation and runtime artifacts

Compilation must preserve source provenance and capability identity.

Generated runtime data is expected to expose, directly or through manifest metadata:

- source snapshot identity;
- admitted relation counts by responsibility;
- candidate counts;
- exclusion counts;
- coverage-contract counts;
- source digest / artifact digest;
- capability/version identifier.

The consumer must fail closed if the expected capability/source identity does not match.

## 15. Traceability

Resolver trace for Phase-4.6 relations must be able to answer:

- which responsibility handled the input;
- which source record/evidence established the relation;
- whether the outcome was admitted/candidate/unresolved/profile override;
- why a potential source relation was not applied;
- which source snapshot generated the runtime relation.

This is required so “資料にはあるのに変換されない” can be diagnosed deterministically.

## 16. Verification strategy

### 16.1 Source parser tests

Each coverage parser has fixture tests for:

- normal rows;
- duplicate keys;
- alternatives;
- disabled/commented records;
- notes/headings;
- malformed input;
- deterministic IDs/locators.

### 16.2 Full-snapshot completeness tests

Tests run against the pinned full selected source snapshot and assert:

```text
unparsed == 0
unclassified == 0
discovered == admitted + ambiguous + excluded
```

For unique admitted relations:

```text
exactRestorationFailures == 0
```

### 16.3 Negative safety tests

At minimum:

- `弁` is not a generic unconditional one-target character mapping;
- `台` remains guarded/contextual;
- Unicode normalization-unstable targets do not become generic deterministic mappings;
- `穗 -> 瓣` and `舖 -> 辯` cannot pass as same-character old/new relations;
- source order does not choose among alternatives;
- native-kana substring collisions do not become blind replacements.

### 16.4 Cross-source reconciliation tests

Where two selected sources claim the same relation:

- equal claims deduplicate under distinct provenance;
- conflicts become explicit diagnostics/candidates;
- one source does not silently overwrite another.

### 16.5 Existing regression suite

Every implementation unit must retain `npm run check` on exact head and Formal Review.

Consumer-changing units additionally require the existing `txt-auto-replace` Verify path and source-lock regeneration/equality checks.

## 17. Phase decomposition

### 4.6A — classification/admission foundation

Deliver:

- cross-domain responsibility/disposition model;
- source-record provenance/count semantics;
- classification of known unsafe legacy mappings;
- tests establishing that future coverage records cannot disappear silently.

4.6A does not yet need to ingest the full kana/字音 datasets.

### 4.6B — deterministic kyujitai expansion

Deliver source-backed same-character-form relations only.

### 4.6C — lexical/homophone restoration expansion

Deliver lexical reverse-restoration relations with ambiguity preservation.

### 4.6D — native historical-kana completeness

Deliver full selected native-source extraction, KKH reuse, source reconciliation, and full-snapshot completeness tests.

### 4.6E — 字音 completeness

Deliver full selected 字音-table extraction, optional reconciled workbook companion, component API completeness, lexical reconstruction, and full-snapshot completeness tests.

### 4.6F — project semantic/style migration

Deliver only evidence-backed KiNoTch-specific gaps after generic responsibilities are known.

## 18. Acceptance criteria for Phase 4.6

Phase 4.6 is complete only when all selected units reach their accepted scope and the following repository-level conditions hold:

1. every active transformation relation has an explicit responsibility class;
2. known character-form/contextual/profile responsibilities are not conflated;
3. selected native historical-kana coverage sources have zero silent drops;
4. every uniquely applicable explicit native mapping in the selected coverage snapshot is exactly reproducible;
5. selected 字音 coverage source has zero silent drops;
6. every uniquely applicable explicit 字音 mapping is exactly reproducible through the direct component contract;
7. word-level 字音 reconstruction preserves ambiguity when reading segmentation/identity is not unique;
8. external library use is source-locked and license/provenance-aware;
9. generic/project authority remains separate;
10. consumer changes, if any, occur only through explicit source-locked integration units;
11. full exact-head checks and review are clean.

## 19. Rollback

Each implementation unit is independently revertible.

- upstream data/schema/runtime changes occur on dedicated PRs;
- consumer integration is separate from upstream authority changes;
- no shared-history rewrite is required;
- if a merged unit regresses behavior, use a dedicated revert PR and restore the prior source lock.

## 20. Open implementation-plan decisions

The implementation plan may choose exact filenames and internal helper boundaries, but must resolve these questions before coding:

1. canonical schema/file location for `IntakeRecord` and source snapshots;
2. parser implementation for KKH text format;
3. HTML table parser strategy and stable locator scheme;
4. workbook reconciliation mechanism without making workbook ordering authoritative;
5. exact direct 字音 component API shape;
6. word-reading alignment algorithm and ambiguity representation;
7. coverage-report artifact format;
8. whether native reference HTML becomes an independent coverage contract immediately in 4.6D or first serves as a cross-check against full KKH coverage.

These are implementation choices within the requirements above; they must not weaken the material-completeness contract.
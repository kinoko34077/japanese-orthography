# Phase 3.5 legacy txt-auto rule audit (#57, spec #47)

Source audited (live, exact): `kinoko34077/txt-auto-replace` @ `d2d55037db5883230e3e81288d4eef4473f4b1ba`.

| Stage | Blob |
| --- | --- |
| 10-surface-normalization | `b28c66e4a31e151e1f0dff7b9707d908360f08d1` |
| 15-katakana-long-vowel-abbreviation | `747a072d88ccc99d16940abc64882bafa1e1bdbb` |
| 20-lexical-replacements | `32d4acff7532b5dd21d0bab1d1ba414298f27687` |
| 30-okurigana-abbreviation | `00f0147412598bdbc5d8c63dd8cc23f8d23bde45` |
| 31-okurigana-abbreviation-stage4 | `49a372cf6e7f30e681c895c47a42dfca183611b7` |
| 40-legacy-kanji | `b9f71bf028f8d729a70789064dcfe5703cbfcbe1` |
| 50-official-homophone-restoration | `e52d41a50e7f0344e309dd6c35ac0b22e42dee08` |
| 55-homophone-kanji | `4ad4967936363439fe74529bd2180a9330aff1ae` |
| 60-general-character-replacements | `5739a94e321d34e764e9faea7bfb3e0d743a94f1` |

Buckets are the seven from #47: (1) generic deterministic/safe, (2) generic lexical/contextual, (3) lexical reconstruction / candidate generation, (4) KiNoTch semantic override, (5) KiNoTch style/render override, (6) preserve/exclusion, (7) unresolved / needs source or design evidence.

**Nothing in this audit is admitted to generic authority.** Classification records responsibility only; admission to generic safe/contextual data still requires the per-entry source process used by #40 / #38.

## 40 / 50 / 55 — source-locked, unchanged

`transforms/kinotch-fixed-source-lock.json` pins these three files to the canonical `test/golden/kinotch-profile` artifact (core commit `671e5e5`). Their current SHA-256 payload digests match the lock (`88c0a093…`, `c0a0de5e…`, `19ea6949…`), so the canonical authority stays in `japanese-orthography` and the consumer copies are generated snapshots. No re-classification here.

## 10 — surface normalization

| Rule | Bucket | Note |
| --- | --- | --- |
| `、` → `､`, `。` → `｡` | 5 style/render | Half-width punctuation is an output convention. It must run after semantic resolution (or on protected-free text only), because it changes code points that tokenizers use. |

## 15 — katakana long-vowel abbreviation

| Rule | Bucket | Note |
| --- | --- | --- |
| runtime `katakana-long-vowel-abbreviation` (drop run-final `ー`, and `ー` before a compound boundary `ア/イ/ウ/エ/オ`, `min_length` 1) | 5 style/render (algorithmic family) | Already algorithmic rather than enumerated — the target representation for this family. |
| `バッター` exclusion | 6 preserve/exclusion | Exceptions stay data attached to the style rule. |

## 20 — lexical replacements

| Rule | Bucket | Note |
| --- | --- | --- |
| `こと` → `ヿ` | 5 style/render | Ligature output; the engine comment already records it as blanket token conversion. Should key on the lexical token (形式名詞 こと), not the string. |
| `面倒`+`ごと` → `事` | 4 semantic override | Chooses a lexical spelling for ごと; generic core would treat ごと as candidates. |
| `時`+`ごと` → `時毎` | 4 semantic override | Same family (ごと → 毎 vs 事) decided by the preceding token; a candidate-selection rule. |
| `それ` / `その` → `其`, `この` → `此` | 5 style/render | Kanji spelling of demonstratives. `それ` and `その` both collapse to `其`, so the rule is lossy and must run after lexical identity is fixed. |
| `やっぱり` → `矢ッ張` | 5 style/render | Ateji spelling preference. |

## 30 / 31 — okurigana abbreviation

| Rule | Bucket | Note |
| --- | --- | --- |
| `分かる`→`分る`, `当たる`→`当る`, `書き出す`→`書出す`, `悩み`→`悩` | 5 style/render | Same family as the `に就いて → に就て` example in #47. Enumerated examples of the Stage4 rule. |
| runtime `verb-okurigana-stage4` | 5 style/render (algorithmic family) | Token/morphology-driven (godan/sahen/renyou handling, compound compression). Precedent for representing the whole family algorithmically with explicit exceptions; stage 30 entries become its regression examples. |

No entry in 10/15/20/30/31 is generic deterministic truth.

## 60 — general character replacements (358 entries)

Per-entry results: `data/profiles/kinotch/legacy-stage60-classification.json` (code points, bucket, reason, `admittedToGenericAuthority: false` for all).

| Bucket | Count | Examples |
| --- | --- | --- |
| 7 unresolved — NFC-unstable | 75 | `海`→`海` (U+FA45), `社`→`社`, `都`→`都` |
| 1 generic deterministic *candidate* (not admitted) | 229 | `亜`→`亞`, `円`→`圓`, `応`→`應`, `竜`→`龍` |
| 4 KiNoTch semantic override | 31 | `暗`→`闇`, `補`→`輔`, `略`→`掠`, `了`→`諒`, `湾`→`彎` |
| 5 KiNoTch style/render | 18 | `園`→`薗`, `間`→`閒`, `回`→`囘`, `野`→`埜`, `隣`→`鄰` |
| 2 generic lexical/contextual | 5 | `台`→`臺`, `芸`→`藝`, `欠`→`缺`, `余`→`餘`, `予`→`豫` |

Findings:

1. **75 targets are CJK compatibility ideographs.** Unicode NFC maps them back to the source character, so any normalizing consumer, storage layer or search index silently undoes the replacement. They cannot enter generic authority as code-point mappings; a durable design (e.g. IVS sequences or an explicit "no normalization" output contract) is needed first.
2. **31 entries replace one word with another** (闇/暗, 輔/補, 掠/略, 諒/了, 彎/湾 …). They are project choices, not character-form relations, and would corrupt text if treated as safe.
3. **5 entries are lexical**: the source character is itself a separate word in some uses (芸 うん, 欠 あくび, 余/予 first person, 台 per the #2 guarded ruling). They belong to contextual/lexical resolution, not a character map.
4. **18 entries prefer non-standard variants** for the same word (異体字) — style.
5. **229 remaining entries look like Joyo shinjitai → kyujitai pairs**, but only `学 → 學` is currently admitted (#40). Each needs primary-source evidence and ambiguity review before admission; the stage-60 file is evidence, not source. `円`, `応`, `竜` are already cited by the #40 official locator and are the natural next candidates.
6. Chain hazard: `炎 → 焔` and `焔 → 焰` both exist; the result depends on whether the map is applied once or repeatedly.

## Generalizable families

| Family | Representation | Exceptions |
| --- | --- | --- |
| katakana long-vowel abbreviation (15) | algorithmic (exists) | exclusion list (`バッター`) |
| okurigana abbreviation (30/31) | algorithmic over morphology (Stage4 exists) | stage 30 list as regression examples |
| demonstrative/形式名詞 spelling (20: それ/その/この/こと) | token-keyed style rules on lexical identity | lossy collapse → must run post-semantic |
| ごと → 事 / 毎 (20) | semantic override choosing among lexical candidates | sequence constraints |
| punctuation width (10) | style render table | protected spans |
| kyujitai character forms (60 bucket 1) | generic safe map, admitted per entry | contextual characters (bucket 2) excluded |

## Composition

With this classification a consumer can compose `generic core` (lexical → historical → contextual → safe) and then an optional KiNoTch profile holding buckets 4, 5 and 6. The generic resolver does not need a fork: bucket 4 selects among candidates the core already returns, and bucket 5 rewrites the rendered output. Implementing that overlay is outside Phase 3.5 unless an acceptance item requires it.

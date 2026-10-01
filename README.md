# japanese-orthography

Reusable Japanese orthography transformation core for historical kana, kyujitai, ruby parsing, and contextual restoration.

## Contextual-kanji canonical corpus

The canonical authority for the first contextual-kanji slice is strict JSON under `data/`:

- `data/evidence/` owns source observations and recoverable provenance;
- `data/lexical/constraints/` owns source-qualified lexical binding constraints;
- `data/packs/contextual-kanji/` owns admitted contextual restoration, safety, and review-only knowledge.

`dist/contextual-kanji/` is generated and non-canonical. Do not hand-edit generated artifacts.

## Author workflow

Requires Node.js 22 or later.

```sh
npm ci
npm run validate
npm test
npm run compile
npm run check
npm run bench:resolver
node --import tsx tools/bench-lexical-runtime.ts --json
```

- `npm run validate` performs schema, pack-local semantic, and configured integration validation without mutating canonical source.
- `npm run compile` validates and atomically replaces `dist/contextual-kanji/` only after a complete successful build.
- `npm test` runs structural, semantic, integration, compiler, canonical-slice, lexical-runtime, resolver, and CLI tests.
- `npm run check` requires zero unresolved `ERROR`/`REVIEW` diagnostics, runs the complete tests/typecheck, proves deterministic compilation, and compares generated output with tracked golden artifacts.
- `npm run bench:resolver` measures the bounded resolver first slice with a fixed local corpus. Its output is a reproducible development baseline, not a production threshold or a full-corpus performance claim.
- `tools/bench-lexical-runtime.ts` measures the bounded real-lexical acceptance slice and reports its environment, artifact/index/module bytes, cold initialization including artifact parse, retained heap delta, lookup timing/throughput, and harness-observable load copies. It likewise does not define production thresholds.

## First-slice integration fixture

The contextual-pack author commands still use `test/fixtures/integration/first-slice.json` to exercise the compiler/integration boundary with deliberately synthetic bindings. Separately accepted real lexical, historical, contextual-binding, and safe-character slices now prove production-shaped evidence paths; the fixture remains a deterministic build/validation surface rather than their replacement. It explicitly supplies:

- a simulated `pmin-current` lexical namespace and opaque `fixture-local-*` binding IDs;
- the external `safe-kanji/char-tai-to-dai` export required by the `台` fallback tests.

These fixture bindings are **not** canonical lexical identities and are not production Pmin local IDs. They exist only to prove that source-qualified canonical evidence is bound through an explicit per-build input instead of being copied into hot runtime IDs. Future production/consumer builds still need explicit real bindings and external-pack inputs for every admitted relation they activate; the bounded real acceptance slices below do not imply full-pack binding coverage.

## Real lexical evidence acceptance slice

`data/lexical/sources/unidic-cwj-202512-first-slice.json` is a bounded, source-traceable extraction used to prove the next lexical boundary with real UniDic-CWJ 2025.12 evidence. It pins the source `lex.csv` SHA-256 `bd00a695ba897a3250965257341e1929ae062dfa2e63b223a05bcc02f22e74a2` and retains representative source rows for Sino-Japanese, native inflection, ambiguity and contextual-restoration anchors.

The bounded path is:

```text
real UniDic source slice
  -> tools/lexical-compiler.ts
  -> deterministic lexical artifact
  -> runtime/lexical-runtime.js lookup
  -> runtime/orthography-resolver.js
```

The compiler normalizes only the fields needed by this phase, keeps zero/one/multiple surface candidates distinct, and records section digests plus a slice-specific `artifactContentId`. The artifact pins the independently reconstructed full-source lexical namespace:

```text
6aba6e8a20610ece73a028ed4dd9e64aefaaff3eec3f9a8bb56fd33c3bdfb144
```

That namespace identifies the full-source lexical identity meaning established from UniDic-CWJ 2025.12; the bounded slice does **not** mint a replacement namespace from its subset rows. Its physical dense lemma handle is named `lemmaIndex` specifically because it is only slice-local and must not be confused with a full-namespace `localLemmaId`. Concrete subset integrity is instead carried by section digests and `artifactContentId`.

The runtime adapter exposes source-qualified lexical identities, readings, lexical origin and morphology to the existing resolver. Explicit whole-word Ruby filters compatible lexical candidates using source-backed modern-reading evidence; ambiguity remains representable rather than being collapsed by storage order. OOV input fails closed, and protected input bypasses lexical lookup.

Phase 3.5 (#53) adds a `readingIndex` section: a deterministic secondary index from modern reading to indexes in the same `candidates` table, so it owns no lexical data of its own. `lookupReading(reading)` returns every matching candidate (with its surface) and the resolver's `resolveReading` feeds them straight into the same semantic path as surface input — `がっこう` reaches `unidic-cwj:2025.12:lemma:8098` and renders `學校`, while a reading with several lemmas (`あわ`) stays `CANDIDATES`. The resolver bundle covers `readingIndex` with the lexical section digests and rejects artifacts that omit it. Browser-class and Worker-class VM probes load the same core runtime without mutating either consumer repository.

This is an **acceptance slice**, not production-scale lexical coverage. It does not freeze a final binary format, public package/API, consumer bundle loader, or release/distribution mechanism, and it is not a claim that the bounded JSON artifact is the final full-corpus physical layout.

## Source-backed Sino-Japanese historical-reading acceptance slice

`data/historical/sino/kkh-jion-first-slice.json` and `runtime/historical-sino-runtime.js` form a second bounded acceptance slice that joins the real UniDic lexical namespace to source-backed Sino-Japanese historical-reading evidence.

The first accepted anchor is `学校`:

```text
UniDic lexical identity: unidic-cwj:2025.12:lemma:8098
modern reading:          がっこう
lexical origin:          Sino-Japanese
historical reading:      がくかう
components:              学 / がく -> がく
                         校 / こう -> かう
late safe rendering:     学 -> 學
result:                  學校《がくかう》
```

The evidence slice pins `okikae/kkh` commit `19b24f88ab55809a186d88c465959548495b26a2`. It keeps two source roles distinct:

- `kana-jisyo` blob `6a69cdc140994a0b8d5f6acb86d7b3b8c3ef20be` supplies the active whole-word relation `がっこう -> がくかう` for `学校`;
- `jion-jisyo` blob `3447864cb4b661c586ae1a35ef7cc524b3d5d895` supplies component 字音 candidate evidence including `学 / がく`, `校 / かう`, and the alternative `校 / けう`.

The modern component readings `学 = がく` and `校 = こう` are kept as separate project-canonical acceptance evidence from repository objective comment `#5890398199`; they are not attributed to KKH's historical 字音 records. The selected relation therefore joins project-canonical modern component readings to the pinned KKH whole-word/component historical evidence while retaining `校 / けう` as an unselected source alternative rather than flattening it into a global `校 -> かう` rule.

The project relation is keyed by the exact UniDic lexical identity and full-source lexical namespace, so namespace mismatch, unknown lexical identity, malformed/dangling evidence, and non-Sino candidates fail closed. The upstream `jion-jisyo` describes itself as Beta/incomplete; this slice therefore proves the evidence/runtime boundary only and makes no broad-coverage claim.

When the lexical artifact has no component records, the accepted historical relation may provide component evidence without fabricating UniDic component lexical identities. Those components are used only when they remain aligned with the rendered lexical surface; if a separate contextual-kanji relation changes the surface to a different target, source-surface fallback components are withheld rather than serialized inconsistently.

Plain input, compatible whole-word Ruby, and compatible component Ruby converge on the same lexical/historical semantic result. Rendering remains late and does not trigger a second lexical analysis.

This slice does **not** import the full KKH dictionaries, choose one timeless reading for every character, or itself expand native historical kana/contextual-kanji/safe-character coverage. Those domains have separate bounded accepted slices below; this Sino slice still does not freeze a production bundle/API, mutate consumers, or authorize release/publication.

## Source-backed native historical-kana authority

Phase 4.6D expands the earlier bounded native-kana proof into selected-source completeness while keeping the same fail-closed resolver architecture.

The canonical runtime artifact is `data/historical/native/phase46d-native-kana.json`. It is generated deterministically from the Phase-4.6D intake and covers the pinned KKH `kana-jisyo` plus the selected committed native historical-kana dictionary, exception, animal/plant, and guide snapshots. Coverage is relative to those pinned snapshots; it is not a claim of globally exhaustive or historically uncontested Japanese orthography.

The artifact keeps distinct authority channels:

- lexical identity + morphology relations, retaining the accepted `思う -> 思ふ` anchor;
- exact whole-surface relations such as `植え -> 植ゑ`;
- historical-reading relations that preserve the lexical surface, such as `挨拶 -> あいさつ`;
- explicit surface/reading candidate sets where source evidence conflicts or remains ambiguous;
- excluded/disabled intake records, which never become executable authority.

Source ordering does not select a winner. `味わおう` retains both `味はゝう` and `味ははう` as candidates, while cross-source `藍` reading evidence remains `あゐ / アヰ` rather than being collapsed. The runtime applies lexical identity+morphology first, then exact whole-surface fallback only when doing so does not erase an existing multi-candidate lexical analysis. Literal substring replacement is not used.

`data/historical/native/kkh-kana-first-slice.json` remains as the bounded Phase-2A regression fixture for the original identity+morphology proof; it is no longer the current resolver bundle's complete native-kana authority input.

Detailed original anchor boundary: `docs/phase2a-native-slice.md`. Phase-4.6D design and execution are tracked under #70 and the accepted Phase-4.6D plan.

## Source-complete 字音仮名遣い authority (Phase 4.6E)

`仮名遣等資料/字音仮名遣い表.html` (blob `89dd7a1`) is the coverage oracle. `tools/sino-table-parser.ts` extracts one record per listed character: 2,013 records, zero parser remainder, 77 heading readings. `data/intake/phase46e-sino-kana.json` classifies all of them (2,011 admitted including 132 grey "same as modern" identity rows; `(漁)` and the `その他` catch-all row excluded with reasons). `validate:sino-kana` in `npm run check` fails on drift, remainder, or stale artifacts.

`data/historical/sino/phase46e-sino-kana.json` keys each relation by `(character, modern reading, optional usage context)`:

- `resolveHistoricalSino({ character, modernReading, context })` reproduces every admitted table relation exactly; without a context, `法 / ほう` returns the complete set `はふ / ほふ`.
- `reconstructWord(surface, modernReading)` aligns a kanji-only word against the table, allowing the table's voicing note and gemination (く/き/ち/つ codas keep their spelling; ふ codas become っ). Sounds the table does not list keep modern spelling, except geminated codas whose base reading cannot be known. Multiple spellings → candidates; `学校 / がっこう → がくかう`, `銀行 / ぎんこう → ぎんかう`.
- The resolver bundle uses this artifact; lexical identity relations (the accepted `学校` relation) keep precedence, and ambiguous reconstructions surface as `CANDIDATES`.

The companion `字音仮名_まとめ.xlsx` and KKH `jion-jisyo` are not used as inputs.

## KiNoTch consumer rule responsibilities (Phase 4.6F)

`data/intake/phase46f-kinotch-profile.json` assigns a Phase-4.6 responsibility to each of the 373 active KiNoTch-local relations in `txt-auto-replace@198f856` stages 10/15/20/30/31/60 (vendored under `data/sources/txt-auto-replace/`, blob-verified by `validate:kinotch-profile-intake`). Project style and semantic rules stay `kinotch_style` / `kinotch_semantic`; Stage-60 kyujitai candidates stay `character_form` / excluded until individually admitted, and only relations already in the deterministic safe map are admitted. This is classification only: no consumer or resolver behavior changes.

## Real contextual-kanji lexical-binding acceptance slice

`data/lexical/bindings/contextual-kanji-unidic-first-slice.json` connects one already-canonical contextual relation to the accepted real UniDic lexical path without duplicating the relation in a second corpus.

Accepted anchor:

```text
台風 / たいふう
  -> UniDic-CWJ 2025.12 identity unidic-cwj:2025.12:lemma:21903
  -> canonical constraint-taifu / rel-taifu
  -> 颱風
```

The contextual pack's project binding namespace `pmin-current` remains distinct from the source-qualified UniDic namespace. The binding loader validates source namespace, dictionary/version, archive-member SHA-256, lemma, surface, lexical origin, reading, and identity before producing the compiler binding.

Only `constraint-taifu` is real-bound in this acceptance slice. Wrong/non-covering identity fails closed to the original `台風` with review-safe disposition. The slice creates no global `台 -> 颱` or `台 -> 臺` rule, does not fabricate real identities for unproven contextual constraints, and does not silently select unresolved candidate targets such as `合弁`.

Detailed accepted boundary: `docs/phase2c-contextual-binding.md`.

## Source-backed deterministic safe-character acceptance slice

`data/deterministic/safe-character-first-slice.json` and `runtime/safe-character-runtime.js` establish one source-backed unconditional deterministic character-rendering relation:

```text
学 -> 學
```

The mapping is admitted from Culture Agency character-form evidence plus the repository ruling that `学 -> 學` belongs to the deterministic layer. The existing KiNoTch compatibility profile is retained only as regression evidence because its manifest explicitly says `genericSafety: not_implied`; compatibility-profile membership is not generic-safety authority.

The bounded unconditional map explicitly excludes `弁` and `台`. `弁` requires lexical/sense restoration because the modern form merges multiple historical targets. `台` has a base `台(臺)` relation but also accepted contextual overrides/preserves, so any future `台 -> 臺` fallback requires guards rather than unconditional substitution.

The safe-character runtime validates source/evidence closure, mapping/regression/exclusion evidence refs, one-code-point relations, duplicate modern sources, and exclusion records. Its frozen `characterMap` is injected through the existing resolver's `safeKanjiMap`; Phase 2D adds no parallel rendering pipeline.

The accepted cross-layer behavior preserves contextual authority before deterministic rendering:

```text
学校 -> 學校 -> ｜學校《がくかう》
台風 -> 颱風     # safe map contains no 台 entry
```

Detailed accepted boundary: `docs/phase2d-safe-character-slice.md`.

## Production resolver bundle acceptance slice

`tools/resolver-bundle.ts` and `runtime/resolver-bundle-runtime.js` form the bounded Phase 3 production resolver bundle path. The build-time artifact selects the accepted lexical, native historical, Sino historical, real-bound contextual and safe-character sections and records deterministic section/content identities plus a bundle content ID.

Activation is atomic at the full-bundle capability level: supported schema/semantics, required capabilities/sections, lexical section identity, native/Sino lexical namespace agreement, Phase 2C source lexical namespace and `pmin-current` binding namespace, required runtime modules, contextual sections and the safe-character slice must all validate before one resolver is returned. Missing or incompatible required sections fail closed rather than silently producing a partial object that still claims the full bundle.

The activated bundle keeps the existing analysis-first / late-rendering pipeline and reproduces the accepted cross-layer behavior through one entry point:

```text
学校 -> 學校 / ｜學校《がくかう》
台風 -> 颱風
今日 -> candidates unless Ruby reading evidence narrows it
未知語 -> unresolved
protected input -> preserved
```

Plain `思う` remains ambiguous in the bounded UniDic slice; Phase 3 does not weaken the Phase 2A morphology/ambiguity boundary merely to force an automatic `思ふ` result. The bundle runtime is exercised in browser-class and Worker-class sandboxes.

Detailed accepted boundary: `docs/phase3-resolver-bundle.md`.

## Orthography resolver first slice

`runtime/orthography-resolver.js` is the first bounded proof of the repository's analysis-first / late-rendering architecture. It accepts lexical and historical evidence through injected adapters/data and reuses `TransformShared` for Ruby parsing; it does not adopt a production tokenizer or dictionary.

The first-slice fixture proves these distinct responsibilities can compose without flattening them into one replacement table:

- lexical identity, modern reading and reading-evidence provenance;
- lexical origin and component readings;
- native historical kana vs. Sino-Japanese 字音 routing;
- contextual lexical kanji restoration such as `台風 -> 颱風`;
- deterministic safe rendering such as `学 -> 學` only after contextual resolution;
- preserve/candidate/unresolved states;
- serialization after semantic resolution.

Ruby changes the reading-evidence source, not the resolver pipeline. The bounded acceptance cases treat these as equivalent semantic inputs when their evidence agrees:

```text
学校
｜学校《がっこう》
学校《がっこう》
｜学《がく》校《こう》
学《がく》校《こう》
```

The same resolved `学校` unit can be serialized without re-analysis as, for example:

```text
學校
｜學校《がくかう》
學校《がくかう》
｜學《がく》校《かう》
學《がく》校《かう》
```

`test/fixtures/orthography-resolution/first-slice.json` remains deliberately small deterministic evidence for resolver-semantic verification. It is not production lexical coverage or a public data format; the real lexical and historical-reading acceptance paths above test source/compiler/runtime boundaries separately.

## Resolver benchmark

Run:

```sh
npm run bench:resolver
```

The harness reports:

- resolver/runtime and fixture byte sizes;
- cold initialization wall time;
- retained heap delta;
- fixed-corpus resolve latency and throughput;
- end-to-end resolve+render character throughput;
- harness-observable load-copy bytes/count;
- `cache: null` while the first slice has no cache.

Node/VM internal copies that the runtime does not expose are explicitly marked unobserved rather than estimated. Benchmark values are expected to vary by host and run; optimization decisions require repeated measurements on the actual browser/Worker path.

## Hybrid generative historical-orthography layer (Phase 4.7)

Phase 4.7 adds a **hybrid dictionary + productive-rule resolver layer** on top of the accepted Phase-4.6 evidence/intake authority. It does not replace exact lexical/context evidence with broad substitution. The operative rule is: use reusable generation where its applicability is explicitly safe, and keep dictionary/context selection where a relation is lexical, ambiguous, domain-dependent, or otherwise unsafe to generalize.

The normalized relation model separates graph shape from application policy. Relations can represent 1:1, 1:N, N:1, or N:N form sets while independently declaring exact-lexeme, productive-substring, productive-character, contextual, generated-pattern, or preserve/block behavior. Graph cardinality therefore never implies generic safety by itself.

Accepted layers:

- **4.7A — normalized relation/trace contract:** canonical surface, reading, and character-form relations with source/evidence provenance and distinct implicit/attested/preserve identity semantics.
- **4.7B — Kana/render normalization:** opt-in Hiragana/Katakana folding for script-equivalent forms; script-significant Katakana remains distinct. Expanded repetition is canonical internally for supported iteration forms, with ゝ/ゞ, ヽ/ヾ, 々, and explicit-span 〳〵 treated as rendering. Full-size `つ` preference is gated by evidence that the small/full forms are the same already-reconstructed historical representation.
- **4.7C — productive/unknown-word execution:** only explicitly productive relations apply inside larger or dictionary-unknown strings. Longest-match is deterministic; preserve/block wins; equal-priority conflicting outputs remain unresolved; exact/contextual/candidate relations never leak into generic substitution.
- **4.7D — context propagation:** specialist labels in the official homophone table remain metadata/eligibility signals rather than unconditional authority. 字音 usage context is executable; `法 / ほう / 仏教用語 -> ほふ` and `法 / ぼう / 仏教用語 -> ぼふ`, while missing context preserves the unqualified candidate family.
- **4.7E — candidate coherence/preference:** exact cross-channel evidence may select a compatible source candidate without deleting the source set. Incompatible exact evidence fails closed before weaker preference. Diachronic, rendering, and manual priority layers are explicitly bounded; unresolved remains valid.
- **4.7F — generated compact runtime/audit:** canonical Unicode/source data remains readable authority while a deterministic generated projection interns reusable strings and builds per-channel indexes. It inflates losslessly to the normalized graph. On the accepted native normalized graph, the current JSON projection measured 3,467,849 canonical bytes vs. 2,145,617 compact bytes (ratio 0.6187169626). This is an implementation measurement, not a frozen target or public format. Applicability-ledger records expose candidates, result basis, applied/blocked rules, and provenance.
- **4.7G — end-to-end acceptance:** a cross-layer acceptance matrix proves A–F interoperate without adding new production semantics.

Representative boundaries:

```text
unknown/new string
  -> safe productive character/span rules may apply
  -> untouched regions remain unresolved rather than guessed

弁 -> 辯 / 辨 / 瓣 / 辦
  -> lexical/contextual family; never a generic one-character substitution

うじうじ
  exact historical reading: うぢうぢ
  surface candidates:       うじ〳〵 | うぢうぢ
  -> compatible cross-channel evidence may select うぢうぢ
  -> original source candidates remain inspectable

法 / ほう
  no usage context -> はふ | ほふ
  仏教用語         -> ほふ
```

Generated, preferred, and unresolved results remain epistemically distinct from source-attested exact authority. Phase 4.7 does not freeze a package/public API, binary format, consumer integration contract, or release/distribution mechanism.

## Pinned JMdict lexical intake (Phase 4.8A)

`data/lexical/sources/jmdict/2026-10-01/` holds a field-selected, gloss-free extract of the JMdict 2026-10-01 snapshot (218,850 entries; CC BY-SA 4.0, see its `NOTICE.md`). It is lexical identity evidence only: JMdict entry grouping never selects a historical form, and `ent_seq` is source-local provenance (`jmdict:<date>:seq:<n>`), not a repository semantic ID. `npm run validate:jmdict-intake` enforces the extract hash, field contract and zero-loss accounting. Contract: `docs/phase48a-jmdict-intake-contract.md`.

Phase 4.8B adds the typed lexical entity graph and shared historical→modern reading-convergence DAG (`tools/lexical-entity-graph.ts`, `docs/phase48b-entity-graph.md`). Phase 4.8C compiles the pinned JMdict extract into that graph (218,850 lexemes) and projects the accepted 4.6E 字音 authority onto 177 shared primary + 94 derived convergence patterns that reproduce the accepted direct and word-level results exactly (`docs/phase48c-lexical-graph-compiler.md`, measurements in `data/reports/phase48c-lexical-graph-measurements.json`).

## Current boundary

Phase 4.7 is **complete / accepted**. The repository now owns the accepted Phase-3 resolver foundation, Phase-4.6 evidence-driven authority expansion, and the Phase-4.7 hybrid generation/audit layer.

The accepted authority boundaries are:

- exact lexical/context/source evidence outranks generated preference;
- all source-supported candidates remain represented even when a later layer selects one;
- source/storage order never chooses a winner;
- generic authority remains separate from KiNoTch-specific semantic/style policy;
- unsafe homophone/merged-character relations remain guarded;
- dictionary absence does not imply total failure when an explicitly safe productive rule applies;
- representation-only Kana/iteration variation can be normalized without being misreported as linguistic ambiguity;
- specialist/domain metadata participates only where context is known;
- generated/preferred decisions remain distinguishable and auditable;
- compact runtime artifacts are generated implementation details reproducible from canonical data.

The bounded KiNoTch project-profile authority accepted in Phase 4.5 (including `こと -> ヿ`) remains separate from generic authority. Phase-4.6 source completeness is relative to selected pinned snapshots; Phase 4.7 does **not** claim universal historical orthography correctness.

Consumer repositories remain explicitly source-locked. The accepted consumer remains `txt-auto-replace@198f8560613d23417cb0f87172ae8662e722ca30`; Phase 4.7 does not silently move that consumer to newer core behavior.

Phase 5 `kinotch-api` integration, Phase 6 stable package/public API/distribution, and broader unselected #46/#47 work remain explicitly unselected. No release, deploy, publication, credential/permission change, destructive operation, shared-history rewrite, or generated-artifact publication is authorized by this state.

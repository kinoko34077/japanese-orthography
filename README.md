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

## Source-backed native historical-kana acceptance slice

`data/historical/native/kkh-kana-first-slice.json` and `runtime/historical-native-runtime.js` prove one conservative native historical-kana boundary. The accepted anchor is:

```text
思う / おもう
  -> UniDic-CWJ 2025.12 identity unidic-cwj:2025.12:lemma:5255
  -> lexical origin native
  -> morphology 五段-ワア行 / 終止形-一般
  -> pinned KKH relation 思う /思ふ ;ハ行四段
  -> 思ふ
```

The relation is admitted only for the exact lexical identity, native origin, and terminal morphology proved by Phase 2A. Same-lemma non-terminal morphology fails closed, and surface-level lexical ambiguity remains candidates rather than being collapsed merely because candidates share a lemma. No global `う -> ふ` rule is created.

The pinned KKH source also contains both `味わおう /味はゝう` and `味わおう /味ははう`. Both remain recoverable source evidence; neither is promoted to an automatic runtime relation. Full KKH ingestion, broad native coverage, consumer integration, package/API stabilization, and release/deploy/publication remain outside this bounded slice.

Detailed accepted boundary: `docs/phase2a-native-slice.md`.

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

## Current boundary

Phase 3.5 is complete at the bounded generic-core acceptance-slice level. This repository now owns:

- canonical contextual-kanji corpus/build-time behavior;
- the fixed compatibility/runtime foundation;
- a real-source UniDic lexical artifact/lookup acceptance path;
- Phase 2B source-backed Sino-Japanese historical-reading resolution;
- Phase 2A morphology-qualified native historical-kana resolution;
- Phase 2C real lexical binding for canonical contextual restoration;
- Phase 2D source-backed unconditional deterministic safe-character rendering;
- Phase 3 deterministic build-time resolver bundle composition and atomic full-bundle runtime activation;
- Phase 3.5 reading-index lexical reconstruction through the same resolver semantic path.

The accepted generic resolver/core baseline remains `21f4cb0d0fcf29a6327a7ac36a54bd41f524079c`. Later accepted project-profile work advances repository state without redefining that generic authority.

## Accepted KiNoTch project-profile style slice

Phase 4.5B accepted one deliberately narrow project-profile/style rule under #64 / PR #67:

```text
profile:       kinotch-authoring
authority:     project_profile
responsibility: style_render
matching:      exact_token
rule:          こと -> ヿ
genericSafety: not_implied
```

The canonical profile source is isolated under `data/profiles/kinotch/`, with typed fail-closed loading/validation and deterministic artifact generation. This is project style authority, not generic historical-restoration truth and not evidence that other profile candidates are safe to admit.

The corresponding source-locked consumer path was accepted separately in `txt-auto-replace` Phase 4.5B. Consumer acceptance does not transfer browser/product ownership into this repository.

These accepted slices prove responsibility boundaries, cross-layer composition, one production-shaped generic activation contract, and one bounded generic-core + project-style composition path. They do **not** claim broad/full-corpus production coverage, broad semantic/profile migration, or freeze a stable public API/package, binary format, consumer loading contract or distribution mechanism.

The separate `txt-auto-replace#19` / PR #20 Phase-4.5C semantic-gap correction remains independent follow-on work and does not broaden the accepted upstream profile slice.

Phase 5 `kinotch-api` full resolver integration, Phase 6 stable package/public API/distribution, broader corpus/profile expansion, and further #46/#47 work remain explicitly unselected unless separately bounded and accepted. No release, deploy, publication, credential/permission change, destructive operation, shared-history rewrite, or generated-artifact publication is authorized by these accepted slices.

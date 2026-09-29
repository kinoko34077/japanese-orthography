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

The repository author commands currently use `test/fixtures/integration/first-slice.json` to exercise the integration boundary before a real consumer lexical artifact and safe-character pack are adopted. The fixture explicitly supplies:

- a simulated `pmin-current` lexical namespace and opaque `fixture-local-*` binding IDs;
- the external `safe-kanji/char-tai-to-dai` export required by the `台` fallback tests.

These fixture bindings are **not** canonical lexical identities and are not production Pmin local IDs. They exist only to prove that source-qualified canonical evidence is bound through an explicit per-build input instead of being copied into hot runtime IDs. A future consumer build must supply its real namespace-local bindings and external-pack exports before using the generated sections.

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

The runtime adapter exposes source-qualified lexical identities, readings, lexical origin and morphology to the existing resolver. Explicit whole-word Ruby filters compatible lexical candidates using source-backed modern-reading evidence; ambiguity remains representable rather than being collapsed by storage order. OOV input fails closed, and protected input bypasses lexical lookup. Browser-class and Worker-class VM probes load the same core runtime without mutating either consumer repository.

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

This slice does **not** import the full KKH dictionaries, choose one timeless reading for every character, expand native historical kana, expand contextual-kanji or safe-character coverage, freeze a production bundle/API, mutate consumers, or authorize release/publication.

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

This repository now owns canonical corpus/build-time behavior, the fixed compatibility/runtime foundation, a bounded resolver runtime proof, a bounded real-source lexical artifact/lookup acceptance path, and a bounded source-backed Sino-Japanese historical-reading acceptance path. It still does not migrate or change `txt-auto-replace`, `kinotch-api`, or any other consumer, and it does not release, deploy, or publish generated artifacts. The contextual `dist/` output, resolver semantic fixture, real lexical slice, and historical-reading slice remain development/verification surfaces rather than consumer-ready publication artifacts; broader Phase 2 coverage, full-corpus packaging, production bundle compatibility/loading and consumer integration remain later explicitly selected phases.

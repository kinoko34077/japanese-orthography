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
```

- `npm run validate` performs schema, pack-local semantic, and configured integration validation without mutating canonical source.
- `npm run compile` validates and atomically replaces `dist/contextual-kanji/` only after a complete successful build.
- `npm test` runs structural, semantic, integration, compiler, canonical-slice, and CLI tests.
- `npm run check` requires zero unresolved `ERROR`/`REVIEW` diagnostics, runs the complete tests/typecheck, proves deterministic compilation, and compares generated output with tracked golden artifacts.

## First-slice integration fixture

The repository author commands currently use `test/fixtures/integration/first-slice.json` to exercise the integration boundary before a real consumer lexical artifact and safe-character pack are adopted. The fixture explicitly supplies:

- a simulated `pmin-current` lexical namespace and opaque `fixture-local-*` binding IDs;
- the external `safe-kanji/char-tai-to-dai` export required by the `台` fallback tests.

These fixture bindings are **not** canonical lexical identities and are not production Pmin local IDs. They exist only to prove that source-qualified canonical evidence is bound through an explicit per-build input instead of being copied into hot runtime IDs. A future consumer build must supply its real namespace-local bindings and external-pack exports before using the generated sections.

## Current boundary

This repository slice defines canonical corpus/build-time behavior only. It does not migrate or change `txt-auto-replace`, `kinotch-api`, or any other consumer, and it does not release, deploy, or publish generated artifacts. The default first-slice `dist/` output is fixture-bound and therefore must not be treated as consumer-ready publication output.

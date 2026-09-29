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

## Current boundary

This repository slice defines canonical corpus/build-time behavior only. It does not migrate or change `txt-auto-replace`, `kinotch-api`, or any other consumer, and it does not release, deploy, or publish generated artifacts.

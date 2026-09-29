# Shared Transformation Runtime Canonicalization Design

Status: Accepted direction / implementation design
Owner: japanese-orthography#14
Parent architecture: japanese-orthography#4
Date: 2026-09-29

## 1. Goal

Make `japanese-orthography` the canonical owner of the transformation runtime that is already shared byte-for-byte by `txt-auto-replace` and `kinotch-api`, without changing transformation behavior or importing consumer-specific responsibilities into the core.

This slice is authority migration first, refactoring second. It does not redesign the runtime API.

## 2. Audited starting point

At the start of this slice the two consumers contain identical Git blobs:

| Module | Git blob |
| --- | --- |
| `transform-engine.js` | `9ed98ce3b8075828ee431ef30cfa7d9bcdd31f49` |
| `transform-shared.js` | `24518621cb7816f8daee6bc67911a14bed74cac6` |
| `structured-dictionary.js` | `21d9c1bc17b7ceadf29630d10ac3f905b2047883` |

The `kinotch-api` copies live under `src/text-core/vendor/`; the `txt-auto-replace` copies are repository-root runtime files.

The three modules are UMD-compatible. `transform-engine.js` consumes `transform-shared.js`; tokenizer/runtime resources are supplied by consumers. `structured-dictionary.js` does not own browser storage or HTTP/service integration.

Because both consumers already use the same implementation, independent local editing creates drift risk without representing independent product semantics.

## 3. Ownership boundary

### 3.1 Core-owned

The canonical runtime slice owns the existing semantics embodied by:

- candidate and matcher normalization;
- wildcard/regex helpers;
- ruby/text parsing helpers already shared by both consumers;
- rule normalization, compilation, precedence and transformation execution;
- token/morphology matching semantics exposed by the existing engine;
- structured-dictionary normalization, validation and legacy-tree bridge semantics;
- runtime module identity and deterministic consumer snapshot generation.

### 3.2 Consumer-owned

`txt-auto-replace` continues to own:

- DOM traversal;
- MutationObserver integration;
- browser/extension lifecycle;
- UI/settings/storage;
- Undo/Redo and page state;
- tokenizer lifecycle and browser resource wiring.

`kinotch-api` continues to own:

- HTTP routes/contracts;
- Hono/Cloudflare Worker integration;
- CORS/rate/body limits;
- Service Bindings;
- API metadata and operational policy;
- deploy/release/smoke/recovery;
- tokenizer lifecycle and service resource wiring.

Neither consumer-owned category becomes part of the core merely because current runtime code can be loaded there.

## 4. Canonical source layout

Use a small runtime namespace that preserves the accepted filenames:

```text
runtime/
  transform-shared.js
  transform-engine.js
  structured-dictionary.js
  manifest.json
```

The three JavaScript files are initially adopted byte-for-byte from the already-identical consumer implementation.

`manifest.json` records deterministic identity for the canonical runtime set, including:

- manifest schema version;
- runtime semantics version;
- ordered module list;
- byte length;
- SHA-256 payload digest;
- original adopted Git blob identity;
- dependency relation (`transform-engine` requires `transform-shared`).

The manifest is identity/provenance metadata. It must not introduce runtime network loading.

## 5. Consumer snapshot contract

Consumers continue to load the same operational filenames and module shapes.

Each consumer receives:

1. byte-exact snapshots of the canonical runtime modules;
2. a source-lock file recording:
   - core repository;
   - exact core commit;
   - runtime manifest identity;
   - per-module digest/length;
   - local operational path;
3. an offline verifier that fails when:
   - a local runtime module differs from the pinned canonical payload identity;
   - the source lock is malformed;
   - required module/path/order identity changes unexpectedly.

Consumer snapshots are generated/vendored artifacts, not independent authoritative source.

No runtime request to GitHub or `japanese-orthography` is introduced.

## 6. Compatibility strategy

### 6.1 No API rewrite in this slice

The existing UMD/CommonJS/global surfaces remain intact. Existing imports such as:

```js
require("./vendor/transform-engine.js")
```

and browser global loading remain valid.

Converting the runtime to ESM, TypeScript, a new package API, or a new object model would combine authority migration with semantic/API migration and is therefore excluded.

### 6.2 Byte parity first

The canonical runtime files must initially have the same bytes as the accepted consumer files.

This gives a strong migration invariant:

```text
before consumer runtime blob == canonical adopted blob
after consumer runtime blob  == canonical adopted blob
```

The first authority migration therefore changes ownership and verification, not runtime semantics.

### 6.3 Refactoring after authority convergence

After both consumers pin the same canonical runtime, later internal refactoring may occur in the core only through a separate bounded change with parity/regression evidence. It is not part of this slice.

## 7. Core verification

Core verification must prove at minimum:

1. all three canonical runtime modules are present;
2. their payload digests/lengths match the runtime manifest;
3. CommonJS loading works in Node;
4. `transform-engine` resolves the canonical `transform-shared`;
5. representative pure-string rules execute without DOM/browser/HTTP/Cloudflare dependencies;
6. structured-dictionary normalize/validate behavior is executable;
7. deterministic runtime artifact generation reproduces tracked golden/runtime snapshots.

Tests must not require consumer DOM, Cloudflare, Production resources, or network access.

## 8. Migration order

### Slice A — canonical core

- adopt the three modules byte-for-byte;
- add runtime manifest and validation/check integration;
- add runtime smoke/parity tests;
- merge after exact-head verification.

### Slice B — first consumer: txt-auto-replace

- re-bootstrap its live Control/current main;
- add runtime source lock and offline drift verifier;
- keep operational filenames unchanged;
- prove current runtime/golden behavior remains green;
- merge and post-merge verify.

### Slice C — second consumer: kinotch-api

Only after Slice B is accepted:

- re-bootstrap live Control/current main;
- add equivalent runtime source lock/drift verification under `src/text-core/vendor`;
- preserve `src/text-core/index.cjs`, Worker/API wiring and tokenizer resources;
- prove text-core/API regressions and required repository checks;
- merge and post-merge verify.

## 9. Rollback

Each consumer migration is an independent PR. A consumer can revert its migration PR to restore the previous local-authority state without changing the other consumer or the core.

The core adoption itself does not change consumer runtime until a consumer migration lands.

## 10. Explicit exclusions

This slice does not:

- migrate additional rule packs;
- change 40/50/55 semantics;
- construct generic safe-character data;
- integrate contextual-kanji hot artifacts;
- migrate Kuromoji dictionary payloads;
- change tokenizer choice;
- publish npm packages;
- introduce runtime GitHub fetches;
- change DOM/UI behavior;
- change HTTP/Worker/API behavior;
- deploy or release anything.

## 11. Acceptance

The slice is complete when:

- `japanese-orthography` is the explicit canonical source for the three runtime modules;
- both consumers use source-locked byte-exact snapshots of the same canonical runtime identity;
- consumer-local edits to those snapshots are detected by repository verification;
- existing consumer behavior remains green;
- product/service responsibilities remain outside the core;
- #4 and devflow Controls reflect the new ownership state.

Completion of this slice does not automatically authorize ESM/TypeScript conversion, package publication, tokenizer extraction, larger rule migration, or runtime redesign.

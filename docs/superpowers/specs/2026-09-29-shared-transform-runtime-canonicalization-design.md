# Shared Transform Runtime Canonicalization Design

Date: 2026-09-29
Owner: `japanese-orthography#4`
Execution tracker: `japanese-orthography#15`
Status: proposed design

## 1. Goal

Move canonical ownership of the already-proven, byte-identical first-party transformation runtime code from duplicated consumer copies into `japanese-orthography`, then make both existing consumers use source-locked generated vendored snapshots without changing transformation behavior or consumer loading topology.

This slice changes **ownership and reproducibility**, not the runtime API or product architecture.

## 2. Current evidence

The following modules are byte-identical on the current accepted consumer mains:

| Logical module | `txt-auto-replace` | `kinotch-api` | Current Git blob |
| --- | --- | --- | --- |
| transform engine | `transform-engine.js` | `src/text-core/vendor/transform-engine.js` | `9ed98ce3b8075828ee431ef30cfa7d9bcdd31f49` |
| shared syntax/ruby helpers | `transform-shared.js` | `src/text-core/vendor/transform-shared.js` | `24518621cb7816f8daee6bc67911a14bed74cac6` |
| structured dictionary | `structured-dictionary.js` | `src/text-core/vendor/structured-dictionary.js` | `21d9c1bc17b7ceadf29630d10ac3f905b2047883` |

This is stronger than similarity: both products are currently executing the same three first-party payloads.

The surrounding adapters are intentionally different:

- `txt-auto-replace/transform-worker.js` owns Web Worker loading, `importScripts`, tokenizer lifecycle, revision/batch messaging, and browser-product metrics.
- `kinotch-api/src/text-transform-worker.js` owns Hono routing, HTTP validation/errors, CORS, request IDs, Cloudflare asset access, tokenizer asset loading, service metadata, and API response contracts.

Therefore the three shared modules have a demonstrated two-consumer reuse boundary, while the Worker/product layers do not.

## 3. Decision

### 3.1 Canonical code owner

`japanese-orthography` becomes the canonical owner of exactly these three existing runtime modules in the first slice:

```text
runtime/compat/
  transform-engine.js
  transform-shared.js
  structured-dictionary.js
  source-manifest.json
```

`compat` means “current proven compatibility runtime”, not “deprecated”. It distinguishes this mechanically adopted runtime surface from future resolver/analysis modules and avoids pretending that the current file/API layout is the final public package API.

The initial canonical files are adopted byte-for-byte from the accepted consumer payloads. No cleanup, conversion to TypeScript, module-system rewrite, renaming, or behavior change is a prerequisite for ownership transfer.

### 3.2 Generated artifact

The deterministic build exposes a vendorable artifact equivalent to:

```text
dist/compat/runtime/
  manifest.json
  transform-engine.js
  transform-shared.js
  structured-dictionary.js
```

The three JavaScript payloads are byte-identical copies of the canonical source files. `dist/` remains derived/non-canonical; canonical edits occur only under `runtime/compat/`.

The artifact manifest contains at minimum:

```text
artifactSchemaVersion
runtimeId
runtimeSemanticsVersion
canonicalSourceDigest
moduleSetDigest
modules[] {
  id
  file
  sha256
  byteLength
}
adoptedSourceSet {
  txtAutoReplace {
    repository
    pinnedCommit
    files[] { path, gitBlob }
  }
  kinotchApi {
    repository
    pinnedCommit
    files[] { path, gitBlob }
  }
}
```

`runtimeSemanticsVersion` begins at the current compatibility semantics and changes only when runtime behavior/contract changes. It is independent from artifact schema and payload digests.

Wall-clock timestamps, host names, absolute paths, and dirty-worktree state must not affect deterministic artifact bytes or identity.

### 3.3 Core commit identity

The generated core artifact must not fabricate or self-embed a commit SHA during a local build.

Each consumer source lock records the **actual merged `japanese-orthography` commit** from which its vendored artifact was materialized, plus the artifact/module digests. This preserves exact cross-repository provenance without creating self-referential build identity.

## 4. Runtime boundary

### 4.1 Core-owned in this slice

- rule/stage normalization and loading implemented by the current transform engine;
- runtime-plan compilation;
- dictionary/regex/wildcard/token-rule execution semantics already implemented by the shared engine;
- ruby/syntax helpers currently in `transform-shared.js`;
- structured dictionary validation/compilation currently in `structured-dictionary.js`;
- the current module export/UMD/CJS-compatible behavior of those three files.

### 4.2 Consumer-owned and explicitly excluded

`txt-auto-replace` retains ownership of:

- DOM traversal and MutationObserver integration;
- extension UI/settings/storage;
- Web Worker lifecycle and message protocol;
- browser resource resolution;
- page-state/Undo/Redo behavior;
- browser-product metrics and scheduling.

`kinotch-api` retains ownership of:

- Hono/HTTP routes and request/response contracts;
- CORS, request IDs, body/size/profile validation;
- Cloudflare Worker/Service Binding/asset wiring;
- API metadata and operational policy;
- deploy/release/smoke/recovery.

### 4.3 Tokenizer boundary

The first slice does **not** canonicalize or redistribute:

- `kuromoji.js`;
- Kuromoji/IPADIC dictionary assets;
- tokenizer asset-loading adapters.

The current transform engine already accepts a tokenizer/runtime object at its execution boundary. Consumers continue supplying tokenizer implementations/assets through their existing environment-specific paths.

This prevents first-party code ownership migration from becoming a third-party dependency/licensing/distribution redesign.

## 5. Consumer contract

### 5.1 `txt-auto-replace`

Operational paths remain:

```text
transform-engine.js
transform-shared.js
structured-dictionary.js
```

They become generated vendored snapshots of the accepted core runtime artifact. Existing script/worker loading order remains unchanged.

Add an adjacent runtime source lock and drift verifier. The lock records:

- core repository;
- exact merged core commit;
- runtime/artifact identity;
- canonical source/module-set digest;
- per-file SHA-256 and byte length;
- expected operational paths.

Direct edits to a generated runtime file without the corresponding core artifact/lock update fail CI.

### 5.2 `kinotch-api`

Operational paths remain:

```text
src/text-core/vendor/transform-engine.js
src/text-core/vendor/transform-shared.js
src/text-core/vendor/structured-dictionary.js
```

`src/text-core/index.cjs` and `src/text-transform-worker.js` continue using those paths. No import topology or HTTP behavior changes in this slice.

Add an adjacent runtime source lock and drift verifier with the same identity requirements as the browser consumer.

### 5.3 Existing rule source locks remain separate

The fixed KiNoTch. 40/50/55 rule-pack lock and the new runtime-code lock represent different authorities and update axes. They remain separate records even when both point to the same core repository.

A rule-data update must not imply a runtime-code update, and a runtime-code update must not silently repin rule data.

## 6. Verification strategy

### 6.1 Core adoption verification

Before the canonical runtime is considered established:

1. Compute Git blob identity from each canonical file and assert it matches the accepted current shared blob listed in Section 2.
2. Record both consumer source locations/commits in `source-manifest.json` as adoption provenance.
3. Assert the three source files contain no consumer adapter import dependency that requires DOM, Hono, Cloudflare bindings, or consumer-local modules to load the core module surface.
4. Exercise current Node/CJS-compatible exports for the three modules.
5. Exercise representative pure transformation behavior that does not require a real tokenizer.
6. Exercise ruby parsing and structured dictionary compilation behavior.

The initial adoption test is deliberately strict: a semantic rewrite is not permitted to hide inside canonicalization.

### 6.2 Deterministic artifact verification

Tests require:

- two builds from identical canonical sources produce byte-identical payloads and manifest;
- payload SHA-256/byte lengths match manifest entries;
- `moduleSetDigest` changes when any module payload changes;
- non-identity diagnostics cannot change artifact identity;
- artifact payload bytes equal canonical payload bytes.

### 6.3 Browser consumer parity

The `txt-auto-replace` migration must keep its existing runtime verification green, including its current transformation corpus and Worker/loader behavior.

Add migration-specific tests that verify:

- source lock matches exact merged core artifact;
- all three generated runtime files match locked digests/lengths;
- expected operational paths/loading order remain unchanged;
- a mutated generated runtime file or lock fails drift verification.

No browser-product feature behavior change is accepted as part of the migration.

### 6.4 API consumer parity

The `kinotch-api` migration must keep at least:

- `test/text-core.test.js`;
- `test/text-transform-worker.test.js` and relevant text-transform integration tests;
- repository `test` / `verify` gates;
- current API contract metadata and route behavior

GREEN on the exact migration head.

Add equivalent runtime source-lock/drift tests for the three vendored files.

No Production deploy/release is part of parity verification.

## 7. Migration order

The implementation is deliberately staged:

```text
Task A  adopt/canonicalize runtime in japanese-orthography
  -> exact adoption + deterministic artifact
  -> core PR/review/merge
  -> obtain merged core SHA

Task B  migrate txt-auto-replace
  -> source lock + drift gate
  -> existing runtime parity
  -> PR/review/merge

Task C  re-bootstrap live state
  -> reassess collisions / requirements

Task D  migrate kinotch-api
  -> source lock + drift gate
  -> existing core/Worker/API parity
  -> PR/review/merge

Task E  reconcile authorities and stop
```

A later consumer must pin the actual merged core SHA, never an unmerged feature-branch SHA.

Each consumer migration remains independently revertible through a normal revert PR.

## 8. Why vendored snapshots first

The first slice does not introduce npm publication, git submodules, monorepo restructuring, remote runtime fetching, or package-version resolution.

Reasons:

1. The two consumers already execute byte-identical files at stable local paths.
2. Ownership drift can be removed without changing runtime topology.
3. Browser extension and Cloudflare Worker packaging have different deployment constraints.
4. A package API should be justified by the proven extracted boundary, rather than defining the boundary in advance.
5. The existing fixed-rule-pack migration has already validated source-lock + generated-vendor operation across these repositories.

After both runtime consumers are source-locked to core, package/API extraction can be evaluated from concrete maintenance cost and future-consumer needs.

## 9. Alternatives not selected for the first slice

### 9.1 Rewrite as TypeScript modules now

Rejected for this slice because it combines ownership migration, module-system conversion, public API design, transpilation, and behavior change risk. It may become a later refactor once one canonical owner exists.

### 9.2 Publish an npm package immediately

Deferred because package/release lifecycle is not needed to establish canonical ownership and would add a release/versioning surface before the reuse boundary is proven operationally.

### 9.3 Canonicalize Kuromoji + dictionary assets together

Deferred because tokenizer code/data are third-party assets with distinct licensing, size, runtime-loading, and backend-replacement concerns. Their current duplication does not justify coupling that decision to first-party runtime ownership.

### 9.4 Move both consumer Workers into core

Rejected. Their reasons for change are product-specific and materially different.

## 10. Acceptance criteria

Phase 4 first slice is complete only when:

- [ ] `japanese-orthography` is the sole manually authoritative owner of the three shared runtime modules;
- [ ] canonical runtime adoption is byte-exact to the accepted pre-migration payloads;
- [ ] deterministic runtime artifact identity is machine-verifiable;
- [ ] `txt-auto-replace` operational runtime files are source-locked generated snapshots from an exact merged core SHA;
- [ ] `kinotch-api` operational runtime vendor files are source-locked generated snapshots from an exact merged core SHA;
- [ ] direct generated-file drift fails each consumer's verification;
- [ ] browser consumer behavior parity remains green;
- [ ] API/Worker consumer behavior parity remains green;
- [ ] browser/DOM and HTTP/Cloudflare adapters remain consumer-owned;
- [ ] Kuromoji/dictionary assets remain outside this first runtime slice;
- [ ] no npm/package publication, release, deploy, credential/permission mutation, or shared-history rewrite occurs;
- [ ] #4 and devflow controls are reconciled to the landed authority state;
- [ ] work stops for a new architecture assessment before package/API redesign, tokenizer extraction, or contextual-resolver expansion.

## 11. Rollback

The migration is intentionally reversible:

- core canonicalization is a normal repository PR;
- each consumer migration is a separate PR;
- consumer operational filenames and loaders remain unchanged;
- if a consumer migration is wrong, revert that consumer PR and restore the previous local-authority files without changing product loading topology;
- do not rewrite shared history.

## 12. Later reassessment gate

After both consumers are migrated, do not automatically continue into a package/runtime rewrite.

Reassess against concrete evidence:

- frequency of shared runtime changes;
- number and type of additional consumers;
- whether vendored update PRs are creating material operational cost;
- whether a stable smaller public API can now be stated without exposing internal execution details;
- whether tokenizer/backend work has a separately demonstrated cross-consumer requirement;
- whether the newer analysis-first/contextual resolver should compose with or supersede portions of the compatibility runtime.

Only then select among continued vendoring, package publication, a typed runtime API, module-system conversion, tokenizer extraction, or a different architecture.

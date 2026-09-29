# Orthography Resolution Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the smallest runtime-neutral resolver path that proves plain/Ruby lexical evidence convergence, component-aware historical kana/字音, contextual kanji restoration, deterministic safe rendering, ambiguity preservation, protected spans, late Ruby serialization, and reproducible performance measurement.

**Architecture:** Add one focused UMD runtime module beside the existing canonical runtime. It consumes `TransformShared` for Ruby parsing and receives lexical/historical/contextual/safe evidence through small injected adapters/data, so the first slice does not adopt a production tokenizer or flatten distinct authorities. Tests load the module through `vm`, use a deterministic fixture plus the existing compiled contextual-kanji golden sections, and compare semantic results independently of serialization.

**Tech Stack:** Node.js >=22, plain JavaScript UMD runtime, TypeScript `node:test` tests, existing `TransformShared`, JSON fixtures.

**Spec:** `docs/superpowers/specs/2026-09-29-orthography-resolution-vertical-slice-design.md`

## Global Constraints

- Analysis precedes textual rendering; no early source mutation may erase lexical evidence.
- Ruby changes reading-evidence acquisition, not the historical-resolution pipeline.
- `lexicalOrigin` and reading class remain separate axes.
- Native historical kana and Sino-Japanese 字音 remain separate routes.
- Contextual restoration precedes deterministic safe-character rendering.
- KiNoTch. compatibility mappings such as `弁 -> 辨` are not generic safe truth.
- Use only bounded deterministic first-slice fixture data; no production tokenizer/dictionary adoption or broad corpus import.
- Existing `runtime/transform-shared.js`, `runtime/transform-engine.js`, and `runtime/structured-dictionary.js` are not rewritten for style/module-format changes.
- No consumer migration, package publication, release/deploy, credential/permission change, or public API/binary-format freeze.

## Review Focus

- Whole-word Ruby and component Ruby must not force different lexical identities or historical targets.
- Component Ruby `学=がく`, `校=こう` must not be concatenated and mistaken for modern surface pronunciation `がっこう`.
- Multiple eligible contextual targets must remain candidates; a fallback must not silently pick one.
- A contextual target such as `颱風` must not be overwritten by later generic character rendering.
- Protected input must round-trip byte-for-byte and must not invoke lexical resolution.

---

### Task 0: Repair the directly blocking baseline test syntax defect

**Files:**
- Modify: `test/runtime-canonical.test.ts`

**Interfaces:**
- Consumes: existing runtime manifest test.
- Produces: syntactically valid existing test only; no product/runtime behavior change.

- [ ] **Step 1:** Run `node --import tsx --test test/runtime-canonical.test.ts` and preserve the existing syntax-error evidence caused by the literal `\\n` token.
- [ ] **Step 2:** Replace only the malformed literal `\\n` between the git-blob calculation and assertion with a real source newline.
- [ ] **Step 3:** Run `node --import tsx --test test/runtime-canonical.test.ts`; expected result is the pre-existing runtime canonical tests executing rather than transform syntax failure.
- [ ] **Step 4:** Commit as `test: repair runtime canonical syntax fixture`.

### Task 1: Pin the first-slice evidence fixture and RED semantic contract

**Files:**
- Create: `test/fixtures/orthography-resolution/first-slice.json`
- Create: `test/orthography-resolution.test.ts`

**Interfaces:**
- Consumes: existing `TransformShared` UMD module; `test/golden/contextual-kanji/hot-relations.json`; `test/golden/contextual-kanji/hot-safety.json`.
- Produces: fixture records with `lexicalIdentity`, `reading`, `lexicalOrigin`, optional `morphology`, optional `components`, optional historical relation metadata, and viable contextual binding IDs.

- [ ] **Step 1:** Add fixture records for `学校`, `台風`, `合弁`, `武弁`, `合わない`, and one unknown surface. Give `学校` component identities/readings `学=がく`, `校=こう`; give the native case lemma/morphology and historical result `合はない`; give only the first-slice generic-safe map `学 -> 學`.
- [ ] **Step 2:** Add tests that load `runtime/orthography-resolver.js` and assert its required public functions exist. Add semantic assertions for plain `学校`, whole-word explicit/implicit Ruby, component explicit/implicit Ruby, `台風`, `合弁`, native `合わない`, unknown input, and protected input.
- [ ] **Step 3:** Run `node --import tsx --test test/orthography-resolution.test.ts`; expected RED is module/file-not-found for `runtime/orthography-resolver.js`, proving the new test owns missing behavior rather than a fixture typo.
- [ ] **Step 4:** Commit the RED fixture/tests as `test: define orthography resolver vertical slice`.

### Task 2: Implement syntax evidence normalization and lexical semantic contract

**Files:**
- Create: `runtime/orthography-resolver.js`
- Modify: `test/orthography-resolution.test.ts`

**Interfaces:**
- Consumes: `TransformShared.parseRubySegments`, injected `lexicalLookup(surface)` returning zero or more candidate records.
- Produces: `createResolver(config)`, `resolver.resolveUnit(input, options?)`, and semantic units retaining source text/surface, lexical identity, modern reading + evidence source, lexical origin, morphology, component evidence, disposition, and evidence refs.

- [ ] **Step 1:** Keep only the parsing/convergence tests enabled for this task; run them and confirm RED because `createResolver`/`resolveUnit` are absent.
- [ ] **Step 2:** Implement minimal UMD module loading against injected `TransformShared`. Normalize plain, explicit whole-word Ruby, implicit whole-word Ruby, explicit component Ruby, and implicit component Ruby into one base surface plus explicit word/component reading evidence.
- [ ] **Step 3:** Resolve the base surface through the injected lexical adapter. Whole-word Ruby may replace modern-reading provenance; component Ruby attaches explicit component reading evidence while retaining the lexeme’s modern surface pronunciation when concatenation would be phonologically wrong.
- [ ] **Step 4:** Preserve zero-candidate and multi-candidate states as typed `UNRESOLVED` / `CANDIDATES`; do not invent lexical identity.
- [ ] **Step 5:** Run the Task 2 tests, then `node --import tsx --test test/orthography-resolution.test.ts`; expected GREEN for parsing/convergence assertions with later resolution assertions still pending only if explicitly skipped.
- [ ] **Step 6:** Commit as `feat: add orthography evidence resolver contract`.

### Task 3: Compose historical kana, contextual kanji, safe rendering, and ambiguity

**Files:**
- Modify: `runtime/orthography-resolver.js`
- Modify: `test/orthography-resolution.test.ts`

**Interfaces:**
- Consumes: resolved lexical candidate; injected `historicalLookup(candidate)`, compiled contextual relations/safety arrays, `safeKanjiMap`.
- Produces: semantic `historical` result containing route, historical kana/readings, contextual decision, deterministic-safe decision, final historical surface, disposition, and evidence refs.

- [ ] **Step 1:** Enable assertions that `学校` routes `SINO`, retains component historical readings `がく` / `かう`, and produces historical reading `がくかう`; run RED.
- [ ] **Step 2:** Implement historical routing from explicit fixture evidence. The Sino route must use component lexical identities/readings; it must never derive `がくかう` by mechanically rewriting `がっこう`.
- [ ] **Step 3:** Enable `台風` and `合弁` assertions; run RED. Implement contextual relation eligibility against viable lexical binding IDs: one eligible target -> resolved contextual target, multiple eligible targets -> `CANDIDATES`, none -> no contextual target. Apply exact preserve safety before fallback.
- [ ] **Step 4:** Enable deterministic-safe assertion; run RED. Apply the bounded `safeKanjiMap` only after contextual resolution and never overwrite an explicit contextual target. This gives `学校 -> 學校` while `台風 -> 颱風` stays lexical.
- [ ] **Step 5:** Enable native `合わない` assertions; run RED. Resolve through native morphology-aware fixture relation to `合はない` / `あはない` and record route/evidence.
- [ ] **Step 6:** Run the complete resolver test file; expected GREEN for semantic-resolution cases.
- [ ] **Step 7:** Commit as `feat: compose orthography historical resolution`.

### Task 4: Add late serializers and protected-unit behavior

**Files:**
- Modify: `runtime/orthography-resolver.js`
- Modify: `test/orthography-resolution.test.ts`

**Interfaces:**
- Consumes: a resolved semantic unit only.
- Produces: `resolver.render(unit, options?)` with modes `plain`, `ruby-whole-explicit`, `ruby-whole-implicit`, `ruby-components-explicit`, `ruby-components-implicit`; `resolveUnit(input, { protected: true })` returns a protected semantic unit without lexical lookup.

- [ ] **Step 1:** Add renderer tests for `学校` proving one semantic result emits `學校`, `｜學校《がくかう》`, `學校《がくかう》`, `｜學《がく》校《かう》`, and `學《がく》校《かう》` without additional lexical-lookup calls; run RED.
- [ ] **Step 2:** Implement serializers as pure late rendering over resolved fields. Canonical test expectation for this slice is explicit whole-word Ruby `｜學校《がくかう》`; other modes remain equivalent render choices, not semantic truth.
- [ ] **Step 3:** Add protected-unit test with a lookup call counter; run RED. Implement `{ protected: true }` so source text round-trips exactly and no lexical/historical/contextual adapter is invoked.
- [ ] **Step 4:** Run the complete resolver test file; expected GREEN.
- [ ] **Step 5:** Commit as `feat: render resolved orthography without reanalysis`.

### Task 5: Measure the slice and run repository verification

**Files:**
- Create: `tools/bench-orthography-resolution.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: `runtime/orthography-resolver.js` and the deterministic first-slice fixture.
- Produces: `npm run bench:resolver` JSON/text report with runtime-module bytes, fixture bytes, cold initialization wall time, retained heap delta, deterministic resolve latency/throughput, transform throughput, and explicit caveat that this is a first-slice baseline rather than a production threshold.

- [ ] **Step 1:** Add `bench:resolver` script and harness smoke assertion to the resolver test or a focused benchmark test; run RED before creating the harness.
- [ ] **Step 2:** Implement deterministic benchmark harness with fixed iteration count/corpus and no network access. Report cache metrics only if the implementation actually has a cache; otherwise report `cache: null` rather than inventing hit/miss claims.
- [ ] **Step 3:** Run `npm run bench:resolver` twice and record both outputs in #21; verify the measured fields are present and units are explicit.
- [ ] **Step 4:** Update README with the resolver slice boundary, accepted Ruby forms, and benchmark command; do not describe the fixture as production lexical coverage.
- [ ] **Step 5:** Run `node --import tsx --test test/orthography-resolution.test.ts`, `npm run typecheck`, `npm test`, and `npm run check`. Compare any failures against the recorded pre-change baseline; do not hide platform-specific golden failures.
- [ ] **Step 6:** Inspect `git diff --check`, branch diff, and status; commit as `test: benchmark orthography resolver vertical slice`.
- [ ] **Step 7:** Push branch, open the #21 implementation PR, run available GitHub checks, perform whole-branch review, and record exact verification/audit evidence on #21 before merge.

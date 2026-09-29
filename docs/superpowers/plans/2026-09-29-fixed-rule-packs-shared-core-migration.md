# Fixed KiNoTch. Rule Packs Shared-Core Migration — Implementation Plan

**Goal:** Canonicalize the already-fixed KiNoTch. legacy-kanji / homophone rule lists in `japanese-orthography`, generate deterministic `txt-auto-replace` compatibility artifacts, then migrate only `txt-auto-replace` to generated snapshots without behavior change.

**Architecture:** Keep the new KiNoTch. compatibility profile physically and semantically separate from the existing contextual-kanji workspace. Exact pinned `txt-auto-replace` JSON5 blobs are retained only as adoption fixtures. Canonical strict JSON is validated and compiled into deterministic consumer-compatible 40/50/55 artifacts plus a digest manifest. The consumer migration occurs only after the core PR is merged so its lock can pin the actual merged core SHA.

**Tech Stack:** Node.js 22+, TypeScript 7, npm/package-lock, existing Ajv infrastructure, `node --import tsx --test`, Node built-ins (`crypto`, `fs`, `vm`). No new package dependency planned.

**Spec:** `docs/superpowers/specs/2026-09-29-fixed-rule-packs-shared-core-migration-design.md` (accepted in PR #11).

**Plan Issue:** #12.

## Global constraints

- Treat `txt-auto-replace@b1227053c5df94c148ca2027b897a69199801e4e` 40/50/55 contents as already fixed behavior; do not re-select or linguistically clean them up.
- Canonical data is strict UTF-8 JSON; JSON5 exists only as pinned audit fixture / consumer compatibility output.
- Preserve pack identity, phrase keys, target sets and order where relevant, priorities, candidate flags, character-map priority and mappings.
- Keep compatibility-profile authority separate from contextual-kanji and generic safe-character authority.
- `弁 -> 辨` must remain reproducible in the legacy profile but must not become generic safe-character authority.
- First consumer only: `txt-auto-replace`. `kinotch-api` remains deferred.
- No release/deploy/publication, credential/permission changes, destructive operations or shared-history rewrite.
- Every production behavior follows RED → verified RED → minimal GREEN → verified GREEN → commit.

## Review focus

1. Exact source adoption without loss/invention.
2. Compatibility-profile vs generic-safety separation.
3. Deterministic bytes/digests under non-semantic ordering changes.
4. Consumer semantic parity with the existing loader contract.
5. Consumer lock pins the merged core SHA, never an unmerged feature SHA.
6. Rollback remains a normal consumer PR revert.

## Task 1 — Profile schemas/model/loader/validator

**Add:** `schema/v1/kinotch-profile-manifest.schema.json`, `schema/v1/kinotch-profile-pack.schema.json`, `tools/profile-model.ts`, `tools/profile-loader.ts`, `tools/profile-validator.ts`, `test/profile-schema.test.ts`.

1. Write tests for strict manifest/pack schemas, explicit source-pack identity, non-empty target arrays, priority/candidate fields, duplicate pack/group/rule rejection.
2. Run `node --import tsx --test test/profile-schema.test.ts` and confirm RED because the new profile surface is absent.
3. Implement the smallest model, loader and validator satisfying those tests.
4. Re-run targeted test to GREEN; run typecheck; commit.

## Task 2 — Pinned-source adoption and canonical profile data

**Add fixtures:** exact 40/50/55 blobs under `test/fixtures/pinned/txt-auto-replace/`.

**Add canonical:** `data/profiles/kinotch/{manifest,legacy-kanji,official-homophone-restoration,homophone-kanji}.json` plus `test/profile-adoption.test.ts`.

1. In test-only code, evaluate the trusted pinned JSON5 fixtures as object literals with Node `vm`; do not add a runtime JSON5 dependency.
2. Normalize source behavior to explicit canonical rule shapes and assert exact key/value/priority/candidate/character-map parity.
3. Explicitly assert project multi-target `ドイツ -> [独逸, 独乙]` and an official multi-target such as `興奮 -> [昂奮, 亢奮]`.
4. Confirm RED with canonical data absent/incomplete.
5. Materialize canonical JSON mechanically from the pinned source snapshots, without editorial changes.
6. Confirm GREEN and commit.

## Task 3 — Deterministic bridge compiler

**Add:** `tools/profile-normalize.ts`, `tools/profile-compiler.ts`, `tools/compile-profile.ts`, writer reuse/adapter as needed, `test/profile-compiler.test.ts`, `test/golden/kinotch-profile/`.

Artifact contract:
- `manifest.json`
- `40-legacy-kanji.json5`
- `50-official-homophone-restoration.json5`
- `55-homophone-kanji.json5`

Strict JSON syntax is allowed inside `.json5` because it is valid JSON5. The semantic object structure must match the consumer contract.

1. Write tests for byte-identical double compile, non-semantic object-order invariance, source-fixture semantic equivalence, mutation-sensitive digests, and manifest payload digest/byte-length correctness.
2. Confirm RED.
3. Implement deterministic normalization/serialization/compiler and atomic output.
4. Confirm GREEN; commit.

## Task 4 — Safety boundary and core CLI/check integration

**Add/update:** `test/profile-safety-boundary.test.ts`, `test/profile-cli.test.ts`, package scripts, profile check/CLI as required.

1. RED: legacy canonical + bridge contain `弁 -> 辨`, while profile compilation exposes no generic safe-character artifact and existing contextual-kanji compiled output remains unchanged.
2. RED: profile validation/compile/check CLIs do not yet exist in the unified check path.
3. Implement minimal profile CLI/check integration.
4. GREEN: targeted tests, `npm run check`, `git diff --check`.
5. Open exact-head core PR; self-review against Review Focus; merge if green.
6. Re-fetch merged core SHA and use only that SHA for consumer pinning.

## Task 5 — Re-bootstrap `txt-auto-replace`

Before consumer mutation re-read live `devflow/AGENTS.md`, `devflow#33`, `txt-auto-replace/AGENTS.md`, current main/open work/PRs and relevant loader/tests. Create an isolated consumer worktree only if no overlapping owner appeared. Run consumer baseline tests and record issue-first cross-repo work state.

## Task 6 — Consumer generated snapshot, lock, drift and parity

Replace operational `transforms/40-legacy-kanji.json5`, `50-official-homophone-restoration.json5`, `55-homophone-kanji.json5` with generated core outputs; add an adjacent source lock/manifest and drift verification according to existing repo conventions.

1. RED: drift test detects hand-edited generated files or wrong core/artifact digest.
2. RED: parity test covers representative legacy mapping, official homophone, official multi-target, project multi-target `ドイツ`, legacy-profile `弁`, and adjacent stage ordering.
3. Materialize outputs generated from the merged core and lock exact merged core SHA/digests.
4. Preserve operational filenames and loader topology.
5. GREEN: targeted parity/drift tests, full consumer suite, `git diff --check`.
6. Exact-head review and merge if green; no release/publication.

## Task 7 — Reconcile and stop

- Record core and consumer merge SHAs in #4/#12 and devflow controls.
- Update `devflow#180` and `devflow#33` Audit SHA/current state accurately.
- Confirm `txt-auto-replace` 40/50/55 are generated snapshots whose authority is `japanese-orthography`.
- Stop and reassess. Do not begin `kinotch-api` migration automatically.

## Plan self-review

- **Coverage:** every accepted PR #11 criterion maps to Tasks 1–7.
- **Granularity:** core and consumer are split at the merged-core-SHA boundary; TDD checkpoints are explicit.
- **Type consistency:** profile model remains separate from existing `CanonicalWorkspace` contextual types.
- **Review focus:** adoption, safety separation, determinism, parity, cross-repo identity and rollback each have concrete tests.
- **Scope:** no engine extraction, npm publication, safe-character completion, `kinotch-api` mutation or deployment.

**Execution method:** Native task-by-task execution in this session using isolated worktrees and issue-first reporting. The user already approved continuation; no second plan approval is required unless a specification deviation or new high-risk/irreversible decision appears.

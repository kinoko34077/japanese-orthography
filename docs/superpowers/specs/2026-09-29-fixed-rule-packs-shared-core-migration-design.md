# Fixed Legacy/Homophone Rule Packs → Shared Core Migration Design

Status: **PROPOSED — user review required before implementation planning**

Owning issue: `japanese-orthography#4`
Related corpus authority: `japanese-orthography#2`
Cross-repository control: `devflow#180`, `devflow#33`, `devflow#18`

## 1. Goal

Make `kinoko34077/japanese-orthography` the canonical owner of the already-fixed KiNoTch. rule lists for:

1. old-character / legacy-kanji conversion; and
2. homophone-kanji rewrite/restoration.

This migration does **not** re-research, re-select, clean up, or linguistically reinterpret the accepted list contents as a prerequisite. The immediate purpose is ownership consolidation: one canonical rule source in `japanese-orthography`, reproducible consumer artifacts, and no manually maintained authoritative duplicate in `txt-auto-replace` / `kinotch-api`.

The first consumer migration is `txt-auto-replace`. `kinotch-api` is explicitly deferred to a later bounded cross-repository work order after the first consumer proves parity.

## 2. Fixed source snapshots

The accepted source behavior is pinned to `kinoko34077/txt-auto-replace` commit:

`b1227053c5df94c148ca2027b897a69199801e4e`

The following files are the first-slice fixed inputs:

| Rule pack | Source path | Blob SHA | Role |
| --- | --- | --- | --- |
| Legacy kanji | `transforms/40-legacy-kanji.json5` | `57177fb8fba471f9c169283dcbae5830d5bac64f` | user-fixed old-character profile |
| Official homophone restoration | `transforms/50-official-homophone-restoration.json5` | `c3e35dd4431deeb13b94a7f3d5e43f978ed73ef3` | fixed official-table-derived restoration profile |
| Project homophone additions | `transforms/55-homophone-kanji.json5` | `3d4ff5f2c1bdf8dd1cea4832d0a6d08592a218fd` | fixed project extension kept separate from the official pack |

`40-legacy-kanji.json5` explicitly describes itself as the user-specified legacy-character reference table. `50-official-homophone-restoration.json5` explicitly records the Culture Agency homophone rewrite table inverted from modern rewrite spelling to prior spelling. `55-homophone-kanji.json5` is a separate non-notice/project pack and must not be relabeled as official evidence.

Live `kinotch-api` also contains copied files under `src/text-core/rules/` with the same blob identities for these rule packs. Its `src/text-core/README.md` states that the rule definitions are copied from `txt-auto-replace`. Therefore `kinotch-api` is a consumer/snapshot for these rule lists, not an independent authority.

## 3. Authority rule: fixed behavior is not the same thing as universal safety

The migration establishes two distinct layers.

### 3.1 KiNoTch. compatibility/profile authority

The exact accepted rule-list behavior is canonical knowledge. It must be preserved so the KiNoTch. transformation profile can reproduce the current intended output.

For the pinned first slice:

- existing source keys are not removed;
- existing targets are not replaced merely because a newer linguistic model would choose another representation;
- priorities / candidate flags that affect existing engine behavior are preserved;
- multi-target values remain multi-target values;
- official and project-extension homophone sources remain distinguishable;
- entry normalization may change storage syntax only when it is mechanically proven behavior-preserving.

### 3.2 Semantic safety classification

Being present in the fixed compatibility profile does **not** make a rule a context-free safe-character mapping.

Example:

`40-legacy-kanji.json5` contains the accepted compatibility-profile mapping `弁 -> 辨`.

That mapping remains in the KiNoTch. legacy profile because the user has fixed the list. However, existing `japanese-orthography#4/#2` research already proves that modern `弁` merges several historical lexical classes (`辯`, `辨`, `瓣`, `辮`, `辦`, plus genuine original `弁`). Therefore:

- `弁 -> 辨` **must remain reproducible in the legacy compatibility profile**;
- it **must not be exported as a universally safe deterministic character relation**;
- contextual/multi-target restoration remains owned by the contextual corpus/resolver path from `#2`;
- future consumers may select the explicit legacy compatibility profile when exact legacy behavior is desired, but the generic safe-character layer must not silently inherit all profile entries.

This distinction applies to any other fixed profile entry whose global semantic safety is later disproven. Fixed user behavior is preserved; semantic classification controls where that behavior may execute automatically.

## 4. Canonical storage in `japanese-orthography`

The first migration slice adds an explicit KiNoTch. profile namespace rather than forcing the fixed rule lists into the contextual-kanji corpus or safe-character pack.

Proposed canonical shape:

```text
data/profiles/kinotch/
  manifest.json
  legacy-kanji.json
  official-homophone-restoration.json
  homophone-kanji.json
```

Canonical source remains strict UTF-8 JSON. The profile manifest records at minimum:

```text
schemaVersion
profileId
sourceSnapshots[] {
  repository
  commit
  path
  blobSha
  role
}
```

The canonical records preserve the behaviorally relevant contents of the pinned JSON5 sources. Source comments and JSON5 formatting are audit/source-snapshot information, not semantic authority.

A dedicated schema must distinguish at least:

- character-map entries;
- phrase/lexical rewrite entries;
- candidate/multi-target entries;
- rule priority where behaviorally relevant;
- candidate-selection flag where behaviorally relevant;
- source pack identity (`legacy`, `official-homophone`, `project-homophone`).

The canonical representation must not collapse a multi-target value into one selected target.

## 5. Relationship to the contextual-kanji corpus

The fixed profile and the contextual corpus solve different problems and must not overwrite each other.

```text
KiNoTch. fixed compatibility profile
  = exact accepted transformation behavior

contextual-kanji corpus (#2)
  = source-traceable semantic restoration knowledge

safe-character pack (future owner)
  = only context-free relations proven safe for generic automatic use
```

A canonical profile entry may coexist with a contextual relation that would produce a different result under another profile/mode. The resolver/profile composition layer must make that choice explicit rather than deleting one source of knowledge.

The first migration slice does not attempt to reconcile every profile entry into the contextual corpus. It only prevents the fixed list from being misclassified as generic safe knowledge.

## 6. Consumer bridge artifact

The first consumer continues to use its existing transformation engine. Engine extraction is not coupled to this rule-ownership migration.

`japanese-orthography` generates a deterministic compatibility artifact for the current `txt-auto-replace` rule-bundle contract:

```text
dist/compat/txt-auto-replace/
  manifest.json
  40-legacy-kanji.json5
  50-official-homophone-restoration.json5
  55-homophone-kanji.json5
```

The bridge manifest contains at least:

```text
artifactSchemaVersion
sourceProfileId
canonicalSourceDigest
sourceCommit
files[] {
  path
  payloadDigest
}
```

The generated JSON5 files must be semantically equivalent to the pinned source bundles under the existing `txt-auto-replace` engine contract.

`dist/` remains derived/non-canonical in `japanese-orthography`; tests/golden fixtures may retain generated reference artifacts.

## 7. First distribution mechanism: generated vendored snapshot

For the first consumer migration, use a source/digest-pinned generated snapshot rather than introducing npm publication or a git submodule.

Rationale:

- `txt-auto-replace` already consumes local static rule files;
- the purpose of this slice is ownership consolidation, not package-distribution infrastructure;
- a generated snapshot keeps browser runtime behavior and loading topology unchanged;
- rollback is a normal consumer PR revert;
- exact source commit/digest can be recorded and checked;
- it satisfies the requirement that consumer copies are generated artifacts rather than manually maintained authoritative knowledge.

The consumer keeps the same three operational filenames, but they become generated outputs with an adjacent source lock/manifest recording the exact `japanese-orthography` source commit and artifact digests. Local hand edits to those generated files are invalid; changes originate in `japanese-orthography` and are regenerated.

Alternative mechanisms are deferred:

- **npm package:** stronger dependency distribution, but adds package/release/versioning policy before the first parity migration proves it is needed;
- **git submodule/direct repository dependency:** reduces copied bytes but adds checkout/CI/update coupling not required by the current browser runtime.

A later migration may replace the generated-snapshot transport without changing canonical ownership.

## 8. First consumer: `txt-auto-replace`

`txt-auto-replace` is the first migration target because:

- the pinned accepted lists originate there;
- its devflow control currently has no competing active implementation owner;
- behavior parity can be measured directly against the exact current rule files;
- migrating the source repository first minimizes ambiguity about which copy defined legacy behavior.

The first consumer migration must:

1. preserve the three existing operational rule filenames;
2. replace manual authority with generated outputs from `japanese-orthography`;
3. record the exact core commit and artifact digest;
4. add a drift check so generated rule files cannot be changed silently without updating the pinned core artifact;
5. keep existing browser/DOM/runtime behavior unchanged;
6. keep existing rule ordering/stage behavior unchanged unless a difference is explicitly required and separately approved.

No browser release/publication is part of this slice.

## 9. `kinotch-api` boundary

`kinotch-api` is not modified in this first consumer slice.

Reasons:

- its `src/text-core/rules/` files are already confirmed copied duplicates;
- its live repository state has unrelated active work and its devflow control requires re-bootstrap before mutation;
- one-consumer-at-a-time migration provides a cleaner parity/rollback boundary.

After `txt-auto-replace` migration is merged and verified, a separate cross-repository work order may replace `kinotch-api/src/text-core/rules/{40,50,55}*` with the same generated shared-core artifact mechanism or a later accepted transport. That later work must re-read live `kinotch-api` control/current state first.

## 10. Validation and parity requirements

### 10.1 Source adoption tests

For each pinned source pack, mechanically verify canonical adoption against the source snapshot:

- every behaviorally relevant input key is represented;
- no extra input key is silently invented;
- every target/value is preserved;
- priorities and candidate flags are preserved where present;
- multi-target order/representation is preserved when the existing engine treats it as semantic;
- official/project source identity remains separate.

The test is set/content equality against the pinned blob, not a new linguistic approval process.

### 10.2 Canonical compiler tests

Verify:

- same canonical profile -> byte-identical generated bridge artifacts;
- non-semantic JSON member ordering -> no artifact identity change;
- changing a mapping/target/priority/candidate flag -> digest changes;
- bridge output parses under the current consumer rule loader;
- generated manifest digests match payload bytes.

### 10.3 Safety-boundary regression

At minimum prove:

- `弁 -> 辨` remains present in the legacy compatibility artifact;
- `弁 -> 辨` is not exported by any generic safe-character artifact merely because it exists in that profile;
- contextual `弁` relations/candidates remain separately owned by the contextual corpus.

### 10.4 `txt-auto-replace` parity

Before replacing consumer authority, run a parity corpus containing at minimum:

- representative legacy-kanji entries;
- representative official homophone rewrites;
- a multi-target homophone entry;
- the project homophone extension;
- `弁` legacy-profile behavior;
- interactions with adjacent transformation stages sufficient to prove that file replacement has not changed stage ordering.

Old consumer files and generated shared-core files must produce the same outputs for the parity corpus under the current selected legacy profile.

## 11. Update workflow after migration

After the first consumer migration:

```text
edit canonical profile in japanese-orthography
  -> validate fixed-profile schema/invariants
  -> compile deterministic consumer bridge
  -> update consumer generated snapshot + lock/digest
  -> run consumer parity tests
```

Direct edits to the generated consumer copies are not an accepted rule-maintenance path.

A future intentional change to the fixed KiNoTch. list is a canonical profile change in `japanese-orthography`, with explicit diff/review and downstream regenerated artifacts.

## 12. Rollback

Core canonicalization is additive and does not itself change consumer behavior.

The `txt-auto-replace` migration is rollbackable by reverting its consumer PR to the previous local files. Because the first transport keeps the existing filenames and runtime loader contract, rollback does not require browser/runtime architecture changes.

No shared-history rewrite, production deployment, credential/permission mutation, or external publication is required.

## 13. Non-goals

This slice does not:

- re-research or replace the user-fixed old-character list;
- re-derive the official homophone table from scratch;
- silently remove controversial/context-sensitive profile entries;
- claim every `legacy-kanji` character map is globally safe;
- merge the fixed compatibility profile into the contextual corpus;
- complete the future safe-character pack;
- extract/rewrite the transformation engine;
- migrate `kinotch-api` in the same implementation unit;
- select npm publishing, registry release, or submodules as permanent distribution policy;
- release/deploy either consumer.

## 14. Acceptance criteria

The slice is complete only when:

- [ ] `japanese-orthography` contains canonical strict-JSON representations of all three pinned rule packs.
- [ ] Adoption tests prove mapping/value/priority/candidate parity with the pinned `txt-auto-replace` blobs.
- [ ] `legacy-kanji` profile authority is explicitly distinct from generic safe-character authority.
- [ ] `弁 -> 辨` remains reproducible in the legacy compatibility profile but is not promoted to the generic safe-character layer.
- [ ] deterministic `txt-auto-replace` bridge artifacts and a source/digest manifest are generated by the core.
- [ ] `txt-auto-replace` consumes generated snapshots for the three rule packs without behavior change on the accepted parity corpus.
- [ ] `txt-auto-replace` has a drift check tying generated files to the core artifact/source identity.
- [ ] manual rule authority for these three files is removed from `txt-auto-replace`; their source of truth is `japanese-orthography`.
- [ ] `kinotch-api` remains unchanged in this slice but is recorded as the next duplicate consumer to migrate.
- [ ] no release/deploy/publication occurs.

## 15. Implementation sequencing after spec approval

After this written spec is approved:

1. write and self-review an implementation plan under the existing KiNoTch.2 one-confirmation rule;
2. proceed directly into implementation if the plan introduces no specification deviation or new high-risk decision;
3. implement core canonical adoption + compiler/validation first;
4. verify the generated bridge against the pinned source blobs;
5. migrate `txt-auto-replace` in a separate repository-local PR with parity tests;
6. reconcile `japanese-orthography#4`, repository controls, and cross-repo devflow state;
7. stop and reassess before any `kinotch-api` migration.

# Contextual Kanji Canonical Corpus Architecture

Status: review draft reflecting accepted Issue design; repository-file review still required before implementation planning  
Date: 2026-09-29  
Owning Issue: #2 `[DATA] Build contextual kanji restoration corpus beyond official homophone table`  
Progress log: #6  
Accepted semantic contract: #2 comment `#5882061491`  
Accepted physical proposal: #2 comment `#5882167248`  
Design review: #2 comment `#5882397715`

## 1. Purpose

This specification defines the first repository architecture for a canonical contextual-kanji restoration corpus and its build-time validator/compiler.

The subsystem must let the project preserve source-traceable historical orthography knowledge without reducing contextual restoration to blind character reversal. It must separate source evidence, canonical admission, lexical binding, contextual restoration, safety constraints, review-only knowledge, downstream deterministic character rendering, generated runtime representation, and consumer activation.

The first implementation is intentionally small. Its goal is to prove the information boundaries and validation rules with representative difficult cases, not to maximize vocabulary coverage.

## 2. Scope and non-goals

### In scope

- canonical hand-authored source format for the first contextual-kanji slice;
- source/provenance evidence records;
- source-qualified lexical evidence and lexical constraint sets;
- canonical restoration units, positive relations, safety constraints, and review hints;
- typed references to relations owned by other packs;
- structural, semantic, and integration validation boundaries;
- deterministic build-time compilation;
- sectioned generated runtime artifacts;
- test fixtures and golden outputs sufficient to prove the architecture.

### Out of scope

- broad vocabulary expansion;
- wholesale third-party dataset import;
- tokenizer/backend selection;
- Pmin/FST runtime micro-optimization;
- re-opening browser/Worker/WASM feasibility research already completed in #5;
- ownership or implementation of the deterministic safe-character pack;
- mutation of `txt-auto-replace`, `kinotch-api`, or other consumers;
- release, deployment, or publication policy for generated artifacts;
- choosing a universal morphology DSL for every Japanese inflection pattern.

## 3. Semantic invariants

The physical design must preserve the following accepted semantics.

1. **One target per `PositiveRelation`.** A canonical executable relation has exactly one layer-normalized target.
2. **Candidate preservation.** If multiple admitted compatible relations survive matching and safety resolution, they remain separate and resolve to `CANDIDATES`; they are never silently collapsed into one preferred spelling.
3. **`RestorationUnit` is grouping only.** It is a canonical grouping/dedup identity, not runtime matching authority.
4. **Evidence is not admission.** What a source says, what this project admits, and what runtime disposition results are independent axes.
5. **Required lexical binding fails closed.** A relation requiring lexical identity must not become automatic when its required lexical binding cannot be established.
6. **Contextual restoration precedes deterministic rendering.** Canonical contextual targets contain only the contextual lexical delta. Downstream kyujitai/variant rendering is a separate layer.
7. **Lexical override/preserve beats broad character fallback.** Contextual knowledge must be able to override or block a deterministic fallback owned elsewhere.
8. **Longer executable spans require disambiguating value.** A longer rule must not exist solely as a redundant expansion of a shorter independent lexical unit.
9. **`ReviewHint` is cold/review-only.** Presence of review evidence never grants automatic conversion authority.
10. **Safe-character relations are externally owned.** This pack may reference them but must not duplicate them as a second canonical authority.

The first-slice runtime disposition vocabulary remains compatible with the existing source-neutral resolver semantics established in #5, including `AUTO`, `CANDIDATES`, `PRESERVE`, `ROUTE_SINO`, and `SOURCE_REVIEW` where applicable.

## 4. Architecture overview

```text
canonical JSON source
  ├─ source/provenance evidence
  ├─ lexical evidence + constraints
  └─ contextual-kanji pack knowledge
        ↓
pack-local structural + semantic validation
        ↓
workspace/integration validation
        ↓
deterministic compiler
        ↓
sectioned generated artifact (`dist/`, non-canonical)
        ↓
consumer staging resolver
        ↓
required-capability validation
        ↓
atomic activation
```

The canonical source is the repository authority. Generated `dist/` files are derived representations only.

## 5. Canonical source organization

The repository uses strict UTF-8 JSON for the first hand-authored canonical slice.

```text
data/
  evidence/
    culture-agency-1956-douon.json
    dictionaries/
      <source-id>.json
    usage/
      <source-id>.json

  lexical/
    constraints/
      contextual-kanji.json

  packs/
    contextual-kanji/
      manifest.json
      homophone-rewrite.json
      fu-family.json
      merged-ben.json
      merged-tai.json

schema/
  v1/
    evidence-bundle.schema.json
    lexical-constraints.schema.json
    contextual-kanji-pack.schema.json
    external-relation-ref.schema.json

tools/
  validate.ts
  compile.ts

test/
  fixtures/
    invalid/
    external-packs/
  golden/
    contextual-kanji/

dist/                         # generated; non-canonical
  contextual-kanji/
    manifest.json
    hot-relations.json
    hot-safety.json
    cold-review.json
    audit-map.json
```

Partitioning follows **reason for change**:

- source/provenance correction changes `data/evidence/`;
- lexical identity/binding knowledge changes `data/lexical/constraints/`;
- orthographic restoration/safety/review knowledge changes `data/packs/contextual-kanji/`;
- runtime encoding changes the compiler/output schema, not canonical semantic knowledge.

Canonical relations are not partitioned by evidence source because one relation may have multiple independent sources. One-file-per-relation is also avoided; files split only when semantic family or change reason differs materially.

Strict JSON is preferred to JSON5 because provenance, normalization rationale, and source behavior must survive as structured machine-readable data rather than source comments. CSV/JSONL may later exist as bulk-import or generated interchange formats, but are not the first hand-curated authority.

### Canonical JSON conventions

- UTF-8;
- LF newlines;
- literal Unicode is allowed;
- repository source uses two-space indentation;
- object member order is non-semantic;
- array/source order is non-semantic unless a schema explicitly declares otherwise;
- IDs may be mnemonic for humans but are opaque to validators, compilers, and runtime logic.

## 6. Canonical record model

Field names below define the first architectural contract. JSON Schema may add ordinary structural metadata, but implementation must not change the responsibility boundaries without revisiting this specification.

### 6.1 `SourceDescriptor`

```text
SourceDescriptor {
  id
  kind: primary_official
      | dictionary
      | usage_corpus
      | specialized_reference
      | project_override
      | secondary_transcription
      | candidate_oracle
  title
  versionRef?
  locator
  licenseNote?
  pinnedRefOrDigest?
}
```

`kind` describes the source itself. It does not automatically determine execution priority or admission.

### 6.2 `EvidenceRecord`

Every evidence record references its source descriptor and carries a recoverable locator. `sourceClass` remains independent of `SourceDescriptor.kind`.

```text
EvidenceRecord {
  id
  sourceRef
  locator
  sourceClass: official | lexical | usage | specialized | override
  sourceBehavior?        # upstream default/variant/active/disabled/etc.; audit only
  claim
}
```

`sourceBehavior` records meaningful upstream behavior when a source distinguishes default, variant, active, disabled, or similar source-local states. It is audit/provenance information only; it does not automatically become project admission or runtime priority.

`claim` is a discriminated union.

#### Mapping evidence

```text
mapping {
  direction: historical_to_modern | modern_to_historical
  rawFrom
  rawTo
  projectedFrom?
  projectedTo?
  projectionNotes[]?
}
```

`rawFrom/rawTo` preserve what the source actually states. `projectedFrom/projectedTo` are present when the source composes more than the contextual lexical layer. `projectionNotes` explain the decomposition.

Example:

```text
raw source:     間欠 -> 閒歇
projected:      間欠 -> 間歇
reason:         間 -> 閒 belongs to downstream character/variant rendering
```

#### Attestation evidence

```text
attestation {
  form
  reading?
  lexicalIdentity?
  senseNote?
}
```

This records that a form, reading, lexical identity, or sense is attested. It is not equivalent to a directional replacement mapping.

#### Exclusion evidence

```text
exclusion {
  form
  senseNote
}
```

This supports preserve/no-conversion treatment for a lexical sense or class.

### 6.3 `SourceLexicalEvidence`

```text
SourceLexicalEvidence {
  id
  sourceRef
  sourceIdentity
  lForm?
  lexicalOrigin?
  evidenceRefs[]
}
```

`sourceIdentity` is source-qualified and opaque. Canonical relations never store Pmin-local or other build-local lexical IDs.

### 6.4 `LexicalConstraintSet`

```text
LexicalConstraintSet {
  id
  lexicalEvidenceRefs[]
}
```

A build binder maps source-qualified lexical evidence into the local lexical namespace. If a relation requires lexical binding for automatic resolution and that binding fails, compilation/runtime eligibility fails closed.

### 6.5 `RestorationUnit`

```text
RestorationUnit {
  id
  family
  modernKey
  notes?
}
```

This groups semantically identical restoration knowledge that may compile into several exact surfaces. For example, one `付す -> 附す` lexical restoration unit may own several inflected surface relations without inventing a universal morphology execution DSL.

`family` is descriptive only and has no hidden runtime semantics.

### 6.6 `PositiveRelation`

```text
PositiveRelation {
  id
  unitId
  kind: contextual_kanji
  direction: modern_to_historical
  channel: surface
  match
  lexicalConstraintSetId?
  target
  evidenceRefs[]
  admission: admitted | disabled
}
```

`target` is exactly one layer-normalized historical target. Separate admitted targets require separate relations with their own evidence references.

### 6.7 `SafetyConstraint`

```text
SafetyConstraint {
  id
  unitId?
  kind: contextual_kanji
  channel: surface
  match
  lexicalConstraintSetId?
  effect: preserve_exact | block_fallback
  evidenceRefs[]
  blocks?: ExternalRelationRef[]
  admission: admitted | disabled
}
```

`preserve_exact` keeps a recognized lexical class unchanged. `block_fallback` prevents a referenced broad relation from firing when contextual evidence owns the exception.

### 6.8 `ReviewHint`

```text
ReviewHint {
  id
  kind: contextual_kanji
  channel: surface
  match
  lexicalConstraintSetId?
  proposedTarget?
  evidenceRefs[]
  reason: oracle_only
        | unresolved_evidence
        | ambiguous_binding
        | normalization_review
}
```

A `ReviewHint` is never executable authority. Compilation places it only in cold/review output.

### 6.9 `ExternalRelationRef`

```text
ExternalRelationRef {
  packId
  relationId
}
```

The target pack must explicitly export the referenced stable relation identity. Neither ID string may be parsed for semantic meaning.

Until a canonical safe-character pack exists, integration tests may provide non-canonical external-pack fixtures under `test/fixtures/external-packs/`. Test fixtures do not create canonical authority.

## 7. Admission, source behavior, and runtime disposition

These states must remain separate.

```text
source behavior/evidence
        ↓
project canonical admission
        ↓
lexical + safety + compatibility resolution
        ↓
runtime disposition
```

Examples:

- an upstream dataset may mark one historical form as its default and another as a variant;
- the project may admit both because both have adequate evidence;
- runtime must then return `CANDIDATES` if no accepted lexical/safety distinction selects one.

No provenance class, source ordering, source default, or numeric confidence implicitly chooses a runtime winner in the first slice.

The first slice does not introduce numeric confidence scores.

## 8. Validation model

Validation has three outcomes:

- **ERROR** — a mechanically provable contract violation; build fails;
- **REVIEW** — a deterministic finding that cannot be safely converted into a hard semantic conclusion from available canonical inputs; build output may be inspected but the finding must remain visible;
- **OK** — the checked invariant is satisfied.

The validator must not hide uncertainty by inventing linguistic knowledge.

### 8.1 Pack-local hard errors

Fail validation when locally provable, including at least:

- unknown schema version or enum;
- malformed structural record;
- duplicate ID within its declared namespace;
- dangling local reference;
- unresolved source/evidence reference;
- accepted relation/safety record with no admission-sufficient recoverable evidence;
- duplicate exact executable authority for the same direction/channel/match/constraint/target;
- data representation that would silently collapse multiple admitted targets;
- orphan `RestorationUnit` where the unit has no meaningful owned relation/safety/evidence linkage;
- required lexical-binding declaration missing from a relation that requires lexical identity;
- explicit raw-source/projected canonical mismatch without projection audit information;
- candidate-oracle/review-only evidence promoted to automatic authority without independent admission-sufficient evidence;
- structurally provable pure-character-map contamination;
- structurally provable unsafe one-character reverse promotion;
- non-deterministic compilation of the same normalized canonical knowledge.

For one-character reverse promotion, the validator must not use length alone as linguistic proof. The hard-error case is a relation promoted to context-free automatic reverse authority solely from directional substitution evidence without an accepted contextual/lexical safety basis.

### 8.2 Workspace/integration hard errors

Fail integration validation when cross-boundary facts are available and invalid, including:

- referenced `{packId, relationId}` does not exist or is not exported by the target pack/fixture;
- required lexical namespace is unavailable or incompatible;
- lexical override/preserve depends on a fallback relation but the dependency cannot be resolved;
- precedence cannot guarantee override/preserve-before-fallback for an explicitly referenced overlap.

### 8.3 Deterministic review findings

Some semantic failures are only mechanically decidable for a subset of cases.

#### Redundant longer rule

- **ERROR** when exact match/constraint comparison proves the longer rule adds no disambiguating information over a shorter admitted authority.
- **REVIEW** when semantic equivalence cannot be proven from explicit canonical constraints alone.

#### Layer leakage

- **ERROR** when explicit source projection or available downstream relation knowledge proves that a contextual target contains unrelated deterministic rendering.
- **REVIEW** when the validator can detect a suspicious raw/projected or cross-layer pattern but cannot prove ownership from available inputs.

The first implementation must not embed hidden hard-coded lists of historical characters merely to make these checks appear complete.

## 9. Deterministic compilation

The compiler is build-time only. Consumer runtimes do not depend on TypeScript, Ajv, npm, canonical source layout, or source-level evidence objects.

Proposed command surface:

```text
npm run validate
npm run compile
npm test
npm run check
```

Responsibilities:

- `validate` reads canonical source and produces no canonical mutation;
- `compile` runs required validation and writes only derived `dist/` output;
- `test` executes structural, semantic, integration-fixture, and golden tests;
- `check` runs validation, deterministic compile checks, and tests.

A failed validation/compile must not leave a newly activated partial artifact. Implementation should build into a staging location and replace generated output only after all required sections are complete and validated.

### Determinism rules

Two clean compilations of the same **normalized canonical knowledge** must be byte-identical.

Therefore:

- compiler output records are sorted by stable IDs/lookup keys;
- source array order and object member order do not affect generated bytes unless explicitly semantic;
- generated artifacts contain no wall-clock build timestamps, random IDs, machine paths, or environment-dependent metadata;
- `canonicalSourceDigest` is computed from a normalized semantic source representation, not raw file byte order/formatting, so non-semantic reordering does not perturb the generated artifact;
- raw per-file digests, when useful for audit, belong in audit metadata and do not define semantic generation identity;
- `artifactGeneration` is a deterministic identity derived from normalized canonical input plus artifact-format/compiler-generation information, never a wall-clock counter or timestamp.

Exact package versions and lockfile contents are implementation-plan/PR concerns; determinism requires them to be pinned for the implemented build.

## 10. Generated artifact contract

`dist/contextual-kanji/` is derived and non-canonical.

```text
manifest.json
hot-relations.json
hot-safety.json
cold-review.json
audit-map.json
```

### `manifest.json`

Carries at least:

```text
schemaVersion
packId
artifactGeneration
requiresLexicalNamespaceId
canonicalSourceDigest
sections[] {
  id
  required
  digest
  byteLength
}
```

The manifest identifies all required sections and their integrity data.

### `hot-relations.json`

Contains only compiled relation lookup data and local lexical bindings required by the normal resolver path. It does not carry normal source/provenance payload.

### `hot-safety.json`

Contains compiled preserve/block-fallback lookup data required by normal safety resolution.

### `cold-review.json`

Contains `ReviewHint`-derived review information and other optional cold diagnostic payload. Its presence must not alter automatic relation authority.

### `audit-map.json`

Maps generated/runtime identities back to canonical units, canonical relations, evidence records, source descriptors, and normalization/projection rationale needed for traceability.

## 11. Runtime activation boundary

This subsystem reuses the activation semantics already established by #4 rather than inventing a second loader contract.

```text
manifest + section identity validation
  -> staging resolver construction
  -> validate every required section/capability
  -> atomic activation
```

A consumer must not activate a partially valid generation. Existing active data remains active if staging validation fails.

This specification defines the artifact contract needed by that boundary. Consumer-specific browser, Worker, HTTP, UI, caching, and delivery policies remain consumer-owned.

## 12. First canonical materialized slice

The first data slice is selected for semantic boundary coverage.

```text
# single contextual target
溶接 -> 熔接
間欠 -> 間歇
賛嘆 -> 讃嘆

# multiple admitted targets
装丁 -> 装釘
装丁 -> 装幀

# one restoration unit, multiple surface forms + preserve sense
付す inflection family -> 附す family
excluded/preserve sense such as transfer/issue usage

# merged modern character family
弁護 -> 辯護
花弁 -> 花瓣
弁済 -> 辨済
弁髪 -> 辮髪
買弁 -> 買辦
武弁 -> preserve

# same surface requiring longer-context disambiguation
合弁 -> candidates {合辦, 合瓣}
合弁会社 -> business-context resolution
合弁花... -> botanical-context resolution

# lexical override/preserve against externally owned fallback
台風 -> 颱風
台頭 -> 擡頭
台密 -> preserve
```

A deterministic `学 -> 學` mapping is integration-fixture-only until a separately owned safe-character pack admits it canonically.

The first slice must not add vocabulary merely to appear comprehensive.

## 13. Test strategy

The implementation must prove both accepted behavior and failure boundaries.

### Structural tests

- schema acceptance/rejection;
- unknown version/enum rejection;
- duplicate/dangling ID rejection;
- valid/invalid evidence-union shapes.

### Semantic validator fixtures

Provide positive and negative fixtures covering the twelve accepted validator classes from `#5882061491`, including:

1. unresolved provenance;
2. duplicate executable authority;
3. silent multi-target collapse;
4. redundant longer authority;
5. layer leakage;
6. pure-character contamination;
7. unsafe one-character reverse promotion;
8. fallback overlap without explicit dependency/precedence;
9. orphan `RestorationUnit`;
10. required lexical bind failure;
11. raw-source/canonical projection mismatch without audit trail;
12. review-only evidence leaking into accepted hot authority.

Where sections 8.3 define REVIEW rather than ERROR, fixtures must assert the deterministic review finding instead of pretending the condition is universally decidable.

### Integration fixtures

- external safe-character pack relation exists and is exported;
- missing/renamed external relation fails;
- lexical namespace match/mismatch;
- contextual preserve/override wins before referenced fallback.

### Golden compilation tests

- expected `manifest`, hot, cold, and audit sections;
- same normalized knowledge with reordered source arrays produces byte-identical generated output;
- two clean compiles are byte-identical;
- review/provenance payload does not leak into normal hot relation sections;
- no partial output becomes the successful generation after a failed validation.

## 14. Change ownership and traceability

The architecture is intentionally organized so independent causes of change have independent owners.

| Change | Canonical owner |
| --- | --- |
| source correction / locator / provenance | `data/evidence/` |
| lexical identity or binding evidence | `data/lexical/constraints/` |
| restoration target / preserve / review knowledge | contextual-kanji pack data |
| structural serialization rules | JSON Schema |
| cross-record semantic invariants | TypeScript semantic validator |
| runtime section encoding | compiler + generated artifact schema |
| browser/Worker/API delivery | consumer repositories |
| broad deterministic character relation | separately owned safe-character pack |

Every generated executable identity must remain traceable through `audit-map.json` to its canonical relation/safety record and supporting evidence.

## 15. First implementation acceptance boundary

The first implementation is complete only when all of the following are true:

- canonical source directories and v1 schemas exist;
- build-only Node/TypeScript/Ajv tooling is pinned and reproducible;
- `validate`, `compile`, `test`, and `check` are implemented;
- the deliberately small first canonical data slice is materialized with recoverable evidence;
- all required negative validator fixtures exist and behave according to ERROR/REVIEW classification;
- cross-pack and lexical-namespace integration fixtures exist;
- deterministic compilation is proven byte-for-byte;
- generated artifact is sectioned into manifest/hot/cold/audit responsibilities;
- generated output is demonstrably derived and not treated as a second source of truth;
- no consumer repository behavior is changed by this implementation slice;
- no release/deploy/publication is performed as part of accepting the architecture.

## 16. Deferred decisions

The following are intentionally deferred because they do not block the first repository implementation:

- whether generated `dist/` sections are committed, release-attached, or built downstream;
- exact dependency versions before implementation planning/lockfile creation;
- final real safe-character pack location and ownership details beyond the typed reference contract;
- bulk import format for large external datasets;
- runtime encoding optimization beyond the sectioned contract;
- broader corpus coverage and admission workflow automation;
- consumer migration sequencing.

These decisions must not be silently fixed by the first implementation unless a concrete dependency makes one unavoidable; if that occurs, the owning Issue/specification must be updated before implementation crosses the new boundary.

## 17. Design rationale summary

This architecture centralizes the same knowledge while separating independent change reasons:

- source evidence can be corrected without rewriting semantic relations;
- canonical admission can change without falsifying upstream source records;
- lexical source identities can migrate through a constraint set/binder rather than being copied into every relation;
- contextual lexical restoration remains independent from deterministic old-form rendering;
- generated runtime encoding can change without rewriting canonical source knowledge;
- consumer delivery can change without changing corpus semantics;
- review-only evidence remains inspectable without acquiring automatic authority.

The architecture is therefore designed around information ownership, change impact, validation evidence, and deterministic recovery rather than around a particular runtime library or one current consumer.
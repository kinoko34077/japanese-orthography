# Shared Transformation Runtime Canonicalization Implementation Plan

Owner: japanese-orthography#14
Design: docs/superpowers/specs/2026-09-29-shared-transformation-runtime-canonicalization-design.md
Base: d62a955969ecac5537d88b592a5b09775919b4e3

## Task 1 — canonical runtime identity test (RED)
Add a core test that requires runtime/manifest.json and the three canonical runtime modules, verifies declared byte length/digest, CommonJS loading, and a representative pure-string transform.

## Task 2 — adopt canonical runtime modules (GREEN)
Copy the already-accepted byte-identical runtime modules into runtime/ without semantic edits. Add deterministic runtime manifest.

## Task 3 — core check integration
Add runtime verification to the repository test/check path and prove full existing tests/typecheck/profile checks remain green.

## Task 4 — first consumer migration
Re-bootstrap txt-auto-replace. Add a runtime source lock and offline drift verifier while preserving operational filenames and runtime behavior. Verify repository checks and parity; merge if clean.

## Task 5 — second consumer migration
Re-bootstrap kinotch-api only after Task 4 acceptance. Add equivalent runtime source lock/drift verification for src/text-core/vendor. Preserve index/Worker/API/tokenizer behavior. Verify required checks; merge if clean.

## Task 6 — authority reconciliation
Update japanese-orthography#4/#14 and relevant devflow Controls to record canonical runtime ownership and both consumer pins. Stop; do not continue into runtime refactor/package/tokenizer/rule expansion.

## Verification invariant
The migration is authority-only: the three operational runtime payloads remain byte-identical to the pre-migration accepted blobs until a later separately-scoped semantic change.

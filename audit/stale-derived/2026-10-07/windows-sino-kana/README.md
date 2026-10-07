# Rejected stale derivative — Phase 4.6E projection under TAR-expanded Symbol Registry

This directory archives the **rejected generated artifact set** that exposed a hidden coupling between Phase 4.6E and the global append-only Symbol Registry.

## Reproduction

- Original observation working state:
  - branch line: `migration/tar-simple-exact-287`
  - committed parent around `b6554e98b5e8c265badcc690c9834cefba7105ae`
  - working tree already had the TAR-expanded Symbol Registry generated but not yet committed
- Durable reproduction head: `be3d6baae76b470800d6b4255feb3f39552aba1d`
- Symbol Registry at reproduction:
  - generation 1: 6,520 atoms
  - generation 2: 6,961 atoms
  - 441 appended atoms
- Environment: Windows local execution on authorized DSKTP-SSD2
- Generator: `npm run generate:sino-kana`
- Disposition: **REJECTED / NOT CANONICAL**

## Why rejected

The Phase 4.6E generator used the *current whole* Symbol Registry as a projection gate. Adding TAR profile atoms therefore caused 104 additional workbook identity relations to enter the generic historical-sino artifact even though Phase 4.6E source data itself had not changed.

The migration fix pins Phase 4.6E identity projection to its already-accepted Symbol Registry generation-1 prefix. The files below remain forensic evidence of the rejected coupling behavior and must not be loaded by canonical runtime paths.

## Archived whole-file copies

- `phase46e-sino-kana.generated.json`
  - SHA-256: `b4160d0c2c8a5ad67467d2a47d1d38dd4d223d0228d23ed14080ad8e4b63b0c7`
  - differs from canonical artifact
  - componentRelations: 10,964 -> 11,068 (+104)
- `phase46e-sino-kana-intake.generated.json`
  - SHA-256: `4abca23ef78f74ccaf45c8267abaadcc236e6d0c4fdb688ea5d2c8eb56df2ea4`
  - identical to canonical intake
- `phase46e-sino-kana-coverage.generated.json`
  - SHA-256: `1429df7321358056a09ba76273b5195dc46a87ddf97c0ba2ddcb5fd85434d7cf`
  - identical to canonical coverage

The previous audit commit on this branch accidentally reproduced against the clean pre-TAR registry and therefore captured canonical-equivalent files. This follow-up commit intentionally preserves that mistake in Git history and corrects the current audit snapshot without rewriting history.

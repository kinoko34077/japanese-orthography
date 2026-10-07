# Rejected stale derivative — Windows sino-kana regeneration (2026-10-07)

This directory archives a rejected generated artifact set for forensic reproducibility.

- Observation/reproduction repository HEAD: `b6554e98b5e8c265badcc690c9834cefba7105ae`
- Environment: Windows local execution on authorized DSKTP-SSD2
- Generator: `npm run generate:sino-kana`
- Disposition: **REJECTED / NOT CANONICAL**
- Reason: regeneration produced mojibake-like malformed character/reading strings and made the committed Phase 4.6E artifacts fail the normal stale check. This divergence is unrelated to TAR #287 and was not admitted to the migration PR.
- Canonical source paths were restored from HEAD after these copies were made.

## Archived whole-file copies

- `phase46e-sino-kana.generated.json`
  - SHA-256: `b181f931528108e29e13acc7a832f24df8bef52867f1ec65469b2ee958f3b481`
- `phase46e-sino-kana-intake.generated.json`
  - SHA-256: `4abca23ef78f74ccaf45c8267abaadcc236e6d0c4fdb688ea5d2c8eb56df2ea4`
- `phase46e-sino-kana-coverage.generated.json`
  - SHA-256: `1429df7321358056a09ba76273b5195dc46a87ddf97c0ba2ddcb5fd85434d7cf`

These files are evidence only. They must not be loaded by canonical normalization/runtime paths.

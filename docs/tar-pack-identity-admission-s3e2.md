# JO #349 S3-E2-P4 — BrowserPack v3に対する固定TAR原典の意味的identity受入

## 対象と正本
固定TAR snapshot（sourceCommit `198f8560613d23417cb0f87172ae8662e722ca30`）、正規`compileRuleIR`、実`compilePrograms`、受入済み`data/browser-pack-v3/manifest.json`と独立した`data/reports/browser-pack-v3-compiled.json`の`packDigest`を照合する。S3-E2-P3の123枝・63 Programの原典joinから先へ進む前に、**同じIRを意味する正規Rule Programが既存Packに収録されている**ことを監査する。

`auditTarOriginPackIdentity`は既存`validateBrowserPackManifest`で正式manifest sealを検証し、次を要求する。

- 固定原典sourceCommitとsidecar IR digestが、正規IRと一致すること
- 受入報告から与えた独立Pack digestとmanifest全体digestが一致すること
- BrowserPack v3・`kinotch-fixed` profileが存在すること
- 正規`ruleProgramDigest(ir)`がmanifest `ruleRuntime.programDigest`と一致すること
- IR/Program件数が一致し、Packの`rule-programs`の件数も一致すること
- 必須`symbol-registry`、`sequence-pool`、`rule-programs`、`rule-program-index`、`rule-runtime-meta`が一意・非空であること

既存の全件TAR検証fixture内で正式manifest・正規Programと照合し、原典・Pack digest・Program件数の不一致を拒否する。

## 認証範囲の厳密な限界
これは**ビルド中のmanifest内容と正規IR/Programの意味的同一性の監査**であり、実際にネットワーク配信されたPackファイルの存在・改竄なし・端末上のセクション内容まで証明しない。各section bytesのハッシュ検証は既存`openBrowserPack`の役割。runtime`edge.emission`や`certifiedOrigin`が本番から信頼できることも保証しない。

本工程でWorkerのplain/ruby入口、調停前mask、全entry/root/groupのON/OFF、設定revision、公開用Pack構造は変更しない。未知の原典枝、形態素の出力変更、CALL・patternは未証明扱い。実Pack A/B安全block #343は維持する。メモリ20MB・長文実速度・公開サイトの新機能受入は別途必要。

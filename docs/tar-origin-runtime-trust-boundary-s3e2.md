# JO #349 S3-E2-P10b1 — 未認証originを本番OFFへ接続しないための負例

## 現在の観測

P3の`createAuditedTarEmissionJoin.match`は、固定原典123枝の`programId/branchOrdinal`、出力・入力・profile・stage等の**値の一致**を検証する。同じ値を持つ別のJavaScript objectが実VMから発行されたかは判定しない。P7の`createFixedTarOriginCandidateGate`も、呼出し時の`pack.packDigest`の値を照合するが、Pack objectの配信経路・実section受入済みインスタンスを検証しない。

`test/tar-compiled-emission-audit-s3e2.test.ts`に固定した2つの**非認証を示す負例**：

1. 実VM edgeをJSON上の値ごとコピーした偽edgeが、既存read-only matcherでは`matched`になる。
2. 正しいdigestのみ保持する偽Packと、同じ値の偽候補でも、旧内部PoC gateはOFFできる。

**このテストが成功することは本番の安全性を証明せず、むしろ公開配線を行ってはならない根拠である。** 既存のmatcher/gateは内部の形式適合性評価用として維持し、`runtimeOriginAuthenticated:false`を継続する。値が等しいことを「VM由来」や「本番で安全にOFF可能」と読み替えない。

## P10b2の必須受入条件

- 独立Pack digest、固定TAR sidecar/IR/Programの意味identityと、実byteハッシュを検証した**同一Packインスタンス**を、信頼境界の外から偽装できない方法で紐付ける。
- VM内部の**実EMIT実行時**にのみ生成できるorigin情報を、変形前literal branchに結び、外部から`{programId,branchOrdinal}`をコピー・付与しただけでは検証に合格しない。
- 正規`kinotch-fixed`、`profile/to-modern/surface`、直接かつ非CALL・非adapt・非patternの監査済み123枝のみを、原典126 editable entryのimmutable eligibility/ORへ結合する。未知枝・不確実な出力では候補を維持し、OFFを発動しない。
- 本番Workerのplain/ruby両経路で、候補合成と重複統合・競合調停より前にのみ制御する。偽Pack、偽edge、混合Program、section改竄、途中load失敗、設定revision不一致の負例でも「認証済みとしてOFF」しない。
- 実本番Packの物理sectionは現Git追跡`data/browser-pack-v3/`にmanifestのみ存在し、P10aの正規ローダーの正常試験はfixture実bytesに限定される。実受入Pack全量の配信・生成・検証が済んだという扱いをしない。

## 非対象と終了条件

このP10b1では本番Worker、既存Rule VM、トグル設定、Pagesは変更しない。テストと本書の同時CI合格で「真正producer未成立を負例として固定」したことのみ限定受入とする。P10b2の実認証機構・本番ON/OFFの受入は**未完了**。実Pack性能比較PR #343は安全HOLD、RAM/圧縮 #346は別owner。

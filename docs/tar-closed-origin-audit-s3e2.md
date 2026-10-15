# JO #349 S3-E2-P10b2b-1 — 閉じたorigin監査の構築契約

## 目的・処理順

`tools/tar-closed-origin-audit-s3e2.ts`は、本番の規則切替ではなく、以下の既受入機構を**同一の内部関数スコープで構築**するNode側の読取専用検査器とする。

1. 固定TAR commit、sidecar/正規IR/Program件数、独立したPack digest、manifestのProgram意味識別子を`auditTarOriginPackIdentity`で監査
2. 既受入123枝／63 Programだけの`createAuditedTarEmissionJoin`を構築
3. `openVerifiedTarHotPack`で固定した実Packの必須hot section7種の実bytesを正規ローダーで検証
4. その**同一Pack instance**から実`createBrowserProgramRuntime`を`traceEmissions:true`で作成
5. `inspect(sourceText,profileId,options)`が自ら実行したVMの生candidateにだけ、private WeakMapによる元object所有検証と固定枝の一意joinを実施

外部が作成した`pack`、`runtime`、`join`、候補配列・偽`emission`を渡せる引数を設けず、照合結果のみを返す。候補の削除・置換・順序変更、Worker公開API、利用者設定は変更しない。通常の候補・出力への非介入を維持する。

## 検証済み範囲と現段階の不足

`test/tar-closed-origin-audit-s3e2.test.ts`は固定source commit/IRの不一致、独立Pack lock不一致を**section provider呼出前に拒否する**負例を検証する。個別のPack実bytesの破損・hot section全種の負例は既受入P10a、VM元objectの所有／コピー・改竄負例はP10b2a、固定枝joinの正規実行全件はP3/P7のテストに依存する。

**実際に公開・配信されたPack bytesの一気通貫認証は未証明。** 現Gitの`data/browser-pack-v3/`にはmanifestのみ存在する。一方、既存Ubuntu Verifyの`npm run build:site`は全section bytesを非公開`dist-site/browser-pack/`へ再生成するため、その直後に`tools/verify-tar-closed-origin-site.ts`を追加実行し、固定source/IR/Programと独立Pack lockから現実の生成byteハッシュとVM候補の一意joinを正のE2Eとして検査する。正常系の達成は**そのCIが当該HEADで実際にSUCCESSしたときだけ**宣言する。仮に成功しても配信済みPagesのbytes同一性、全原典entry・条件付き・adapt/CALL/pattern、ユーザー設定ON/OFFまでは証明しない。

本APIは局所的な調査出力として`matched`を返し得るが、そこでの照合状態は**ユーザー向けの認証済みmask許可ではない**。製品側の`runtimeOriginAuthenticated`は`false`のまま。真正な本番Pack実bytesを固定受入ビルドから供給し、正規IR/sidecar/Programを同じdeploy identityで追跡したpositive E2Eが成立してから、本番Worker候補ゲートと設定revisionの受入に進む。

## 非対象と安全

#343実Pack A/B検証HOLDを解除しない。#346メモリ研究は別owner。Pagesの再公開、release、credential・permission変更は行わない。

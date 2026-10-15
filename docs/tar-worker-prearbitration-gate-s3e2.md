# JO #349 S3-E2-P6 — Workerの候補調停前内部ゲート

## 目的・対象
P5は実BrowserPackからraw候補までVMの枝番号を限定的に運べるが、候補の選択・合成が済んだ後に規則を無効化しても、優先規則OFF時に下位候補が復帰しない。plainの`composeProgramSurfaceCandidates`は局所`planner.assemble`し、ruby直入口の`transformWithProgramRuby`は同出力でdedupe/Program ID unionを行うため、**両入口の前**に生候補の除外が必要。

## 最小実装
`createTransformService({ ..., trustedCandidateGate })`の**内部構築時のみ**指定できる同期関数を導入。WorkerのpostMessageの`transform`や`open`メッセージでは指定できない。既定値`null`は完全に不作動。

- 入力：`{pack,sourceText,profileId,candidates}`。この段階の`candidates`はVM発行raw候補、配列を凍結した複製。
- 出力：元候補の同一object参照を、元の順番のまま保持した部分列のみ。候補の追加・改造しての置換・再順序化は例外として拒否。返した候補だけを含む新しいobservationを組立てる。
- 通常plain入口：`hot.transformText`直後、`composeProgramSurfaceCandidates`が局所assembleする前に1回。
- Ruby直入口：`hot.transformText`直後、`annotateProgramCandidates`および同出力dedupe/union・`localSurface`の前に1回。
- plainからRuby共通後段へ渡る場合は`rawGateApplied`を内部で渡して二重適用しない。
- `legacy-only`には適用しない。既存の公開Workerは関数を指定せず、旧変換経路とレスポンスを維持する。

## 安全境界
**trustedCandidateGateという関数名は認証完了を意味しない。** 呼出し側が固定原典、正規IR／Pack digest、section bytes、VM raw candidate、sourceLock/profile/階層設定revisionを検証しなければ本番ON/OFFを有効にできない。現段階では実ゲートへの信頼済み原典producerの接続も、UIからの設定操作も行わない。入力候補と同一objectであっても内容の真正性は別途保証する必要がある。ゲート内部から受信任意tagを信用しない。

## 受入・回帰
`browser-worker-transform.test.ts`に通常plainとruby directの両経路を用意し、上位候補OFF時に下位候補が復帰すること、各入口の一度だけの発火、デフォルトの既存優先選択、値の置換・並べ替え拒否を確認する。正式CIでTAR parityと通常実行も再検証。実Pack A/B #343の安全block、S5-C #346実常駐メモリ、20MB/長文実測は別ゲート。

P6自体のJS runtime変更は既定不作動の入口追加のみで、まだ利用者へ設定メニューを表示・公開しない。特定規則のOFFは次工程のtrusted producerと、設定階層・効果範囲が証明された場合のみ採用する。

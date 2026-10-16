# JO #349 S3-E2-P10b2b-2 — 実BrowserPackの監査枝観測範囲を分離計測

## 問題と目的

P10b2b-1で正本IR／静的VM監査により123枝が一意に対応することと、実BrowserPack＋通常`transformText`の入力経路を通って候補が発行された事実は別の証拠である。P10b2b-1の非公開E2Eは、独立Pack lockに一致した再生成実バイトで入力2件・実一致4候補を観測した段階。

本工程は、既存`tools/verify-tar-closed-origin-site.ts`の検証入力を固定sidecarの全distinct入力へ拡張し、次の分類を**同一Ubuntu CIの非公開build:site生成Pack**からログに出す。

- `verifiedBranches`：正本静的監査で一意に成立した123枝。実際に`transformText`で観測した件数とは違う。
- `runtimeObservedDistinctBranches`：実Pack・実VM生候補所有確認・固定原典一意joinをすべて通過した枝の重複排除数。
- `runtimeUnobservedBranches`：静的監査済みだが、今回の`profile/to-modern/surface`・context未指定入力で**実観測できなかった**枝の数。
- `observedCandidateBranches`／`observedSharedOutputBranches`：監査側に固定された枝の種類別の観測数。
- `runtimeUnobservedExamples`：調査用の未観測枝先頭12件。未観測の原因は本段階では断定しない。

実観測が固定sidecarの既監査集合の外へ逸脱する場合はCI失敗にする。全123枝を無条件に発行させる、profile/contextを偽る、監査表の期待数を観測数へ書き換える処置を行わない。全枝の実観測は**現在の受入条件に追加せず、今後の適用範囲判断の入力**とする。

## 留保

contextを必要とする規則、basic_form適合、活用・ruby・CALL・pattern・別profileや出力の変形を、この単一`transformText`入力だけで全件実証したことにはならない。未観測枝は直ちにバグ・未実装とは判定しない。監査が成功しても`runtimeOriginAuthenticated:false`、本番Worker／設定ON/OFF／Pages未接続を維持する。

独立実Pack性能A/BのPR #343は安全HOLD、RAM #346は別owner、release/deploy/credential変更なし。

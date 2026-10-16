# JO #349 S3-E2-P10b3c3 — 認証済みPack/VMのWorker内単一再利用

## 目的

P10b3c2で固定TAR原典index／Pack/Program digest／実セクションと、元VM候補の閉鎖読取照合が成立した。しかし通常Worker`createTransformService`は自身のPackキャッシュとProgramRuntimeキャッシュを持つため、P10b3c2とは**別のPack/VMを開封したまま両方を併用するとメモリと実行負荷が二重化**し得る。S5の軽量・高速目標と衝突する。

## 既存Workerの再利用

`runtime/browser-tar-origin-closure.js`の受入済み原典・実Pack・同一VM閉包内だけで`createReadOnlyWorkerService()`を追加。新しいローダー・別VMを一切作らず、受入済み`locked.pack`と`hot`を、既存`BrowserTransformWorker.createTransformService`の`openPack`と`programRuntime`へそれぞれ同じobjectとして接続する。外部からPack・VM・候補を注入させず、Pack違いと`traceEmissions:true`以外を拒否する。

調停前`trustedCandidateGate`にはP10b3c2と共通のVM所有＋固定123枝原典照合を渡すが、**必ず元候補をすべて同順に返す**。除外、優先度変更、下位候補再選出、ruby/プレーン変換、利用者規則切替は行わない。受入済み検査結果の数だけメモリ内の読取診断として保持する。`runtimeOriginAuthenticated:false`を維持。

## 非公開実生成Pack E2E

既存Ubuntu`tools/verify-tar-browser-closed-origin-site.ts`の実物理Pack／独立hash pin／固定63入力123枝照合に続き、同じ閉包から単一Workerサービスを生成してplain・ruby両モードを変換し、候補を削除しないこと、分類の漏れがないこと、Pack openが1回でVMが新規生成されず同じVMを1回再利用することを検証する。

本PRは**公開Workerの`attachToWorkerScope`を変更せず、siteの読み込み経路、UI、設定revision、Pages公開も触れない**。実配信Pagesのbyte同一性と、全TAR規則の個別OFFは未証明。成功後の次工程はデフォルト変換を壊さないWorker内のオプトイン診断接続を独立検証し、その後に初めて候補OFFの安全受入を扱う。

PR #343の実Pack性能A/B安全HOLD、#346 RAM別ownerを保持する。

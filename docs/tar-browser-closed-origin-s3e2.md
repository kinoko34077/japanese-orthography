# JO #349 S3-E2-P10b3c2 — 独立pin済み固定TAR原典と実Pack・VMを閉鎖的に結合

## 対象

本工程は、ビルドで正規生成済みの`tar-origin-index.json`と、P10b3bの固定受入Pack、P10b3aの同一VM生candidate所有証明を**一つのブラウザ互換内部factory**で照合する。検証後に原典行を任意編集するAPIや、外部Pack/VM/candidateを受け取る引数は設けない。

`runtime/browser-tar-origin-closure.js`は、受入済み正本から独立固定したSHA-256 `500fa882847aa1ac8e8f1cbb1f619527f28e1608819e1105adb5233a3c5d102e`と**配信JSONの実バイト列**をWebCryptoで照合し、不一致・サイズ異常なら一切Pack section取得に進まず拒否する。hash一致後も固定source commit、IR digest、Pack digest、Program semantic digest、枝123、原典key126、枝候補120と共有出力3の一意性を確認する。

次に、既存`BrowserTarPackLock.openFixedTarPack`の正規Pack開封・hot7種実バイト検証を用い、外部から差し込めない**同一Packインスタンス**で`BrowserProgramRuntime.createBrowserProgramRuntime(pack,{traceEmissions:true})`を生成する。以降、`inspect(sourceText,profileId,options)`が**自ら実行した生候補だけ**をprivate ownership照合し、固定123枝の`programId/branchOrdinal`・入力・出力・profile/stage/direction/channelが一致したときに`matched`を返す。他は`unsupported`として理由を返す。候補を削除・追加・並べ替えず、返却は開始/終了位置、内部枝と編集可能原典keyの読取診断のみ。

## 検証と限界

`test/browser-tar-origin-closure.test.ts`では偽バイト・サイズ不一致・任意parsed object差込みを拒否。`tools/verify-tar-browser-closed-origin-site.ts`は非公開Ubuntu`build:site`の物理sectionデータに接続し、固定入力63種から実VM候補123枝を同じ認証閉包で検証する。indexバイト汚損と別Pack digestを**section取得前**に拒否する負例も実施する。CIのUbuntu/Windows両checkと、Ubuntuのビルド後E2Eが揃って初めて本工程を限定受入できる。

**この受入は本番の規則OFFを許可しない。** ブラウザ互換moduleは現時点で公開`attachToWorkerScope`に配線していない。実配信中のPagesが同一バイトか、ユーザ設定の永続key/階層ONOFF・revision、全TARの4,008有効sourceCase、28 disabledの各意味を認証したことにはならない。`matched`は「固定123枝について内部read-only診断が通った」だけの状態で、Worker権限や本番のmask実行許可タグではない。

`runtimeOriginAuthenticated:false`を保持し、#343実Pack性能A/B安全HOLD、#346 RAM別owner、Pages公開・資格情報/権限変更なし。

# JO #349 S3-E2-P10a — 実BrowserPackの必須hot section検証境界

## 固定すること

P4の固定TAR sidecar / IR / Program / manifestの意味的identity監査は、実配信section bytesの存在・一致を証明していない。P9のVM emission trace opt-inも単独では原典entryの認証にならない。この中間未達を分離し、Node内部で使用する`openVerifiedTarHotPack`を設ける。

1. 呼出側が**manifestから独立した受入記録**（例: `data/reports/browser-pack-v3-compiled.json`）から`expectedPackDigest`を渡す。入力は16進64桁、`manifest.packDigest`との一致が必要。
2. v3/`kinotch-fixed` profile、必須hot section 7種の一意存在を検査する。
3. 既存`openBrowserPack`を**直接使用**し、manifest seal・eager sectionのhashを実bytesで検証する。さらに`symbol-registry`、`sequence-pool`、`rule-programs`、`rule-program-index`、`rule-predicates`、`rule-lexeme-sets`、`rule-runtime-meta`を明示loadし、byte length / SHA-256を照合する。
4. 拒否事例は独立digest不一致、必須hot section bytes改竄。検証に失敗した結果を返さない。

## 未成立の認証と安全境界

本preflightが返す`runtimeOriginAuthenticated`は**false**。section hashが検証されても、sidecar/IR/Programと実VM emissionを信頼できる同一生成・実行経路で結合したわけではない。利用者指定のPack digestや`pack.packDigest`を持つ任意objectからtrueへ格上げしてはならない。

実装は`tools/`配下のNode専用内部補助であり、`runtime/browser-transform-worker.js`・`runtime/browser-program-runtime.js`・公開Pagesへ繋がない。on-demand/lazyの**未読込section全体まで検証済みとは言わない**。read-onlyのhot preflightで性能・RAM達成も主張しない。固定123枝の真正producer、全entry/root/group設定、revision cacheは後続P10b以降の別受入。

実Pack A/B PR #343安全HOLDと#346RAM別ownerは不変。正式latest-head Ubuntu/Windowsおよびpost-main Verifyで受入を判断し、Pages再公開は行わない。

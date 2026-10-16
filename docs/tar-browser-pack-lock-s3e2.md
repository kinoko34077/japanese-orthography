# JO #349 S3-E2-P10b3b — ブラウザ互換の固定受入Pack lock（read-only）

## 必要条件

既受入のNode閉鎖監査P10b2b1/2は、非公開ビルドされたPackバイトと固定TAR/IR/Program＋実VM候補が123枝で結び付くことを実証した。一方、公開Workerは`attachToWorkerScope`で任意URLのmanifestを使い、内部`trustedCandidateGate`も未接続であり、独立受入Pack identityが固定されていない。

P10b3bはこのうち**ブラウザWorkerでも使用可能なPack独立lock**だけを分離する。

## 実装契約

`runtime/browser-tar-pack-lock.js`はUMD形式で正規`BrowserPackRuntime.openBrowserPack`を直接使用し、入力に外部のopened `pack` / `programRuntime` / VM候補 / `trustedCandidateGate`インスタンスを受け取らない。

1. 正本の受入記録から固定したPack digest `0aaa39bd627dda40e73413026fbf25dae5fcdff326cf9ea254f1920dadfd470b` とProgram semantic digest `2093ffc1f30615d3a56614fd9e2759301518fb0fcfd5ad531830a41da1ed8e32` に、取得manifestが事前一致しなければ拒否する。
2. v3 `kinotch-fixed` profileとhot必須7 sectionのkind/idの一意性を確認し、不一致はsection fetch前に拒否。
3. 正規ローダーでmanifest自身のhash／実section length＋SHA256を検証、必須hot7種をすべてloadする。
4. 検証済みPack objectはローダーの返値に限り、返した`isSameVerifiedPack(pack)`は**同一参照**だけ真とする。コピーや同値digestの外部Packは偽。

`test/browser-tar-pack-lock.test.ts`は受入digest・Program digest・section欠落/重複の負例。`tools/verify-tar-closed-origin-site.ts`では非公開build:siteの実セクションを用い、正常受入、同値の偽Pack拒否、物理hot byte改竄拒否をUbuntu CIで検証。公開Pagesへのデプロイは行わない。

## 現段階で証明できないこと

**実配信のPages byte同一性は未確認**。静的な固定digestが表す正規TAR sidecar/IR/Program由来の証明はP10b2b1/2のビルド時CIから得られた限定証拠であり、このモジュール単体で個別source entryへの実行時候補割当までは証明しない。`isSameVerifiedPack`を公開JavaScript呼出側が任意実装できるため、返却関数の名前だけを信用してWorkerでOFFしてはならない。

次工程で、正規Workerの開封・同一VM所有・固定TAR枝sidecarの読取処理を任意注入できない**同じ閉包**へ接続し、条件付き・未証明枝・revision不一致では必ず元候補を残す。実動作を変える前にplain/ruby両方で局所調停・復帰のE2Eを検証する。

本工程は`runtimeOriginAuthenticated:false`のまま。Workerの設定UIと本番候補削除、release・Pages配信、#343実Pack性能A/B安全HOLD、#346RAM別ownerを変更しない。

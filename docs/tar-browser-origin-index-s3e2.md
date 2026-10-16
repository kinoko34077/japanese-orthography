# JO #349 S3-E2-P10b3c-1 — 固定TAR原典対応表のビルド時生成

## 本工程の受入範囲

既受入の固定TAR source commit `198f8560613d23417cb0f87172ae8662e722ca30`について、`auditTarOriginSidecar`、正規IR・Programコンパイル、`auditTarOriginPackIdentity`、`createAuditedTarEmissionJoin`を再利用し、**監査済み123枝だけ**をブラウザで読めるJSONへ機械生成する。

生成ファイル `dist-site/browser-pack/tar-origin-index.json` の各行は、`programId`、`branchOrdinal`、元入力・出力、`candidate/shared-output`、`editableEntryKeys`を保存する。全体にはsource commit、IR digest、Pack digest、Program semantic digestの固定identityを含む。既受入の候補120枝・shared-output3枝・可編集原典126 keyから逸脱した場合はビルド失敗とする。原典のunknown、衝突、他snapshotを推測補完しない。

`tools/build-site.ts`の既存v3生成時に成果物へ追加し、通常の非公開Ubuntu Verifyの`build:site`後に独立`tools/verify-tar-browser-origin-index-site.ts`で原典からの**同一バイト再生成**、SHA-256、正本identity、123枝の一意性を確認する。v1/v2ビルドに追加しない。

## 認証境界

この段階では**生成物のSHA-256をCIログへ出力して固定受入候補を特定するだけ**であり、ブラウザ内でその配信ファイルのSHA-256を独立した受入済み定数と照合する仕組みはまだない。配信JSON自身から期待digestを導出する方式を認証と見なさない。

後続のP10b3c-2では、CIで実際に観測した正規バイトdigestを独立lockとして固定し、P10b3bで固定受入したPackの**同一インスタンス**と、P10b3aで所有照合したVMの生候補を、Worker内部で偽装不可の閉包に束ねる。read-only結合が成立するまでは候補OFFを行わない。

`programId`はビルド内だけのIDであり永続ユーザー設定keyへ転用しない。固定123枝は全TAR4,008 sourceCaseの利用者ON/OFFを意味しない。実配信Pages bytesの一致、設定revision、条件付き/別profile、RAM20MB性能も別受入。

`runtimeOriginAuthenticated:false`を維持。Worker/利用者向け設定/Pagesの公開操作、#343性能A/B安全HOLD、#346RAM別ownerを変更しない。

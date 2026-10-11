# #335 — BrowserPack 実行時メモリのphase別増分（S5-B）

## 目的
#328が示したhot・lexical静的rawはメモリ常駐量と一致しない。現行実行系でNodeプロセスの`rss`／`heapUsed`／`heapTotal`／`external`／`arrayBuffers`が、最初の変換・同文再変換・別文変換でどう変動するかを、#314の既存ハーネスに重ねて観測する。

## 使い方
```sh
node --import tsx tools/audit-runtime-residency-phases.ts --lengths=250,1000 --timeout-ms=25000 --heap-mb=768
```
- Node子processは入力長ごとに隔離し、`timeout`とold-space上限を既存#314に委任する。RSS全体の厳密上限ではない。
- 通常は公開受入済みBrowserPackからsectionを読む。manifest digestを既存S1と同様に検査し、本文は合成反復日本語文であり実記事代表ではない。
- `deltaFromPrevious`と`deltaFromProcessBefore`は各呼出終了時のスナップショット差分。GC等によって負にもなるので負値を異常扱いしない。
- 一回の読み出しはネットワーク時間とlazy packロードを含む。通信wire圧縮byte・JS object内訳・DOM時間は未計測。
- 全1846セクションのraw合計やブラウザ常駐の最低必要サイズを、このNode実験から導いてはならない。

## 受入範囲
- 固定pack、input digest、profile、各フェーズの出力digest・読込section count/bytesとRAM snapshotを同時記録。
- 実行がtimeout/errorでも欠落を隠さずレコードに保持する。
- S5-Cは、JS/ブラウザの各種類のMap・TypedArray・辞書索引・VM・候補を実際に計量する必要がある。S5-Bは常駐phase比較の入口であって20MB目標達成ではない。
- 本番Worker／BrowserPack／Pagesのコード変更はなく、新規公開・permission・DISABLED28への介入もしない。

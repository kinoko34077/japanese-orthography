# #338 かな表記候補の必要時変換

## 実測を起点とした有界高速化
親 #312 / #337の現行main CPU profileで、`toHiragana`・`toKatakana`が候補spanごとに実行されていることを確認した。これらの旧関数はUnicode U+30A1～30F6（カタカナ→ひらがな）、U+3041～3096（ひらがな→カタカナ）だけを対応するコードポイントへ置換し、**その範囲を全く含まないspanでは必ず元の文字列を返す**。この恒等変換は`alternateTexts.filter(value!==segment)`で捨てられるため、候補/VM意味論に寄与しない。

## 実装
`runtime/browser-program-runtime.js` の一度だけ行う`atomsOf`走査に、ひらがな/カタカナの対象符号点が存在した累積計数を追加した。入力spanのstart/end計数差が0なら旧変換関数の呼出しを省略する。基本形`current.basic_form`を先頭のalternateとして使う契約、順序、contextOnly、Profile/Stage、traceを変更しない。

`atomsOf`はUnicode結合符・ZWJなどを直前の基底atomへ加えるが、変換対象かな自体は基底の先頭コードポイントである。Unicode surrogateペア・結合符・ひらがな/カタカナ境界点の等価性試験を新設した。

## 受入判定
- 新旧Worker同一Pack/同一入力、TAR4,008 source witness parity/28 DISABLED、Ruby/異Profile/隣接context、Ubuntu/Windows CI。
- 実固定Published BrowserPackでbase/prefix＋kana-gate A/Bを行い、出力SHAとwarm処理時間・終点RSSを比較。差が無いか速度低下が明確な場合は採用保留。
- 本番Pagesの公開操作は禁止。20MBやWikipedia級長文への到達は別の受入条件。

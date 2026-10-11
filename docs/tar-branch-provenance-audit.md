# JO #327 — 共有Programの出力枝ごとの原典由来監査

状態：**読取専用PoC**。TARを移植したRule Program/VM/Pack/Pagesは変更しない。

## 根拠・対応方式
親#312、先行#319／#323（CI受入済）、固定TAR `txt-auto-replace@198f8560613d23417cb0f87172ae8662e722ca30` のcandidate/simple-exact成果物、および受入済み `rule-ir-summary.json` と `rule-program-summary.json` を正本とする。

- #323で4,008ケースのうち3,944 Programへのcase-level joinが追跡済み。ただし、63個のProgramは2つのcaseが共有し、Program全体でOFFにするともう一方の変換も失われる。
- 候補競合60グループは各2件のsourceCaseが異なる出力を持ち、canonical Rule 1件に複数出力枝がある。
- 本監査は60グループについて `group.memberRecordIds`・`group.sourceCaseIds`・`priority`・各原典`sourceRefs`・各 `expectedOutputs` を対照し、正規 `normalizeAcceptedOrthographySources→withProfileRules→compileRuleIR` の *受入digest一致* を前提に、同一Rule Program内の2枝を原典entryまで一意joinする。
- simple-exactで2ケース共有の3関係は、どちらも**同一出力枝の共同由来**であり、候補競合60件とは構造が異なる。片方のentryがOFFでも、他方が有効なら出力枝は生存するOR意味論が必要。
- sourceCaseは入力テストの識別子、ProgramIdは配列index、structured sourceIdは原典snapshot内識別子、flat locatorは位置依存。一つの値で相互代替しない。

## 禁止事項・検証範囲
- `tools/audit-tar-branch-provenance.ts`の `enabledCandidateBranches` は**配線されない純粋な枝選択実験**である。優先上位OFF→下位再候補化、未知entry拒否を試験するが、productionのTAR全stage/order/priority/Ruby/morphologyへ意味論を自動的に与えない。
- 同一出力の出典が複数ある場合、単独のsourceCaseをProgram全体のOFFに移さない。
- 違う2 entryから同じ枝が出る等の未証明対応はfail-closedとする。将来のON/OFF本番接続時には、shared-outputのOR由来、Profile OFF、sourceLock、TAR優先順位、設定改訂・キャッシュ失効を追加して再検証。
- 過去のaccepted 4,008 PASS／28 DISABLEDは人工tokenWindow witnessを含む。自然文全適用の根拠としない。
- この成果物は原典の固定版に限る。flat sourceのlocatorを原典更新を超える永続IDとして保存しない。

## 再現
```sh
node --import tsx tools/audit-tar-branch-provenance.ts
node --import tsx --test test/audit-tar-branch-provenance.test.ts
```
受入判定：正規CI両OS・セルフレビュー、60候補グループの120枝が一意対応すること、3件の同出力共用が未解決の構成要件として別に残ること、原典case欠落・曖昧joinを誤って成功としないこと。

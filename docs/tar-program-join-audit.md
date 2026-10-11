# #323 — 原典sourceCaseからcanonical Rule / Programへの対応監査

状態：**read-only・本番未接続**。#319固定原典ID監査の次工程。個別toggleの安全性を検討するため、現行compilerに実際に投入される Rule IR と対応付ける。

## joinの採否基準

- 先行4コーパス（simple-exact 3,163関係／3,166ケース、context670、candidate165、pattern7）から sourceCaseId→**正本normalizationが生成する canonical Rule ID** を復元する。
- candidate 120競合caseは**60個のcanonical group Rule**に集約。元の候補2件は削除しない。1件の `review-required` caseはrunするRuleではなくexcludeとして保持。
- `normalizeAcceptedOrthographySources`→`withProfileRules`→`compileRuleIR` で最新ソースからIRを得る。commit済み`rule-ir-summary.json.digest`および`rule-program-summary.json.irDigest`との一致を**必須**とし、ビルド配列順の各indexをProgramIdと解釈する。
- Rule IRの`canonicalIds`を全Programから逆引きし、exact canonical Rule IDで結合。見当たらないケースは`missing`に記録し、文字列の類似性だけで紐付けない。
- 出力は対応数・Program共有・multi program・候補グループ・missing・excludedを分け、Program ID全体を利用者toggleキーと**決して同一視しない**。

## この監査だけで証明できないこと

IRの`canonicalIds`に同一元Ruleが存在しても、Program内の**各出力branchが特定の原典entryに依存しているか**は保証できない。とくにcandidate group 60個は2件の出力候補を統合しており、Program単位OFFは誤って両候補を消す可能性がある。高優先規則OFF時の下位再候補化、flat locatorの版跨ぎ移行、条件付き副詞などの自然文判定も別の受入工程。

## 実行
```sh
node --import tsx --test test/audit-tar-program-join.test.ts
node --max-old-space-size=1200 --import tsx tools/audit-tar-program-join.ts
```
2行目は全正本graph/IRを再生成するread-only処理であり、Pack/公開の再生成・書戻しは行わない。上限時間/RAMに余裕のある実行環境で試験する。遅い場合は子プロセスtimeoutで切り上げ、失敗を成功として扱わない。

## 次段階
join結果にmissingがあれば正本・generatorの不一致原因を分離。multi-source-per-Programは、`canonical Rule→IR branch→Program output occurrence`を確認するまで**個別ON/OFFの本番導入を保留**。これらを満たした限定overlayを後続S3-Cへ分離する。

## 候補グループの枝別原典対応（#323後半）
`tools/audit-tar-branch-origins.ts` は4 corpusのうち候補165件に含まれる、同一入力競合120件→60 groupの各`memberRecordId`を`expectedOutputs`と突き合わせる。原典2件がそれぞれ別の出力枝を所有する場合、片方のactiveをfalseにしても別の出力候補は残る孤立PoCを`test/audit-tar-branch-origins.test.ts`で検査。

この対応は **sourceCase→canonical group output** の単位。まだcompiled Programの`branches`／実行時`edges`に永続論理entry IDを埋め込んでいない。`sourceCaseId`を設定IDとして保存しない。multi-origin同一出力と、TAR優先順位・連鎖処理を含む本番ON/OFFの受入は別ゲート。

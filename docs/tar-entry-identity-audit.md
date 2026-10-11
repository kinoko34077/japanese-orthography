# #319: TAR個別ON/OFF用 Source Entry Identity 監査

状態: **S3-A／read-only census。runtime Programへの実装配線は未決定**。
正本: #163・#208・#312・#313、および `txt-auto-replace@198f8560613d23417cb0f87172ae8662e722ca30` のtree schema/設定を固定参照。

## ID空間と原典との一致

1. **TAR source entry ID**: structured treeのsourceId。複数の`from_options`や複数sourceCaseが同じentryを参照しても、個別ON/OFF単位は原則そのentry。stable key候補は `[source commit, source path, sourceId]`（snapshot内のみ確実）。
2. **TAR sourceCaseId**: fixtureの条件／入力／branchなどを個別に検証する行のID。entryの編集単位とは限らず、再編・分割可能。永続設定キーとして使用しない。
3. **JO canonical relation ID**: 表層・出力やsourceを集約した知識表現。simple-exactでは3,166 sourceCaseが3,163 relationに集約済み。個別entry制御のキーをcanonical relationで代用すると出典別OFFが失われる。
4. **JO IRRule.ruleId**: canonical graphから生成するrule ID。単一IRRuleのbranchesに複数canonicalIdを残しうる（`tools/rule-ir.ts`）。RuleId・依存・profile policyの契約は#208を優先する。
5. **ProgramId**: `tools/rule-program-compiler.ts`でRule IRのビルド時index。安定IDとして永続保存しない。ProgramIdとsourceCaseの実対応はevidence joinで別途証明が必要。

### 弱い同定を推定確定しない
- flat原典には安定したeditable entry IDが存在しない場合がある。path+locatorは**固定版の相対位置**に過ぎず、元辞書の再編を跨ぐ移行IDとして使用できない。
- structured sourceIdも複数source snapshotで同一IDが存在しうるため、path・snapshotなしで同一物扱いしない。
- provenance refsが複数あるレコードについて、片方のentryをOFFにしただけで他のactive entryを消してよいかは**統合後のbranch/occurrence由来**を検証するまで未決定。
- 現行原典でDISABLED28のsourceCaseは別リストとして保持。設定TRUEによる有効化は禁止。profile denyも同様。
- 後続編集中のsource ID変更では、旧→新の**明示的移行表**または未知ID拒否が必須。字面だけで自動移行しない。

## 監査ツール

```sh
node --import tsx tools/audit-tar-toggle-identities.ts
node --import tsx --test test/audit-tar-toggle-identities.test.ts
```

`tools/audit-tar-toggle-identities.ts`は4成果物と`source-case-index.json`を読み込み、4,005関係（3,163+670+165+7）／4,008 active cases（3,166+670+165+7）／28 disabled casesを検証する。index `recordIndex` とIDも厳密照合し、不整合はfail closed。

出力はsource identity keyの多重参照数、structured強識別子未確認数、原典参照の多重性、同一入力に異なる出力を持つ関係の存在を集計する。**この集計に含む`sourceIdentityKeys`はProgramへ既に紐付いた数ではない。** `programMapping.status`は意図的に `not-established` として出力する。

## S3-Bへ進む条件
- source case → source entry の実レコード分布を監査結果とともに#319へ記録。
- canonical relation → IRRule → Programの既存`program-evidence`結合を**別のread-only検証**で行い、同一Programが複数editable entryを集約している実例を確定する。
- ルールmaskは候補列挙後、競合解決前に反映し、選択されなかった下位候補を復活可能にする（#313 S0）。
- 設定変更で最新branch/maskを参照させ、旧cache/predicate/candidate利用を拒否する。
- production VMへの配線とPages公開は、この監査の実装範囲外。

検証の達成／未達、source evidence欠損、Program対応未完は分けて#319のコメントに記録する。

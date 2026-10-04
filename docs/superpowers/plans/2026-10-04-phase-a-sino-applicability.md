# Phase A 字音 positive applicability 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

## Goal

Issue #271 の Phase A として、既存の字音HTML表を歴史的読みの権威として維持したまま、`字音仮名_まとめ.xlsx` の呉音・漢音・共通音・慣用音等の分類を、runtime が適用可否を判定するためのコンパクトな証拠として取り込む。これにより、語彙側の `lexicalOrigin` が `sino` と確定していない場合でも、全構成要素が資料で裏付けられる場合だけ字音再構成を許可する。

代表ケースは `必要 / ひつよう -> ひつえう`、`必 / ひつ` の漢音分類、`学校 / がっこう -> がくかう` の既存挙動である。資料で裏付けられない未知要素や競合分類は fail-closed とし、XLSX分類だけから歴史的綴りを新規発明しない。

## Architecture

1. `tools/sino-reading-class.ts` に依存パッケージを増やさない最小OOXML readerを追加し、ヘッダーを検証して `(漢字, 現代音)` ごとの分類と資料位置を決定的に抽出する。
2. `tools/sino-kana.ts` でHTML表の歴史的関係とXLSX分類を合成する。明示的HTML関係を優先し、HTMLの「表にない音は現代仮名遣いと同じ」というcatch-allの根拠がある場合に限り、分類証拠を伴う安全なidentity relationを生成する。生成物にはHTMLとXLSX双方のsource snapshotと分類情報を残す。
3. `tools/sino-dag-projection.ts` と `runtime/historical-sino-runtime.js` の両方で分類由来identity relationを通常のcompact graphへ投影する。未知のidentity fallbackは証拠なしのまま残し、adapter側で正当化しない。
4. `runtime/browser-resolver-adapter.js` のpositive gateを、`lexicalOrigin === "sino"` または再構成結果の全componentがsource/evidenceを持つ場合に限定する。再構成が曖昧なら候補を保持し、証拠不足は `sino_evidence_unavailable` とする。

## Tech Stack

- TypeScript / Node.js built-ins（`fs/promises`, `zlib`, XML text extraction）
- 既存のHTML parser、intake/accounting、orthography bundle、browser pack generator
- UMD形式のbrowser runtimeと既存のDAG/legacy parity test
- focused `node --import tsx --test`、生成物validator、typecheck

## Spec

- `docs/superpowers/specs/2026-10-04-sino-applicability-design.md`
- `docs/superpowers/specs/2026-10-04-browser-runtime-stabilization-design.md`
- Work Order Issue #271、関連Issue #235・#268

## Global Constraints

- 実装範囲はPhase Aのみ。歴史的Ruby serializer、semantic certainty/provenance表示、Rule Program cutover、#210のTAR移行、Pages公開は扱わない。
- HTMLは歴史的綴り・identity・heading・admitted/excludedの権威であり、XLSX分類は適用可能性の証拠であって歴史的綴りの発明源ではない。
- 呉音のみ、呉音漢音共通、漢音のみ、慣用音等を混同しない。複数分類・競合・未分類は保存順で勝者を選ばず、必要な場合はfail-closedとする。
- runtimeでXLSXを読む処理は追加しない。コンパイル済みのcompact artifact/packだけを読む。
- unknown lexical originを暗黙に `sino` とみなさない。証拠のないidentity fallbackを成功結果として表示しない。
- 既存の正本データ、生成物の決定性、source/evidence provenance、legacy/DAG parityを壊さない。
- Issue・PR・コミット・新規コードコメントなど人間向け文章は日本語で記述する（固定識別子・パス・API名は除く）。
- 変更は専用リモートブランチへpushし、検証済みPRを作成する。Pages公開・deploy・release・force pushは行わない。

## Review Focus

- workbook parserがヘッダー、共有文字列、行番号、空欄、文字単位分割を決定的に扱い、入力形式の崩れを黙って落とさないか。
- `必/ひつ` のような分類証拠とHTML catch-all証拠が両方揃う場合だけidentity relationが生成されるか。
- explicit HTML relation、複数historical reading、競合分類、未知文字、証拠なしidentityの各境界が保存順に依存せずfail-closedか。
- `必要` は unknown lexical originでも全componentの証拠により解決し、証拠なしunknownは解決しないか。
- `学校` の既存結果と legacy/DAG/browser pack の出力が変わらず、生成物とsource snapshotが再現可能か。

## Implementation Tasks

### Task 1: XLSX読み分類parserのRED/GREEN

- Files: `tools/sino-reading-class.ts`, `test/sino-reading-class.test.ts`
- Interface: `parseSinoReadingClassWorkbook(input: Uint8Array, sourceRef: string): SinoReadingClassParseResult`
- RED: `node --import tsx --test test/sino-reading-class.test.ts` を実行し、未実装module/APIの失敗を確認する。
- Implementation: OOXMLの共有文字列・worksheet・セル参照を読み、6列の固定ヘッダーを検証する。分類を `(character, modernReading)` に集約し、空欄・行番号・source locatorを保持する。分類値は `go_only` / `go_kan_common` / `kan_only` / `customary` とし、競合を消さない。
- GREEN: 実資料の `必/ひつ`、`学/がく` と各分類、未知行・欠落ヘッダー・競合分類のテストを通す。
- Commit: `test: 字音分類parserの境界を追加`、`feat: 字音分類を決定的に抽出`

### Task 2: HTML/XLSXのcompact artifact合成

- Files: `tools/sino-kana.ts`, `tools/validate-sino-kana.ts`, `test/phase46e-sino-kana.test.ts`, generated `data/intake/phase46e-sino-kana.json`, `data/reports/phase46e-sino-kana-coverage.json`, `data/historical/sino/phase46e-sino-kana.json`
- Interface: `buildPhase46eSinoArtifacts(rootDir)` がHTML/XLSX snapshot、分類証拠、component relationsを返す。
- RED: `必要/ひつよう` と分類付き `必/ひつ` が生成artifactへ現れないことを固定するfocused regressionを追加し、失敗を確認する。
- Implementation: XLSX snapshot/blobを固定し、HTML catch-all locatorを明示的な証拠として扱う。明示HTML relationがない `(character, modernReading)` に限り、分類が一意でcatch-all根拠がある場合にidentity relationを追加する。XLSX分類単独のrelationは生成しない。coverage/validatorにsnapshotと分類の決定性を反映する。
- GREEN: 既存coverage、remainder=0、artifact再生成、schema/validation、代表分類と `必要` の関係を通す。
- Commit: `feat: 字音分類をcompact artifactへ投影`

### Task 3: runtime positive applicability gate

- Files: `tools/sino-dag-projection.ts`, `runtime/historical-sino-runtime.js`, `runtime/browser-resolver-adapter.js`, `test/phase48g-compact-runtime.test.ts`, relevant runtime tests
- Interface: reconstructed componentの`evidenceRefs`をpositive applicability predicateへ渡し、`sino_evidence_unavailable`を維持する。
- RED: unknown lexical originでも全componentに証拠がある `必要` はresolved、証拠なしunknownはunavailable、競合再構成はcandidatesとなる回帰テストを追加する。
- Implementation: runtime fallbackは証拠なしopaque componentのままにし、adapterのauthorize条件を「sino originまたは全component evidence」にする。DAGとlegacyのcomponent/evidence semanticsを一致させる。storage-order winnerを作らない。
- GREEN: `必要`、`学校`、証拠なし未知語、競合分類、existing parity corpusを通す。
- Commit: `fix: 字音適用条件を資料証拠で判定`

### Task 4: 生成物・browser pack・Phase A検証とPR

- Files: generated browser bundle/pack if affected, `test` additions, Issue/PR evidence
- RED/GREEN: focused tests、`validate:sino-kana`、bundle/pack validation、typecheck、可能な範囲のrelevant full checkを新しいSHAで再実行する。既知のWindows Node/NVM環境障害は出力を保存して明示する。
- Implementation: generated artifactsを再生成し、git diff・サイズ・source snapshot・旧代表出力をレビューする。Phase Aの完了条件をIssue #271/#268へ日本語で記録し、専用PRを作成してCIを待つ。
- Commit: `chore: Phase Aの字音runtime生成物を更新`

## Verification Commands

```powershell
node --import tsx --test test/sino-reading-class.test.ts test/phase46e-sino-kana.test.ts test/phase48g-compact-runtime.test.ts
node --import tsx tools/validate-sino-kana.ts
node --import tsx tools/generate-orthography-v2-bundle.ts --check
node --import tsx tools/generate-browser-pack.ts --check
npm run typecheck
```

`npm test` / `npm run check` はfocused検証後に実行する。環境依存の失敗と実装失敗を分離して報告し、検証未完了のまま完了・merge済みとは表現しない。

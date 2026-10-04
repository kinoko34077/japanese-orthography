# Browser runtime安定化設計

Status: `レビュー修正案 / 実装未選択`

Baseline: `main@07a1642062376fd9ea3c42df4c3cf7f40f5f1559`

根拠Issue: #222, #223, #227, #229, #230, #236, #244, #250, #267, #268。

本設計は、公開GUI監査で確認された「canonical/source dataよりBrowser実行・表示層の不整合が大きい」という状態を、責務別に修正するための順序を定義する。

実装順序:

1. #268 — 既存字音資料からpositive applicabilityをcompileする。
2. #267/#223 — historical Ruby authorityとserializationを分離・修正する。
3. #230/#244/#236 — semantic certainty、display preference、provenanceを分離する。
4. #229 — BrowserPack production executionをRule Program runtimeへ実際にcutoverする。

この順序は依存関係に基づく。Pages公開、public BrowserPackの再公開、広範な辞書再探索、#210辞書拡張は本設計に含めない。

## 共通不変条件

- `displayReading`は表示用情報であり、historical transformationやlexical identityを認可しない。
- historical Rubyは、admitted historical readingまたはsource-backedかつ決定的なreconstructionからのみ生成する。
- 「serializeされた出力候補が1個」はsemantic certaintyを意味しない。
- lexical identity、reading、historical applicability、output arbitrationは独立して保持・検査する。
- authority labelは実際のbasis/provenanceから導出する。provenanceが空なら`none`であり、fallbackで`source_rule`へ昇格させない。
- `lexicalOrigin=unknown`だけではSino applicabilityを認可しない。source-backed originまたはsource-backed component evidenceを正に立証する。
- candidate/ambiguityを保存する。storage orderやdisplay priorityをsemantic winnerへ昇格させない。
- serializerのmode変更は、semantic state、authority、provenanceを変更しない。
- Rule Program runtimeは、audit traceを生成できるだけではproduction authorityとみなさない。

## Phase仕様

- [Positive 字音 applicability](2026-10-04-sino-applicability-design.md)
- [Historical Ruby authority / serialization](2026-10-04-historical-ruby-serialization-design.md)
- [Semantic certainty / provenance](2026-10-04-semantic-certainty-provenance-design.md)
- [Browser Rule Program cutover](2026-10-04-browser-rule-program-cutover-design.md)

## Cross-phase受入条件

各Phaseは、実装前にRED regressionを追加し、focused suiteをGREENにした上で既存のfull-check contractを維持する。

代表real-text corpusには最低限、`学校`, `必要`, `必ずしも`, `東南アジア`, `好む`, `男女`, `大人層`, `市場特性`, `出版各社`, `日本企業`, `サービス`, lexical ambiguity例、unknown/ASCII、emoji、protected spanを含める。

最終受入には以下を要求する。

- historical Rubyに必要なhistorical stateがunknown/unavailableなら`unique`にしない。
- lexeme-scoped判断に必要なlexical identityが曖昧なら、そのlexeme-scoped判断を`unique`にしない。
- lexical identityに依存しないdeterministic ruleまで一律に非`unique`へ落とさない。
- historical Rubyがmodern `displayReading`をhistorical evidenceとして使用しない。
- source-backed productive reconstructionがnon-literal basisと実provenanceを保持する。
- #268のsource-backed evidenceにより`必要 / ひつよう -> ひつえう`へ到達でき、unknown-origin一般をSino扱いしない。
- explicit/implicit Ruby modeが同じsemantic decisionを保持し、serializationのみを変える。
- Rule Program authoritative modeではlegacy resolverのoutputをproduction semantic sourceとして使用しない。
- workerのproduction outputがRule Program runtime由来であることをテストで証明する。
- cold/warm測定を分離して記録する。
- 最終実装commitのexact-head verificationを行う。
- deploy/Pages公開は別のHuman明示承認なしに行わない。

## 実装開始前の状態整合

現行devflow/controlには、#229を「accepted runtime-cutover provenance / unfinished frontierではない」とする記録がある一方、現在のproduction Workerはlegacy resolver outputをauthorityとして使用し、Rule Program runtimeをaudit traceとして併走させている。

また#236には過去の修正受入記録があるが、公開GUI監査で同型のauthority/certainty不整合が別経路から再現している。

したがって実装開始前に、#222、#229、#236、およびdevflowのrepository controlを現在のlive evidenceへreconcileする。過去のaccepted historyは消さず、「当時受入済み」と「現在再確認された未達/再発」を区別して記録する。

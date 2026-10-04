# AGENTS.md

## 適用範囲

このファイルは `kinoko34077/japanese-orthography` repository全体に適用するエージェント向け運用正本である。

このrepositoryで作業するAI/agentは、使用する製品・モデル・実行環境にかかわらず、作業開始時に本ファイルを確認し、本規則に従う。

開発状態・Issue/PR/Work Order・cross-repository運用を扱う場合は、live `kinoko34077/devflow` の `AGENTS.md` と当repositoryのControl Issueも確認する。

## 人間向け記述言語

新規作成または更新する**人間向けの記述は原則として日本語で書くことを義務とする。**

対象には少なくとも以下を含む。

- GitHub Issueのtitle/body/comment
- Pull Requestのtitle/body/comment/review
- commit message
- 設計書・仕様書・Current State・handoff・progress・audit文書
- repository内の運用メモ
- 人間が読むことを目的とするcode comment
- エージェント間の引継ぎ記録

英語の技術用語・identifierを使用する場合も、説明文自体は日本語を基本とする。

## 例外

以下は、日本語化によって機械判定・互換性・再現性・正確性を損なうため、日本語化を強制しない。

- GitHub Actions、YAML、JSON、schema等で機械判定されるkey/valueや固定token
- code identifier、API名、型名、関数名、変数名、enum、opcode
- CLI command、option、regex、query、protocol、HTTP field
- branch名、file path、ref、SHA、package名、外部service名
- 外部仕様・第三者toolが固定文字列として要求する値
- test fixtureや再現手順で原文一致が必要な文字列
- source/evidenceの原文引用
- 既存のmachine-readable status tokenやworkflow marker

機械判定用の英語tokenを含む場合も、その周囲の人間向け説明は日本語で記述する。

## 既存英語記録の扱い

過去のIssue、comment、commit、historical documentを一括翻訳する必要はない。

ただし、今後新規作成する文書・記録、および内容を実質的に更新する人間向け箇所は本規則を適用する。

既存英語文を正確な履歴・引用として残す必要がある場合は、原文を保持してよい。

## 正確性優先

日本語化のためにtechnical meaningを変えない。

固定されたidentifierや英語原語が意味の特定に必要な場合は、

```text
日本語の説明（technicalIdentifier）
```

のように併記する。

翻訳によって仕様上の区別が失われる場合は英語identifierを保持し、日本語で意味を説明する。

# 仮名遣等資料 — authority / provenance note

このディレクトリは、Phase 4.5 の実用受入・辞書拡張で参照する**資料置場**であり、置かれているファイルをそのままresolver authorityとみなさない。

## 層

### Raw / external reference snapshots

歴史的仮名遣い・字音仮名遣い等のHTMLや原資料スナップショット。原資料の記述確認に使う。実装データへ変換する場合は出典・適用範囲を別途固定する。

### Official-table extraction

`同音漢字書きかえ_対応表一式/` の `熟語対応表.csv` と `一字項目.csv` は、文化庁「同音の漢字による書きかえ」のローカル抽出資料。

重要: 原表は **旧表記 -> 書換表記** の方向を示す。逆方向の復元は自動的には成立しない。一字項目も右字から左字への全称逆変換を意味しない。

### AI-derived research candidates

`同音漢字書きかえ_一字項目_復元用辞書一式/`、`多対一・非旧字体_旧表記復元追加リスト_v1_一式/`、`多対一統合_個数判定・例外方式整理_v1_一式/`、`漢字熟語検索系_旧表記復元追加リスト_v2_旧字体除外版_一式/` はAI調査由来。

これらは探索・回帰例の候補であり、`実行採用`、件数、候補URL等をgeneric safetyの根拠にしない。#62監査で重複・機械生成誤り・内部件数不整合・同一入力競合が確認されている。

## 実装へ採用する順序

1. 実際の歌詞/authoring gapを特定する。
2. generic relation / lexical-contextual / KiNoTch semantic override / style-render / preserve の責務を決める。
3. 必要な語・字だけ一次資料または十分な辞書根拠を確認する。
4. typed resolver/profile dataへboundedに採用する。
5. regression fixtureで固定する。

## 既存の優先authority

- #47 — KiNoTch profile overlay and legacy rule reclassification
- #57 / PR #58 — accepted legacy classification
- `data/profiles/kinotch/legacy-stage60-classification.json`
- source-locked generic resolver artifacts / admitted data

資料フォルダ内のAI生成CSV/XLSXがこれらを上書きすることはない。

## #62 cleanup

重複した結合CSV/Markdown、機械生成で誤った逆引きデータ、0件実行結果の巨大除外ログ、既存候補を再加工しただけの実行辞書案・ワークブック等は作業ツリーから除去した。元コミット `1af5f2dfb8825a19ec1e51cd36650a596ac61f44` のGit履歴から復元可能。

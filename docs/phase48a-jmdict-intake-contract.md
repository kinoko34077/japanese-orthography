# Phase 4.8A — JMdict source / licence / snapshot / intake contract

Owner: #133 (parent #132). Code: `tools/jmdict-intake.ts`; data: `data/lexical/sources/jmdict/2026-10-01/`.

## Pinned snapshot

| Item | Value |
| --- | --- |
| Upstream | `http://ftp.edrdg.org/pub/Nihongo/JMdict.gz` (full multilingual JMdict) |
| Created | 2026-10-01 (`<!-- JMdict created -->`), DTD Rev 1.09 |
| Upstream sha256 | recorded in `manifest.json` (`source.compressedSha256`, `source.xmlSha256`, HTTP Last-Modified/ETag) |
| Entries | 218,850 |
| Extract | `jmdict-lexical-intake.json.gz`; sha256 of the uncompressed canonical JSON in `manifest.extract.sha256` |

EDRDG publishes a rolling daily file with no archived snapshots, so the committed
extract **is** the reproducible snapshot. `npm run generate:jmdict-intake -- --source <JMdict.gz> --last-modified <date> --etag <etag>`
regenerates it from a download; `npm run validate:jmdict-intake` (part of `npm run check`)
verifies the extract hash, the field contract and zero-loss accounting.

## Licence

CC BY-SA 4.0 (EDRDG licence). The extract and every dictionary-derived data artifact
compiled from it (4.8C+) carry the attribution in `NOTICE.md` / `manifest.license` and
are share-alike. Code is unaffected.

## Field contract

Included (lexical identity evidence): `ent_seq`; `k_ele/{keb,ke_inf,ke_pri}`;
`r_ele/{reb,re_nokanji,re_restr,re_inf,re_pri}`; `sense/{stagk,stagr,pos,field,misc,dial}`.
Entity-valued tags are stored by entity name (`&n;` -> `n`); the DTD entity table is hashed
into the accounting.

Excluded (counted, not imported): `gloss` (+ `xml:lang`, `g_type`, `g_gend`), `xref`, `ant`,
`s_inf`, `lsource` (+ attributes), `example`, `gram`, `pri`, `info`.

Every element/attribute path seen in the source must have a disposition; an unknown path,
undeclared entity, stray text, duplicate `ent_seq`, or a `re_restr`/`stagk`/`stagr` naming a
non-existent form fails the intake. The validator recounts every included field from the
extract and requires equality with the source accounting (zero silent drops).

Sense records keep their source ordinal even when only excluded content remained. JMdict's
"pos/misc applies to following senses" inheritance is **not** resolved at intake; it is a
4.8C compiler concern.

## Identity

`ent_seq` is provenance only, referenced as `jmdict:<createdDate>:seq:<ent_seq>`. It is not a
repository semantic ID; 4.8B defines the explicit mapping to `LexemeId` / `FormId` / reading IDs.

## Authority boundary

JMdict groups written forms and readings into lexical entries (e.g. one entry holds
`装丁 / 装幀 / 装釘 / 装訂`, while `想定`, `漕艇`, `双蹄` … are separate `そうてい` entries).
That grouping is **lexical-equivalence / candidate evidence only**. It never selects a
historical written form or historical reading; Phase 4.6/4.7 authority remains the only
historical winner authority (`historicalAuthority: false`).

## Drift

A new JMdict download is a new snapshot directory with its own manifest; the accounting diff
between manifests is the drift report. The pinned extract cannot change without a sha256
mismatch failing `npm run check`.

## Analysis bridge / deferred sources

- UniDic-CWJ 2025.12 (already accepted) remains the first lexical/morphological analysis
  bridge for 4.8D.
- Sudachi / SudachiDict is not selected; it may only be dispositioned after a demonstrated
  UniDic + JMdict gap.
- A broader historical-kana dictionary/library survey remains deferred and non-blocking; no
  new historical-kana source is admitted by 4.8A.

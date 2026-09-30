import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  parseColonDictionaryHtml,
  parseExceptionVerbHtml,
  parseKkhKanaJisyo,
  parseNativeGuideHtml
} from '../tools/native-kana-source-parser.ts';

const KKH_SOURCE_ID = 'phase46d-kkh-kana-jisyo';
const DICTIONARY_SOURCE_ID = 'phase46d-committed-native-dictionary';
const EXCEPTION_SOURCE_ID = 'phase46d-committed-exception-verbs';
const ANIMAL_SOURCE_ID = 'phase46d-committed-animal-plant';
const GUIDE_SOURCE_ID = 'phase46d-committed-native-guide';

const KKH_PATH = 'data/sources/kkh/19b24f88ab55809a186d88c465959548495b26a2/kana-jisyo';
const KKH_LICENSE_PATH = 'data/sources/kkh/19b24f88ab55809a186d88c465959548495b26a2/LICENSE';

async function text(path: string) {
  return readFile(path, 'utf8');
}

function gitBlobSha(content: string): string {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1')
    .update(Buffer.from(`blob ${bytes.length}\0`, 'utf8'))
    .update(bytes)
    .digest('hex');
}

test('pinned KKH kana-jisyo extraction accounts for every mapping-shaped record', async () => {
  const source = await text(KKH_PATH);
  assert.equal(gitBlobSha(source), '6a69cdc140994a0b8d5f6acb86d7b3b8c3ef20be');

  const result = parseKkhKanaJisyo(source, KKH_SOURCE_ID);
  assert.equal(result.records.length, 7408);
  assert.equal(result.discoveredRecordIds.length, 7408);
  assert.equal(result.remainders.length, 0);
  assert.equal(result.records.filter(record => record.enabled === true).length, 7151);
  assert.equal(result.records.filter(record => record.enabled === false).length, 257);

  assert.deepEqual(
    {
      locator: result.records[0]?.sourceLocator,
      kind: result.records[0]?.sourceRecordKind,
      modern: result.records[0]?.modernSurface,
      historical: result.records[0]?.historicalSurface
    },
    { locator: 'line:17', kind: 'mapping', modern: '植え', historical: '植ゑ' }
  );

  const middle = result.records.find(record => record.sourceLocator === 'line:4184');
  assert.equal(middle?.modernSurface, 'まじわる');
  assert.equal(middle?.historicalSurface, 'まじはる');

  const last = result.records[result.records.length - 1];
  assert.equal(last?.sourceLocator, 'line:8030');
  assert.equal(last?.sourceRecordKind, 'disabled');
  assert.equal(last?.enabled, false);
  assert.equal(last?.modernSurface, 'ビハインド');
});

test('vendored KKH source carries the pinned BSD-2-Clause license', async () => {
  const license = await text(KKH_LICENSE_PATH);
  assert.match(license, /BSD 2-Clause License/i);
  assert.match(license, /Redistribution and use in source and binary forms/);
});

test('committed colon dictionaries expose stable source ordinals and exact inventory counts', async () => {
  const [dictionaryHtml, animalHtml] = await Promise.all([
    text('仮名遣等資料/仮名遣い辞典本文.html'),
    text('仮名遣等資料/動物名・植物名歴史的仮名遣い辞典.html')
  ]);

  const dictionary = parseColonDictionaryHtml(dictionaryHtml, DICTIONARY_SOURCE_ID);
  assert.equal(dictionary.records.length, 1195);
  assert.equal(dictionary.discoveredRecordIds.length, 1195);
  assert.equal(dictionary.remainders.length, 0);
  assert.deepEqual(
    [dictionary.records[0]?.sourceLocator, dictionary.records[0]?.modernSurface, dictionary.records[0]?.historicalReading],
    ['entry:1', '藍', 'あゐ']
  );
  assert.equal(dictionary.records[597]?.sourceLocator, 'entry:598');
  assert.equal(dictionary.records[597]?.rawText, '周防： すはう');
  assert.equal(dictionary.records[1194]?.sourceLocator, 'entry:1195');
  assert.match(dictionary.records[1194]?.rawText ?? '', /^～んずる /);

  const animal = parseColonDictionaryHtml(animalHtml, ANIMAL_SOURCE_ID);
  assert.equal(animal.records.length, 1369);
  assert.equal(animal.discoveredRecordIds.length, 1369);
  assert.equal(animal.remainders.length, 0);
  assert.deepEqual(
    [animal.records[0]?.sourceLocator, animal.records[0]?.modernSurface, animal.records[0]?.historicalReading],
    ['entry:1', '藍', 'アヰ']
  );
  assert.equal(animal.records[684]?.rawText, 'ゾウガメ： ザウガメ');
  assert.equal(animal.records[1368]?.rawText, 'ワレモコウ： ワレモカウ （「ワレモコウ」説も）');
});

test('exception verbs and native guide are fully countable without inventing mappings', async () => {
  const [exceptionHtml, guideHtml] = await Promise.all([
    text('仮名遣等資料/例外動詞一覧：歴史的仮名遣い教室.html'),
    text('仮名遣等資料/歴史的仮名遣いで書きたい.html')
  ]);

  const exceptions = parseExceptionVerbHtml(exceptionHtml, EXCEPTION_SOURCE_ID);
  assert.equal(exceptions.records.length, 111);
  assert.equal(exceptions.discoveredRecordIds.length, 111);
  assert.equal(exceptions.remainders.length, 0);
  assert.equal(exceptions.records[0]?.sourceLocator, 'entry:1');
  assert.equal(exceptions.records[0]?.rawText, 'あまえる 甘 甘やかす 甘ゆ 甘あ（肖）ゆ');
  assert.equal(exceptions.records[55]?.rawText, 'すえる 饐 饐ゆ 酢ゆ');
  assert.equal(exceptions.records[110]?.rawText, 'よわる 弱 いやを（彌折）れ');

  const guide = parseNativeGuideHtml(guideHtml, GUIDE_SOURCE_ID);
  assert.equal(guide.records.length, 255);
  assert.equal(guide.discoveredRecordIds.length, 255);
  assert.equal(guide.remainders.length, 0);
  assert.equal(guide.records.filter(record => record.structureKind === 'rule').length, 16);
  assert.equal(guide.records[0]?.sourceLocator, 'paragraph:1');
  assert.match(guide.records[0]?.rawText ?? '', /^A１ 現代仮名遣い/);
  assert.equal(guide.records[127]?.rawText, 'こずゑ 梢 すゑ 末 すゑる 据 つゑ 杖 ともゑ 巴 ほほゑむ 微笑');
  assert.equal(guide.records[254]?.rawText, '法則の解説 語の由来');
});

test('KKH malformed mapping syntax and unknown guide transformation structures become mapping remainders', async () => {
  const [kkh, guideHtml] = await Promise.all([
    text(KKH_PATH),
    text('仮名遣等資料/歴史的仮名遣いで書きたい.html')
  ]);

  const malformedKkh = kkh.replace('植え /植ゑ ;ワ行下二段', '植え / ;ワ行下二段');
  const kkhResult = parseKkhKanaJisyo(malformedKkh, KKH_SOURCE_ID);
  assert.equal(kkhResult.records.length, 7407);
  assert.ok(kkhResult.remainders.some(remainder => (
    remainder.sourceRecordId === 'line:17' && remainder.kind === 'mapping'
  )));

  const guideNeedle = 'A１ 現代仮名遣いの語頭の「ワ」と「ウ」は歴史的仮名遣いでもすべて「わ」と「う」。';
  const malformedGuide = guideHtml.replace(
    guideNeedle,
    `${guideNeedle}<table data-phase46d-test="unknown-transform"><tr><td>現代</td><td>歴史</td></tr></table>`
  );
  const guideResult = parseNativeGuideHtml(malformedGuide, GUIDE_SOURCE_ID);
  assert.ok(guideResult.remainders.some(remainder => remainder.kind === 'mapping'));
});

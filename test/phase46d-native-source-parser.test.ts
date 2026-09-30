import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { TextDecoder } from 'node:util';
import test from 'node:test';

const KKH_SOURCE = 'data/sources/kkh/19b24f88ab55809a186d88c465959548495b26a2/kana-jisyo';
const KKH_LICENSE = 'data/sources/kkh/19b24f88ab55809a186d88c465959548495b26a2/LICENSE';

async function loadParser(): Promise<Record<string, any> | null> {
  try {
    return await import('../tools/' + 'native-kana-source-parser.ts') as Record<string, any>;
  } catch {
    return null;
  }
}

function gitBlobSha(bytes: Buffer): string {
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return createHash('sha1').update(header).update(bytes).digest('hex');
}

async function sourceText(path: string): Promise<string> {
  const bytes = await readFile(path);
  const header = bytes.subarray(0, 2048).toString('latin1').toLowerCase();
  if (header.includes('charset=x-sjis') || header.includes('charset=shift_jis')) {
    return new TextDecoder('shift_jis').decode(bytes);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

test('Phase 4.6D native source parser exposes all four deterministic extractors', async () => {
  const parser = await loadParser();
  assert.equal(typeof parser?.parseKkhKanaJisyo, 'function');
  assert.equal(typeof parser?.parseColonDictionaryHtml, 'function');
  assert.equal(typeof parser?.parseExceptionVerbHtml, 'function');
  assert.equal(typeof parser?.parseNativeGuideHtml, 'function');
});

test('vendored KKH kana-jisyo is the exact pinned upstream blob with its BSD-2-Clause license', async () => {
  let exists = true;
  try {
    await Promise.all([access(KKH_SOURCE), access(KKH_LICENSE)]);
  } catch {
    exists = false;
  }
  assert.equal(exists, true, 'pinned KKH source and license must be vendored');

  const [bytes, license] = await Promise.all([readFile(KKH_SOURCE), sourceText(KKH_LICENSE)]);
  assert.equal(gitBlobSha(bytes), '6a69cdc140994a0b8d5f6acb86d7b3b8c3ef20be');
  assert.match(license, /Redistribution and use in source and binary forms/);
});

test('KKH parser discovers every mapping-shaped active and disabled source record without remainder', async () => {
  const parser = await loadParser();
  assert.ok(parser, 'native kana parser module must exist');

  const result = parser.parseKkhKanaJisyo(await sourceText(KKH_SOURCE), 'phase46d-kkh-kana');
  assert.equal(result.records.length, 7408);
  assert.equal(result.discoveredRecordIds.length, 7408);
  assert.equal(result.records.filter((record: any) => record.enabled === true).length, 7151);
  assert.equal(result.records.filter((record: any) => record.enabled === false).length, 257);
  assert.deepEqual(result.remainders, []);

  assert.equal(result.records[0].sourceLocator, 'kana-jisyo:L17');
  assert.equal(result.records[0].modernSurface, '植え');
  assert.equal(result.records[0].historicalSurface, '植ゑ');

  const middle = result.records.find((record: any) => record.sourceLocator === 'kana-jisyo:L4184');
  assert.equal(middle?.modernSurface, 'まじわる');
  assert.equal(middle?.historicalSurface, 'まじはる');

  const last = result.records.at(-1);
  assert.equal(last.sourceLocator, 'kana-jisyo:L8030');
  assert.equal(last.enabled, false);
  assert.equal(last.modernSurface, 'ビハインド');
  assert.equal(last.historicalSurface, 'ビワインド');
});

test('committed colon dictionaries expose the accepted deterministic record counts', async () => {
  const parser = await loadParser();
  assert.ok(parser, 'native kana parser module must exist');

  const [dictionary, animalPlant] = await Promise.all([
    sourceText('仮名遣等資料/仮名遣い辞典本文.html'),
    sourceText('仮名遣等資料/動物名・植物名歴史的仮名遣い辞典.html')
  ]);
  const dictionaryResult = parser.parseColonDictionaryHtml(dictionary, 'phase46d-native-dictionary');
  const animalResult = parser.parseColonDictionaryHtml(animalPlant, 'phase46d-animal-plant');

  assert.equal(dictionaryResult.records.length, 1195);
  assert.equal(dictionaryResult.records[0].sourceLocator, 'phase46d-native-dictionary:entry:0001');
  assert.equal(dictionaryResult.records.at(-1).sourceLocator, 'phase46d-native-dictionary:entry:1195');
  assert.deepEqual(dictionaryResult.remainders, []);

  assert.equal(animalResult.records.length, 1369);
  assert.equal(animalResult.records[0].sourceLocator, 'phase46d-animal-plant:entry:0001');
  assert.equal(animalResult.records.at(-1).sourceLocator, 'phase46d-animal-plant:entry:1369');
  assert.deepEqual(animalResult.remainders, []);
});

test('exception-verb parser discovers exactly the 111 table-entry blocks', async () => {
  const parser = await loadParser();
  assert.ok(parser, 'native kana parser module must exist');

  const result = parser.parseExceptionVerbHtml(
    await sourceText('仮名遣等資料/例外動詞一覧：歴史的仮名遣い教室.html'),
    'phase46d-exception-verbs'
  );
  assert.equal(result.records.length, 111);
  assert.equal(result.records[0].sourceLocator, 'phase46d-exception-verbs:entry:0001');
  assert.equal(result.records.at(-1).sourceLocator, 'phase46d-exception-verbs:entry:0111');
  assert.deepEqual(result.remainders, []);
});

test('native guide parser claims the complete A1-C2 section as 255 records with 16 rule headings', async () => {
  const parser = await loadParser();
  assert.ok(parser, 'native kana parser module must exist');

  const result = parser.parseNativeGuideHtml(
    await sourceText('仮名遣等資料/歴史的仮名遣いで書きたい.html'),
    'phase46d-native-guide'
  );
  assert.equal(result.records.length, 255);
  assert.equal(result.records.filter((record: any) => record.guideKind === 'rule-heading').length, 16);
  assert.equal(result.records[0].sourceLocator, 'phase46d-native-guide:p0031');
  assert.equal(result.records.at(-1).sourceLocator, 'phase46d-native-guide:p0285');
  assert.deepEqual(result.remainders, []);
});

test('source format drift produces mapping remainders instead of silent drops', async () => {
  const parser = await loadParser();
  assert.ok(parser, 'native kana parser module must exist');

  const kkh = (await sourceText(KKH_SOURCE)).replace('植え /植ゑ ;ワ行下二段', '植え => 植ゑ ;ワ行下二段');
  const kkhResult = parser.parseKkhKanaJisyo(kkh, 'phase46d-kkh-kana');
  assert.ok(kkhResult.remainders.some((item: any) => item.kind === 'mapping' && item.sourceRecordId === 'kana-jisyo:L17'));

  const guide = (await sourceText('仮名遣等資料/歴史的仮名遣いで書きたい.html'))
    .replace('以上和語について', '<ul><li>現代→歴史</li></ul>以上和語について');
  const guideResult = parser.parseNativeGuideHtml(guide, 'phase46d-native-guide');
  assert.ok(guideResult.remainders.some((item: any) => item.kind === 'mapping'));
});

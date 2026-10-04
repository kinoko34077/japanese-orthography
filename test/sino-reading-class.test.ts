import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseSinoReadingClassWorkbook } from '../tools/sino-reading-class.ts';

test('字音分類表は必と学の分類を資料位置付きで抽出する', async () => {
  const workbook = await readFile('仮名遣等資料/字音仮名_まとめ.xlsx');
  const parsed = parseSinoReadingClassWorkbook(workbook, 'phase46e-sino-reading-class');

  const must = parsed.entries.find((entry) => entry.character === '必' && entry.modernReading === 'ひつ');
  assert.ok(must);
  assert.deepEqual(must.classes, ['kan_only']);
  assert.ok(must.evidenceRefs.some((ref) => ref.includes('row:')));

  const study = parsed.entries.find((entry) => entry.character === '学' && entry.modernReading === 'がく');
  assert.ok(study);
  assert.deepEqual(study.classes, ['go_only']);
  assert.ok(parsed.remainders.some((remainder) => remainder.row === 242 && remainder.column === 'C'));
});

test('字音分類表は分類競合を保存し、ヘッダー欠落を拒否する', () => {
  assert.throws(
    () => parseSinoReadingClassWorkbook(new TextEncoder().encode('not a zip'), 'test'),
    /XLSX|ZIP|workbook/i
  );
});

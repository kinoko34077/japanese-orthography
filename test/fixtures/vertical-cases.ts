import assert from 'node:assert/strict';
import test from 'node:test';

// #196 J mandatory vertical cases, shared by every pack generation (#211 I): the v2 site E2E and the
// BrowserPack v3 E2E register exactly the same assertions over their own transform service.
export function registerVerticalCases(label: string, service: { handle: (message: any) => Promise<any> }) {
  let requestId = 0;
  const transform = async (text: string, profileId = 'historical', renderMode = 'plain') => {
    const reply = await service.handle({ type: 'transform', requestId: ++requestId, text, profileId, renderMode });
    assert.equal(reply.type, 'result', reply.message);
    return { requestId, result: reply.result };
  };
  const detail = async (resultId: number, detailRef: string) => {
    const reply = await service.handle({ type: 'detail', requestId: ++requestId, resultId, detailRef });
    assert.equal(reply.type, 'detail', reply.message);
    return reply.detail;
  };
  const unitOf = async (text: string, surface: string, profileId = 'historical') => {
    const { requestId: id, result } = await transform(text, profileId);
    const unit = result.units.find((u: any) => u.sourceText === surface);
    return { result, unit, detail: unit ? await detail(id, unit.detailRef) : null };
  };

  test(`${label} J1/J2: 学校 -> 學校; Ruby mode -> ｜學校《がくかう》`, async () => {
    assert.equal((await transform('学校')).result.renderedText, '學校');
    assert.equal((await transform('学校', 'historical', 'ruby-whole-explicit')).result.renderedText, '｜學校《がくかう》');
  });

  test(`${label} J3: がっこう reaches the 学校 identity and its historical kana`, async () => {
    const { result, detail: d } = await unitOf('がっこう', 'がっこう');
    assert.equal(result.renderedText, 'がくかう');
    assert.ok(result.spans.length === 1 && result.spans[0].resolved === false);
    const raw = await transform('がっこう');
    const spanDetail = await detail(raw.requestId, raw.result.spans[0].detailRef);
    assert.ok(spanDetail.resolverUnit.lexicalCandidates.some((c: any) => c.lexicalIdentity === 'lexeme:学校/がっこう'));
    assert.equal(d, null, 'the changed kana unit is a span, not an unchanged unit');
  });

  test(`${label} J4: ドイツ exposes 独逸 / 独乙 without an arbitrary generic winner`, async () => {
    const { result, detail: d } = await unitOf('ドイツ', 'ドイツ');
    assert.equal(result.renderedText, 'ドイツ');
    assert.deepEqual(result.spans, []);
    const germany = d.lexemes.find((l: any) => l.lexicalIdentity === 'lexeme:独逸/ドイツ');
    assert.deepEqual(germany.forms.map((f: any) => f.surface).sort(), ['独乙', '独逸']);
  });

  test(`${label} J5: みる keeps multiple lexical candidates and stays unresolved without context`, async () => {
    const { result, unit, detail: d } = await unitOf('みる', 'みる');
    assert.equal(result.renderedText, 'みる');
    assert.equal(unit.resolved, false);
    assert.ok(d.lexemes.length >= 3, `${d.lexemes.length} candidates`);
    assert.ok(d.lexemes.some((l: any) => l.lexicalIdentity === 'lexeme:見る/みる') && d.lexemes.some((l: any) => l.lexicalIdentity === 'lexeme:診る/みる'));
  });

  test(`${label} J6: 分かる — generic unchanged; KiNoTch 分る (admitted profile style)`, async () => {
    assert.equal((await transform('分かる', 'historical')).result.renderedText, '分かる');
    const kinotch = (await transform('分かる', 'kinotch-fixed')).result;
    assert.equal(kinotch.renderedText, '分る');
    assert.equal(kinotch.spans[0].authority, 'project_rule');
  });

  test(`${label} J7: ｜今日《きょう》 uses the Ruby as lexical evidence`, async () => {
    const { requestId: id, result } = await transform('｜今日《きょう》');
    assert.equal(result.renderedText, '｜今日《けふ》');
    const d = await detail(id, result.spans[0].detailRef);
    assert.deepEqual([d.resolverUnit.lexicalIdentity, d.resolverUnit.reading, d.resolverUnit.readingSource], ['lexeme:今日/きょう', 'きょう', 'ruby-word']);
    assert.equal((await transform('今日')).result.renderedText, '今日');
  });

  test(`${label} J8: 台風 keeps the accepted contextual kanji behaviour (颱風)`, async () => {
    const { requestId: id, result } = await transform('台風');
    assert.equal(result.renderedText, '颱風');
    const d = await detail(id, result.spans[0].detailRef);
    assert.equal(d.resolverUnit.historical.contextualKanji, 'resolved');
  });

  test(`${label} J9/J10: unknown text is preserved; ASCII / emoji / Ruby mixed text keeps UTF-16 ranges`, async () => {
    const text = 'abc 😀 溶接 𠮷野家 zzz ｜学校《がっこう》';
    const { result } = await transform(text);
    assert.equal(result.renderedText, 'abc 😀 熔接 𠮷野家 zzz ｜學校《がくかう》');
    for (const span of result.spans) {
      assert.equal(text.slice(span.start, span.end), span.sourceText);
      assert.equal(result.renderedText.slice(span.renderedStart, span.renderedEnd), span.renderedText);
    }
    for (const unit of result.units) assert.equal(result.renderedText.slice(unit.renderedStart, unit.renderedEnd), unit.sourceText);
    for (const t of ['', 'hello world', '😀😀', 'zzz'.repeat(500)]) assert.equal((await transform(t)).result.renderedText, t);
  });

  test(`${label} J11/J12: unchanged recognized text is inspectable and its provenance is recoverable lazily`, async () => {
    const { unit, detail: d } = await unitOf('今日は学校で', '今日は');
    assert.deepEqual([unit.recognized, unit.changed, 'certainty' in unit], [true, false, false]);
    assert.equal(d.kind, 'unit');
    assert.ok(d.lexemes.length >= 1 && d.lexemes[0].forms.length >= 1);
    assert.ok(d.provenance.sourceRefs.length > 0 && d.provenance.evidenceRefs.length > 0);
    const { requestId: id, result } = await transform('溶接');
    const spanDetail = await detail(id, result.spans[0].detailRef);
    assert.ok(spanDetail.acceptedCandidates[0].provenance.sourceRefs.length > 0);
  });
}

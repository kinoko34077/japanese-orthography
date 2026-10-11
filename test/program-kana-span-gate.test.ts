import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { atomsOf } = require('../runtime/symbol-registry-runtime.js');
const toHiragana = (value:string) => Array.from(value,ch=>{
  const code=ch.codePointAt(0)!;
  return code>=0x30a1&&code<=0x30f6?String.fromCodePoint(code-0x60):ch;
}).join('');
const toKatakana = (value:string) => Array.from(value,ch=>{
  const code=ch.codePointAt(0)!;
  return code>=0x3041&&code<=0x3096?String.fromCodePoint(code+0x60):ch;
}).join('');

test('#338 kana atom-prefix gate preserves original exact alternate strings for variable-length Unicode spans',()=>{
  const source='文字あいうアイウ漢字𠮟\u3099をガッツ👩‍💻１２3ｶﾅ「ほー」';
  const atoms:string[]=atomsOf(source);
  const hira=[0],kata=[0];
  for(const atom of atoms) {
    const cp=atom.codePointAt(0)!;
    hira.push(hira.at(-1)!+(cp>=0x3041&&cp<=0x3096?1:0));
    kata.push(kata.at(-1)!+(cp>=0x30a1&&cp<=0x30f6?1:0));
  }
  for(let start=0;start<atoms.length;start++)for(let end=start+1;end<=atoms.length;end++){
    const segment=atoms.slice(start,end).join('');
    const expected=[toHiragana(segment),toKatakana(segment)].filter(s=>s!==segment);
    const received=[
      kata[end]!==kata[start]?toHiragana(segment):null,
      hira[end]!==hira[start]?toKatakana(segment):null
    ].filter(s=>s&&s!==segment);
    assert.deepEqual(received,expected,'span '+start+':'+end);
  }
});

test('#338 kana boundary includes ends of range and does not classify disjoint near-boundary codepoints',()=>{
  const a='\u3040\u3041\u3096\u3097\u30a0\u30a1\u30f6\u30f7';
  const b=toKatakana(a);
  assert.equal(b,'\u3040\u30a1\u30f6\u3097\u30a0\u30a1\u30f6\u30f7');
  assert.equal(toHiragana(b),'\u3040\u3041\u3096\u3097\u30a0\u3041\u3096\u30f7');
});

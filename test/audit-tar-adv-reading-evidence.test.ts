import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  isPureAdverbPosRule,classifyJmdictReadingAdverb,auditTarAdverbReadingEvidence
} from '../tools/audit-tar-adv-reading-evidence.ts';
import type { JmdictEntry } from '../tools/jmdict-intake.ts';

const pure={sourceCaseId:'x',from:'もちろん',to:'勿論',
  conditions:{current:{pos:'副詞'}}};

test('#331 only selects original TAR pure adverb POS conditions, without broadening source semantics',()=>{
  assert.equal(isPureAdverbPosRule(pure),true);
  assert.equal(isPureAdverbPosRule({...pure,conditions:{current:{pos:'副詞',pos1:'一般'}}}),false);
  assert.equal(isPureAdverbPosRule({...pure,matchOptions:{kana_insensitive:true}}),false);
  assert.equal(isPureAdverbPosRule({...pure,conditions:{current:{pos:'名詞'}}}),false);
  assert.equal(isPureAdverbPosRule({...pure,conditions:{current:{pos:'副詞'},prev:{pos:'名詞'}}}),false);
});

const entry=(seq:number,pos:string[],reading='もちろん',restr=false):JmdictEntry=>({
  seq,r:[{t:reading}],s:[{pos,...(restr?{stagk:['勿論']}: {})}]
});
test('#331 accepts only one unambiguous reading with adv-only POS; never infers UniDic pos1',()=>{
  assert.equal(classifyJmdictReadingAdverb('もちろん',[entry(1,['adv'])]).gate,'single-adv-lexical-evidence');
  assert.equal(classifyJmdictReadingAdverb('もちろん',[entry(1,['adv']),entry(2,['n'])]).gate,'ambiguous-reading-or-pos');
  assert.equal(classifyJmdictReadingAdverb('もちろん',[entry(1,['adv','n'])]).gate,'ambiguous-reading-or-pos');
  assert.equal(classifyJmdictReadingAdverb('もちろん',[entry(1,['adv'],'もちろん',true)]).gate,'ambiguous-reading-or-pos');
  assert.equal(classifyJmdictReadingAdverb('もちろん',[entry(1,['adv'],'やっぱり')]).gate,'no-jmdict-reading-evidence');
});

test('#331 audits the accepted 224 TAR adverb POS-only cases against pinned JMdict, without activating any rule',async()=>{
  const report=await auditTarAdverbReadingEvidence(fileURLToPath(new URL('..',import.meta.url)));
  assert.equal(report.totalContextRules,670);
  assert.equal(report.selectedCases,224);
  assert.equal(report.distinctInputs,222);
  assert.equal(report.sameInputDifferentTarOutputs,1);
  assert.equal(report.lexicalEvidenceUnique+report.lexicalAmbiguous+report.lexicalMissing
    +report.tarConflicts.filter(x=>x.lexicalGate==='single-adv-lexical-evidence').length,
    report.distinctInputs);
  assert.ok(report.tarConflicts.some(x=>x.from==='すぐ'));
  assert.match(report.policy,/never sufficient/);
});

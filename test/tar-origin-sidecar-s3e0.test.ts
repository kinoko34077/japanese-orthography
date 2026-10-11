import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { auditTarOriginSidecar, projectTarOriginSidecar } from '../tools/tar-origin-sidecar-s3e0.ts';

const PIN = '198f8560613d23417cb0f87172ae8662e722ca30';
const structured = (id: string) =>
  JSON.stringify([PIN, 'structured', 'transform-settings (8).json', id]);
const flat = (locator: string) =>
  JSON.stringify([PIN, 'flat', 'tongwentang_pref6_current_json/20.json', 'locator', locator]);

const make = () => ({
  sourceCommit: PIN, irDigest: 'a'.repeat(64), programs: 100,
  candidateOrigins: [{
    canonicalRuleId: 'rule:tar:candidate-group:sample', programId: 10,
    input: 'いづれ', output: '孰', sourceCaseId: 'case-candidate-1',
    entryKey: structured('entry-candidate'), originKind: 'structured', priority: 20
  }, {
    canonicalRuleId: 'rule:tar:candidate-group:sample', programId: 10,
    input: 'いづれ', output: '何', sourceCaseId: 'case-candidate-2',
    entryKey: flat('groups[0].entries[1]'), originKind: 'flat', priority: 30
  }],
  simpleShared: [{
    programId: 11, canonicalRuleId: 'rule:tar:simple-exact:sample',
    input: 'Bluetooth', output: '靑齒',
    sourceCaseIds: ['tar:structured:entry-shared-a:from[0]', 'tar:structured:entry-shared-b:from[0]'],
    sourceKeys: [structured('entry-shared-a'), structured('entry-shared-b'), flat('groups[1].entries[1]')]
  }]
});

test('#349 保守的123枝sidecarの最小合同テスト：原典entry・補助出典・Program IDを分離', () => {
  const result = projectTarOriginSidecar(make());
  assert.equal(result.runtimeConnected, false);
  assert.equal(result.candidateBranches, 2);
  assert.equal(result.sharedOutputBranches, 1);
  assert.equal(result.editableOriginCount, 4);
  assert.equal(result.evidenceOnlyRefCount, 1);
  assert.deepEqual(result.rows.map(r => r.provenancePriority), [30, 20, null]);
  const [a,b,shared] = result.rows;
  assert.deepEqual([a?.output,b?.output], ['何','孰']); // outputの安定コードポイント順
  assert.deepEqual(shared?.editableEntryKeys, [structured('entry-shared-a'), structured('entry-shared-b')]);
  assert.deepEqual(shared?.evidenceOnlyKeys, [flat('groups[1].entries[1]')]);
  assert.deepEqual(shared?.sourceCaseIds,[
    'tar:structured:entry-shared-a:from[0]',
    'tar:structured:entry-shared-b:from[0]'
  ]);
  assert.ok(result.rows.every(r => r.programId !== undefined && r.editableEntryKeys.length > 0));
});

test('#349 不明スナップショット・重複枝・出典権限混同・Program境界をfail-closed', () => {
  const fixture = make();
  assert.throws(()=>projectTarOriginSidecar({...fixture,sourceCommit:'other'}),/identity/);
  assert.throws(()=>projectTarOriginSidecar({...fixture,irDigest:'invalid'}),/identity/);
  assert.throws(()=>projectTarOriginSidecar({...fixture,candidateOrigins:[
    fixture.candidateOrigins[0]!, fixture.candidateOrigins[0]!
  ]}),/duplicate output branch/);
  assert.throws(()=>projectTarOriginSidecar({...fixture,candidateOrigins:[
    {...fixture.candidateOrigins[0]!,programId:100}, fixture.candidateOrigins[1]!
  ]}),/invalid branch/);
  assert.throws(()=>projectTarOriginSidecar({...fixture,candidateOrigins:[
    fixture.candidateOrigins[0]!,
    {...fixture.candidateOrigins[1]!,sourceCaseId:fixture.candidateOrigins[0]!.sourceCaseId}
  ]}),/source case reused/);
  assert.throws(()=>projectTarOriginSidecar({...fixture,candidateOrigins:[
    {...fixture.candidateOrigins[0]!,entryKey:structured('entry-shared-a')},fixture.candidateOrigins[1]!
  ]}),/editable origin reused/);
  assert.throws(()=>projectTarOriginSidecar({...fixture,candidateOrigins:[
    {...fixture.candidateOrigins[0]!,entryKey:structured('entry-shared-a').replace(PIN,'invalid')},
    fixture.candidateOrigins[1]!
  ]}),/snapshot or kind mismatch/);
  assert.throws(()=>projectTarOriginSidecar({...fixture,simpleShared:[{
    ...fixture.simpleShared[0]!,
    sourceKeys:[...fixture.simpleShared[0]!.sourceKeys,structured('entry-unexpected')]
  }]}),/unexpected additional structured origin/);
});

test('#349 live受入済IR/Programと固定TAR全123枝：60×2候補＋3共有をsidecarへ再構成', async () => {
  const root=fileURLToPath(new URL('..',import.meta.url));
  const result=await auditTarOriginSidecar(root);
  assert.equal(result.sourceCommit,PIN);
  assert.equal(result.candidateBranches,120);
  assert.equal(result.sharedOutputBranches,3);
  assert.equal(result.rows.length,123);
  assert.equal(result.editableOriginCount,126);
  assert.equal(result.evidenceOnlyRefCount,3);
  assert.equal(new Set(result.rows.map(r=>JSON.stringify([r.programId,r.output]))).size,123);
  assert.ok(result.rows.every(r=>r.programId>=0 && r.programId<result.programs));
  assert.ok(result.rows.every(r=>r.editableEntryKeys.length>=1));
  assert.ok(result.rows.filter(r=>r.kind==='shared-output')
    .every(r=>r.editableEntryKeys.length===2&&r.evidenceOnlyKeys.length===1));
});

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// #229: Rule Program cutoverのcold/warm観測。固定速度目標は設けず、同一pack・同一入力で
// legacy-only / parity / vm-authoritativeの実測差、section取得、hot section初期化を記録する。

export const RULE_PROGRAM_MEASUREMENT_TEXT = '学校 必要 必ずしも 東南アジア 好む 男女';
export const RULE_PROGRAM_MEASUREMENT_PROFILE = 'historical';
export const RULE_PROGRAM_MEASUREMENT_RENDER_MODE = 'ruby-whole-explicit';
export const RULE_PROGRAM_MODES = ['legacy-only', 'parity', 'vm-authoritative'] as const;

const require = createRequire(import.meta.url);
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { createTransformService } = require('../runtime/browser-transform-worker.js');

type Mode = typeof RULE_PROGRAM_MODES[number];
type SectionRequest = { sectionId: string; path: string; bytes: number };

const readManifest = async (root: string) => {
  const packDir = resolve(root, 'data/browser-pack-v3');
  const manifest = JSON.parse(await readFile(resolve(packDir, 'manifest.json'), 'utf8')) as { packDigest: string; sections: Array<{ sectionId: string; path: string }> };
  return { packDir, manifest };
};

export async function measureRuleProgramMode(root: string, mode: Mode) {
  const { packDir, manifest } = await readManifest(root);
  const requests: SectionRequest[] = [];
  const service = createTransformService({
    executionMode: mode,
    openPack: async () => openBrowserPack(manifest, async (section: { sectionId: string; path: string }) => {
      const body = await readFile(resolve(packDir, section.path));
      requests.push({ sectionId: section.sectionId, path: section.path, bytes: body.byteLength });
      return body;
    })
  });

  const first = await service.handle({
    type: 'transform', requestId: `${mode}-cold`, text: RULE_PROGRAM_MEASUREMENT_TEXT,
    profileId: RULE_PROGRAM_MEASUREMENT_PROFILE, renderMode: RULE_PROGRAM_MEASUREMENT_RENDER_MODE,
    executionMode: mode
  });
  if (first.type !== 'result') throw new Error(`measurement ${mode} cold failed: ${first.message ?? first.type}`);
  const afterFirst = requests.length;
  const second = await service.handle({
    type: 'transform', requestId: `${mode}-warm`, text: RULE_PROGRAM_MEASUREMENT_TEXT,
    profileId: RULE_PROGRAM_MEASUREMENT_PROFILE, renderMode: RULE_PROGRAM_MEASUREMENT_RENDER_MODE,
    executionMode: mode
  });
  if (second.type !== 'result') throw new Error(`measurement ${mode} warm failed: ${second.message ?? second.type}`);
  const warmRequests = requests.slice(afterFirst);
  const loadedSections = [...new Set(requests.map((request) => request.sectionId))];
  return {
    mode,
    packDigest: manifest.packDigest,
    input: { text: RULE_PROGRAM_MEASUREMENT_TEXT, profileId: RULE_PROGRAM_MEASUREMENT_PROFILE, renderMode: RULE_PROGRAM_MEASUREMENT_RENDER_MODE },
    cold: {
      elapsedMs: first.elapsedMs,
      requestCount: afterFirst,
      transferredBytes: requests.slice(0, afterFirst).reduce((total, request) => total + request.bytes, 0),
      renderedText: first.result?.renderedText ?? null,
      parityEquivalent: first.result?.programParity?.equivalent ?? null
    },
    warm: {
      elapsedMs: second.elapsedMs,
      requestCount: warmRequests.length,
      transferredBytes: warmRequests.reduce((total, request) => total + request.bytes, 0),
      renderedText: second.result?.renderedText ?? null,
      parityEquivalent: second.result?.programParity?.equivalent ?? null
    },
    loadedSections,
    note: 'Bytes are uncompressed section bodies observed by the provider; elapsedMs is a local observation, not a release threshold.'
  };
}

if (process.argv[1]?.endsWith('measure-browser-rule-program-cutover.ts')) {
  const root = resolve(process.cwd());
  const runs = [];
  for (const mode of RULE_PROGRAM_MODES) runs.push(await measureRuleProgramMode(root, mode));
  process.stdout.write(`${JSON.stringify({ schemaVersion: '1', kind: 'browser-rule-program-cutover-measurements', owner: 'japanese-orthography#229', runs }, null, 2)}\n`);
}

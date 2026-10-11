import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

/**
 * #314 S1: 既存BrowserPack v3 / production Workerのベンチ計測専用入口。
 * 独立processのtimeoutで長文の過大負荷を打ち切る。性能結果は合格基準としない。
 * 合成文章を「実在する日本語文」やWikipedia代表サンプルと取り違えない。
 */
const BASE = 'もちろん 学校で漢字を調べた。今日はことばと歴史的仮名遣いを考へて、文字を読みます。\n';
const ALTERNATE = '今日は學校で本を読み、もちろん必要な情報を確認する。旧字体と表記の違いを記録します。\n';
export const makeSyntheticText = (length: number, alternate = false): string => {
  if (!Number.isSafeInteger(length) || length < 1 || length > 100_000) throw new Error('invalid synthetic length');
  const unit = alternate ? ALTERNATE : BASE;
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};
export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
export const summarizeTimes = (values: readonly number[]) => {
  if (values.length === 0 || values.some(v => !Number.isFinite(v) || v < 0)) throw new Error('invalid timings');
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]!;
  return { observations: sorted.length, medianMs: percentile(0.5), p95Ms: percentile(0.95) };
};
const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '..');
const require = createRequire(import.meta.url);

const runOne = async (length: number, profileId: string) => {
  const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
  const { createTransformService } = require('../runtime/browser-transform-worker.js');
  const packDir = resolve(root, 'data/browser-pack-v3');
  const manifest = JSON.parse(await readFile(resolve(packDir, 'manifest.json'), 'utf8')) as {
    packDigest: string; sections: Array<{ sectionId: string; path: string }>;
  };
  const sectionLoads: Array<{ id: string; bytes: number }> = [];
  const service = createTransformService({
    executionMode: 'vm-authoritative',
    openPack: async () => openBrowserPack(manifest, async (section: { sectionId: string; path: string }) => {
      const body = await readFile(resolve(packDir, section.path));
      sectionLoads.push({ id: section.sectionId, bytes: body.byteLength });
      return body;
    })
  });
  const source = makeSyntheticText(length);
  const different = makeSyntheticText(length, true);
  const originalDigest = sha256(source);
  const before = process.memoryUsage();
  const cases = [];
  for (const [caseName, input] of [['cold', source], ['warm-repeat', source], ['warm-new-text', different]] as const) {
    const previousLoadCount = sectionLoads.length;
    const started = performance.now();
    const result = await service.handle({
      type: 'transform', requestId: 'jo314-' + caseName,
      text: input, profileId, renderMode: 'plain', executionMode: 'vm-authoritative',
      sourceBackedTokenInference: profileId === 'kinotch-fixed'
    });
    const wallMs = performance.now() - started;
    if (result.type !== 'result' || typeof result.result?.renderedText !== 'string') {
      throw new Error('worker transform error at ' + caseName + ': ' + (result.message ?? result.type));
    }
    cases.push({
      case: caseName, inputUtf16Units: input.length, inputSha256: sha256(input),
      outputSha256: sha256(result.result.renderedText), outputUtf16Units: result.result.renderedText.length,
      wallMs, reportedElapsedMs: result.elapsedMs ?? null,
      fetchedSections: sectionLoads.length - previousLoadCount,
      fetchedBytes: sectionLoads.slice(previousLoadCount).reduce((sum, x) => sum + x.bytes, 0),
      memoryAfter: process.memoryUsage()
    });
  }
  const loadedIds = new Set(sectionLoads.map(x => x.id));
  return {
    kind: 'jo312-s1-browser-baseline', baseline: 'synthetic-repeated-Japanese-text',
    node: process.version, platform: process.platform, arch: process.arch,
    profileId, renderMode: 'plain', executionMode: 'vm-authoritative',
    packDigest: manifest.packDigest, inputLength: length, inputSha256: originalDigest,
    sectionReads: sectionLoads.length, uniqueSections: loadedIds.size,
    rawSectionBytesRead: sectionLoads.reduce((n, x) => n + x.bytes, 0),
    memoryBefore: before, memoryAfter: process.memoryUsage(),
    cases
  };
};

export interface BenchRecord {
  length: number;
  profileId: string;
  status: 'success' | 'timeout' | 'error';
  result?: unknown;
  error?: string;
}
export function runBoundedBaseline(
  lengths: readonly number[],
  profileId = 'kinotch-fixed',
  timeoutMs = 15_000,
  heapMb = 512
): { kind: string; note: string; records: BenchRecord[] } {
  if (lengths.length === 0 || lengths.some(n => !Number.isSafeInteger(n) || n < 1 || n > 100_000)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000
    || !Number.isSafeInteger(heapMb) || heapMb < 128 || heapMb > 2048
    || !['kinotch-fixed', 'historical', 'modern'].includes(profileId)) throw new Error('invalid benchmark parameters');
  const records = lengths.map(length => {
    const child = spawnSync(process.execPath, [
      '--max-old-space-size=' + heapMb, '--import', 'tsx', script, '--child',
      '--length=' + length, '--profile=' + profileId
    ], { cwd: root, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
    if (child.error && (child.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
      return { length, profileId, status: 'timeout' as const, error: 'wall-clock timeout ' + timeoutMs + 'ms' };
    }
    if (child.error || child.status !== 0) {
      return { length, profileId, status: 'error' as const,
        error: (child.stderr || child.error?.message || 'child exited ' + child.status).slice(-1200) };
    }
    try {
      return { length, profileId, status: 'success' as const, result: JSON.parse(child.stdout) };
    } catch {
      return { length, profileId, status: 'error' as const, error: 'malformed child JSON result' };
    }
  });
  return {
    kind: 'jo312-s1-bounded-baseline-results',
    note: 'synthetic corpus only; child V8 heap limit is NOT an RSS limit. No DOM/render timing. One observation per case, not statistical p95.',
    records
  };
}

if (process.argv[1] && resolve(process.argv[1]) === script) {
  const child = process.argv.includes('--child');
  const numOpt = (name: string, fallback: number) => {
    const raw = process.argv.find(a => a.startsWith('--' + name + '='));
    const value = raw ? Number(raw.split('=').slice(1).join('=')) : fallback;
    if (!Number.isSafeInteger(value)) throw new Error('invalid --' + name);
    return value;
  };
  const strOpt = (name: string, fallback: string) =>
    process.argv.find(a => a.startsWith('--' + name + '='))?.slice(name.length + 3) ?? fallback;
  const profile = strOpt('profile', 'kinotch-fixed');
  if (child) {
    const result = await runOne(numOpt('length', 1000), profile);
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    const lengths = strOpt('lengths', '1000,10000,50000,100000').split(',').map(Number);
    const result = runBoundedBaseline(lengths, profile, numOpt('timeout-ms', 15000), numOpt('heap-mb', 512));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
}

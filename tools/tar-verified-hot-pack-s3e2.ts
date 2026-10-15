/**
 * JO #349 S3-E2-P10a：固定受入Packの実セクションbytesを検証するNode側内部境界。
 * Pack/source/IR→VM emissionの認証済みproducerや利用者向けtoggleではない。
 */
import { createRequire } from 'node:module';
import type { BrowserPackManifestV1, BrowserPackSectionDescriptor } from './browser-pack-model.ts';

const { openBrowserPack } = createRequire(import.meta.url)('../runtime/browser-pack-runtime.js');

const REQUIRED_HOT_SECTIONS = Object.freeze([
  'symbol-registry', 'sequence-pool', 'rule-programs', 'rule-program-index',
  'rule-predicates', 'rule-lexeme-sets', 'rule-runtime-meta'
] as const);
const SHA256 = /^[0-9a-f]{64}$/u;
const reject = (detail: string): never => {
  throw new Error('TAR verified hot Pack: ' + detail);
};

export async function openVerifiedTarHotPack(input: {
  manifest: BrowserPackManifestV1;
  /** manifest自身から導出せず、独立に確定した受入記録から指定する。 */
  expectedPackDigest: string;
  sectionProvider: (section: BrowserPackSectionDescriptor) => Promise<ArrayBuffer | Uint8Array>;
}) {
  const { manifest, expectedPackDigest, sectionProvider } = input;
  if (!SHA256.test(expectedPackDigest) || manifest?.packDigest !== expectedPackDigest) {
    reject('independent Pack digest mismatch');
  }
  if (manifest.compilerVersion !== '3' ||
    !manifest.profiles.some(profile => profile.profileId === 'kinotch-fixed')) {
    reject('unsupported fixed TAR v3 profile');
  }
  const sectionIds = new Set<string>();
  for (const sectionId of REQUIRED_HOT_SECTIONS) {
    const matches = manifest.sections.filter(section =>
      section.sectionId === sectionId && section.kind === sectionId);
    if (matches.length !== 1 || matches[0]!.byteLength <= 0 ||
      sectionIds.has(sectionId)) reject('missing or ambiguous hot section: ' + sectionId);
    sectionIds.add(sectionId);
  }
  // 実運用と同じローダー：manifest全体hash、eager section hashを先に検証する。
  const pack = await openBrowserPack(manifest, sectionProvider);
  if (pack.packDigest !== expectedPackDigest) reject('opened Pack identity mismatch');
  // lazy / on-demandのhot sectionはここで明示取得し、byte length + SHA-256を照合する。
  for (const sectionId of REQUIRED_HOT_SECTIONS) {
    if (!pack.hasSection(sectionId)) reject('missing opened hot section: ' + sectionId);
    await pack.loadSection(sectionId);
  }
  return Object.freeze({
    kind: 'tar-verified-hot-pack-s3e2-p10a-readonly',
    pack,
    packDigest: expectedPackDigest,
    verifiedHotSectionIds: REQUIRED_HOT_SECTIONS,
    runtimeOriginAuthenticated: false as const
  });
}

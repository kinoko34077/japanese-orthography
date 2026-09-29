import { createHash } from 'node:crypto';
import type { JsonValue } from './model.ts';
import type { LoadedKinotchProfile } from './profile-model.ts';

export function canonicalizeProfileValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(canonicalizeProfileValue);
  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort((a, b) => a.localeCompare(b, 'en'))) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) result[key] = canonicalizeProfileValue(child);
    }
    return result;
  }
  throw new TypeError(`Unsupported profile JSON value: ${typeof value}`);
}

export function stableProfileSerialize(value: unknown): string {
  return JSON.stringify(canonicalizeProfileValue(value));
}

export function computeProfileSourceDigest(profile: LoadedKinotchProfile): string {
  const normalized = stableProfileSerialize({ manifest: profile.manifest, packs: profile.packs });
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

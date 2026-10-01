export interface ScriptFoldOptions {
  scriptFoldable: boolean;
}

export type KanaRenderScript = 'hiragana' | 'katakana';

export interface FullSizeSokuonOptions {
  sameHistoricalRepresentation: boolean;
}

export interface IterationBoundaryOptions {
  boundaryOffsets?: number[];
}

export interface PresentationCandidateGroup {
  canonical: string;
  attestations: string[];
}

const HIRAGANA_START = 0x3041;
const HIRAGANA_END = 0x3096;
const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const SCRIPT_OFFSET = 0x60;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function mapCodePoints(value: string, map: (character: string) => string): string {
  return [...value].map(map).join('');
}

function katakanaToHiragana(character: string): string {
  if (character === 'ヽ') return 'ゝ';
  if (character === 'ヾ') return 'ゞ';
  const codePoint = character.codePointAt(0);
  if (
    codePoint !== undefined &&
    codePoint >= KATAKANA_START &&
    codePoint <= KATAKANA_END
  ) {
    return String.fromCodePoint(codePoint - SCRIPT_OFFSET);
  }
  return character;
}

function hiraganaToKatakana(character: string): string {
  if (character === 'ゝ') return 'ヽ';
  if (character === 'ゞ') return 'ヾ';
  const codePoint = character.codePointAt(0);
  if (
    codePoint !== undefined &&
    codePoint >= HIRAGANA_START &&
    codePoint <= HIRAGANA_END
  ) {
    return String.fromCodePoint(codePoint + SCRIPT_OFFSET);
  }
  return character;
}

function isHiragana(character: string): boolean {
  return /\p{Script=Hiragana}/u.test(character);
}

function isKatakana(character: string): boolean {
  return /\p{Script=Katakana}/u.test(character);
}

function isHan(character: string): boolean {
  return /\p{Script=Han}/u.test(character);
}

function voiceKana(character: string): string {
  if (!isHiragana(character) && !isKatakana(character)) return character;
  const voiced = `${character.normalize('NFD')}\u3099`.normalize('NFC');
  return voiced;
}

function iterationMarkFor(character: string, voiced: boolean): string | null {
  if (isHiragana(character)) return voiced ? 'ゞ' : 'ゝ';
  if (isKatakana(character)) return voiced ? 'ヾ' : 'ヽ';
  return null;
}

function requirePrevious(expanded: string[], mark: string): string {
  const previous = expanded.at(-1);
  if (!previous) {
    throw new RangeError(`Iteration mark ${mark} cannot appear at render-unit start`);
  }
  return previous;
}

export function foldKanaScript(value: string, options: ScriptFoldOptions): string {
  if (!options.scriptFoldable) return value;
  return mapCodePoints(value, katakanaToHiragana);
}

export function renderKanaScript(
  value: string,
  target: KanaRenderScript
): string {
  if (target === 'hiragana') {
    return mapCodePoints(value, katakanaToHiragana);
  }
  return mapCodePoints(value, hiraganaToKatakana);
}

export function expandIterationMarks(
  value: string,
  options: IterationBoundaryOptions = {}
): string {
  const expanded: string[] = [];
  const boundaries = new Set(options.boundaryOffsets ?? []);
  let index = 0;

  for (const character of value) {
    const atBoundary = boundaries.has(index);
    if (character === 'ゝ' || character === 'ヽ') {
      if (atBoundary) {
        throw new RangeError(`Iteration mark ${character} cannot appear at render-unit start`);
      }
      expanded.push(requirePrevious(expanded, character));
      continue;
    }

    if (character === 'ゞ' || character === 'ヾ') {
      if (atBoundary) {
        throw new RangeError(`Iteration mark ${character} cannot appear at render-unit start`);
      }
      expanded.push(voiceKana(requirePrevious(expanded, character)));
      continue;
    }

    if (character === '々') {
      if (atBoundary) {
        throw new RangeError(`Iteration mark ${character} cannot appear at render-unit start`);
      }
      expanded.push(requirePrevious(expanded, character));
      continue;
    }

    if (character === '〳' || character === '〵') {
      throw new RangeError(
        'Span iteration marks require an explicit repeated span'
      );
    }

    expanded.push(character);
    index += 1;
  }

  return expanded.join('');
}

export function renderIterationMarks(
  value: string,
  options: IterationBoundaryOptions = {}
): string {
  const source = [...value];
  if (source.length < 2) return value;

  const rendered: string[] = [source[0]!];
  const boundaries = new Set(options.boundaryOffsets ?? []);

  for (let index = 1; index < source.length; index += 1) {
    const previous = source[index - 1]!;
    const current = source[index]!;
    if (boundaries.has(index)) {
      rendered.push(current);
      continue;
    }

    if (isHan(previous) && current === previous) {
      rendered.push('々');
      continue;
    }

    const unvoicedMark = iterationMarkFor(previous, false);
    if (unvoicedMark && current === previous) {
      rendered.push(unvoicedMark);
      continue;
    }

    const voicedMark = iterationMarkFor(previous, true);
    if (
      voicedMark &&
      voiceKana(previous) !== previous &&
      current === voiceKana(previous)
    ) {
      rendered.push(voicedMark);
      continue;
    }

    rendered.push(current);
  }

  return rendered.join('');
}

export function renderSpanIteration(value: string, repeatedSpan: string): string {
  if (repeatedSpan.length === 0) {
    throw new TypeError('Repeated span must not be empty');
  }

  const doubled = `${repeatedSpan}${repeatedSpan}`;
  if (!value.endsWith(doubled)) return value;

  const prefix = value.slice(0, value.length - doubled.length);
  return `${prefix}${repeatedSpan}〳〵`;
}

export function expandSpanIteration(value: string, repeatedSpan: string): string {
  if (repeatedSpan.length === 0) {
    throw new TypeError('Repeated span must not be empty');
  }
  if (value.startsWith('〳') || value.startsWith('〵')) {
    throw new RangeError('Span iteration mark cannot appear at render-unit start');
  }
  if (!value.endsWith('〳〵')) return value;

  const prefix = value.slice(0, -'〳〵'.length);
  if (!prefix.endsWith(repeatedSpan)) {
    throw new RangeError(
      'Span iteration mark does not follow the declared repeated span'
    );
  }
  return `${prefix}${repeatedSpan}`;
}

function presentationCanonical(
  value: string,
  options: ScriptFoldOptions
): string {
  const folded = foldKanaScript(value, options);
  try {
    return expandIterationMarks(folded);
  } catch (error) {
    if (
      error instanceof RangeError &&
      /Span iteration marks require/.test(error.message)
    ) {
      return folded;
    }
    throw error;
  }
}

export function collapsePresentationCandidates(
  candidates: string[],
  options: ScriptFoldOptions
): PresentationCandidateGroup[] {
  const groups = new Map<string, Set<string>>();

  for (const candidate of candidates) {
    const canonical = presentationCanonical(candidate, options);
    const attestations = groups.get(canonical) ?? new Set<string>();
    attestations.add(candidate);
    groups.set(canonical, attestations);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([canonical, attestations]) => ({
      canonical,
      attestations: [...attestations].sort(compareText)
    }));
}

export function applyFullSizeSokuonPreference(
  value: string,
  options: FullSizeSokuonOptions
): string {
  if (!options.sameHistoricalRepresentation) return value;
  return value.replaceAll('っ', 'つ').replaceAll('ッ', 'ツ');
}

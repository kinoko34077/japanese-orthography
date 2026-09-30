export type NativeKanaSourceRecordKind =
  | 'mapping'
  | 'alternative'
  | 'disabled'
  | 'identity'
  | 'explanatory';

export type NativeKanaStructureKind = 'rule' | 'example' | 'explanation';

export interface NativeKanaExtractedRecord {
  sourceRef: string;
  sourceLocator: string;
  sourceRecordKind: NativeKanaSourceRecordKind;
  rawText: string;
  enabled: boolean;
  modernSurface?: string;
  historicalSurface?: string;
  modernReading?: string;
  historicalReading?: string;
  alternatives?: string[];
  notes?: string;
  structureKind?: NativeKanaStructureKind;
}

export interface NativeKanaParserRemainder {
  sourceRecordId: string;
  kind: 'mapping' | 'other';
  detail?: string;
}

export interface NativeKanaParseResult {
  records: NativeKanaExtractedRecord[];
  discoveredRecordIds: string[];
  remainders: NativeKanaParserRemainder[];
}

function requireSourceId(sourceId: string): void {
  if (typeof sourceId !== 'string' || sourceId.trim() === '') {
    throw new TypeError('Native kana parser requires a non-empty source id');
  }
}

function finalize(records: NativeKanaExtractedRecord[], remainders: NativeKanaParserRemainder[]): NativeKanaParseResult {
  return { records, discoveredRecordIds: records.map(record => record.sourceLocator), remainders };
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function normalizeInlineText(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function htmlTextLines(html: string): string[] {
  const text = decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|tr|td|th|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  );
  return text.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function cellTextLines(html: string): string[] {
  const text = decodeHtmlEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
  return text.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export function parseKkhKanaJisyo(text: string, sourceId: string): NativeKanaParseResult {
  requireSourceId(sourceId);
  const records: NativeKanaExtractedRecord[] = [];
  const remainders: NativeKanaParserRemainder[] = [];

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();
    if (trimmed === '') continue;

    const disabled = trimmed.startsWith(';') && !trimmed.startsWith(';;');
    const candidate = disabled ? trimmed.slice(1).trimStart() : trimmed;
    const match = candidate.match(/^(.+?)\s+\/\s*([^;；\s].*?)(?:\s+[;；](.*))?$/u);

    if (match) {
      const modernSurface = match[1]!.trim();
      const historicalSurface = match[2]!.trim();
      if (modernSurface !== '' && historicalSurface !== '') {
        records.push({
          sourceRef: sourceId,
          sourceLocator: `line:${lineNumber}`,
          sourceRecordKind: disabled ? 'disabled' : 'mapping',
          rawText: rawLine,
          enabled: !disabled,
          modernSurface,
          historicalSurface,
          ...(match[3]?.trim() ? { notes: match[3].trim() } : {})
        });
        continue;
      }
    }

    if (!trimmed.startsWith(';;') && (candidate.includes('/') || candidate.includes('=>') || candidate.includes('→'))) {
      remainders.push({ sourceRecordId: `line:${lineNumber}`, kind: 'mapping', detail: rawLine });
    }
  }

  return finalize(records, remainders);
}

export function parseColonDictionaryHtml(html: string, sourceId: string): NativeKanaParseResult {
  requireSourceId(sourceId);
  const records: NativeKanaExtractedRecord[] = [];
  const lines = htmlTextLines(html).filter(line => /^[^：]{1,80}：\s*.+/u.test(line) && !line.includes('google_ad_client'));

  for (const [index, rawText] of lines.entries()) {
    const delimiter = rawText.indexOf('：');
    records.push({
      sourceRef: sourceId,
      sourceLocator: `entry:${index + 1}`,
      sourceRecordKind: 'mapping',
      rawText,
      enabled: true,
      modernSurface: rawText.slice(0, delimiter).trim(),
      historicalReading: rawText.slice(delimiter + 1).trim()
    });
  }

  return finalize(records, []);
}

export function parseExceptionVerbHtml(html: string, sourceId: string): NativeKanaParseResult {
  requireSourceId(sourceId);
  const records: NativeKanaExtractedRecord[] = [];
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].slice(2);
  const entryTexts: string[] = [];

  for (const row of rows) {
    const cells = row[1]!.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi);
    for (const cell of cells) entryTexts.push(...cellTextLines(cell[1]!));
  }

  entryTexts.forEach((rawText, index) => {
    records.push({
      sourceRef: sourceId,
      sourceLocator: `entry:${index + 1}`,
      sourceRecordKind: 'identity',
      rawText,
      enabled: true
    });
  });

  return finalize(records, []);
}

const GUIDE_RULE_HEADING = /^(?:A[１-９]|B[１-５]|C[１２])(?:\s|$)/u;

function guideStructureKind(text: string): NativeKanaStructureKind {
  if (GUIDE_RULE_HEADING.test(text)) return 'rule';
  if (text === '法則の解説 語の由来' || /(?:です|ます|ません|ください|参照)[。 ]?$/u.test(text)) return 'explanation';
  return 'example';
}

export function parseNativeGuideHtml(html: string, sourceId: string): NativeKanaParseResult {
  requireSourceId(sourceId);
  const paragraphTexts = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(match => cellTextLines(match[1]!).join(' / '))
    .filter(Boolean);

  const start = paragraphTexts.findIndex(text => text.startsWith('A１ '));
  const end = paragraphTexts.findIndex((text, index) => index > start && text === '以上和語について');
  if (start < 0 || end < 0 || end <= start) {
    return {
      records: [],
      discoveredRecordIds: [],
      remainders: [{ sourceRecordId: 'section:A1-C2', kind: 'mapping', detail: 'Native guide A1-C2 section boundary not found' }]
    };
  }

  const records = paragraphTexts.slice(start, end).map((rawText, index): NativeKanaExtractedRecord => ({
    sourceRef: sourceId,
    sourceLocator: `paragraph:${index + 1}`,
    sourceRecordKind: 'explanatory',
    rawText,
    enabled: true,
    structureKind: guideStructureKind(rawText)
  }));

  const firstMarker = html.indexOf('A１ 現代仮名遣い');
  const endMarker = html.indexOf('以上和語について', firstMarker + 1);
  const claimedHtml = firstMarker >= 0 && endMarker > firstMarker ? html.slice(firstMarker, endMarker) : '';
  const remainders = [...claimedHtml.matchAll(/<(table|ul|ol|dl)\b/gi)].map((match, index): NativeKanaParserRemainder => ({
    sourceRecordId: `structure:${match[1]!.toLowerCase()}:${index + 1}`,
    kind: 'mapping',
    detail: normalizeInlineText(match[0]!)
  }));

  return finalize(records, remainders);
}

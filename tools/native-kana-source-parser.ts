export type NativeKanaSourceRecordKind =
  | 'mapping'
  | 'alternative'
  | 'disabled'
  | 'identity'
  | 'explanatory';

export type NativeGuideKind = 'rule-heading' | 'example-or-explanation';

export interface NativeKanaExtractedRecord {
  sourceRef: string;
  sourceLocator: string;
  sourceRecordKind: NativeKanaSourceRecordKind;
  raw: string;
  enabled?: boolean;
  modernSurface?: string;
  historicalSurface?: string;
  modernReading?: string;
  historicalReading?: string;
  alternatives?: string[];
  note?: string;
  guideKind?: NativeGuideKind;
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

const KKH_MAPPING = /^\s*(;?)([^;\n]*?)\s+\/([^;\n]+?)(?:\s*;(.*))?$/;

function decodeHtmlText(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function stripHtml(value: string): string {
  return decodeHtmlText(value.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function result(records: NativeKanaExtractedRecord[], remainders: NativeKanaParserRemainder[]): NativeKanaParseResult {
  return {
    records,
    discoveredRecordIds: records.map(record => record.sourceLocator),
    remainders
  };
}

function splitFullwidthSourceNote(rawHistorical: string, asciiNote?: string): { historicalSurface: string; note?: string } {
  const [surface = '', ...fullwidthNote] = rawHistorical.split(/\s*；\s*/);
  const notes = [
    fullwidthNote.join('；').trim(),
    `${asciiNote ?? ''}`.trim()
  ].filter(Boolean);
  return {
    historicalSurface: surface.trim(),
    ...(notes.length > 0 ? { note: notes.join(' ; ') } : {})
  };
}

export function parseKkhKanaJisyo(text: string, sourceId: string): NativeKanaParseResult {
  const records: NativeKanaExtractedRecord[] = [];
  const remainders: NativeKanaParserRemainder[] = [];

  text.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    const sourceLocator = `kana-jisyo:L${lineNumber}`;
    const match = line.match(KKH_MAPPING);
    if (match) {
      const disabled = match[1] === ';';
      const parsedHistorical = splitFullwidthSourceNote(match[3]!, match[4]);
      records.push({
        sourceRef: sourceId,
        sourceLocator,
        sourceRecordKind: disabled ? 'disabled' : 'mapping',
        raw: line,
        enabled: !disabled,
        modernSurface: match[2]!.trim(),
        historicalSurface: parsedHistorical.historicalSurface,
        ...(parsedHistorical.note ? { note: parsedHistorical.note } : {})
      });
      return;
    }

    const doubleComment = /^\s*;;/.test(line);
    if (!doubleComment && (/=>|→/.test(line) || line.includes('/'))) {
      remainders.push({
        sourceRecordId: sourceLocator,
        kind: 'mapping',
        detail: line
      });
    }
  });

  return result(records, remainders);
}

function htmlLogicalLines(html: string): string[] {
  return decodeHtmlText(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function parseColonDictionaryHtml(html: string, sourceId: string): NativeKanaParseResult {
  const records: NativeKanaExtractedRecord[] = [];
  for (const line of htmlLogicalLines(html)) {
    const match = line.match(/^([^：]{1,80})：\s*(.+)$/);
    if (!match) continue;

    const ordinal = records.length + 1;
    records.push({
      sourceRef: sourceId,
      sourceLocator: `${sourceId}:entry:${String(ordinal).padStart(4, '0')}`,
      sourceRecordKind: 'mapping',
      raw: line,
      modernSurface: match[1]!.trim(),
      historicalReading: match[2]!.trim()
    });
  }
  return result(records, []);
}

function splitCellEntries(cellHtml: string): string[] {
  return decodeHtmlText(
    cellHtml
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function parseExceptionVerbHtml(html: string, sourceId: string): NativeKanaParseResult {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const records: NativeKanaExtractedRecord[] = [];

  for (const row of rows.slice(2)) {
    const cells = [...row[1]!.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)];
    for (const cell of cells) {
      for (const entry of splitCellEntries(cell[1]!)) {
        const ordinal = records.length + 1;
        const firstToken = entry.split(/\s+/)[0] ?? '';
        records.push({
          sourceRef: sourceId,
          sourceLocator: `${sourceId}:entry:${String(ordinal).padStart(4, '0')}`,
          sourceRecordKind: 'identity',
          raw: entry,
          ...(firstToken ? { historicalReading: firstToken } : {})
        });
      }
    }
  }

  return result(records, []);
}

function paragraphRecords(html: string): Array<{ ordinal: number; start: number; raw: string; text: string }> {
  return [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match, index) => ({
      ordinal: index + 1,
      start: match.index ?? 0,
      raw: match[0],
      text: stripHtml(match[1]!)
    }))
    .filter(record => record.text.length > 0);
}

export function parseNativeGuideHtml(html: string, sourceId: string): NativeKanaParseResult {
  const paragraphs = paragraphRecords(html);
  const startIndex = paragraphs.findIndex(record => /^A[１1](?:\s|$)/.test(record.text));
  const stopIndex = paragraphs.findIndex((record, index) => (
    index > startIndex && record.text.startsWith('以上和語について')
  ));

  if (startIndex < 0 || stopIndex < 0 || stopIndex <= startIndex) {
    return {
      records: [],
      discoveredRecordIds: [],
      remainders: [{
        sourceRecordId: `${sourceId}:native-guide-boundary`,
        kind: 'mapping',
        detail: 'Unable to locate accepted A1-C2 native-guide boundary'
      }]
    };
  }

  const records = paragraphs.slice(startIndex, stopIndex).map(record => {
    const ruleHeading = /^(?:A|B|C)[０-９0-9]+(?:\s|$)/.test(record.text);
    return {
      sourceRef: sourceId,
      sourceLocator: `${sourceId}:p${String(record.ordinal).padStart(4, '0')}`,
      sourceRecordKind: ruleHeading ? 'explanatory' as const : 'identity' as const,
      raw: record.text,
      guideKind: ruleHeading ? 'rule-heading' as const : 'example-or-explanation' as const
    };
  });

  const rawStart = paragraphs[startIndex]!.start;
  const rawStop = html.indexOf('以上和語について', paragraphs[stopIndex]!.start);
  const claimedRaw = rawStop > rawStart ? html.slice(rawStart, rawStop) : '';
  const remainders: NativeKanaParserRemainder[] = [];

  const unclaimedRaw = claimedRaw.replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, '');
  const unclaimedText = stripHtml(unclaimedRaw);
  if (/=>|→|⇒|⇔/.test(unclaimedText)) {
    remainders.push({
      sourceRecordId: `${sourceId}:unknown-structure:0001`,
      kind: 'mapping',
      detail: unclaimedText
    });
  }

  return result(records, remainders);
}

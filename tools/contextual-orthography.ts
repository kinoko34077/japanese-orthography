export const OFFICIAL_HOMOPHONE_DOMAIN_TAGS = [
  '法',
  '医',
  '化',
  '船',
  '鉱',
  '建',
  '物',
  '土',
  '動'
] as const;

export type OfficialHomophoneDomainTag = typeof OFFICIAL_HOMOPHONE_DOMAIN_TAGS[number];

export interface OfficialHomophoneDomainRow {
  rowNumber: number;
  oldSurfaceRaw: string;
  modernSurfaceRaw: string;
  historicalForms: string[];
  modernForms: string[];
  sourceDomainNote: string | null;
  domainTags: OfficialHomophoneDomainTag[];
  sourceLocator: string;
}

export interface DomainContextSignal {
  domains?: OfficialHomophoneDomainTag[];
}

export interface HomophoneDomainDecision {
  status: 'matched' | 'context_required' | 'context_miss' | 'no_domain_constraint' | 'not_found';
  authority: 'metadata_only';
  modernSurface: string;
  historicalCandidates: string[];
  matchedDomainTags: OfficialHomophoneDomainTag[];
  sourceDomainNotes: string[];
  sourceLocators: string[];
}

const DOMAIN_TAG_SET = new Set<string>(OFFICIAL_HOMOPHONE_DOMAIN_TAGS);

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText);
}

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === ',' && !quoted) {
      cells.push(cell);
      cell = '';
      continue;
    }
    cell += character;
  }

  if (quoted) throw new TypeError('Unterminated quoted CSV field');
  cells.push(cell);
  return cells;
}

function splitForms(value: string): string[] {
  return canonicalStrings(
    value
      .split('／')
      .map(part => part.trim())
      .filter(Boolean)
  );
}

function parseDomainTags(note: string): OfficialHomophoneDomainTag[] {
  if (note === '') return [];
  const tags = canonicalStrings(note.split('・').map(tag => tag.trim()).filter(Boolean));
  for (const tag of tags) {
    if (!DOMAIN_TAG_SET.has(tag)) {
      throw new TypeError(`Unknown official homophone domain tag: ${tag}`);
    }
  }
  return tags as OfficialHomophoneDomainTag[];
}

export function parseOfficialHomophoneDomainTable(
  text: string
): OfficialHomophoneDomainRow[] {
  const lines = text.replace(/^\uFEFF/u, '').split(/\r?\n/u).filter(line => line !== '');
  if (lines.length === 0) return [];

  const header = parseCsvRow(lines[0]!);
  const expected = ['No.', '種別', 'かな見出し', '旧表記', '書換表記', '備考', '後年扱い方メモ'];
  if (
    header.length !== expected.length ||
    header.some((value, index) => value !== expected[index])
  ) {
    throw new TypeError('Unexpected official homophone CSV header');
  }

  return lines.slice(1).map((line, index) => {
    const cells = parseCsvRow(line);
    if (cells.length !== expected.length) {
      throw new TypeError(`Unexpected official homophone CSV column count at row ${index + 2}`);
    }
    const rowNumber = Number(cells[0]);
    if (!Number.isInteger(rowNumber) || rowNumber <= 0) {
      throw new TypeError(`Invalid official homophone row number at CSV row ${index + 2}`);
    }

    const oldSurfaceRaw = cells[3]!.trim();
    const modernSurfaceRaw = cells[4]!.trim();
    const sourceDomainNote = cells[5]!.trim() || null;

    return {
      rowNumber,
      oldSurfaceRaw,
      modernSurfaceRaw,
      historicalForms: splitForms(oldSurfaceRaw),
      modernForms: splitForms(modernSurfaceRaw),
      sourceDomainNote,
      domainTags: parseDomainTags(sourceDomainNote ?? ''),
      sourceLocator: `official-homophone:row:${rowNumber}`
    };
  });
}

export function resolveHomophoneDomainContext(
  rows: OfficialHomophoneDomainRow[],
  modernSurface: string,
  signal: DomainContextSignal = {}
): HomophoneDomainDecision {
  const matching = rows.filter(row => row.modernForms.includes(modernSurface));
  const domainQualified = matching.filter(row => row.domainTags.length > 0);
  const domains = canonicalStrings(signal.domains ?? []) as OfficialHomophoneDomainTag[];

  const base = {
    authority: 'metadata_only' as const,
    modernSurface,
    sourceDomainNotes: canonicalStrings(
      domainQualified
        .map(row => row.sourceDomainNote)
        .filter((value): value is string => value !== null)
    ),
    sourceLocators: canonicalStrings(domainQualified.map(row => row.sourceLocator))
  };

  if (matching.length === 0) {
    return {
      status: 'not_found',
      ...base,
      historicalCandidates: [],
      matchedDomainTags: []
    };
  }

  if (domainQualified.length === 0) {
    return {
      status: 'no_domain_constraint',
      ...base,
      historicalCandidates: [],
      matchedDomainTags: []
    };
  }

  if (domains.length === 0) {
    return {
      status: 'context_required',
      ...base,
      historicalCandidates: [],
      matchedDomainTags: []
    };
  }

  const matchedRows = domainQualified.filter(row =>
    row.domainTags.some(tag => domains.includes(tag))
  );
  if (matchedRows.length === 0) {
    return {
      status: 'context_miss',
      ...base,
      historicalCandidates: [],
      matchedDomainTags: []
    };
  }

  return {
    status: 'matched',
    ...base,
    historicalCandidates: canonicalStrings(matchedRows.flatMap(row => row.historicalForms)),
    matchedDomainTags: canonicalStrings(
      matchedRows.flatMap(row => row.domainTags.filter(tag => domains.includes(tag)))
    ) as OfficialHomophoneDomainTag[],
    sourceDomainNotes: canonicalStrings(
      matchedRows
        .map(row => row.sourceDomainNote)
        .filter((value): value is string => value !== null)
    ),
    sourceLocators: canonicalStrings(matchedRows.map(row => row.sourceLocator))
  };
}

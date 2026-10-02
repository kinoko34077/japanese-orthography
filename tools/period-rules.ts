import { createHash } from 'node:crypto';
import type { IjidokunRecord } from './ijidokun-intake.ts';
import type { IRRule } from './rule-ir.ts';

// #208 §5 / #211 H — period-aware 異字同訓 records as Rule IR.
//
// Every (record, written form) becomes one contextual candidate-selection rule:
//
//   input     the reading of the form (from the record's reading family, aligned by okurigana)
//   output    the written form — always a candidate branch: the source distinguishes forms by sense,
//             so without sense evidence nothing is selected
//   predicate { period, sense }   period = the source version; sense = that version's condition
//   evidence  the record id (period-scoped), the human-readable type `ijidokun/<period>/<disposition>`
//
// Records of different versions are different rules: choosing a period selects rules, it never
// deletes another period's rules. A form whose reading cannot be aligned unambiguously is reported,
// not guessed.

const okurigana = (form: string) => /[ぁ-ゖ]*$/u.exec(form)![0];
const commonSuffix = (a: string, b: string) => { let n = 0; while (n < Math.min(a.length, b.length) && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1; return n; };

/** The family member that reads this form, or null when the alignment is ambiguous. */
export function readingOf(form: string, family: string): string | null {
  const members = family.split('・');
  const kana = okurigana(form);
  const matches = members.filter((m) => commonSuffix(form, m) === kana.length && m.length > kana.length && (kana.length > 0 || !/[ぁ-ゖ]$/u.test(form)));
  if (kana.length === 0) {
    // no okurigana: a noun form; only a single-member family (or a single okurigana-less member) is safe
    const bare = members.filter((m) => members.length === 1 || !members.some((o) => o !== m && o.startsWith(m)));
    return members.length === 1 ? members[0]! : bare.length === 1 ? bare[0]! : null;
  }
  const longest = Math.max(0, ...matches.map((m) => commonSuffix(form, m)));
  const best = matches.filter((m) => commonSuffix(form, m) === longest);
  return best.length === 1 ? best[0]! : null;
}

export function periodRuleIR(records: readonly IjidokunRecord[]) {
  const rules: IRRule[] = [];
  const unaligned: Array<{ recordId: string; form: string }> = [];
  for (const r of records) {
    for (const form of r.forms) {
      const reading = readingOf(form, r.readingFamily);
      if (!reading) { unaligned.push({ recordId: r.recordId, form }); continue; }
      const predicate = { period: r.period, ...(r.sense ? { sense: r.sense } : {}) };
      rules.push({
        ruleId: `ir:ijidokun:${r.period}:${createHash('sha256').update(JSON.stringify([r.recordId, form])).digest('hex').slice(0, 16)}`,
        kind: 'contextual', stage: 'semantic', direction: 'reconstruct', channel: 'reading', scope: 'exact-reading',
        input: reading, branches: [{ output: form, candidate: true, canonicalId: r.recordId }],
        lexicalScope: [], predicate, origin: 'historically_attested', enabledBy: null, dependsOn: [],
        canonicalIds: [r.recordId], evidenceType: `ijidokun/${r.period}/${r.dispositions.join('+')}`
      });
    }
  }
  return { rules, unaligned };
}

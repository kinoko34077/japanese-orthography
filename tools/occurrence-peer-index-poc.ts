/**
 * JO #347 S4-P4: 全候補の再走査をせず、同一区間の確定候補の有無を照合する純粋PoC。
 * production arbitrate() は変更しない。実測を経ない限り採用判定をしない。
 */
export interface PeerSpan {
  start: number;
  end: number;
  candidate?: boolean;
}
const spanKey = (start: number, end: number) => JSON.stringify([start,end]);

/** candidate===true の項目だけ、同一 [start,end) に非candidate peerがある場合にマーク。 */
export function deterministicPeerShadowMask<T extends PeerSpan>(
  live: readonly T[]
): boolean[] {
  const deterministic = new Set<string>();
  for (const row of live) {
    if (!Number.isSafeInteger(row.start) || !Number.isSafeInteger(row.end)
      || row.start < 0 || row.end <= row.start) {
      throw new Error('JO #347: invalid span in peer index');
    }
    if (row.candidate !== true) deterministic.add(spanKey(row.start,row.end));
  }
  return live.map(row => row.candidate === true
    && deterministic.has(spanKey(row.start,row.end)));
}

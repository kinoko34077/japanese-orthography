/**
 * #313 S0: 規則制御の独立実験。production Worker/Program VMには未接続。
 * ルール由来の論理IDを設定に使い、ビルドごとに変化するProgramIdを永続化しない。
 */
export interface ToggleNode {
  id: string;
  kind: 'bundle' | 'group';
  parentId?: string;
  enabledByDefault: boolean;
}
export interface ToggleRule {
  logicalRuleId: string;
  nodeId: string;
  programId: number;
  sourceCaseId: string;
  enabledByDefault: boolean;
  /** source側で明示的に無効固定された規則。利用者のtrueでも解除できない。 */
  sourceLockedOff?: boolean;
  /** canonical/profile側の許可。設定から権限拡張できない。 */
  allowedProfiles: readonly string[];
  stageOrder: number;
  priority: number;
  sourceOrder: number;
}
export interface ToggleSettings {
  globalEnabled?: boolean;
  nodes?: Readonly<Record<string, boolean | null>>;
  rules?: Readonly<Record<string, boolean | null>>;
}
export interface ToggleCandidate { logicalRuleId: string; occurrenceId: string }
export interface ToggleSelection { logicalRuleId: string; occurrenceId: string; programId: number }

const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0;
const safeNumber = (n: number) => Number.isFinite(n) && Number.isSafeInteger(n);

export function createToggleOverlay(
  nodes: readonly ToggleNode[],
  rules: readonly ToggleRule[],
  initial: ToggleSettings = {}
) {
  const nodeMap = new Map<string, ToggleNode>();
  for (const node of nodes) {
    if (!validId(node.id) || nodeMap.has(node.id)
      || (node.kind !== 'bundle' && node.kind !== 'group')
      || typeof node.enabledByDefault !== 'boolean') throw new Error('invalid or duplicate toggle node');
    nodeMap.set(node.id, { ...node });
  }
  for (const node of nodes) {
    if (node.parentId !== undefined && (!nodeMap.has(node.parentId) || node.parentId === node.id)) {
      throw new Error('missing or self-parented toggle node');
    }
    const seen = new Set<string>();
    let current: ToggleNode | undefined = node;
    while (current) {
      if (seen.has(current.id)) throw new Error('toggle node cycle');
      seen.add(current.id);
      current = current.parentId === undefined ? undefined : nodeMap.get(current.parentId);
    }
  }
  const ruleMap = new Map<string, ToggleRule>();
  for (const rule of rules) {
    if (!validId(rule.logicalRuleId) || !validId(rule.sourceCaseId)
      || ruleMap.has(rule.logicalRuleId) || !nodeMap.has(rule.nodeId)
      || !safeNumber(rule.programId) || rule.programId < 0
      || !safeNumber(rule.stageOrder) || !safeNumber(rule.sourceOrder)
      || !Number.isFinite(rule.priority)
      || typeof rule.enabledByDefault !== 'boolean'
      || !Array.isArray(rule.allowedProfiles)) throw new Error('invalid or duplicate toggle rule');
    ruleMap.set(rule.logicalRuleId, { ...rule, allowedProfiles: [...rule.allowedProfiles] });
  }
  const readPatch = (base: ToggleSettings, patch: ToggleSettings) => {
    if (patch.globalEnabled !== undefined && typeof patch.globalEnabled !== 'boolean') throw new Error('invalid globalEnabled');
    const merge = (kind: 'nodes' | 'rules', known: ReadonlyMap<string, unknown>) => {
      const out: Record<string, boolean> = { ...(base[kind] as Record<string, boolean> | undefined) };
      for (const [id, value] of Object.entries(patch[kind] ?? {})) {
        if (!known.has(id) || (value !== null && typeof value !== 'boolean')) throw new Error('unknown toggle or invalid override: ' + id);
        if (value === null) delete out[id];
        else out[id] = value;
      }
      return out;
    };
    return {
      globalEnabled: patch.globalEnabled ?? base.globalEnabled ?? true,
      nodes: merge('nodes', nodeMap),
      rules: merge('rules', ruleMap)
    };
  };
  const initialSettings = readPatch({}, initial);
  const make = (settings: ReturnType<typeof readPatch>, revision: number) => {
    const enabled = (rule: ToggleRule, profileId: string): boolean => {
      if (!settings.globalEnabled || rule.sourceLockedOff
        || !rule.allowedProfiles.includes(profileId)
        || !(settings.rules[rule.logicalRuleId] ?? rule.enabledByDefault)) return false;
      let node: ToggleNode | undefined = nodeMap.get(rule.nodeId);
      while (node) {
        if (!(settings.nodes[node.id] ?? node.enabledByDefault)) return false;
        node = node.parentId === undefined ? undefined : nodeMap.get(node.parentId);
      }
      return true;
    };
    return Object.freeze({
      revision,
      enabled: (logicalRuleId: string, profileId: string) => {
        const rule = ruleMap.get(logicalRuleId);
        if (!rule) throw new Error('unknown logical Rule ID: ' + logicalRuleId);
        return enabled(rule, profileId);
      },
      /** 候補列挙後にmaskを評価する。OFF規則を競合選択前に落とし、下位候補を再選択可能にする。 */
      select: (candidates: readonly ToggleCandidate[], profileId: string): ToggleSelection[] => {
        const selected = candidates.flatMap((c) => {
          const rule = ruleMap.get(c.logicalRuleId);
          if (!rule) throw new Error('unknown logical Rule ID: ' + c.logicalRuleId);
          return enabled(rule, profileId) ? [{ logicalRuleId: rule.logicalRuleId, occurrenceId: c.occurrenceId, programId: rule.programId, rule }] : [];
        });
        selected.sort((a, b) => a.rule.stageOrder - b.rule.stageOrder
          || b.rule.priority - a.rule.priority
          || a.rule.sourceOrder - b.rule.sourceOrder
          || a.logicalRuleId.localeCompare(b.logicalRuleId));
        return selected.map(({ logicalRuleId, occurrenceId, programId }) => ({ logicalRuleId, occurrenceId, programId }));
      },
      /** 生成物fingerprintとprofileに設定revisionを結合し、旧text/plan/token cacheの再利用を防ぐ。 */
      cacheKey: (artifactDigest: string, profileId: string) => JSON.stringify([artifactDigest, profileId, revision]),
      withSettings: (patch: ToggleSettings) => make(readPatch(settings, patch), revision + 1)
    });
  };
  return make(initialSettings, 0);
}

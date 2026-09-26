import { fieldLabel } from './domain';
import type {
  ChangeEntry,
  ChangeKind,
  FinanceScenario,
  HistoryMap,
  ScenarioField,
  ScenarioHistory,
  ScenarioSnapshot,
  SnapshotField,
} from './types';

/** 每个情景最多保留的流水条数，超过后从最旧的开始裁剪。 */
export const HISTORY_LIMIT = 200;

export function toSnapshot(scenario: FinanceScenario): ScenarioSnapshot {
  return {
    name: scenario.name,
    principal: scenario.principal,
    recurring: scenario.recurring,
    years: scenario.years,
    annualRate: scenario.annualRate,
    inflationRate: scenario.inflationRate,
    feeRate: scenario.feeRate,
  };
}

/** 老数据 / 新情景第一次进入系统时的起始流水，回放时间轴的起点。 */
export function baselineEntry(scenario: FinanceScenario, at: number, reason = '开始记录时的参数'): ChangeEntry {
  return { seq: 1, at, kind: 'init', reason, snapshot: toSnapshot(scenario) };
}

export function emptyHistory(entry: ChangeEntry): ScenarioHistory {
  return { dropped: 0, entries: [entry] };
}

export function ensureHistory(histories: HistoryMap, scenario: FinanceScenario, at: number, reason?: string): HistoryMap {
  if (histories[scenario.id]) return histories;
  return { ...histories, [scenario.id]: emptyHistory(baselineEntry(scenario, at, reason)) };
}

interface AppendOptions {
  kind: ChangeKind;
  at: number;
  field?: SnapshotField;
  before?: string | number;
  after?: string | number;
  reason?: string;
  limit?: number;
}

/**
 * 追加一条带时间的全量快照记录；超过上限时从最旧裁剪。
 * 裁剪只移除条目并累加 dropped，剩余条目自身仍是完整快照，回放不会错位。
 */
export function appendEntry(history: ScenarioHistory, scenario: FinanceScenario, options: AppendOptions): ScenarioHistory {
  const lastSeq = history.entries[history.entries.length - 1]?.seq ?? 0;
  const entry: ChangeEntry = {
    seq: lastSeq + 1,
    at: options.at,
    kind: options.kind,
    snapshot: toSnapshot(scenario),
    ...(options.field !== undefined ? { field: options.field } : {}),
    ...(options.before !== undefined ? { before: options.before } : {}),
    ...(options.after !== undefined ? { after: options.after } : {}),
    ...(options.reason !== undefined ? { reason: options.reason } : {}),
  };
  const limit = options.limit ?? HISTORY_LIMIT;
  const entries = [...history.entries, entry];
  const overflow = entries.length - limit;
  if (overflow <= 0) return { ...history, entries };
  return { dropped: history.dropped + overflow, entries: entries.slice(overflow) };
}

/** 主动清空：以当前参数重新立一条基线，时间轴始终可从头回放。 */
export function clearHistory(history: ScenarioHistory, scenario: FinanceScenario, at: number): ScenarioHistory {
  const seq = history.entries[history.entries.length - 1]?.seq ?? 0;
  return {
    dropped: 0,
    entries: [{ seq: seq + 1, at, kind: 'clear', reason: '流水已清空，以当前参数重新开始', snapshot: toSnapshot(scenario) }],
  };
}

/** 回放：还原到某条记录写入之后的参数状态。seq 找不到时回退到最旧一条。 */
export function snapshotAt(history: ScenarioHistory, seq: number): ScenarioSnapshot {
  const entries = history.entries;
  const exact = entries.find((entry) => entry.seq === seq);
  return (exact ?? entries[0]).snapshot;
}

export function replayScenario(scenario: FinanceScenario, snapshot: ScenarioSnapshot): FinanceScenario {
  return { ...scenario, ...snapshot };
}

/** 删除情景时同步丢弃它的流水，避免历史数据越积越多。 */
export function pruneHistories(histories: HistoryMap, scenarios: FinanceScenario[]): HistoryMap {
  const ids = new Set(scenarios.map((scenario) => scenario.id));
  const next: HistoryMap = {};
  Object.keys(histories).forEach((id) => {
    if (ids.has(id)) next[id] = histories[id];
  });
  return next;
}

/** 载入后兜底：修正损坏/缺失，保证每个情景都至少有一条起始记录。 */
export function repairHistories(histories: HistoryMap | undefined, scenarios: FinanceScenario[], at: number): HistoryMap {
  const source = histories ?? {};
  return scenarios.reduce<HistoryMap>((acc, scenario) => {
    const history = source[scenario.id];
    acc[scenario.id] = history && history.entries.length > 0
      ? { dropped: Number.isFinite(history.dropped) ? history.dropped : 0, entries: history.entries }
      : emptyHistory(baselineEntry(scenario, at));
    return acc;
  }, {});
}

export function isNumericField(field: SnapshotField): field is ScenarioField {
  return field !== 'name';
}

/** 流水条目的人类可读描述，方便向同事解释某版结论是怎么来的。 */
export function describeEntry(entry: ChangeEntry): string {
  switch (entry.kind) {
    case 'init':
      return entry.reason ?? '开始记录';
    case 'create':
      return '新增情景';
    case 'duplicate':
      return '复制情景';
    case 'clear':
      return entry.reason ?? '清空流水';
    case 'rename':
      return `名称：${entry.before ?? '（空）'} → ${entry.after ?? '（空）'}`;
    case 'update':
      if (entry.field && isNumericField(entry.field)) {
        return `${fieldLabel(entry.field)}：${entry.before ?? '—'} → ${entry.after ?? '—'}`;
      }
      return '参数已更新';
  }
}

export function formatEntryTime(at: number): string {
  return new Date(at).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

import { COLORS, fieldLabel, formatMoney } from './domain';
import type {
  ChangeField,
  ChangeLogEntry,
  FinanceScenario,
  PersistedHistory,
  ScenarioField,
  ScenarioHistory,
  ScenarioHistoryMap,
} from './types';

/** 每个情景最多保留的流水条数，超出后从最旧开始裁剪并并入基线 */
export const MAX_HISTORY_ENTRIES = 100;
/** 对同一项的连续快速修改（如打字）在该时间窗内合并为一条记录 */
export const COALESCE_WINDOW_MS = 1200;

export const SCENARIO_FIELDS: ScenarioField[] = ['principal', 'recurring', 'years', 'annualRate', 'inflationRate', 'feeRate'];
const CHANGE_FIELDS: ChangeField[] = [...SCENARIO_FIELDS, 'name'];

export function createHistory(scenario: FinanceScenario, now: number): ScenarioHistory {
  return { scenarioId: scenario.id, base: { ...scenario }, baseTimestamp: now, trimmedCount: 0, entries: [] };
}

function applyEntry(state: FinanceScenario, entry: ChangeLogEntry): void {
  if (entry.field === 'name') state.name = String(entry.after);
  else state[entry.field] = Number(entry.after);
}

/** 还原某个历史位置的完整参数：position 0 为基线，k 为应用前 k 条记录之后的状态 */
export function scenarioAtPosition(history: ScenarioHistory, position: number): FinanceScenario {
  const state = { ...history.base };
  const clamped = Math.max(0, Math.min(position, history.entries.length));
  for (let index = 0; index < clamped; index += 1) applyEntry(state, history.entries[index]);
  return state;
}

export function appendChange(history: ScenarioHistory, entry: ChangeLogEntry): ScenarioHistory {
  const last = history.entries[history.entries.length - 1];
  if (last && last.field === entry.field && entry.timestamp - last.timestamp <= COALESCE_WINDOW_MS) {
    const merged: ChangeLogEntry = { ...last, after: entry.after, timestamp: entry.timestamp };
    return trim({ ...history, entries: [...history.entries.slice(0, -1), merged] });
  }
  return trim({ ...history, entries: [...history.entries, entry] });
}

/** 超过上限时从最旧开始裁剪；被裁记录先并入基线快照，保证剩余记录的回放结果不变 */
function trim(history: ScenarioHistory): ScenarioHistory {
  const overflow = history.entries.length - MAX_HISTORY_ENTRIES;
  if (overflow <= 0) return history;
  const dropped = history.entries.slice(0, overflow);
  const base = { ...history.base };
  dropped.forEach((entry) => applyEntry(base, entry));
  return {
    ...history,
    base,
    baseTimestamp: dropped[dropped.length - 1].timestamp,
    trimmedCount: history.trimmedCount + overflow,
    entries: history.entries.slice(overflow),
  };
}

function sameScenarioState(a: FinanceScenario, b: FinanceScenario): boolean {
  return a.name === b.name && SCENARIO_FIELDS.every((field) => Object.is(a[field], b[field]));
}

/**
 * 载入时把持久化流水与当前情景对齐：
 * 老数据没有流水、或流水重放到最新与当前参数对不上（如未保存就刷新）时，
 * 从当前参数重新开记，保证回放永远不会错乱。
 */
export function reconcileHistories(scenarios: FinanceScenario[], saved: ScenarioHistoryMap | null, now: number): ScenarioHistoryMap {
  const map: ScenarioHistoryMap = {};
  scenarios.forEach((scenario) => {
    const history = saved?.[scenario.id];
    if (history && sameScenarioState(scenarioAtPosition(history, history.entries.length), scenario)) {
      map[scenario.id] = history;
    } else {
      map[scenario.id] = createHistory(scenario, now);
    }
  });
  return map;
}

export function changeFieldLabel(field: ChangeField): string {
  return field === 'name' ? '情景名称' : fieldLabel(field);
}

export function formatChangeValue(field: ChangeField, value: number | string): string {
  if (field === 'name') return `「${String(value)}」`;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '（空）';
  if (field === 'years') return `${numeric} 年`;
  if (field === 'annualRate' || field === 'inflationRate' || field === 'feeRate') return `${numeric}%`;
  return `¥ ${formatMoney(numeric)}`;
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/* ---------- 持久化反序列化（JSON 中 NaN 会变成 null，这里复原） ---------- */

function reviveNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number.NaN;
}

function reviveScenario(value: unknown): FinanceScenario | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
  return {
    id: raw.id,
    name: raw.name,
    color: typeof raw.color === 'string' ? raw.color : COLORS[0],
    principal: reviveNumber(raw.principal),
    recurring: reviveNumber(raw.recurring),
    years: reviveNumber(raw.years),
    annualRate: reviveNumber(raw.annualRate),
    inflationRate: reviveNumber(raw.inflationRate),
    feeRate: reviveNumber(raw.feeRate),
  };
}

function reviveChangeValue(field: ChangeField, value: unknown): number | string {
  if (field === 'name') return typeof value === 'string' ? value : '';
  return reviveNumber(value);
}

function reviveEntry(value: unknown, fallbackScenarioId: string): ChangeLogEntry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.timestamp !== 'number') return null;
  if (typeof raw.field !== 'string' || !CHANGE_FIELDS.includes(raw.field as ChangeField)) return null;
  const field = raw.field as ChangeField;
  return {
    id: raw.id,
    scenarioId: typeof raw.scenarioId === 'string' ? raw.scenarioId : fallbackScenarioId,
    timestamp: raw.timestamp,
    field,
    before: reviveChangeValue(field, raw.before),
    after: reviveChangeValue(field, raw.after),
  };
}

function reviveScenarioHistory(value: unknown): ScenarioHistory | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<ScenarioHistory>;
  const base = reviveScenario(raw.base);
  if (!base || !Array.isArray(raw.entries) || typeof raw.baseTimestamp !== 'number') return null;
  const entries: ChangeLogEntry[] = [];
  for (const item of raw.entries) {
    const entry = reviveEntry(item, base.id);
    if (!entry) return null;
    entries.push(entry);
  }
  entries.sort((a, b) => a.timestamp - b.timestamp);
  return {
    scenarioId: base.id,
    base,
    baseTimestamp: raw.baseTimestamp,
    trimmedCount: typeof raw.trimmedCount === 'number' ? raw.trimmedCount : 0,
    entries,
  };
}

/** 解析本地持久化的流水；数据损坏时返回 null，调用方会从当前参数重新开记 */
export function revivePersistedHistory(value: unknown): PersistedHistory | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { version?: unknown; histories?: unknown };
  if (candidate.version !== 1 || !candidate.histories || typeof candidate.histories !== 'object') return null;
  const histories: ScenarioHistoryMap = {};
  for (const [id, raw] of Object.entries(candidate.histories as Record<string, unknown>)) {
    const history = reviveScenarioHistory(raw);
    if (history) histories[id] = history;
  }
  return { version: 1, histories };
}

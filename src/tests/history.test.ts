import { describe, expect, it } from 'vitest';
import { SAMPLE_SCENARIOS } from '../domain';
import {
  appendEntry,
  baselineEntry,
  clearHistory,
  describeEntry,
  emptyHistory,
  ensureHistory,
  pruneHistories,
  repairHistories,
  snapshotAt,
  toSnapshot,
} from '../history';

const scenario = SAMPLE_SCENARIOS[0];

describe('audit history', () => {
  it('appends full-snapshot entries with continuous seq numbers', () => {
    let history = emptyHistory(baselineEntry(scenario, 1000));
    history = appendEntry(history, { ...scenario, annualRate: 5 }, { kind: 'update', at: 2000, field: 'annualRate', before: 4.5, after: 5 });
    history = appendEntry(history, { ...scenario, annualRate: 5, years: 30 }, { kind: 'update', at: 3000, field: 'years', before: 20, after: 30 });

    expect(history.entries.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(history.entries[2].snapshot.annualRate).toBe(5);
    expect(history.entries[2].snapshot.years).toBe(30);
    // 较早的快照不被后续修改污染。
    expect(history.entries[1].snapshot.years).toBe(20);
  });

  it('trims the oldest entries beyond the limit while every retained entry stays replayable', () => {
    let history = emptyHistory(baselineEntry(scenario, 0));
    let current = scenario;
    for (let i = 1; i <= 25; i += 1) {
      current = { ...current, years: 20 + i };
      history = appendEntry(history, current, { kind: 'update', at: i * 1000, field: 'years', before: 20 + i - 1, after: 20 + i, limit: 10 });
    }
    expect(history.entries).toHaveLength(10);
    expect(history.dropped).toBe(16);
    expect(history.entries[0].seq).toBe(17);
    // 裁剪后保留区间内每个时点仍可凭单条快照完整还原（第 20 条是 i=19 时写入，years = 39）。
    expect(snapshotAt(history, 20).years).toBe(39);
  });

  it('seeking an unknown seq falls back to the oldest retained snapshot', () => {
    const history = emptyHistory(baselineEntry(scenario, 0));
    expect(snapshotAt(history, 999)).toEqual(toSnapshot(scenario));
  });

  it('clears history and restarts a single baseline from current parameters', () => {
    let history = emptyHistory(baselineEntry(scenario, 0));
    const changed = { ...scenario, years: 8 };
    history = appendEntry(history, changed, { kind: 'update', at: 1000, field: 'years', before: 20, after: 8 });
    const cleared = clearHistory(history, changed, 2000);
    expect(cleared.dropped).toBe(0);
    expect(cleared.entries).toHaveLength(1);
    expect(cleared.entries[0].seq).toBe(3);
    expect(cleared.entries[0].kind).toBe('clear');
    expect(cleared.entries[0].snapshot.years).toBe(8);
  });

  it('ensures, prunes and repairs histories by scenario id', () => {
    const a = scenario;
    const b = SAMPLE_SCENARIOS[1];
    let histories = ensureHistory({}, a, 100);
    histories = ensureHistory(histories, a, 200); // 已有流水时不重建
    expect(Object.keys(histories)).toHaveLength(1);
    histories = ensureHistory(histories, b, 300);
    expect(Object.keys(histories)).toHaveLength(2);
    expect(pruneHistories(histories, [a])[b.id]).toBeUndefined();

    const repaired = repairHistories({ [a.id]: { dropped: 0, entries: [] } }, [a, b], 500);
    expect(repaired[a.id].entries).toHaveLength(1);
    expect(repaired[b.id].entries[0].kind).toBe('init');
  });

  it('describes entries in readable Chinese for hand-off explanations', () => {
    expect(describeEntry(baselineEntry(scenario, 0))).toBe('开始记录时的参数');
    expect(describeEntry({ seq: 2, at: 0, kind: 'update', field: 'annualRate', before: 4.5, after: 6, snapshot: toSnapshot(scenario) })).toContain('年化收益');
    expect(describeEntry({ seq: 3, at: 0, kind: 'rename', before: '旧名', after: '新名', snapshot: toSnapshot(scenario) })).toBe('名称：旧名 → 新名');
  });
});

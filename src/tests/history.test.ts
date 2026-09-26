import { describe, expect, it } from 'vitest';
import { SAMPLE_SCENARIOS } from '../domain';
import {
  appendChange,
  COALESCE_WINDOW_MS,
  createHistory,
  MAX_HISTORY_ENTRIES,
  reconcileHistories,
  revivePersistedHistory,
  scenarioAtPosition,
} from '../history';
import type { ChangeLogEntry, ScenarioHistory } from '../types';

let seq = 0;
function entry(field: ChangeLogEntry['field'], before: number | string, after: number | string, timestamp: number): ChangeLogEntry {
  seq += 1;
  return { id: `e${seq}`, scenarioId: 'steady', timestamp, field, before, after };
}

function appendAll(history: ScenarioHistory, entries: ChangeLogEntry[]): ScenarioHistory {
  return entries.reduce((current, item) => appendChange(current, item), history);
}

describe('scenario history', () => {
  it('reconstructs the scenario at any recorded position', () => {
    const history = appendAll(createHistory(SAMPLE_SCENARIOS[0], 1000), [
      entry('years', 20, 25, 2_000),
      entry('name', '稳健积累', '稳健 plus', 5_000),
      entry('annualRate', 4.5, 5.5, 9_000),
    ]);
    expect(history.entries).toHaveLength(3);
    expect(scenarioAtPosition(history, 0)).toEqual(SAMPLE_SCENARIOS[0]);
    expect(scenarioAtPosition(history, 1).years).toBe(25);
    expect(scenarioAtPosition(history, 2).name).toBe('稳健 plus');
    expect(scenarioAtPosition(history, 3).annualRate).toBe(5.5);
    expect(scenarioAtPosition(history, 99).annualRate).toBe(5.5);
    expect(scenarioAtPosition(history, -3)).toEqual(SAMPLE_SCENARIOS[0]);
  });

  it('coalesces rapid edits of the same field into one entry', () => {
    let history = createHistory(SAMPLE_SCENARIOS[0], 1000);
    history = appendChange(history, entry('recurring', 1500, 1600, 2_000));
    history = appendChange(history, entry('recurring', 1600, 1700, 2_000 + COALESCE_WINDOW_MS - 1));
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0].before).toBe(1500);
    expect(history.entries[0].after).toBe(1700);
    // 停顿超过合并窗口后再改，另起一条
    history = appendChange(history, entry('recurring', 1700, 1800, 2_000 + COALESCE_WINDOW_MS * 2 + 1));
    expect(history.entries).toHaveLength(2);
    // 不同字段即使在窗口内也不合并
    history = appendChange(history, entry('years', 20, 30, 2_000 + COALESCE_WINDOW_MS * 2 + 2));
    expect(history.entries).toHaveLength(3);
  });

  it('trims the oldest entries into the base without corrupting replay', () => {
    let history = createHistory(SAMPLE_SCENARIOS[0], 0);
    const total = MAX_HISTORY_ENTRIES + 7;
    for (let index = 1; index <= total; index += 1) {
      history = appendChange(history, entry('years', index, index + 1, index * 100_000));
    }
    expect(history.entries).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(history.trimmedCount).toBe(7);
    expect(history.baseTimestamp).toBe(7 * 100_000);
    // 基线已并入被裁的 7 条：位置 0 就是第 7 条之后的状态
    expect(scenarioAtPosition(history, 0).years).toBe(8);
    // 最新位置的回放结果与从未裁剪完全一致
    expect(scenarioAtPosition(history, history.entries.length).years).toBe(total + 1);
    // 中间位置同样一致：位置 k 对应第 (7 + k) 条之后
    expect(scenarioAtPosition(history, 10).years).toBe(18);
  });

  it('survives a JSON round-trip with NaN values intact', () => {
    const history = appendChange(
      createHistory({ ...SAMPLE_SCENARIOS[0], principal: Number.NaN }, 1000),
      entry('principal', Number.NaN, 5000, 2_000),
    );
    const revived = revivePersistedHistory(JSON.parse(JSON.stringify({ version: 1, histories: { steady: history } })));
    expect(revived?.histories.steady.base.principal).toBeNaN();
    expect(revived?.histories.steady.entries[0].before).toBeNaN();
    expect(revived?.histories.steady.entries[0].after).toBe(5000);
    expect(scenarioAtPosition(revived!.histories.steady, 1).principal).toBe(5000);
  });

  it('rejects corrupted payloads so recording can restart cleanly', () => {
    expect(revivePersistedHistory(null)).toBeNull();
    expect(revivePersistedHistory('junk')).toBeNull();
    expect(revivePersistedHistory({ version: 2, histories: {} })).toBeNull();
    expect(revivePersistedHistory({ version: 1, histories: 'oops' })).toBeNull();
    const broken = revivePersistedHistory({ version: 1, histories: { steady: { base: null, entries: [] } } });
    expect(broken?.histories.steady).toBeUndefined();
  });

  it('reconciles saved histories against the loaded scenarios', () => {
    const history = appendChange(createHistory(SAMPLE_SCENARIOS[0], 1000), entry('years', 20, 30, 2_000));
    // 流水重放到最新与当前参数一致 → 保留
    const kept = reconcileHistories([{ ...SAMPLE_SCENARIOS[0], years: 30 }], { steady: history }, 5_000);
    expect(kept.steady.entries).toHaveLength(1);
    // 对不上（例如改完没保存就刷新）→ 从当前参数重新开记
    const reset = reconcileHistories([SAMPLE_SCENARIOS[0]], { steady: history }, 5_000);
    expect(reset.steady.entries).toHaveLength(0);
    expect(reset.steady.base).toEqual(SAMPLE_SCENARIOS[0]);
    // 老数据没有流水 → 正常开始记录
    const fresh = reconcileHistories([SAMPLE_SCENARIOS[0]], null, 5_000);
    expect(fresh.steady.entries).toHaveLength(0);
    expect(fresh.steady.baseTimestamp).toBe(5_000);
  });
});

import { describe, expect, it } from 'vitest';
import { SAMPLE_SCENARIOS } from '../domain';
import { historiesForTest, TestClock } from './testSupport';
import type { PersistedWorkspace } from '../types';
import { MoneyScenarioViewModel } from '../viewModel';
import type { ScenarioRepository } from '../repository';

class MemoryRepository implements ScenarioRepository {
  constructor(private value: PersistedWorkspace | null = null, private failSave = false) {}
  async load() { return this.value; }
  async save(workspace: PersistedWorkspace) { if (this.failSave) throw new Error('storage'); this.value = workspace; }
  peek() { return this.value; }
}

function v2(clock: TestClock, overrides: Partial<PersistedWorkspace> = {}): PersistedWorkspace {
  return {
    version: 2,
    scenarios: SAMPLE_SCENARIOS,
    selectedId: SAMPLE_SCENARIOS[0].id,
    histories: historiesForTest(SAMPLE_SCENARIOS, clock.now()),
    ...overrides,
  };
}

describe('MoneyScenarioViewModel', () => {
  it('initializes sample scenarios and updates projections', async () => {
    const vm = new MoneyScenarioViewModel(new MemoryRepository());
    await vm.init();
    expect(vm.getSnapshot().scenarios).toHaveLength(3);
    vm.updateField('steady', 'years', 30);
    expect(vm.getSnapshot().projections[0].points).toHaveLength(31);
  });

  it('restores saved state and surfaces invalid input', async () => {
    const clock = new TestClock(1000);
    const saved = v2(clock, { scenarios: [{ ...SAMPLE_SCENARIOS[0], years: 12 }] });
    const vm = new MoneyScenarioViewModel(new MemoryRepository(saved), clock.tick);
    await vm.init();
    expect(vm.getSnapshot().scenarios[0].years).toBe(12);
    vm.updateField('steady', 'years', 99);
    expect(vm.getSnapshot().errors.steady.years).toBeTruthy();
    expect(vm.getSnapshot().projections).toHaveLength(0);
  });

  it('handles persistence failure without losing the editing state', async () => {
    const vm = new MoneyScenarioViewModel(new MemoryRepository(null, true));
    await vm.init();
    await vm.save();
    expect(vm.getSnapshot().status).toBe('error');
    expect(vm.getSnapshot().scenarios).toHaveLength(3);
  });

  it('appends an audit entry with before/after values for every parameter change', async () => {
    const clock = new TestClock(10_000);
    const vm = new MoneyScenarioViewModel(new MemoryRepository(v2(clock)), clock.tick);
    await vm.init();
    vm.updateField('steady', 'annualRate', 5.5);
    const history = vm.getSnapshot().histories.steady;
    expect(history.entries).toHaveLength(2);
    expect(history.entries[1]).toMatchObject({ kind: 'update', field: 'annualRate', before: 4.5, after: 5.5 });
    vm.renameScenario('steady', '改名后');
    const renameEntry = vm.getSnapshot().histories.steady.entries;
    expect(renameEntry[renameEntry.length - 1]).toMatchObject({ kind: 'rename', before: '稳健积累', after: '改名后' });
  });

  it('does not log transient NaN edits or unchanged values', async () => {
    const clock = new TestClock(10_000);
    const vm = new MoneyScenarioViewModel(new MemoryRepository(v2(clock)), clock.tick);
    await vm.init();
    vm.updateField('steady', 'annualRate', Number.NaN);
    vm.updateField('steady', 'annualRate', 4.5);
    expect(vm.getSnapshot().histories.steady.entries).toHaveLength(1);
  });

  it('replays any historical point with a recomputed final-value curve', async () => {
    const clock = new TestClock(10_000);
    const vm = new MoneyScenarioViewModel(new MemoryRepository(v2(clock)), clock.tick);
    await vm.init();
    vm.updateField('steady', 'years', 10);
    vm.updateField('steady', 'years', 25);
    const history = vm.getSnapshot().histories.steady;
    const secondSeq = history.entries[1].seq;

    vm.selectReplay('steady', secondSeq);
    const replay = vm.getReplay('steady');
    expect(replay?.scenario.years).toBe(10);
    expect(replay?.projection?.points).toHaveLength(11);
    // 当前版本不受回放影响，仍为 25 年。
    expect(vm.getSnapshot().projections.find((item) => item.scenarioId === 'steady')?.points).toHaveLength(26);
    vm.selectReplay('steady', null);
    expect(vm.getReplay('steady')).toBeNull();
  });

  it('keeps replay correct after oldest entries are trimmed', async () => {
    const clock = new TestClock(10_000);
    // 预置恰好保留到上限的 200 条记录（seq 51–250，声称更早的 50 条已裁剪），
    // 再追加一条时最旧一条被移除，但保留区间内回放仍必须精确。
    const scenario = { ...SAMPLE_SCENARIOS[0] };
    const entries = Array.from({ length: 200 }, (_, index) => {
      const seq = 51 + index;
      const years = 20 + index;
      return {
        seq,
        at: seq * 1000,
        kind: 'update' as const,
        field: 'years' as const,
        before: years - 1,
        after: years,
        snapshot: { name: '稳健积累', principal: 30000, recurring: 1500, years, annualRate: 4.5, inflationRate: 2, feeRate: 0.4 },
      };
    });
    const histories = { steady: { dropped: 50, entries } };
    const vm = new MoneyScenarioViewModel(new MemoryRepository(v2(clock, { scenarios: [scenario], histories })), clock.tick);
    await vm.init();
    vm.selectReplay('steady', 100);
    expect(vm.getReplay('steady')?.scenario.years).toBe(69);

    // 继续改动触发裁剪：最旧一条（seq 51）被移除，seq 52 起的回放依然准确。
    vm.updateField('steady', 'annualRate', 4.6);
    const updated = vm.getSnapshot().histories.steady;
    expect(updated.entries).toHaveLength(200);
    expect(updated.entries[0].seq).toBe(52);
    expect(updated.dropped).toBe(51);
    vm.selectReplay('steady', 52);
    expect(vm.getReplay('steady')?.scenario.years).toBe(21);
  });

  it('clears the audit log and restarts from current parameters', async () => {
    const clock = new TestClock(10_000);
    const vm = new MoneyScenarioViewModel(new MemoryRepository(v2(clock)), clock.tick);
    await vm.init();
    vm.updateField('steady', 'years', 15);
    vm.clearHistory('steady');
    const history = vm.getSnapshot().histories.steady;
    expect(history.dropped).toBe(0);
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]).toMatchObject({ kind: 'clear' });
    expect(history.entries[0].snapshot.years).toBe(15);
  });

  it('removes a scenario together with its history', async () => {
    const clock = new TestClock(10_000);
    const vm = new MoneyScenarioViewModel(new MemoryRepository(v2(clock)), clock.tick);
    await vm.init();
    vm.updateField('steady', 'years', 15);
    vm.removeScenario('steady');
    expect(vm.getSnapshot().histories.steady).toBeUndefined();
  });

  it('starts independent histories for duplicated scenarios', async () => {
    const clock = new TestClock(10_000);
    const vm = new MoneyScenarioViewModel(new MemoryRepository(v2(clock)), clock.tick);
    await vm.init();
    vm.duplicateScenario('steady');
    const newId = vm.getSnapshot().scenarios[3].id;
    expect(vm.getSnapshot().histories[newId].entries[0]).toMatchObject({ kind: 'duplicate' });
  });
});

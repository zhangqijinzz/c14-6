import { describe, expect, it } from 'vitest';
import { SAMPLE_SCENARIOS } from '../domain';
import { scenarioAtPosition } from '../history';
import type { PersistedHistory, PersistedWorkspace } from '../types';
import { MoneyScenarioViewModel } from '../viewModel';
import type { ScenarioRepository } from '../repository';

class MemoryRepository implements ScenarioRepository {
  history: PersistedHistory | null = null;
  constructor(private value: PersistedWorkspace | null = null, private failSave = false) {}
  async load() { return this.value; }
  async save(workspace: PersistedWorkspace) { if (this.failSave) throw new Error('storage'); this.value = workspace; }
  async loadHistory() { return this.history; }
  async saveHistory(history: PersistedHistory) { this.history = history; }
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
    const saved = { version: 1 as const, scenarios: [{ ...SAMPLE_SCENARIOS[0], years: 12 }], selectedId: 'steady' };
    const vm = new MoneyScenarioViewModel(new MemoryRepository(saved));
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

  it('records parameter changes with before/after and persists them', async () => {
    const repository = new MemoryRepository();
    const vm = new MoneyScenarioViewModel(repository);
    await vm.init();
    vm.updateField('steady', 'years', 30);
    const entries = vm.getSnapshot().histories.steady.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].field).toBe('years');
    expect(entries[0].before).toBe(20);
    expect(entries[0].after).toBe(30);
    expect(entries[0].timestamp).toBeGreaterThan(0);
    expect(repository.history?.histories.steady.entries).toHaveLength(1);
  });

  it('records renames and skips no-op changes', async () => {
    const vm = new MoneyScenarioViewModel(new MemoryRepository());
    await vm.init();
    vm.renameScenario('steady', '退休计划');
    vm.updateField('steady', 'years', 20);
    const entries = vm.getSnapshot().histories.steady.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].field).toBe('name');
    expect(entries[0].before).toBe('稳健积累');
    expect(entries[0].after).toBe('退休计划');
  });

  it('starts recording from scratch for legacy data without history', async () => {
    const legacy = { version: 1 as const, scenarios: [{ ...SAMPLE_SCENARIOS[0], years: 12 }], selectedId: 'steady' };
    const vm = new MoneyScenarioViewModel(new MemoryRepository(legacy));
    await vm.init();
    expect(vm.getSnapshot().histories.steady.entries).toHaveLength(0);
    vm.updateField('steady', 'annualRate', 6);
    const history = vm.getSnapshot().histories.steady;
    expect(history.entries).toHaveLength(1);
    expect(scenarioAtPosition(history, 0).annualRate).toBe(4.5);
    expect(scenarioAtPosition(history, 1).annualRate).toBe(6);
  });

  it('replays a historical point and restores the parameters of that moment', async () => {
    const vm = new MoneyScenarioViewModel(new MemoryRepository());
    await vm.init();
    vm.updateField('steady', 'years', 10);
    vm.updateField('steady', 'annualRate', 8);
    vm.openReplay('steady');
    vm.setReplayPosition(1);
    const history = vm.getSnapshot().histories.steady;
    const replayed = scenarioAtPosition(history, vm.getSnapshot().replay!.position);
    expect(replayed.years).toBe(10);
    expect(replayed.annualRate).toBe(4.5);
    vm.setReplayPosition(2);
    expect(scenarioAtPosition(history, 2).annualRate).toBe(8);
    vm.setReplayPosition(99);
    expect(vm.getSnapshot().replay!.position).toBe(2);
  });

  it('clears the history on demand and keeps recording afterwards', async () => {
    const repository = new MemoryRepository();
    const vm = new MoneyScenarioViewModel(repository);
    await vm.init();
    vm.updateField('steady', 'years', 10);
    vm.updateField('steady', 'annualRate', 8);
    vm.clearHistory('steady');
    expect(vm.getSnapshot().histories.steady.entries).toHaveLength(0);
    expect(vm.getSnapshot().replay).toEqual({ scenarioId: 'steady', position: 0 });
    vm.updateField('steady', 'recurring', 2000);
    expect(vm.getSnapshot().histories.steady.entries).toHaveLength(1);
    expect(repository.history?.histories.steady.entries).toHaveLength(1);
  });

  it('resets a saved history that no longer matches the saved scenario', async () => {
    const repository = new MemoryRepository({ version: 1, scenarios: [SAMPLE_SCENARIOS[0]], selectedId: 'steady' });
    repository.history = {
      version: 1,
      histories: {
        steady: {
          scenarioId: 'steady',
          base: { ...SAMPLE_SCENARIOS[0] },
          baseTimestamp: 1000,
          trimmedCount: 0,
          entries: [{ id: 'c1', scenarioId: 'steady', timestamp: 2000, field: 'years', before: 20, after: 99 }],
        },
      },
    };
    const vm = new MoneyScenarioViewModel(repository);
    await vm.init();
    expect(vm.getSnapshot().histories.steady.entries).toHaveLength(0);
    expect(vm.getSnapshot().histories.steady.base).toEqual(SAMPLE_SCENARIOS[0]);
  });

  it('keeps a saved history that still matches the saved scenario', async () => {
    const repository = new MemoryRepository({ version: 1, scenarios: [{ ...SAMPLE_SCENARIOS[0], years: 25 }], selectedId: 'steady' });
    repository.history = {
      version: 1,
      histories: {
        steady: {
          scenarioId: 'steady',
          base: { ...SAMPLE_SCENARIOS[0] },
          baseTimestamp: 1000,
          trimmedCount: 0,
          entries: [{ id: 'c1', scenarioId: 'steady', timestamp: 2000, field: 'years', before: 20, after: 25 }],
        },
      },
    };
    const vm = new MoneyScenarioViewModel(repository);
    await vm.init();
    expect(vm.getSnapshot().histories.steady.entries).toHaveLength(1);
    expect(vm.getSnapshot().replay).toEqual({ scenarioId: 'steady', position: 1 });
  });
});

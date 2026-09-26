import { baselineEntry, emptyHistory } from '../history';
import type { FinanceScenario, HistoryMap } from '../types';

/** 可控时钟：每次读取加 1 秒，保证流水时间戳唯一且有序。 */
export class TestClock {
  private value: number;

  constructor(start = 0) {
    this.value = start;
  }

  now(): number {
    return this.value;
  }

  tick = (): number => {
    this.value += 1000;
    return this.value;
  };
}

export function historiesForTest(scenarios: FinanceScenario[], at: number): HistoryMap {
  return scenarios.reduce<HistoryMap>((acc, scenario) => {
    acc[scenario.id] = emptyHistory(baselineEntry(scenario, at));
    return acc;
  }, {});
}

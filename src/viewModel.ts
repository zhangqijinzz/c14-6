import { calculateProjection, COLORS, SAMPLE_SCENARIOS, validateScenario } from './domain';
import {
  appendEntry,
  baselineEntry,
  clearHistory as resetHistory,
  emptyHistory,
  ensureHistory,
  pruneHistories,
  replayScenario,
  snapshotAt,
  toSnapshot,
} from './history';
import type { ScenarioRepository } from './repository';
import type {
  ChangeKind,
  FinanceScenario,
  HistoryMap,
  PersistedWorkspace,
  ScenarioField,
  ScenarioProjection,
  ValidationErrors,
} from './types';

export type ViewStatus = 'loading' | 'ready' | 'editing' | 'error' | 'completed';

export interface ReplayState {
  seq: number;
  scenario: FinanceScenario;
  projection: ScenarioProjection | null;
}

export interface MoneyScenarioState {
  status: ViewStatus;
  scenarios: FinanceScenario[];
  selectedId: string;
  errors: Record<string, ValidationErrors>;
  projections: ScenarioProjection[];
  histories: HistoryMap;
  /** 每个情景当前选中的回放时点（条目 seq）；未在回放则缺席。 */
  replaySeq: Record<string, number>;
  message: string;
}

type Listener = (state: MoneyScenarioState) => void;

const AUTOSAVE_DELAY = 400;

function initialState(): MoneyScenarioState {
  return {
    status: 'loading',
    scenarios: [],
    selectedId: '',
    errors: {},
    projections: [],
    histories: {},
    replaySeq: {},
    message: '正在恢复最近的情景…',
  };
}

function historiesFor(scenarios: FinanceScenario[], now: number): HistoryMap {
  return scenarios.reduce<HistoryMap>((acc, scenario) => {
    acc[scenario.id] = emptyHistory(baselineEntry(scenario, now));
    return acc;
  }, {});
}

export class MoneyScenarioViewModel {
  private state: MoneyScenarioState = initialState();
  private readonly listeners = new Set<Listener>();
  private initialized = false;
  private readonly repository: ScenarioRepository;
  private readonly clock: () => number;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(repository: ScenarioRepository, clock: () => number = Date.now) {
    this.repository = repository;
    this.clock = clock;
  }

  getSnapshot(): MoneyScenarioState { return this.state; }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const saved = await this.repository.load();
      if (saved) {
        this.commit(saved.scenarios, saved.selectedId, saved.histories, '已恢复上次工作状态（含变更流水）');
      } else {
        const scenarios = SAMPLE_SCENARIOS;
        this.commit(scenarios, scenarios[0].id, historiesFor(scenarios, this.clock()), '已载入示例情景，变更将自动记入流水');
      }
    } catch {
      const scenarios = SAMPLE_SCENARIOS;
      this.commit(scenarios, scenarios[0].id, historiesFor(scenarios, this.clock()), '本地数据读取失败，当前使用临时示例；仍可继续推演');
      this.setState({ status: 'error' });
    }
  }

  updateField(id: string, field: ScenarioField, value: number): void {
    const previous = this.state.scenarios.find((scenario) => scenario.id === id);
    // 数字框清空瞬间的 NaN 只是编辑中间态，不写入流水。
    if (!previous || Number.isNaN(value) || previous[field] === value) return;
    const scenarios = this.state.scenarios.map((scenario) => scenario.id === id ? { ...scenario, [field]: value } : scenario);
    const current = scenarios.find((scenario) => scenario.id === id)!;
    const histories = this.mutateHistory(id, current, { kind: 'update', field, before: previous[field], after: value });
    this.commit(scenarios, id, histories, '参数已更新，可在情景卡片中回放历史版本');
  }

  renameScenario(id: string, name: string): void {
    const trimmed = name.trim().slice(0, 18);
    const previous = this.state.scenarios.find((scenario) => scenario.id === id);
    if (!previous || !trimmed || previous.name === trimmed) return;
    const scenarios = this.state.scenarios.map((scenario) => scenario.id === id ? { ...scenario, name: trimmed } : scenario);
    const current = scenarios.find((scenario) => scenario.id === id)!;
    const histories = this.mutateHistory(id, current, { kind: 'rename', field: 'name', before: previous.name, after: trimmed });
    this.commit(scenarios, id, histories, '情景名称已更新');
  }

  addScenario(): void {
    if (this.state.scenarios.length >= 5) {
      this.setState({ message: '最多同时比较 5 个情景' });
      return;
    }
    const source = this.state.scenarios[this.state.scenarios.length - 1] ?? SAMPLE_SCENARIOS[0];
    const id = `scenario-${this.clock()}`;
    const scenario = { ...source, id, name: `情景 ${this.state.scenarios.length + 1}`, color: COLORS[this.state.scenarios.length % COLORS.length] };
    const scenarios = [...this.state.scenarios, scenario];
    const histories = this.recordNewScenario(this.state.histories, scenario, 'create');
    this.commit(scenarios, id, histories, '已新增情景，流水从当前参数开始记录');
  }

  duplicateScenario(id: string): void {
    if (this.state.scenarios.length >= 5) {
      this.setState({ message: '最多同时比较 5 个情景' });
      return;
    }
    const source = this.state.scenarios.find((scenario) => scenario.id === id);
    if (!source) return;
    const copy = { ...source, id: `scenario-${this.clock()}`, name: `${source.name} · 复制`, color: COLORS[this.state.scenarios.length % COLORS.length] };
    const scenarios = [...this.state.scenarios, copy];
    const histories = this.recordNewScenario(this.state.histories, copy, 'duplicate');
    this.commit(scenarios, copy.id, histories, '已复制情景，副本拥有独立的变更流水');
  }

  removeScenario(id: string): void {
    if (this.state.scenarios.length <= 1) return;
    const scenarios = this.state.scenarios.filter((scenario) => scenario.id !== id);
    const histories = pruneHistories(this.state.histories, scenarios);
    const replaySeq = { ...this.state.replaySeq };
    delete replaySeq[id];
    this.commit(scenarios, scenarios[0].id, histories, '情景及其变更流水已移除', replaySeq);
  }

  /** 主动清空某情景的流水：以当前参数重新立一条基线。 */
  clearHistory(id: string): void {
    const scenario = this.state.scenarios.find((item) => item.id === id);
    const history = this.state.histories[id];
    if (!scenario || !history) return;
    const histories = { ...this.state.histories, [id]: resetHistory(history, scenario, this.clock()) };
    this.commit(this.state.scenarios, this.state.selectedId, histories, '变更流水已清空，已从当前参数重新开始', { ...this.state.replaySeq, [id]: histories[id].entries[0].seq });
  }

  /** 把某情景拖到任意历史时点；seq 缺席表示退出回放。 */
  selectReplay(id: string, seq: number | null): void {
    const replaySeq = { ...this.state.replaySeq };
    if (seq === null) delete replaySeq[id];
    else replaySeq[id] = seq;
    this.setState({ replaySeq });
  }

  /** 根据流水还原该时点的参数并重新计算终值曲线，与当前版本并列对照。 */
  getReplay(id: string): ReplayState | null {
    const seq = this.state.replaySeq[id];
    const scenario = this.state.scenarios.find((item) => item.id === id);
    const history = this.state.histories[id];
    if (seq === undefined || !scenario || !history || history.entries.length === 0) return null;
    const restored = replayScenario(scenario, snapshotAt(history, seq));
    const projection = Object.keys(validateScenario(restored)).length === 0 ? calculateProjection(restored) : null;
    return { seq, scenario: restored, projection };
  }

  async save(): Promise<void> {
    if (Object.keys(this.state.errors).length > 0) {
      this.setState({ status: 'error', message: '请先修正标红参数，再保存比较' });
      return;
    }
    try {
      await this.repository.save(this.buildWorkspace());
      this.setState({ status: 'completed', message: '比较与变更流水已保存，本地刷新后仍可回放' });
    } catch {
      this.setState({ status: 'error', message: '保存失败，请检查浏览器本地存储权限' });
    }
  }

  private mutateHistory(id: string, current: FinanceScenario, detail: { kind: ChangeKind; field?: ScenarioField | 'name'; before?: string | number; after?: string | number }): HistoryMap {
    const histories = ensureHistory(this.state.histories, current, this.clock());
    return {
      ...histories,
      [id]: appendEntry(histories[id], current, { at: this.clock(), ...detail }),
    };
  }

  private recordNewScenario(histories: HistoryMap, scenario: FinanceScenario, kind: ChangeKind): HistoryMap {
    // 新情景的第一条记录就是完整快照，复制/新增之前的状态不存在，时间轴天然完整。
    return { ...histories, [scenario.id]: emptyHistory({ seq: 1, at: this.clock(), kind, snapshot: toSnapshot(scenario) }) };
  }

  private buildWorkspace(): PersistedWorkspace {
    return {
      version: 2,
      scenarios: this.state.scenarios,
      selectedId: this.state.selectedId,
      histories: pruneHistories(this.state.histories, this.state.scenarios),
    };
  }

  /** 参数合法时静默落盘，保证流水长期保存在本地；失败不打断编辑。 */
  private scheduleAutosave(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    const timer = setTimeout(() => {
      this.autosaveTimer = null;
      if (Object.keys(this.state.errors).length > 0 || !this.initialized) return;
      void this.repository.save(this.buildWorkspace()).catch(() => { /* 手动保存仍可兜底 */ });
    }, AUTOSAVE_DELAY);
    this.autosaveTimer = timer;
    // 测试环境下不阻止进程退出。
    (timer as { unref?: () => void }).unref?.();
  }

  private commit(scenarios: FinanceScenario[], selectedId: string, histories: HistoryMap, message: string, replaySeq?: Record<string, number>): void {
    const errors: Record<string, ValidationErrors> = {};
    const projections: ScenarioProjection[] = [];
    scenarios.forEach((scenario) => {
      const scenarioErrors = validateScenario(scenario);
      if (Object.keys(scenarioErrors).length) errors[scenario.id] = scenarioErrors;
      else projections.push(calculateProjection(scenario));
    });
    this.setState({
      scenarios,
      selectedId,
      errors,
      projections,
      histories,
      replaySeq: replaySeq ?? this.state.replaySeq,
      status: Object.keys(errors).length ? 'editing' : 'ready',
      message,
    });
    this.scheduleAutosave();
  }

  private setState(patch: Partial<MoneyScenarioState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener(this.state));
  }
}

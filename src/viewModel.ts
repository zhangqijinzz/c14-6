import { calculateProjection, COLORS, SAMPLE_SCENARIOS, validateScenario } from './domain';
import { appendChange, createHistory, reconcileHistories } from './history';
import type { ScenarioRepository } from './repository';
import type { ChangeField, ChangeLogEntry, FinanceScenario, PersistedWorkspace, ReplayTarget, ScenarioField, ScenarioHistoryMap, ScenarioProjection, ValidationErrors } from './types';

export type ViewStatus = 'loading' | 'ready' | 'editing' | 'error' | 'completed';

export interface MoneyScenarioState {
  status: ViewStatus;
  scenarios: FinanceScenario[];
  selectedId: string;
  errors: Record<string, ValidationErrors>;
  projections: ScenarioProjection[];
  histories: ScenarioHistoryMap;
  replay: ReplayTarget | null;
  message: string;
}

type Listener = (state: MoneyScenarioState) => void;

function initialState(): MoneyScenarioState {
  return { status: 'loading', scenarios: [], selectedId: '', errors: {}, projections: [], histories: {}, replay: null, message: '正在恢复最近的情景…' };
}

export class MoneyScenarioViewModel {
  private state: MoneyScenarioState = initialState();
  private readonly listeners = new Set<Listener>();
  private initialized = false;
  private entrySeq = 0;
  private readonly repository: ScenarioRepository;

  constructor(repository: ScenarioRepository) {
    this.repository = repository;
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
      const [saved, savedHistory] = await Promise.all([this.repository.load(), this.repository.loadHistory()]);
      const scenarios = saved?.scenarios?.length ? saved.scenarios : SAMPLE_SCENARIOS;
      const selectedId = saved?.selectedId ?? SAMPLE_SCENARIOS[0].id;
      // 老数据没有流水、或流水与当前参数对不上时，从当前参数重新开记
      const histories = reconcileHistories(scenarios, savedHistory?.histories ?? null, Date.now());
      this.applyScenarios(scenarios, selectedId, saved ? '已恢复上次工作状态' : '已载入示例情景，可直接调整参数');
      const replayId = histories[selectedId] ? selectedId : scenarios[0].id;
      this.setState({ histories, replay: { scenarioId: replayId, position: histories[replayId]?.entries.length ?? 0 } });
    } catch {
      const histories = reconcileHistories(SAMPLE_SCENARIOS, null, Date.now());
      this.applyScenarios(SAMPLE_SCENARIOS, SAMPLE_SCENARIOS[0].id, '本地数据读取失败，已使用示例情景');
      this.setState({ histories, replay: { scenarioId: SAMPLE_SCENARIOS[0].id, position: 0 }, status: 'error', message: '本地数据读取失败，当前使用临时示例；仍可继续推演' });
    }
  }

  updateField(id: string, field: ScenarioField, value: number): void {
    const scenario = this.state.scenarios.find((item) => item.id === id);
    if (!scenario) return;
    if (!Object.is(scenario[field], value)) this.recordChange(id, field, scenario[field], value);
    const scenarios = this.state.scenarios.map((item) => item.id === id ? { ...item, [field]: value } : item);
    this.applyScenarios(scenarios, id, '参数已更新，结果实时刷新');
  }

  renameScenario(id: string, name: string): void {
    const trimmed = name.trim().slice(0, 18);
    if (!trimmed) return;
    const scenario = this.state.scenarios.find((item) => item.id === id);
    if (!scenario) return;
    if (scenario.name !== trimmed) this.recordChange(id, 'name', scenario.name, trimmed);
    this.applyScenarios(this.state.scenarios.map((item) => item.id === id ? { ...item, name: trimmed } : item), id, '情景名称已更新');
  }

  addScenario(): void {
    if (this.state.scenarios.length >= 5) {
      this.setState({ message: '最多同时比较 5 个情景' });
      return;
    }
    const source = this.state.scenarios[this.state.scenarios.length - 1] ?? SAMPLE_SCENARIOS[0];
    const id = `scenario-${Date.now()}`;
    const scenario = { ...source, id, name: `情景 ${this.state.scenarios.length + 1}`, color: COLORS[this.state.scenarios.length % COLORS.length] };
    this.trackHistories({ ...this.state.histories, [id]: createHistory(scenario, Date.now()) });
    this.applyScenarios([...this.state.scenarios, scenario], id, '已新增情景');
  }

  duplicateScenario(id: string): void {
    if (this.state.scenarios.length >= 5) {
      this.setState({ message: '最多同时比较 5 个情景' });
      return;
    }
    const source = this.state.scenarios.find((scenario) => scenario.id === id);
    if (!source) return;
    const copy = { ...source, id: `scenario-${Date.now()}`, name: `${source.name} · 复制`, color: COLORS[this.state.scenarios.length % COLORS.length] };
    this.trackHistories({ ...this.state.histories, [copy.id]: createHistory(copy, Date.now()) });
    this.applyScenarios([...this.state.scenarios, copy], copy.id, '已复制情景，可修改任意参数比较差异');
  }

  removeScenario(id: string): void {
    if (this.state.scenarios.length <= 1) return;
    const scenarios = this.state.scenarios.filter((scenario) => scenario.id !== id);
    const histories = { ...this.state.histories };
    delete histories[id];
    const replay = this.state.replay?.scenarioId === id
      ? { scenarioId: scenarios[0].id, position: histories[scenarios[0].id]?.entries.length ?? 0 }
      : this.state.replay;
    this.setState({ replay });
    this.trackHistories(histories);
    this.applyScenarios(scenarios, scenarios[0].id, '情景已移除');
  }

  openReplay(scenarioId: string): void {
    const history = this.state.histories[scenarioId];
    if (!history) return;
    this.setState({ replay: { scenarioId, position: history.entries.length } });
  }

  setReplayPosition(position: number): void {
    const replay = this.state.replay;
    if (!replay) return;
    const max = this.state.histories[replay.scenarioId]?.entries.length ?? 0;
    this.setState({ replay: { ...replay, position: Math.max(0, Math.min(position, max)) } });
  }

  clearHistory(scenarioId: string): void {
    const scenario = this.state.scenarios.find((item) => item.id === scenarioId);
    if (!scenario) return;
    const histories = { ...this.state.histories, [scenarioId]: createHistory(scenario, Date.now()) };
    const replay = this.state.replay?.scenarioId === scenarioId ? { scenarioId, position: 0 } : this.state.replay;
    this.setState({ replay, message: '变更流水已清空，将从当前参数重新记录' });
    this.trackHistories(histories);
  }

  async save(): Promise<void> {
    if (Object.keys(this.state.errors).length > 0) {
      this.setState({ status: 'error', message: '请先修正标红参数，再保存比较' });
      return;
    }
    const workspace: PersistedWorkspace = { version: 1, scenarios: this.state.scenarios, selectedId: this.state.selectedId };
    try {
      await this.repository.save(workspace);
      this.setState({ status: 'completed', message: '比较已保存，本地刷新后仍可继续编辑' });
    } catch {
      this.setState({ status: 'error', message: '保存失败，请检查浏览器本地存储权限' });
    }
  }

  private recordChange(scenarioId: string, field: ChangeField, before: number | string, after: number | string): void {
    const now = Date.now();
    const existing = this.state.histories[scenarioId];
    const scenario = this.state.scenarios.find((item) => item.id === scenarioId);
    const base = existing ?? (scenario ? createHistory(scenario, now) : null);
    if (!base) return;
    this.entrySeq += 1;
    const entry: ChangeLogEntry = { id: `change-${now}-${this.entrySeq}`, scenarioId, timestamp: now, field, before, after };
    const previousLength = base.entries.length;
    const next = appendChange(base, entry);
    // 回放停在最新位置时跟随新记录；停在历史中间时保持不动
    const replay = this.state.replay;
    const follow = replay && replay.scenarioId === scenarioId && replay.position >= previousLength
      ? { scenarioId, position: next.entries.length }
      : replay;
    this.setState({ replay: follow });
    this.trackHistories({ ...this.state.histories, [scenarioId]: next });
  }

  private trackHistories(histories: ScenarioHistoryMap): void {
    this.setState({ histories });
    void this.persistHistory(histories);
  }

  private async persistHistory(histories: ScenarioHistoryMap): Promise<void> {
    try {
      await this.repository.saveHistory({ version: 1, histories });
    } catch {
      this.setState({ message: '变更流水写入本地失败，本次记录可能不会保留' });
    }
  }

  private applyScenarios(scenarios: FinanceScenario[], selectedId: string, message: string): void {
    const errors: Record<string, ValidationErrors> = {};
    const projections: ScenarioProjection[] = [];
    scenarios.forEach((scenario) => {
      const scenarioErrors = validateScenario(scenario);
      if (Object.keys(scenarioErrors).length) errors[scenario.id] = scenarioErrors;
      else projections.push(calculateProjection(scenario));
    });
    this.setState({ scenarios, selectedId, errors, projections, status: Object.keys(errors).length ? 'editing' : 'ready', message });
  }

  private setState(patch: Partial<MoneyScenarioState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener(this.state));
  }
}

export type ScenarioField =
  | 'principal'
  | 'recurring'
  | 'years'
  | 'annualRate'
  | 'inflationRate'
  | 'feeRate';

export interface FinanceScenario {
  id: string;
  name: string;
  color: string;
  principal: number;
  recurring: number;
  years: number;
  annualRate: number;
  inflationRate: number;
  feeRate: number;
}

export interface ProjectionPoint {
  year: number;
  nominal: number;
  real: number;
  invested: number;
}

export interface ScenarioProjection {
  scenarioId: string;
  points: ProjectionPoint[];
  finalValue: number;
  finalRealValue: number;
  totalInvested: number;
}

export type ValidationErrors = Partial<Record<ScenarioField, string>>;

/** 参与回放的情景字段（color 仅用于展示，不记入流水）。 */
export type SnapshotField = 'name' | ScenarioField;

export type ChangeKind = 'init' | 'create' | 'duplicate' | 'update' | 'rename' | 'clear';

/**
 * 一条变更流水：始终携带变更后整份参数快照，
 * 这样即使更早的记录被裁剪，任意时点仍可仅凭这一条完整还原。
 */
export interface ChangeEntry {
  seq: number;
  at: number;
  kind: ChangeKind;
  field?: SnapshotField;
  before?: string | number;
  after?: string | number;
  reason?: string;
  snapshot: ScenarioSnapshot;
}

export interface ScenarioSnapshot {
  name: string;
  principal: number;
  recurring: number;
  years: number;
  annualRate: number;
  inflationRate: number;
  feeRate: number;
}

/** 单个情景的流水；dropped 记录因超过上限被裁剪掉的条数。 */
export interface ScenarioHistory {
  dropped: number;
  entries: ChangeEntry[];
}

export type HistoryMap = Record<string, ScenarioHistory>;

export interface PersistedWorkspaceV1 {
  version: 1;
  scenarios: FinanceScenario[];
  selectedId: string;
}

export interface PersistedWorkspace {
  version: 2;
  scenarios: FinanceScenario[];
  selectedId: string;
  histories: HistoryMap;
}

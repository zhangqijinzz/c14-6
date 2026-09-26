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

export type ChangeField = ScenarioField | 'name';

export interface ChangeLogEntry {
  id: string;
  scenarioId: string;
  timestamp: number;
  field: ChangeField;
  before: number | string;
  after: number | string;
}

export interface ScenarioHistory {
  scenarioId: string;
  /** 流水起点时的完整参数快照；裁剪最旧记录时会把被裁记录并入此快照 */
  base: FinanceScenario;
  baseTimestamp: number;
  /** 因超过上限被裁剪掉的记录条数 */
  trimmedCount: number;
  /** 按时间升序 */
  entries: ChangeLogEntry[];
}

export type ScenarioHistoryMap = Record<string, ScenarioHistory>;

export interface PersistedHistory {
  version: 1;
  histories: ScenarioHistoryMap;
}

export interface ReplayTarget {
  scenarioId: string;
  /** 0 = 基线状态，entries.length = 最新（当前）状态 */
  position: number;
}

export interface PersistedWorkspace {
  version: 1;
  scenarios: FinanceScenario[];
  selectedId: string;
}

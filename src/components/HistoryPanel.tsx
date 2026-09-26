import { calculateProjection, formatMoney, validateScenario } from '../domain';
import { changeFieldLabel, formatChangeValue, formatTimestamp, scenarioAtPosition } from '../history';
import type { FinanceScenario, ReplayTarget, ScenarioHistoryMap, ScenarioProjection } from '../types';

interface Props {
  scenarios: FinanceScenario[];
  histories: ScenarioHistoryMap;
  projections: ScenarioProjection[];
  replay: ReplayTarget | null;
  onSelectScenario: (scenarioId: string) => void;
  onPositionChange: (position: number) => void;
  onClear: (scenarioId: string) => void;
}

export function HistoryPanel({ scenarios, histories, projections, replay, onSelectScenario, onPositionChange, onClear }: Props) {
  const activeId = replay?.scenarioId ?? scenarios[0]?.id;
  const scenario = scenarios.find((item) => item.id === activeId) ?? scenarios[0];
  if (!scenario) return null;

  const history = histories[scenario.id];
  const entries = history?.entries ?? [];
  const position = replay?.scenarioId === scenario.id ? Math.min(replay.position, entries.length) : entries.length;
  const isLatest = position >= entries.length;

  const replayed = history ? scenarioAtPosition(history, position) : scenario;
  const replayProjection = Object.keys(validateScenario(replayed)).length === 0 ? calculateProjection(replayed) : null;
  const currentProjection = projections.find((item) => item.scenarioId === scenario.id) ?? null;

  const positionTime = position === 0 ? history?.baseTimestamp : entries[position - 1]?.timestamp;
  const delta = replayProjection && currentProjection ? replayProjection.finalValue - currentProjection.finalValue : null;

  return (
    <div className="history-panel">
      <div className="history-panel__head">
        <div className="history-pills" role="tablist" aria-label="选择要回放的情景">
          {scenarios.map((item) => (
            <button key={item.id} type="button" className={item.id === scenario.id ? 'is-active' : ''} onClick={() => onSelectScenario(item.id)}>
              <i style={{ background: item.color }} />{item.name}
            </button>
          ))}
        </div>
        <button
          className="ghost-button"
          type="button"
          disabled={entries.length === 0 && !history?.trimmedCount}
          onClick={() => { if (window.confirm(`确定清空「${scenario.name}」的全部变更流水吗？此操作不可撤销。`)) onClear(scenario.id); }}
        >
          清空流水
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="history-empty">
          <strong>还没有变更记录</strong>
          <p>调整参数或修改名称后，这里会按时间列出每一次修改，并支持拖动回放。</p>
        </div>
      ) : (
        <>
          <div className="replay-control">
            <div className="replay-readout">
              <span>回放时点</span>
              <strong>{position === 0 ? `基线 · ${formatTimestamp(positionTime ?? 0)}` : `${formatTimestamp(positionTime ?? 0)}${isLatest ? ' · 当前版本' : ''}`}</strong>
            </div>
            <input
              className="replay-slider"
              type="range"
              aria-label="回放时间点"
              min={0}
              max={entries.length}
              step={1}
              value={position}
              onChange={(event) => onPositionChange(Number(event.target.value))}
            />
            <div className="replay-range-labels">
              <span>基线 {history ? formatTimestamp(history.baseTimestamp) : ''}</span>
              <span>{position} / {entries.length} 条之后</span>
              <span>现在</span>
            </div>
            {history && history.trimmedCount > 0 && (
              <p className="trim-note">最早的 {history.trimmedCount} 条记录已并入基线（{formatTimestamp(history.baseTimestamp)}），更早的状态不可回放。</p>
            )}
          </div>

          <ReplayChart
            color={scenario.color}
            current={currentProjection}
            replayed={replayProjection}
            replayInvalid={!replayProjection}
            replayLabel={isLatest ? '当前版本' : formatTimestamp(positionTime ?? 0)}
            scenarioName={scenario.name}
          />

          <div className="replay-stats">
            <div><span>回放时点名义终值</span><strong>{replayProjection ? `¥ ${formatMoney(replayProjection.finalValue)}` : '—'}</strong></div>
            <div><span>当前名义终值</span><strong>{currentProjection ? `¥ ${formatMoney(currentProjection.finalValue)}` : '—'}</strong></div>
            <div>
              <span>差值（回放 − 当前）</span>
              <strong className={delta === null ? '' : delta >= 0 ? 'delta-up' : 'delta-down'}>
                {delta === null ? '—' : `${delta >= 0 ? '+' : '−'}¥ ${formatMoney(Math.abs(delta))}`}
              </strong>
            </div>
          </div>

          <ul className="history-list">
            {entries.map((entry, index) => ({ entry, index })).reverse().map(({ entry, index }) => (
              <li key={entry.id} className={index < position ? '' : 'is-future'}>
                <time>{formatTimestamp(entry.timestamp)}</time>
                <span className="history-field">{changeFieldLabel(entry.field)}</span>
                <span className="history-change">{formatChangeValue(entry.field, entry.before)} → {formatChangeValue(entry.field, entry.after)}</span>
              </li>
            ))}
            <li className="history-base">
              <time>{history ? formatTimestamp(history.baseTimestamp) : ''}</time>
              <span className="history-field">基线</span>
              <span className="history-change">流水从这里开始记录{history && history.trimmedCount > 0 ? `（已并入 ${history.trimmedCount} 条更早记录）` : ''}</span>
            </li>
          </ul>
        </>
      )}
    </div>
  );
}

interface ReplayChartProps {
  color: string;
  current: ScenarioProjection | null;
  replayed: ScenarioProjection | null;
  replayInvalid: boolean;
  replayLabel: string;
  scenarioName: string;
}

function ReplayChart({ color, current, replayed, replayInvalid, replayLabel, scenarioName }: ReplayChartProps) {
  const width = 760;
  const height = 240;
  const pad = { top: 20, right: 24, bottom: 32, left: 62 };
  const series = [current, replayed].filter((item): item is ScenarioProjection => item !== null);

  if (series.length === 0) {
    return <div className="history-empty"><strong>该时点参数无效，无法计算曲线</strong><p>回放位置或当前参数中包含非法取值，修正后即可对照。</p></div>;
  }

  const maxYears = Math.max(...series.map((projection) => projection.points[projection.points.length - 1]?.year ?? 1), 1);
  const maxValue = Math.max(...series.flatMap((projection) => projection.points.map((point) => point.nominal)), 1);
  const x = (year: number) => pad.left + (year / maxYears) * (width - pad.left - pad.right);
  const y = (value: number) => height - pad.bottom - (value / maxValue) * (height - pad.top - pad.bottom);
  const pathOf = (projection: ScenarioProjection) => projection.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.year)} ${y(point.nominal)}`).join(' ');

  return (
    <div className="replay-chart">
      <div className="chart-legend">
        {current && <span><i style={{ background: color }} />当前 · {scenarioName}</span>}
        {replayed && <span><b className="legend-dash" />回放 · {replayLabel}</span>}
        <span className="legend-note">名义终值 · 历史对照</span>
      </div>
      <svg className="chart replay-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="历史版本与当前版本终值曲线对照图">
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const value = maxValue * tick;
          return <g key={tick}><line x1={pad.left} x2={width - pad.right} y1={y(value)} y2={y(value)} className="grid-line" /><text x={pad.left - 10} y={y(value) + 4} textAnchor="end" className="axis-label">{formatMoney(value)}</text></g>;
        })}
        <text x={pad.left} y={height - 10} className="axis-label">第 0 年</text>
        <text x={width - pad.right} y={height - 10} textAnchor="end" className="axis-label">第 {maxYears} 年</text>
        {current && <path d={pathOf(current)} className="chart-line" stroke={color} />}
        {replayed && <path d={pathOf(replayed)} className="chart-line chart-line--replay" />}
      </svg>
      {replayInvalid && <p className="trim-note">回放时点的参数无效（例如正在输入中的空值），该版曲线无法计算。</p>}
    </div>
  );
}

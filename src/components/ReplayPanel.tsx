import { useMemo } from 'react';
import { describeEntry, formatEntryTime } from '../history';
import { formatMoney } from '../domain';
import type { ReplayState } from '../viewModel';
import type { FinanceScenario, ScenarioHistory, ScenarioProjection } from '../types';

interface Props {
  scenario: FinanceScenario;
  history: ScenarioHistory;
  currentProjection: ScenarioProjection | undefined;
  replay: ReplayState | null;
  onSeek: (seq: number | null) => void;
  onClear: () => void;
}

const CHART = { width: 720, height: 220, pad: { top: 18, right: 16, bottom: 30, left: 58 } };

function linePath(projection: ScenarioProjection, x: (year: number) => number, y: (value: number) => number): string {
  return projection.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.year)} ${y(point.nominal)}`).join(' ');
}

function deltaText(current: number, historical: number): string {
  const delta = current - historical;
  if (Math.abs(delta) < 0.5) return '持平';
  return `${delta > 0 ? '+' : '-'} ¥ ${formatMoney(Math.abs(delta))}`;
}

export function ReplayPanel({ scenario, history, currentProjection, replay, onSeek, onClear }: Props) {
  const entries = history.entries;
  const activeSeq = replay?.seq ?? entries[entries.length - 1].seq;
  const activeIndex = Math.max(0, entries.findIndex((entry) => entry.seq === activeSeq));
  const activeEntry = entries[activeIndex];
  const isCurrent = activeIndex === entries.length - 1;

  const chart = useMemo(() => {
    const replayProjection = replay?.projection;
    const series = [currentProjection, replayProjection].filter((item): item is ScenarioProjection => Boolean(item));
    if (series.length === 0) return null;
    const maxYears = Math.max(...series.map((item) => item.points[item.points.length - 1]?.year ?? 1), 1);
    const maxValue = Math.max(...series.flatMap((item) => item.points.map((point) => point.nominal)), 1);
    const { pad } = CHART;
    const x = (year: number) => pad.left + (year / maxYears) * (CHART.width - pad.left - pad.right);
    const y = (value: number) => CHART.height - pad.bottom - (value / maxValue) * (CHART.height - pad.top - pad.bottom);
    return {
      x,
      y,
      maxYears,
      replayPath: replayProjection ? linePath(replayProjection, x, y) : null,
      currentPath: currentProjection ? linePath(currentProjection, x, y) : null,
      ticks: [0, 0.5, 1].map((tick) => ({ value: maxValue * tick, y: y(maxValue * tick) })),
    };
  }, [currentProjection, replay]);

  const historical = replay?.scenario;
  const historicalProjection = replay?.projection ?? null;
  const metrics: Array<{ label: string; current: number; past: number }> = currentProjection && historicalProjection
    ? [
        { label: '名义终值', current: currentProjection.finalValue, past: historicalProjection.finalValue },
        { label: '扣除通胀后', current: currentProjection.finalRealValue, past: historicalProjection.finalRealValue },
        { label: '累计投入', current: currentProjection.totalInvested, past: historicalProjection.totalInvested },
      ]
    : [];

  return (
    <div className="replay-panel">
      <div className="replay-head">
        <strong>历史回放</strong>
        <span className="replay-time">{formatEntryTime(activeEntry.at)}</span>
        <button className="replay-close" type="button" onClick={() => onSeek(null)} aria-label="收起回放">收起</button>
      </div>

      <input
        className="replay-slider"
        type="range"
        min={0}
        max={entries.length - 1}
        step={1}
        value={activeIndex}
        aria-label="历史时点"
        onChange={(event) => onSeek(entries[Number(event.target.value)].seq)}
      />
      <div className="replay-meta">
        <span className="replay-change">{describeEntry(activeEntry)}</span>
        {isCurrent
          ? <em className="replay-badge">当前版本</em>
          : <button className="replay-return" type="button" onClick={() => onSeek(null)}>↩ 返回当前版本</button>}
      </div>
      {history.dropped > 0 && (
        <p className="replay-note">最早的 {history.dropped} 条流水已超出保留上限被裁剪，更早时点无法回放；保留的记录均为完整快照，回放结果不受影响。</p>
      )}

      {!isCurrent && (
        <>
          {historical && (
            <p className="replay-snapshot">
              当时名称「{historical.name}」· 初始 {formatMoney(historical.principal)} · 月投 {formatMoney(historical.recurring)} · {historical.years} 年 · 收益 {historical.annualRate}% · 通胀 {historical.inflationRate}% · 费率 {historical.feeRate}%
            </p>
          )}
          {replay && !replay.projection && <p className="replay-invalid">该时点存在未修正的参数，无法计算终值曲线。</p>}
          {chart && (
            <div className="replay-chart">
              <div className="replay-legend">
                <span><i className="line-past" />历史版本{historical ? `（${historical.name}）` : ''}</span>
                <span><i className="line-current" style={{ background: scenario.color }} />当前版本（{scenario.name}）</span>
              </div>
              <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} role="img" aria-label="历史版本与当前版本终值曲线对照">
                {chart.ticks.map((tick) => (
                  <g key={tick.value}>
                    <line x1={CHART.pad.left} x2={CHART.width - CHART.pad.right} y1={tick.y} y2={tick.y} className="grid-line" />
                    <text x={CHART.pad.left - 8} y={tick.y + 3} textAnchor="end" className="axis-label">{formatMoney(tick.value)}</text>
                  </g>
                ))}
                <text x={CHART.pad.left} y={CHART.height - 8} className="axis-label">第 0 年</text>
                <text x={CHART.width - CHART.pad.right} y={CHART.height - 8} textAnchor="end" className="axis-label">第 {chart.maxYears} 年</text>
                {chart.replayPath && <path d={chart.replayPath} className="replay-line-past" />}
                {chart.currentPath && <path d={chart.currentPath} className="replay-line-current" stroke={scenario.color} />}
              </svg>
            </div>
          )}
          {metrics.length > 0 && (
            <table className="replay-table">
              <thead><tr><th></th><th>历史版本</th><th>当前版本</th><th>变化</th></tr></thead>
              <tbody>
                {metrics.map((metric) => (
                  <tr key={metric.label}>
                    <td>{metric.label}</td>
                    <td>¥ {formatMoney(metric.past)}</td>
                    <td>¥ {formatMoney(metric.current)}</td>
                    <td className={metric.current >= metric.past ? 'up' : 'down'}>{deltaText(metric.current, metric.past)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <div className="replay-footer">
        <span>共 {entries.length} 条记录{history.dropped > 0 ? `（另有 ${history.dropped} 条已裁剪）` : ''}</span>
        <button
          className="replay-clear"
          type="button"
          onClick={() => { if (window.confirm('清空后只保留当前参数作为新的起点，更早的流水将无法回放。确定清空吗？')) onClear(); }}
        >清空流水</button>
      </div>
    </div>
  );
}

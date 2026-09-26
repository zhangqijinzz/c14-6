import { useEffect, useState, type CSSProperties } from 'react';
import { fieldLabel } from '../domain';
import type { FinanceScenario, ScenarioField, ScenarioHistory, ScenarioProjection, ValidationErrors } from '../types';
import type { ReplayState } from '../viewModel';
import { ReplayPanel } from './ReplayPanel';

const fields: Array<{ key: ScenarioField; suffix: string; step: string }> = [
  { key: 'principal', suffix: '元', step: '1000' },
  { key: 'recurring', suffix: '元 / 月', step: '100' },
  { key: 'years', suffix: '年', step: '1' },
  { key: 'annualRate', suffix: '% / 年', step: '0.1' },
  { key: 'inflationRate', suffix: '% / 年', step: '0.1' },
  { key: 'feeRate', suffix: '% / 年', step: '0.1' },
];

interface Props {
  scenario: FinanceScenario;
  errors: ValidationErrors;
  history: ScenarioHistory | undefined;
  currentProjection: ScenarioProjection | undefined;
  replay: ReplayState | null;
  onUpdate: (field: ScenarioField, value: number) => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onSeek: (seq: number | null) => void;
  onClearHistory: () => void;
}

export function ScenarioForm({ scenario, errors, history, currentProjection, replay, onUpdate, onRename, onDuplicate, onRemove, onSeek, onClearHistory }: Props) {
  const [draftName, setDraftName] = useState(scenario.name);
  const [showReplay, setShowReplay] = useState(false);

  // 外部（复制、回放面板显示的当前名称等）变化时同步输入框。
  useEffect(() => { setDraftName(scenario.name); }, [scenario.name]);

  const commitName = () => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== scenario.name) onRename(trimmed);
    else setDraftName(scenario.name);
  };

  return (
    <section className="scenario-card" style={{ '--accent': scenario.color } as CSSProperties}>
      <div className="scenario-card__head">
        <span className="scenario-dot" />
        <input
          className="scenario-name"
          aria-label="情景名称"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        />
        <button
          className={`icon-button ${showReplay ? 'active' : ''}`}
          type="button"
          onClick={() => setShowReplay((value) => !value)}
          title="变更流水与历史回放"
          aria-label="变更流水与历史回放"
          aria-expanded={showReplay}
        >↺</button>
        <button className="icon-button" type="button" onClick={onDuplicate} title="复制情景" aria-label="复制情景">＋</button>
        <button className="icon-button muted" type="button" onClick={onRemove} title="删除情景" aria-label="删除情景">×</button>
      </div>
      <div className="field-grid">
        {fields.map(({ key, suffix, step }) => (
          <label className="field" key={key}>
            <span>{fieldLabel(key)}</span>
            <div className={`input-wrap ${errors[key] ? 'has-error' : ''}`}>
              <input
                aria-label={`${scenario.name} ${fieldLabel(key)}`}
                type="number"
                min={key === 'years' ? 1 : undefined}
                max={key === 'years' ? 60 : undefined}
                step={step}
                value={Number.isNaN(scenario[key]) ? '' : scenario[key]}
                onChange={(event) => onUpdate(key, event.target.value === '' ? Number.NaN : Number(event.target.value))}
              />
              <em>{suffix}</em>
            </div>
            {errors[key] && <small className="error-text">{errors[key]}</small>}
          </label>
        ))}
      </div>
      {showReplay && history && (
        <ReplayPanel
          scenario={scenario}
          history={history}
          currentProjection={currentProjection}
          replay={replay}
          onSeek={(seq) => { onSeek(seq); if (seq === null) setShowReplay(true); }}
          onClear={onClearHistory}
        />
      )}
    </section>
  );
}

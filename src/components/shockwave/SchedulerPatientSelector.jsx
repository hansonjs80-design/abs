function getTreatmentLabel(option) {
  return option?.type === 'manual' ? '도수치료' : '충격파';
}

function getOptionDetail(option) {
  return [option?.prescription, option?.latestBodyPart].filter(Boolean).join(' · ') || '최근 기록';
}

export default function SchedulerPatientSelector({ selector, onSelect, onCancel }) {
  if (!selector) return null;

  const optionCount = selector.options?.length || 0;
  const columnCount = Math.min(Math.max(optionCount, 1), 6);

  return (
    <div className="shockwave-chart-selector-backdrop" onMouseDown={onCancel}>
      <div
        className="shockwave-chart-selector"
        style={{ '--shockwave-chart-selector-columns': columnCount }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="shockwave-chart-selector-title">동명이인 선택</div>
        <div className="shockwave-chart-selector-subtitle">
          {selector.rawName} 환자의 차트번호를 선택하세요.
        </div>
        <div className="shockwave-chart-selector-options">
          {selector.options.map((option) => (
            <button
              key={`${option.chartNumber}-${option.type}-${option.doseTag || 'default'}-${option.lastDate}`}
              type="button"
              className={`shockwave-chart-selector-option shockwave-chart-selector-option--${option.type === 'manual' ? 'manual' : 'shockwave'}`}
              onClick={() => onSelect(option)}
            >
              <span className="shockwave-chart-selector-type">
                {getTreatmentLabel(option)}
              </span>
              <span className="shockwave-chart-selector-chart">{option.chartNumber}</span>
              <span className="shockwave-chart-selector-name">{option.namePart}</span>
              <span className="shockwave-chart-selector-detail">{getOptionDetail(option)}</span>
              <span className="shockwave-chart-selector-meta">{option.displayVisit || option.nextVisit}회차 · {option.lastDate}</span>
            </button>
          ))}
        </div>
        <div className="shockwave-chart-selector-actions">
          <button
            type="button"
            className="shockwave-chart-selector-cancel"
            onClick={onCancel}
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

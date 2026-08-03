import { useEffect, useRef, useState } from 'react';
import { normalizeManualTherapyIonTreatment } from '../../lib/manualTherapyIonTreatmentUtils';

export default function ManualTherapyIonTreatmentTable({
  currentMonth,
  value,
  onSave,
}) {
  const [draft, setDraft] = useState(() => normalizeManualTherapyIonTreatment(value));
  const [isSaving, setIsSaving] = useState(false);
  const saveQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    setDraft(normalizeManualTherapyIonTreatment(value));
  }, [value]);

  const save = () => {
    const nextValue = normalizeManualTherapyIonTreatment(draft);
    setIsSaving(true);
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => onSave?.(nextValue))
      .finally(() => setIsSaving(false));
  };

  const updateValue = (field, nextValue) => {
    setDraft((previous) => ({ ...previous, [field]: nextValue }));
  };

  const getInputWidth = (field, minimumWidth) => `${Math.max(
    minimumWidth,
    String(draft[field] || '').length + 1
  )}ch`;

  return (
    <div className="sw-settlement-card sw-manual-ion-treatment-card">
      <div className="sw-settlement-header">
        <h2>{currentMonth}월 이온치료 현황</h2>
        {isSaving ? <span className="sw-ion-treatment-save-status">저장 중...</span> : null}
      </div>
      <div className="sw-settlement-table-wrap sw-manual-ion-treatment-table-wrap">
        <table className="sw-settlement-table sw-manual-ion-treatment-table">
          <thead>
            <tr>
              <th>구분</th>
              <th>건수</th>
              <th>총액</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>이온치료</th>
              <td>
                <div className="sw-manual-ion-treatment-input-wrap">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={draft.count}
                    onChange={(event) => updateValue('count', event.target.value)}
                    onBlur={save}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                    aria-label="이온치료 건수"
                    placeholder="0"
                    style={{ width: getInputWidth('count', 10) }}
                  />
                  <span aria-hidden="true">건</span>
                </div>
              </td>
              <td>
                <div className="sw-manual-ion-treatment-input-wrap">
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    inputMode="numeric"
                    value={draft.amount}
                    onChange={(event) => updateValue('amount', event.target.value)}
                    onBlur={save}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                    aria-label="이온치료 총액"
                    placeholder="0"
                    style={{ width: getInputWidth('amount', 14) }}
                  />
                  <span aria-hidden="true">원</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getRecentManualTherapyIonTreatmentMonths } from '../../lib/manualTherapyIonTreatmentUtils';

function digitsOnly(value) {
  return String(value ?? '').replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
}

function formatAmount(value) {
  const digits = digitsOnly(value);
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function createDrafts(settings, rows) {
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export default function ManualTherapySixMonthIonTreatment({
  currentYear,
  currentMonth,
  settings,
  onSave,
}) {
  const rows = useMemo(
    () => getRecentManualTherapyIonTreatmentMonths(settings, currentYear, currentMonth),
    [currentMonth, currentYear, settings]
  );
  const [drafts, setDrafts] = useState(() => createDrafts(settings, rows));
  const [savingKey, setSavingKey] = useState(null);
  const saveQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    setDrafts(createDrafts(settings, rows));
  }, [rows, settings]);

  const updateDraft = (row, field, rawValue) => {
    const value = field === 'amount' ? formatAmount(rawValue) : digitsOnly(rawValue);
    setDrafts((current) => ({
      ...current,
      [row.key]: {
        ...(current[row.key] || {}),
        [field]: value,
      },
    }));
  };

  const saveRow = (row) => {
    const value = drafts[row.key] || { count: '', amount: '' };
    const normalized = {
      count: digitsOnly(value.count),
      amount: digitsOnly(value.amount),
    };
    setDrafts((current) => ({ ...current, [row.key]: normalized }));
    setSavingKey(row.key);
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => onSave(row.year, row.month, normalized))
      .finally(() => setSavingKey((current) => (current === row.key ? null : current)));
  };

  return (
    <section className="sw-settlement-card sw-manual-summary-card sw-manual-ion-summary-card">
      <div className="sw-settlement-header">
        <h2>최근 6개월 이온치료 현황</h2>
      </div>
      <div className="sw-six-month-summary-wrap">
        <table className="sw-summary-table sw-manual-ion-summary-table">
          <colgroup>
            <col className="sw-manual-ion-month-column" />
            <col className="sw-manual-ion-count-column" />
            <col className="sw-manual-ion-amount-column" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">월</th>
              <th scope="col">건수</th>
              <th scope="col">총액</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const value = drafts[row.key] || { count: '', amount: '' };
              const isCurrentMonth = index === 0;

              return (
                <tr key={row.key} className={isCurrentMonth ? 'sw-current-month-summary-row' : undefined}>
                  <th scope="row" className="month-label">{row.year}년 {row.month}월</th>
                  <td>
                    <label className="sw-six-month-ion-input-wrap">
                      <input
                        aria-label={`${row.year}년 ${row.month}월 이온치료 건수`}
                        inputMode="numeric"
                        value={value.count}
                        onChange={(event) => updateDraft(row, 'count', event.target.value)}
                        onBlur={() => saveRow(row)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                      />
                      <span>건</span>
                    </label>
                  </td>
                  <td>
                    <label className="sw-six-month-ion-input-wrap">
                      <input
                        aria-label={`${row.year}년 ${row.month}월 이온치료 총액`}
                        inputMode="numeric"
                        value={formatAmount(value.amount)}
                        onChange={(event) => updateDraft(row, 'amount', event.target.value)}
                        onBlur={() => saveRow(row)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                      />
                      <span>원</span>
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {savingKey && <span className="sw-manual-ion-saving">저장 중...</span>}
    </section>
  );
}

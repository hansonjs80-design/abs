import React, { useEffect, useMemo, useState } from 'react';
import { setMonthlySettlementSettings } from '../../lib/settlementSettings';

export default function SettlementSettingsPanel({
  type = 'shockwave',
  year,
  month,
  settings,
  effectiveSettings,
  onSave,
}) {
  const [draft, setDraft] = useState(() => ({
    prescriptions: effectiveSettings?.prescriptions || [],
    prescription_prices: effectiveSettings?.prescription_prices || {},
    incentive_percentage: effectiveSettings?.incentive_percentage ?? 0,
  }));

  const title = type === 'manual_therapy' ? '도수치료 결산 설정' : '충격파 결산 설정';
  const addPlaceholder = type === 'manual_therapy' ? '+ 도수 처방' : '+ 처방';
  const sourceText = useMemo(() => {
    if (!effectiveSettings?.source_month_key) return '기존 기본 설정 사용 중';
    if (effectiveSettings.source_month_key === effectiveSettings.target_month_key) return '이번 달 직접 설정 사용 중';
    return `${effectiveSettings.source_month_key} 설정을 이어받아 적용 중`;
  }, [effectiveSettings?.source_month_key, effectiveSettings?.target_month_key]);

  useEffect(() => {
    setDraft({
      prescriptions: effectiveSettings?.prescriptions || [],
      prescription_prices: effectiveSettings?.prescription_prices || {},
      incentive_percentage: effectiveSettings?.incentive_percentage ?? 0,
    });
  }, [effectiveSettings]);

  const updatePrescription = (index, value) => {
    const nextValue = value.trim();
    setDraft((prev) => {
      const previousName = prev.prescriptions[index];
      const nextPrescriptions = prev.prescriptions.map((item, itemIndex) => (
        itemIndex === index ? value : item
      ));
      const nextPrices = { ...prev.prescription_prices };
      if (nextValue && previousName && previousName !== nextValue) {
        nextPrices[nextValue] = nextPrices[previousName] ?? 0;
        delete nextPrices[previousName];
      }
      return { ...prev, prescriptions: nextPrescriptions, prescription_prices: nextPrices };
    });
  };

  const removePrescription = (index) => {
    setDraft((prev) => {
      const target = prev.prescriptions[index];
      const nextPrices = { ...prev.prescription_prices };
      delete nextPrices[target];
      return {
        ...prev,
        prescriptions: prev.prescriptions.filter((_, itemIndex) => itemIndex !== index),
        prescription_prices: nextPrices,
      };
    });
  };

  const addPrescription = (value) => {
    const nextValue = value.trim();
    if (!nextValue) return false;
    setDraft((prev) => {
      if (prev.prescriptions.includes(nextValue)) return prev;
      return {
        ...prev,
        prescriptions: [...prev.prescriptions, nextValue],
        prescription_prices: {
          ...prev.prescription_prices,
          [nextValue]: prev.prescription_prices?.[nextValue] ?? 0,
        },
      };
    });
    return true;
  };

  const handleSave = async () => {
    const cleaned = {
      prescriptions: draft.prescriptions.map((item) => String(item || '').trim()).filter(Boolean),
      prescription_prices: draft.prescription_prices,
      incentive_percentage: Number(draft.incentive_percentage) || 0,
    };
    const monthly_settlement_settings = setMonthlySettlementSettings(settings, year, month, type, cleaned);
    await onSave({ ...settings, monthly_settlement_settings });
  };

  return (
    <div className="sw-stats-body sw-stats-body--settlement">
      <div className="sw-settlement-card sw-settlement-settings-card">
        <div className="sw-settlement-header">
          <div>
            <h2>{year}년 {String(month).padStart(2, '0')}월 {title}</h2>
            <p className="sw-settlement-settings-subtext">{sourceText}</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={handleSave}>
            이번 달 설정 저장
          </button>
        </div>

        <div className="settlement-settings-grid">
          <div className="settlement-settings-list">
            {draft.prescriptions.map((prescription, index) => (
              <div key={`${prescription}-${index}`} className="settlement-settings-row">
                <input
                  className="form-input settlement-prescription-input"
                  value={prescription}
                  onChange={(event) => updatePrescription(index, event.target.value)}
                />
                <input
                  type="number"
                  className="form-input settlement-price-input"
                  min={0}
                  step={1000}
                  value={draft.prescription_prices?.[prescription] ?? 0}
                  onChange={(event) => {
                    const value = Number(event.target.value) || 0;
                    setDraft((prev) => ({
                      ...prev,
                      prescription_prices: {
                        ...prev.prescription_prices,
                        [prescription]: value,
                      },
                    }));
                  }}
                />
                <span className="settlement-settings-unit">원</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => removePrescription(index)}>
                  삭제
                </button>
              </div>
            ))}
            <input
              className="form-input settlement-add-input"
              placeholder={addPlaceholder}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                if (addPrescription(event.currentTarget.value)) event.currentTarget.value = '';
              }}
            />
          </div>

          <label className="settlement-incentive-box">
            <span>인센티브</span>
            <div>
              <input
                type="number"
                className="form-input"
                min={0}
                step={0.1}
                value={draft.incentive_percentage}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setDraft((prev) => ({
                    ...prev,
                    incentive_percentage: Number.isFinite(value) ? value : 0,
                  }));
                }}
              />
              <em>%</em>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}

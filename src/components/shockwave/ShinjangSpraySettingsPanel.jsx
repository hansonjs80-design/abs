import React, { useEffect, useMemo, useState } from 'react';

function getMappedValue(values, prescription) {
  const target = String(prescription || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[^\p{L}\p{N}]/gu, '');
  return Object.entries(values || {}).find(([key]) => (
    String(key || '')
      .normalize('NFKC')
      .toLocaleLowerCase('ko-KR')
      .replace(/[^\p{L}\p{N}]/gu, '') === target
  ))?.[1];
}

export default function ShinjangSpraySettingsPanel({
  year,
  month,
  prescriptions = [],
  prescriptionPrices = {},
  effectiveSettings,
  onSave,
}) {
  const effectivePercentages = useMemo(() => ({
    ...(effectiveSettings?.prescription_incentive_percentages || {}),
  }), [effectiveSettings?.prescription_incentive_percentages]);
  const [draft, setDraft] = useState(effectivePercentages);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraft(effectivePercentages);
  }, [effectivePercentages]);

  const sourceText = useMemo(() => {
    if (!effectiveSettings?.source_month_key) return '아직 저장된 설정이 없어 인센티브율 0%를 적용합니다.';
    if (effectiveSettings.source_month_key === effectiveSettings.target_month_key) {
      return '이번 달에 직접 저장한 처방별 인센티브 설정입니다.';
    }
    return `${effectiveSettings.source_month_key} 설정을 이어받아 적용 중입니다.`;
  }, [effectiveSettings?.source_month_key, effectiveSettings?.target_month_key]);

  const handleSave = async () => {
    const cleaned = Object.fromEntries(prescriptions.map((prescription) => [
      prescription,
      Math.max(0, Number(getMappedValue(draft, prescription)) || 0),
    ]));
    setIsSaving(true);
    try {
      await onSave(cleaned);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="sw-settlement-card shinjang-spray-settings-card">
      <div className="sw-settlement-header">
        <div>
          <h2>{year}년 {String(month).padStart(2, '0')}월 신장분사 인센티브 설정</h2>
          <p className="sw-settlement-settings-subtext">{sourceText}</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSave}
          disabled={isSaving || prescriptions.length === 0}
        >
          {isSaving ? '저장 중...' : '이번 달 설정 저장'}
        </button>
      </div>

      {prescriptions.length === 0 ? (
        <div className="sw-stats-empty shinjang-spray-empty">
          <span>설정할 신장분사 처방이 없습니다.</span>
          <span className="empty-subtext">충격파 또는 도수치료 설정에서 처방 이름에 (신장분사)를 넣어주세요.</span>
        </div>
      ) : (
        <div className="shinjang-spray-settings-list">
          <div className="shinjang-spray-settings-row shinjang-spray-settings-header-row">
            <span>처방 이름</span>
            <span>원본 처방 단가</span>
            <span>인센티브율</span>
          </div>
          {prescriptions.map((prescription) => (
            <div className="shinjang-spray-settings-row" key={prescription}>
              <strong>{prescription}</strong>
              <span className="shinjang-spray-settings-price">
                {Number(getMappedValue(prescriptionPrices, prescription) || 0).toLocaleString('ko-KR')}원
              </span>
              <label className="shinjang-spray-percentage-field">
                <input
                  type="number"
                  className="form-input"
                  min={0}
                  step={0.1}
                  value={getMappedValue(draft, prescription) ?? ''}
                  placeholder="0"
                  aria-label={`${prescription} 인센티브율`}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDraft((current) => ({ ...current, [prescription]: value }));
                  }}
                />
                <span>%</span>
              </label>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

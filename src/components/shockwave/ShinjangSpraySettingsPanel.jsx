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

function isMappedPrescription(values, prescription) {
  return (Array.isArray(values) ? values : []).some((value) => (
    String(value || '')
      .normalize('NFKC')
      .toLocaleLowerCase('ko-KR')
      .replace(/[^\p{L}\p{N}]/gu, '')
      === String(prescription || '')
        .normalize('NFKC')
        .toLocaleLowerCase('ko-KR')
        .replace(/[^\p{L}\p{N}]/gu, '')
  ));
}

export default function ShinjangSpraySettingsPanel({
  year,
  month,
  prescriptions = [],
  prescriptionPrices = {},
  cryoPrescriptions = [],
  cryoPrices = {},
  therapists = [],
  effectiveSettings,
  onSave,
}) {
  const effectivePercentages = useMemo(() => ({
    ...(effectiveSettings?.prescription_incentive_percentages || {}),
  }), [effectiveSettings?.prescription_incentive_percentages]);
  const therapistNameList = useMemo(() => (
    (Array.isArray(therapists) ? therapists : [])
      .map((therapist) => String(therapist?.name || '').trim())
      .filter(Boolean)
  ), [therapists]);
  const effectiveTherapistNames = useMemo(() => {
    if (!Array.isArray(effectiveSettings?.therapist_names)) return therapistNameList;
    const configuredNames = new Set(effectiveSettings.therapist_names);
    return therapistNameList.filter((name) => configuredNames.has(name));
  }, [effectiveSettings?.therapist_names, therapistNameList]);
  const [draft, setDraft] = useState(effectivePercentages);
  const [draftTherapistNames, setDraftTherapistNames] = useState(effectiveTherapistNames);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraft(effectivePercentages);
    setDraftTherapistNames(effectiveTherapistNames);
  }, [effectivePercentages, effectiveTherapistNames]);

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
      await onSave({
        prescriptionIncentivePercentages: cleaned,
        therapistNames: draftTherapistNames,
      });
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
          disabled={isSaving || draftTherapistNames.length === 0}
        >
          {isSaving ? '저장 중...' : '이번 달 설정 저장'}
        </button>
      </div>

      <div className="shinjang-spray-therapist-settings">
        <div className="shinjang-spray-settings-section-heading">
          <div>
            <h3>집계 치료사</h3>
            <p>신장분사 현황과 결산에 표시할 치료사를 선택합니다.</p>
          </div>
          <button
            type="button"
            className="shinjang-spray-select-all-button"
            onClick={() => setDraftTherapistNames(therapistNameList)}
            disabled={therapistNameList.length === draftTherapistNames.length}
          >
            전체 선택
          </button>
        </div>
        {therapistNameList.length === 0 ? (
          <div className="shinjang-spray-setting-empty">설정할 치료사가 없습니다.</div>
        ) : (
          <div className="shinjang-spray-therapist-options" aria-label="신장분사 집계 치료사 설정">
            {therapists.map((therapist, index) => {
              const name = String(therapist?.name || '').trim();
              if (!name) return null;
              const isChecked = draftTherapistNames.includes(name);
              const isLastChecked = isChecked && draftTherapistNames.length <= 1;
              return (
                <label
                  key={therapist.key || therapist.id || name}
                  className={`shinjang-spray-therapist-option tone-${index % 5}${isChecked ? ' is-active' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={isLastChecked}
                    onChange={(event) => {
                      setDraftTherapistNames((current) => (
                        event.target.checked
                          ? [...current, name]
                          : current.filter((item) => item !== name)
                      ));
                    }}
                  />
                  <span>{therapist.displayName || name}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {prescriptions.length === 0 ? (
        <div className="sw-stats-empty shinjang-spray-empty">
          <span>설정할 신장분사 처방이 없습니다.</span>
          <span className="empty-subtext">충격파 또는 도수치료 설정에서 처방 이름에 (신장분사)를 넣어주세요.</span>
        </div>
      ) : (
        <div className="shinjang-spray-settings-list">
          <p className="shinjang-spray-cryo-settings-note">
            크라이오 적용 여부와 가격은 충격파·도수치료 설정에서 자동으로 연동됩니다.
          </p>
          <div className="shinjang-spray-settings-row shinjang-spray-settings-header-row">
            <span>처방 이름</span>
            <span>원본 처방 단가</span>
            <span>크라이오</span>
            <span>크라이오 가격</span>
            <span>인센티브율</span>
          </div>
          {prescriptions.map((prescription) => {
            const isCryo = isMappedPrescription(cryoPrescriptions, prescription);
            return (
              <div className="shinjang-spray-settings-row" key={prescription}>
                <strong>{prescription}</strong>
                <span className="shinjang-spray-settings-price">
                  {Number(getMappedValue(prescriptionPrices, prescription) || 0).toLocaleString('ko-KR')}원
                </span>
                <span className={`shinjang-spray-cryo-status${isCryo ? ' is-active' : ''}`}>
                  {isCryo ? '적용' : '미적용'}
                </span>
                <span className="shinjang-spray-settings-cryo-price">
                  {isCryo
                    ? `${Number(getMappedValue(cryoPrices, prescription) || 0).toLocaleString('ko-KR')}원`
                    : '—'}
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
            );
          })}
        </div>
      )}
    </section>
  );
}

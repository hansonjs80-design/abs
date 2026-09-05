import React, { useCallback, useEffect, useMemo, useState } from 'react';

function buildInitialDraft(effectiveSettings) {
  return {
    prescriptions: Array.isArray(effectiveSettings?.prescriptions)
      ? effectiveSettings.prescriptions.filter(Boolean)
      : ['신장분사'],
    prescriptionPrices: { ...(effectiveSettings?.prescription_prices || {}) },
    cryoPrescriptions: [...(effectiveSettings?.cryo_prescriptions || [])],
    cryoPrices: { ...(effectiveSettings?.cryo_prices || {}) },
    prescriptionColors: { ...(effectiveSettings?.prescription_colors || {}) },
    incentivePercentages: {
      ...(effectiveSettings?.prescription_incentive_percentages || {}),
    },
  };
}

function normalizeNewPrescriptionName(value) {
  const name = String(value || '').trim();
  if (!name) return '';
  return name.includes('신장분사') ? name : `${name}(신장분사)`;
}

export default function ShinjangSpraySettingsPanel({
  year,
  month,
  therapists = [],
  effectiveSettings,
  onSave,
}) {
  const initialDraft = useMemo(
    () => buildInitialDraft(effectiveSettings),
    [effectiveSettings]
  );
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
  const [draft, setDraft] = useState(initialDraft);
  const [draftTherapistNames, setDraftTherapistNames] = useState(effectiveTherapistNames);
  const [newPrescriptionName, setNewPrescriptionName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraft(initialDraft);
    setDraftTherapistNames(effectiveTherapistNames);
  }, [effectiveTherapistNames, initialDraft]);

  const sourceText = useMemo(() => {
    if (!effectiveSettings?.source_month_key) return '기존 신장분사 처방 설정을 사용 중입니다.';
    if (effectiveSettings.source_month_key === effectiveSettings.target_month_key) {
      return '이번 달에 직접 저장한 신장분사 처방·인센티브 설정입니다.';
    }
    return `${effectiveSettings.source_month_key} 설정을 이어받아 적용 중입니다.`;
  }, [effectiveSettings?.source_month_key, effectiveSettings?.target_month_key]);

  const updateMapValue = useCallback((field, prescription, value) => {
    setDraft((current) => ({
      ...current,
      [field]: {
        ...current[field],
        [prescription]: value,
      },
    }));
  }, []);

  const addPrescription = useCallback(() => {
    const prescription = normalizeNewPrescriptionName(newPrescriptionName);
    if (!prescription) return;
    setDraft((current) => {
      if (current.prescriptions.includes(prescription)) return current;
      return {
        ...current,
        prescriptions: [...current.prescriptions, prescription],
        prescriptionPrices: { ...current.prescriptionPrices, [prescription]: 0 },
        cryoPrices: { ...current.cryoPrices, [prescription]: 0 },
        prescriptionColors: {
          ...current.prescriptionColors,
          [prescription]: current.prescriptionColors[prescription] || '#0f766e',
        },
        incentivePercentages: { ...current.incentivePercentages, [prescription]: 0 },
      };
    });
    setNewPrescriptionName('');
  }, [newPrescriptionName]);

  const removePrescription = useCallback((prescription) => {
    setDraft((current) => {
      const removeMapKey = (source) => {
        const next = { ...source };
        delete next[prescription];
        return next;
      };
      return {
        ...current,
        prescriptions: current.prescriptions.filter((item) => item !== prescription),
        prescriptionPrices: removeMapKey(current.prescriptionPrices),
        cryoPrescriptions: current.cryoPrescriptions.filter((item) => item !== prescription),
        cryoPrices: removeMapKey(current.cryoPrices),
        prescriptionColors: removeMapKey(current.prescriptionColors),
        incentivePercentages: removeMapKey(current.incentivePercentages),
      };
    });
  }, []);

  const handleSave = async () => {
    const prescriptions = draft.prescriptions
      .map((prescription) => String(prescription || '').trim())
      .filter(Boolean);
    const buildNumberMap = (source) => Object.fromEntries(prescriptions.map((prescription) => [
      prescription,
      Math.max(0, Number(source?.[prescription]) || 0),
    ]));
    const prescriptionColors = Object.fromEntries(prescriptions.map((prescription) => [
      prescription,
      draft.prescriptionColors?.[prescription] || '#0f766e',
    ]));

    setIsSaving(true);
    try {
      await onSave({
        prescriptions,
        prescriptionPrices: buildNumberMap(draft.prescriptionPrices),
        cryoPrescriptions: draft.cryoPrescriptions.filter((prescription) => (
          prescriptions.includes(prescription)
        )),
        cryoPrices: buildNumberMap(draft.cryoPrices),
        prescriptionColors,
        prescriptionIncentivePercentages: buildNumberMap(draft.incentivePercentages),
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
          <h2>{year}년 {String(month).padStart(2, '0')}월 신장분사 설정</h2>
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
            <p>신장분사 현황·결산·신환에 표시할 치료사를 선택합니다.</p>
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
                    onChange={(event) => setDraftTherapistNames((current) => (
                      event.target.checked
                        ? [...current, name]
                        : current.filter((item) => item !== name)
                    ))}
                  />
                  <span>{therapist.displayName || name}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="shinjang-spray-settings-list">
        <p className="shinjang-spray-cryo-settings-note">
          처방별 금액·크라이오 차감·인센티브율을 각각 설정합니다.
        </p>
        <div className="shinjang-spray-settings-row shinjang-spray-settings-header-row">
          <span>처방 이름</span>
          <span>처방 단가</span>
          <span>크라이오</span>
          <span>크라이오 가격</span>
          <span>인센티브율</span>
          <span>색</span>
          <span />
        </div>
        {draft.prescriptions.map((prescription) => {
          const isCryo = draft.cryoPrescriptions.includes(prescription);
          return (
            <div className="shinjang-spray-settings-row" key={prescription}>
              <strong>{prescription}</strong>
              <label className="shinjang-spray-number-field">
                <input
                  type="number"
                  className="form-input"
                  min={0}
                  step={1000}
                  value={draft.prescriptionPrices[prescription] ?? 0}
                  aria-label={`${prescription} 처방 단가`}
                  onChange={(event) => updateMapValue('prescriptionPrices', prescription, event.target.value)}
                />
                <span>원</span>
              </label>
              <label className="shinjang-spray-cryo-toggle">
                <input
                  type="checkbox"
                  checked={isCryo}
                  aria-label={`${prescription} 크라이오 적용`}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    cryoPrescriptions: event.target.checked
                      ? [...current.cryoPrescriptions, prescription]
                      : current.cryoPrescriptions.filter((item) => item !== prescription),
                  }))}
                />
              </label>
              <label className="shinjang-spray-number-field">
                <input
                  type="number"
                  className="form-input"
                  min={0}
                  step={1000}
                  disabled={!isCryo}
                  value={draft.cryoPrices[prescription] ?? 0}
                  aria-label={`${prescription} 크라이오 가격`}
                  onChange={(event) => updateMapValue('cryoPrices', prescription, event.target.value)}
                />
                <span>원</span>
              </label>
              <label className="shinjang-spray-number-field">
                <input
                  type="number"
                  className="form-input"
                  min={0}
                  step={0.1}
                  value={draft.incentivePercentages[prescription] ?? 0}
                  aria-label={`${prescription} 인센티브율`}
                  onChange={(event) => updateMapValue('incentivePercentages', prescription, event.target.value)}
                />
                <span>%</span>
              </label>
              <input
                type="color"
                className="shinjang-spray-color-input"
                value={draft.prescriptionColors[prescription] || '#0f766e'}
                aria-label={`${prescription} 색`}
                onChange={(event) => updateMapValue('prescriptionColors', prescription, event.target.value)}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => removePrescription(prescription)}
              >
                삭제
              </button>
            </div>
          );
        })}
        <div className="shinjang-spray-add-row">
          <input
            className="form-input"
            value={newPrescriptionName}
            placeholder="+ 신장분사 처방"
            aria-label="신장분사 처방 이름"
            onChange={(event) => setNewPrescriptionName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              addPrescription();
            }}
          />
          <button
            type="button"
            className="shinjang-spray-add-button"
            aria-label="신장분사 처방 추가"
            onClick={addPrescription}
          >
            +
          </button>
        </div>
      </div>
    </section>
  );
}

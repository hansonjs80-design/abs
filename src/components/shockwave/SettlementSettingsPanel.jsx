import React, { useEffect, useMemo, useState } from 'react';
import { setMonthlySettlementSettings } from '../../lib/settlementSettings';
import { extractDoseTagFromPrescription } from '../../lib/schedulerContentFormat';

export default function SettlementSettingsPanel({
  type = 'shockwave',
  year,
  month,
  settings,
  effectiveSettings,
  onSave,
}) {
  const isManualTherapy = type === 'manual_therapy';

  const [draft, setDraft] = useState(() => ({
    prescriptions: effectiveSettings?.prescriptions || [],
    prescription_prices: effectiveSettings?.prescription_prices || {},
    prescription_colors: effectiveSettings?.prescription_colors || settings?.prescription_colors || {},
    incentive_percentage: effectiveSettings?.incentive_percentage ?? 0,
    dose_tags: effectiveSettings?.dose_tags || settings?.manual_therapy_dose_tags || {},
    shortcuts: effectiveSettings?.shortcuts || (isManualTherapy ? settings?.manual_therapy_shortcuts : settings?.shortcuts) || {},
  }));

  const title = isManualTherapy ? '도수치료 결산 설정' : '충격파 결산 설정';
  const addPlaceholder = isManualTherapy ? '+ 도수 처방' : '+ 처방';
  const sourceText = useMemo(() => {
    if (!effectiveSettings?.source_month_key) return '기존 기본 설정 사용 중';
    if (effectiveSettings.source_month_key === effectiveSettings.target_month_key) return '이번 달 직접 설정 사용 중';
    return `${effectiveSettings.source_month_key} 설정을 이어받아 적용 중`;
  }, [effectiveSettings?.source_month_key, effectiveSettings?.target_month_key]);

  useEffect(() => {
    setDraft({
      prescriptions: effectiveSettings?.prescriptions || [],
      prescription_prices: effectiveSettings?.prescription_prices || {},
      prescription_colors: effectiveSettings?.prescription_colors || settings?.prescription_colors || {},
      incentive_percentage: effectiveSettings?.incentive_percentage ?? 0,
      dose_tags: effectiveSettings?.dose_tags || settings?.manual_therapy_dose_tags || {},
      shortcuts: effectiveSettings?.shortcuts || (isManualTherapy ? settings?.manual_therapy_shortcuts : settings?.shortcuts) || {},
    });
  }, [effectiveSettings, settings?.prescription_colors, settings?.manual_therapy_dose_tags, settings?.shortcuts, settings?.manual_therapy_shortcuts, isManualTherapy]);

  /** 처방별 셀 태그 값을 반환 (사용자 지정 → 자동 추출 순) */
  const getDoseTag = (prescription) => {
    if (draft.dose_tags[prescription] !== undefined) return draft.dose_tags[prescription];
    return extractDoseTagFromPrescription(prescription);
  };

  const updatePrescription = (index, value) => {
    const nextValue = value.trim();
    setDraft((prev) => {
      const previousName = prev.prescriptions[index];
      const nextPrescriptions = prev.prescriptions.map((item, itemIndex) => (
        itemIndex === index ? value : item
      ));
      const nextPrices = { ...prev.prescription_prices };
      const nextDoseTags = { ...prev.dose_tags };
      if (nextValue && previousName && previousName !== nextValue) {
        nextPrices[nextValue] = nextPrices[previousName] ?? 0;
        delete nextPrices[previousName];
        const nextColors = { ...(prev.prescription_colors || {}) };
        nextColors[nextValue] = nextColors[previousName] || '#000000';
        delete nextColors[previousName];
        if (nextDoseTags[previousName] !== undefined) {
          nextDoseTags[nextValue] = nextDoseTags[previousName];
          delete nextDoseTags[previousName];
        }
        const nextShortcuts = { ...prev.shortcuts };
        if (nextShortcuts[previousName] !== undefined) {
          nextShortcuts[nextValue] = nextShortcuts[previousName];
          delete nextShortcuts[previousName];
        }
        return {
          ...prev,
          prescriptions: nextPrescriptions,
          prescription_prices: nextPrices,
          prescription_colors: nextColors,
          dose_tags: nextDoseTags,
          shortcuts: nextShortcuts,
        };
      }
      return { ...prev, prescriptions: nextPrescriptions, prescription_prices: nextPrices };
    });
  };

  const removePrescription = (index) => {
    setDraft((prev) => {
      const target = prev.prescriptions[index];
      const nextPrices = { ...prev.prescription_prices };
      const nextColors = { ...(prev.prescription_colors || {}) };
      const nextDoseTags = { ...prev.dose_tags };
      const nextShortcuts = { ...prev.shortcuts };
      delete nextPrices[target];
      delete nextColors[target];
      delete nextDoseTags[target];
      delete nextShortcuts[target];
      return {
        ...prev,
        prescriptions: prev.prescriptions.filter((_, itemIndex) => itemIndex !== index),
        prescription_prices: nextPrices,
        prescription_colors: nextColors,
        dose_tags: nextDoseTags,
        shortcuts: nextShortcuts,
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
        prescription_colors: {
          ...(prev.prescription_colors || {}),
          [nextValue]: prev.prescription_colors?.[nextValue] || '#000000',
        },
      };
    });
    return true;
  };

  const handleSave = async () => {
    const cleanedPrescriptions = draft.prescriptions.map((item) => String(item || '').trim()).filter(Boolean);
    const cleanedColors = cleanedPrescriptions.reduce((acc, prescription) => {
      if (draft.prescription_colors?.[prescription]) {
        acc[prescription] = draft.prescription_colors[prescription];
      }
      return acc;
    }, {});
    // 도수치료 태그: 자동 추출값과 같으면 저장하지 않음 (기본값 사용)
    const cleanedDoseTags = {};
    if (isManualTherapy) {
      cleanedPrescriptions.forEach((prescription) => {
        const customTag = draft.dose_tags[prescription];
        const autoTag = extractDoseTagFromPrescription(prescription);
        if (customTag !== undefined && customTag !== autoTag) {
          cleanedDoseTags[prescription] = customTag;
        }
      });
    }
    const cleanedShortcuts = {};
    cleanedPrescriptions.forEach(prescription => {
      const customShortcut = String(draft.shortcuts[prescription] || '').trim();
      if (customShortcut) {
        cleanedShortcuts[prescription] = customShortcut;
      }
    });

    const cleaned = {
      prescriptions: cleanedPrescriptions,
      prescription_prices: draft.prescription_prices,
      prescription_colors: cleanedColors,
      incentive_percentage: Number(draft.incentive_percentage) || 0,
      shortcuts: cleanedShortcuts,
      ...(isManualTherapy ? { dose_tags: cleanedDoseTags } : {}),
    };
    const monthly_settlement_settings = setMonthlySettlementSettings(settings, year, month, type, cleaned);
    const nextSettings = {
      ...settings,
      prescription_prices: {
        ...(settings?.prescription_prices || {}),
        ...cleaned.prescription_prices,
      },
      prescription_colors: {
        ...(settings?.prescription_colors || {}),
        ...cleaned.prescription_colors,
      },
      monthly_settlement_settings,
    };

    if (type === 'manual_therapy') {
      nextSettings.manual_therapy_prescriptions = cleaned.prescriptions;
      nextSettings.manual_therapy_incentive_percentage = cleaned.incentive_percentage;
      nextSettings.manual_therapy_dose_tags = { ...cleanedDoseTags };
      nextSettings.manual_therapy_shortcuts = { ...cleanedShortcuts };
    } else {
      nextSettings.prescriptions = cleaned.prescriptions;
      nextSettings.incentive_percentage = cleaned.incentive_percentage;
      nextSettings.shortcuts = { ...cleanedShortcuts };
    }

    await onSave(nextSettings);
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
            {isManualTherapy ? (
              <div className="settlement-settings-row settlement-settings-header-row manual-therapy-row">
                <span className="settlement-label" style={{ flex: '1 1 100px' }}>처방 이름</span>
                <span className="settlement-label" style={{ width: 64, textAlign: 'center' }}>셀 태그</span>
                <span className="settlement-label" style={{ width: 64, textAlign: 'center' }}>단축키</span>
                <span className="settlement-label" style={{ width: 110, textAlign: 'center' }}>단가</span>
                <span className="settlement-label" style={{ width: 32, textAlign: 'center' }}>색</span>
                <span style={{ width: 16 }}></span>
                <span style={{ width: 44 }}></span>
              </div>
            ) : (
              <div className="settlement-settings-row settlement-settings-header-row shockwave-row">
                <span className="settlement-label" style={{ flex: '1 1 100px' }}>처방 이름</span>
                <span className="settlement-label" style={{ width: 64, textAlign: 'center' }}>단축키</span>
                <span className="settlement-label" style={{ width: 110, textAlign: 'center' }}>단가</span>
                <span className="settlement-label" style={{ width: 32, textAlign: 'center' }}>색</span>
                <span style={{ width: 16 }}></span>
                <span style={{ width: 44 }}></span>
              </div>
            )}
            {draft.prescriptions.map((prescription, index) => {
              const doseTag = getDoseTag(prescription);
              return (
                <div key={`${prescription}-${index}`} className={`settlement-settings-row ${isManualTherapy ? 'manual-therapy-row' : 'shockwave-row'}`}>
                  <input
                    className="form-input settlement-prescription-input"
                    value={prescription}
                    onChange={(event) => updatePrescription(index, event.target.value)}
                  />
                  {isManualTherapy && (
                    <div className="settlement-dose-tag-group">
                      <input
                        className="form-input settlement-dose-tag-input"
                        value={doseTag}
                        placeholder="—"
                        title={doseTag ? `스케줄 셀에 "주한솔${doseTag}" 형태로 표시` : '셀 태그 없음 (이름만 표시)'}
                        onChange={(event) => {
                          const val = event.target.value.replace(/[^\d]/g, '').slice(0, 3);
                          setDraft((prev) => ({
                            ...prev,
                            dose_tags: { ...prev.dose_tags, [prescription]: val },
                          }));
                        }}
                      />
                      {doseTag && (
                        <span className="settlement-dose-tag-preview" title="셀 미리보기">
                          홍길동{doseTag}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="settlement-shortcut-group">
                    <span className="settlement-shortcut-prefix">Cmd+</span>
                    <input
                      className="form-input settlement-shortcut-input"
                      value={draft.shortcuts?.[prescription] || ''}
                      placeholder="—"
                      title="Cmd/Ctrl + 숫자 로 처방 단축키 설정"
                      maxLength={1}
                      onChange={(event) => {
                        const val = event.target.value.replace(/[^1-9]/g, '');
                        setDraft((prev) => ({
                          ...prev,
                          shortcuts: { ...(prev.shortcuts || {}), [prescription]: val },
                        }));
                      }}
                    />
                  </div>
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
                  <input
                    type="color"
                    className="settlement-color-input"
                    value={draft.prescription_colors?.[prescription] || '#000000'}
                    title={`${prescription} 스케줄러 글자색`}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDraft((prev) => ({
                        ...prev,
                        prescription_colors: {
                          ...(prev.prescription_colors || {}),
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
              );
            })}
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

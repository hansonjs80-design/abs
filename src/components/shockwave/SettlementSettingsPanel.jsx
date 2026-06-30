import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { setMonthlySettlementSettings } from '../../lib/settlementSettings';
import { extractDoseTagFromPrescription, normalizeDoseTagInput } from '../../lib/schedulerContentFormat';

export default function SettlementSettingsPanel({
  type = 'shockwave',
  year,
  month,
  settings,
  effectiveSettings,
  onSave,
}) {
  const isManualTherapy = type === 'manual_therapy';

  const buildInitialDraft = useCallback(() => ({
    prescriptions: effectiveSettings?.prescriptions || [],
    prescription_prices: effectiveSettings?.prescription_prices || {},
    prescription_colors: effectiveSettings?.prescription_colors || settings?.prescription_colors || {},
    incentive_percentage: effectiveSettings?.incentive_percentage ?? 0,
    dose_tags: effectiveSettings?.dose_tags || (isManualTherapy ? settings?.manual_therapy_dose_tags : settings?.dose_tags) || {},
    duration_minutes: effectiveSettings?.duration_minutes || (isManualTherapy ? settings?.manual_therapy_duration_minutes : settings?.duration_minutes) || {},
    visit_line_break_prescriptions: effectiveSettings?.visit_line_break_prescriptions || (
      isManualTherapy ? settings?.manual_therapy_visit_line_break_prescriptions : settings?.visit_line_break_prescriptions
    ) || [],
    hidden_prescriptions: effectiveSettings?.hidden_prescriptions || (
      isManualTherapy ? settings?.manual_therapy_hidden_prescriptions : settings?.hidden_prescriptions
    ) || [],
    shortcuts: effectiveSettings?.shortcuts || (isManualTherapy ? settings?.manual_therapy_shortcuts : settings?.shortcuts) || {},
  }), [
    effectiveSettings,
    isManualTherapy,
    settings?.dose_tags,
    settings?.duration_minutes,
    settings?.manual_therapy_dose_tags,
    settings?.manual_therapy_duration_minutes,
    settings?.manual_therapy_shortcuts,
    settings?.manual_therapy_visit_line_break_prescriptions,
    settings?.manual_therapy_hidden_prescriptions,
    settings?.hidden_prescriptions,
    settings?.prescription_colors,
    settings?.shortcuts,
    settings?.visit_line_break_prescriptions,
  ]);

  const [draft, setDraft] = useState(buildInitialDraft);
  const [newPrescriptionName, setNewPrescriptionName] = useState('');
  const [prescriptionRenameKeys, setPrescriptionRenameKeys] = useState({});
  const [draggedIndex, setDraggedIndex] = useState(null);

  const title = isManualTherapy ? '도수치료 결산 설정' : '충격파 결산 설정';
  const addPlaceholder = isManualTherapy ? '+ 도수 처방' : '+ 처방';
  const sourceText = useMemo(() => {
    if (!effectiveSettings?.source_month_key) return '기존 기본 설정 사용 중';
    if (effectiveSettings.source_month_key === effectiveSettings.target_month_key) return '이번 달 직접 설정 사용 중';
    return `${effectiveSettings.source_month_key} 설정을 이어받아 적용 중`;
  }, [effectiveSettings?.source_month_key, effectiveSettings?.target_month_key]);

  useEffect(() => {
    setDraft(buildInitialDraft());
  }, [buildInitialDraft]);

  // Drag and Drop handlers
  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.currentTarget);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    setDraft((prev) => {
      const nextPrescriptions = [...prev.prescriptions];
      const draggedItem = nextPrescriptions[draggedIndex];
      nextPrescriptions.splice(draggedIndex, 1);
      nextPrescriptions.splice(index, 0, draggedItem);
      return {
        ...prev,
        prescriptions: nextPrescriptions,
      };
    });
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  /** 처방별 셀 태그 값을 반환 (사용자 지정 → 자동 추출 순) */
  const getDoseTag = (prescription) => {
    if (draft.dose_tags[prescription] !== undefined) return draft.dose_tags[prescription];
    return extractDoseTagFromPrescription(prescription);
  };

  const renamePrescription = (index, rawValue) => {
    const nextValue = String(rawValue || '').trim();
    setDraft((prev) => {
      const previousName = prescriptionRenameKeys[index] || prev.prescriptions[index];
      if (!previousName) return prev;
      if (!nextValue) {
        return {
          ...prev,
          prescriptions: prev.prescriptions.map((item, itemIndex) => (
            itemIndex === index ? previousName : item
          )),
        };
      }
      if (nextValue !== previousName && prev.prescriptions.some((item, itemIndex) => itemIndex !== index && item === nextValue)) {
        return {
          ...prev,
          prescriptions: prev.prescriptions.map((item, itemIndex) => (
            itemIndex === index ? previousName : item
          )),
        };
      }
      const nextPrescriptions = prev.prescriptions.map((item, itemIndex) => (
        itemIndex === index ? nextValue : item
      ));
      const nextPrices = { ...prev.prescription_prices };
      const nextDoseTags = { ...prev.dose_tags };
      const nextDurations = { ...(prev.duration_minutes || {}) };
      const nextLineBreaks = new Set(prev.visit_line_break_prescriptions || []);
      const nextHidden = new Set(prev.hidden_prescriptions || []);
      if (previousName !== nextValue) {
        nextPrices[nextValue] = nextPrices[previousName] ?? 0;
        delete nextPrices[previousName];
        const nextColors = { ...(prev.prescription_colors || {}) };
        nextColors[nextValue] = nextColors[previousName] || '#000000';
        delete nextColors[previousName];
        if (nextDoseTags[previousName] !== undefined) {
          nextDoseTags[nextValue] = nextDoseTags[previousName];
          delete nextDoseTags[previousName];
        }
        if (nextDurations[previousName] !== undefined) {
          nextDurations[nextValue] = nextDurations[previousName];
          delete nextDurations[previousName];
        }
        if (nextLineBreaks.has(previousName)) {
          nextLineBreaks.delete(previousName);
          nextLineBreaks.add(nextValue);
        }
        if (nextHidden.has(previousName)) {
          nextHidden.delete(previousName);
          nextHidden.add(nextValue);
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
          duration_minutes: nextDurations,
          visit_line_break_prescriptions: Array.from(nextLineBreaks),
          hidden_prescriptions: Array.from(nextHidden),
          shortcuts: nextShortcuts,
        };
      }
      return { ...prev, prescriptions: nextPrescriptions, prescription_prices: nextPrices };
    });
    setPrescriptionRenameKeys((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const updatePrescriptionDraftName = (index, value) => {
    setDraft((prev) => ({
      ...prev,
      prescriptions: prev.prescriptions.map((item, itemIndex) => (
        itemIndex === index ? value : item
      )),
    }));
  };

  const removePrescription = (index) => {
    setDraft((prev) => {
      const target = prev.prescriptions[index];
      const nextPrices = { ...prev.prescription_prices };
      const nextColors = { ...(prev.prescription_colors || {}) };
      const nextDoseTags = { ...prev.dose_tags };
      const nextDurations = { ...(prev.duration_minutes || {}) };
      const nextShortcuts = { ...prev.shortcuts };
      delete nextPrices[target];
      delete nextColors[target];
      delete nextDoseTags[target];
      delete nextDurations[target];
      delete nextShortcuts[target];
      return {
        ...prev,
        prescriptions: prev.prescriptions.filter((_, itemIndex) => itemIndex !== index),
        prescription_prices: nextPrices,
        prescription_colors: nextColors,
        dose_tags: nextDoseTags,
        duration_minutes: nextDurations,
        visit_line_break_prescriptions: (prev.visit_line_break_prescriptions || []).filter((item) => item !== target),
        hidden_prescriptions: (prev.hidden_prescriptions || []).filter((item) => item !== target),
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
        dose_tags: {
          ...(prev.dose_tags || {}),
          [nextValue]: prev.dose_tags?.[nextValue] ?? extractDoseTagFromPrescription(nextValue),
        },
        duration_minutes: {
          ...(prev.duration_minutes || {}),
          [nextValue]: prev.duration_minutes?.[nextValue] ?? 0,
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
    const cleanedDoseTags = {};
    cleanedPrescriptions.forEach((prescription) => {
      const customTag = normalizeDoseTagInput(draft.dose_tags[prescription] ?? '');
      cleanedDoseTags[prescription] = customTag;
    });
    const cleanedDurations = {};
    cleanedPrescriptions.forEach((prescription) => {
      const duration = Number(draft.duration_minutes?.[prescription]) || 0;
      if (duration > 0) cleanedDurations[prescription] = duration;
    });
    const cleanedLineBreaks = (draft.visit_line_break_prescriptions || [])
      .filter((prescription) => cleanedPrescriptions.includes(prescription));
    const cleanedHiddenPrescriptions = (draft.hidden_prescriptions || [])
      .filter((prescription) => cleanedPrescriptions.includes(prescription));
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
      dose_tags: cleanedDoseTags,
      duration_minutes: cleanedDurations,
      visit_line_break_prescriptions: cleanedLineBreaks,
      hidden_prescriptions: cleanedHiddenPrescriptions,
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
      nextSettings.manual_therapy_duration_minutes = { ...cleanedDurations };
      nextSettings.manual_therapy_visit_line_break_prescriptions = [...cleanedLineBreaks];
      nextSettings.manual_therapy_hidden_prescriptions = [...cleanedHiddenPrescriptions];
      nextSettings.manual_therapy_shortcuts = { ...cleanedShortcuts };
    } else {
      nextSettings.prescriptions = cleaned.prescriptions;
      nextSettings.incentive_percentage = cleaned.incentive_percentage;
      nextSettings.dose_tags = { ...cleanedDoseTags };
      nextSettings.duration_minutes = { ...cleanedDurations };
      nextSettings.visit_line_break_prescriptions = [...cleanedLineBreaks];
      nextSettings.hidden_prescriptions = [...cleanedHiddenPrescriptions];
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
            <div className={`settlement-settings-row settlement-settings-header-row ${isManualTherapy ? 'manual-therapy-row' : 'shockwave-row'}`}>
              <span></span>
              <span className="settlement-label">처방 이름</span>
              <span className="settlement-label">셀 태그</span>
              <span className="settlement-label">단축키</span>
              <span className="settlement-label">치료시간</span>
              <span className="settlement-label">회차 줄바꿈</span>
              <span className="settlement-label">숨김</span>
              <span className="settlement-label">단가</span>
              <span className="settlement-label">색</span>
              <span></span>
              <span></span>
            </div>
            {draft.prescriptions.map((prescription, index) => {
              const doseTag = getDoseTag(prescription);
              const isHidden = (draft.hidden_prescriptions || []).includes(prescription);
              return (
                <div
                  key={`${prescription}-${index}`}
                  className={`settlement-settings-row ${isManualTherapy ? 'manual-therapy-row' : 'shockwave-row'} ${draggedIndex === index ? 'dragging' : ''}`}
                  draggable="true"
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                >
                  <div className="settlement-drag-handle" title="드래그하여 순서 조정">
                    ⋮⋮
                  </div>
                  <input
                    className="form-input settlement-prescription-input"
                    value={prescription}
                    onFocus={() => {
                      setPrescriptionRenameKeys((prev) => ({
                        ...prev,
                        [index]: prev[index] || prescription,
                      }));
                    }}
                    onChange={(event) => updatePrescriptionDraftName(index, event.target.value)}
                    onBlur={(event) => renamePrescription(index, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        renamePrescription(index, event.currentTarget.value);
                        event.currentTarget.blur();
                      }
                    }}
                  />
                  <div className="settlement-dose-tag-group">
                    <input
                      className="form-input settlement-dose-tag-input"
                      value={doseTag}
                      placeholder="—"
                      title={doseTag ? `스케줄 셀에 "주한솔${doseTag}" 형태로 표시` : '셀 태그 없음 (이름만 표시)'}
                      onChange={(event) => {
                        setDraft((prev) => ({
                          ...prev,
                          dose_tags: { ...prev.dose_tags, [prescription]: event.target.value },
                        }));
                      }}
                      onBlur={(event) => {
                        const val = normalizeDoseTagInput(event.target.value);
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
                  <div className="settlement-shortcut-group">
                    <span className="settlement-shortcut-prefix">Cmd+</span>
                    <input
                      className="form-input settlement-shortcut-input"
                      value={draft.shortcuts?.[prescription] || ''}
                      placeholder="—"
                      title="Cmd/Ctrl + 숫자/영문으로 처방 단축키 설정"
                      maxLength={1}
                      onChange={(event) => {
                        const val = event.target.value.replace(/[^1-9a-zA-Z]/g, '').toUpperCase();
                        setDraft((prev) => ({
                          ...prev,
                          shortcuts: { ...(prev.shortcuts || {}), [prescription]: val },
                        }));
                      }}
                    />
                  </div>
                  <div className="settlement-duration-group">
                    <input
                      type="number"
                      className="form-input settlement-duration-input"
                      min={0}
                      step={10}
                      value={draft.duration_minutes?.[prescription] ?? ''}
                      placeholder="0"
                      title="스케줄 셀 자동 병합 시간"
                      onChange={(event) => {
                        const value = Math.max(0, Number(event.target.value) || 0);
                        setDraft((prev) => ({
                          ...prev,
                          duration_minutes: {
                            ...(prev.duration_minutes || {}),
                            [prescription]: value,
                          },
                        }));
                      }}
                    />
                    <span className="settlement-duration-unit">분</span>
                  </div>
                  <label className="settlement-linebreak-toggle" title="회차 표시를 다음 줄로 내림">
                    <input
                      type="checkbox"
                      checked={(draft.visit_line_break_prescriptions || []).includes(prescription)}
                      onChange={(event) => {
                        setDraft((prev) => {
                          const next = new Set(prev.visit_line_break_prescriptions || []);
                          if (event.target.checked) next.add(prescription);
                          else next.delete(prescription);
                          return {
                            ...prev,
                            visit_line_break_prescriptions: Array.from(next),
                          };
                        });
                      }}
                    />
                  </label>
                  <label className="settlement-hidden-toggle" title="스케줄 화면 처방 선택 목록에서 숨김">
                    <input
                      type="checkbox"
                      checked={isHidden}
                      onChange={(event) => {
                        setDraft((prev) => {
                          const next = new Set(prev.hidden_prescriptions || []);
                          if (event.target.checked) next.add(prescription);
                          else next.delete(prescription);
                          return {
                            ...prev,
                            hidden_prescriptions: Array.from(next),
                          };
                        });
                      }}
                    />
                  </label>
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
            <div className="settlement-add-row">
              <input
                className="form-input settlement-add-input"
                placeholder={addPlaceholder}
                value={newPrescriptionName}
                onChange={(event) => setNewPrescriptionName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  if (addPrescription(newPrescriptionName)) setNewPrescriptionName('');
                }}
              />
              <button
                type="button"
                className="settlement-add-button"
                aria-label="처방 추가"
                onClick={() => {
                  if (addPrescription(newPrescriptionName)) setNewPrescriptionName('');
                }}
              >
                +
              </button>
            </div>
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

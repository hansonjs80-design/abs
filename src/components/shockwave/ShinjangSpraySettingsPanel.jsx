import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { normalizeScheduleShortcutValue } from '../../lib/scheduleKeyboardUtils';
import {
  extractDoseTagFromPrescription,
  normalizeDoseTagInput,
} from '../../lib/schedulerContentFormat';

const DEFAULT_PRESCRIPTION_COLOR = '#0f766e';

function normalizeDurationStepMinutes(value) {
  const numeric = Number(value) || 0;
  return Math.max(0, Math.round(numeric / 5) * 5);
}

function normalizePrescriptionName(value) {
  const name = String(value || '').trim();
  if (!name) return '';
  return name.includes('신장분사') ? name : `${name}(신장분사)`;
}

function buildInitialDraft(effectiveSettings) {
  return {
    prescriptions: Array.isArray(effectiveSettings?.prescriptions)
      ? effectiveSettings.prescriptions.filter(Boolean)
      : ['신장분사'],
    prescription_prices: { ...(effectiveSettings?.prescription_prices || {}) },
    cryo_prescriptions: [...(effectiveSettings?.cryo_prescriptions || [])],
    cryo_prices: { ...(effectiveSettings?.cryo_prices || {}) },
    prescription_colors: { ...(effectiveSettings?.prescription_colors || {}) },
    prescription_incentive_percentages: {
      ...(effectiveSettings?.prescription_incentive_percentages || {}),
    },
    shortcuts: { ...(effectiveSettings?.shortcuts || {}) },
    dose_tags: { ...(effectiveSettings?.dose_tags || {}) },
    duration_minutes: { ...(effectiveSettings?.duration_minutes || {}) },
    visit_line_break_prescriptions: [
      ...(effectiveSettings?.visit_line_break_prescriptions || []),
    ],
    hidden_prescriptions: [...(effectiveSettings?.hidden_prescriptions || [])],
  };
}

function renameMapKey(source, previousName, nextName, fallbackValue) {
  const next = { ...(source || {}) };
  if (previousName === nextName) return next;
  if (Object.prototype.hasOwnProperty.call(next, previousName)) {
    next[nextName] = next[previousName];
  } else if (fallbackValue !== undefined) {
    next[nextName] = fallbackValue;
  }
  delete next[previousName];
  return next;
}

function renameListValue(source, previousName, nextName) {
  return (Array.isArray(source) ? source : []).map((item) => (
    item === previousName ? nextName : item
  ));
}

function renameDraftPrescription(draft, index, previousName, nextName) {
  if (!previousName || !nextName || previousName === nextName) {
    return {
      ...draft,
      prescriptions: draft.prescriptions.map((item, itemIndex) => (
        itemIndex === index ? nextName || previousName : item
      )),
    };
  }

  return {
    ...draft,
    prescriptions: draft.prescriptions.map((item, itemIndex) => (
      itemIndex === index ? nextName : item
    )),
    prescription_prices: renameMapKey(draft.prescription_prices, previousName, nextName, 0),
    cryo_prescriptions: renameListValue(draft.cryo_prescriptions, previousName, nextName),
    cryo_prices: renameMapKey(draft.cryo_prices, previousName, nextName, 0),
    prescription_colors: renameMapKey(
      draft.prescription_colors,
      previousName,
      nextName,
      DEFAULT_PRESCRIPTION_COLOR
    ),
    prescription_incentive_percentages: renameMapKey(
      draft.prescription_incentive_percentages,
      previousName,
      nextName,
      0
    ),
    shortcuts: renameMapKey(draft.shortcuts, previousName, nextName, ''),
    dose_tags: renameMapKey(
      draft.dose_tags,
      previousName,
      nextName,
      extractDoseTagFromPrescription(nextName)
    ),
    duration_minutes: renameMapKey(draft.duration_minutes, previousName, nextName),
    visit_line_break_prescriptions: renameListValue(
      draft.visit_line_break_prescriptions,
      previousName,
      nextName
    ),
    hidden_prescriptions: renameListValue(draft.hidden_prescriptions, previousName, nextName),
  };
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
  const [prescriptionRenameKeys, setPrescriptionRenameKeys] = useState({});
  const [prescriptionOrigins, setPrescriptionOrigins] = useState(() => Object.fromEntries(
    initialDraft.prescriptions.map((prescription) => [prescription, prescription])
  ));
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const isAppleShortcutPlatform = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform || ''} ${navigator.userAgent || ''}`);
  }, []);
  const shortcutPrefix = isAppleShortcutPlatform ? 'Cmd+Shift+' : 'Ctrl+Shift+';
  const shortcutTitle = `${isAppleShortcutPlatform ? 'Command' : 'Ctrl'} + Shift + 숫자/영문으로 신장분사 처방 단축키 설정`;

  useEffect(() => {
    setDraft(initialDraft);
    setDraftTherapistNames(effectiveTherapistNames);
    setPrescriptionRenameKeys({});
    setPrescriptionOrigins(Object.fromEntries(
      initialDraft.prescriptions.map((prescription) => [prescription, prescription])
    ));
  }, [effectiveTherapistNames, initialDraft]);

  const sourceText = useMemo(() => {
    if (!effectiveSettings?.source_month_key) return '기존 신장분사 처방 설정을 사용 중입니다.';
    if (effectiveSettings.source_month_key === effectiveSettings.target_month_key) {
      return '이번 달에 직접 저장한 신장분사 처방·인센티브 설정입니다.';
    }
    return `${effectiveSettings.source_month_key} 설정을 이어받아 적용 중입니다.`;
  }, [effectiveSettings?.source_month_key, effectiveSettings?.target_month_key]);

  const movePrescription = useCallback((index, direction) => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    setDraft((current) => {
      if (targetIndex < 0 || targetIndex >= current.prescriptions.length) return current;
      const prescriptions = [...current.prescriptions];
      [prescriptions[index], prescriptions[targetIndex]] = [prescriptions[targetIndex], prescriptions[index]];
      return { ...current, prescriptions };
    });
    setPrescriptionRenameKeys({});
    setDraggedIndex(null);
  }, []);

  const handleDragStart = useCallback((event, index) => {
    setDraggedIndex(index);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }, []);

  const handleDragOver = useCallback((event, index) => {
    event.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    setDraft((current) => {
      const prescriptions = [...current.prescriptions];
      const [draggedPrescription] = prescriptions.splice(draggedIndex, 1);
      prescriptions.splice(index, 0, draggedPrescription);
      return { ...current, prescriptions };
    });
    setPrescriptionRenameKeys({});
    setDraggedIndex(index);
  }, [draggedIndex]);

  const finishPrescriptionRename = useCallback((index, rawValue) => {
    const previousName = prescriptionRenameKeys[index] || draft.prescriptions[index];
    let nextName = normalizePrescriptionName(rawValue);
    if (
      !nextName
      || (nextName !== previousName && draft.prescriptions.some((item, itemIndex) => (
        itemIndex !== index && normalizePrescriptionName(item) === nextName
      )))
    ) {
      nextName = previousName;
    }

    setDraft((current) => renameDraftPrescription(current, index, previousName, nextName));
    if (previousName !== nextName) {
      setPrescriptionOrigins((current) => {
        const next = { ...current };
        const originalName = next[previousName] || previousName;
        delete next[previousName];
        next[nextName] = originalName;
        return next;
      });
    }
    setPrescriptionRenameKeys((current) => {
      const next = { ...current };
      delete next[index];
      return next;
    });
  }, [draft.prescriptions, prescriptionRenameKeys]);

  const addPrescription = useCallback(() => {
    const prescription = normalizePrescriptionName(newPrescriptionName);
    if (!prescription || draft.prescriptions.includes(prescription)) return;
    setDraft((current) => ({
      ...current,
      prescriptions: [...current.prescriptions, prescription],
      prescription_prices: { ...current.prescription_prices, [prescription]: 0 },
      cryo_prices: { ...current.cryo_prices, [prescription]: 0 },
      prescription_colors: {
        ...current.prescription_colors,
        [prescription]: DEFAULT_PRESCRIPTION_COLOR,
      },
      prescription_incentive_percentages: {
        ...current.prescription_incentive_percentages,
        [prescription]: 0,
      },
      shortcuts: { ...current.shortcuts, [prescription]: '' },
      dose_tags: {
        ...current.dose_tags,
        [prescription]: extractDoseTagFromPrescription(prescription),
      },
    }));
    setPrescriptionOrigins((current) => ({ ...current, [prescription]: prescription }));
    setNewPrescriptionName('');
  }, [draft.prescriptions, newPrescriptionName]);

  const removePrescription = useCallback((index) => {
    const prescription = draft.prescriptions[index];
    if (!prescription) return;
    const removeMapKey = (source) => {
      const next = { ...(source || {}) };
      delete next[prescription];
      return next;
    };
    setDraft((current) => ({
      ...current,
      prescriptions: current.prescriptions.filter((_, itemIndex) => itemIndex !== index),
      prescription_prices: removeMapKey(current.prescription_prices),
      cryo_prescriptions: current.cryo_prescriptions.filter((item) => item !== prescription),
      cryo_prices: removeMapKey(current.cryo_prices),
      prescription_colors: removeMapKey(current.prescription_colors),
      prescription_incentive_percentages: removeMapKey(
        current.prescription_incentive_percentages
      ),
      shortcuts: removeMapKey(current.shortcuts),
      dose_tags: removeMapKey(current.dose_tags),
      duration_minutes: removeMapKey(current.duration_minutes),
      visit_line_break_prescriptions: current.visit_line_break_prescriptions.filter(
        (item) => item !== prescription
      ),
      hidden_prescriptions: current.hidden_prescriptions.filter((item) => item !== prescription),
    }));
    setPrescriptionOrigins((current) => {
      const next = { ...current };
      delete next[prescription];
      return next;
    });
  }, [draft.prescriptions]);

  const handleSave = async () => {
    const prescriptions = draft.prescriptions
      .map(normalizePrescriptionName)
      .filter(Boolean);
    const buildNumberMap = (source) => Object.fromEntries(prescriptions.map((prescription) => [
      prescription,
      Math.max(0, Number(source?.[prescription]) || 0),
    ]));
    const prescriptionColors = Object.fromEntries(prescriptions.map((prescription) => [
      prescription,
      draft.prescription_colors?.[prescription] || DEFAULT_PRESCRIPTION_COLOR,
    ]));
    const doseTags = Object.fromEntries(prescriptions.map((prescription) => [
      prescription,
      normalizeDoseTagInput(draft.dose_tags?.[prescription] ?? ''),
    ]));
    const durationMinutes = Object.fromEntries(prescriptions
      .map((prescription) => [
        prescription,
        normalizeDurationStepMinutes(draft.duration_minutes?.[prescription]),
      ])
      .filter(([, duration]) => duration > 0));
    const shortcuts = Object.fromEntries(prescriptions.map((prescription) => [
      prescription,
      normalizeScheduleShortcutValue(draft.shortcuts?.[prescription] || '')
        .replace(/[^1-9A-Z]/g, ''),
    ]));
    const prescriptionRenames = prescriptions
      .map((prescription) => ({
        from: prescriptionOrigins[prescription] || prescription,
        to: prescription,
      }))
      .filter(({ from, to }) => from !== to);

    setIsSaving(true);
    try {
      await onSave({
        prescriptions,
        prescriptionPrices: buildNumberMap(draft.prescription_prices),
        cryoPrescriptions: draft.cryo_prescriptions.filter((prescription) => (
          prescriptions.includes(prescription)
        )),
        cryoPrices: buildNumberMap(draft.cryo_prices),
        prescriptionColors,
        prescriptionIncentivePercentages: buildNumberMap(
          draft.prescription_incentive_percentages
        ),
        shortcuts,
        doseTags,
        durationMinutes,
        visitLineBreakPrescriptions: draft.visit_line_break_prescriptions.filter(
          (prescription) => prescriptions.includes(prescription)
        ),
        hiddenPrescriptions: draft.hidden_prescriptions.filter(
          (prescription) => prescriptions.includes(prescription)
        ),
        prescriptionRenames,
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
          처방별 태그·단축키·치료시간·크라이오 차감·인센티브율을 각각 설정합니다.
          처방명을 바꾸면 이번 달 스케줄의 기존 처방명도 함께 변경됩니다.
        </p>
        <div className="settlement-settings-row settlement-settings-header-row shinjang-spray-detail-row shinjang-spray-settings-header-row">
          <span className="settlement-label settlement-order-label">순서</span>
          <span className="settlement-label">처방 이름</span>
          <span className="settlement-label">셀 태그</span>
          <span className="settlement-label">단축키</span>
          <span className="settlement-label">치료시간</span>
          <span className="settlement-label">회차 줄바꿈</span>
          <span className="settlement-label">숨김</span>
          <span className="settlement-label">크라이오</span>
          <span className="settlement-label">단가</span>
          <span className="settlement-label">크라이오 가격</span>
          <span className="settlement-label">인센티브율</span>
          <span className="settlement-label">색</span>
          <span />
        </div>
        {draft.prescriptions.map((prescription, index) => {
          const doseTag = draft.dose_tags[prescription] !== undefined
            ? draft.dose_tags[prescription]
            : extractDoseTagFromPrescription(prescription);
          const isCryo = draft.cryo_prescriptions.includes(prescription);
          const isHidden = draft.hidden_prescriptions.includes(prescription);
          return (
            <div
              className={`settlement-settings-row shinjang-spray-detail-row${draggedIndex === index ? ' dragging' : ''}`}
              key={`shinjang-prescription-${index}`}
              draggable="true"
              onDragStart={(event) => handleDragStart(event, index)}
              onDragOver={(event) => handleDragOver(event, index)}
              onDragEnd={() => setDraggedIndex(null)}
            >
              <div className="settlement-order-controls">
                <button
                  type="button"
                  className="settlement-order-button"
                  aria-label={`${prescription} 위로 이동`}
                  title="위로 이동"
                  disabled={index === 0}
                  draggable="false"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    movePrescription(index, 'up');
                  }}
                >
                  <ArrowUp size={13} strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  className="settlement-order-button"
                  aria-label={`${prescription} 아래로 이동`}
                  title="아래로 이동"
                  disabled={index === draft.prescriptions.length - 1}
                  draggable="false"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    movePrescription(index, 'down');
                  }}
                >
                  <ArrowDown size={13} strokeWidth={2.5} />
                </button>
                <div className="settlement-drag-handle" title="드래그하여 순서 조정">⋮⋮</div>
              </div>
              <input
                className="form-input settlement-prescription-input"
                value={prescription}
                aria-label={`${prescription} 처방 이름`}
                onFocus={() => setPrescriptionRenameKeys((current) => ({
                  ...current,
                  [index]: current[index] || prescription,
                }))}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  prescriptions: current.prescriptions.map((item, itemIndex) => (
                    itemIndex === index ? event.target.value : item
                  )),
                }))}
                onBlur={(event) => finishPrescriptionRename(index, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  event.currentTarget.blur();
                }}
              />
              <div className="settlement-dose-tag-group">
                <input
                  className="form-input settlement-dose-tag-input"
                  value={doseTag}
                  placeholder="—"
                  aria-label={`${prescription} 셀 태그`}
                  title={doseTag ? `스케줄 셀에 "홍길동${doseTag}" 형태로 표시` : '셀 태그 없음 (이름만 표시)'}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    dose_tags: { ...current.dose_tags, [prescription]: event.target.value },
                  }))}
                  onBlur={(event) => setDraft((current) => ({
                    ...current,
                    dose_tags: {
                      ...current.dose_tags,
                      [prescription]: normalizeDoseTagInput(event.target.value),
                    },
                  }))}
                />
                {doseTag && (
                  <span className="settlement-dose-tag-preview" title="셀 미리보기">
                    홍길동{doseTag}
                  </span>
                )}
              </div>
              <div className="settlement-shortcut-group">
                <span className="settlement-shortcut-prefix">{shortcutPrefix}</span>
                <input
                  className="form-input settlement-shortcut-input"
                  value={draft.shortcuts[prescription] || ''}
                  placeholder="—"
                  title={shortcutTitle}
                  aria-label={`${prescription} 단축키`}
                  maxLength={1}
                  onChange={(event) => {
                    const value = normalizeScheduleShortcutValue(event.target.value)
                      .replace(/[^1-9A-Z]/g, '');
                    setDraft((current) => ({
                      ...current,
                      shortcuts: { ...current.shortcuts, [prescription]: value },
                    }));
                  }}
                />
              </div>
              <div className="settlement-duration-group">
                <input
                  type="number"
                  className="form-input settlement-duration-input"
                  min={0}
                  step={5}
                  value={draft.duration_minutes[prescription] ?? ''}
                  placeholder="0"
                  title="스케줄 셀 자동 병합 시간"
                  aria-label={`${prescription} 치료시간`}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    duration_minutes: {
                      ...current.duration_minutes,
                      [prescription]: Math.max(0, Number(event.target.value) || 0),
                    },
                  }))}
                />
                <span className="settlement-duration-unit">분</span>
              </div>
              <label className="settlement-linebreak-toggle" title="회차 표시를 다음 줄로 내림">
                <input
                  type="checkbox"
                  aria-label={`${prescription} 회차 줄바꿈`}
                  checked={draft.visit_line_break_prescriptions.includes(prescription)}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    visit_line_break_prescriptions: event.target.checked
                      ? [...current.visit_line_break_prescriptions, prescription]
                      : current.visit_line_break_prescriptions.filter((item) => item !== prescription),
                  }))}
                />
              </label>
              <label className="settlement-hidden-toggle" title="스케줄 화면 처방 선택 목록에서 숨김">
                <input
                  type="checkbox"
                  aria-label={`${prescription} 숨김`}
                  checked={isHidden}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    hidden_prescriptions: event.target.checked
                      ? [...current.hidden_prescriptions, prescription]
                      : current.hidden_prescriptions.filter((item) => item !== prescription),
                  }))}
                />
              </label>
              <label className="settlement-cryo-toggle" title="이 처방에 크라이오 치료를 함께 적용">
                <input
                  type="checkbox"
                  checked={isCryo}
                  aria-label={`${prescription} 크라이오 적용`}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    cryo_prescriptions: event.target.checked
                      ? [...current.cryo_prescriptions, prescription]
                      : current.cryo_prescriptions.filter((item) => item !== prescription),
                  }))}
                />
              </label>
              <div className="settlement-price-group">
                <input
                  type="number"
                  className="form-input settlement-price-input"
                  min={0}
                  step={1000}
                  value={draft.prescription_prices[prescription] ?? 0}
                  aria-label={`${prescription} 처방 단가`}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    prescription_prices: {
                      ...current.prescription_prices,
                      [prescription]: event.target.value,
                    },
                  }))}
                />
                <span className="settlement-settings-unit">원</span>
              </div>
              <div className={`settlement-price-group settlement-cryo-price-group${isCryo ? '' : ' is-disabled'}`}>
                <input
                  type="number"
                  className="form-input settlement-price-input settlement-cryo-price-input"
                  min={0}
                  step={1000}
                  disabled={!isCryo}
                  value={draft.cryo_prices[prescription] ?? 0}
                  aria-label={`${prescription} 크라이오 가격`}
                  title={isCryo ? '크라이오 추가 가격' : '크라이오를 선택하면 가격을 입력할 수 있습니다.'}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    cryo_prices: {
                      ...current.cryo_prices,
                      [prescription]: event.target.value,
                    },
                  }))}
                />
                <span className="settlement-settings-unit">원</span>
              </div>
              <div className="shinjang-spray-incentive-field">
                <input
                  type="number"
                  className="form-input settlement-price-input"
                  min={0}
                  step={0.1}
                  value={draft.prescription_incentive_percentages[prescription] ?? 0}
                  aria-label={`${prescription} 인센티브율`}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    prescription_incentive_percentages: {
                      ...current.prescription_incentive_percentages,
                      [prescription]: event.target.value,
                    },
                  }))}
                />
                <span className="settlement-settings-unit">%</span>
              </div>
              <input
                type="color"
                className="settlement-color-input"
                value={draft.prescription_colors[prescription] || DEFAULT_PRESCRIPTION_COLOR}
                aria-label={`${prescription} 색`}
                title={`${prescription} 스케줄러 글자색`}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  prescription_colors: {
                    ...current.prescription_colors,
                    [prescription]: event.target.value,
                  },
                }))}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => removePrescription(index)}
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

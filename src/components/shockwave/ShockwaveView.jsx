import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { flushSync } from 'react-dom';
import { useSchedule } from '../../contexts/ScheduleContext';

import { getTodayKST, isSameDate } from '../../lib/calendarUtils';
import { normalizeNameForMatch } from '../../lib/memoParser';
import { buildBlankScheduleCleanupPayload, sanitizeBlankScheduleCellData } from '../../lib/scheduleBlankCellCleanupUtils';
import { markIntentionalClearPayload } from '../../lib/scheduleMergeUtils';
import { buildClearReservationGroupPayload, getReservationGroupFromMergeSpan, selectionHasReservationGroup } from '../../lib/scheduleReservationGroupUtils';
import { isTreatmentCancelBg, isTreatmentCompleteBg } from '../../lib/scheduleStatusUtils';
import { getManualTherapyRowSpan } from '../../lib/manualTherapyMergeUtils';
import { buildManualTherapyAutoMergePayload } from '../../lib/scheduleManualTherapyAutoMergeUtils';
import {
  get4060PrescriptionFromContent,
  has4060Pattern,
  normalizeConfiguredDoseTagInContent,
  normalize4060StarOrder,
  updateDoseTagForPrescriptionContent,
} from '../../lib/schedulerContentFormat';
import { getEffectiveSettlementSettings } from '../../lib/settlementSettings';
import { getPrescriptionFromConfiguredDoseTag, getPrescriptionScheduleSettings } from '../../lib/prescriptionScheduleSettings';
import { DAY_NAMES, getMonthlyDayOverrides } from '../../lib/schedulerOperatingHours';
import { useToast } from '../common/Toast';
import { useAuth } from '../../contexts/AuthContext';
import { isAdminUser } from '../../lib/authPermissions';
import MonthlyTherapistConfig from './MonthlyTherapistConfig';
import SchedulerPatientSelector from './SchedulerPatientSelector';
import BodyPartKeyboardPanel from './BodyPartKeyboardPanel';
import useContextMenuPositioning from './useContextMenuPositioning';
import usePatientHistoryActions from './usePatientHistoryActions';
import useSchedulerAutoText from './useSchedulerAutoText';
import useScheduleClipboardActions from './useScheduleClipboardActions';
import useScheduleContextMenuActions from './useScheduleContextMenuActions';
import useScheduleContextMenuOpening from './useScheduleContextMenuOpening';
import useScheduleGlobalEvents from './useScheduleGlobalEvents';
import useScheduleKeyboardActions from './useScheduleKeyboardActions';
import useScheduleMergeActions from './useScheduleMergeActions';
import useSchedulePendingPersistence from './useSchedulePendingPersistence';
import useScheduleImmediateState from './useScheduleImmediateState';
import useScheduleResizeState from './useScheduleResizeState';
import useScheduleSelectionModel from './useScheduleSelectionModel';
import useScheduleStatusActions from './useScheduleStatusActions';
import useStaffScheduleState from './useStaffScheduleState';
import useScheduleTodayNavigation from './useScheduleTodayNavigation';
import useScheduleTimeSlots from './useScheduleTimeSlots';
import useScheduleUndoActions from './useScheduleUndoActions';
import useScheduleViewState from './useScheduleViewState';
import {
  HORIZONTAL_BORDER_COLOR,
  TIME_COL_WIDTH,
  TREATMENT_COMPLETE_BG,
  TREATMENT_CANCEL_BG,
  SCHEDULER_HOLIDAY_BG,
  getPendingDraftId,
  getShockwaveScheduleScrollKey,
  readDeletedScheduleDrafts,
  rememberDeletedScheduleDraft,
  rememberPendingScheduleDraft,
  removeDeletedScheduleDraft,
  removePendingScheduleDraft,
  splitBodyParts,
  normalizeBodyPartKey,
  parseSchedulerPatientIdentity,
  normalizeSchedulerVisitSuffix,
  getSchedulerVisitInputValue,
  normalizeVisitInputValue,
  applyVisitCountToSchedulerContent,
  stepVisitShortcutInputValue,
  isOnlySchedulerVisitSuffixChange,
  getMemoListFromMergeSpan,
  stepReservationTimeWithinCellBase,
  buildMergeSpanWithReservationTime,
  isUndoShortcutEvent,
  buildSchedulerCellDisplay,
  buildSchedulerMemoSortKey,
  getNonVisitParentheticalSuffix,
  addBodyPartToMap,
} from '../../lib/schedulerUtils';

const PATIENT_HISTORY_GROUPS = [
  { key: 'shockwave', label: '충격파 내역' },
  { key: 'manual', label: '도수치료 내역' },
];

const stepContextMenuVisitValue = (value, delta) => {
  const normalized = normalizeVisitInputValue(value);

  if (!normalized) {
    if (delta > 0) return '*';
    if (delta < 0) return '-';
    return '';
  }

  let currentIndex = 0;
  if (normalized === '-') currentIndex = 0;
  else if (normalized === '*') currentIndex = 1;
  else currentIndex = (parseInt(normalized, 10) || 1) + 1;

  const nextIndex = currentIndex + delta;

  if (nextIndex <= 0) return '-';
  if (nextIndex === 1) return '*';
  return String(nextIndex - 1);
};

const PATIENT_HISTORY_ALL_BODY_FILTER = '__all__';
const PATIENT_HISTORY_EMPTY_BODY_FILTER = '__empty__';

const HIDDEN_BODY_PART_OPTIONS_STORAGE_KEY = 'shockwave-hidden-body-part-options-by-patient';
const EMPTY_SCHEDULE_MERGE_SPAN = { rowSpan: 1, colSpan: 1, mergedInto: null };
const isComposingInputEvent = (event) => Boolean(
  event?.nativeEvent?.isComposing ||
  event?.isComposing ||
  event?.keyCode === 229
);

function saveSchedulerInputValueOnce({
  event,
  input,
  editDraftRef,
  skipNextEditBlurSaveRef,
  onSave,
}) {
  event?.preventDefault?.();
  event?.stopPropagation?.();

  const targetInput = input || event?.currentTarget || event?.target;
  const value = editDraftRef.current?.value ?? targetInput?.value ?? '';
  skipNextEditBlurSaveRef.current = true;
  targetInput?.blur?.();
  editDraftRef.current = null;
  if (String(value || '').trim()) onSave(value);
}

function saveSchedulerInputAfterComposition({
  event,
  input,
  editDraftRef,
  skipNextEditBlurSaveRef,
  onSave,
}) {
  event?.preventDefault?.();
  event?.stopPropagation?.();

  const targetInput = input || event?.currentTarget || event?.target;
  let saved = false;
  let fallbackTimer = null;
  const save = () => {
    if (saved) return;
    saved = true;
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    targetInput?.removeEventListener?.('compositionend', save);
    window.requestAnimationFrame(() => {
      const value = targetInput?.value ?? editDraftRef.current?.value ?? '';
      skipNextEditBlurSaveRef.current = true;
      targetInput?.blur?.();
      editDraftRef.current = null;
      if (String(value || '').trim()) onSave(value);
    });
  };

  targetInput?.addEventListener?.('compositionend', save, { once: true });
  fallbackTimer = window.setTimeout(save, 120);
}

function getPlainTextDefaultRowSpan({ intervalMinutes, timeLabelIntervalMinutes }) {
  const gridInterval = Math.max(1, Number(intervalMinutes) || Number(timeLabelIntervalMinutes) || 10);
  const configuredMinutes = Math.max(gridInterval, Number(intervalMinutes) || gridInterval);
  const configuredRowSpan = Math.max(1, Math.ceil(configuredMinutes / gridInterval));
  return Math.max(configuredRowSpan, gridInterval === 10 ? 2 : 1);
}

const DEFAULT_CONTEXT_PRESCRIPTION_COLORS = {
  'F/R': '#0f172a',
  'F/Rdc': '#64748b',
  'F/RDC': '#64748b',
  'F1.5': '#7c3aed',
  '40분': '#9a3412',
  '60분': '#9a3412',
};

const loadHiddenBodyPartOptionsByPatient = () => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(HIDDEN_BODY_PART_OPTIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.entries(parsed).reduce((acc, [patientKey, keys]) => {
      if (!patientKey || !Array.isArray(keys)) return acc;
      const uniqueKeys = Array.from(new Set(
        keys.map((key) => String(key || '').trim()).filter(Boolean)
      ));
      if (uniqueKeys.length > 0) acc[patientKey] = uniqueKeys;
      return acc;
    }, {});
  } catch {
    return {};
  }
};

const saveHiddenBodyPartOptionsByPatient = (value) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HIDDEN_BODY_PART_OPTIONS_STORAGE_KEY, JSON.stringify(value || {}));
  } catch {
    // localStorage may be unavailable in private browsing or restricted contexts.
  }
};

const getPatientHistoryGroupKey = (log) => (
  log?.history_group || (log?.type === 'manual' ? 'manual' : 'shockwave')
);

const getPatientHistoryBodyFilterParts = (log = {}) => {
  const parts = splitBodyParts(log.body_part || '');
  if (parts.length === 0) {
    return [{ key: PATIENT_HISTORY_EMPTY_BODY_FILTER, label: '부위 없음' }];
  }
  const partMap = new Map();
  parts.forEach((part) => {
    const key = normalizeBodyPartKey(part);
    if (!key || partMap.has(key)) return;
    partMap.set(key, { key, label: part });
  });
  return Array.from(partMap.values());
};

const buildPatientHistoryBodyFilterOptions = (logs = []) => {
  const partMap = new Map();
  logs.forEach((log) => {
    getPatientHistoryBodyFilterParts(log).forEach((part) => {
      const current = partMap.get(part.key) || { ...part, count: 0 };
      current.count += 1;
      partMap.set(part.key, current);
    });
  });

  return [
    { key: PATIENT_HISTORY_ALL_BODY_FILTER, label: '전체', count: logs.length },
    ...Array.from(partMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'ko')),
  ];
};

const ContextMenuLocalInput = ({ value, onChange, onKeyDown, onBlur, className, placeholder, autoFocus, onCompositionStart, onCompositionEnd, inputMode, pattern }) => {
  const [localValue, setLocalValue] = useState(value || '');
  
  useEffect(() => { setLocalValue(value || ''); }, [value]);

  return (
    <input
      type="text"
      className={className}
      placeholder={placeholder}
      autoFocus={autoFocus}
      autoComplete="off"
      inputMode={inputMode}
      pattern={pattern}
      value={localValue}
      onChange={(e) => {
        e.stopPropagation();
        setLocalValue(e.target.value);
        if (onChange) onChange(e.target.value);
      }}
      onKeyDown={(e) => {
        if (onKeyDown) onKeyDown(e, localValue);
      }}
      onBlur={(e) => {
        if (onBlur) onBlur(e, localValue);
      }}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    />
  );
};

const ContextMenuLocalInputGroup = ({ placeholder, buttonLabel, onSubmit, imeOpenRef, className = "context-menu-input", autoFocus, onInputKeyDown }) => {
  const [localValue, setLocalValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!autoFocus) return undefined;
    let cancelled = false;
    const focusInput = () => {
      if (cancelled || !inputRef.current) return;
      inputRef.current.focus({ preventScroll: true });
      inputRef.current.select();
    };

    focusInput();
    let nestedFrameId = null;
    const frameId = requestAnimationFrame(() => {
      focusInput();
      nestedFrameId = requestAnimationFrame(focusInput);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      if (nestedFrameId !== null) {
        cancelAnimationFrame(nestedFrameId);
      }
    };
  }, [autoFocus, placeholder]);

  const handleSubmit = () => {
    const trimmed = localValue.trim();
    if (trimmed) {
      onSubmit(trimmed);
      setLocalValue('');
    }
  };

  return (
    <div className="context-menu-input-row" style={{ marginTop: '8px' }}>
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        autoFocus={autoFocus}
        value={localValue}
        onChange={(e) => {
          e.stopPropagation();
          setLocalValue(e.target.value);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
            return;
          }
          if (onInputKeyDown) onInputKeyDown(e);
        }}
        onCompositionStart={() => {
          if (imeOpenRef) imeOpenRef.current = true;
        }}
        onCompositionEnd={() => {
          if (imeOpenRef) imeOpenRef.current = false;
        }}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      />
      <button
        type="button"
        className="context-menu-inline-button"
        onMouseDown={e => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          handleSubmit();
        }}
      >
        {buttonLabel}
      </button>
    </div>
  );
};

const renderSchedulerVisitSuffix = (suffix, className, style) => {
  const text = String(suffix || '');
  if (text === '*' || text === '(*)') {
    return <span className={className} style={style}>*</span>;
  }
  const match = text.match(/^(\()(-|\d+)(\))$/);
  if (!match) {
    return <span className={className} style={style}>{text}</span>;
  }
  const isEmptyVisit = match[2] === '-';
  return (
    <span className={`${className}${isEmptyVisit ? ' sw-cell-visit-suffix--empty' : ''}`} style={style}>
      <span className="sw-cell-visit-paren">(</span>
      <span className={isEmptyVisit ? 'sw-cell-visit-empty-marker' : 'sw-cell-visit-number'}>
        {isEmptyVisit ? null : match[2]}
      </span>
      <span className="sw-cell-visit-paren">)</span>
    </span>
  );
};

const MemoizedCell = memo(({
  cellKey, weekIdx, dayIdx, rowIdx, colIdx, dayInfo, slotInfo, showTimeCol, gridRowStart, isLastRenderedRow, colCount,
  cellData, pendingContent, pendingMergeSpan, mergeSpan, editingCell, imePreviewCell, selectedKeys, selectedCell, clipboardSource,
  workState, staffBlockRule, effectivePrescriptionColors,
  reservationGroupEdge,
  visitLineBreakPrescriptions,
  editValue, setEditValue,
  handleCellMouseDown, handleCellMouseEnter, setHoverCell, handleCellDoubleClick, handleCellContextMenu,
  editInputRef, handleCellSave, handleEditKeyDown, imeOpenRef, setImePreviewCell, editDraftRef, scheduleEditDraftAutosave, promoteFocusedInputToEditor, skipNextEditBlurSaveRef
}) => {
  const resizerRef = useRef(null);
  const content = pendingContent || '';
  const effectiveMergeSpan = pendingMergeSpan || mergeSpan;
  const cellMemoList = getMemoListFromMergeSpan(effectiveMergeSpan);
  const hasCellMemo = cellMemoList.length > 0;
  const reservationGroup = getReservationGroupFromMergeSpan(effectiveMergeSpan);
  const cellPrescription = cellData?.prescription || effectiveMergeSpan?.meta?.prescription || '';
  const displayData = buildSchedulerCellDisplay(content, effectiveMergeSpan);
  const hasDisplayText = displayData.hasDisplayText && content.trim() && content.trim() !== '\u200B';

  const isEditing = editingCell === cellKey;
  const isImePreview = imePreviewCell === cellKey;
  const isSelected = selectedKeys.has(cellKey);
  const isPrimary = selectedCell && selectedCell.w === weekIdx && selectedCell.d === dayIdx && selectedCell.r === rowIdx && selectedCell.c === colIdx;
  const gridColumnStart = showTimeCol ? colIdx + 2 : colIdx + 1;

  let visualRowSpan = 1;
  if (effectiveMergeSpan.rowSpan > 1) {
    visualRowSpan = effectiveMergeSpan.rowSpan;
  }

  let cls = 'sw-cell';
  if (colIdx + effectiveMergeSpan.colSpan - 1 === colCount - 1) cls += ' last-col';
  if (dayInfo.isHoliday) cls += ' holiday-bg';
  else if (!dayInfo.isCurrentMonth) cls += ' other-month-bg disabled-cell';
  
  if (slotInfo.disabled && !displayData.hasDisplayText) cls += ' disabled';
  
  if (isTreatmentCompleteBg(cellData?.bg_color)) cls += ' preserve';
  if (isTreatmentCancelBg(cellData?.bg_color)) cls += ' cancelled';
  if (has4060Pattern(content)) cls += ' color-4060';
  if (hasCellMemo) cls += ' has-memo';
  if (reservationGroup?.mode === 'same') cls += ' same-reservation-group';
  if (isSelected) cls += ' selected';
  if (isPrimary) cls += ' primary-selected';

  if (clipboardSource?.keys?.has(cellKey)) {
    cls += ` ants-active ${clipboardSource.mode === 'cut' ? 'ants-red' : 'ants-blue'}`;
  }

  if (dayInfo.isCurrentMonth && !isSelected && !hasDisplayText && !cellData?.bg_color && workState === 'off') {
    cls += ' staff-off';
  } else if (dayInfo.isCurrentMonth && !hasDisplayText && staffBlockRule?.bg_color) {
    cls += ' staff-blocked';
  } else if (!dayInfo.isCurrentMonth && !dayInfo.isHoliday && (
    workState === 'off' ||
    workState === 'night' ||
    workState === 'early-leave' ||
    cellData?.bg_color === SCHEDULER_HOLIDAY_BG ||
    staffBlockRule?.bg_color
  )) {
    cls += ' other-month-muted-block';
  } else if (dayInfo.isCurrentMonth && !isSelected && workState === 'early-leave') {
    // Assuming isLastHourSlot logic is true if passed as such, wait, we need to know. 
    // We pass it in as part of workState or check it here
  }

  let inlineStyle = {
    gridColumn: `${gridColumnStart}${effectiveMergeSpan.colSpan > 1 ? ` / span ${effectiveMergeSpan.colSpan}` : ''}`,
    gridRow: `${gridRowStart}${visualRowSpan > 1 ? ` / span ${visualRowSpan}` : ''}`,
    borderBottom: isLastRenderedRow ? 'none' : `1px solid ${HORIZONTAL_BORDER_COLOR}`,
  };

  if (colIdx + effectiveMergeSpan.colSpan - 1 === colCount - 1) {
    inlineStyle.borderRight = 'none';
  }

  if (dayInfo.isCurrentMonth && cellData?.bg_color) inlineStyle.backgroundColor = cellData.bg_color;
  else if (dayInfo.isCurrentMonth && !hasDisplayText && staffBlockRule?.bg_color) inlineStyle.backgroundColor = staffBlockRule.bg_color;
  
  if (dayInfo.isCurrentMonth && staffBlockRule?.font_color) inlineStyle.color = staffBlockRule.font_color;

  if (reservationGroup?.mode === 'same') {
    const groupBorder = '2px solid #2563eb';
    if (reservationGroupEdge?.top) {
      inlineStyle.borderTop = groupBorder;
    }
    if (reservationGroupEdge?.bottom) {
      inlineStyle.borderBottom = groupBorder;
    }
    if (reservationGroupEdge?.left) {
      inlineStyle.borderLeft = groupBorder;
    }
    if (reservationGroupEdge?.right) {
      inlineStyle.borderRight = groupBorder;
    }
  }

  const prescriptionColor = cellPrescription ? effectivePrescriptionColors[cellPrescription] : undefined;
  const shouldBreakVisitLine = Boolean(cellPrescription && visitLineBreakPrescriptions?.includes(cellPrescription));
  const hasMeaningfulContent = hasDisplayText;
  const noPrescription = hasMeaningfulContent && !cellPrescription;
  const noBodyPart = hasMeaningfulContent && !String(cellData?.body_part || '').trim();
  const visitSuffixClassName = [
    'sw-cell-visit-suffix',
    displayData.visitSuffix === '*' ? 'sw-cell-new-patient-marker' : '',
  ].filter(Boolean).join(' ');
  
  let baseTextColor = undefined;
  let visitSuffixColor = undefined;

  if (noPrescription) {
    baseTextColor = '#b8860b'; visitSuffixColor = '#b8860b';
    cls += ' no-prescription'; inlineStyle.color = '#b8860b';
  } else if (noBodyPart) {
    baseTextColor = prescriptionColor || undefined; visitSuffixColor = '#b8860b';
    if (prescriptionColor) {
      cls += ' has-prescription-color'; inlineStyle.color = prescriptionColor; inlineStyle['--prescription-color'] = prescriptionColor;
    }
  } else if (prescriptionColor) {
    baseTextColor = prescriptionColor; visitSuffixColor = prescriptionColor;
    cls += ' has-prescription-color'; inlineStyle.color = prescriptionColor; inlineStyle['--prescription-color'] = prescriptionColor;
  }

  if (visualRowSpan > 1 || effectiveMergeSpan.colSpan > 1) {
    inlineStyle.display = 'flex'; inlineStyle.alignItems = 'center'; inlineStyle.justifyContent = 'center';
    cls += ' merged-master';
  }

  const showInput = isPrimary || isEditing;

  if (showInput) {
    return (
      <div id={`cell-${cellKey}`} className={`sw-cell ${isEditing ? 'editing' : ''} ${cls}`} style={inlineStyle}
        onMouseDown={(e) => { handleCellMouseDown(weekIdx, dayIdx, rowIdx, colIdx, e); }}
        onMouseEnter={() => {
          handleCellMouseEnter(weekIdx, dayIdx, rowIdx, colIdx);
          setHoverCell({ weekIdx, dayIdx, rowIdx, colIdx, staffBlockRule, slotInfo, isMergedView: false });
        }}
        onMouseLeave={() => setHoverCell(null)}
        onDoubleClick={(e) => { handleCellDoubleClick(e, weekIdx, dayIdx, rowIdx, colIdx, content); }}
        onContextMenu={(e) => {
          handleCellContextMenu(e, weekIdx, dayIdx, rowIdx, colIdx, cellPrescription, slotInfo.time || slotInfo.label);
        }}
      >
        {!isEditing && !isImePreview && (
          <div className="sw-cell-display" style={{ pointerEvents: 'none' }}>
            {displayData.hasDisplayText ? (
              <span className="sw-cell-main">
                <span style={baseTextColor ? { color: baseTextColor } : undefined}>{displayData.baseText}</span>
                {displayData.noteSuffix ? (
                  <>
                    {visualRowSpan > 1 ? <br /> : null}
                    <span style={baseTextColor ? { color: baseTextColor } : undefined}>{displayData.noteSuffix}</span>
                  </>
                ) : null}
                {displayData.visitSuffix ? (
                  <>
                    {shouldBreakVisitLine && !displayData.noteSuffix ? <br /> : null}
                    {renderSchedulerVisitSuffix(displayData.visitSuffix, visitSuffixClassName, visitSuffixColor ? { color: visitSuffixColor } : undefined)}
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
        )}
        <div
          ref={resizerRef}
          className={`sw-cell-input-wrapper ${(!isEditing && !isImePreview) ? 'hidden' : ''} ${visualRowSpan === 1 ? 'is-single-row' : ''}`}
          data-value={isEditing ? editValue : ''}
        >
          <input
            ref={(isEditing || isPrimary) ? editInputRef : null}
            className="sw-cell-input"
            data-hidden-input={!isEditing && !isImePreview ? 'true' : undefined}
            defaultValue={isEditing ? editValue : ''}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onInput={(e) => {
              const nextValue = e.currentTarget.value;
              if (resizerRef.current) resizerRef.current.dataset.value = nextValue;
              editDraftRef.current = { key: cellKey, value: nextValue, dirty: true };
              if (isEditing) setEditValue(nextValue);
              // IME 조합 중에도 항상 드래프트를 저장 (macOS 한글 IME 호환)
              scheduleEditDraftAutosave(cellKey, nextValue);
              if (imeOpenRef.current || e.nativeEvent?.isComposing) return;
              if (!isEditing && e.currentTarget.value) promoteFocusedInputToEditor(cellKey, e.currentTarget.value);
            }}
          onBlur={(e) => {
            setImePreviewCell((prev) => (prev === cellKey ? null : prev));
            if (skipNextEditBlurSaveRef.current) { skipNextEditBlurSaveRef.current = false; return; }
            // isEditing이 아니더라도 값이 있으면 handleCellSave 호출
            const blurValue = e.target.value;
            if (isEditing || (blurValue && blurValue.trim())) {
              handleCellSave(weekIdx, dayIdx, rowIdx, colIdx, blurValue);
            }
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              if (isComposingInputEvent(e)) {
                saveSchedulerInputAfterComposition({
                  event: e,
                  input: e.currentTarget,
                  editDraftRef,
                  skipNextEditBlurSaveRef,
                  onSave: (value) => handleCellSave(weekIdx, dayIdx, rowIdx, colIdx, value),
                });
              } else {
                saveSchedulerInputValueOnce({
                  event: e,
                  input: e.currentTarget,
                  editDraftRef,
                  skipNextEditBlurSaveRef,
                  onSave: (value) => handleCellSave(weekIdx, dayIdx, rowIdx, colIdx, value),
                });
              }
              return;
            }
            if (e.key === 'Escape') {
              skipNextEditBlurSaveRef.current = true;
              e.target.value = '';
              e.target.blur();
              return;
            }
            if (isEditing) handleEditKeyDown(e, weekIdx, dayIdx, rowIdx, colIdx);
          }}
          onCompositionStart={() => {
            imeOpenRef.current = true;
            setImePreviewCell(cellKey);
            const val = editInputRef.current?.value || '';
            editDraftRef.current = { key: cellKey, value: val, dirty: true };
            if (resizerRef.current) resizerRef.current.dataset.value = val;
          }}
          onCompositionEnd={(e) => {
            imeOpenRef.current = false;
            setImePreviewCell((prev) => (prev === cellKey ? null : prev));
            const finalValue = e.currentTarget.value;
            editDraftRef.current = { key: cellKey, value: finalValue, dirty: true };
            if (isEditing) setEditValue(finalValue);
            if (resizerRef.current) resizerRef.current.dataset.value = finalValue;
            scheduleEditDraftAutosave(cellKey, finalValue);
            if (!isEditing && finalValue) promoteFocusedInputToEditor(cellKey, finalValue);
          }}
        />
        </div>
      </div>
    );
  } else {
    return (
      <div
        id={`cell-${cellKey}`}
        className={cls}
        style={inlineStyle}
        onMouseDown={(e) => { handleCellMouseDown(weekIdx, dayIdx, rowIdx, colIdx, e); }}
        onMouseEnter={() => {
          handleCellMouseEnter(weekIdx, dayIdx, rowIdx, colIdx);
          setHoverCell({ weekIdx, dayIdx, rowIdx, colIdx, staffBlockRule, slotInfo, isMergedView: true });
        }}
        onMouseLeave={() => setHoverCell(null)}
        onDoubleClick={(e) => { handleCellDoubleClick(e, weekIdx, dayIdx, rowIdx, colIdx, content); }}
        onContextMenu={(e) => {
          handleCellContextMenu(e, weekIdx, dayIdx, rowIdx, colIdx, cellPrescription, slotInfo.time || slotInfo.label);
        }}
      >
        <div className="sw-cell-display">
          {displayData.hasDisplayText ? (
            <span className="sw-cell-main">
              <span style={baseTextColor ? { color: baseTextColor } : undefined}>{displayData.baseText}</span>
              {displayData.noteSuffix ? (
                <>
                  {visualRowSpan > 1 ? <br /> : null}
                  <span style={baseTextColor ? { color: baseTextColor } : undefined}>{displayData.noteSuffix}</span>
                </>
              ) : null}
              {displayData.visitSuffix ? (
                <>
                  {shouldBreakVisitLine && !displayData.noteSuffix ? <br /> : null}
                  {renderSchedulerVisitSuffix(displayData.visitSuffix, visitSuffixClassName, visitSuffixColor ? { color: visitSuffixColor } : undefined)}
                </>
              ) : null}
            </span>
          ) : null}
        </div>
      </div>
    );
  }
}, (prevProps, nextProps) => {
  if (prevProps.pendingContent !== nextProps.pendingContent) return false;
  if (prevProps.pendingMergeSpan !== nextProps.pendingMergeSpan) return false;
  if (prevProps.cellData !== nextProps.cellData) return false;
  
  if (prevProps.mergeSpan.rowSpan !== nextProps.mergeSpan.rowSpan) return false;
  if (prevProps.mergeSpan.colSpan !== nextProps.mergeSpan.colSpan) return false;
  if (prevProps.mergeSpan.mergedInto !== nextProps.mergeSpan.mergedInto) return false;
  const prevMemoListKey = getMemoListFromMergeSpan(prevProps.pendingMergeSpan || prevProps.mergeSpan).join('\u001f');
  const nextMemoListKey = getMemoListFromMergeSpan(nextProps.pendingMergeSpan || nextProps.mergeSpan).join('\u001f');
  if (prevMemoListKey !== nextMemoListKey) return false;
  const prevReservationGroupKey = JSON.stringify(getReservationGroupFromMergeSpan(prevProps.pendingMergeSpan || prevProps.mergeSpan) || null);
  const nextReservationGroupKey = JSON.stringify(getReservationGroupFromMergeSpan(nextProps.pendingMergeSpan || nextProps.mergeSpan) || null);
  if (prevReservationGroupKey !== nextReservationGroupKey) return false;

  const wasSelected = prevProps.selectedKeys?.has(prevProps.cellKey);
  const isSelected = nextProps.selectedKeys?.has(nextProps.cellKey);
  if (wasSelected !== isSelected) return false;

  const wasPrimary = prevProps.selectedCell && prevProps.selectedCell.w === prevProps.weekIdx && prevProps.selectedCell.d === prevProps.dayIdx && prevProps.selectedCell.r === prevProps.rowIdx && prevProps.selectedCell.c === prevProps.colIdx;
  const isPrimary = nextProps.selectedCell && nextProps.selectedCell.w === nextProps.weekIdx && nextProps.selectedCell.d === nextProps.dayIdx && nextProps.selectedCell.r === nextProps.rowIdx && nextProps.selectedCell.c === nextProps.colIdx;
  if (wasPrimary !== isPrimary) return false;

  const wasEditing = prevProps.editingCell === prevProps.cellKey;
  const isEditing = nextProps.editingCell === nextProps.cellKey;
  if (wasEditing !== isEditing) return false;

  if (isEditing && prevProps.editValue !== nextProps.editValue) return false;

  const wasImePreview = prevProps.imePreviewCell === prevProps.cellKey;
  const isImePreview = nextProps.imePreviewCell === nextProps.cellKey;
  if (wasImePreview !== isImePreview) return false;

  const wasAnts = prevProps.clipboardSource?.keys?.has(prevProps.cellKey);
  const isAnts = nextProps.clipboardSource?.keys?.has(nextProps.cellKey);
  if (wasAnts !== isAnts) return false;
  if (isAnts && prevProps.clipboardSource?.mode !== nextProps.clipboardSource?.mode) return false;
  
  if (prevProps.workState !== nextProps.workState) return false;
  if (prevProps.staffBlockRule?.bg_color !== nextProps.staffBlockRule?.bg_color) return false;
  if (prevProps.staffBlockRule?.font_color !== nextProps.staffBlockRule?.font_color) return false;
  if (prevProps.staffBlockRule?.keyword !== nextProps.staffBlockRule?.keyword) return false;
  if (prevProps.visitLineBreakPrescriptions !== nextProps.visitLineBreakPrescriptions) return false;
  if (JSON.stringify(prevProps.reservationGroupEdge || null) !== JSON.stringify(nextProps.reservationGroupEdge || null)) return false;
  
  if (prevProps.slotInfo?.disabled !== nextProps.slotInfo?.disabled) return false;
  if (prevProps.slotInfo?.isLunch !== nextProps.slotInfo?.isLunch) return false;
  if (prevProps.slotInfo?.time !== nextProps.slotInfo?.time) return false;

  if (prevProps.isLastRenderedRow !== nextProps.isLastRenderedRow) return false;
  if (prevProps.colCount !== nextProps.colCount) return false;
  if (prevProps.showTimeCol !== nextProps.showTimeCol) return false;
  if (prevProps.gridRowStart !== nextProps.gridRowStart) return false;

  if (prevProps.dayInfo?.isHoliday !== nextProps.dayInfo?.isHoliday) return false;
  if (prevProps.dayInfo?.isCurrentMonth !== nextProps.dayInfo?.isCurrentMonth) return false;

  // Assume callbacks and colors are relatively stable or handled via refs in parent
  return true;
});

export default function ShockwaveView({ therapists, settings, memos = {}, onLoadMemos, onSaveMemo, holidays, staffMemos = {} }) {
  const { currentYear, currentMonth, saveShockwaveMemosBulk, manualTherapists, monthlyTherapists, monthlyManualTherapists, saveMonthlyTherapists, saveTherapistRoster, loadShockwaveSettings, saveShockwaveSettings, clipboardRef, clipboardSource, setClipboardSource } = useSchedule();
  const { addToast } = useToast();
  const { user } = useAuth();
  const canManageSchedulerSettings = isAdminUser(user);
  const viewRef = useRef(null);
  const scheduleBulkSaveQueueRef = useRef(Promise.resolve(true));
  const queuedSaveShockwaveMemosBulk = useCallback((payload, options) => {
    const nextSave = scheduleBulkSaveQueueRef.current
      .catch(() => false)
      .then(() => saveShockwaveMemosBulk(payload, options));
    scheduleBulkSaveQueueRef.current = nextSave.catch(() => false);
    return nextSave;
  }, [saveShockwaveMemosBulk]);

  const queuedOnSaveMemo = useCallback((...args) => {
    const nextSave = scheduleBulkSaveQueueRef.current
      .catch(() => false)
      .then(() => onSaveMemo(...args));
    scheduleBulkSaveQueueRef.current = nextSave.catch(() => false);
    return nextSave;
  }, [onSaveMemo]);
  const dragSelectionRef = useRef(null);
  const selectedCellRef = useRef(null);
  const [showTherapistConfig, setShowTherapistConfig] = useState(false);

  useEffect(() => {
    if (!canManageSchedulerSettings && showTherapistConfig) {
      setShowTherapistConfig(false);
    }
  }, [canManageSchedulerSettings, showTherapistConfig]);

  // ── 셀 조작 상태 (구글 시트 방식) ──
  const [selectedCell, setSelectedCell] = useState(null);     // { w, d, r, c }
  const [, setRangeEnd] = useState(null);                     // { w, d, r, c } (Shift 선택 끝점)
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [editingCell, setEditingCell] = useState(null);       // "w-d-r-c" 키 문자열
  const [editValue, setEditValue] = useState('');
  const [loadedMemosKey, setLoadedMemosKey] = useState('');
  const [contextMenu, setContextMenu] = useState(null); // { x, y, weekIdx, dayIdx, rowIdx, colIdx, currentPrescription }
  const [activeContextSubmenu, setActiveContextSubmenu] = useState(null);
  const [contextMenuBodyPartOptions, setContextMenuBodyPartOptions] = useState([]);
  const [contextMenuHiddenBodyPartKeys, setContextMenuHiddenBodyPartKeys] = useState(() => new Set());
  const [hiddenBodyPartOptionsByPatient, setHiddenBodyPartOptionsByPatient] = useState(loadHiddenBodyPartOptionsByPatient);
  const [, setContextMenuBodyInput] = useState('');
  const [, setContextMenuNoteInput] = useState('');
  const [contextMenuMemoDrafts, setContextMenuMemoDrafts] = useState([]);
  const [contextMenuVisitInput, setContextMenuVisitInput] = useState('');
  const [contextMenuReservationInput, setContextMenuReservationInput] = useState('');

  const {
    pendingCellBgColors,
    pendingDisplayValues,
    pendingMemoOverrides,
    pendingMergeSpans,
    pendingDisplayValuesRef,
    pendingMemoOverridesRef,
    setPendingDisplayValues,
    applyImmediateCellBg,
    applyImmediateCellDisplay,
    applyImmediateMergeSpan,
    clearImmediateCellBg,
    clearImmediateCellDisplay,
  } = useScheduleImmediateState({
    memos,
    setContextMenu,
    setEditingCell,
    currentYear,
    currentMonth,
  });

  const effectiveMemos = useMemo(
    () => {
      if (!pendingMemoOverrides || Object.keys(pendingMemoOverrides).length === 0) return memos;
      const next = { ...(memos || {}) };
      Object.entries(pendingMemoOverrides).forEach(([key, override]) => {
        next[key] = { ...(next[key] || {}), ...override };
      });
      return next;
    },
    [memos, pendingMemoOverrides]
  );
  const getDefaultEditingMergeSpanForKey = useCallback((key) => {
    const directMerge = defaultEditMergeSpanRef.current[key]?.mergeSpan;
    if (directMerge) return directMerge;

    const [, , rowIndex, colIndex] = String(key || '').split('-').map(Number);
    if (!Number.isFinite(rowIndex) || !Number.isFinite(colIndex)) return null;

    for (const [masterKey, entry] of Object.entries(defaultEditMergeSpanRef.current || {})) {
      const [w, d, masterRow, masterCol] = masterKey.split('-').map(Number);
      const span = entry?.mergeSpan;
      if (!span || ![w, d, masterRow, masterCol].every(Number.isFinite)) continue;
      const keyParts = String(key || '').split('-').map(Number);
      if (keyParts[0] !== w || keyParts[1] !== d || keyParts[3] !== masterCol) continue;
      if (rowIndex <= masterRow || rowIndex >= masterRow + (span.rowSpan || 1)) continue;
      return { rowSpan: 1, colSpan: 1, mergedInto: masterKey };
    }
    return null;
  }, []);
  const prescriptionScheduleSettings = useMemo(
    () => getPrescriptionScheduleSettings(settings, currentYear, currentMonth),
    [settings, currentYear, currentMonth]
  );

  // 환자 내역 검색 팝업 상태 (Cmd+F)
  const [patientHistoryModalOpen, setPatientHistoryModalOpen] = useState(false);
  const [patientHistoryModalData, setPatientHistoryModalData] = useState({ loading: false, logs: [], searchName: '', searchChart: '' });
  const [patientHistoryBodyFilters, setPatientHistoryBodyFilters] = useState({});
  const [pendingPatientHistoryApplyLog, setPendingPatientHistoryApplyLog] = useState(null);
  const selectedPatientHistoryGroupKey = useMemo(() => {
    if (!selectedCell) return 'shockwave';
    const key = `${selectedCell.w}-${selectedCell.d}-${selectedCell.r}-${selectedCell.c}`;
    const selectedMemo = effectiveMemos[key] || {};
    const selectedContent = editingCell === key
      ? editValue
      : (pendingDisplayValues[key] ?? selectedMemo.content ?? '');
    const selectedPrescription = String(selectedMemo.prescription || '').trim();
    const manualPrescriptions = Array.isArray(settings?.manual_therapy_prescriptions)
      ? settings.manual_therapy_prescriptions
      : [];
    if (
      has4060Pattern(selectedContent) ||
      (selectedPrescription && manualPrescriptions.includes(selectedPrescription))
    ) {
      return 'manual';
    }
    return 'shockwave';
  }, [editValue, editingCell, effectiveMemos, pendingDisplayValues, selectedCell, settings?.manual_therapy_prescriptions]);
  const patientHistoryLogGroups = useMemo(() => {
    const groupMap = new Map(PATIENT_HISTORY_GROUPS.map((group) => [group.key, { ...group, logs: [] }]));
    (patientHistoryModalData.logs || []).forEach((log) => {
      const groupKey = getPatientHistoryGroupKey(log);
      const group = groupMap.get(groupKey) || groupMap.get('shockwave');
      group.logs.push(log);
    });
    const orderedGroups = [...PATIENT_HISTORY_GROUPS].sort((a, b) => {
      if (a.key === selectedPatientHistoryGroupKey) return -1;
      if (b.key === selectedPatientHistoryGroupKey) return 1;
      return 0;
    });
    return orderedGroups
      .map((group) => {
        const rawGroup = groupMap.get(group.key);
        if (!rawGroup || rawGroup.logs.length === 0) return null;
        const bodyFilterOptions = buildPatientHistoryBodyFilterOptions(rawGroup.logs);
        const requestedFilter = patientHistoryBodyFilters[rawGroup.key] || PATIENT_HISTORY_ALL_BODY_FILTER;
        const activeBodyFilter = bodyFilterOptions.some((option) => option.key === requestedFilter)
          ? requestedFilter
          : PATIENT_HISTORY_ALL_BODY_FILTER;
        const logs = activeBodyFilter === PATIENT_HISTORY_ALL_BODY_FILTER
          ? rawGroup.logs
          : rawGroup.logs.filter((log) => getPatientHistoryBodyFilterParts(log).some((part) => part.key === activeBodyFilter));
        return {
          ...rawGroup,
          logs,
          totalLogs: rawGroup.logs,
          bodyFilterOptions,
          activeBodyFilter,
        };
      })
      .filter(Boolean);
  }, [patientHistoryBodyFilters, patientHistoryModalData.logs, selectedPatientHistoryGroupKey]);
  const patientHistoryModalLayout = useMemo(() => {
    const groupCount = patientHistoryLogGroups.length;
    if (groupCount >= 2) {
      return {
        maxWidth: 1130,
        width: '88%',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      };
    }
    return {
      maxWidth: groupCount === 1 ? 655 : 580,
      width: '80%',
      gridTemplateColumns: 'minmax(0, 1fr)',
    };
  }, [patientHistoryLogGroups.length]);
  const patientHistoryColumnWidths = useMemo(() => (
    patientHistoryLogGroups.length >= 2
      ? ['20%', '9%', '21%', '20%', '8%', '10.5%', '11.5%']
      : ['16%', '10%', '23%', '24%', '8%', '10.5%', '8.5%']
  ), [patientHistoryLogGroups.length]);

  // Presence 기능 비활성화 – 실시간 데이터 동기화만 유지

  useEffect(() => {
    selectedCellRef.current = selectedCell;
  }, [selectedCell]);

  useSchedulePendingPersistence({
    currentMonth,
    currentYear,
    loadedMemosKey,
    memos,
    onSaveMemo: queuedOnSaveMemo,
    pendingDisplayValues,
    setPendingDisplayValues,
  });

  useEffect(() => {
    loadShockwaveSettings?.();
  }, [loadShockwaveSettings, currentYear, currentMonth]);

  useEffect(() => {
    const refreshSettingsOnFocus = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      loadShockwaveSettings?.();
    };
    window.addEventListener('focus', refreshSettingsOnFocus);
    document.addEventListener('visibilitychange', refreshSettingsOnFocus);
    return () => {
      window.removeEventListener('focus', refreshSettingsOnFocus);
      document.removeEventListener('visibilitychange', refreshSettingsOnFocus);
    };
  }, [loadShockwaveSettings]);

  const tooltipRef = useRef(null);
  const tooltipMousePosRef = useRef({ x: 0, y: 0 });
  const weekRefs = useRef([]);
  const [hoverCell, setHoverCell] = useState(null);

  // ── 활성 행의 시간 셀 하이라이트 ──
  useEffect(() => {
    // 활성 행 인덱스 결정: hover > editing > selected 우선순위
    let activeWeek = null;
    let activeRow = null;
    if (hoverCell) {
      activeWeek = hoverCell.weekIdx;
      activeRow = hoverCell.rowIdx;
    } else if (editingCell) {
      const parts = editingCell.split('-').map(Number);
      if (parts.length >= 3) {
        activeWeek = parts[0];
        activeRow = parts[2];
      }
    } else if (selectedCell) {
      activeWeek = selectedCell.w;
      activeRow = selectedCell.r;
    }

    const container = viewRef.current;
    if (!container) return;

    // 이전 하이라이트 제거
    const prevActive = container.querySelectorAll('.sw-time-label.active-row');
    prevActive.forEach(el => el.classList.remove('active-row'));

    // 새 하이라이트 적용
    if (activeWeek !== null && activeRow !== null) {
      const timeCell = container.querySelector(`[data-time-row="${activeWeek}-${activeRow}"]`)
        || Array.from(container.querySelectorAll(`[data-time-week="${activeWeek}"]`)).find((cell) => {
          const start = Number(cell.dataset.timeRowStart);
          const end = Number(cell.dataset.timeRowEnd);
          return Number.isFinite(start) && Number.isFinite(end) && activeRow >= start && activeRow <= end;
        });
      if (timeCell) {
        timeCell.classList.add('active-row');
      }
    }
  }, [hoverCell, selectedCell, editingCell]);
  const [todayShortcutTooltip, setTodayShortcutTooltip] = useState(null);
  const [chartSelector, setChartSelector] = useState(null);
  const [imePreviewCell, setImePreviewCell] = useState(null);
  const contextMenuRef = useRef(null);
  const editInputRef = useRef(null);
  const patientHistorySearchInputRef = useRef(null);
  const patientHistoryModalOverlayRef = useRef(null);
  const patientHistoryModalBodyRef = useRef(null);
  const imeOpenRef = useRef(false);
  const skipNextEditBlurSaveRef = useRef(false);
  const handleCellSaveRef = useRef(null);
  const editDraftRef = useRef(null);
  const editAutosaveTimerRef = useRef(null);
  const defaultEditMergeSpanRef = useRef({});
  const cellSaveVersionRef = useRef({});
  const saveMemoRef = useRef(queuedOnSaveMemo);
  const scheduleDateRef = useRef({ year: currentYear, month: currentMonth });
  const { contextSubmenuOffsetY } = useContextMenuPositioning({
    activeContextSubmenu,
    contextMenu,
    contextMenuRef,
    setContextMenu,
  });
  const scheduleScrollKey = useMemo(
    () => getShockwaveScheduleScrollKey(currentYear, currentMonth),
    [currentYear, currentMonth]
  );

  const monthlyTherapistSlotCount = useMemo(
    () => (monthlyTherapists || []).reduce((max, item) => Math.max(max, (Number(item?.slot_index) || 0) + 1), 0),
    [monthlyTherapists]
  );
  const colCount = Math.max(1, therapists.length, monthlyTherapistSlotCount);
  const {
    activeColRatios,
    dayColWidth,
    rowHeight,
    setRowHeight,
    setDayColWidth,
    startColResize,
    startDayResize,
    startRowResize,
    therapistColsCSS,
  } = useScheduleResizeState({ colCount });
  const effectiveDayOverrides = useMemo(
    () => getMonthlyDayOverrides(settings?.day_overrides, currentYear, currentMonth),
    [settings?.day_overrides, currentYear, currentMonth]
  );

  useEffect(() => {
    saveMemoRef.current = queuedOnSaveMemo;
    scheduleDateRef.current = { year: currentYear, month: currentMonth };
  }, [queuedOnSaveMemo, currentYear, currentMonth]);

  const {
    getStaffScheduleBlockForCell,
    getTherapistNameForDate,
    getTherapistWorkState,
    isLastHourSlot,
  } = useStaffScheduleState({
    colCount,
    currentMonth,
    currentYear,
    effectiveDayOverrides,
    monthlyTherapists,
    settings,
    staffMemos,
    therapists,
  });

  const today = getTodayKST();
  const {
    baseTimeSlots,
    getDefaultReservationTime,
    getReservationTimeForMemo,
    getTimeSlotsForDay,
    weeks,
  } = useScheduleTimeSlots({
    currentMonth,
    currentYear,
    effectiveDayOverrides,
    holidays,
    settings,
  });


  const { buildSchedulerAutoText } = useSchedulerAutoText({
    memos,
    weeks,
    settings,
    setChartSelector,
  });

  useEffect(() => {
    let cancelled = false;
    setLoadedMemosKey('');
    setPendingDisplayValues({});
    Promise.resolve(onLoadMemos(currentYear, currentMonth)).finally(() => {
      if (!cancelled) {
        setLoadedMemosKey(getShockwaveScheduleScrollKey(currentYear, currentMonth));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentYear, currentMonth, onLoadMemos, setPendingDisplayValues]);

  // ── 기존 40/60 셀과 빈 셀 잔여 메타데이터 보정 ──
  const prescriptionPatchKeyRef = useRef(null);
  useEffect(() => {
    const monthKey = getShockwaveScheduleScrollKey(currentYear, currentMonth);
    const patchKey = `${monthKey}-${settings?.interval_minutes || 10}`;
    if (loadedMemosKey !== monthKey) return;
    if (prescriptionPatchKeyRef.current === patchKey) return; // 이미 이번 설정으로 패치 완료
    if (!memos || Object.keys(memos).length === 0) return;

    const fixEntries = [];
    Object.entries(memos).forEach(([key, memo]) => {
      const content = String(memo?.content || '').trim();
      if (!content) return;
      const mergeSpan = memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
      if (mergeSpan.mergedInto) return;

      const normalizedContent = normalizeConfiguredDoseTagInContent(content, prescriptionScheduleSettings.doseTags);
      const autoPres = getPrescriptionFromConfiguredDoseTag(settings, currentYear, currentMonth, normalizedContent)
        || get4060PrescriptionFromContent(normalizedContent);
      const targetPres = autoPres || String(memo?.prescription || '').trim();

      const expectedPrescriptionRowSpan = targetPres
        ? getManualTherapyRowSpan(targetPres, {
            durationMinutesMap: prescriptionScheduleSettings?.durationMinutesMap,
            slotMinutes: settings?.interval_minutes || 10,
          })
        : 1;
      const expectedPlainTextRowSpan = getPlainTextDefaultRowSpan({
        intervalMinutes: settings?.interval_minutes,
        timeLabelIntervalMinutes: settings?.time_label_interval_minutes,
      });
      const expectedRowSpan = Math.max(expectedPrescriptionRowSpan, expectedPlainTextRowSpan);
      if (expectedRowSpan <= 1) return;

      const hasExpectedMerge = (
        expectedRowSpan > 1 &&
        !mergeSpan.mergedInto &&
        (mergeSpan.rowSpan || 1) === expectedRowSpan &&
        (mergeSpan.colSpan || 1) === 1
      );
      const hasExpectedPrescription = targetPres
        ? memo?.prescription === targetPres
        : !String(memo?.prescription || '').trim();
      if (content === normalizedContent && hasExpectedPrescription && hasExpectedMerge) return;
      fixEntries.push({ key, prescription: targetPres, content: normalizedContent, expectedRowSpan });
    });

    const blankCleanupPayload = buildBlankScheduleCleanupPayload({
      memos,
      currentYear,
      currentMonth,
    });

    prescriptionPatchKeyRef.current = patchKey; // 패치 시도 표시 (빈 배열이어도)

    if (fixEntries.length === 0 && blankCleanupPayload.length === 0) return;

    (async () => {
      const payloadByKey = new Map();
      blankCleanupPayload.forEach((item) => {
        payloadByKey.set(`${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`, item);
      });
      fixEntries.forEach(({ key, prescription, content, expectedRowSpan }) => {
        const [weekIndex, dayIndex, rowIndex, colIndex] = key.split('-').map(Number);
        const manualTherapyMerge = buildManualTherapyAutoMergePayload({
          key,
          memos,
          currentYear,
          currentMonth,
          rowCount: baseTimeSlots.length,
          content,
          bgColor: memos[key]?.bg_color || null,
          prescription,
          bodyPart: memos[key]?.body_part || null,
          mergeSpan: memos[key]?.merge_span,
          durationMinutesMap: prescriptionScheduleSettings.durationMinutesMap,
          doseTags: prescriptionScheduleSettings.doseTags,
          slotMinutes: settings?.interval_minutes || 10,
        });
        let updates = manualTherapyMerge.ok ? manualTherapyMerge.payload : null;
        if (!updates && expectedRowSpan > 1 && rowIndex + expectedRowSpan <= baseTimeSlots.length) {
          let canMergePlainText = true;
          const defaultReservationTime = getDefaultReservationTime(weekIndex, dayIndex, rowIndex);
          const masterMergeSpan = buildMergeSpanWithReservationTime(
            { rowSpan: expectedRowSpan, colSpan: 1, mergedInto: null },
            defaultReservationTime
          );
          updates = [];
          for (let rowOffset = 0; rowOffset < expectedRowSpan; rowOffset += 1) {
            const targetRow = rowIndex + rowOffset;
            const targetKey = cellKey(weekIndex, dayIndex, targetRow, colIndex);
            const targetMemo = memos[targetKey] || {};
            const targetMergeSpan = targetMemo.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
            const isCurrentMergeChild = targetMergeSpan.mergedInto === key;
            if (
              rowOffset > 0 &&
              (
                String(targetMemo.content || '').trim() ||
                (targetMergeSpan.mergedInto && !isCurrentMergeChild) ||
                (!isCurrentMergeChild && ((targetMergeSpan.rowSpan || 1) > 1 || (targetMergeSpan.colSpan || 1) > 1))
              )
            ) {
              canMergePlainText = false;
              break;
            }
            updates.push({
              year: currentYear,
              month: currentMonth,
              week_index: weekIndex,
              day_index: dayIndex,
              row_index: targetRow,
              col_index: colIndex,
              content: rowOffset === 0 ? content : '',
              bg_color: rowOffset === 0 ? (memos[key]?.bg_color || null) : null,
              merge_span: rowOffset === 0
                ? masterMergeSpan
                : { rowSpan: 1, colSpan: 1, mergedInto: key },
              prescription: rowOffset === 0 ? (prescription || null) : null,
              body_part: rowOffset === 0 ? (memos[key]?.body_part || null) : null,
            });
          }
          if (!canMergePlainText) updates = null;
        }
        if (!updates) {
          updates = [{
            year: currentYear,
            month: currentMonth,
            week_index: weekIndex,
            day_index: dayIndex,
            row_index: rowIndex,
            col_index: colIndex,
            content: memos[key]?.content || '',
            bg_color: memos[key]?.bg_color || null,
            merge_span: memos[key]?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
            prescription,
            body_part: memos[key]?.body_part || null,
          }];
        }
        updates.forEach((item) => {
          payloadByKey.set(`${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`, item);
        });
      });
      const bulkUpdates = Array.from(payloadByKey.values());
      const ok = await saveShockwaveMemosBulk(bulkUpdates);
      if (ok) {
        await onLoadMemos(currentYear, currentMonth);
      }
    })();
  }, [loadedMemosKey, currentYear, currentMonth, settings, memos, baseTimeSlots.length, saveShockwaveMemosBulk, onLoadMemos, prescriptionScheduleSettings.durationMinutesMap, prescriptionScheduleSettings.doseTags]);

  const isEditableTarget = useCallback((target) => {
    return (
      (target instanceof HTMLInputElement && !target.dataset.hiddenInput) ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable
    );
  }, []);

  const isContextMenuTarget = useCallback((target) => {
    return Boolean(target && contextMenuRef.current?.contains(target));
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (contextMenu && !isContextMenuTarget(e.target)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [contextMenu, isContextMenuTarget]);

  const {
    buildMemoSnapshotForKeys,
    doUndo,
    recordUndo,
  } = useScheduleUndoActions({
    applyImmediateCellDisplay,
    applyImmediateMergeSpan,
    clearImmediateCellDisplay,
    currentMonth,
    currentYear,
    memos,
    onSaveMemo: queuedOnSaveMemo,
    pendingDisplayValues,
    saveShockwaveMemosBulk: queuedSaveShockwaveMemosBulk,
    setContextMenu,
    setEditingCell,
  });

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (clipboardSource && (e.key === 'Escape' || e.key === 'Backspace' || isUndoShortcutEvent(e))) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        if (isUndoShortcutEvent(e)) e.__shockwaveUndoHandled = true;
        setClipboardSource(null);
        return;
      }
      if (isUndoShortcutEvent(e)) {
        if (e.__shockwaveUndoHandled) return;
        e.__shockwaveUndoHandled = true;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        doUndo();
        return;
      } else if (e.key === 'Escape') {
        if (contextMenu) {
          setContextMenu(null);
        } else {
          setClipboardSource(null);
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown, true);
    document.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, true);
      document.removeEventListener('keydown', handleGlobalKeyDown, true);
    };
  }, [doUndo, contextMenu, clipboardSource, setClipboardSource]);

  const {
    cellKey,
    computeSelectionInfo,
    getEffectiveMergeSpan,
    normalizeCellToMergeMaster,
    normalizeKeysToMergeMasters,
    buildRangeKeys,
  } = useScheduleSelectionModel({
    selectedCell,
    selectedKeys,
    memos: effectiveMemos,
    pendingMergeSpans,
  });

  const scheduleEditDraftAutosave = useCallback((key, value) => {
    const nextValue = value ?? '';
    setPendingDisplayValues((prev) => ({ ...prev, [key]: nextValue }));
    editDraftRef.current = { key, value: nextValue, dirty: true };
    rememberPendingScheduleDraft(currentYear, currentMonth, key, nextValue, { source: 'editing-draft' });
    // DB 저장은 handleCellSave(편집 완료 시)에서 처방 정보와 함께 수행.
    // 여기서 미리 저장하면 처방 없이 저장되어 노란색 '처방 없음'이 잠깐 보이는 문제 발생.
    if (editAutosaveTimerRef.current) {
      clearTimeout(editAutosaveTimerRef.current);
      editAutosaveTimerRef.current = null;
    }
  }, [currentMonth, currentYear, setPendingDisplayValues]);

  const flushEditDraft = useCallback(() => {
    if (editAutosaveTimerRef.current) {
      clearTimeout(editAutosaveTimerRef.current);
      editAutosaveTimerRef.current = null;
    }
    const draft = editDraftRef.current;
    if (!draft?.key || !draft.dirty) return;
    const draftValue = draft.value;
    const draftKey = draft.key;
    editDraftRef.current = null;
    const [w, d, r, c] = draftKey.split('-').map(Number);
    if (![w, d, r, c].every(Number.isFinite)) return;
    if (!draftValue || !String(draftValue).trim()) return;
    // handleCellSave를 통해 처방 조회 포함 저장
    Promise.resolve(handleCellSaveRef.current?.(w, d, r, c, draftValue))
      .then(() => {})
      .catch((error) => {
        console.error('Failed to flush schedule draft:', error);
      });
  }, []);

  useEffect(() => {
    window.addEventListener('clinic-before-route-change', flushEditDraft);
    return () => window.removeEventListener('clinic-before-route-change', flushEditDraft);
  }, [flushEditDraft]);

  const focusSelectedCellInput = useCallback(() => {
    requestAnimationFrame(() => {
      const input = editInputRef.current;
      if (!input || !input.dataset.hiddenInput) return;
      if (document.activeElement !== input) {
        input.focus({ preventScroll: true });
      }
    });
  }, []);

  const selectSingleCell = useCallback((cell, options = {}) => {
    const normalizedCell = options.normalize === false ? cell : normalizeCellToMergeMaster(cell);
    const key = cellKey(normalizedCell.w, normalizedCell.d, normalizedCell.r, normalizedCell.c);
    setSelectedCell(normalizedCell);
    setRangeEnd(null);
    setSelectedKeys(new Set([key]));
    viewRef.current?.focus({ preventScroll: true });
    focusSelectedCellInput();
  }, [cellKey, focusSelectedCellInput, normalizeCellToMergeMaster]);

  const updateDraggedSelection = useCallback((targetCell) => {
    const dragState = dragSelectionRef.current;
    if (!dragState) return;

    const nextKeys = buildRangeKeys(dragState.anchor, targetCell);
    setSelectedCell(dragState.anchor);
    setRangeEnd(targetCell);
    setSelectedKeys(nextKeys);
  }, [buildRangeKeys]);

  // ── 셀 클릭 = 선택 (편집 아님) ──
  const handleCellMouseDown = useCallback((w, d, r, c, e) => {
    const cell = normalizeCellToMergeMaster({ w, d, r, c });
    const key = cellKey(cell.w, cell.d, cell.r, cell.c);
    const isMeta = e?.metaKey || e?.ctrlKey;

    if (e?.button === 2) {
      e.preventDefault();
      dragSelectionRef.current = null;
      if (!selectedKeys || selectedKeys.size <= 1 || !selectedKeys.has(key)) {
        selectSingleCell(cell);
      } else {
        viewRef.current?.focus({ preventScroll: true });
        focusSelectedCellInput();
      }
      skipNextEditBlurSaveRef.current = true;
      window.setTimeout(() => {
        skipNextEditBlurSaveRef.current = false;
      }, 0);
      return;
    }
    if (e?.button !== 0) return;
    e.preventDefault();

    setContextMenu(null);

    if (editingCell) {
      const [editW, editD, editR, editC] = editingCell.split('-').map(Number);
      if ([editW, editD, editR, editC].every(Number.isFinite)) {
        const value = editInputRef.current?.value ?? editValue;
        skipNextEditBlurSaveRef.current = true;
        handleCellSaveRef.current?.(editW, editD, editR, editC, value);
        window.setTimeout(() => {
          skipNextEditBlurSaveRef.current = false;
        }, 0);
      }
    }

    viewRef.current?.focus({ preventScroll: true });

    if (isMeta) {
      setSelectedCell(cell);
      setRangeEnd(null);
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next.size ? next : new Set([key]);
      });
      dragSelectionRef.current = null;
    } else if (e?.shiftKey && selectedCell) {
      setSelectedCell(selectedCell);
      setRangeEnd(cell);
      setSelectedKeys(buildRangeKeys(selectedCell, cell));
      dragSelectionRef.current = { anchor: selectedCell };
    } else {
      selectSingleCell(cell);
      dragSelectionRef.current = { anchor: cell };
    }
    if (!editingCell) setEditingCell(null);
  }, [selectedCell, selectedKeys, editingCell, editValue, buildRangeKeys, selectSingleCell, normalizeCellToMergeMaster, cellKey, focusSelectedCellInput]);

  const handleCellMouseEnter = useCallback((w, d, r, c) => {
    if (!dragSelectionRef.current) return;
    updateDraggedSelection({ w, d, r, c });
  }, [updateDraggedSelection]);

  const prepareDefaultEditMerge = useCallback((w, d, r, c, content) => {
    const key = cellKey(w, d, r, c);
    const defaultRowSpan = getPlainTextDefaultRowSpan({
      intervalMinutes: settings?.interval_minutes,
      timeLabelIntervalMinutes: settings?.time_label_interval_minutes,
    });
    const currentMergeSpan = pendingMergeSpans[key] || effectiveMemos[key]?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
    const canUseDefaultMerge = (
      !String(content || '').trim() &&
      defaultRowSpan > 1 &&
      !currentMergeSpan.mergedInto &&
      (currentMergeSpan.rowSpan || 1) === 1 &&
      r + defaultRowSpan <= baseTimeSlots.length
    );

    if (!canUseDefaultMerge) return;

    const defaultReservationTime = getDefaultReservationTime(w, d, r);
    const masterDefaultMergeSpan = buildMergeSpanWithReservationTime(
      { rowSpan: defaultRowSpan, colSpan: 1, mergedInto: null },
      defaultReservationTime
    );
    const updates = [];
    const revertUpdates = [];
    let canMerge = true;
    for (let rowOffset = 0; rowOffset < defaultRowSpan; rowOffset += 1) {
      const targetRow = r + rowOffset;
      const targetKey = cellKey(w, d, targetRow, c);
      const memo = effectiveMemos[targetKey] || {};
      const mergeSpan = pendingMergeSpans[targetKey] || memo.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
      const hasContent = String(memo.content || '').trim();
      if (
        hasContent ||
        mergeSpan.mergedInto ||
        (targetKey !== key && ((mergeSpan.rowSpan || 1) > 1 || (mergeSpan.colSpan || 1) > 1))
      ) {
        canMerge = false;
        break;
      }
      revertUpdates.push({
        year: currentYear,
        month: currentMonth,
        week_index: w,
        day_index: d,
        row_index: targetRow,
        col_index: c,
        merge_span: mergeSpan,
      });
      updates.push({
        year: currentYear,
        month: currentMonth,
        week_index: w,
        day_index: d,
        row_index: targetRow,
        col_index: c,
        merge_span: rowOffset === 0
          ? masterDefaultMergeSpan
          : { rowSpan: 1, colSpan: 1, mergedInto: key },
      });
    }

    if (!canMerge) return;

    defaultEditMergeSpanRef.current[key] = {
      mergeSpan: masterDefaultMergeSpan,
      revertUpdates,
    };
    applyImmediateMergeSpan(updates);
  }, [
    applyImmediateMergeSpan,
    baseTimeSlots.length,
    cellKey,
    currentMonth,
    currentYear,
    effectiveMemos,
    getDefaultReservationTime,
    pendingMergeSpans,
    settings?.interval_minutes,
    settings?.time_label_interval_minutes,
  ]);

  // ── 더블 클릭 = 편집 모드 진입 ──
  const handleCellDoubleClick = useCallback((e, w, d, r, c, content) => {
    selectSingleCell({ w, d, r, c });
    const key = cellKey(w, d, r, c);
    prepareDefaultEditMerge(w, d, r, c, content);
    
    let offset = content?.length || 0;
    try {
      if (e && document.caretRangeFromPoint) {
        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (range && range.startContainer.nodeType === 3) {
          offset = range.startOffset;
        }
      } else if (e && document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
        if (pos && pos.offsetNode.nodeType === 3) {
          offset = pos.offset;
        }
      }
    } catch {
      // Browser caret APIs can fail on non-text nodes.
    }

    flushSync(() => {
      setEditingCell(key);
      setEditValue(content || '');
    });
    
    if (editInputRef.current) {
      editInputRef.current.value = content || '';
      editInputRef.current.focus();
      try {
        editInputRef.current.setSelectionRange(offset, offset);
      } catch {
        // Selection range is best effort.
      }
    }
  }, [
    cellKey,
    prepareDefaultEditMerge,
    selectSingleCell,
  ]);

  // ── 편집 저장 ──
  const handleCellSave = useCallback(async (w, d, r, c, nextValue, forcedPrescription, forcedBgColor, forcedBodyPart) => {
    const finalValue = nextValue !== undefined ? nextValue : (editInputRef.current?.value ?? editValue);
    const key = cellKey(w, d, r, c);
    const saveVersion = (cellSaveVersionRef.current[key] || 0) + 1;
    cellSaveVersionRef.current[key] = saveVersion;
    const saveStartedAt = Date.now();
    const wasDeletedAfterSaveStarted = () => {
      const deletedDraft = readDeletedScheduleDrafts()[getPendingDraftId(currentYear, currentMonth, key)];
      return Number(deletedDraft?.updatedAt || 0) >= saveStartedAt;
    };
    if (editDraftRef.current?.key === key) {
      editDraftRef.current = null;
    }
    if (editAutosaveTimerRef.current) {
      clearTimeout(editAutosaveTimerRef.current);
      editAutosaveTimerRef.current = null;
    }
    const oldContent = memos[key]?.content || '';
    const oldPrescription = memos[key]?.prescription || '';
    const oldBodyPart = memos[key]?.body_part || null;
    const oldMergeSpan = memos[key]?.merge_span || EMPTY_SCHEDULE_MERGE_SPAN;
    const defaultEditMerge = defaultEditMergeSpanRef.current[key];
    delete defaultEditMergeSpanRef.current[key];
    const defaultEditMergeSpan = defaultEditMerge?.mergeSpan;
    const immediateContent = String(finalValue ?? '').trim();
    const hasForcedCellUpdate = forcedPrescription !== undefined || forcedBgColor !== undefined || forcedBodyPart !== undefined;
    const reservationGroup = getReservationGroupFromMergeSpan(pendingMergeSpans[key] || oldMergeSpan);
    const shouldBreakReservationGroup = Boolean(reservationGroup?.id) && (
      !immediateContent ||
      immediateContent !== String(oldContent || '').trim() ||
      forcedPrescription !== undefined ||
      forcedBodyPart !== undefined
    );
    const buildReservationGroupBreakPayload = () => buildClearReservationGroupPayload({
      keys: new Set([key]),
      memos: effectiveMemos,
      pendingDisplayValues,
      pendingMergeSpans,
      currentYear,
      currentMonth,
    });
    if (!hasForcedCellUpdate && immediateContent === String(oldContent || '').trim()) {
      if (defaultEditMerge?.revertUpdates?.length) {
        applyImmediateMergeSpan(defaultEditMerge.revertUpdates);
      }
      setEditingCell(null);
      setPendingDisplayValues((prev) => {
        if (prev[key] === undefined) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      removePendingScheduleDraft(currentYear, currentMonth, key);
      return;
    }
    const hasManualParentheticalNote = Boolean(getNonVisitParentheticalSuffix(immediateContent));
    const isVisitOnlyEdit = !hasForcedCellUpdate && isOnlySchedulerVisitSuffixChange(oldContent, immediateContent);
    let result;
    try {
      result = hasManualParentheticalNote || isVisitOnlyEdit
        ? { text: immediateContent }
        : await buildSchedulerAutoText(w, d, r, c, finalValue, false, oldContent);
    } catch (autoErr) {
      addToast(`[오류] 자동완성 실패: ${autoErr?.message || autoErr}`, 'error');
      result = { text: immediateContent };
    }
    if (wasDeletedAfterSaveStarted()) return;
    if (cellSaveVersionRef.current[key] !== saveVersion) return;
    const newContent = normalizeSchedulerVisitSuffix(
      normalize4060StarOrder(typeof result === 'string' ? result : (result?.text || ''))
    );
    let newPrescription = forcedPrescription !== undefined ? forcedPrescription : result?.prescription;
    const newBodyPart = forcedBodyPart !== undefined ? forcedBodyPart : (result?.bodyPart !== undefined ? result.bodyPart : oldBodyPart);
    const cellReservationTime = getDefaultReservationTime(w, d, r);
    const withCellReservationTime = (mergeSpan) => (
      buildMergeSpanWithReservationTime(
        mergeSpan || { rowSpan: 1, colSpan: 1, mergedInto: null },
        cellReservationTime
      )
    );
    const resultMergeSpanWithTime = result?.mergeSpan
      ? withCellReservationTime(result.mergeSpan)
      : undefined;
    const defaultEditMergeSpanWithTime = defaultEditMergeSpan
      ? withCellReservationTime(defaultEditMergeSpan)
      : undefined;
    let newMergeSpan = resultMergeSpanWithTime || defaultEditMergeSpanWithTime;
    const hasPrescriptionResult = forcedPrescription !== undefined || (typeof result === 'object' && result !== null && Object.prototype.hasOwnProperty.call(result, 'prescription'));
    const hasBodyPartResult = forcedBodyPart !== undefined || (typeof result === 'object' && result !== null && Object.prototype.hasOwnProperty.call(result, 'bodyPart'));
    const hasMergeSpanResult = Boolean(defaultEditMergeSpan) || (typeof result === 'object' && result !== null && Object.prototype.hasOwnProperty.call(result, 'mergeSpan'));

    const targetBgColor = forcedBgColor !== undefined ? forcedBgColor : (memos[key]?.bg_color || null);

    // 이름에 도수치료 숫자 패턴이 있으면 해당 처방을 자동 설정 (처방 강제지정이 없을 때만)
    if (forcedPrescription === undefined) {
      const autoDosePrescription = getPrescriptionFromConfiguredDoseTag(settings, currentYear, currentMonth, newContent)
        || get4060PrescriptionFromContent(newContent);
      if (autoDosePrescription) {
        newPrescription = autoDosePrescription;
      } else if (
        !hasPrescriptionResult &&
        has4060Pattern(oldContent) &&
        !has4060Pattern(newContent) &&
        /^\d{2,3}분$/.test(oldPrescription)
      ) {
        // 이름에서 숫자 태그가 없어졌는데 기존 처방이 도수치료 처방이면 처방 없음으로 변경
        newPrescription = '';
      }
    }

    const manualTherapyMerge = buildManualTherapyAutoMergePayload({
      key,
      memos: effectiveMemos,
      pendingMergeSpans,
      currentYear,
      currentMonth,
      rowCount: baseTimeSlots.length,
      content: newContent,
      bgColor: targetBgColor,
      prescription: newPrescription ?? oldPrescription,
      bodyPart: newBodyPart,
      mergeSpan: newMergeSpan || withCellReservationTime(oldMergeSpan),
      durationMinutesMap: prescriptionScheduleSettings.durationMinutesMap,
      doseTags: prescriptionScheduleSettings.doseTags,
      slotMinutes: settings?.interval_minutes || 20,
      oldContent,
      oldPrescription,
    });

    const shouldWritePrescription = hasPrescriptionResult || (newPrescription !== undefined && newPrescription !== null);
    const finalPrescription = newContent.trim()
      ? (shouldWritePrescription ? (newPrescription || '') : oldPrescription)
      : '';
    const finalBodyPart = newContent.trim()
      ? (hasBodyPartResult ? newBodyPart : oldBodyPart)
      : null;
    const plainTextDefaultRowSpan = getPlainTextDefaultRowSpan({
      intervalMinutes: settings?.interval_minutes,
      timeLabelIntervalMinutes: settings?.time_label_interval_minutes,
    });
    const canApplyPlainTextDefaultMerge = () => {
      if (plainTextDefaultRowSpan <= 1 || r + plainTextDefaultRowSpan > baseTimeSlots.length) return false;
      for (let rowOffset = 1; rowOffset < plainTextDefaultRowSpan; rowOffset += 1) {
        const targetKey = cellKey(w, d, r + rowOffset, c);
        const targetMemo = effectiveMemos[targetKey] || {};
        const targetMergeSpan = pendingMergeSpans[targetKey] || targetMemo.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
        const isCurrentEditPreviewMerge = targetMergeSpan.mergedInto === key;
        if (
          String(targetMemo.content || '').trim() ||
          (targetMergeSpan.mergedInto && !isCurrentEditPreviewMerge) ||
          (!isCurrentEditPreviewMerge && (targetMergeSpan.rowSpan || 1) > 1) ||
          (!isCurrentEditPreviewMerge && (targetMergeSpan.colSpan || 1) > 1)
        ) {
          return false;
        }
      }
      return true;
    };
    const shouldUsePlainTextDefaultMerge = Boolean(
      newContent.trim() &&
      !(newMergeSpan?.mergedInto) &&
      (!newMergeSpan || (newMergeSpan.rowSpan || 1) <= 1) &&
      canApplyPlainTextDefaultMerge()
    );
    const plainTextDefaultMergeSpan = shouldUsePlainTextDefaultMerge
      ? { rowSpan: plainTextDefaultRowSpan, colSpan: 1, mergedInto: null }
      : null;
    if (
      shouldUsePlainTextDefaultMerge &&
      defaultEditMergeSpanWithTime &&
      (!resultMergeSpanWithTime || (resultMergeSpanWithTime.rowSpan || 1) <= 1)
    ) {
      newMergeSpan = defaultEditMergeSpanWithTime;
    }
    const finalMergeSpan = newContent.trim()
      ? (hasMergeSpanResult ? newMergeSpan : oldMergeSpan)
      : { rowSpan: 1, colSpan: 1, mergedInto: null };
    const effectiveFinalMergeSpan = plainTextDefaultMergeSpan || finalMergeSpan;
    const finalMergeSpanWithTime = newContent.trim() && !effectiveFinalMergeSpan?.mergedInto
      ? withCellReservationTime(effectiveFinalMergeSpan)
      : finalMergeSpan;
    const prescriptionChanged = oldPrescription !== finalPrescription;
    const bodyPartChanged = (oldBodyPart || '') !== (finalBodyPart || '');
    const mergeSpanChanged = JSON.stringify(oldMergeSpan || null) !== JSON.stringify(finalMergeSpanWithTime || null);
    const bgChanged = forcedBgColor !== undefined && memos[key]?.bg_color !== targetBgColor;
    if (newContent === oldContent && !prescriptionChanged && !bodyPartChanged && !mergeSpanChanged && !bgChanged && !manualTherapyMerge.ok) {
      setEditingCell(null);
      setPendingDisplayValues((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    const reservationGroupBreakBatch = shouldBreakReservationGroup ? buildReservationGroupBreakPayload() : null;
    const combineWithReservationGroupBreak = (payload) => {
      if (!reservationGroupBreakBatch?.payload?.length) return payload;
      const payloadMap = new Map();
      reservationGroupBreakBatch.payload.forEach((item) => {
        payloadMap.set(`${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`, item);
      });
      (Array.isArray(payload) ? payload : [payload]).forEach((item) => {
        payloadMap.set(`${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`, item);
      });
      return Array.from(payloadMap.values());
    };
    const getUndoKeysWithReservationGroupBreak = (keys) => {
      const next = new Set(keys || []);
      (reservationGroupBreakBatch?.payload || []).forEach((item) => {
        next.add(`${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`);
      });
      return next;
    };

    if (manualTherapyMerge.ok) {
      const combinedPayload = combineWithReservationGroupBreak(manualTherapyMerge.payload);
      const undoKeys = getUndoKeysWithReservationGroupBreak(manualTherapyMerge.affectedKeys);
      setPendingDisplayValues((prev) => ({ ...prev, [key]: newContent }));
      applyImmediateCellDisplay(combinedPayload);
      applyImmediateMergeSpan(combinedPayload);
      recordUndo({
        type: 'bulk-edit',
        oldMemos: buildMemoSnapshotForKeys(undoKeys, { includePendingDisplay: false }),
      });
      const success = await queuedSaveShockwaveMemosBulk(combinedPayload);
      if (success) {
        removePendingScheduleDraft(currentYear, currentMonth, key);
        clearImmediateCellDisplay(combinedPayload);
      } else {
        rememberPendingScheduleDraft(currentYear, currentMonth, key, newContent);
        const errMsg = window.lastDbError?.message || window.lastDbError?.error_description || (typeof window.lastDbError === 'string' ? window.lastDbError : '') || '상세 에러 없음';
        addToast(`저장 실패 (${errMsg})`, 'error');
      }
      return;
    }

    if (!newContent.trim()) {
      const getBlankClearMergeTarget = () => {
        const previewMergeSpan = pendingMergeSpans[key] || getDefaultEditingMergeSpanForKey(key);
        const directMergeSpan = previewMergeSpan || effectiveMemos[key]?.merge_span || oldMergeSpan || EMPTY_SCHEDULE_MERGE_SPAN;
        const masterKey = directMergeSpan?.mergedInto || key;
        const [masterW, masterD, masterR, masterC] = masterKey.split('-').map(Number);
        const masterMemo = effectiveMemos[masterKey] || memos[masterKey] || {};
        const masterPreview = pendingMergeSpans[masterKey] || defaultEditMergeSpanRef.current[masterKey]?.mergeSpan;
        const masterMergeSpan = masterPreview || masterMemo.merge_span || directMergeSpan || EMPTY_SCHEDULE_MERGE_SPAN;
        const rowSpan = Math.max(
          1,
          masterMergeSpan?.rowSpan || 1,
          defaultEditMergeSpan?.rowSpan || 1
        );
        const colSpan = Math.max(1, masterMergeSpan?.colSpan || 1);
        return {
          masterKey,
          w: Number.isFinite(masterW) ? masterW : w,
          d: Number.isFinite(masterD) ? masterD : d,
          r: Number.isFinite(masterR) ? masterR : r,
          c: Number.isFinite(masterC) ? masterC : c,
          rowSpan,
          colSpan,
        };
      };
      const clearTarget = getBlankClearMergeTarget();
      const shouldBulkClearBlank = clearTarget.rowSpan > 1 || clearTarget.colSpan > 1 || clearTarget.masterKey !== key;
      if (shouldBulkClearBlank) {
        const payload = [];
        const affectedKeys = [];
        for (let rowOffset = 0; rowOffset < clearTarget.rowSpan; rowOffset += 1) {
          for (let colOffset = 0; colOffset < clearTarget.colSpan; colOffset += 1) {
            const targetRow = clearTarget.r + rowOffset;
            const targetCol = clearTarget.c + colOffset;
            const targetKey = cellKey(clearTarget.w, clearTarget.d, targetRow, targetCol);
            affectedKeys.push(targetKey);
            payload.push(markIntentionalClearPayload({
              year: currentYear,
              month: currentMonth,
              week_index: clearTarget.w,
              day_index: clearTarget.d,
              row_index: targetRow,
              col_index: targetCol,
              content: '',
              bg_color: null,
              merge_span: EMPTY_SCHEDULE_MERGE_SPAN,
              prescription: null,
              body_part: null,
            }));
          }
        }
        const combinedPayload = combineWithReservationGroupBreak(payload);
        const undoKeys = getUndoKeysWithReservationGroupBreak(affectedKeys);

        setPendingDisplayValues((prev) => {
          const next = { ...prev };
          undoKeys.forEach((k) => delete next[k]);
          return next;
        });
        applyImmediateCellDisplay(combinedPayload);
        applyImmediateMergeSpan(combinedPayload);
        recordUndo({
          type: 'bulk-edit',
          oldMemos: buildMemoSnapshotForKeys(undoKeys, { includePendingDisplay: false }),
        });
        payload.forEach((item) => {
          const draftKey = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
          rememberDeletedScheduleDraft(currentYear, currentMonth, draftKey);
          removePendingScheduleDraft(currentYear, currentMonth, draftKey);
        });
        const success = await queuedSaveShockwaveMemosBulk(combinedPayload);
        if (success) {
          clearImmediateCellDisplay(combinedPayload, { force: true });
        } else {
          payload.forEach((item) => {
            const draftKey = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
            removeDeletedScheduleDraft(currentYear, currentMonth, draftKey);
          });
          rememberPendingScheduleDraft(currentYear, currentMonth, key, '');
          const errMsg = window.lastDbError?.message || window.lastDbError?.error_description || (typeof window.lastDbError === 'string' ? window.lastDbError : '') || '상세 에러 없음';
          addToast(`저장 실패 (${errMsg})`, 'error');
        }
        return;
      }
    }

    if (manualTherapyMerge.reason === 'occupied') {
      addToast('아래 셀이 비어있지 않아 자동 병합하지 않았습니다.', 'warning');
    } else if (manualTherapyMerge.reason === 'bounds') {
      addToast('아래 시간이 부족해 자동 병합하지 않았습니다.', 'warning');
    }

    if (newContent.trim() && (defaultEditMergeSpan?.rowSpan > 1 || shouldUsePlainTextDefaultMerge) && (finalMergeSpanWithTime.rowSpan || 1) > 1) {
      const payload = [];
      const affectedKeys = [];
      for (let rowOffset = 0; rowOffset < finalMergeSpanWithTime.rowSpan; rowOffset += 1) {
        const targetRow = r + rowOffset;
        const targetKey = cellKey(w, d, targetRow, c);
        affectedKeys.push(targetKey);
        payload.push({
          year: currentYear,
          month: currentMonth,
          week_index: w,
          day_index: d,
          row_index: targetRow,
          col_index: c,
          content: rowOffset === 0 ? newContent : '',
          bg_color: rowOffset === 0 ? targetBgColor : null,
          merge_span: rowOffset === 0
            ? finalMergeSpanWithTime
            : { rowSpan: 1, colSpan: 1, mergedInto: key },
          prescription: rowOffset === 0 ? finalPrescription : null,
          body_part: rowOffset === 0 ? finalBodyPart : null,
        });
      }
      const combinedPayload = combineWithReservationGroupBreak(payload);
      const undoKeys = getUndoKeysWithReservationGroupBreak(affectedKeys);

      setPendingDisplayValues((prev) => ({ ...prev, [key]: newContent }));
      applyImmediateCellDisplay(combinedPayload);
      applyImmediateMergeSpan(combinedPayload);
      recordUndo({
        type: 'bulk-edit',
        oldMemos: buildMemoSnapshotForKeys(undoKeys, { includePendingDisplay: false }),
      });
      const success = await queuedSaveShockwaveMemosBulk(combinedPayload);
      if (success) {
        removePendingScheduleDraft(currentYear, currentMonth, key);
        clearImmediateCellDisplay(combinedPayload);
      } else {
        rememberPendingScheduleDraft(currentYear, currentMonth, key, newContent);
        const errMsg = window.lastDbError?.message || window.lastDbError?.error_description || (typeof window.lastDbError === 'string' ? window.lastDbError : '') || '상세 에러 없음';
        addToast(`저장 실패 (${errMsg})`, 'error');
      }
      return;
    }

    const singleCellPayload = [{
      year: currentYear,
      month: currentMonth,
      week_index: w,
      day_index: d,
      row_index: r,
      col_index: c,
      content: newContent,
      bg_color: targetBgColor,
      merge_span: finalMergeSpanWithTime,
      prescription: finalPrescription,
      body_part: finalBodyPart,
    }];
    if (!newContent.trim()) {
      singleCellPayload[0] = markIntentionalClearPayload(singleCellPayload[0]);
    }
    const finalSinglePayload = combineWithReservationGroupBreak(singleCellPayload);
    const singleUndoKeys = getUndoKeysWithReservationGroupBreak([key]);
    applyImmediateCellDisplay(finalSinglePayload);
    applyImmediateMergeSpan(finalSinglePayload);
    if (reservationGroupBreakBatch?.payload?.length) {
      recordUndo({
        type: 'bulk-edit',
        oldMemos: buildMemoSnapshotForKeys(singleUndoKeys, { includePendingDisplay: false }),
      });
    } else {
      recordUndo({
        type: 'edit',
        year: currentYear,
        month: currentMonth,
        w,
        d,
        r,
        c,
        oldContent,
        oldBg: memos[key]?.bg_color,
        oldMergeSpan,
        oldPrescription: oldPrescription || null,
        oldBodyPart: oldBodyPart || null,
      });
    }
    if (!newContent.trim()) {
      rememberDeletedScheduleDraft(currentYear, currentMonth, key);
      removePendingScheduleDraft(currentYear, currentMonth, key);
    }
    const success = reservationGroupBreakBatch?.payload?.length
      ? await queuedSaveShockwaveMemosBulk(finalSinglePayload)
      : await queuedOnSaveMemo(
          currentYear,
          currentMonth,
          w,
          d,
          r,
          c,
          newContent,
          forcedBgColor !== undefined ? forcedBgColor : undefined,
          finalMergeSpanWithTime,
          finalPrescription,
          finalBodyPart
        );
    if (success) {
      removePendingScheduleDraft(currentYear, currentMonth, key);
      clearImmediateCellDisplay(finalSinglePayload, { force: !newContent.trim() });
    } else {
      if (!newContent.trim()) removeDeletedScheduleDraft(currentYear, currentMonth, key);
      rememberPendingScheduleDraft(currentYear, currentMonth, key, newContent);
    }
    // pendingDisplayValues는 즉시 삭제하지 않음.
    // memos 컨텍스트가 새 값을 반영할 때까지 유지하여 깜빡임 방지.
    // 아래 useEffect(cleanupStalePendingValues)에서 memos 업데이트 후 자동 정리.
    if (!success) {
      const errMsg = window.lastDbError?.message || window.lastDbError?.error_description || (typeof window.lastDbError === 'string' ? window.lastDbError : '') || '상세 에러 없음';
      addToast(`저장 실패 (${errMsg})`, 'error');
    }
  }, [editValue, currentYear, currentMonth, settings, memos, effectiveMemos, pendingMergeSpans, baseTimeSlots.length, queuedOnSaveMemo, addToast, buildSchedulerAutoText, recordUndo, buildMemoSnapshotForKeys, queuedSaveShockwaveMemosBulk, applyImmediateCellDisplay, applyImmediateMergeSpan, clearImmediateCellDisplay, cellKey, setPendingDisplayValues, prescriptionScheduleSettings.doseTags, prescriptionScheduleSettings.durationMinutesMap, getDefaultEditingMergeSpanForKey, getDefaultReservationTime]);

  handleCellSaveRef.current = handleCellSave;

  useEffect(() => {
    return () => {
      flushEditDraft();
    };
  }, [flushEditDraft]);

  const { handleCellContextMenu } = useScheduleContextMenuOpening({
    cellKey,
    contextMenu,
    getDefaultReservationTime,
    memos: effectiveMemos,
    normalizeCellToMergeMaster,
    pendingDisplayValues,
    selectSingleCell,
    selectedKeys,
    setActiveContextSubmenu,
    setContextMenu,
    setContextMenuBodyInput,
    setContextMenuBodyPartOptions,
    setContextMenuHiddenBodyPartKeys,
    setContextMenuMemoDrafts,
    setContextMenuNoteInput,
    setContextMenuReservationInput,
    setContextMenuVisitInput,
    setEditingCell,
    skipNextEditBlurSaveRef,
  });

  const {
    deleteCells,
    tryMergeSelection,
  } = useScheduleMergeActions({
    currentYear,
    currentMonth,
    memos: effectiveMemos,
    pendingDisplayValues,
    pendingMergeSpans,
    selectedKeys,
    cellKey,
    computeSelectionInfo,
    saveShockwaveMemosBulk: queuedSaveShockwaveMemosBulk,
    recordUndo,
    applyImmediateCellDisplay,
    applyImmediateMergeSpan,
    clearImmediateCellDisplay,
    addToast,
    setContextMenu,
  });

  const selectionInfo = computeSelectionInfo();
  const {
    effectivePrescriptionColors,
    effectiveSchedulerTextSettings,
    hasCompletableSelection,
    shortcutLabels,
    treatmentCompleteButtonLabel,
  } = useScheduleViewState({
    currentMonth,
    currentYear,
    memos: effectiveMemos,
    normalizeKeysToMergeMasters,
    selectedKeys,
    settings,
    treatmentCompleteBg: TREATMENT_COMPLETE_BG,
  });

  const getAdjacentCell = useCallback((cell, direction) => {
    let { w, d, r, c } = normalizeCellToMergeMaster(cell);
    const key = cellKey(w, d, r, c);
    const mergeSpan = getEffectiveMergeSpan(key) || { rowSpan: 1, colSpan: 1, mergedInto: null };
    const rowSpan = Math.max(1, mergeSpan.rowSpan || 1);
    const colSpan = Math.max(1, mergeSpan.colSpan || 1);

    const normalizeTarget = (targetCell) => normalizeCellToMergeMaster(targetCell);

    if (direction === 'ArrowLeft') {
      if (c > 0) return normalizeTarget({ w, d, r, c: c - 1 });
      if (d > 0) return normalizeTarget({ w, d: d - 1, r, c: colCount - 1 });
      if (w > 0) return normalizeTarget({ w: w - 1, d: weeks[w - 1].length - 1, r, c: colCount - 1 });
      return { w, d, r, c };
    }

    if (direction === 'ArrowRight') {
      const nextCol = c + colSpan;
      if (nextCol < colCount) return normalizeTarget({ w, d, r, c: nextCol });
      if (d < weeks[w].length - 1) return normalizeTarget({ w, d: d + 1, r, c: 0 });
      if (w < weeks.length - 1) return normalizeTarget({ w: w + 1, d: 0, r, c: 0 });
      return { w, d, r, c };
    }

    if (direction === 'ArrowUp') {
      if (r > 0) return normalizeTarget({ w, d, r: r - 1, c });
      if (w > 0) return normalizeTarget({ w: w - 1, d, r: baseTimeSlots.length - 1, c });
      return { w, d, r, c };
    }

    if (direction === 'ArrowDown') {
      const nextRow = r + rowSpan;
      if (nextRow < baseTimeSlots.length) return normalizeTarget({ w, d, r: nextRow, c });
      if (w < weeks.length - 1) return normalizeTarget({ w: w + 1, d, r: 0, c });
      return { w, d, r, c };
    }

    return { w, d, r, c };
  }, [baseTimeSlots.length, cellKey, colCount, getEffectiveMergeSpan, normalizeCellToMergeMaster, weeks]);

  const {
    handleCopySelection,
    handleCutSelection,
    handlePasteSelection,
  } = useScheduleClipboardActions({
    selectedCell,
    selectedCellRef,
    selectionInfo,
    memos: effectiveMemos,
    pendingDisplayValues,
    pendingMergeSpans,
    clipboardRef,
    clipboardSource,
    setClipboardSource,
    currentYear,
    currentMonth,
    settings,
    baseTimeSlotsLength: baseTimeSlots.length,
    colCount,
    cellKey,
    buildSchedulerAutoText,
    saveShockwaveMemosBulk: queuedSaveShockwaveMemosBulk,
    recordUndo,
    applyImmediateCellDisplay,
    applyImmediateMergeSpan,
    clearImmediateCellDisplay,
    addToast,
    setContextMenu,
  });

  const {
    handleToggleTreatmentComplete,
    handleToggleTreatmentCancel,
    handleToggleHolidayBackground,
  } = useScheduleStatusActions({
    selectedKeys,
    memos: effectiveMemos,
    currentYear,
    currentMonth,
    normalizeKeysToMergeMasters,
    cellKey,
    saveShockwaveMemosBulk: queuedSaveShockwaveMemosBulk,
    addToast,
    recordUndo,
    setContextMenu,
    pendingCellBgColors,
    applyImmediateCellBg,
    clearImmediateCellBg,
  });

  const {
    fetchPatientHistory,
    handleUpdateLogVisitCount,
    handleUpdateCurrentCellVisitCount,
    handleUpdateDraftHistoryVisitCount,
    handleOpenPatientHistoryModal,
    handleApplyHistoryToCell,
  } = usePatientHistoryActions({
    currentYear,
    currentMonth,
    holidays,
    settings,
    therapists,
    manualTherapists,
    monthlyTherapists,
    monthlyManualTherapists,
    selectedCell,
    editingCell,
    editValue,
    editInputRef,
    memos: effectiveMemos,
    pendingDisplayValues,
    baseTimeSlotsLength: baseTimeSlots.length,
    colCount,
    cellKey,
    saveShockwaveMemosBulk,
    addToast,
    setPendingDisplayValues,
    applyImmediateCellDisplay,
    applyImmediateMergeSpan,
    clearImmediateCellDisplay,
    setPatientHistoryModalOpen,
    setPatientHistoryModalData,
  });

  const closePatientHistoryModal = useCallback(() => {
    setPendingPatientHistoryApplyLog(null);
    setPatientHistoryModalOpen(false);
  }, []);

  const requestApplyPatientHistoryToCell = useCallback((log) => {
    if (!log) return;
    setPendingPatientHistoryApplyLog(log);
  }, []);

  const confirmApplyPatientHistoryToCell = useCallback(() => {
    if (!pendingPatientHistoryApplyLog) return;
    const targetLog = pendingPatientHistoryApplyLog;
    setPendingPatientHistoryApplyLog(null);
    handleApplyHistoryToCell(targetLog);
    setPatientHistoryModalOpen(false);
  }, [handleApplyHistoryToCell, pendingPatientHistoryApplyLog]);

  useEffect(() => {
    if (!patientHistoryModalOpen) return;
    requestAnimationFrame(() => {
      patientHistorySearchInputRef.current?.focus({ preventScroll: true });
      patientHistorySearchInputRef.current?.select?.();
    });

    const handlePatientHistoryEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      closePatientHistoryModal();
    };

    window.addEventListener('keydown', handlePatientHistoryEscape, true);
    document.addEventListener('keydown', handlePatientHistoryEscape, true);
    return () => {
      window.removeEventListener('keydown', handlePatientHistoryEscape, true);
      document.removeEventListener('keydown', handlePatientHistoryEscape, true);
    };
  }, [patientHistoryModalOpen, closePatientHistoryModal]);

  useEffect(() => {
    if (!patientHistoryModalOpen) return;

    const overlay = patientHistoryModalOverlayRef.current;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    let touchStartY = 0;

    const shouldBlockScroll = (target, deltaY) => {
      const modalBody = patientHistoryModalBodyRef.current;
      if (!modalBody || !modalBody.contains(target)) return true;

      const canScroll = modalBody.scrollHeight > modalBody.clientHeight;
      if (!canScroll) return true;

      const atTop = modalBody.scrollTop <= 0;
      const atBottom = modalBody.scrollTop + modalBody.clientHeight >= modalBody.scrollHeight - 1;
      return (deltaY < 0 && atTop) || (deltaY > 0 && atBottom);
    };

    const handleWheel = (event) => {
      if (shouldBlockScroll(event.target, event.deltaY)) {
        event.preventDefault();
      }
    };

    const handleTouchStart = (event) => {
      touchStartY = event.touches?.[0]?.clientY ?? 0;
    };

    const handleTouchMove = (event) => {
      const currentY = event.touches?.[0]?.clientY ?? touchStartY;
      const deltaY = touchStartY - currentY;
      if (shouldBlockScroll(event.target, deltaY)) {
        event.preventDefault();
      }
    };

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    overlay?.addEventListener('wheel', handleWheel, { passive: false });
    overlay?.addEventListener('touchstart', handleTouchStart, { passive: true });
    overlay?.addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      overlay?.removeEventListener('wheel', handleWheel);
      overlay?.removeEventListener('touchstart', handleTouchStart);
      overlay?.removeEventListener('touchmove', handleTouchMove);
    };
  }, [patientHistoryModalOpen]);

  const handleContextAction = useScheduleContextMenuActions({
    selectedKeys,
    contextMenu,
    memos: effectiveMemos,
    pendingDisplayValues,
    currentYear,
    currentMonth,
    settings,
    onSaveMemo: queuedOnSaveMemo,
    saveShockwaveMemosBulk: queuedSaveShockwaveMemosBulk,
    addToast,
    handleCopySelection,
    handleCutSelection,
    handlePasteSelection,
    handleToggleTreatmentComplete,
    handleToggleTreatmentCancel,
    tryMergeSelection,
    buildMemoSnapshotForKeys,
    recordUndo,
    setContextMenu,
    setContextMenuBodyPartOptions,
    setContextMenuMemoDrafts,
    setContextMenuReservationInput,
    setContextMenuVisitInput,
    getDefaultReservationTime,
    cellKey,
    rowCount: baseTimeSlots.length,
    pendingMergeSpans,
    prescriptionScheduleSettings,
    applyImmediateCellDisplay,
    applyImmediateMergeSpan,
    clearImmediateCellDisplay,
  });

  const stepContextMenuVisitInput = useCallback((delta) => {
    const nextValue = stepContextMenuVisitValue(contextMenuVisitInput, delta);
    flushSync(() => setContextMenuVisitInput(nextValue));
    handleContextAction({ type: 'visitCount', value: nextValue });
  }, [contextMenuVisitInput, handleContextAction]);

  const stepContextMenuReservationInput = useCallback((delta) => {
    if (!contextMenu) return;
    const baseTime = contextMenu.defaultReservationTime || getDefaultReservationTime(
      contextMenu.weekIdx,
      contextMenu.dayIdx,
      contextMenu.rowIdx
    );
    const nextTime = stepReservationTimeWithinCellBase(contextMenuReservationInput, baseTime, delta);
    flushSync(() => setContextMenuReservationInput(nextTime));
    handleContextAction({ type: 'reservationTime', value: nextTime });
  }, [contextMenu, contextMenuReservationInput, getDefaultReservationTime, handleContextAction]);

  const focusEditInputImmediately = useCallback(() => {
    const input = editInputRef.current;
    if (!input) return;
    input.focus();
    if (!imeOpenRef.current && document.activeElement === input) {
      const len = input.value?.length || 0;
      input.setSelectionRange(len, len);
    }
  }, []);

  const beginEditingCell = useCallback((key, nextValue, _preserveValue = false) => {
    editDraftRef.current = { key, value: nextValue || '', dirty: false };
    flushSync(() => {
      setEditingCell(key);
      setEditValue(nextValue);
    });
    if (editInputRef.current) {
      editInputRef.current.value = nextValue || '';
    }
    focusEditInputImmediately();
  }, [focusEditInputImmediately]);

  const promoteFocusedInputToEditor = useCallback((key, value) => {
    const [w, d, r, c] = String(key || '').split('-').map(Number);
    if ([w, d, r, c].every(Number.isFinite)) {
      prepareDefaultEditMerge(w, d, r, c, effectiveMemos[key]?.content || '');
    }
    editDraftRef.current = { key, value: value || '', dirty: true };
    flushSync(() => {
      setEditingCell(key);
      setEditValue(value);
    });
  }, [effectiveMemos, prepareDefaultEditMerge]);

  const handleOpenBodyPartMenu = useCallback(() => {
    if (!selectedCell) return;
    const { w, d, r, c } = selectedCell;
    const keyStr = cellKey(w, d, r, c);
    const memo = effectiveMemos[keyStr] || {};
    
    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 2;
    
    let targetKeyStr = keyStr;
    const mergeSpan = getEffectiveMergeSpan(keyStr, effectiveMemos);
    if (mergeSpan && mergeSpan.mergedInto) {
      targetKeyStr = mergeSpan.mergedInto;
    }
    
    const activeCellEl = document.getElementById(`cell-${targetKeyStr}`);
    if (activeCellEl) {
      const rect = activeCellEl.getBoundingClientRect();
      targetX = rect.right + 8; // 셀 바로 우측
      targetY = rect.top;
      
      // 우측 공간이 팝업창 너비(약 260px)보다 부족하면 좌측에 배치
      if (targetX + 260 > window.innerWidth) {
        targetX = Math.max(10, rect.left - 260);
      }
    } else {
      // DOM을 못 찾을 경우 폴백 (마우스 위치)
      const mouseX = tooltipMousePosRef.current?.x || targetX;
      const mouseY = tooltipMousePosRef.current?.y || targetY;
      targetX = mouseX + 160;
      targetY = Math.max(10, mouseY + 15);
      if (targetX + 280 > window.innerWidth) {
        targetX = Math.max(10, mouseX - 260);
      }
    }
    
    const mockEvent = {
      preventDefault: () => {},
      stopPropagation: () => {},
      clientX: targetX,
      clientY: targetY,
    };
    
    handleCellContextMenu(mockEvent, w, d, r, c, memo.prescription || '', '');
    setContextMenu(prev => prev ? { ...prev, isStandaloneBodyPart: true } : null);
    setActiveContextSubmenu('body');
  }, [selectedCell, cellKey, effectiveMemos, handleCellContextMenu, setActiveContextSubmenu, setContextMenu, getEffectiveMergeSpan]);

  const positionTooltip = useCallback((clientX, clientY) => {
    const tooltipEl = tooltipRef.current;
    if (!tooltipEl) return;

    const offset = 14;
    const edgePadding = 8;
    const { width, height } = tooltipEl.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = clientX + offset;
    let top = clientY + offset;

    // 부위 팝업(contextMenu)이 열려있으면 툴팁을 커서 위쪽에 배치하여 겹침 방지
    if (contextMenu) {
      top = clientY - height - offset;
    }

    if (left + width + edgePadding > viewportWidth) {
      left = clientX - width - offset;
    }
    if (top + height + edgePadding > viewportHeight) {
      top = clientY - height - offset;
    }
    if (top < edgePadding) {
      top = edgePadding;
    }

    left = Math.min(Math.max(edgePadding, left), Math.max(edgePadding, viewportWidth - width - edgePadding));
    top = Math.min(Math.max(edgePadding, top), Math.max(edgePadding, viewportHeight - height - edgePadding));

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
    tooltipEl.style.opacity = hoverCell ? '1' : '0';
  }, [hoverCell, contextMenu]);

  const handleTimeLabelMouseMove = useCallback((e, weekIdx, dayIdx, startSlotRenderIndex, labelSpan, daySlots) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    const slotHeight = rect.height / labelSpan;
    const offset = Math.floor(relativeY / slotHeight);
    const targetSlotRenderIndex = Math.min(startSlotRenderIndex + offset, startSlotRenderIndex + labelSpan - 1);
    const slotInfo = daySlots[targetSlotRenderIndex];
    if (slotInfo) {
      setHoverCell({
        weekIdx,
        dayIdx,
        rowIdx: slotInfo.idx,
        colIdx: -1,
        staffBlockRule: null,
        slotInfo,
        selectionInfo: null,
      });
      tooltipMousePosRef.current = { x: e.clientX, y: e.clientY };
      if (tooltipRef.current) positionTooltip(e.clientX, e.clientY);
    }
  }, [positionTooltip]);

  const handleTimeLabelMouseLeave = useCallback(() => {
    setHoverCell(null);
  }, []);

  const handleKeyboardSelectionMoved = useCallback((cell, movedKeys = []) => {
    if (!cell) return;
    const dayInfo = weeks?.[cell.w]?.[cell.d];
    if (!dayInfo) return;

    const daySlots = getTimeSlotsForDay(dayInfo);
    const slotInfo = daySlots.find((slot) => slot.idx === cell.r);
    if (!slotInfo) return;

    const dateKey = `${dayInfo.year}-${dayInfo.month}-${dayInfo.day}`;
    const therapistName = getTherapistNameForDate(cell.c, dayInfo.day) || '';
    const staffBlockRule = getStaffScheduleBlockForCell(dateKey, therapistName, slotInfo.time);

    const movedCells = movedKeys
      .map((key) => key.split('-').map(Number))
      .filter((parts) => parts.length === 4 && parts.every(Number.isFinite))
      .map(([w, d, r, c]) => ({ w, d, r, c }))
      .filter((item) => item.w === cell.w && item.d === cell.d);
    const selectionHoverInfo = movedCells.length > 1
      ? {
          w: cell.w,
          d: cell.d,
          minRow: Math.min(...movedCells.map((item) => item.r)),
          maxRow: Math.max(...movedCells.map((item) => item.r)),
          minCol: Math.min(...movedCells.map((item) => item.c)),
          maxCol: Math.max(...movedCells.map((item) => item.c)),
        }
      : null;

    const nextHoverCell = {
      weekIdx: cell.w,
      dayIdx: cell.d,
      rowIdx: cell.r,
      colIdx: cell.c,
      staffBlockRule,
      slotInfo,
      selectionInfo: selectionHoverInfo,
      isKeyboardMove: true,
    };
    setHoverCell(nextHoverCell);

    window.requestAnimationFrame(() => {
      const targetEl = document.getElementById(`cell-${cellKey(cell.w, cell.d, cell.r, cell.c)}`);
      if (!targetEl) {
        positionTooltip(tooltipMousePosRef.current.x, tooltipMousePosRef.current.y);
        return;
      }
      const rect = targetEl.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      tooltipMousePosRef.current = { x, y };
      positionTooltip(x, y);
    });
  }, [cellKey, getStaffScheduleBlockForCell, getTherapistNameForDate, getTimeSlotsForDay, positionTooltip, weeks]);

  const handleKeyDown = useScheduleKeyboardActions({
    contextMenu,
    clipboardSource,
    setClipboardSource,
    selectedCell,
    selectedCellRef,
    editingCell,
    selectedKeys,
    pendingDisplayValues,
    pendingMemoOverrides,
    pendingMergeSpans,
    pendingDisplayValuesRef,
    pendingMemoOverridesRef,
    pendingCellBgColors,
    applyImmediateCellBg,
    applyImmediateCellDisplay,
    applyImmediateMergeSpan,
    clearImmediateCellDisplay,
    currentYear,
    currentMonth,
    memos: effectiveMemos,
    shockwaveSettings: settings,
    imeOpenRef,
    cellKey,
    colCount,
    rowCount: baseTimeSlots.length,
    deleteCells,
    buildRangeKeys,
    selectSingleCell,
    getAdjacentCell,
    beginEditingCell,
    handleCopySelection,
    handleCutSelection,
    handleToggleTreatmentComplete,
    handleToggleTreatmentCancel,
    handleToggleHolidayBackground,
    tryMergeSelection,
    doUndo,
    isEditableTarget,
    isContextMenuTarget,
    handleOpenPatientHistoryModal,
    buildMemoSnapshotForKeys,
    onSaveMemo: queuedOnSaveMemo,
    saveShockwaveMemosBulk: queuedSaveShockwaveMemosBulk,
    recordUndo,
    addToast,
    setEditingCell,
    setRangeEnd,
    setSelectedKeys,
    setContextMenu,
    getDefaultReservationTime,
    handleOpenBodyPartMenu,
    onSelectionMoved: handleKeyboardSelectionMoved,
  });

  useScheduleGlobalEvents({
    viewRef,
    contextMenuRef,
    dragSelectionRef,
    selectedCell,
    selectedCellRef,
    selectedKeys,
    editingCell,
    handleKeyDown,
    handlePasteSelection,
    handleOpenPatientHistoryModal,
    isEditableTarget,
    isContextMenuTarget,
    setActiveContextSubmenu,
    setContextMenu,
  });

  useEffect(() => {
    if (!editingCell) return;
    // Double rAF ensures the input DOM node exists after React re-renders the cell
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (editInputRef.current && document.activeElement !== editInputRef.current) {
          editInputRef.current.focus();
        }
      });
    });
  }, [editingCell]);

  useEffect(() => {
    if (!selectedCell || editingCell) return;
    if (isEditableTarget(document.activeElement)) return;
    focusSelectedCellInput();
  }, [selectedCell, editingCell, isEditableTarget, focusSelectedCellInput]);

  const moveEditInputCaret = useCallback((input, key, extendSelection = false) => {
    if (!input || typeof input.selectionStart !== 'number') return;

    const length = input.value.length;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;

    if (!extendSelection) {
      const position = start !== end
        ? (key === 'ArrowLeft' ? Math.min(start, end) : Math.max(start, end))
        : Math.max(0, Math.min(length, start + (key === 'ArrowLeft' ? -1 : 1)));
      input.setSelectionRange(position, position);
      return;
    }

    const direction = input.selectionDirection || 'none';
    const anchor = direction === 'backward' ? end : start;
    const focus = direction === 'backward' ? start : end;
    const nextFocus = Math.max(0, Math.min(length, focus + (key === 'ArrowLeft' ? -1 : 1)));

    if (nextFocus < anchor) {
      input.setSelectionRange(nextFocus, anchor, 'backward');
    } else {
      input.setSelectionRange(anchor, nextFocus, 'forward');
    }
  }, []);

  // 편집 완료 후 아래로 이동
  const handleEditKeyDown = useCallback((e, w, d, r, c) => {
    const isMeta = e.metaKey || e.ctrlKey;
    const hasValue = Boolean(e.target.value?.trim());

    // 1. Ctrl/Cmd + [1-9]/[A-Z] (처방 단축키)
    const isDigitOrAlphaCode = /^(Digit[1-9]|Key[A-Z])$/.test(e.code);
    const isDigitOrAlphaKey = /^[1-9a-zA-Z]$/.test(e.key);
    const isMetaOrAltOrShift = isMeta || e.altKey || (e.shiftKey && isMeta);

    let keyNum = '';
    if (isDigitOrAlphaCode) {
      const digitMatch = e.code.match(/^Digit([1-9])$/);
      if (digitMatch) {
        keyNum = digitMatch[1];
      } else {
        const alphaMatch = e.code.match(/^Key([A-Z])$/);
        if (alphaMatch) keyNum = alphaMatch[1];
      }
    } else if (isDigitOrAlphaKey) {
      keyNum = e.key.toUpperCase();
    }

    // 복사(C), 붙여넣기(V), 전체선택(A), 잘라내기(X), 실행취소(Z), 찾기(F) 및 완료(S), 취소(D), 공휴일(B) 등의 주요 편집 조작 단축키 보존
    const isReservedEditorKey = /^[ACXZFSDB]$/i.test(keyNum);
    const isValidShortcut = isMetaOrAltOrShift && keyNum && !isReservedEditorKey;

    if (isValidShortcut) {
      e.preventDefault();
      e.stopPropagation();
      if (hasValue) {
        const effectiveManualSettings = getEffectiveSettlementSettings(settings, currentYear, currentMonth, 'manual_therapy');
        const effectiveShockwaveSettings = getEffectiveSettlementSettings(settings, currentYear, currentMonth, 'shockwave');

        const manualShortcuts = effectiveManualSettings?.shortcuts || {};
        const manualPrescription = Object.keys(manualShortcuts).find((prescription) => manualShortcuts[prescription] === keyNum);
        const shockwaveShortcuts = effectiveShockwaveSettings?.shortcuts || {};
        const shockwavePrescription = Object.keys(shockwaveShortcuts).find((prescription) => shockwaveShortcuts[prescription] === keyNum);
        const targetPrescription = manualPrescription || shockwavePrescription || '';

        if (targetPrescription) {
          const currentVal = e.target.value;
          const currentPrescription = memos[cellKey(w, d, r, c)]?.prescription || '';
          const previousDoseTag = prescriptionScheduleSettings.doseTags?.[currentPrescription] || currentPrescription.match(/(\d{2,3})/)?.[1] || '';
          const autoTagMatch = targetPrescription.match(/(\d{2,3})/);
          const doseTag = prescriptionScheduleSettings.doseTags?.[targetPrescription] || (autoTagMatch ? autoTagMatch[1] : '');
          const updatedContent = updateDoseTagForPrescriptionContent(
            currentVal,
            doseTag,
            previousDoseTag,
            prescriptionScheduleSettings.doseTags
          );
          handleCellSave(w, d, r, c, updatedContent, targetPrescription);
        }
      }
      return;
    }

    // 2. Ctrl/Cmd + Enter (부위 입력 메뉴 열기)
    if (e.key === 'Enter' && isMeta) {
      e.preventDefault();
      e.stopPropagation();
      if (hasValue) {
        const currentVal = e.target.value;
        handleCellSave(w, d, r, c, currentVal).then(() => {
          handleOpenBodyPartMenu();
        });
      }
      return;
    }

    // 3. Ctrl/Cmd + S (치료 완료 토글)
    if ((e.key === 's' || e.key === 'S') && isMeta) {
      e.preventDefault();
      e.stopPropagation();
      if (hasValue) {
        const currentVal = e.target.value;
        const key = cellKey(w, d, r, c);
        const currentBg = Object.prototype.hasOwnProperty.call(pendingCellBgColors || {}, key)
          ? pendingCellBgColors[key]
          : memos[key]?.bg_color;
        const nextBgColor = isTreatmentCompleteBg(currentBg) ? null : TREATMENT_COMPLETE_BG;
        handleCellSave(w, d, r, c, currentVal, undefined, nextBgColor);
      }
      return;
    }

    // 4. Ctrl/Cmd + D (예약 취소 토글)
    if ((e.key === 'd' || e.key === 'D') && isMeta) {
      e.preventDefault();
      e.stopPropagation();
      if (hasValue) {
        const currentVal = e.target.value;
        const key = cellKey(w, d, r, c);
        const currentBg = Object.prototype.hasOwnProperty.call(pendingCellBgColors || {}, key)
          ? pendingCellBgColors[key]
          : memos[key]?.bg_color;
        const nextBgColor = isTreatmentCancelBg(currentBg) ? null : TREATMENT_CANCEL_BG;
        handleCellSave(w, d, r, c, currentVal, undefined, nextBgColor);
      }
      return;
    }

    // 5. Ctrl/Cmd + B (공휴일/녹색 배경 토글)
    if ((e.key === 'b' || e.key === 'B') && isMeta) {
      e.preventDefault();
      e.stopPropagation();
      if (hasValue) {
        const currentVal = e.target.value;
        const key = cellKey(w, d, r, c);
        const currentBg = memos[key]?.bg_color;
        const nextBgColor = currentBg === SCHEDULER_HOLIDAY_BG ? null : SCHEDULER_HOLIDAY_BG;
        handleCellSave(w, d, r, c, currentVal, undefined, nextBgColor);
      }
      return;
    }

    // 6. Ctrl/Cmd + ↑/↓ (편집 중 회차 증감)
    if (isMeta && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent?.stopImmediatePropagation?.();
      if (hasValue) {
        const currentVal = e.target.value;
        const currentVisit = getSchedulerVisitInputValue(currentVal);
        const nextVisit = stepVisitShortcutInputValue(currentVisit, e.key === 'ArrowUp' ? 1 : -1);
        const nextValue = applyVisitCountToSchedulerContent(currentVal, nextVisit);
        e.target.value = nextValue;
        setEditValue(nextValue);
        handleCellSave(w, d, r, c, nextValue);
      }
      return;
    }

    if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent?.stopImmediatePropagation?.();
      moveEditInputCaret(e.currentTarget, e.key, e.shiftKey);
      return; // 편집 중에는 좌우 방향키로 다른 셀 이동 방지 (텍스트 커서 이동만 허용)
    }
    
    if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      e.target.blur();
      const nextCell = getAdjacentCell({ w, d, r, c }, e.key);
      selectSingleCell(nextCell);
      return;
    }

    if (e.key === 'Enter') {
      if (e.nativeEvent?.isComposing) return;
      e.target.blur();
      // Enter 후 아래 셀로 이동
      const nr = Math.min(baseTimeSlots.length - 1, r + 1);
      selectSingleCell({ w, d, r: nr, c });
    }
    if (e.key === 'Escape') {
      setEditingCell(null);
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      e.target.blur();
      const nc = e.shiftKey ? Math.max(0, c - 1) : Math.min(colCount - 1, c + 1);
      selectSingleCell({ w, d, r, c: nc });
    }
  }, [baseTimeSlots.length, colCount, selectSingleCell, getAdjacentCell, moveEditInputCaret, settings, currentYear, currentMonth, handleCellSave, memos, pendingCellBgColors, cellKey, handleOpenBodyPartMenu, setEditingCell, prescriptionScheduleSettings.doseTags]);

  const handleChartSelectorClose = useCallback((selected) => {
    if (!chartSelector) return;
    chartSelector.resolve(selected || null);
    setChartSelector(null);
  }, [chartSelector]);

  useEffect(() => {
    if (!hoverCell || !tooltipRef.current) return;
    const { x, y } = tooltipMousePosRef.current;
    const rafId = window.requestAnimationFrame(() => {
      positionTooltip(x, y);
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [hoverCell, positionTooltip]);

  const { todayWeekIdx } = useScheduleTodayNavigation({
    weeks,
    today,
    weekRefs,
    scheduleScrollKey,
    currentYear,
    currentMonth,
    shortcutLabel: shortcutLabels.today,
    setTodayShortcutTooltip,
  });

  const isScheduleMonthLoading = loadedMemosKey !== scheduleScrollKey;
  const renderMemos = useMemo(
    () => {
      if (isScheduleMonthLoading) return {};
      return effectiveMemos;
    },
    [effectiveMemos, isScheduleMonthLoading]
  );
  const renderPendingDisplayValues = useMemo(
    () => (isScheduleMonthLoading ? {} : pendingDisplayValues),
    [isScheduleMonthLoading, pendingDisplayValues]
  );
  const renderPendingMergeSpans = useMemo(
    () => (isScheduleMonthLoading ? {} : pendingMergeSpans),
    [isScheduleMonthLoading, pendingMergeSpans]
  );
  const renderPendingCellBgColors = useMemo(
    () => (isScheduleMonthLoading ? {} : pendingCellBgColors),
    [isScheduleMonthLoading, pendingCellBgColors]
  );
  const reservationGroupEdgeMap = useMemo(() => {
    if (isScheduleMonthLoading) return {};
    const groups = new Map();
    Object.entries(renderMemos || {}).forEach(([key, memo]) => {
      const mergeSpan = renderPendingMergeSpans[key] || memo?.merge_span;
      const group = getReservationGroupFromMergeSpan(mergeSpan);
      if (!group?.id) return;
      const [w, d, r, c] = key.split('-').map(Number);
      if (![w, d, r, c].every(Number.isFinite)) return;
      if (!groups.has(group.id)) groups.set(group.id, []);
      groups.get(group.id).push({ key, w, d, r, c });
    });
    Object.entries(renderPendingMergeSpans || {}).forEach(([key, mergeSpan]) => {
      if (renderMemos[key]) return;
      const group = getReservationGroupFromMergeSpan(mergeSpan);
      if (!group?.id) return;
      const [w, d, r, c] = key.split('-').map(Number);
      if (![w, d, r, c].every(Number.isFinite)) return;
      if (!groups.has(group.id)) groups.set(group.id, []);
      groups.get(group.id).push({ key, w, d, r, c });
    });

    const edgeMap = {};
    groups.forEach((items) => {
      if (!items.length) return;
      const minRow = Math.min(...items.map((item) => item.r));
      const maxRow = Math.max(...items.map((item) => item.r));
      const minCol = Math.min(...items.map((item) => item.c));
      const maxCol = Math.max(...items.map((item) => item.c));
      items.forEach((item) => {
        edgeMap[item.key] = {
          top: item.r === minRow,
          bottom: item.r === maxRow,
          left: item.c === minCol,
          right: item.c === maxCol,
        };
      });
    });
    return edgeMap;
  }, [isScheduleMonthLoading, renderMemos, renderPendingMergeSpans]);

  // selectedCell 변경 시 이전 셀 드래프트 자동 flush
  const prevSelectedRef = useRef(null);
  useEffect(() => {
    const prev = prevSelectedRef.current;
    const curr = selectedCell;
    if (prev && curr && (prev.w !== curr.w || prev.d !== curr.d || prev.r !== curr.r || prev.c !== curr.c)) {
      const draft = editDraftRef.current;
      if (draft?.dirty && draft?.value?.trim()) {
        const [w, d, r, c] = draft.key.split('-').map(Number);
        if ([w, d, r, c].every(Number.isFinite)) {
          editDraftRef.current = null;
          handleCellSaveRef.current?.(w, d, r, c, draft.value);
        }
      }
    }
    prevSelectedRef.current = curr ? { ...curr } : null;
  }, [selectedCell]);

  return (
    <>
      <div 
        className={`shockwave-view animate-fade-in${isScheduleMonthLoading ? ' is-month-loading' : ''}`}
        ref={viewRef} 
        tabIndex={0} 
        style={{
          outline: 'none',
          '--sw-row-height': `${rowHeight}px`,
          '--sw-cell-font-size': `${effectiveSchedulerTextSettings.font_size}px`,
          '--sw-cell-font-weight': effectiveSchedulerTextSettings.font_weight,
          '--sw-time-font-size': `${effectiveSchedulerTextSettings.time_font_size}px`,
          '--sw-header-font-size': `${effectiveSchedulerTextSettings.header_font_size}px`,
          '--sw-header-font-weight': effectiveSchedulerTextSettings.header_font_weight,
          '--sw-header-row-height': `${effectiveSchedulerTextSettings.header_height}px`,
          '--sw-therapist-font-size': `${effectiveSchedulerTextSettings.therapist_font_size}px`,
          '--sw-therapist-font-weight': effectiveSchedulerTextSettings.therapist_font_weight,
          '--sw-therapist-row-height': `${effectiveSchedulerTextSettings.therapist_height}px`,
          '--sw-therapist-cols': therapistColsCSS,
          '--sw-day-col-width': dayColWidth ? `${dayColWidth}px` : 'none',
        }}
        onMouseLeave={() => setHoverCell(null)}
        onMouseMove={(e) => {
          tooltipMousePosRef.current = { x: e.clientX, y: e.clientY };
          if (tooltipRef.current) positionTooltip(e.clientX, e.clientY);
        }}
      >
      {isScheduleMonthLoading && (
        <div className="shockwave-month-loading" role="status" aria-live="polite">
          <div className="shockwave-month-loading-card">
            <span className="shockwave-month-loading-spinner" />
            <span>{currentYear}년 {String(currentMonth).padStart(2, '0')}월 스케줄 불러오는 중</span>
          </div>
        </div>
      )}
      {useMemo(() => weeks.map((weekDays, weekIdx) => {
        const daysContainerWidth = dayColWidth
          ? dayColWidth * weekDays.length + TIME_COL_WIDTH + 4
          : null;
        return (
        <div
          key={weekIdx}
          className={`shockwave-week${weekIdx === todayWeekIdx ? ' is-today-week' : ''}`}
          style={daysContainerWidth
            ? { width: `${daysContainerWidth}px`, minWidth: 0 }
            : { width: '100%', minWidth: '1000px' }
          }
          ref={(el) => {
            weekRefs.current[weekIdx] = el;
          }}
        >
          {weekIdx === 0 && (
            <>
              {canManageSchedulerSettings && (
                <div className="shockwave-week-floating-actions shockwave-week-floating-actions--right" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    className="shockwave-week-today-btn"
                    onClick={() => setShowTherapistConfig(true)}
                    title="설정"
                    aria-label="설정"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.43l-1.003.828c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.43l1.004-.827c.292-.24.437-.613.43-.991a6.936 6.936 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.645-.869L9.594 3.94Z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                      />
                    </svg>
                  </button>
                </div>
              )}
            </>
          )}
          <div className="shockwave-days" style={{ position: 'relative', width: '100%' }}>
            {weekDays.map((dayInfo, dayIdx) => {
              const isToday = isSameDate(dayInfo.date, today);
              const daySlots = getTimeSlotsForDay(dayInfo);
              // 첫 번째 요일에만 시간 열 표사
              const showTimeCol = dayIdx === 0;
              const gridCols = showTimeCol
                ? `${TIME_COL_WIDTH}px ${therapistColsCSS}`
                : therapistColsCSS;

              let headerClass = 'sw-day-header-cell';
              if (dayInfo.isHoliday) headerClass += ' holiday';
              else if (!dayInfo.isCurrentMonth) headerClass += ' other-month';
              else if (isToday) headerClass += ' today';
              else if (dayInfo.dow === 6) headerClass += ' saturday';

              const targetColWidth = showTimeCol && dayColWidth ? dayColWidth + TIME_COL_WIDTH : dayColWidth;
              const flexBasis = showTimeCol ? TIME_COL_WIDTH : 0;
              const dayFlexStyle = targetColWidth
                ? { flex: `0 0 ${targetColWidth}px`, width: `${targetColWidth}px`, minWidth: 0 }
                : { flex: `1 1 ${flexBasis}px`, minWidth: 0 };

              return (
                <div key={dayIdx} className={`shockwave-day${isToday ? ' is-today' : ''}${showTimeCol ? ' has-time-col' : ''}`} style={dayFlexStyle}>
                  {/* 날짜 헤더 */}
                  <div className="sw-day-header-row" style={{ gridTemplateColumns: gridCols }}>
                    {showTimeCol && (
                      <div className="sw-week-header-cell">{weekIdx + 1}주차</div>
                    )}
                    <div className={`${headerClass}${showTimeCol ? ' with-week-col' : ''}`}>
                      {dayInfo.month}월 {dayInfo.day}일 {DAY_NAMES[dayInfo.dow]}요일
                    </div>
                  </div>

                  {/* 치료사 이름 헤더 + 열 리사이즈 */}
                  <div className="sw-therapist-header-wrapper" style={{ position: 'relative' }}>
                    <div className="sw-therapist-header" style={{ gridTemplateColumns: gridCols }}>
                      {showTimeCol && (
                        <div className="sw-time-label" style={{ borderBottom: 'none' }}>시간</div>
                      )}
                      {Array.from({ length: colCount }, (_, ci) => {
                        let nameClass = 'sw-therapist-name';
                        if (dayInfo.isHoliday) nameClass += ' holiday';
                        else if (!dayInfo.isCurrentMonth) nameClass += ' other-month';
                        else if (isToday) nameClass += ' today';
                        return (
                          <div key={ci} className={nameClass} style={ci === colCount - 1 ? { borderRight: 'none' } : undefined}>
                            {getTherapistNameForDate(ci, dayInfo.day) || `치료사${ci + 1}`}
                          </div>
                        );
                      })}
                    </div>
                    {/* 열 리사이즈 핸들 오버레이 */}
                    {colCount > 1 && Array.from({ length: colCount - 1 }, (_, ci) => {
                      const ratios = activeColRatios || Array(colCount).fill(1);
                      const totalR = ratios.reduce((a, b) => a + b, 0);
                      const leftPct = ratios.slice(0, ci + 1).reduce((a, b) => a + b, 0) / totalR * 100;
                      const timeColPx = showTimeCol ? TIME_COL_WIDTH : 0;
                      return (
                        <div
                          key={`col-resize-${ci}`}
                          className="sw-col-resize-handle"
                          style={{
                            position: 'absolute', top: 0, height: '100%',
                            left: `calc(${timeColPx}px + (100% - ${timeColPx}px) * ${leftPct / 100})`,
                            transform: 'translateX(-4px)',
                          }}
                          onMouseDown={(e) => {
                            startColResize(e, ci, timeColPx, activeColRatios);
                          }}
                        />
                      );
                    })}
                  </div>

                  {/* 스케줄 바디 */}
                  <div className="sw-schedule-body" style={{ display: 'grid', gridTemplateColumns: gridCols, gridAutoRows: 'var(--sw-row-height)' }}>
                    {daySlots.flatMap((slotInfo, slotRenderIndex) => {
                      const rowIdx = slotInfo.idx;
                      const gridRowStart = slotRenderIndex + 1;
                      const isLastRenderedRow = slotRenderIndex === daySlots.length - 1;
                      const elements = [];
                      
                      // 1. Time Label
                      if (showTimeCol) {
                        const interval = Math.max(1, Number(settings?.interval_minutes) || 10);
                        const labelInterval = Math.max(interval, Number(settings?.time_label_interval_minutes) || interval);
                        const labelSpan = Math.round(labelInterval / interval);

                        if (slotInfo.showLabel) {
                          const hoverRowIdx = Number(hoverCell?.rowIdx);
                          const isHoverWithinTimeLabel = hoverCell?.weekIdx === weekIdx
                            && Number.isFinite(hoverRowIdx)
                            && hoverRowIdx >= rowIdx
                            && hoverRowIdx < rowIdx + labelSpan;
                          const hoveredSlotInfo = isHoverWithinTimeLabel
                            ? daySlots.find((slot) => slot.idx === hoverRowIdx)
                            : null;
                          const displayTimeLabel = hoveredSlotInfo?.time || hoveredSlotInfo?.fullLabel || slotInfo.label;
                          elements.push(
                            <div
                              key={`time-${rowIdx}`}
                              className={`sw-time-label${slotInfo.isLunch ? ' lunch' : ''}${slotInfo.disabled ? ' disabled' : ''}${isHoverWithinTimeLabel ? ' active-row' : ''}`}
                              data-time-row={`${weekIdx}-${rowIdx}`}
                              data-time-week={weekIdx}
                              data-time-row-start={rowIdx}
                              data-time-row-end={rowIdx + labelSpan - 1}
                              style={{
                                gridColumn: '1',
                                gridRow: `${gridRowStart} / span ${labelSpan}`,
                                borderBottom: (isLastRenderedRow || (slotRenderIndex + labelSpan >= daySlots.length)) ? 'none' : `1px solid ${HORIZONTAL_BORDER_COLOR}`,
                              }}
                              onMouseEnter={(e) => handleTimeLabelMouseMove(e, weekIdx, dayIdx, slotRenderIndex, labelSpan, daySlots)}
                              onMouseMove={(e) => handleTimeLabelMouseMove(e, weekIdx, dayIdx, slotRenderIndex, labelSpan, daySlots)}
                              onMouseLeave={handleTimeLabelMouseLeave}
                            >
                              {displayTimeLabel}
                            </div>
                          );
                        }
                      }

                      // 2. Cells
                      for (let colIdx = 0; colIdx < colCount; colIdx++) {
                        const key = cellKey(weekIdx, dayIdx, rowIdx, colIdx);
                        const rawCellData = renderMemos[key] || null;
                        const hasPendingBg = Object.prototype.hasOwnProperty.call(renderPendingCellBgColors, key);
                        const pendingAdjustedCellData = hasPendingBg
                          ? {
                              ...(rawCellData || {}),
                              bg_color: renderPendingCellBgColors[key],
                            }
                          : rawCellData;
                        const rawContent = normalizeSchedulerVisitSuffix(renderPendingDisplayValues[key] ?? rawCellData?.content ?? '');
                        const defaultEditingMergeSpan = getDefaultEditingMergeSpanForKey(key);
                        const rawMergeSpan = defaultEditingMergeSpan || getEffectiveMergeSpan(key, renderMemos);
                        const sanitizedBlankCell = sanitizeBlankScheduleCellData({
                          key,
                          memos: renderMemos,
                          cellData: pendingAdjustedCellData,
                          pendingDisplayValues: renderPendingDisplayValues,
                          pendingMergeSpans: renderPendingMergeSpans,
                        });
                        const displayCellData = sanitizedBlankCell.cellData;
                        const content = sanitizedBlankCell.wasSanitized ? '' : rawContent;
                        let mergeSpan = rawMergeSpan;
                        if (sanitizedBlankCell.mergeSpan && !rawMergeSpan.mergedInto) {
                          mergeSpan = sanitizedBlankCell.mergeSpan;
                        }

                          if (mergeSpan.mergedInto) {
                            continue; // 병합된 하위 셀은 묶어서 렌더링 생략
                          }

                          // View Span Calculation
                          let visualRowSpan = 1;
                          if (mergeSpan.rowSpan > 1) {
                            const endRowIdx = rowIdx + mergeSpan.rowSpan - 1;
                            visualRowSpan = daySlots.filter(s => s.idx >= rowIdx && s.idx <= endRowIdx).length;
                          }
                          const finalMergeSpan = { ...mergeSpan, rowSpan: visualRowSpan };

                          const dateKey = `${dayInfo.year}-${dayInfo.month}-${dayInfo.day}`;
                          const therapistName = getTherapistNameForDate(colIdx, dayInfo.day) || '';
                          let workState = getTherapistWorkState(dateKey, therapistName);
                          if (workState === 'early-leave' && isLastHourSlot(dayInfo, slotInfo.time)) {
                            workState = 'off';
                          }
                          const staffBlockRule = getStaffScheduleBlockForCell(dateKey, therapistName, slotInfo.time);

                          elements.push(
                            <MemoizedCell
                              key={key}
                              cellKey={key}
                              weekIdx={weekIdx} dayIdx={dayIdx} rowIdx={rowIdx} colIdx={colIdx}
                              dayInfo={dayInfo} slotInfo={slotInfo} showTimeCol={showTimeCol}
                              gridRowStart={gridRowStart} isLastRenderedRow={isLastRenderedRow} colCount={colCount}
                              cellData={displayCellData} pendingContent={content} pendingMergeSpan={renderPendingMergeSpans[key]} mergeSpan={finalMergeSpan}
                              editingCell={editingCell} imePreviewCell={imePreviewCell}
                              selectedKeys={selectedKeys} selectedCell={selectedCell} clipboardSource={clipboardSource}
                              workState={workState} staffBlockRule={staffBlockRule}
                              effectivePrescriptionColors={effectivePrescriptionColors}
                              reservationGroupEdge={reservationGroupEdgeMap[key]}
                              visitLineBreakPrescriptions={prescriptionScheduleSettings.visitLineBreakPrescriptions}
                              editValue={editValue} setEditValue={setEditValue}
                              handleCellMouseDown={handleCellMouseDown} handleCellMouseEnter={handleCellMouseEnter}
                              setHoverCell={setHoverCell} handleCellDoubleClick={handleCellDoubleClick}
                              handleCellContextMenu={handleCellContextMenu} editInputRef={editInputRef}
                              handleCellSave={handleCellSave} handleEditKeyDown={handleEditKeyDown}
                              imeOpenRef={imeOpenRef} setImePreviewCell={setImePreviewCell}
                              editDraftRef={editDraftRef} scheduleEditDraftAutosave={scheduleEditDraftAutosave}
                              promoteFocusedInputToEditor={promoteFocusedInputToEditor}
                              skipNextEditBlurSaveRef={skipNextEditBlurSaveRef}
                            />
                          );
                        }
                      return elements;
                    })}
                  </div>

                  {(
                    <div
                      className="sw-day-resize-handle"
                      onMouseDown={(e) => {
                        startDayResize(e, showTimeCol);
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div
            className="shockwave-week-row-resize-handle"
            title={`행 높이 조절 (${rowHeight}px)`}
            aria-label={`${weekIdx + 1}주차 시간 행 높이 조절`}
            onMouseDown={startRowResize}
            onTouchStart={startRowResize}
          />
        </div>
        );
      }), [
        weeks, dayColWidth, todayWeekIdx, today, getTimeSlotsForDay,
        therapistColsCSS, colCount, getTherapistNameForDate, activeColRatios,
        startColResize, startDayResize, startRowResize,
        renderMemos, renderPendingDisplayValues, renderPendingMergeSpans, renderPendingCellBgColors, reservationGroupEdgeMap, editingCell, imePreviewCell,
        selectedKeys, selectedCell, clipboardSource,
        getTherapistWorkState, getStaffScheduleBlockForCell,
        isLastHourSlot, effectivePrescriptionColors, editValue,
        handleCellMouseDown, handleCellMouseEnter, setHoverCell,
        handleCellDoubleClick, handleCellContextMenu,
        handleEditKeyDown, scheduleEditDraftAutosave, promoteFocusedInputToEditor, handleCellSave,
        cellKey, getEffectiveMergeSpan, rowHeight, canManageSchedulerSettings,
        prescriptionScheduleSettings.visitLineBreakPrescriptions
      ])}
      </div>
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className={`shockwave-context-menu schedule-context-menu ${contextMenu.isNearRightEdge ? 'submenu-pop-left' : ''} ${contextMenu.isStandaloneBodyPart ? 'standalone-mode' : ''}`}
          style={{
            top: contextMenu.y,
            left: contextMenu.x,
            '--context-submenu-offset-y': `${contextSubmenuOffsetY}px`,
          }}
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const contextKey = contextMenu
              ? `${contextMenu.weekIdx}-${contextMenu.dayIdx}-${contextMenu.rowIdx}-${contextMenu.colIdx}`
              : null;
            const firstKey = contextKey || (selectedKeys ? Array.from(selectedKeys)[0] : null);
            const baseMemo = firstKey ? (renderMemos[firstKey] || {}) : {};
            const currentMemo = (firstKey && contextMenu?.memoSnapshot) 
              ? { ...baseMemo, ...contextMenu.memoSnapshot } 
              : baseMemo;
            const currentPrescription = currentMemo?.prescription || '';
            const effectiveManualSettings = getEffectiveSettlementSettings(settings, currentYear, currentMonth, 'manual_therapy');
            const effectiveShockwaveSettings = getEffectiveSettlementSettings(settings, currentYear, currentMonth, 'shockwave');
            const hiddenPrescriptions = prescriptionScheduleSettings?.hiddenPrescriptions || [];
            const shockwavePrescriptions = Array.isArray(effectiveShockwaveSettings?.prescriptions)
              ? effectiveShockwaveSettings.prescriptions.filter((pres) => pres && !hiddenPrescriptions.includes(pres))
              : [];
            const manualTherapyPrescriptions = Array.isArray(effectiveManualSettings?.prescriptions)
              ? effectiveManualSettings.prescriptions.filter((pres) => pres && !shockwavePrescriptions.includes(pres) && !hiddenPrescriptions.includes(pres))
              : [];
            const allDoseTags = {
              ...(effectiveShockwaveSettings?.dose_tags || {}),
              ...(effectiveManualSettings?.dose_tags || {}),
            };
            const manualDoseTags = {
              ...(settings?.manual_therapy_dose_tags || {}),
              ...(effectiveManualSettings?.dose_tags || {}),
            };
            const currentPrescriptionClass = shockwavePrescriptions.includes(currentPrescription)
              ? ' is-shockwave'
              : manualTherapyPrescriptions.includes(currentPrescription)
                ? ' is-manual'
                : '';
            const currentPrescriptionColor = effectivePrescriptionColors?.[currentPrescription]
              || DEFAULT_CONTEXT_PRESCRIPTION_COLORS[currentPrescription]
              || '#0f172a';
            const currentBodyPart = currentMemo?.body_part || '';
            const currentParts = splitBodyParts(currentBodyPart);
            const { patientChart, patientName } = parseSchedulerPatientIdentity(currentMemo?.content || '');
            const bodyPartPatientKey = patientChart
              ? `chart:${String(patientChart).trim()}`
              : `name:${normalizeNameForMatch(patientName)}`;
            const hiddenBodyPartKeys = new Set([
              ...(hiddenBodyPartOptionsByPatient[bodyPartPatientKey] || []),
              ...contextMenuHiddenBodyPartKeys,
            ]);
            const currentBodyPartKeys = new Set(currentParts.map((part) => normalizeBodyPartKey(part)));
            const currentKeyParts = firstKey ? firstKey.split('-').map(Number) : null;
            const currentSortKey = currentKeyParts
              ? buildSchedulerMemoSortKey(firstKey, weeks)
              : '';
            let previousPrescription = null;

            const patientBodyPartsMap = new Map();
            Object.entries(renderMemos || {}).forEach(([memoKey, m]) => {
              const effectiveMemo = (selectedKeys && selectedKeys.has(memoKey)) ? currentMemo : m;
              if (!effectiveMemo?.content) return;
              const { patientChart: mChart, patientName: mName } = parseSchedulerPatientIdentity(effectiveMemo.content);
              const isMatch = patientChart
                ? Boolean(mChart && String(patientChart).trim() === String(mChart).trim())
                : Boolean(patientName && mName && patientName === mName);
              if (isMatch) {
                if (effectiveMemo.body_part) {
                  splitBodyParts(effectiveMemo.body_part).forEach((part) => addBodyPartToMap(patientBodyPartsMap, part));
                }
                if (!effectiveMemo.prescription || memoKey === firstKey) return;
                const memoSortKey = buildSchedulerMemoSortKey(memoKey, weeks);
                if (memoSortKey < currentSortKey && (!previousPrescription || memoSortKey > previousPrescription.sortKey)) {
                  previousPrescription = { value: effectiveMemo.prescription, sortKey: memoSortKey };
                }
              }
            });
            currentParts.forEach((part) => addBodyPartToMap(patientBodyPartsMap, part));
            const availablePartsMap = new Map();
            contextMenuBodyPartOptions.forEach((part) => addBodyPartToMap(availablePartsMap, part));
            Array.from(patientBodyPartsMap.values()).forEach((part) => addBodyPartToMap(availablePartsMap, part));
            const availableParts = Array.from(availablePartsMap.values())
              .filter((part) => {
                const partKey = normalizeBodyPartKey(part);
                return currentBodyPartKeys.has(partKey) || !hiddenBodyPartKeys.has(partKey);
              })
              .sort((a, b) => a.localeCompare(b, 'ko'));
            const previousPrescriptionValue = previousPrescription?.value || '';
            const selectedHasSameReservationGroup = selectionHasReservationGroup({
              keys: selectedKeys,
              memos: renderMemos,
              pendingMergeSpans: renderPendingMergeSpans,
            });
            const sameReservationLabel = selectedHasSameReservationGroup ? '동시간 예약 취소' : '동시간 예약';

            return (
              <>
                <button
                  type="button"
                  className="context-menu-item"
                  data-shortcut-tooltip={`복사 ${shortcutLabels.copy}`}
                  onClick={() => handleContextAction('copy')}
                >
                  <span className="context-menu-label">복사</span>
                  <span className="context-menu-shortcut">{shortcutLabels.copy}</span>
                </button>
                <button
                  type="button"
                  className="context-menu-item"
                  data-shortcut-tooltip={`잘라내기 ${shortcutLabels.cut}`}
                  onClick={() => handleContextAction('cut')}
                >
                  <span className="context-menu-label">잘라내기</span>
                  <span className="context-menu-shortcut">{shortcutLabels.cut}</span>
                </button>
                <button
                  type="button"
                  className="context-menu-item"
                  data-shortcut-tooltip={`붙여넣기 ${shortcutLabels.paste}`}
                  onClick={() => handleContextAction('paste')}
                >
                  <span className="context-menu-label">붙여넣기</span>
                  <span className="context-menu-shortcut">{shortcutLabels.paste}</span>
                </button>
                <div className="context-menu-divider" />
                {!selectionInfo?.isMergedMaster ? (
                  <button
                    type="button"
                    className="context-menu-item"
                    data-shortcut-tooltip={`셀 병합 ${shortcutLabels.merge}`}
                    onClick={() => handleContextAction('merge')}
                    disabled={!selectionInfo?.selectionMultiple}
                  >
                    <span className="context-menu-label">셀 병합</span>
                    <span className="context-menu-shortcut">{shortcutLabels.merge}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="context-menu-item"
                    data-shortcut-tooltip={`병합 해제 ${shortcutLabels.merge}`}
                    onClick={() => handleContextAction('unmerge')}
                  >
                    <span className="context-menu-label">병합 해제</span>
                    <span className="context-menu-shortcut">{shortcutLabels.merge}</span>
                  </button>
                )}
                <div className="context-menu-divider" />
                <button
                  type="button"
                  className="context-menu-item"
                  data-shortcut-tooltip={`${sameReservationLabel} Ctrl+Q`}
                  onClick={() => handleContextAction('same-reservation-group-toggle')}
                  disabled={!selectedHasSameReservationGroup && (!selectedKeys || selectedKeys.size < 2)}
                >
                  <span className="context-menu-label">{sameReservationLabel}</span>
                  <span className="context-menu-shortcut">Ctrl+Q</span>
                </button>
                <div className="context-menu-divider" />
                <button
                  type="button"
                  className="context-menu-item context-menu-item-complete"
                  data-shortcut-tooltip={`${treatmentCompleteButtonLabel} ${shortcutLabels.complete}`}
                  onClick={() => handleContextAction('complete-toggle')}
                  disabled={!hasCompletableSelection}
                >
                  <span className="context-menu-label">{treatmentCompleteButtonLabel}</span>
                  <span className="context-menu-shortcut">{shortcutLabels.complete}</span>
                </button>
                <button
                  type="button"
                  className="context-menu-item context-menu-item-clear-complete"
                  data-shortcut-tooltip={`예약 취소 ${shortcutLabels.cancel}`}
                  onClick={() => handleContextAction('cancel-toggle')}
                  disabled={!hasCompletableSelection}
                >
                  <span className="context-menu-label">예약 취소</span>
                  <span className="context-menu-shortcut">{shortcutLabels.cancel}</span>
                </button>
                <div className="context-menu-item context-menu-history-search-item" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => {
                  e.stopPropagation();
                  setContextMenu(null);
                  handleOpenPatientHistoryModal();
                }}>
                  <div className="context-menu-label" style={{ fontWeight: 600, color: 'var(--brand-primary)' }}>
                    🔍 환자 내역 검색 ({shortcutLabels.patientHistory})
                  </div>
                </div>
                <div className="context-menu-divider" />

                <div className="context-menu-meta-section">
                  <div className="context-menu-item context-menu-item-inline-edit context-menu-meta-item context-menu-time-item" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} style={{ cursor: 'default' }}>
                    <label className="context-menu-time-editor" style={{ width: '100%', margin: 0, padding: 0 }}>
                      <span className="context-menu-time-label">예약시간 :</span>
                      <span className="context-menu-time-control">
                        <button
                          type="button"
                          className="context-menu-time-reset"
                          aria-label="예약시간 기본값으로 되돌리기"
                          title="기본 시간으로"
                          disabled={!contextMenu?.savedReservationTime}
                          onMouseDown={e => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleContextAction({ type: 'reservationTimeReset' });
                          }}
                        >
                          ↺
                        </button>
                        <input
                          type="text"
                          placeholder={contextMenu?.defaultReservationTime || ''}
                          className="context-menu-time-input"
                          value={contextMenuReservationInput}
                          readOnly
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                              e.preventDefault();
                              stepContextMenuReservationInput(e.key === 'ArrowUp' ? 10 : -10);
                            }
                          }}
                          onMouseDown={e => e.stopPropagation()}
                          onClick={e => e.stopPropagation()}
                        />
                        <span className="context-menu-time-stepper">
                          <button
                            type="button"
                            className="context-menu-time-step context-menu-step-left"
                            aria-label="현재 셀 기준 예약시간 10분 감소"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              stepContextMenuReservationInput(-10);
                            }}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                          >
                            <span className="context-menu-step-symbol context-menu-step-symbol--minus" />
                          </button>
                          <span className="context-menu-display-value context-menu-time-display">
                            {contextMenuReservationInput || contextMenu?.defaultReservationTime || ''}
                          </span>
                          <button
                            type="button"
                            className="context-menu-time-step context-menu-step-right"
                            aria-label="현재 셀 기준 예약시간 10분 증가"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              stepContextMenuReservationInput(10);
                            }}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                          >
                            <span className="context-menu-step-symbol context-menu-step-symbol--plus" />
                          </button>
                        </span>
                      </span>
                    </label>
                  </div>

                  <div
                    className={`context-menu-item has-submenu context-menu-meta-item context-menu-prescription-item${activeContextSubmenu === 'prescription' ? ' is-submenu-open' : ''}`}
                    onMouseEnter={() => setActiveContextSubmenu('prescription')}
                    onFocusCapture={() => setActiveContextSubmenu('prescription')}
                  >
                    <span className="context-menu-meta-value-row">
                      <span className="context-menu-meta-label">처방 :</span>
                      <span
                        className={`context-menu-prescription-value${currentPrescriptionClass}`}
                        style={{ '--context-prescription-color': currentPrescriptionColor }}
                      >
                        {currentPrescription || '없음'}
                      </span>
                    </span>
                    <div className="context-menu-submenu context-menu-submenu--prescription">
                      <div className="context-menu-editor-panel">
                        <div className="context-menu-inline-column">
                          <div className="context-menu-prescription-row context-menu-prescription-row--dual">
                            <div className="context-menu-prescription-select-group">
                              <label className="context-menu-prescription-select-label">
                                충격파
                                {previousPrescriptionValue && shockwavePrescriptions.includes(previousPrescriptionValue) ? (
                                  <span className="context-menu-current-prescription" style={{ marginLeft: '6px' }}>{previousPrescriptionValue}</span>
                                ) : null}
                              </label>
                              <select
                                className="context-menu-select"
                                value={shockwavePrescriptions.includes(currentPrescription) ? currentPrescription : ''}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  const prescription = e.target.value || null;
                                  const hasDoseTag = prescription && Object.prototype.hasOwnProperty.call(allDoseTags, prescription);
                                  const autoDoseTag = prescription?.match(/(\d{2,3})/)?.[1] || '';
                                  handleContextAction({
                                    type: 'prescription',
                                    value: prescription,
                                    doseTag: hasDoseTag ? allDoseTags[prescription] : autoDoseTag,
                                  });
                                }}
                                onMouseDown={e => e.stopPropagation()}
                                onClick={e => e.stopPropagation()}
                              >
                                <option value="">처방 없음</option>
                                {shockwavePrescriptions.map((pres) => (
                                  <option key={pres} value={pres}>{pres}</option>
                                ))}
                              </select>
                            </div>
                            <div className="context-menu-prescription-select-group">
                              <label className="context-menu-prescription-select-label">
                                도수치료
                                {previousPrescriptionValue && manualTherapyPrescriptions.includes(previousPrescriptionValue) ? (
                                  <span className="context-menu-current-prescription" style={{ marginLeft: '6px' }}>{previousPrescriptionValue}</span>
                                ) : null}
                              </label>
                              <select
                                className="context-menu-select"
                                value={manualTherapyPrescriptions.includes(currentPrescription) ? currentPrescription : ''}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  const prescription = e.target.value || null;
                                  const hasDoseTag = prescription && Object.prototype.hasOwnProperty.call(manualDoseTags, prescription);
                                  const autoDoseTag = prescription?.match(/(\d{2,3})/)?.[1] || '';
                                  handleContextAction({
                                    type: 'prescription',
                                    value: prescription,
                                    doseTag: hasDoseTag ? manualDoseTags[prescription] : autoDoseTag,
                                  });
                                }}
                                onMouseDown={e => e.stopPropagation()}
                                onClick={e => e.stopPropagation()}
                              >
                                <option value="">처방 없음</option>
                                {manualTherapyPrescriptions.map((pres) => (
                                  <option key={pres} value={pres}>{pres}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    className={`context-menu-item has-submenu context-menu-meta-item context-menu-body-item${activeContextSubmenu === 'body' ? ' is-submenu-open' : ''}`}
                    onMouseEnter={() => setActiveContextSubmenu('body')}
                    onFocusCapture={() => setActiveContextSubmenu('body')}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      부위 : {currentParts.join(', ') || '없음'}
                    </span>
                    <div className="context-menu-submenu context-menu-submenu--body">
                      <div className="context-menu-editor-panel">
                        <div className="context-menu-inline-column">
                          <div className="context-menu-body-dropdown">
                            <BodyPartKeyboardPanel
                              availableParts={availableParts}
                              currentParts={currentParts}
                              autoFocus={true}
                              imeOpenRef={imeOpenRef}
                              onAdd={(value) => {
                                const partKey = normalizeBodyPartKey(value);
                                setContextMenuHiddenBodyPartKeys((prev) => {
                                  const next = new Set(prev);
                                  next.delete(partKey);
                                  return next;
                                });
                                setHiddenBodyPartOptionsByPatient((prev) => {
                                  const nextKeys = (prev[bodyPartPatientKey] || []).filter((key) => key !== partKey);
                                  if (nextKeys.length === (prev[bodyPartPatientKey] || []).length) return prev;
                                  const next = { ...prev };
                                  if (nextKeys.length > 0) {
                                    next[bodyPartPatientKey] = nextKeys;
                                  } else {
                                    delete next[bodyPartPatientKey];
                                  }
                                  saveHiddenBodyPartOptionsByPatient(next);
                                  return next;
                                });
                                handleContextAction({ type: 'bodyPartAdd', value });
                              }}
                              onToggle={(value) => handleContextAction({ type: 'bodyPartToggle', value })}
                              onDelete={(value) => {
                                const partKey = normalizeBodyPartKey(value);
                                setContextMenuHiddenBodyPartKeys((prev) => {
                                  const next = new Set(prev);
                                  next.add(partKey);
                                  return next;
                                });
                                setHiddenBodyPartOptionsByPatient((prev) => {
                                  const current = prev[bodyPartPatientKey] || [];
                                  if (current.includes(partKey)) return prev;
                                  const next = { ...prev, [bodyPartPatientKey]: [...current, partKey] };
                                  saveHiddenBodyPartOptionsByPatient(next);
                                  return next;
                                });
                                setContextMenuBodyPartOptions((prev) => (
                                  prev.filter((item) => normalizeBodyPartKey(item) !== partKey)
                                ));
                                handleContextAction({ type: 'bodyPartDeleteValue', value });
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                </div>

                <div className="context-menu-item context-menu-item-inline-edit context-menu-meta-item context-menu-visit-item" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} style={{ cursor: 'default' }}>
                  <label className="context-menu-visit-editor" style={{ width: '100%', margin: 0, padding: 0 }}>
                    <span style={{ flexShrink: 0, width: '40px' }}>회차 :</span>
                    <span className="context-menu-visit-control" style={{ flexGrow: 1 }}>
                      <span className="context-menu-visit-stepper">
                        <button
                          type="button"
                          className="context-menu-visit-step context-menu-step-left"
                          aria-label="회차 감소"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            stepContextMenuVisitInput(-1);
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                        >
                          <span className="context-menu-step-symbol context-menu-step-symbol--minus" />
                        </button>
                        <ContextMenuLocalInput
                          inputMode="numeric"
                          pattern="[0-9*-]*"
                          className={`context-menu-visit-input context-menu-display-value context-menu-visit-display context-menu-visit-display--len-${Math.min(String(contextMenuVisitInput || '').length || 1, 3)}`}
                          value={contextMenuVisitInput}
                          onChange={(val) => {
                            const nextValue = val.replace(/[^\d*-]/g, '');
                            setContextMenuVisitInput(nextValue);
                          }}
                          onBlur={(e, val) => {
                            e.stopPropagation();
                            const normalized = normalizeVisitInputValue(val);
                            setContextMenuVisitInput(normalized);
                            handleContextAction({ type: 'visitCount', value: normalized });
                          }}
                          onKeyDown={(e, val) => {
                            e.stopPropagation();
                            if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const normalized = normalizeVisitInputValue(val);
                              setContextMenuVisitInput(normalized);
                              handleContextAction({ type: 'visitCount', value: normalized });
                            }
                            if (e.key === 'ArrowUp') {
                              e.preventDefault();
                              stepContextMenuVisitInput(1);
                            }
                            if (e.key === 'ArrowDown') {
                              e.preventDefault();
                              stepContextMenuVisitInput(-1);
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="context-menu-visit-step context-menu-step-right"
                          aria-label="회차 증가"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            stepContextMenuVisitInput(1);
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                        >
                          <span className="context-menu-step-symbol context-menu-step-symbol--plus" />
                        </button>
                      </span>
                    </span>
                  </label>
                </div>

                <div
                  className={`context-menu-item has-submenu context-menu-meta-item context-menu-memo-item${activeContextSubmenu === 'memo' ? ' is-submenu-open' : ''}`}
                  onMouseEnter={() => setActiveContextSubmenu('memo')}
                  onFocusCapture={() => setActiveContextSubmenu('memo')}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    메모 : {contextMenuMemoDrafts.length > 0 ? contextMenuMemoDrafts.join(', ') : '없음'}
                  </span>
                  <div className="context-menu-submenu context-menu-submenu--memo">
                    <div className="context-menu-editor-panel">
                      <div className="context-menu-inline-column">
                        <div className="context-menu-inline-label">
                          <span>
                            메모 목록
                            <span className="context-menu-note-status">
                              ({contextMenuMemoDrafts.length > 0 ? `${contextMenuMemoDrafts.length}개` : '없음'})
                            </span>
                          </span>
                        </div>
                        <div className="context-menu-inline-memo-box">
                          {contextMenuMemoDrafts.length > 0 ? (
                            <div className="context-menu-note-list">
                              {contextMenuMemoDrafts.map((item, index) => (
                                <div key={`${index}-${item}`} className="context-menu-note-item">
                                  <input
                                    type="text"
                                    className="context-menu-input context-menu-input--memo"
                                    value={item}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      const value = e.target.value;
                                      setContextMenuMemoDrafts((prev) => prev.map((memo, memoIndex) => memoIndex === index ? value : memo));
                                    }}
                                    onBlur={(e) => {
                                      e.stopPropagation();
                                      handleContextAction({ type: 'memoUpdate', index, value: e.target.value });
                                    }}
                                    onMouseDown={e => e.stopPropagation()}
                                    onClick={e => e.stopPropagation()}
                                  />
                                  <button
                                    type="button"
                                    className="context-menu-note-remove"
                                    onMouseDown={e => e.stopPropagation()}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleContextAction({ type: 'memoRemove', index });
                                    }}
                                  >
                                    삭제
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          <ContextMenuLocalInputGroup
                            placeholder="새 메모 추가"
                            buttonLabel="추가"
                            onSubmit={(val) => {
                              handleContextAction({ type: 'memoAdd', value: val });
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      <SchedulerPatientSelector
        selector={chartSelector}
        onSelect={handleChartSelectorClose}
        onCancel={() => handleChartSelectorClose(null)}
      />

      {patientHistoryModalOpen && (
        <div ref={patientHistoryModalOverlayRef} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999999, overscrollBehavior: 'none' }}>
          <div style={{ background: 'var(--bg-primary, #fff)', maxWidth: patientHistoryModalLayout.maxWidth, width: patientHistoryModalLayout.width, borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--border-color, #eee)', background: 'var(--bg-secondary, #f8f9fa)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>환자 스케줄 내역 검색</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-primary, #fff)', border: '1px solid var(--border-color, #ddd)', borderRadius: '6px', padding: '2px 8px' }}>
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary, #666)' }}>검색:</span>
                  <input 
                    ref={patientHistorySearchInputRef}
                    type="text" 
                    placeholder="이름/차트번호" 
                    defaultValue={patientHistoryModalData.searchChart || patientHistoryModalData.searchName}
                    style={{ border: 'none', outline: 'none', background: 'transparent', width: '120px', fontSize: '0.9rem', padding: '4px 0' }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const val = e.target.value.trim();
                        if (val) {
                          const parsed = parseSchedulerPatientIdentity(val);
                          const sName = normalizeNameForMatch(parsed.patientName);
                          const sChart = parsed.patientChart ? String(parsed.patientChart).trim() : null;
                          fetchPatientHistory(sName, sChart);
                        }
                      }
                    }}
                  />
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary, #999)' }}>↵ Enter</span>
                </div>
              </div>
              <button onClick={closePatientHistoryModal} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', padding: '0 4px', color: 'var(--text-secondary, #666)' }}>✕</button>
            </div>
            <div ref={patientHistoryModalBodyRef} style={{ padding: '14px 18px', maxHeight: '70vh', overflowY: 'auto', overscrollBehavior: 'contain' }}>
              <div style={{ marginBottom: 14, fontSize: '1.05rem', fontWeight: 600 }}>
                검색 대상: <span style={{ color: 'var(--brand-primary)' }}>{patientHistoryModalData.searchName}</span> {patientHistoryModalData.searchChart ? `(${patientHistoryModalData.searchChart})` : ''}
              </div>
              
              {patientHistoryModalData.loading ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)' }}>내역을 불러오는 중...</div>
              ) : patientHistoryModalData.logs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)' }}>해당하는 내역이 없습니다.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: patientHistoryModalLayout.gridTemplateColumns, gap: '12px', alignItems: 'start' }}>
                  {patientHistoryLogGroups.map((group) => (
                    <div
                      key={group.key}
                      style={{
                        border: '1px solid var(--border-color, #d7dde5)',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        background: 'var(--bg-primary, #fff)',
                        '--patient-history-group-header-bg': group.key === 'manual' ? '#fed7aa' : '#bae6fd',
                        '--patient-history-column-header-bg': group.key === 'manual' ? '#fff3e6' : '#e0f2fe',
                      }}
                    >
                      <div
                        style={{
                          background: 'var(--patient-history-group-header-bg)',
                          color: 'var(--text-primary, #1f2937)',
                          fontWeight: 800,
                          padding: '8px 12px',
                          borderBottom: '1px solid var(--border-color, #d7dde5)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '10px',
                        }}
                      >
                        <span>
                          {group.label} <span style={{ color: 'var(--text-secondary, #6b7280)', fontWeight: 700 }}>{group.logs.length}건</span>
                        </span>
                        {group.bodyFilterOptions.length > 1 && (
                          <select
                            aria-label={`${group.label} 부위 필터`}
                            value={group.activeBodyFilter}
                            onChange={(event) => {
                              const value = event.target.value;
                              setPatientHistoryBodyFilters((prev) => ({
                                ...prev,
                                [group.key]: value,
                              }));
                            }}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                            style={{
                              maxWidth: '190px',
                              minWidth: '118px',
                              border: '1px solid rgba(148, 163, 184, 0.45)',
                              borderRadius: '7px',
                              background: '#fff',
                              color: 'var(--text-primary, #1f2937)',
                              fontSize: '0.8rem',
                              fontWeight: 800,
                              padding: '3px 7px',
                              outline: 'none',
                            }}
                          >
                            {group.bodyFilterOptions.map((option) => (
                              <option key={option.key} value={option.key}>
                                {option.label} {option.count}회
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      <div className="sw-compact-table-wrap">
                        <table className="sw-summary-table sw-compact-summary-table patient-history-table" style={{ width: '100%', margin: 0, tableLayout: 'fixed' }}>
                          <colgroup>
                            {patientHistoryColumnWidths.map((width, columnIndex) => (
                              <col key={`patient-history-col-${columnIndex}`} style={{ width }} />
                            ))}
                          </colgroup>
                          <thead>
                            <tr>
                              <th style={{ textAlign: 'center' }}>날짜</th>
                              <th style={{ textAlign: 'center' }}>처방</th>
                              <th style={{ textAlign: 'center' }}>부위</th>
                              <th style={{ textAlign: 'center' }}>메모</th>
                              <th style={{ textAlign: 'center' }}>회차</th>
                              <th style={{ textAlign: 'center' }}>담당</th>
                              <th style={{ textAlign: 'center' }}>적용</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.logs.map((log, idx) => {
                              const historyRowKey = log._history_row_key || `${group.key}-${log.id || log.date}-${idx}`;
                              const selectedHistoryCellId = selectedCell
                                ? `draft-${selectedCell.w}-${selectedCell.d}-${selectedCell.r}-${selectedCell.c}`
                                : '';
                              const isCurrentHistoryRow = Boolean(log.isCurrentCell || (selectedHistoryCellId && log.id === selectedHistoryCellId));
                              const currentCellRowBackground = isCurrentHistoryRow
                                ? (group.key === 'manual' ? '#fedfbb' : '#c8ebfd')
                                : undefined;
                              const historyRowFontWeight = isCurrentHistoryRow ? 800 : 400;
                              return (
                              <tr
                                key={historyRowKey}
                                className={isCurrentHistoryRow ? 'patient-history-current-row' : undefined}
                                style={{
                                  '--patient-history-current-row-bg': currentCellRowBackground,
                                  boxShadow: isCurrentHistoryRow ? 'inset 4px 0 0 var(--brand-primary, #2563eb)' : undefined,
                                  outline: isCurrentHistoryRow ? '1px solid rgba(37, 99, 235, 0.38)' : undefined,
                                  fontWeight: historyRowFontWeight,
                                }}
                                title={log.id === 'draft' ? "현재 선택된 셀의 날짜를 기반으로 한 임시 항목입니다" : undefined}
                              >
                                <td style={{ textAlign: 'center', backgroundColor: currentCellRowBackground, whiteSpace: 'nowrap', fontWeight: historyRowFontWeight }}>
                                  {log.date}
                                  {isCurrentHistoryRow && (
                                    <span style={{ fontSize: '0.76rem', color: 'var(--brand-primary)', display: 'block', marginTop: '2px', fontWeight: 800 }}>현재 셀</span>
                                  )}
                                </td>
                                <td style={{ textAlign: 'center', backgroundColor: currentCellRowBackground, color: log.type === 'manual' ? 'var(--brand-primary)' : 'inherit', fontWeight: historyRowFontWeight }}>
                                  {log.prescription}
                                </td>
                                <td style={{ textAlign: 'center', backgroundColor: currentCellRowBackground, fontWeight: historyRowFontWeight }}>{log.body_part}</td>
                                <td
                                  title={log.memo || ''}
                                  style={{ textAlign: 'left', backgroundColor: currentCellRowBackground, color: 'var(--text-secondary)', fontSize: '0.85em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: historyRowFontWeight }}
                                >
                                  {log.memo}
                                </td>
                                <td style={{ textAlign: 'center', backgroundColor: currentCellRowBackground, fontWeight: historyRowFontWeight }} onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="text"
                                    inputMode="text"
                                    value={log.visit_count || ''}
                                    placeholder="-"
                                    style={{ width: '36px', textAlign: 'center', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '1px 2px', outline: 'none' }}
                                    onChange={(e) => {
                                      const rawVal = e.target.value.trim();
                                      const val = rawVal === '*' || rawVal === '-'
                                        ? rawVal
                                        : normalizeVisitInputValue(rawVal);
                                      setPatientHistoryModalData(prev => ({
                                        ...prev,
                                        logs: prev.logs.map(l => (l._history_row_key || l.id) === historyRowKey ? { ...l, visit_count: val } : l)
                                      }));
                                    }}
                                    onBlur={async (e) => {
                                      const newVal = normalizeVisitInputValue(e.target.value);
                                      if (newVal !== e.target.value) e.target.value = newVal;
                                      const originalVal = log._original_visit_count ?? '';
                                      if (newVal !== originalVal) {
                                        if (log.id === 'draft' || isCurrentHistoryRow) {
                                          const success = await handleUpdateCurrentCellVisitCount(newVal, log);
                                          setPatientHistoryModalData(prev => ({
                                            ...prev,
                                            logs: prev.logs.map(l => (l._history_row_key || l.id) === historyRowKey
                                              ? (success
                                                ? { ...l, visit_count: newVal, _original_visit_count: newVal }
                                                : { ...l, visit_count: originalVal })
                                              : l)
                                          }));
                                        } else if (String(log.id || '').startsWith('draft-')) {
                                          const success = await handleUpdateDraftHistoryVisitCount(log, newVal);
                                          setPatientHistoryModalData(prev => ({
                                            ...prev,
                                            logs: prev.logs.map(l => (l._history_row_key || l.id) === historyRowKey
                                              ? (success
                                                ? { ...l, visit_count: newVal, _original_visit_count: newVal }
                                                : { ...l, visit_count: originalVal })
                                              : l)
                                          }));
                                        } else {
                                          const success = await handleUpdateLogVisitCount(log, newVal);
                                          setPatientHistoryModalData(prev => ({
                                            ...prev,
                                            logs: prev.logs.map(l => {
                                              if ((l._history_row_key || l.id) !== historyRowKey) return l;
                                              return success
                                                ? { ...l, visit_count: newVal, _original_visit_count: newVal }
                                                : { ...l, visit_count: originalVal };
                                            })
                                          }));
                                        }
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.target.blur();
                                      }
                                    }}
                                  />
                                </td>
                                <td
                                  title={log.therapist_name || ''}
                                  style={{ textAlign: 'center', backgroundColor: currentCellRowBackground, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: historyRowFontWeight }}
                                >
                                  {log.therapist_name || '-'}
                                </td>
                                <td style={{ textAlign: 'center', backgroundColor: currentCellRowBackground, fontWeight: historyRowFontWeight }} onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    className="patient-history-apply-button"
                                    title="선택한 셀에 적용"
                                    onClick={() => requestApplyPatientHistoryToCell(log)}
                                    style={{
                                      border: '1px solid var(--brand-primary, #4f46e5)',
                                      background: 'var(--brand-primary, #4f46e5)',
                                      color: '#fff',
                                      borderRadius: '6px',
                                      padding: '4px 8px',
                                      fontSize: '0.78rem',
                                      fontWeight: 600,
                                      lineHeight: 1.2,
                                      cursor: 'pointer',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    적용
                                  </button>
                                </td>
                              </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {pendingPatientHistoryApplyLog && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="patient-history-apply-confirm-title"
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(15, 23, 42, 0.28)',
                zIndex: 1000001,
              }}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <div
                style={{
                  width: 'min(420px, calc(100vw - 40px))',
                  background: 'var(--bg-primary, #fff)',
                  borderRadius: '12px',
                  boxShadow: '0 18px 48px rgba(15, 23, 42, 0.22)',
                  border: '1px solid var(--border-color, #d7dde5)',
                  overflow: 'hidden',
                }}
              >
                <div style={{ padding: '18px 20px 10px' }}>
                  <h4
                    id="patient-history-apply-confirm-title"
                    style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary, #111827)' }}
                  >
                    내역 적용 확인
                  </h4>
                  <p style={{ margin: '10px 0 0', fontSize: '0.95rem', lineHeight: 1.5, color: 'var(--text-secondary, #4b5563)' }}>
                    선택한 셀에 해당 내용을 적용하시겠습니까?
                  </p>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '8px',
                    padding: '14px 20px 18px',
                    background: 'var(--bg-secondary, #f8fafc)',
                    borderTop: '1px solid var(--border-color, #e5e7eb)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setPendingPatientHistoryApplyLog(null)}
                    style={{
                      border: '1px solid var(--border-color, #d1d5db)',
                      background: 'var(--bg-primary, #fff)',
                      color: 'var(--text-primary, #111827)',
                      borderRadius: '8px',
                      padding: '8px 14px',
                      fontSize: '0.9rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    아니요
                  </button>
                  <button
                    type="button"
                    onClick={confirmApplyPatientHistoryToCell}
                    style={{
                      border: '1px solid var(--brand-primary, #4f46e5)',
                      background: 'var(--brand-primary, #4f46e5)',
                      color: '#fff',
                      borderRadius: '8px',
                      padding: '8px 14px',
                      fontSize: '0.9rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    예
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {(() => {
        let hoverTooltipText = '';
        if (hoverCell) {
          const { weekIdx, dayIdx, rowIdx, colIdx, staffBlockRule, slotInfo, selectionInfo } = hoverCell;
          const keyStr = cellKey(weekIdx, dayIdx, rowIdx, colIdx);
          const cellData = renderMemos[keyStr] || {};
          const content = typeof pendingDisplayValues[keyStr] === 'string' ? pendingDisplayValues[keyStr] : cellData.content;
          const hasHoverContent = Boolean(String(content || '').trim() && content !== '\u200B');
          const cellPrescription = cellData.prescription || '';
          
          const isSelectionHover = selectionInfo && selectionInfo.w === weekIdx && selectionInfo.d === dayIdx && selectionInfo.minRow !== selectionInfo.maxRow && selectedKeys && selectedKeys.has(keyStr);
          
          let text = '';
          if (isSelectionHover) {
            const daySlots = getTimeSlotsForDay(weekIdx, dayIdx);
            const sStart = daySlots.find(s => s.idx === selectionInfo.minRow);
            const sEnd = daySlots.find(s => s.idx === selectionInfo.maxRow);
            if (sStart && sEnd) {
              const t1 = sStart.time || sStart.label;
              const t2_time = new Date(`2000-01-01T${sEnd.time || sEnd.label}:00`);
              t2_time.setMinutes(t2_time.getMinutes() + (settings?.interval_minutes || 30));
              const t2_hh = String(t2_time.getHours()).padStart(2, '0');
              const t2_mm = String(t2_time.getMinutes()).padStart(2, '0');
              const t2 = `${t2_hh}:${t2_mm}`;
              
              const diffMin = (selectionInfo.maxRow - selectionInfo.minRow + 1) * (settings?.interval_minutes || 30);
              const hrs = Math.floor(diffMin / 60);
              const mns = diffMin % 60;
              let dStr = '';
              if (hrs > 0) dStr += `${hrs}시간`;
              if (mns > 0) dStr += (hrs > 0 ? ' ' : '') + `${mns}분`;
              
              text = `⏱ ${t1} ~ ${t2} (총 ${dStr})`;
              if (hasHoverContent) text += `\n👤 ${content}`;
            } else {
              const mergeSpanForHover = pendingMergeSpans[keyStr] || cellData.merge_span;
              const optimisticCellData = { ...cellData, merge_span: mergeSpanForHover };
              const reservationTime = getReservationTimeForMemo(optimisticCellData, weekIdx, dayIdx, rowIdx);
              text = `⏱ ${reservationTime || slotInfo.label}`;
              if (hasHoverContent) text += `\n👤 ${content}`;
            }
          } else {
            const mergeSpanForHover = pendingMergeSpans[keyStr] || cellData.merge_span;
            const optimisticCellData = { ...cellData, merge_span: mergeSpanForHover };
            const reservationTime = getReservationTimeForMemo(optimisticCellData, weekIdx, dayIdx, rowIdx);
            text = `⏱ ${reservationTime || slotInfo.label}`;
            if (hasHoverContent) text += `\n👤 ${content}`;
          }
          
          if (staffBlockRule) text += `\n근무표: ${staffBlockRule.keyword}`;
          if (hasHoverContent && cellPrescription) text += `\n💊 처방: ${cellPrescription}`;
          if (hasHoverContent && cellData?.body_part) text += `\n🦴 부위: ${cellData.body_part}`;
          const memoList = getMemoListFromMergeSpan(cellData?.merge_span);
          if (memoList.length > 0) text += `\n📝 메모: ${memoList.join(' / ')}`;
          hoverTooltipText = text;
        }

        return hoverCell && hoverTooltipText && (
          <div
            ref={tooltipRef}
            className="sw-custom-tooltip"
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              opacity: 0,
            }}
          >
            {hoverTooltipText.split('\n').map((line, i) => (
              <div key={i} className={i === 0 ? 'sw-custom-tooltip-time' : undefined}>
                {i === 0 && line.startsWith('⏱') ? (
                  <>
                    <span className="sw-custom-tooltip-clock">⏱</span>
                    {line.slice(1)}
                  </>
                ) : line}
              </div>
            ))}
          </div>
        );
      })()}

      {todayShortcutTooltip && (
        <div
          className="sw-shortcut-floating-tooltip"
          style={{
            left: todayShortcutTooltip.x,
            top: todayShortcutTooltip.y,
          }}
        >
          {todayShortcutTooltip.text}
        </div>
      )}

      {canManageSchedulerSettings && showTherapistConfig && (
        <MonthlyTherapistConfig
          year={currentYear}
          month={currentMonth}
          therapists={therapists}
          manualTherapists={manualTherapists}
          monthlyTherapists={monthlyTherapists}
          monthlyManualTherapists={monthlyManualTherapists}
          onSave={saveMonthlyTherapists}
          onSaveRoster={saveTherapistRoster}
          settings={settings}
          onSaveSettings={saveShockwaveSettings}
          onClose={() => setShowTherapistConfig(false)}
        />
      )}
    </>
  );
}

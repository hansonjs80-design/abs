import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { flushSync } from 'react-dom';
import { useSchedule } from '../../contexts/ScheduleContext';

import { getTodayKST, isSameDate } from '../../lib/calendarUtils';
import { normalizeNameForMatch } from '../../lib/memoParser';
import { buildBlankScheduleCleanupPayload, sanitizeBlankScheduleCellData } from '../../lib/scheduleBlankCellCleanupUtils';
import { isTreatmentCancelBg, isTreatmentCompleteBg } from '../../lib/scheduleStatusUtils';
import { getManualTherapyRowSpan } from '../../lib/manualTherapyMergeUtils';
import { buildManualTherapyAutoMergePayload } from '../../lib/scheduleManualTherapyAutoMergeUtils';
import { get4060PrescriptionFromContent, has4060Pattern, normalize4060StarOrder } from '../../lib/schedulerContentFormat';
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
  getShockwaveScheduleScrollKey,
  rememberPendingScheduleDraft,
  removePendingScheduleDraft,
  removePendingScheduleDraftIfValue,
  splitBodyParts,
  normalizeBodyPartKey,
  parseSchedulerPatientIdentity,
  normalizeSchedulerVisitSuffix,
  normalizeVisitInputValue,
  getMemoListFromMergeSpan,
  stepReservationTimeWithinCellBase,
  stripReservationTimeFromMergeSpan,
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
  editValue,
  handleCellMouseDown, handleCellMouseEnter, setHoverCell, handleCellDoubleClick, handleCellContextMenu,
  editInputRef, handleCellSave, handleEditKeyDown, imeOpenRef, setImePreviewCell, editDraftRef, scheduleEditDraftAutosave, promoteFocusedInputToEditor, skipNextEditBlurSaveRef
}) => {
  const resizerRef = useRef(null);
  const content = pendingContent || '';
  const effectiveMergeSpan = pendingMergeSpan || mergeSpan;
  const cellMemoList = getMemoListFromMergeSpan(effectiveMergeSpan);
  const hasCellMemo = cellMemoList.length > 0;
  const cellPrescription = cellData?.prescription || effectiveMergeSpan?.meta?.prescription || '';
  const displayData = buildSchedulerCellDisplay(content, effectiveMergeSpan);

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
  if (dayInfo.isHoliday) cls += ' holiday-bg';
  else if (!dayInfo.isCurrentMonth) cls += ' other-month-bg disabled-cell';
  
  if (slotInfo.disabled && !displayData.hasDisplayText) cls += ' disabled';
  
  if (isTreatmentCompleteBg(cellData?.bg_color)) cls += ' preserve';
  if (isTreatmentCancelBg(cellData?.bg_color)) cls += ' cancelled';
  if (has4060Pattern(content)) cls += ' color-4060';
  if (hasCellMemo) cls += ' has-memo';
  if (isSelected) cls += ' selected';
  if (isPrimary) cls += ' primary-selected';

  if (clipboardSource?.keys?.has(cellKey)) {
    cls += ` ants-active ${clipboardSource.mode === 'cut' ? 'ants-red' : 'ants-blue'}`;
  }

  if (dayInfo.isCurrentMonth && !isSelected && workState === 'off') {
    cls += ' staff-off';
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
  else if (dayInfo.isCurrentMonth && staffBlockRule?.bg_color) inlineStyle.backgroundColor = staffBlockRule.bg_color;
  
  if (dayInfo.isCurrentMonth && staffBlockRule?.font_color) inlineStyle.color = staffBlockRule.font_color;

  const prescriptionColor = cellPrescription ? effectivePrescriptionColors[cellPrescription] : undefined;
  const hasMeaningfulContent = displayData.hasDisplayText && content.trim() && content.trim() !== '\u200B';
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
                    {visualRowSpan > 1 && !displayData.noteSuffix ? <br /> : null}
                    {renderSchedulerVisitSuffix(displayData.visitSuffix, visitSuffixClassName, visitSuffixColor ? { color: visitSuffixColor } : undefined)}
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
        )}
        <div
          ref={resizerRef}
          className={`sw-cell-input-wrapper ${(!isEditing && !isImePreview) ? 'hidden' : ''}`}
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
              if (imeOpenRef.current || e.nativeEvent?.isComposing) return;
              scheduleEditDraftAutosave(cellKey, nextValue);
              if (!isEditing && e.currentTarget.value) promoteFocusedInputToEditor(cellKey, e.currentTarget.value);
            }}
          onBlur={(e) => {
            setImePreviewCell((prev) => (prev === cellKey ? null : prev));
            if (skipNextEditBlurSaveRef.current) { skipNextEditBlurSaveRef.current = false; return; }
            // Assuming contextMenuRef check is done globally or here? We pass a boolean or ignore it.
            if (isEditing) handleCellSave(weekIdx, dayIdx, rowIdx, colIdx, e.target.value);
          }}
          onKeyDown={e => { if (isEditing) handleEditKeyDown(e, weekIdx, dayIdx, rowIdx, colIdx); }}
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
                  {visualRowSpan > 1 && !displayData.noteSuffix ? <br /> : null}
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
      const timeCell = container.querySelector(`[data-time-row="${activeWeek}-${activeRow}"]`);
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
  const imeOpenRef = useRef(false);
  const skipNextEditBlurSaveRef = useRef(false);
  const handleCellSaveRef = useRef(null);
  const editDraftRef = useRef(null);
  const editAutosaveTimerRef = useRef(null);
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
    if (loadedMemosKey !== monthKey) return;
    if (prescriptionPatchKeyRef.current === monthKey) return; // 이미 이번 달 패치 완료
    if (!memos || Object.keys(memos).length === 0) return;

    const fixEntries = [];
    Object.entries(memos).forEach(([key, memo]) => {
      const content = String(memo?.content || '').trim();
      if (!content) return;
      const autoPres = get4060PrescriptionFromContent(content);
      if (!autoPres) return;
      const existingPrescription = String(memo?.prescription || '').trim();
      const mergeSpan = memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
      const expectedRowSpan = getManualTherapyRowSpan(autoPres);
      const hasExpectedMerge = (
        expectedRowSpan > 1 &&
        !mergeSpan.mergedInto &&
        (mergeSpan.rowSpan || 1) === expectedRowSpan &&
        (mergeSpan.colSpan || 1) === 1
      );
      if (existingPrescription === autoPres && hasExpectedMerge) return;
      fixEntries.push({ key, prescription: autoPres, content });
    });

    const blankCleanupPayload = buildBlankScheduleCleanupPayload({
      memos,
      currentYear,
      currentMonth,
    });

    prescriptionPatchKeyRef.current = monthKey; // 패치 시도 표시 (빈 배열이어도)

    if (fixEntries.length === 0 && blankCleanupPayload.length === 0) return;

    (async () => {
      const payloadByKey = new Map();
      blankCleanupPayload.forEach((item) => {
        payloadByKey.set(`${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`, item);
      });
      fixEntries.forEach(({ key, prescription, content }) => {
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
        });
        const updates = manualTherapyMerge.ok ? manualTherapyMerge.payload : [{
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
  }, [loadedMemosKey, currentYear, currentMonth, memos, baseTimeSlots.length, saveShockwaveMemosBulk, onLoadMemos]);

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
    setPendingDisplayValues((prev) => ({ ...prev, [key]: value ?? '' }));
    editDraftRef.current = { key, value: value ?? '', dirty: true };
    // DB 저장은 handleCellSave(편집 완료 시)에서 처방 정보와 함께 수행.
    // 여기서 미리 저장하면 처방 없이 저장되어 노란색 '처방 없음'이 잠깐 보이는 문제 발생.
    if (editAutosaveTimerRef.current) {
      clearTimeout(editAutosaveTimerRef.current);
      editAutosaveTimerRef.current = null;
    }
  }, [setPendingDisplayValues]);

  const flushEditDraft = useCallback(() => {
    if (editAutosaveTimerRef.current) {
      clearTimeout(editAutosaveTimerRef.current);
      editAutosaveTimerRef.current = null;
    }
    const draft = editDraftRef.current;
    if (!draft?.key || !draft.dirty) return;
    editDraftRef.current = null;
    const [w, d, r, c] = draft.key.split('-').map(Number);
    if (![w, d, r, c].every(Number.isFinite)) return;
    // handleCellSave를 통해 처방 조회 포함 저장
    Promise.resolve(handleCellSaveRef.current?.(w, d, r, c, draft.value ?? ''))
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

  const selectSingleCell = useCallback((cell) => {
    const normalizedCell = normalizeCellToMergeMaster(cell);
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

  // ── 더블 클릭 = 편집 모드 진입 ──
  const handleCellDoubleClick = useCallback((e, w, d, r, c, content) => {
    selectSingleCell({ w, d, r, c });
    const key = cellKey(w, d, r, c);
    
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
  }, [selectSingleCell, cellKey]);

  // ── 편집 저장 ──
  const handleCellSave = useCallback(async (w, d, r, c, nextValue) => {
    const finalValue = nextValue !== undefined ? nextValue : (editInputRef.current?.value ?? editValue);
    const key = cellKey(w, d, r, c);
    const saveVersion = (cellSaveVersionRef.current[key] || 0) + 1;
    cellSaveVersionRef.current[key] = saveVersion;
    if (editDraftRef.current?.key === key) {
      editDraftRef.current = null;
    }
    if (editAutosaveTimerRef.current) {
      clearTimeout(editAutosaveTimerRef.current);
      editAutosaveTimerRef.current = null;
    }
    const oldContent = memos[key]?.content || '';
    const immediateContent = String(finalValue ?? '').trim();
    setPendingDisplayValues((prev) => ({ ...prev, [key]: immediateContent }));
    setEditingCell(null);
    const hasManualParentheticalNote = Boolean(getNonVisitParentheticalSuffix(immediateContent));
    const result = hasManualParentheticalNote
      ? { text: immediateContent }
      : await buildSchedulerAutoText(w, d, r, c, finalValue, false, editValue);
    if (cellSaveVersionRef.current[key] !== saveVersion) return;
    const newContent = normalizeSchedulerVisitSuffix(
      normalize4060StarOrder(typeof result === 'string' ? result : (result?.text || ''))
    );
    let newPrescription = result?.prescription;
    const newBodyPart = result?.bodyPart;
    const newMergeSpan = result?.mergeSpan ? stripReservationTimeFromMergeSpan(result.mergeSpan) : undefined;
    const hasPrescriptionResult = typeof result === 'object' && result !== null && Object.prototype.hasOwnProperty.call(result, 'prescription');
    const hasBodyPartResult = typeof result === 'object' && result !== null && Object.prototype.hasOwnProperty.call(result, 'bodyPart');
    const hasMergeSpanResult = typeof result === 'object' && result !== null && Object.prototype.hasOwnProperty.call(result, 'mergeSpan');

    // 이름에 도수치료 숫자 패턴이 있으면 해당 처방을 자동 설정
    const autoDosePrescription = get4060PrescriptionFromContent(newContent);
    if (autoDosePrescription) {
      newPrescription = autoDosePrescription;
    } else if (!has4060Pattern(newContent) && /^\d{2,3}분$/.test(memos[key]?.prescription || '')) {
      // 이름에서 숫자 태그가 없어졌는데 기존 처방이 도수치료 처방이면 처방 없음으로 변경
      newPrescription = '';
    }

    if (newContent !== immediateContent) {
      setPendingDisplayValues((prev) => ({ ...prev, [key]: newContent }));
    }

    const manualTherapyMerge = buildManualTherapyAutoMergePayload({
      key,
      memos: effectiveMemos,
      pendingMergeSpans,
      currentYear,
      currentMonth,
      rowCount: baseTimeSlots.length,
      content: newContent,
      bgColor: memos[key]?.bg_color || null,
      prescription: newPrescription ?? (memos[key]?.prescription || ''),
      bodyPart: hasBodyPartResult ? newBodyPart : (memos[key]?.body_part || null),
      mergeSpan: newMergeSpan || memos[key]?.merge_span,
    });

    const shouldWritePrescription = hasPrescriptionResult || (newPrescription !== undefined && newPrescription !== null);
    const prescriptionChanged = shouldWritePrescription && (memos[key]?.prescription || '') !== (newPrescription || '');
    const bodyPartChanged = hasBodyPartResult && (memos[key]?.body_part || '') !== (newBodyPart || '');
    const mergeSpanChanged = hasMergeSpanResult && JSON.stringify(memos[key]?.merge_span || null) !== JSON.stringify(newMergeSpan || null);
    if (newContent === oldContent && !prescriptionChanged && !bodyPartChanged && !mergeSpanChanged && !manualTherapyMerge.ok) {
      setPendingDisplayValues((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }

    if (manualTherapyMerge.ok) {
      setPendingDisplayValues((prev) => ({ ...prev, [key]: newContent }));
      removePendingScheduleDraft(currentYear, currentMonth, key);
      applyImmediateCellDisplay(manualTherapyMerge.payload);
      applyImmediateMergeSpan(manualTherapyMerge.payload);
      recordUndo({
        type: 'bulk-edit',
        oldMemos: buildMemoSnapshotForKeys(manualTherapyMerge.affectedKeys),
      });
      const success = await queuedSaveShockwaveMemosBulk(manualTherapyMerge.payload);
      if (success) {
        removePendingScheduleDraftIfValue(currentYear, currentMonth, key, newContent);
        clearImmediateCellDisplay(manualTherapyMerge.payload);
      } else {
        rememberPendingScheduleDraft(currentYear, currentMonth, key, newContent);
        addToast('저장 실패', 'error');
      }
      return;
    }

    if (manualTherapyMerge.reason === 'occupied') {
      addToast('아래 셀이 비어있지 않아 자동 병합하지 않았습니다.', 'warning');
    } else if (manualTherapyMerge.reason === 'bounds') {
      addToast('아래 시간이 부족해 자동 병합하지 않았습니다.', 'warning');
    }

    setPendingDisplayValues((prev) => ({ ...prev, [key]: newContent }));
    removePendingScheduleDraft(currentYear, currentMonth, key);
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
      oldMergeSpan: memos[key]?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
      oldPrescription: memos[key]?.prescription || null,
      oldBodyPart: memos[key]?.body_part || null,
    });
    const success = await queuedOnSaveMemo(currentYear, currentMonth, w, d, r, c, newContent, undefined, newMergeSpan, newPrescription, newBodyPart);
    if (success) removePendingScheduleDraftIfValue(currentYear, currentMonth, key, newContent);
    else rememberPendingScheduleDraft(currentYear, currentMonth, key, newContent);
    // pendingDisplayValues는 즉시 삭제하지 않음.
    // memos 컨텍스트가 새 값을 반영할 때까지 유지하여 깜빡임 방지.
    // 아래 useEffect(cleanupStalePendingValues)에서 memos 업데이트 후 자동 정리.
    if (!success) addToast('저장 실패', 'error');
  }, [editValue, currentYear, currentMonth, memos, effectiveMemos, pendingMergeSpans, baseTimeSlots.length, queuedOnSaveMemo, addToast, buildSchedulerAutoText, recordUndo, buildMemoSnapshotForKeys, queuedSaveShockwaveMemosBulk, applyImmediateCellDisplay, applyImmediateMergeSpan, clearImmediateCellDisplay, cellKey, setPendingDisplayValues]);

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
    clipboardRef,
    clipboardSource,
    setClipboardSource,
    currentYear,
    currentMonth,
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

  const handleContextAction = useScheduleContextMenuActions({
    selectedKeys,
    contextMenu,
    memos: effectiveMemos,
    pendingDisplayValues,
    currentYear,
    currentMonth,
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
    editDraftRef.current = { key, value: value || '', dirty: true };
    flushSync(() => {
      setEditingCell(key);
      setEditValue(value);
    });
  }, []);

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

  const handleKeyDown = useScheduleKeyboardActions({
    contextMenu,
    clipboardSource,
    setClipboardSource,
    selectedCell,
    editingCell,
    selectedKeys,
    pendingDisplayValues,
    pendingMemoOverrides,
    pendingMergeSpans,
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
  }, [baseTimeSlots.length, colCount, selectSingleCell, getAdjacentCell, moveEditInputCaret]);

  const handleChartSelectorClose = useCallback((selected) => {
    if (!chartSelector) return;
    chartSelector.resolve(selected || null);
    setChartSelector(null);
  }, [chartSelector]);

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
              <div className="shockwave-week-floating-actions shockwave-week-floating-actions--left">
                <button
                  type="button"
                  className="shockwave-row-height-handle"
                  title={`행 높이 조절 (${rowHeight}px)`}
                  aria-label="시간 행 높이 조절"
                  onMouseDown={startRowResize}
                >
                  ↕
                </button>
              </div>
              {canManageSchedulerSettings && (
                <div className="shockwave-week-floating-actions shockwave-week-floating-actions--right">
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
                        elements.push(
                          <div
                            key={`time-${rowIdx}`}
                            className={`sw-time-label${slotInfo.isLunch ? ' lunch' : ''}${slotInfo.disabled ? ' disabled' : ''}`}
                            data-time-row={`${weekIdx}-${rowIdx}`}
                            style={{
                              gridColumn: '1',
                              gridRow: `${gridRowStart}`,
                              borderBottom: isLastRenderedRow ? 'none' : `1px solid ${HORIZONTAL_BORDER_COLOR}`,
                            }}
                          >
                            {slotInfo.label}
                          </div>
                        );
                      }

                      // 2. Cells
                      for (let colIdx = 0; colIdx < colCount; colIdx++) {
                        const key = cellKey(weekIdx, dayIdx, rowIdx, colIdx);
                        const rawCellData = renderMemos[key] || null;
                        const hasPendingBg = Object.prototype.hasOwnProperty.call(pendingCellBgColors, key);
                        const pendingAdjustedCellData = hasPendingBg
                          ? {
                              ...(rawCellData || {}),
                              bg_color: pendingCellBgColors[key],
                            }
                          : rawCellData;
                        const rawContent = normalizeSchedulerVisitSuffix(pendingDisplayValues[key] ?? rawCellData?.content ?? '');
                        const rawMergeSpan = getEffectiveMergeSpan(key, renderMemos);
                        const sanitizedBlankCell = sanitizeBlankScheduleCellData({
                          key,
                          memos: renderMemos,
                          cellData: pendingAdjustedCellData,
                          pendingDisplayValues,
                          pendingMergeSpans,
                        });
                        const displayCellData = sanitizedBlankCell.cellData;
                        const content = sanitizedBlankCell.wasSanitized ? '' : rawContent;
                        let mergeSpan = sanitizedBlankCell.mergeSpan || rawMergeSpan;

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
                              cellData={displayCellData} pendingContent={content} pendingMergeSpan={pendingMergeSpans[key]} mergeSpan={finalMergeSpan}
                              editingCell={editingCell} imePreviewCell={imePreviewCell}
                              selectedKeys={selectedKeys} selectedCell={selectedCell} clipboardSource={clipboardSource}
                              workState={workState} staffBlockRule={staffBlockRule}
                              effectivePrescriptionColors={effectivePrescriptionColors}
                              editValue={editValue}
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
        </div>
        );
      }), [
        weeks, dayColWidth, todayWeekIdx, today, getTimeSlotsForDay,
        therapistColsCSS, colCount, getTherapistNameForDate, activeColRatios,
        startColResize, startDayResize, startRowResize,
        renderMemos, pendingDisplayValues, pendingMergeSpans, pendingCellBgColors, editingCell, imePreviewCell,
        selectedKeys, selectedCell, clipboardSource,
        getTherapistWorkState, getStaffScheduleBlockForCell,
        isLastHourSlot, effectivePrescriptionColors, editValue,
        handleCellMouseDown, handleCellMouseEnter, setHoverCell,
        handleCellDoubleClick, handleCellContextMenu,
        handleEditKeyDown, scheduleEditDraftAutosave, promoteFocusedInputToEditor, handleCellSave,
        cellKey, getEffectiveMergeSpan, rowHeight, canManageSchedulerSettings
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
            const shockwavePrescriptions = Array.isArray(settings?.prescriptions)
              ? settings.prescriptions.filter(Boolean)
              : [];
            const manualTherapyPrescriptions = Array.isArray(settings?.manual_therapy_prescriptions)
              ? settings.manual_therapy_prescriptions.filter((pres) => pres && !shockwavePrescriptions.includes(pres))
              : [];
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
                                  handleContextAction({ type: 'prescription', value: e.target.value || null });
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
                                  handleContextAction({ type: 'prescription', value: e.target.value || null });
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
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999999 }}>
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
            <div style={{ padding: '14px 18px', maxHeight: '70vh', overflowY: 'auto' }}>
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

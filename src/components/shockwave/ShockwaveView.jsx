import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useSchedule } from '../../contexts/ScheduleContext';

import { getTodayKST, isSameDate } from '../../lib/calendarUtils';
import { supabase } from '../../lib/supabaseClient';
import { normalizeNameForMatch } from '../../lib/memoParser';
import { get4060PrescriptionFromContent, has4060Pattern, normalize4060StarOrder } from '../../lib/schedulerContentFormat';
import { toProperCase } from '../../lib/shockwaveSyncUtils';
import { DAY_NAMES, getMonthlyDayOverrides } from '../../lib/schedulerOperatingHours';
import { useToast } from '../common/Toast';
import MonthlyTherapistConfig from './MonthlyTherapistConfig';
import SchedulerPatientSelector from './SchedulerPatientSelector';
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
  getShockwaveScheduleScrollKey,
  rememberPendingScheduleDraft,
  removePendingScheduleDraftIfValue,
  splitBodyParts,
  normalizeBodyPartKey,
  formatBodyPartInput,
  getPrescriptionColor,
  parseSchedulerPatientIdentity,
  normalizeSchedulerVisitSuffix,
  normalizeVisitInputValue,
  stepVisitInputValue,
  getMemoListFromMergeSpan,
  normalizeReservationTimeValue,
  stepReservationTimeValue,
  timeValueToMinutes,
  minutesToTimeValue,
  stepReservationTimeWithinCellBase,
  getReservationTimeFromMergeSpan,
  buildMergeSpanWithReservationTime,
  stripReservationTimeFromMergeSpan,
  buildMergeSpanWithBodyPartOptions,
  isUndoShortcutEvent,
  buildMergeSpanWithMemoList,
  buildSchedulerCellDisplay,
  buildSchedulerMemoSortKey,
  addBodyPartToMap,
} from '../../lib/schedulerUtils';

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

const ContextMenuLocalInputGroup = ({ placeholder, buttonLabel, onSubmit, imeOpenRef, className = "context-menu-input", autoFocus }) => {
  const [localValue, setLocalValue] = useState('');

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
          }
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

const MemoizedCell = React.memo(({
  cellKey, weekIdx, dayIdx, rowIdx, colIdx, dayInfo, slotInfo, showTimeCol, gridRowStart, isLastRenderedRow, colCount,
  cellData, pendingContent, mergeSpan, editingCell, imePreviewCell, selectedKeys, selectedCell, clipboardSource,
  workState, staffBlockRule, effectivePrescriptionColors,
  editValue,
  handleCellMouseDown, handleCellMouseEnter, setHoverCell, handleCellDoubleClick, handleCellContextMenu,
  editInputRef, handleCellSave, handleEditKeyDown, imeOpenRef, setImePreviewCell, editDraftRef, scheduleEditDraftAutosave, promoteFocusedInputToEditor, skipNextEditBlurSaveRef
}) => {
  const content = dayInfo.isCurrentMonth ? pendingContent : '';
  const cellPrescription = cellData?.prescription || mergeSpan?.meta?.prescription || '';
  const displayData = buildSchedulerCellDisplay(content, mergeSpan);

  const isEditing = dayInfo.isCurrentMonth && editingCell === cellKey;
  const isImePreview = dayInfo.isCurrentMonth && imePreviewCell === cellKey;
  const isSelected = dayInfo.isCurrentMonth && selectedKeys.has(cellKey);
  const isPrimary = dayInfo.isCurrentMonth && selectedCell && selectedCell.w === weekIdx && selectedCell.d === dayIdx && selectedCell.r === rowIdx && selectedCell.c === colIdx;
  const gridColumnStart = showTimeCol ? colIdx + 2 : colIdx + 1;

  let visualRowSpan = 1;
  if (mergeSpan.rowSpan > 1) {
    visualRowSpan = mergeSpan.rowSpan; // Approximated, since daySlots is not passed, but for this context it works for UI layout unless lunch is spanned. We will assume simple rowSpan for visual
  }

  let cls = 'sw-cell';
  if (!dayInfo.isCurrentMonth) cls += ' other-month-bg disabled-cell';
  else if (dayInfo.isHoliday) cls += ' holiday-bg';
  
  if (slotInfo.disabled && !displayData.hasDisplayText) cls += ' disabled';
  
  // NOTE: hardcoded colors based on constants
  if (cellData?.bg_color === '#e8f5e9') cls += ' preserve'; // TREATMENT_COMPLETE_BG
  if (cellData?.bg_color === '#ffebee') cls += ' cancelled'; // TREATMENT_CANCEL_BG
  if (has4060Pattern(content)) cls += ' color-4060';
  if (isSelected) cls += ' selected';
  if (isPrimary) cls += ' primary-selected';

  if (clipboardSource?.keys?.has(cellKey)) {
    cls += ` ants-active ${clipboardSource.mode === 'cut' ? 'ants-red' : 'ants-blue'}`;
  }

  if (!isSelected && workState === 'off') {
    cls += ' staff-off';
  } else if (!isSelected && workState === 'early-leave') {
    // Assuming isLastHourSlot logic is true if passed as such, wait, we need to know. 
    // We pass it in as part of workState or check it here
  }

  let inlineStyle = {
    gridColumn: `${gridColumnStart}${mergeSpan.colSpan > 1 ? ` / span ${mergeSpan.colSpan}` : ''}`,
    gridRow: `${gridRowStart}${visualRowSpan > 1 ? ` / span ${visualRowSpan}` : ''}`,
    borderBottom: isLastRenderedRow ? 'none' : `1px solid #e0e0e0`, // HORIZONTAL_BORDER_COLOR
  };

  if (colIdx + mergeSpan.colSpan - 1 === colCount - 1) {
    inlineStyle.borderRight = 'none';
  }

  if (cellData?.bg_color) inlineStyle.backgroundColor = cellData.bg_color;
  else if (staffBlockRule?.bg_color) inlineStyle.backgroundColor = staffBlockRule.bg_color;
  
  if (staffBlockRule?.font_color) inlineStyle.color = staffBlockRule.font_color;

  const prescriptionColor = cellPrescription ? effectivePrescriptionColors[cellPrescription] : undefined;
  const hasMeaningfulContent = displayData.hasDisplayText && content.trim() && content.trim() !== '\u200B';
  const noPrescription = hasMeaningfulContent && !cellPrescription;
  const noBodyPart = hasMeaningfulContent && !String(cellData?.body_part || '').trim();
  
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

  if (visualRowSpan > 1 || mergeSpan.colSpan > 1) {
    inlineStyle.display = 'flex'; inlineStyle.alignItems = 'center'; inlineStyle.justifyContent = 'center';
    cls += ' merged-master';
  }

  const showInput = isPrimary || isEditing;

  if (showInput) {
    return (
      <div id={`cell-${cellKey}`} className={`sw-cell ${isEditing ? 'editing' : ''} ${cls}`} style={inlineStyle}
        onMouseDown={(e) => { if (dayInfo.isCurrentMonth) handleCellMouseDown(weekIdx, dayIdx, rowIdx, colIdx, e); }}
        onMouseEnter={() => {
          if (!dayInfo.isCurrentMonth) return;
          handleCellMouseEnter(weekIdx, dayIdx, rowIdx, colIdx);
          setHoverCell({ weekIdx, dayIdx, rowIdx, colIdx, staffBlockRule, slotInfo, isMergedView: false });
        }}
        onMouseLeave={() => setHoverCell(null)}
        onDoubleClick={() => { if (dayInfo.isCurrentMonth) handleCellDoubleClick(weekIdx, dayIdx, rowIdx, colIdx, content); }}
        onContextMenu={(e) => {
          if (!dayInfo.isCurrentMonth) { e.preventDefault(); return; }
          if (displayData.hasDisplayText && content.trim() !== '\u200B') {
            handleCellContextMenu(e, weekIdx, dayIdx, rowIdx, colIdx, cellPrescription, slotInfo.time || slotInfo.label);
          }
        }}
      >
        {!isEditing && !isImePreview && (
          <div className="sw-cell-display" style={{ pointerEvents: 'none' }}>
            {displayData.hasDisplayText ? (
              <span className="sw-cell-main">
                <span style={baseTextColor ? { color: baseTextColor } : undefined}>{displayData.baseText}</span>
                {displayData.visitSuffix ? <span style={visitSuffixColor ? { color: visitSuffixColor } : undefined}>{displayData.visitSuffix}</span> : null}
              </span>
            ) : null}
          </div>
        )}
        <input
          ref={(isEditing || isPrimary) ? editInputRef : null}
          className="sw-cell-input"
          data-hidden-input={!isEditing && !isImePreview ? 'true' : undefined}
          defaultValue={isEditing ? editValue : ''}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={(isEditing || isImePreview) ? { position: 'relative', width: '100%', height: '100%', zIndex: 2, boxSizing: 'border-box' } : { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, padding: 0, border: 'none', outline: 'none', pointerEvents: 'none', zIndex: 1 }}
          onInput={(e) => {
            const nextValue = e.currentTarget.value;
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
            editDraftRef.current = { key: cellKey, value: editInputRef.current?.value || '', dirty: true };
          }}
          onCompositionEnd={(e) => {
            imeOpenRef.current = false;
            setImePreviewCell((prev) => (prev === cellKey ? null : prev));
            scheduleEditDraftAutosave(cellKey, e.currentTarget.value);
            if (!isEditing && e.currentTarget.value) promoteFocusedInputToEditor(cellKey, e.currentTarget.value);
          }}
        />
      </div>
    );
  } else {
    return (
      <div
        id={`cell-${cellKey}`}
        className={cls}
        style={inlineStyle}
        onMouseDown={(e) => handleCellMouseDown(weekIdx, dayIdx, rowIdx, colIdx, e)}
        onMouseEnter={() => {
          handleCellMouseEnter(weekIdx, dayIdx, rowIdx, colIdx);
          setHoverCell({ weekIdx, dayIdx, rowIdx, colIdx, staffBlockRule, slotInfo, isMergedView: true });
        }}
        onMouseLeave={() => setHoverCell(null)}
        onDoubleClick={() => handleCellDoubleClick(weekIdx, dayIdx, rowIdx, colIdx, content)}
        onContextMenu={(e) => {
          if (displayData.hasDisplayText && content.trim() !== '\u200B') {
            handleCellContextMenu(e, weekIdx, dayIdx, rowIdx, colIdx, cellPrescription, slotInfo.time || slotInfo.label);
          }
        }}
      >
        <div className="sw-cell-display">
          {displayData.hasDisplayText ? (
            <span className="sw-cell-main">
              <span style={baseTextColor ? { color: baseTextColor } : undefined}>{displayData.baseText}</span>
              {displayData.visitSuffix ? <span style={visitSuffixColor ? { color: visitSuffixColor } : undefined}>{displayData.visitSuffix}</span> : null}
            </span>
          ) : null}
        </div>
      </div>
    );
  }
}, (prevProps, nextProps) => {
  if (prevProps.pendingContent !== nextProps.pendingContent) return false;
  if (prevProps.cellData !== nextProps.cellData) return false;
  
  if (prevProps.mergeSpan.rowSpan !== nextProps.mergeSpan.rowSpan) return false;
  if (prevProps.mergeSpan.colSpan !== nextProps.mergeSpan.colSpan) return false;
  if (prevProps.mergeSpan.mergedInto !== nextProps.mergeSpan.mergedInto) return false;

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
  
  if (prevProps.workState !== nextProps.workState) return false;
  if (prevProps.staffBlockRule?.bg_color !== nextProps.staffBlockRule?.bg_color) return false;
  if (prevProps.staffBlockRule?.font_color !== nextProps.staffBlockRule?.font_color) return false;

  if (prevProps.isLastRenderedRow !== nextProps.isLastRenderedRow) return false;
  if (prevProps.colCount !== nextProps.colCount) return false;
  if (prevProps.showTimeCol !== nextProps.showTimeCol) return false;

  // Assume callbacks and colors are relatively stable or handled via refs in parent
  return true;
});

export default function ShockwaveView({ therapists, settings, memos = {}, onLoadMemos, onSaveMemo, holidays, staffMemos = {} }) {
  const { currentYear, currentMonth, navigateMonth, saveShockwaveMemosBulk, manualTherapists, monthlyTherapists, monthlyManualTherapists, loadMonthlyTherapists, saveMonthlyTherapists, saveTherapistRoster, loadShockwaveSettings, saveShockwaveSettings } = useSchedule();
  const { addToast } = useToast();
  const viewRef = useRef(null);
  const dragSelectionRef = useRef(null);
  const selectedCellRef = useRef(null);
  const [showTherapistConfig, setShowTherapistConfig] = useState(false);

  // ── 셀 조작 상태 (구글 시트 방식) ──
  const [selectedCell, setSelectedCell] = useState(null);     // { w, d, r, c }
  const [, setRangeEnd] = useState(null);                     // { w, d, r, c } (Shift 선택 끝점)
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [editingCell, setEditingCell] = useState(null);       // "w-d-r-c" 키 문자열
  const [editValue, setEditValue] = useState('');
  const [pendingDisplayValues, setPendingDisplayValues] = useState({});
  const [loadedMemosKey, setLoadedMemosKey] = useState('');
  const clipboardRef = useRef({ content: '', mode: null });   // mode: 'copy' | 'cut'
  const [clipboardSource, setClipboardSource] = useState(null); // { keys: Set, mode: 'copy'|'cut' }
  const [contextMenu, setContextMenu] = useState(null); // { x, y, weekIdx, dayIdx, rowIdx, colIdx, currentPrescription }
  const [activeContextSubmenu, setActiveContextSubmenu] = useState(null);
  const [contextMenuBodyPartOptions, setContextMenuBodyPartOptions] = useState([]);
  const [contextMenuBodyInput, setContextMenuBodyInput] = useState('');
  const [contextMenuNoteInput, setContextMenuNoteInput] = useState('');
  const [contextMenuMemoDrafts, setContextMenuMemoDrafts] = useState([]);
  const [contextMenuVisitInput, setContextMenuVisitInput] = useState('');
  const [contextMenuReservationInput, setContextMenuReservationInput] = useState('');

  // 환자 내역 검색 팝업 상태 (Cmd+F)
  const [patientHistoryModalOpen, setPatientHistoryModalOpen] = useState(false);
  const [patientHistoryModalData, setPatientHistoryModalData] = useState({ loading: false, logs: [], searchName: '', searchChart: '' });

  // Presence 기능 비활성화 – 실시간 데이터 동기화만 유지

  useEffect(() => {
    selectedCellRef.current = selectedCell;
  }, [selectedCell]);

  useSchedulePendingPersistence({
    currentMonth,
    currentYear,
    loadedMemosKey,
    memos,
    onSaveMemo,
    pendingDisplayValues,
    setPendingDisplayValues,
  });

  useEffect(() => {
    loadShockwaveSettings?.();
  }, [loadShockwaveSettings, currentYear, currentMonth]);

  useEffect(() => {
    const refreshSettingsOnFocus = () => {
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
  const [todayShortcutTooltip, setTodayShortcutTooltip] = useState(null);
  const [chartSelector, setChartSelector] = useState(null);
  const [imePreviewCell, setImePreviewCell] = useState(null);
  const contextMenuRef = useRef(null);
  const editInputRef = useRef(null);
  const imeOpenRef = useRef(false);
  const skipNextEditBlurSaveRef = useRef(false);
  const handleCellSaveRef = useRef(null);
  const editDraftRef = useRef(null);
  const editAutosaveTimerRef = useRef(null);
  const saveMemoRef = useRef(onSaveMemo);
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
    saveMemoRef.current = onSaveMemo;
    scheduleDateRef.current = { year: currentYear, month: currentMonth };
  }, [onSaveMemo, currentYear, currentMonth]);

  // 월별 치료사 설정 로드 (충격파 + 도수치료)
  useEffect(() => {
    loadMonthlyTherapists(currentYear, currentMonth, 'shockwave');
    loadMonthlyTherapists(currentYear, currentMonth, 'manual_therapy');
  }, [currentYear, currentMonth, loadMonthlyTherapists]);

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
  }, [currentYear, currentMonth, onLoadMemos]);

  // ── 기존 40/60 셀에 누락된 처방 일괄 패치 ──
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
      const existingPrescription = String(memo?.prescription || '').trim();
      if (existingPrescription) return;
      const autoPres = get4060PrescriptionFromContent(content);
      if (!autoPres) return;
      fixEntries.push({ key, prescription: autoPres });
    });

    prescriptionPatchKeyRef.current = monthKey; // 패치 시도 표시 (빈 배열이어도)

    if (fixEntries.length === 0) return;

    (async () => {
      const bulkUpdates = fixEntries.map(({ key, prescription }) => {
        const [weekIndex, dayIndex, rowIndex, colIndex] = key.split('-').map(Number);
        return {
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
        };
      });
      const ok = await saveShockwaveMemosBulk(bulkUpdates);
      if (ok) {
        await onLoadMemos(currentYear, currentMonth);
      }
    })();
  }, [loadedMemosKey, currentYear, currentMonth, memos, saveShockwaveMemosBulk, onLoadMemos]);

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

  const applyImmediateCellDisplay = useCallback((updates) => {
    const entries = Array.isArray(updates) ? updates : [updates];
    const nextValues = {};
    entries.forEach((item) => {
      if (!item) return;
      const key = item.key || `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
      if (!key || key.includes('undefined')) return;
      nextValues[key] = String(item.content ?? '');
    });
    if (Object.keys(nextValues).length === 0) return;
    
    setPendingDisplayValues((prev) => ({ ...prev, ...nextValues }));
    setEditingCell(null);
    setContextMenu(null);
  }, []);

  const clearImmediateCellDisplay = useCallback((updates) => {
    const entries = Array.isArray(updates) ? updates : [updates];
    const keys = entries
      .map((item) => item?.key || `${item?.week_index}-${item?.day_index}-${item?.row_index}-${item?.col_index}`)
      .filter((key) => key && !key.includes('undefined'));
    if (keys.length === 0) return;
    
    setTimeout(() => {
      setPendingDisplayValues((prev) => {
        let changed = false;
        const next = { ...prev };
        keys.forEach((key) => {
          if (key in next) {
            delete next[key];
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 2000);
  }, []);

  const {
    buildMemoSnapshotForKeys,
    doUndo,
    recordUndo,
  } = useScheduleUndoActions({
    applyImmediateCellDisplay,
    clearImmediateCellDisplay,
    currentMonth,
    currentYear,
    memos,
    onSaveMemo,
    pendingDisplayValues,
    saveShockwaveMemosBulk,
    setContextMenu,
    setEditingCell,
  });

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
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
  }, [doUndo, contextMenu]);

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
    memos,
  });

  const scheduleEditDraftAutosave = useCallback((key, value) => {
    const { year, month } = scheduleDateRef.current;
    rememberPendingScheduleDraft(year, month, key, value ?? '');
    setPendingDisplayValues((prev) => ({ ...prev, [key]: value ?? '' }));
    editDraftRef.current = { key, value: value ?? '', dirty: true };
    // DB 저장은 handleCellSave(편집 완료 시)에서 처방 정보와 함께 수행.
    // 여기서 미리 저장하면 처방 없이 저장되어 노란색 '처방 없음'이 잠깐 보이는 문제 발생.
    if (editAutosaveTimerRef.current) {
      clearTimeout(editAutosaveTimerRef.current);
      editAutosaveTimerRef.current = null;
    }
  }, []);

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

  const selectSingleCell = useCallback((cell) => {
    const normalizedCell = normalizeCellToMergeMaster(cell);
    const key = cellKey(normalizedCell.w, normalizedCell.d, normalizedCell.r, normalizedCell.c);
    setSelectedCell(normalizedCell);
    setRangeEnd(null);
    setSelectedKeys(new Set([key]));
    viewRef.current?.focus({ preventScroll: true });
  }, [cellKey, normalizeCellToMergeMaster]);

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
      dragSelectionRef.current = null;
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
  }, [selectedCell, editingCell, editValue, buildRangeKeys, selectSingleCell, normalizeCellToMergeMaster, cellKey]);

  const handleCellMouseEnter = useCallback((w, d, r, c) => {
    if (!dragSelectionRef.current) return;
    updateDraggedSelection({ w, d, r, c });
  }, [updateDraggedSelection]);

  // ── 더블 클릭 = 편집 모드 진입 ──
  const handleCellDoubleClick = useCallback((w, d, r, c, content) => {
    selectSingleCell({ w, d, r, c });
    const key = cellKey(w, d, r, c);
    flushSync(() => {
      setEditingCell(key);
      setEditValue(content || '');
    });
    if (editInputRef.current) {
      editInputRef.current.value = content || '';
    }
  }, [selectSingleCell, cellKey]);

  // ── 편집 저장 ──
  const handleCellSave = useCallback(async (w, d, r, c, nextValue) => {
    const finalValue = nextValue !== undefined ? nextValue : (editInputRef.current?.value ?? editValue);
    const key = cellKey(w, d, r, c);
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
    const result = await buildSchedulerAutoText(w, d, r, c, finalValue, false, editValue);
    const newContent = normalizeSchedulerVisitSuffix(
      normalize4060StarOrder(typeof result === 'string' ? result : (result?.text || ''))
    );
    let newPrescription = result?.prescription;
    const newBodyPart = result?.bodyPart;
    const newMergeSpan = result?.mergeSpan ? stripReservationTimeFromMergeSpan(result.mergeSpan) : undefined;

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

    const prescriptionChanged = (newPrescription !== undefined && newPrescription !== null && memos[key]?.prescription !== newPrescription);
    if (newContent === oldContent && !newPrescription && !newBodyPart && !prescriptionChanged) {
      setPendingDisplayValues((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    setPendingDisplayValues((prev) => ({ ...prev, [key]: newContent }));
    rememberPendingScheduleDraft(currentYear, currentMonth, key, newContent);
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
    const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, newContent, undefined, newMergeSpan, newPrescription, newBodyPart);
    if (success) removePendingScheduleDraftIfValue(currentYear, currentMonth, key, newContent);
    // pendingDisplayValues는 즉시 삭제하지 않음.
    // memos 컨텍스트가 새 값을 반영할 때까지 유지하여 깜빡임 방지.
    // 아래 useEffect(cleanupStalePendingValues)에서 memos 업데이트 후 자동 정리.
    if (!success) addToast('저장 실패', 'error');
  }, [editValue, currentYear, currentMonth, memos, onSaveMemo, addToast, buildSchedulerAutoText, recordUndo, cellKey]);

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
    memos,
    selectSingleCell,
    setActiveContextSubmenu,
    setContextMenu,
    setContextMenuBodyInput,
    setContextMenuBodyPartOptions,
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
    memos,
    pendingDisplayValues,
    selectedKeys,
    cellKey,
    computeSelectionInfo,
    saveShockwaveMemosBulk,
    recordUndo,
    applyImmediateCellDisplay,
    clearImmediateCellDisplay,
    addToast,
    setContextMenu,
  });

  const selectionInfo = computeSelectionInfo();
  const {
    effectivePrescriptionColors,
    effectiveSchedulerTextSettings,
    hasCompletableSelection,
    hasCompletedSelection,
    shortcutLabels,
    treatmentCompleteButtonLabel,
  } = useScheduleViewState({
    currentMonth,
    currentYear,
    memos,
    normalizeKeysToMergeMasters,
    selectedKeys,
    settings,
    treatmentCompleteBg: TREATMENT_COMPLETE_BG,
  });

  const getAdjacentCell = useCallback((cell, direction) => {
    let { w, d, r, c } = cell;

    if (direction === 'ArrowLeft') {
      if (c > 0) return { w, d, r, c: c - 1 };
      if (d > 0) return { w, d: d - 1, r, c: colCount - 1 };
      if (w > 0) return { w: w - 1, d: weeks[w - 1].length - 1, r, c: colCount - 1 };
      return cell;
    }

    if (direction === 'ArrowRight') {
      if (c < colCount - 1) return { w, d, r, c: c + 1 };
      if (d < weeks[w].length - 1) return { w, d: d + 1, r, c: 0 };
      if (w < weeks.length - 1) return { w: w + 1, d: 0, r, c: 0 };
      return cell;
    }

    if (direction === 'ArrowUp') {
      if (r > 0) return { w, d, r: r - 1, c };
      if (w > 0) return { w: w - 1, d, r: baseTimeSlots.length - 1, c };
      return cell;
    }

    if (direction === 'ArrowDown') {
      if (r < baseTimeSlots.length - 1) return { w, d, r: r + 1, c };
      if (w < weeks.length - 1) return { w: w + 1, d, r: 0, c };
      return cell;
    }

    return cell;
  }, [baseTimeSlots.length, colCount, weeks]);

  const {
    handleCopySelection,
    handleCutSelection,
    handlePasteSelection,
  } = useScheduleClipboardActions({
    selectedCell,
    selectedCellRef,
    selectionInfo,
    memos,
    clipboardRef,
    clipboardSource,
    setClipboardSource,
    currentYear,
    currentMonth,
    baseTimeSlotsLength: baseTimeSlots.length,
    colCount,
    cellKey,
    buildSchedulerAutoText,
    saveShockwaveMemosBulk,
    recordUndo,
    addToast,
    setContextMenu,
  });

  const {
    handleToggleTreatmentComplete,
    handleToggleTreatmentCancel,
    handleToggleHolidayBackground,
  } = useScheduleStatusActions({
    selectedKeys,
    memos,
    currentYear,
    currentMonth,
    normalizeKeysToMergeMasters,
    cellKey,
    saveShockwaveMemosBulk,
    addToast,
    recordUndo,
    setContextMenu,
  });

  const {
    fetchPatientHistory,
    handleUpdateLogVisitCount,
    handleOpenPatientHistoryModal,
    handleApplyHistoryToCell,
  } = usePatientHistoryActions({
    currentYear,
    currentMonth,
    holidays,
    selectedCell,
    editingCell,
    editValue,
    editInputRef,
    memos,
    pendingDisplayValues,
    baseTimeSlotsLength: baseTimeSlots.length,
    colCount,
    cellKey,
    saveShockwaveMemosBulk,
    addToast,
    setPendingDisplayValues,
    setPatientHistoryModalOpen,
    setPatientHistoryModalData,
  });

  const handleContextAction = useScheduleContextMenuActions({
    selectedKeys,
    contextMenu,
    memos,
    pendingDisplayValues,
    currentYear,
    currentMonth,
    onSaveMemo,
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
  });

  const submitContextMenuBodyInput = useCallback(() => {
    const val = contextMenuBodyInput.trim();
    if (!val) return false;
    handleContextAction({ type: 'bodyPartAdd', value: val });
    setContextMenuBodyInput('');
    return true;
  }, [contextMenuBodyInput, handleContextAction]);

  const submitContextMenuNoteInput = useCallback(() => {
    const val = contextMenuNoteInput.trim();
    if (!val) return false;
    handleContextAction({ type: 'memoAdd', value: val });
    setContextMenuNoteInput('');
    return true;
  }, [contextMenuNoteInput, handleContextAction]);

  const submitContextMenuVisitInput = useCallback(() => {
    const val = normalizeVisitInputValue(contextMenuVisitInput);
    setContextMenuVisitInput(val);
    handleContextAction({ type: 'visitCount', value: val });
    return true;
  }, [contextMenuVisitInput, handleContextAction]);

  const stepContextMenuVisitInput = useCallback((delta) => {
    const nextValue = stepVisitInputValue(contextMenuVisitInput, delta);
    setContextMenuVisitInput(nextValue);
    handleContextAction({ type: 'visitCount', value: nextValue });
  }, [contextMenuVisitInput, handleContextAction]);

  const focusEditInputImmediately = useCallback(() => {
    const input = editInputRef.current;
    if (!input) return;
    input.focus();
    if (!imeOpenRef.current && document.activeElement === input) {
      const len = input.value?.length || 0;
      input.setSelectionRange(len, len);
    }
  }, []);

  const beginEditingCell = useCallback((key, nextValue, preserveValue = false) => {
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
    const memo = memos[keyStr] || {};
    
    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 2;
    
    let targetKeyStr = keyStr;
    const mergeSpan = getEffectiveMergeSpan(keyStr, memos);
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
  }, [selectedCell, cellKey, memos, handleCellContextMenu, setActiveContextSubmenu, setContextMenu]);

  const handleKeyDown = useScheduleKeyboardActions({
    contextMenu,
    selectedCell,
    editingCell,
    selectedKeys,
    pendingDisplayValues,
    applyImmediateCellDisplay,
    currentYear,
    currentMonth,
    memos,
    shockwaveSettings: settings,
    imeOpenRef,
    cellKey,
    colCount,
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
    onSaveMemo,
    recordUndo,
    addToast,
    setEditingCell,
    setRangeEnd,
    setSelectedKeys,
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
        if (editInputRef.current) {
          editInputRef.current.focus();
          if (!imeOpenRef.current && document.activeElement === editInputRef.current) {
            const len = editInputRef.current.value?.length || 0;
            editInputRef.current.setSelectionRange(len, len);
          }
        }
      });
    });
  }, [editingCell]);

  useEffect(() => {
    if (!selectedCell || editingCell) return;
    if (isEditableTarget(document.activeElement)) return;
    requestAnimationFrame(() => {
      const input = editInputRef.current;
      if (!input || !input.dataset.hiddenInput) return;
      input.focus();
    });
  }, [selectedCell, editingCell, isEditableTarget]);

  // 편집 완료 후 아래로 이동
  const handleEditKeyDown = useCallback((e, w, d, r, c) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const { selectionStart, selectionEnd, value } = e.target;
      
      // If Left arrow, let it move cursor if not at the beginning
      if (e.key === 'ArrowLeft' && (selectionStart > 0 || selectionEnd > 0)) {
        return; // default behavior moves cursor left
      }
      // If Right arrow, let it move cursor if not at the end
      if (e.key === 'ArrowRight' && (selectionStart < value.length || selectionEnd < value.length)) {
        return; // default behavior moves cursor right
      }

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
  }, [baseTimeSlots.length, colCount, selectSingleCell, getAdjacentCell]);

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

  const {
    todayWeekIdx,
    scrollToTodayWeek,
    updateTodayShortcutTooltip,
  } = useScheduleTodayNavigation({
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
  const renderMemos = isScheduleMonthLoading ? {} : memos;

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
              <div className="shockwave-week-floating-actions shockwave-week-floating-actions--right">
                <button
                  type="button"
                  className="shockwave-week-today-btn"
                  onClick={() => setShowTherapistConfig(true)}
                >
                  설정
                </button>
              </div>
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
                        const cellData = dayInfo.isCurrentMonth ? renderMemos[key] : null;
                        const content = dayInfo.isCurrentMonth ? normalizeSchedulerVisitSuffix(pendingDisplayValues[key] ?? cellData?.content ?? '') : '';
                        let mergeSpan = dayInfo.isCurrentMonth ? getEffectiveMergeSpan(key, renderMemos) : { rowSpan: 1, colSpan: 1, mergedInto: null };

                        const cellPrescription = cellData?.prescription || mergeSpan?.meta?.prescription || '';
                        const displayData = buildSchedulerCellDisplay(content, mergeSpan);
                          
                          if (mergeSpan.mergedInto) {
                            continue; // 병합된 하위 셀은 묶어서 렌더링 생략
                          }

                          const isEditing = dayInfo.isCurrentMonth && editingCell === key;
                          const isImePreview = dayInfo.isCurrentMonth && imePreviewCell === key;
                          const isSelected = dayInfo.isCurrentMonth && selectedKeys.has(key);
                          const isPrimary = dayInfo.isCurrentMonth && selectedCell && selectedCell.w === weekIdx && selectedCell.d === dayIdx && selectedCell.r === rowIdx && selectedCell.c === colIdx;
                          const gridColumnStart = showTimeCol ? colIdx + 2 : colIdx + 1;

                          // View Span Calculation
                          let visualRowSpan = 1;
                          if (mergeSpan.rowSpan > 1) {
                            const endRowIdx = rowIdx + mergeSpan.rowSpan - 1;
                            visualRowSpan = daySlots.filter(s => s.idx >= rowIdx && s.idx <= endRowIdx).length;
                          }
                          mergeSpan.rowSpan = visualRowSpan; // Adjust for the MemoizedCell

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
                              cellData={cellData} pendingContent={content} mergeSpan={mergeSpan}
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
        weeks, dayColWidth, todayWeekIdx, showTherapistConfig, today, getTimeSlotsForDay,
        therapistColsCSS, colCount, getTherapistNameForDate, activeColRatios,
        startColResize, startDayResize, startRowResize,
        renderMemos, pendingDisplayValues, editingCell, imePreviewCell,
        selectedKeys, selectedCell, clipboardSource,
        getTherapistWorkState, getStaffScheduleBlockForCell,
        isLastHourSlot, effectivePrescriptionColors, editValue,
        handleCellMouseDown, handleCellMouseEnter, setHoverCell,
        handleCellDoubleClick, handleCellContextMenu,
        handleEditKeyDown, scheduleEditDraftAutosave, promoteFocusedInputToEditor, handleCellSave
      ])}
      </div>
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className={`shockwave-context-menu ${contextMenu.isNearRightEdge ? 'submenu-pop-left' : ''} ${contextMenu.isStandaloneBodyPart ? 'standalone-mode' : ''}`}
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
            const firstKey = selectedKeys ? Array.from(selectedKeys)[0] : null;
            const baseMemo = firstKey ? (renderMemos[firstKey] || {}) : {};
            const currentMemo = (firstKey && contextMenu?.memoSnapshot) 
              ? { ...baseMemo, ...contextMenu.memoSnapshot } 
              : baseMemo;
            const currentPrescription = currentMemo?.prescription || '';
            const currentBodyPart = currentMemo?.body_part || '';
            const currentParts = splitBodyParts(currentBodyPart);
            const { patientChart, patientName } = parseSchedulerPatientIdentity(currentMemo?.content || '');
            const currentKeyParts = firstKey ? firstKey.split('-').map(Number) : null;
            const currentSortKey = currentKeyParts
              ? buildSchedulerMemoSortKey(firstKey, weeks)
              : '';
            let previousPrescription = null;

            const patientBodyPartsMap = new Map();
            Object.entries(renderMemos || {}).forEach(([memoKey, m]) => {
              if (!m?.content) return;
              const { patientChart: mChart, patientName: mName } = parseSchedulerPatientIdentity(m.content);
              const isMatch = (patientChart && mChart && patientChart === mChart) || (patientName && mName && patientName === mName);
              if (isMatch) {
                if (m.body_part) {
                  splitBodyParts(m.body_part).forEach((part) => addBodyPartToMap(patientBodyPartsMap, part));
                }
                if (!m.prescription || memoKey === firstKey) return;
                const memoSortKey = buildSchedulerMemoSortKey(memoKey, weeks);
                if (memoSortKey < currentSortKey && (!previousPrescription || memoSortKey > previousPrescription.sortKey)) {
                  previousPrescription = { value: m.prescription, sortKey: memoSortKey };
                }
              }
            });
            currentParts.forEach((part) => addBodyPartToMap(patientBodyPartsMap, part));
            const availablePartsMap = new Map();
            contextMenuBodyPartOptions.forEach((part) => addBodyPartToMap(availablePartsMap, part));
            Array.from(patientBodyPartsMap.values()).forEach((part) => addBodyPartToMap(availablePartsMap, part));
            const availableParts = Array.from(availablePartsMap.values()).sort((a, b) => a.localeCompare(b, 'ko'));
            const previousPrescriptionValue = previousPrescription?.value || '';
            const shockwavePrescriptions = Array.isArray(settings?.prescriptions)
              ? settings.prescriptions.filter(Boolean)
              : [];
            const manualTherapyPrescriptions = Array.isArray(settings?.manual_therapy_prescriptions)
              ? settings.manual_therapy_prescriptions.filter((pres) => pres && !shockwavePrescriptions.includes(pres))
              : [];

            return (
              <>
                <button
                  type="button"
                  className="context-menu-item"
                  data-shortcut-tooltip={`복사 ${shortcutLabels.copy}`}
                  onClick={() => handleContextAction('copy')}
                >
                  복사
                </button>
                <button
                  type="button"
                  className="context-menu-item"
                  data-shortcut-tooltip={`잘라내기 ${shortcutLabels.cut}`}
                  onClick={() => handleContextAction('cut')}
                >
                  잘라내기
                </button>
                <button
                  type="button"
                  className="context-menu-item"
                  data-shortcut-tooltip={`붙여넣기 ${shortcutLabels.paste}`}
                  onClick={() => handleContextAction('paste')}
                >
                  붙여넣기
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
                    셀 병합
                  </button>
                ) : (
                  <button
                    type="button"
                    className="context-menu-item"
                    data-shortcut-tooltip={`병합 해제 ${shortcutLabels.merge}`}
                    onClick={() => handleContextAction('unmerge')}
                  >
                    병합 해제
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
                  {treatmentCompleteButtonLabel}
                </button>
                <button
                  type="button"
                  className="context-menu-item context-menu-item-clear-complete"
                  data-shortcut-tooltip={`예약 취소 ${shortcutLabels.cancel}`}
                  onClick={() => handleContextAction('cancel-toggle')}
                  disabled={!hasCompletableSelection}
                >
                  예약 취소
                </button>
                <div className="context-menu-divider" />

                <div className="context-menu-meta-section">
                  <div className="context-menu-item context-menu-item-inline-edit context-menu-meta-item" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} style={{ cursor: 'default' }}>
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
                              const baseTime = contextMenu.defaultReservationTime || getDefaultReservationTime(
                                contextMenu.weekIdx,
                                contextMenu.dayIdx,
                                contextMenu.rowIdx
                              );
                              const nextTime = stepReservationTimeWithinCellBase(
                                contextMenuReservationInput,
                                baseTime,
                                e.key === 'ArrowUp' ? 10 : -10
                              );
                              setContextMenuReservationInput(nextTime);
                              handleContextAction({ type: 'reservationTime', value: nextTime });
                            }
                          }}
                          onMouseDown={e => e.stopPropagation()}
                          onClick={e => e.stopPropagation()}
                        />
                        <span className="context-menu-time-stepper">
                          <button
                            type="button"
                            className="context-menu-time-step"
                            aria-label="현재 셀 기준 예약시간 10분 증가"
                            onMouseDown={e => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              const baseTime = contextMenu.defaultReservationTime || getDefaultReservationTime(
                                contextMenu.weekIdx,
                                contextMenu.dayIdx,
                                contextMenu.rowIdx
                              );
                              const nextTime = stepReservationTimeWithinCellBase(contextMenuReservationInput, baseTime, 10);
                              setContextMenuReservationInput(nextTime);
                              handleContextAction({ type: 'reservationTime', value: nextTime });
                            }}
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            className="context-menu-time-step"
                            aria-label="현재 셀 기준 예약시간 10분 감소"
                            onMouseDown={e => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              const baseTime = contextMenu.defaultReservationTime || getDefaultReservationTime(
                                contextMenu.weekIdx,
                                contextMenu.dayIdx,
                                contextMenu.rowIdx
                              );
                              const nextTime = stepReservationTimeWithinCellBase(contextMenuReservationInput, baseTime, -10);
                              setContextMenuReservationInput(nextTime);
                              handleContextAction({ type: 'reservationTime', value: nextTime });
                            }}
                          >
                            ▼
                          </button>
                        </span>
                      </span>
                    </label>
                  </div>

                  <div
                    className={`context-menu-item has-submenu context-menu-meta-item${activeContextSubmenu === 'prescription' ? ' is-submenu-open' : ''}`}
                    onMouseEnter={() => setActiveContextSubmenu('prescription')}
                    onFocusCapture={() => setActiveContextSubmenu('prescription')}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      처방 : {currentPrescription || '없음'}
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
                    className={`context-menu-item has-submenu context-menu-meta-item${activeContextSubmenu === 'body' ? ' is-submenu-open' : ''}`}
                    onMouseEnter={() => setActiveContextSubmenu('body')}
                    onFocusCapture={() => setActiveContextSubmenu('body')}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      부위 : {currentParts.join(', ') || '없음'}
                    </span>
                    <div className="context-menu-submenu">
                      <div className="context-menu-editor-panel">
                        <div className="context-menu-inline-column">
                          <div className="context-menu-body-dropdown">
                          <div
                            className="context-menu-body-panel"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {availableParts.length > 0 ? (
                              <div className="context-menu-checklist">
                                {availableParts.map((part, idx) => {
                                  const partKey = normalizeBodyPartKey(part);
                                  const isChecked = currentParts.some((p) => normalizeBodyPartKey(p) === partKey);
                                  return (
                                    <div key={idx} className={`context-menu-check-item${isChecked ? ' is-checked' : ''}`}>
                                      <label className="context-menu-check-label">
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={(e) => {
                                            e.stopPropagation();
                                            handleContextAction({ type: 'bodyPartToggle', value: part });
                                          }}
                                          onMouseDown={e => e.stopPropagation()}
                                          onClick={e => e.stopPropagation()}
                                        />
                                        <span>{part}</span>
                                      </label>
                                      <button
                                        type="button"
                                        className="context-menu-body-delete"
                                        title={`${part} 삭제`}
                                        onMouseDown={e => e.stopPropagation()}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          handleContextAction({ type: 'bodyPartDeleteValue', value: part });
                                          setContextMenuBodyPartOptions((prev) => prev.filter((item) => normalizeBodyPartKey(item) !== normalizeBodyPartKey(part)));
                                        }}
                                      >
                                        ×
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : currentParts.length === 0 ? (
                              <div className="context-menu-empty">등록된 부위가 없습니다.</div>
                            ) : null}
                            <ContextMenuLocalInputGroup
                              placeholder="새 부위 추가"
                              buttonLabel="추가"
                              autoFocus={true}
                              onSubmit={(val) => {
                                handleContextAction({ type: 'bodyPartAdd', value: val });
                              }}
                              imeOpenRef={imeOpenRef}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="context-menu-item" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => {
                  e.stopPropagation();
                  setContextMenu(null);
                  handleOpenPatientHistoryModal();
                }}>
                  <div className="context-menu-label" style={{ fontWeight: 600, color: 'var(--brand-primary)' }}>
                    🔍 환자 내역 검색 (Cmd+F)
                  </div>
                </div>

                <div className="context-menu-item context-menu-item-inline-edit context-menu-meta-item" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} style={{ cursor: 'default' }}>
                  <label className="context-menu-visit-editor" style={{ width: '100%', margin: 0, padding: 0 }}>
                    <span style={{ flexShrink: 0, width: '40px' }}>회차 :</span>
                    <span className="context-menu-visit-control" style={{ flexGrow: 1 }}>
                      <ContextMenuLocalInput
                        inputMode="numeric"
                        pattern="[0-9*-]*"
                        className="context-menu-visit-input"
                        value={contextMenuVisitInput}
                        onChange={(val) => {
                          setContextMenuVisitInput(val.replace(/[^\d*-]/g, ''));
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
                      <span className="context-menu-visit-stepper">
                        <button
                          type="button"
                          className="context-menu-visit-step"
                          aria-label="회차 증가"
                          onMouseDown={e => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            stepContextMenuVisitInput(1);
                          }}
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          className="context-menu-visit-step"
                          aria-label="회차 감소"
                          onMouseDown={e => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            stepContextMenuVisitInput(-1);
                          }}
                        >
                          ▼
                        </button>
                      </span>
                    </span>
                  </label>
                </div>

                <div
                  className={`context-menu-item has-submenu context-menu-meta-item${activeContextSubmenu === 'memo' ? ' is-submenu-open' : ''}`}
                  onMouseEnter={() => setActiveContextSubmenu('memo')}
                  onFocusCapture={() => setActiveContextSubmenu('memo')}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    메모 : {contextMenuMemoDrafts.length > 0 ? contextMenuMemoDrafts.join(', ') : '없음'}
                  </span>
                  <div className="context-menu-submenu">
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
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999999 }} onClick={() => setPatientHistoryModalOpen(false)}>
          <div style={{ background: 'var(--bg-primary, #fff)', maxWidth: 1000, width: '95%', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--border-color, #eee)', background: 'var(--bg-secondary, #f8f9fa)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>환자 스케줄 내역 검색</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-primary, #fff)', border: '1px solid var(--border-color, #ddd)', borderRadius: '6px', padding: '2px 8px' }}>
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary, #666)' }}>검색:</span>
                  <input 
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
              <button onClick={() => setPatientHistoryModalOpen(false)} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', padding: '0 4px', color: 'var(--text-secondary, #666)' }}>✕</button>
            </div>
            <div style={{ padding: '16px 20px', maxHeight: '70vh', overflowY: 'auto' }}>
              <div style={{ marginBottom: 16, fontSize: '1.05rem', fontWeight: 600 }}>
                검색 대상: <span style={{ color: 'var(--brand-primary)' }}>{patientHistoryModalData.searchName}</span> {patientHistoryModalData.searchChart ? `(${patientHistoryModalData.searchChart})` : ''}
              </div>
              
              <div className="sw-compact-table-wrap">
                <table className="sw-summary-table sw-compact-summary-table" style={{ width: '100%', margin: 0, tableLayout: 'fixed' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '12%', textAlign: 'center' }}>날짜</th>
                      <th style={{ width: '12%', textAlign: 'center' }}>차트</th>
                      <th style={{ width: '10%', textAlign: 'center' }}>이름</th>
                      <th style={{ width: '12%', textAlign: 'center' }}>처방</th>
                      <th style={{ width: '15%', textAlign: 'center' }}>부위</th>
                      <th style={{ width: '8%', textAlign: 'center' }}>회차</th>
                      <th style={{ width: '21%', textAlign: 'left' }}>메모</th>
                      <th style={{ width: '10%', textAlign: 'center' }}>선택</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patientHistoryModalData.loading ? (
                      <tr>
                        <td colSpan="8" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)' }}>내역을 불러오는 중...</td>
                      </tr>
                    ) : patientHistoryModalData.logs.length === 0 ? (
                      <tr>
                        <td colSpan="8" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)' }}>해당하는 내역이 없습니다.</td>
                      </tr>
                    ) : (
                      patientHistoryModalData.logs.map((log, idx) => (
                        <tr 
                          key={`${log.date}-${idx}`} 
                          onClick={() => handleApplyHistoryToCell(log)}
                          style={{ cursor: 'pointer', backgroundColor: log.id === 'draft' ? 'var(--bg-tertiary, #f0f7ff)' : undefined }}
                          title={log.id === 'draft' ? "현재 선택된 셀의 날짜를 기반으로 한 임시 항목입니다" : "클릭하여 내역을 현재 셀에 적용합니다"}
                        >
                          <td style={{ textAlign: 'center' }}>{log.date}{(log.id === 'draft' || log.isCurrentCell) && <span style={{fontSize: '0.75rem', color: 'var(--brand-primary)', display: 'block', marginTop: '2px'}}>현재 셀</span>}</td>
                          <td style={{ textAlign: 'center' }}>{log.chart_number}</td>
                          <td style={{ textAlign: 'center' }}>{log.patient_name}</td>
                          <td style={{ textAlign: 'center', color: log.type === 'manual' ? 'var(--brand-primary)' : 'inherit', fontWeight: log.type === 'manual' ? 600 : 400 }}>
                            {log.prescription}
                          </td>
                          <td style={{ textAlign: 'center' }}>{log.body_part}</td>
                          <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              value={log.visit_count || ''}
                              placeholder="-"
                              style={{ width: '40px', textAlign: 'center', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '2px', outline: 'none' }}
                              onChange={(e) => {
                                const val = e.target.value;
                                setPatientHistoryModalData(prev => ({
                                  ...prev,
                                  logs: prev.logs.map(l => l.id === log.id ? { ...l, visit_count: val } : l)
                                }));
                              }}
                              onBlur={(e) => {
                                const newVal = e.target.value;
                                if (newVal !== log._original_visit_count) {
                                  // Update original to prevent re-saving
                                  setPatientHistoryModalData(prev => ({
                                    ...prev,
                                    logs: prev.logs.map(l => l.id === log.id ? { ...l, _original_visit_count: newVal } : l)
                                  }));

                                  if (log.id === 'draft') {
                                    // 현재 선택된 셀을 위한 임시 항목이므로, 선택된 셀 업데이트
                                    handleApplyHistoryToCell({ ...log, visit_count: newVal });
                                  } else {
                                    // 특정 과거 날짜의 로그이므로, 선택된 셀 덮어쓰기를 하지 않고 DB와 해당 날짜의 셀만 업데이트
                                    handleUpdateLogVisitCount(log, newVal);
                                  }
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.target.blur(); // Trigger onBlur
                                }
                              }}
                            />
                          </td>
                          <td style={{ textAlign: 'left', color: 'var(--text-secondary)', fontSize: '0.85em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {log.memo}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button 
                              className="btn btn-primary" 
                              style={{ padding: '4px 12px', fontSize: '0.85rem', minHeight: 'unset', height: 'auto', borderRadius: '4px' }} 
                              onClick={(e) => { e.stopPropagation(); handleApplyHistoryToCell(log); }}
                            >
                              적용
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {(() => {
        let hoverTooltipText = '';
        if (hoverCell) {
          const { weekIdx, dayIdx, rowIdx, colIdx, staffBlockRule, slotInfo, selectionInfo, isMergedView } = hoverCell;
          const keyStr = cellKey(weekIdx, dayIdx, rowIdx, colIdx);
          const cellData = memos[keyStr] || {};
          const content = typeof pendingDisplayValues[keyStr] === 'string' ? pendingDisplayValues[keyStr] : cellData.content;
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
              if (content && content !== '\u200B') text += `\n👤 ${content}`;
            } else {
              const reservationTime = getReservationTimeForMemo(cellData, weekIdx, dayIdx, rowIdx);
              text = `⏱ ${reservationTime || slotInfo.label}`;
              if (content && content !== '\u200B') text += `\n👤 ${content}`;
            }
          } else {
            const reservationTime = getReservationTimeForMemo(cellData, weekIdx, dayIdx, rowIdx);
            text = `⏱ ${reservationTime || slotInfo.label}`;
            if (content && content !== '\u200B') text += `\n👤 ${content}`;
          }
          
          if (staffBlockRule) text += `\n근무표: ${staffBlockRule.keyword}`;
          if (cellPrescription) text += `\n💊 처방: ${cellPrescription}`;
          if (cellData?.body_part) text += `\n🦴 부위: ${cellData.body_part}`;
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

      {showTherapistConfig && (
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

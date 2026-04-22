import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useSchedule } from '../../contexts/ScheduleContext';
import { generateShockwaveCalendar, getTodayKST, isSameDate, formatDisplayDate } from '../../lib/calendarUtils';
import { supabase } from '../../lib/supabaseClient';
import { has4060Pattern, strip4060FromContent, incrementSessionCount, normalizeNameForMatch } from '../../lib/memoParser';
import { toProperCase } from '../../lib/shockwaveSyncUtils';
import { useToast } from '../common/Toast';
import MonthlyTherapistConfig from './MonthlyTherapistConfig';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const HORIZONTAL_BORDER_COLOR = '#b7b7b7';
const TIME_COL_WIDTH = 46;
const SHOCKWAVE_DAY_COL_WIDTH_KEY = 'shockwave-day-col-width';
const SHOCKWAVE_COL_RATIOS_KEY = 'shockwave-col-ratios';
const TREATMENT_COMPLETE_BG = '#ffe599';
const TREATMENT_CANCEL_BG = '#f4cccc';
const SCHEDULER_HOLIDAY_BG = '#93c47d';

function getManualDoseTag(prescription) {
  const pres = String(prescription || '');
  if (pres.includes('60')) return '60';
  if (pres.includes('40')) return '40';
  return '';
}

function buildManualNamePart(patientName, prescription) {
  const cleanName = String(patientName || '').replace(/\*/g, '').trim();
  const doseTag = getManualDoseTag(prescription);
  if (!cleanName) return doseTag || '';
  if (!doseTag || has4060Pattern(cleanName)) return cleanName;
  return `${cleanName}${doseTag}`;
}

function getSchedulerHistoryTypeLabel(option) {
  if (!option) return '';
  if (option.type === 'manual') {
    const doseTag = option.doseTag || getManualDoseTag(option.prescription);
    return doseTag ? `도수치료 ${doseTag}` : '도수치료';
  }
  return '충격파';
}

function splitBodyParts(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeBodyPartKey(part) {
  return String(part || '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatBodyPartInput(part) {
  return toProperCase(String(part || '').trim()).replace(/\s+/g, ' ').trim();
}

function dedupeList(values, normalizer = (value) => String(value || '').trim()) {
  const next = [];
  const seen = new Set();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = String(value || '').trim();
    if (!text) return;
    const key = normalizer(text);
    if (seen.has(key)) return;
    seen.add(key);
    next.push(text);
  });
  return next;
}

function parseSchedulerPatientIdentity(content) {
  const cellContent = String(content || '');
  let patientChart = '';
  let patientName = '';

  if (cellContent.includes('/')) {
    const parts = cellContent.split('/');
    const p0 = parts[0].trim();
    const p1 = (parts[1] || '').trim().replace(/\(\d+₩?\)$/, '').replace(/\*$/, '').trim();
    if (/\d/.test(p0)) {
      patientChart = p0;
      patientName = p1;
    } else {
      patientName = p0;
      patientChart = p1;
    }
  } else {
    patientName = cellContent.replace(/\(\d+₩?\)$/, '').replace(/\*$/, '').trim();
  }

  return { patientChart, patientName };
}

function getMemoListFromMergeSpan(mergeSpan) {
  const list = mergeSpan?.meta?.memo_list;
  if (!Array.isArray(list)) return [];
  return list.map((item) => String(item || '').trim()).filter(Boolean);
}

function buildMergeSpanWithMemoList(mergeSpan, memoList) {
  const base = mergeSpan || { rowSpan: 1, colSpan: 1, mergedInto: null };
  const nextList = Array.isArray(memoList)
    ? memoList.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const nextMeta = { ...(base.meta || {}) };
  if (nextList.length > 0) nextMeta.memo_list = nextList;
  else delete nextMeta.memo_list;

  const nextMergeSpan = { ...base };
  if (Object.keys(nextMeta).length > 0) nextMergeSpan.meta = nextMeta;
  else delete nextMergeSpan.meta;
  return nextMergeSpan;
}

function cloneMergeSpanWithMeta(mergeSpan, overrides = {}) {
  const base = mergeSpan || { rowSpan: 1, colSpan: 1, mergedInto: null };
  const next = { ...base, ...overrides };
  if (base.meta && typeof base.meta === 'object') {
    next.meta = { ...base.meta };
  }
  return next;
}

function buildSchedulerCellDisplay(content, mergeSpan) {
  const mainText = String(content || '').trim();
  const memoList = getMemoListFromMergeSpan(mergeSpan);
  const hasDisplayText = Boolean(mainText || memoList.length);
  return {
    mainText,
    hasDisplayText,
  };
}

function buildSchedulerMemoSortKey(memoKey, weeks) {
  const parts = String(memoKey || '').split('-').map(Number);
  if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) return '';
  const [w, d, r, c] = parts;
  const date = weeks?.[w]?.[d]?.date;
  const dateKey = date?.toISOString?.().slice(0, 10);
  if (!dateKey) return '';
  return `${dateKey}-${String(r).padStart(3, '0')}-${String(c).padStart(3, '0')}`;
}

function AutoFillDialogInner({ dlg, onConfirm, onCancel }) {
  const [localVisit, setLocalVisit] = useState(dlg.visitCount);
  const [localPres, setLocalPres] = useState(dlg.prescription || '');
  const [localBodyChecked, setLocalBodyChecked] = useState(() => {
    const latestParts = Array.isArray(dlg.initialBodyParts)
      ? dlg.initialBodyParts
      : splitBodyParts(dlg.initialBodyPart || dlg.latestBodyPart);
    return dedupeList(dlg.bodyParts, normalizeBodyPartKey).map(bp => ({
      name: bp,
      checked: latestParts.includes(bp),
    }));
  });
  const [localMemoList, setLocalMemoList] = useState(() => dedupeList(dlg.initialMemoList));
  const [newMemo, setNewMemo] = useState('');
  const [newBodyPart, setNewBodyPart] = useState('');

  const handleConfirm = useCallback(() => {
    const selectedParts = dedupeList(
      localBodyChecked.filter(bp => bp.checked).map(bp => bp.name),
      normalizeBodyPartKey
    );
    onConfirm({
      chartNumber: dlg.chartNumber,
      namePart: dlg.namePart,
      visitCount: localVisit,
      prescription: localPres || undefined,
      bodyPart: selectedParts.join(', ') || undefined,
      memoList: dedupeList(localMemoList),
    });
  }, [localBodyChecked, onConfirm, dlg, localVisit, localMemoList, localPres]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Enter') {
        // Ignore if typing a new body part
        if (document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'text' && document.activeElement.value.trim() !== '') {
          return;
        }
        e.preventDefault();
        handleConfirm();
      } else if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleConfirm, onCancel]);

  return (
    <div className="shockwave-chart-selector-backdrop" onMouseDown={() => onCancel()}>
      <div className="shockwave-chart-selector shockwave-chart-selector--compact" onMouseDown={(e) => e.stopPropagation()}>
        <div className="shockwave-chart-selector-head">
          <div className="shockwave-chart-selector-title">환자 정보 확인</div>
          <div className="shockwave-chart-selector-badge">{getSchedulerHistoryTypeLabel(dlg)}</div>
        </div>
        <div className="shockwave-chart-selector-subtitle shockwave-chart-selector-subtitle--compact">
          <strong>{dlg.chartNumber}</strong>
          <span>{dlg.cleanName}</span>
        </div>

        <div className="shockwave-chart-selector-grid">
          <div className="shockwave-chart-selector-field">
            <label className="shockwave-chart-selector-label">회차</label>
            <input
              type="number"
              value={localVisit}
              onChange={(e) => setLocalVisit(parseInt(e.target.value, 10) || 1)}
              min={1}
              className="shockwave-chart-selector-input shockwave-chart-selector-input--visit"
            />
          </div>
          <div className="shockwave-chart-selector-meta-strip">
            <span>부위 {localBodyChecked.filter((item) => item.checked).length}개</span>
            <span>메모 {localMemoList.length}개</span>
          </div>
        </div>

        <div className="shockwave-chart-selector-editor-grid">
          <div className="shockwave-chart-selector-editor-cell">
            <label className="shockwave-chart-selector-label">처방</label>
            <select
              value={localPres}
              onChange={(e) => setLocalPres(e.target.value)}
              className="shockwave-chart-selector-select"
            >
              <option value="">처방 없음</option>
              {dlg.settings?.prescriptions?.map((pres) => (
                <option key={pres} value={pres}>{pres}</option>
              ))}
            </select>
          </div>

          <div className="shockwave-chart-selector-editor-cell">
            <label className="shockwave-chart-selector-label">부위</label>
            <details className="shockwave-chart-selector-dropdown">
              <summary className="shockwave-chart-selector-dropdown-summary">
                {localBodyChecked.filter((item) => item.checked).map((item) => item.name).join(', ') || '부위 선택'}
              </summary>
              <div className="shockwave-chart-selector-dropdown-panel">
                {localBodyChecked.length > 0 ? (
                  <div className="shockwave-chart-selector-body-list">
                    {localBodyChecked.map((bp, idx) => (
                      <label key={idx} className={`shockwave-chart-selector-body-item${bp.checked ? ' is-checked' : ''}`}>
                        <span className="shockwave-chart-selector-body-toggle">
                          <input
                            type="checkbox"
                            checked={bp.checked}
                            onChange={() => {
                              setLocalBodyChecked((prev) => prev.map((item, i) => i === idx ? { ...item, checked: !item.checked } : item));
                            }}
                          />
                          <span>{bp.name}</span>
                        </span>
                        <button
                          type="button"
                          className="shockwave-chart-selector-remove"
                          onClick={() => setLocalBodyChecked(prev => prev.filter((_, i) => i !== idx))}
                        >삭제</button>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="shockwave-chart-selector-empty">기록된 부위가 없습니다</div>
                )}
                <div className="shockwave-chart-selector-add-row">
                  <input
                    type="text"
                    placeholder="새 부위 추가"
                    value={newBodyPart}
                    onChange={(e) => setNewBodyPart(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newBodyPart.trim()) {
                        e.preventDefault();
                        const nextPart = formatBodyPartInput(newBodyPart);
                        if (!nextPart) return;
                        setLocalBodyChecked(prev => (
                          dedupeList(
                            [...prev.map((item) => item.name), nextPart],
                            normalizeBodyPartKey
                          ).map((name) => ({
                            name,
                            checked: normalizeBodyPartKey(name) === normalizeBodyPartKey(nextPart) || prev.some((item) => normalizeBodyPartKey(item.name) === normalizeBodyPartKey(name) && item.checked),
                          }))
                        ));
                        setNewBodyPart('');
                      }
                    }}
                    className="shockwave-chart-selector-input"
                  />
                  <button
                    type="button"
                    className="shockwave-chart-selector-add"
                    onClick={() => {
                      if (!newBodyPart.trim()) return;
                      const nextPart = formatBodyPartInput(newBodyPart);
                      if (!nextPart) return;
                      setLocalBodyChecked(prev => [...prev, { name: nextPart, checked: true }]);
                      setNewBodyPart('');
                    }}
                  >추가</button>
                </div>
              </div>
            </details>
          </div>

          <div className="shockwave-chart-selector-editor-cell shockwave-chart-selector-editor-cell--full">
            <label className="shockwave-chart-selector-label">메모</label>
            <div className="shockwave-chart-selector-memo-box">
              {localMemoList.length > 0 ? (
                <div className="shockwave-chart-selector-note-list">
                  {localMemoList.map((item, index) => (
                    <div key={`${index}-${item}`} className="shockwave-chart-selector-note-row">
                      <input
                        type="text"
                        value={item}
                        onChange={(e) => {
                          const value = e.target.value;
                          setLocalMemoList((prev) => prev.map((memo, memoIndex) => memoIndex === index ? value : memo));
                        }}
                        className="shockwave-chart-selector-input"
                      />
                      <button
                        type="button"
                        className="shockwave-chart-selector-remove"
                        onClick={() => setLocalMemoList((prev) => prev.filter((_, memoIndex) => memoIndex !== index))}
                      >삭제</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="shockwave-chart-selector-empty">메모 없음</div>
              )}
              <div className="shockwave-chart-selector-add-row">
                <input
                  type="text"
                  placeholder="메모 추가"
                  value={newMemo}
                  onChange={(e) => setNewMemo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newMemo.trim()) {
                      e.preventDefault();
                      setLocalMemoList((prev) => dedupeList([...prev, newMemo.trim()]));
                      setNewMemo('');
                    }
                  }}
                  className="shockwave-chart-selector-input"
                />
                <button
                  type="button"
                  className="shockwave-chart-selector-add"
                  onClick={() => {
                    if (!newMemo.trim()) return;
                    setLocalMemoList((prev) => dedupeList([...prev, newMemo.trim()]));
                    setNewMemo('');
                  }}
                >추가</button>
              </div>
            </div>
          </div>
        </div>

        <div className="shockwave-chart-selector-actions shockwave-chart-selector-actions--compact">
          <button type="button" className="shockwave-chart-selector-cancel" onClick={() => onCancel()}>취소</button>
          <button
            type="button"
            className="shockwave-chart-selector-confirm"
            onClick={handleConfirm}
          >확인</button>
        </div>
      </div>
    </div>
  );
}

function addBodyPartToMap(map, part) {
  if (!part) return;
  const normalizedKey = normalizeBodyPartKey(part);
  if (!normalizedKey) return;
  const existing = map.get(normalizedKey);
  if (!existing) {
    map.set(normalizedKey, part);
  } else {
    const existingDotCount = (existing.match(/\./g) || []).length;
    const newDotCount = (part.match(/\./g) || []).length;
    const existingUpperCount = existing.length - existing.replace(/[A-Z]/g, '').length;
    const newUpperCount = part.length - part.replace(/[A-Z]/g, '').length;
    if (
      newDotCount > existingDotCount ||
      (newDotCount === existingDotCount && newUpperCount > existingUpperCount)
    ) {
      map.set(normalizedKey, part);
    }
  }
}

export default function ShockwaveView({ therapists, settings, memos = {}, onLoadMemos, onSaveMemo, holidays, staffMemos = {} }) {
  const { currentYear, currentMonth, navigateMonth, saveShockwaveMemosBulk, manualTherapists, monthlyTherapists, monthlyManualTherapists, loadMonthlyTherapists, saveMonthlyTherapists } = useSchedule();
  const { addToast } = useToast();
  const viewRef = useRef(null);
  const dragSelectionRef = useRef(null);
  const selectedCellRef = useRef(null);
  const [showTherapistConfig, setShowTherapistConfig] = useState(false);

  // ── 셀 조작 상태 (구글 시트 방식) ──
  const [selectedCell, setSelectedCell] = useState(null);     // { w, d, r, c }
  const [rangeEnd, setRangeEnd] = useState(null);             // { w, d, r, c } (Shift 선택 끝점)
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [editingCell, setEditingCell] = useState(null);       // "w-d-r-c" 키 문자열
  const [editSessionId, setEditSessionId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [pendingDisplayValues, setPendingDisplayValues] = useState({});
  const clipboardRef = useRef({ content: '', mode: null });   // mode: 'copy' | 'cut'
  const [clipboardSource, setClipboardSource] = useState(null); // { keys: Set, mode: 'copy'|'cut' }
  const [undoStack, setUndoStack] = useState([]);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, weekIdx, dayIdx, rowIdx, colIdx, currentPrescription }
  const [contextMenuBodyInput, setContextMenuBodyInput] = useState('');
  const [contextMenuNoteInput, setContextMenuNoteInput] = useState('');
  const [contextMenuMemoDrafts, setContextMenuMemoDrafts] = useState([]);

  useEffect(() => {
    selectedCellRef.current = selectedCell;
  }, [selectedCell]);

  // 열 너비 조정 (fr 비율 기반)
  const [colRatios, setColRatios] = useState(() => {
    if (typeof window === 'undefined') return null;
    try {
      const parsed = JSON.parse(window.localStorage.getItem(SHOCKWAVE_COL_RATIOS_KEY) || 'null');
      return Array.isArray(parsed) && parsed.every((v) => Number.isFinite(v) && v > 0) ? parsed : null;
    } catch {
      return null;
    }
  });
  const colResizeRef = useRef({ active: false, colIdx: -1, startX: 0, startRatios: [], containerWidth: 0 });
  const [dayColWidth, setDayColWidth] = useState(() => {
    if (typeof window === 'undefined') return null;
    const saved = Number(window.localStorage.getItem(SHOCKWAVE_DAY_COL_WIDTH_KEY));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  }); // null = flex, number = px
  const dayResizeRef = useRef({ active: false, startX: 0, startWidth: 0, factor: 1 });

  const tooltipRef = useRef(null);
  const tooltipMousePosRef = useRef({ x: 0, y: 0 });
  const weekRefs = useRef([]);
  const [hoverData, setHoverData] = useState(null);
  const [chartSelector, setChartSelector] = useState(null);
  const [autoFillDialog, setAutoFillDialog] = useState(null);
  const contextMenuRef = useRef(null);
  const editInputRef = useRef(null);
  const imeOpenRef = useRef(false);
  const undoStackRef = useRef([]);
  const undoQueueRef = useRef(Promise.resolve());

  const colCount = Math.max(1, therapists.length);

  // 월별 치료사 설정 로드 (충격파 + 도수치료)
  useEffect(() => {
    loadMonthlyTherapists(currentYear, currentMonth, 'shockwave');
    loadMonthlyTherapists(currentYear, currentMonth, 'manual_therapy');
  }, [currentYear, currentMonth, loadMonthlyTherapists]);

  // 날짜(day)별 치료사 이름 조회
  const getTherapistNameForDate = useCallback((slotIndex, day) => {
    if (!monthlyTherapists || monthlyTherapists.length === 0) {
      return therapists[slotIndex]?.name || '';
    }
    const match = monthlyTherapists.find(
      (t) => t.slot_index === slotIndex && day >= t.start_day && day <= t.end_day
    );
    if (match !== undefined) return match.therapist_name || '';
    return therapists[slotIndex]?.name || '';
  }, [monthlyTherapists, therapists]);
  const therapistShiftByDate = useMemo(() => {
    const map = {};

    Object.values(staffMemos || {}).forEach((item) => {
      if (!item?.content) return;

      const dateKey = `${item.year}-${item.month}-${item.day}`;
      const text = String(item.content).trim();
      if (!/pt\s*\//i.test(text)) return;

      const isNightShift = /야간\s*pt\s*\//i.test(text) || /^야\s*pt\s*\//i.test(text);
      const slashIndex = text.indexOf('/');
      if (slashIndex < 0) return;

      const names = text
        .slice(slashIndex + 1)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => part.split(/\s+/)[0])
        .map((part) => normalizeNameForMatch(part))
        .filter(Boolean);

      if (names.length === 0) return;
      if (!map[dateKey]) map[dateKey] = {};

      names.forEach((normalizedName) => {
        if (!map[dateKey][normalizedName]) {
          map[dateKey][normalizedName] = { hasPtShift: false, hasNightShift: false };
        }
        map[dateKey][normalizedName].hasPtShift = true;
        if (isNightShift) map[dateKey][normalizedName].hasNightShift = true;
      });
    });

    return map;
  }, [staffMemos]);

  const isLastHourSlot = useCallback((dayInfo, slotTime) => {
    if (!slotTime || !settings?.end_time) return false;

    const dateOverride = settings.date_overrides?.[dayInfo.dateStr] || null;
    const dayOverride = settings.day_overrides?.[dayInfo.dow] || {};
    const effectiveEnd = (dateOverride?.end_time || dayOverride.end_time || settings.end_time || '18:00:00').slice(0, 5);
    const [endHour, endMinute] = effectiveEnd.split(':').map(Number);
    const endTotal = endHour * 60 + endMinute;
    const [slotHour, slotMinute] = String(slotTime).split(':').map(Number);
    const slotTotal = slotHour * 60 + slotMinute;

    return slotTotal >= (endTotal - 60) && slotTotal < endTotal;
  }, [settings]);

  const getTherapistWorkState = useCallback((dateKey, name) => {
    if (!name) return false;
    const normalizedName = normalizeNameForMatch(name);
    const dayMap = therapistShiftByDate[dateKey] || {};
    const shiftInfo = dayMap[normalizedName];
    const hasAnyNightShift = Object.values(dayMap).some((item) => item?.hasNightShift);

    if (shiftInfo?.hasNightShift) return 'night';
    if (shiftInfo?.hasPtShift) return 'off';
    if (hasAnyNightShift) return 'early-leave';
    return 'normal';
  }, [therapistShiftByDate]);

  // ── 시간 슬롯 생성 ──
  const baseTimeSlots = useMemo(() => {
    if (!settings || !settings.start_time || !settings.end_time || !settings.interval_minutes) {
      return Array.from({ length: 31 }, (_, i) => ({ label: `Row ${i}`, time: '' }));
    }
    const start = new Date(`2000-01-01T${settings.start_time}`);
    const end = new Date(`2000-01-01T${settings.end_time}`);
    const interval = settings.interval_minutes;
    const slots = [];
    let current = new Date(start);
    while (current < end) {
      const hh = String(current.getHours()).padStart(2, '0');
      const mm = String(current.getMinutes()).padStart(2, '0');
      slots.push({ label: `${hh}:${mm}`, time: `${hh}:${mm}` });
      current = new Date(current.getTime() + interval * 60000);
    }
    return slots;
  }, [settings]);

  const getTimeSlotsForDay = useCallback((dayInfo) => {
    const dow = dayInfo.dow;
    const dateStr = dayInfo.dateStr;
    const dateOv = settings?.date_overrides?.[dateStr] || null;
    const dayOv = settings?.day_overrides?.[dow] || {};
    
    const dayStart = dateOv?.start_time || dayOv.start_time || (settings?.start_time?.substring(0, 5)) || '09:00';
    const dayEnd = dateOv?.end_time || dayOv.end_time || (settings?.end_time?.substring(0, 5)) || '18:00';
    
    const skipLunch = !dayInfo.isCurrentMonth || dayInfo.isHoliday;
    const noLunch = dateOv?.no_lunch === true || dayOv.no_lunch === true || skipLunch;
    
    const lunchStart = noLunch ? null : (dateOv?.lunch_start || dayOv.lunch_start || null);
    const lunchEnd = noLunch ? null : (dateOv?.lunch_end || dayOv.lunch_end || null);

    const result = [];
    let lunchAdded = false;

    baseTimeSlots.forEach((slot, idx) => {
      const t = slot.time;
      let isBeforeStart = t < dayStart;
      let isAfterEnd = t >= dayEnd;
      
      if (skipLunch) { // 공휴일이거나 다른 달 날짜인 경우 요일별 운영 시간 제약을 무시
        isBeforeStart = false;
        isAfterEnd = false;
      }

      const isLunch = lunchStart && lunchEnd && t >= lunchStart && t < lunchEnd;

      if (isLunch) {
        result.push({ ...slot, idx, disabled: true, isLunch: true });
      } else {
        result.push({ ...slot, idx, disabled: isBeforeStart || isAfterEnd, isLunch: false });
      }
    });
    return result;
  }, [baseTimeSlots, settings]);

  const today = getTodayKST();
  const weeks = useMemo(() => {
    return generateShockwaveCalendar(currentYear, currentMonth, holidays);
  }, [currentYear, currentMonth, holidays]);
  const todayWeekIdx = useMemo(
    () => weeks.findIndex((weekDays) => weekDays.some((dayInfo) => isSameDate(dayInfo.date, today))),
    [weeks, today]
  );

  const shouldAutoFormatSchedulerName = useCallback((value) => {
    const text = String(value || '').trim();
    if (!text) return false;
    if (text.includes('/')) return false;
    if (/[()*]/.test(text)) return false;
    if (has4060Pattern(text)) return false;
    if (/^(휴무|연차|반차|출근|퇴근|근무|야간|오전|오후)$/u.test(text)) return false;
    return true;
  }, []);

  const pickChartOption = useCallback((options, rawName) => {
    return new Promise((resolve) => {
      setChartSelector({ options, rawName, resolve });
    });
  }, []);

  const showAutoFillDialog = useCallback((dialogData) => {
    return new Promise((resolve) => {
      setAutoFillDialog({ ...dialogData, resolve });
    });
  }, []);

  const findLatestSchedulerMemoMeta = useCallback((targetCell, chartNumber, cleanName) => {
    const normalizedName = normalizeNameForMatch(cleanName);
    const currentSortKey = `${weeks[targetCell.w]?.[targetCell.d]?.date?.toISOString?.().slice(0, 10) || ''}-${String(targetCell.r).padStart(3, '0')}-${String(targetCell.c).padStart(3, '0')}`;
    let latestMatch = null;

    Object.entries(memos || {}).forEach(([memoKey, memo]) => {
      if (!memo?.content) return;
      const parts = memoKey.split('-').map(Number);
      if (parts.length !== 4) return;
      const sortKey = `${weeks[parts[0]]?.[parts[1]]?.date?.toISOString?.().slice(0, 10) || ''}-${String(parts[2]).padStart(3, '0')}-${String(parts[3]).padStart(3, '0')}`;
      if (!sortKey || sortKey >= currentSortKey) return;

      const parsed = parseSchedulerPatientIdentity(memo.content);
      const matchesChart = chartNumber && String(parsed.patientChart || '').trim() === String(chartNumber).trim();
      const matchesName = normalizedName && normalizeNameForMatch(parsed.patientName) === normalizedName;
      if (!matchesChart && !matchesName) return;

      const memoList = getMemoListFromMergeSpan(memo.merge_span);
      if (memoList.length === 0) return;

      if (!latestMatch || sortKey > latestMatch.sortKey) {
        latestMatch = {
          sortKey,
          mergeSpan: buildMergeSpanWithMemoList(memo.merge_span, memoList),
        };
      }
    });

    return latestMatch?.mergeSpan;
  }, [memos, weeks]);

  const handleAutoFillConfirm = useCallback((result) => {
    if (!autoFillDialog) return;
    autoFillDialog.resolve(result);
    setAutoFillDialog(null);
  }, [autoFillDialog]);

  const handleAutoFillCancel = useCallback(() => {
    if (!autoFillDialog) return;
    autoFillDialog.resolve(null);
    setAutoFillDialog(null);
  }, [autoFillDialog]);

  const parseSchedulerPatientText = useCallback((text) => {
    const raw = String(text || '').trim();
    if (!raw.includes('/')) return null;

    const match = raw.match(/^([^/]+)\/(.+?)(\((-|\d+)\)|\*)?$/);
    if (!match) return null;

    const chartNumber = String(match[1] || '').trim();
    const namePart = String(match[2] || '').trim();
    const suffixToken = match[3] || '';
    const suffixValue = match[4] || '';
    const cleanName = namePart.replace(/\(-\)/g, '').trim();
    const normalizedName = normalizeNameForMatch(cleanName);

    if (!chartNumber || !normalizedName) return null;

    return {
      chartNumber,
      rawName: namePart,
      cleanName,
      normalizedName,
      suffixToken,
      suffixValue,
    };
  }, []);

  const findSchedulerHistoryCandidates = useCallback((targetCell, rawInput) => {
    const normalizedInput = normalizeNameForMatch(rawInput);
    const exactInput = String(rawInput || '').trim();
    const currentSortKey = buildSchedulerMemoSortKey(`${targetCell.w}-${targetCell.d}-${targetCell.r}-${targetCell.c}`, weeks);
    const candidateMap = new Map();

    Object.entries(memos || {}).forEach(([memoKey, memo]) => {
      if (!memo?.content) return;
      const sortKey = buildSchedulerMemoSortKey(memoKey, weeks);
      if (!sortKey || (currentSortKey && sortKey >= currentSortKey)) return;

      const parsed = parseSchedulerPatientText(memo.content);
      if (!parsed?.chartNumber) return;

      const matchesChart = exactInput && parsed.chartNumber === exactInput;
      const matchesName = normalizedInput && parsed.normalizedName === normalizedInput;
      if (!matchesChart && !matchesName) return;

      const candidateKey = parsed.chartNumber;
      if (!candidateMap.has(candidateKey)) {
        candidateMap.set(candidateKey, {
          chartNumber: parsed.chartNumber,
          latestMemo: memo,
          latestParsed: parsed,
          latestSortKey: sortKey,
          bodyPartsMap: new Map(),
          prescriptions: new Set(),
        });
      }

      const candidate = candidateMap.get(candidateKey);
      if (sortKey > candidate.latestSortKey) {
        candidate.latestMemo = memo;
        candidate.latestParsed = parsed;
        candidate.latestSortKey = sortKey;
      }

      splitBodyParts(memo.body_part || '').forEach((part) => addBodyPartToMap(candidate.bodyPartsMap, part));
      if (memo.prescription) candidate.prescriptions.add(memo.prescription);
    });

    return Array.from(candidateMap.values())
      .map((candidate) => {
        const latestContent = String(candidate.latestMemo?.content || '').trim();
        const nextText = incrementSessionCount(latestContent) || latestContent;
        const incrementedParsed = parseSchedulerPatientText(nextText);
        const latestParsed = candidate.latestParsed;
        const latestMergeSpan = buildMergeSpanWithMemoList(
          candidate.latestMemo?.merge_span,
          getMemoListFromMergeSpan(candidate.latestMemo?.merge_span)
        );
        const lastVisit = parseInt(latestParsed?.suffixValue || '0', 10) || (latestParsed?.suffixToken === '*' ? 1 : 0);
        const nextVisit = parseInt(incrementedParsed?.suffixValue || '0', 10) || (lastVisit > 0 ? lastVisit + 1 : 1);

        return {
          chartNumber: candidate.chartNumber,
          namePart: incrementedParsed?.rawName || latestParsed?.rawName || '',
          cleanName: latestParsed?.cleanName || '',
          nextText,
          nextVisit,
          lastDate: candidate.latestSortKey.slice(0, 10),
          prescription: candidate.latestMemo?.prescription || '',
          prescriptions: Array.from(candidate.prescriptions),
          bodyParts: Array.from(candidate.bodyPartsMap.values()),
          latestBodyPart: candidate.latestMemo?.body_part || '',
          initialBodyParts: splitBodyParts(candidate.latestMemo?.body_part || ''),
          type: 'scheduler',
          doseTag: '',
          optionLabel: candidate.latestMemo?.prescription || '최근 스케줄',
          mergeSpan: latestMergeSpan,
        };
      })
      .sort((a, b) => {
        if (a.lastDate !== b.lastDate) return b.lastDate.localeCompare(a.lastDate);
        return b.nextVisit - a.nextVisit;
      });
  }, [memos, parseSchedulerPatientText, weeks]);

  const buildSchedulerAutoText = useCallback(async (w, d, r, c, nextValue) => {
    const rawName = String(nextValue || '').trim();
    if (!shouldAutoFormatSchedulerName(rawName)) return { text: rawName };

    const dayInfo = weeks[w]?.[d];
    if (!dayInfo) return { text: rawName };
    const targetDate = `${dayInfo.year}-${String(dayInfo.month).padStart(2, '0')}-${String(dayInfo.day).padStart(2, '0')}`;
    const memoKey = `${w}-${d}-${r}-${c}`;
    const currentBodyParts = splitBodyParts(memos[memoKey]?.body_part || '');

    const schedulerOptions = findSchedulerHistoryCandidates({ w, d, r, c }, rawName);
    if (schedulerOptions.length > 0) {
      const selected = schedulerOptions.length === 1
        ? schedulerOptions[0]
        : await pickChartOption(schedulerOptions, rawName);
      if (!selected) return { text: rawName };
      const autoPrescription = has4060Pattern(selected.nextText) ? undefined : (selected.prescription || undefined);

      return {
        text: selected.nextText,
        prescription: autoPrescription,
        bodyPart: selected.latestBodyPart || undefined,
        mergeSpan: selected.mergeSpan,
      };
    }

    // Supabase에서 shockwave와 manual_therapy 모두 조회
    const normalizedName = normalizeNameForMatch(rawName);
    const cleanDisplayName = String(rawName).replace(/\(-\)/g, '').trim();

    const [shockwaveRes, manualRes, shockwaveBpRes, manualBpRes] = await Promise.all([
      supabase.from('shockwave_patient_logs')
        .select('patient_name, chart_number, visit_count, date, prescription, body_part')
        .lte('date', targetDate)
        .order('date', { ascending: false })
        .limit(200),
      supabase.from('manual_therapy_patient_logs')
        .select('patient_name, chart_number, visit_count, date, prescription, body_part')
        .lte('date', targetDate)
        .order('date', { ascending: false })
        .limit(200),
      supabase.from('shockwave_patient_logs')
        .select('body_part')
        .not('body_part', 'is', null)
        .limit(500),
      supabase.from('manual_therapy_patient_logs')
        .select('body_part')
        .not('body_part', 'is', null)
        .limit(500),
    ]);

    const allData = [
      ...(shockwaveRes.data || []).map(d => ({ ...d, type: 'shockwave' })),
      ...(manualRes.data || []).map(d => ({ ...d, type: 'manual' })),
    ];

    const matches = allData.filter((item) => {
      const matchName = normalizeNameForMatch(item.patient_name) === normalizedName;
      const matchChart = String(item.chart_number || '').trim() === rawName;
      return matchName || matchChart;
    });

    if (matches.length === 0) return { text: rawName };

    matches.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (parseInt(b.visit_count || '0', 10) || 0) - (parseInt(a.visit_count || '0', 10) || 0);
    });

    // 같은 환자여도 충격파/도수40/도수60 이력이 함께 있을 수 있으므로
    // 자동완성 후보를 차트번호 + 이력유형 단위로 분리한다.
    const candidateMap = new Map();
    matches.forEach((item) => {
      const chartNumber = String(item.chart_number || '').trim();
      if (!chartNumber) return;
      const doseTag = item.type === 'manual' ? getManualDoseTag(item.prescription) : '';
      const candidateKey = `${chartNumber}__${item.type}__${doseTag || 'default'}`;
      if (!candidateMap.has(candidateKey)) {
        candidateMap.set(candidateKey, {
          chartNumber,
          type: item.type,
          doseTag,
          latestItem: item,
          bodyPartsMap: new Map(),
          bodyPartVisitMap: new Map(),
          prescriptions: new Set(),
        });
      }
      const candidate = candidateMap.get(candidateKey);
      const itemVisit = parseInt(item.visit_count || '0', 10) || 0;
      const latestVisit = parseInt(candidate.latestItem?.visit_count || '0', 10) || 0;
      if (
        !candidate.latestItem ||
        item.date > candidate.latestItem.date ||
        (item.date === candidate.latestItem.date && itemVisit > latestVisit)
      ) {
        candidate.latestItem = item;
      }
      if (item.body_part) {
        splitBodyParts(item.body_part).forEach((part) => {
          addBodyPartToMap(candidate.bodyPartsMap, part);
          const normalizedPartKey = normalizeBodyPartKey(part);
          const itemVisit = parseInt(item.visit_count || '0', 10) || 0;
          const nextVisit = itemVisit > 0 ? itemVisit + 1 : 1;
          const existingVisitInfo = candidate.bodyPartVisitMap.get(normalizedPartKey);
          if (
            !existingVisitInfo ||
            item.date > existingVisitInfo.lastDate ||
            (item.date === existingVisitInfo.lastDate && itemVisit > existingVisitInfo.lastVisit)
          ) {
            candidate.bodyPartVisitMap.set(normalizedPartKey, {
              name: part,
              lastDate: item.date || '',
              lastVisit: itemVisit,
              nextVisit,
            });
          }
        });
      }
      if (item.prescription) {
        candidate.prescriptions.add(item.prescription);
      }
    });

    const options = Array.from(candidateMap.values()).map((candidate) => {
      const item = candidate.latestItem;
      const chartNumber = candidate.chartNumber;
      const lastVisit = parseInt(item.visit_count || '0', 10) || 0;
      const nextVisit = lastVisit > 0 ? lastVisit + 1 : 1;
      const cleanPatientName = String(item.patient_name).replace(/\*/g, '').trim();
      const namePart = item.type === 'manual'
        ? buildManualNamePart(cleanPatientName, item.prescription)
        : cleanPatientName;
      const latestBodyPart = item.body_part || '';
      const prescriptions = Array.from(candidate.prescriptions);
      const bodyPartVisitMap = Object.fromEntries(candidate.bodyPartVisitMap.entries());
      const preferredBodyPart = currentBodyParts.find((part) => bodyPartVisitMap[normalizeBodyPartKey(part)]) || '';
      const preferredNextVisit = preferredBodyPart
        ? bodyPartVisitMap[normalizeBodyPartKey(preferredBodyPart)]?.nextVisit
        : null;

      return {
        chartNumber,
        namePart,
        cleanName: cleanPatientName,
        nextVisit,
        lastDate: item.date || '',
        prescription: item.prescription || '',
        prescriptions,
        bodyParts: Array.from(candidate.bodyPartsMap.values()),
        latestBodyPart,
        initialBodyParts: splitBodyParts(latestBodyPart),
        type: item.type,
        doseTag: candidate.doseTag,
        bodyPartVisitMap,
        preferredBodyPart,
        preferredNextVisit,
        optionLabel: getSchedulerHistoryTypeLabel({ type: item.type, doseTag: candidate.doseTag, prescription: item.prescription }),
      };
    });

    if (options.length === 0) return { text: rawName };

    let selected;
    if (options.length === 1) {
      selected = options[0];
    } else {
      // 동명이인 - 먼저 선택
      selected = await pickChartOption(options, rawName);
      if (!selected) return { text: rawName };
    }

    // 부위가 2개 이상이거나 처방이 변경된 이력이 있으면 다이얼로그로 선택
    const effectiveVisitCount = selected.nextVisit;
    const effectiveBodyPart = selected.preferredBodyPart || selected.latestBodyPart || undefined;
    const autoText = `${selected.chartNumber}/${selected.namePart}(${effectiveVisitCount})`;
    const autoPrescription = has4060Pattern(autoText) ? undefined : (selected.prescription || undefined);
    const inheritedMergeSpan = findLatestSchedulerMemoMeta(
      { w, d, r, c },
      selected.chartNumber,
      selected.cleanName
    );
    const needsDialog = (selected.bodyParts.length >= 2 && !selected.preferredBodyPart) || selected.prescriptions.length >= 2;
    if (needsDialog) {
      try {
        const dialogResult = await showAutoFillDialog({
          chartNumber: selected.chartNumber,
          namePart: selected.namePart,
          cleanName: selected.cleanName,
          visitCount: effectiveVisitCount,
          prescription: autoPrescription || '',
          bodyParts: selected.bodyParts,
          latestBodyPart: selected.latestBodyPart,
          initialBodyPart: selected.preferredBodyPart,
          bodyPartVisitMap: selected.bodyPartVisitMap,
          initialMemoList: getMemoListFromMergeSpan(inheritedMergeSpan),
          type: selected.type,
          doseTag: selected.doseTag,
          settings,
        });

        if (!dialogResult) return { text: rawName };

        return {
          text: `${dialogResult.chartNumber}/${dialogResult.namePart}(${dialogResult.visitCount})`,
          prescription: dialogResult.prescription,
          bodyPart: dialogResult.bodyPart,
          mergeSpan: buildMergeSpanWithMemoList(inheritedMergeSpan, dialogResult.memoList),
        };
      } catch (err) {
        console.error('autoFillDialog error:', err);
        // 에러 발생 시 기본 자동완성
      }
    }

    // 부위가 0~1개: 다이얼로그 없이 바로 자동완성
    return {
      text: autoText,
      prescription: autoPrescription,
      bodyPart: effectiveBodyPart,
      mergeSpan: inheritedMergeSpan,
    };
  }, [memos, pickChartOption, showAutoFillDialog, shouldAutoFormatSchedulerName, weeks, settings, findLatestSchedulerMemoMeta, findSchedulerHistoryCandidates]);

  useEffect(() => {
    onLoadMemos(currentYear, currentMonth);
  }, [currentYear, currentMonth, onLoadMemos]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (dayColWidth && dayColWidth > 0) window.localStorage.setItem(SHOCKWAVE_DAY_COL_WIDTH_KEY, String(dayColWidth));
    else window.localStorage.removeItem(SHOCKWAVE_DAY_COL_WIDTH_KEY);
  }, [dayColWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (Array.isArray(colRatios) && colRatios.length > 0) {
      window.localStorage.setItem(SHOCKWAVE_COL_RATIOS_KEY, JSON.stringify(colRatios));
    } else {
      window.localStorage.removeItem(SHOCKWAVE_COL_RATIOS_KEY);
    }
  }, [colRatios]);

  const isEditableTarget = useCallback((target) => {
    return (
      (target instanceof HTMLInputElement && !target.dataset.hiddenInput) ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable
    );
  }, []);

  useEffect(() => {
    undoStackRef.current = undoStack;
  }, [undoStack]);

  const recordUndo = useCallback((action) => {
    undoStackRef.current = [action, ...undoStackRef.current].slice(0, 50);
    setUndoStack(undoStackRef.current);
  }, []);

  const doUndo = useCallback(() => {
    const [action, ...rest] = undoStackRef.current;
    if (!action) return;
    undoStackRef.current = rest;
    setUndoStack(rest);

    undoQueueRef.current = undoQueueRef.current.then(async () => {
      if (action.type === 'bulk-edit') {
        await saveShockwaveMemosBulk(action.oldMemos);
      } else if (action.type === 'edit') {
        const { w, d, r, c, oldContent, oldBg } = action;
        await onSaveMemo(currentYear, currentMonth, w, d, r, c, oldContent, oldBg);
      }
    }).catch((error) => {
      console.error('Undo failed:', error);
    });
  }, [saveShockwaveMemosBulk, onSaveMemo, currentYear, currentMonth]);

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        const activeItem = document.activeElement;
        if (isEditableTarget(activeItem)) return;
        e.preventDefault();
        doUndo();
      } else if (e.key === 'Escape') {
        setClipboardSource(null);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, [doUndo, isEditableTarget]);

  useEffect(() => {
    if (!Array.isArray(colRatios) || colRatios.length === colCount) return;
    setColRatios(Array(colCount).fill(1));
  }, [colRatios, colCount]);

  // ── 셀 키 헬퍼 ──
  const cellKey = (w, d, r, c) => `${w}-${d}-${r}-${c}`;
  const dayKey = (w, d) => `${w}-${d}`;

  const computeSelectionInfo = useCallback(() => {
    if (!selectedCell || !selectedKeys || selectedKeys.size === 0) return null;
    const { w, d } = selectedCell;
    let minRow = Infinity;
    let maxRow = -Infinity;
    let minCol = Infinity;
    let maxCol = -Infinity;
    let hasValid = false;

    Array.from(selectedKeys).forEach((key) => {
      const [kw, kd, r, c] = key.split('-').map(Number);
      if (kw !== w || kd !== d) return;
      hasValid = true;
      minRow = Math.min(minRow, r);
      maxRow = Math.max(maxRow, r);
      minCol = Math.min(minCol, c);
      maxCol = Math.max(maxCol, c);

      const mergeSpan = memos[key]?.merge_span;
      if (mergeSpan?.mergedInto) {
        const masterKey = mergeSpan.mergedInto;
        const [mw, md, mr, mc] = masterKey.split('-').map(Number);
        if (mw !== w || md !== d) return;
        const masterSpan = memos[masterKey]?.merge_span || { rowSpan: 1, colSpan: 1 };
        minRow = Math.min(minRow, mr);
        minCol = Math.min(minCol, mc);
        maxRow = Math.max(maxRow, mr + masterSpan.rowSpan - 1);
        maxCol = Math.max(maxCol, mc + masterSpan.colSpan - 1);
      } else if (mergeSpan?.rowSpan > 1 || mergeSpan?.colSpan > 1) {
        maxRow = Math.max(maxRow, r + mergeSpan.rowSpan - 1);
        maxCol = Math.max(maxCol, c + mergeSpan.colSpan - 1);
      }
    });

    if (!hasValid || minRow === Infinity) return null;
    const boundedMinRow = minRow === Infinity ? selectedCell.r : minRow;
    const boundedMaxRow = maxRow === -Infinity ? selectedCell.r : maxRow;
    const boundedMinCol = minCol === Infinity ? selectedCell.c : minCol;
    const boundedMaxCol = maxCol === -Infinity ? selectedCell.c : maxCol;
    const masterKey = cellKey(w, d, boundedMinRow, boundedMinCol);
    const masterSpan = memos[masterKey]?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
    const selectionRowSpan = boundedMaxRow - boundedMinRow + 1;
    const selectionColSpan = boundedMaxCol - boundedMinCol + 1;
    const isMergedMaster = masterSpan.mergedInto === null && (masterSpan.rowSpan > 1 || masterSpan.colSpan > 1);

    return {
      w,
      d,
      minRow: boundedMinRow,
      maxRow: boundedMaxRow,
      minCol: boundedMinCol,
      maxCol: boundedMaxCol,
      masterKey,
      masterSpan,
      selectionRowSpan,
      selectionColSpan,
      isMergedMaster,
      selectionMultiple: selectionRowSpan > 1 || selectionColSpan > 1,
    };
  }, [selectedCell, selectedKeys, memos, cellKey]);

  const normalizeKeysToMergeMasters = useCallback((keys) => {
    const normalized = new Set();
    if (!keys) return normalized;

    Array.from(keys).forEach((key) => {
      const mergeSpan = memos[key]?.merge_span;
      if (mergeSpan?.mergedInto) normalized.add(mergeSpan.mergedInto);
      else normalized.add(key);
    });

    return normalized;
  }, [memos]);

  const normalizeCellToMergeMaster = useCallback((cell) => {
    if (!cell) return cell;
    const key = cellKey(cell.w, cell.d, cell.r, cell.c);
    const mergeSpan = memos[key]?.merge_span;
    if (!mergeSpan?.mergedInto) return cell;
    const [w, d, r, c] = mergeSpan.mergedInto.split('-').map(Number);
    return { w, d, r, c };
  }, [cellKey, memos]);

  const buildRangeKeys = useCallback((anchor, target) => {
    if (!anchor || !target) return new Set();
    if (anchor.w !== target.w || anchor.d !== target.d) {
      return new Set([cellKey(target.w, target.d, target.r, target.c)]);
    }

    const rMin = Math.min(anchor.r, target.r);
    const rMax = Math.max(anchor.r, target.r);
    const cMin = Math.min(anchor.c, target.c);
    const cMax = Math.max(anchor.c, target.c);
    const keys = new Set();
    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        keys.add(cellKey(anchor.w, anchor.d, r, c));
      }
    }
    return keys;
  }, []);

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

    if (e?.button !== 0) return;
    e.preventDefault();
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
    setEditingCell(null);
  }, [selectedCell, buildRangeKeys, selectSingleCell, normalizeCellToMergeMaster, cellKey]);

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
      setEditSessionId(Date.now());
    });
  }, [selectSingleCell]);

  // ── 편집 저장 ──
  const handleCellSave = useCallback(async (w, d, r, c, nextValue = editValue) => {
    const key = cellKey(w, d, r, c);
    const oldContent = memos[key]?.content || '';
    const immediateContent = String(nextValue ?? '').trim();
    setPendingDisplayValues((prev) => ({ ...prev, [key]: immediateContent }));
    setEditingCell(null);
    const result = await buildSchedulerAutoText(w, d, r, c, nextValue);
    const newContent = (typeof result === 'string' ? result : (result?.text || '')).trim();
    let newPrescription = result?.prescription;
    const newBodyPart = result?.bodyPart;
    const newMergeSpan = result?.mergeSpan;

    // 이름에 40/60 패턴이 있으면 기존 처방을 명시적으로 취소
    if (has4060Pattern(newContent) && memos[key]?.prescription) {
      newPrescription = '';
    }

    if (newContent !== immediateContent) {
      setPendingDisplayValues((prev) => ({ ...prev, [key]: newContent }));
    }

    const prescriptionCleared = has4060Pattern(newContent) && memos[key]?.prescription && newPrescription === '';
    if (newContent === oldContent && !newPrescription && !newBodyPart && !prescriptionCleared) {
      setPendingDisplayValues((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    setPendingDisplayValues((prev) => ({ ...prev, [key]: newContent }));
    recordUndo({ type: 'edit', w, d, r, c, oldContent, oldBg: memos[key]?.bg_color });
    const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, newContent, undefined, newMergeSpan, newPrescription, newBodyPart);
    setPendingDisplayValues((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (!success) addToast('저장 실패', 'error');
  }, [editValue, currentYear, currentMonth, memos, onSaveMemo, addToast, buildSchedulerAutoText]);

  // ── 셀 우클릭 = 처방 선택 ──
  const handleCellContextMenu = useCallback((e, w, d, r, c, currentPrescription) => {
    e.preventDefault();
    selectSingleCell({ w, d, r, c });
    const key = cellKey(w, d, r, c);
    setContextMenuBodyInput(memos[key]?.body_part || '');
    setContextMenuNoteInput('');
    setContextMenuMemoDrafts(getMemoListFromMergeSpan(memos[key]?.merge_span));
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      weekIdx: w,
      dayIdx: d,
      rowIdx: r,
      colIdx: c,
      currentPrescription
    });
  }, [cellKey, memos, selectSingleCell]);

  const handlePrescriptionSelect = useCallback(async (prescription) => {
    if (!contextMenu) return;
    const { weekIdx: w, dayIdx: d, rowIdx: r, colIdx: c } = contextMenu;
    const key = cellKey(w, d, r, c);
    const memo = memos[key] || {};
    
    // 처방이 설정될 때 이름에 40/60이 있으면 숫자 자동 제거
    let updatedContent = memo.content;
    if (prescription && has4060Pattern(memo.content)) {
      updatedContent = strip4060FromContent(memo.content);
    }
    
    setContextMenu(null);
    const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, updatedContent, memo.bg_color, memo.merge_span, prescription);
    if (!success) addToast('처방 지정 실패', 'error');
  }, [contextMenu, currentYear, currentMonth, memos, onSaveMemo, addToast]);

  // ── 뷰어 바깥 클릭 시 컨텍스트 메뉴 닫기 ──
  useEffect(() => {
    const handleClickOutside = () => {
      if (contextMenu) setContextMenu(null);
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) {
      setContextMenuBodyInput('');
      setContextMenuNoteInput('');
      setContextMenuMemoDrafts([]);
    }
  }, [contextMenu]);

  // ── 셀 삭제 ──
  const deleteCells = useCallback(async (keys) => {
    const affectedKeys = new Set();

    for (const key of keys || []) {
      const mergeSpan = memos[key]?.merge_span;
      const masterKey = mergeSpan?.mergedInto || key;
      const [w, d, r, c] = masterKey.split('-').map(Number);
      const masterSpan = memos[masterKey]?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
      const rowSpan = Math.max(1, masterSpan.rowSpan || 1);
      const colSpan = Math.max(1, masterSpan.colSpan || 1);

      for (let row = r; row < r + rowSpan; row++) {
        for (let col = c; col < c + colSpan; col++) {
          affectedKeys.add(cellKey(w, d, row, col));
        }
      }
    }

    const oldMemos = [];
    const payload = [];
    for (const key of affectedKeys) {
      const [w, d, r, c] = key.split('-').map(Number);
      const memo = memos[key];
      oldMemos.push({
        year: currentYear,
        month: currentMonth,
        week_index: w,
        day_index: d,
        row_index: r,
        col_index: c,
        content: memo?.content || '',
        bg_color: memo?.bg_color || null,
        merge_span: memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
        prescription: memo?.prescription || null,
        body_part: memo?.body_part || null,
      });
      payload.push({
        year: currentYear,
        month: currentMonth,
        week_index: w,
        day_index: d,
        row_index: r,
        col_index: c,
        content: '',
        bg_color: null,
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
        prescription: null,
        body_part: null,
      });
    }
    if (payload.length > 0) {
      recordUndo({ type: 'bulk-edit', oldMemos });
      await saveShockwaveMemosBulk(payload);
    }
  }, [currentYear, currentMonth, memos, saveShockwaveMemosBulk]);

  const tryMergeSelection = useCallback(async () => {
    const selection = computeSelectionInfo();
    if (!selection) return;
    const { w, d, minRow, minCol, maxRow, maxCol, masterKey } = selection;
    const isAlreadyMerged = selection.isMergedMaster;
    const hasMultipleSelectedCells = (selectedKeys?.size || 0) > 1;
    if (!isAlreadyMerged && !selection.selectionMultiple && !hasMultipleSelectedCells) return;

    const oldMemos = [];
    const payload = [];
    const combinedContent = [];
    if (isAlreadyMerged) {
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const k = cellKey(w, d, row, col);
          const memo = memos[k];
          oldMemos.push({
            year: currentYear, month: currentMonth, week_index: w, day_index: d, row_index: row, col_index: col,
            content: memo?.content || '',
            bg_color: memo?.bg_color || null,
            merge_span: memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
          });
          payload.push({
            year: currentYear, month: currentMonth, week_index: w, day_index: d, row_index: row, col_index: col,
            merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
            content: memo?.content || ''
          });
        }
      }
    } else {
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const k = cellKey(w, d, row, col);
          const isMaster = (k === masterKey);
          const memo = memos[k];
          if (memo?.content) {
            combinedContent.push(memo.content);
          }
          oldMemos.push({
            year: currentYear, month: currentMonth, week_index: w, day_index: d, row_index: row, col_index: col,
            content: memo?.content || '',
            bg_color: memo?.bg_color || null,
            merge_span: memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
          });
          payload.push({
            year: currentYear, month: currentMonth, week_index: w, day_index: d, row_index: row, col_index: col,
            merge_span: isMaster
              ? { rowSpan: maxRow - minRow + 1, colSpan: maxCol - minCol + 1, mergedInto: null }
              : { rowSpan: 1, colSpan: 1, mergedInto: masterKey },
            content: '' // will update master later
          });
        }
      }
      
      const mergedText = combinedContent.filter(Boolean).join('\n');
      payload.forEach(p => {
        if (!p.merge_span.mergedInto) {
          p.content = mergedText;
        }
      });
    }

    if (payload.length > 0) {
      recordUndo({ type: 'bulk-edit', oldMemos });
      await saveShockwaveMemosBulk(payload);
      addToast(isAlreadyMerged ? '병합이 해제되었습니다' : '셀이 병합되었습니다', 'info');
    }
    setContextMenu(null);
  }, [computeSelectionInfo, currentYear, currentMonth, memos, saveShockwaveMemosBulk, addToast, cellKey, recordUndo, selectedKeys]);

  const selectionInfo = computeSelectionInfo();
  const hasCompletableSelection = useMemo(() => {
    if (!selectedKeys || selectedKeys.size === 0) return false;
    const effectiveKeys = normalizeKeysToMergeMasters(selectedKeys);
    return Array.from(effectiveKeys).some((key) => String(memos[key]?.content || '').trim());
  }, [selectedKeys, memos, normalizeKeysToMergeMasters]);

  const hasCompletedSelection = useMemo(() => {
    if (!selectedKeys || selectedKeys.size === 0) return false;
    const effectiveKeys = normalizeKeysToMergeMasters(selectedKeys);
    return Array.from(effectiveKeys).some((key) => {
      const memo = memos[key];
      return String(memo?.content || '').trim() && memo?.bg_color === TREATMENT_COMPLETE_BG;
    });
  }, [selectedKeys, memos, normalizeKeysToMergeMasters]);

  const hasCancelledSelection = useMemo(() => {
    if (!selectedKeys || selectedKeys.size === 0) return false;
    const effectiveKeys = normalizeKeysToMergeMasters(selectedKeys);
    return Array.from(effectiveKeys).some((key) => {
      const memo = memos[key];
      return String(memo?.content || '').trim() && memo?.bg_color === TREATMENT_CANCEL_BG;
    });
  }, [selectedKeys, memos, normalizeKeysToMergeMasters]);
  const treatmentCompleteButtonLabel = hasCompletedSelection ? '방문취소' : '방문완료';

  // 날짜 비교 헬퍼: 원본(w,d)와 대상(w,d)의 실제 날짜를 비교
  const isLaterDate = useCallback((srcW, srcD, dstW, dstD) => {
    const srcDay = weeks[srcW]?.[srcD];
    const dstDay = weeks[dstW]?.[dstD];
    if (!srcDay || !dstDay) return false;
    const srcDate = new Date(srcDay.year, srcDay.month - 1, srcDay.day);
    const dstDate = new Date(dstDay.year, dstDay.month - 1, dstDay.day);
    return dstDate > srcDate;
  }, [weeks]);

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

  const buildClipboardSelection = useCallback(() => {
    if (!selectedCell) return null;

    const range = selectionInfo || {
      w: selectedCell.w,
      d: selectedCell.d,
      minRow: selectedCell.r,
      maxRow: selectedCell.r,
      minCol: selectedCell.c,
      maxCol: selectedCell.c,
    };

    const rowCount = range.maxRow - range.minRow + 1;
    const colCountInRange = range.maxCol - range.minCol + 1;
    const cells = [];
    const plainRows = [];
    const sourceKeys = [];

    for (let rowOffset = 0; rowOffset < rowCount; rowOffset++) {
      const cellRow = [];
      const plainRow = [];
      for (let colOffset = 0; colOffset < colCountInRange; colOffset++) {
        const rowIndex = range.minRow + rowOffset;
        const colIndex = range.minCol + colOffset;
        const key = cellKey(range.w, range.d, rowIndex, colIndex);
        const memo = memos[key];
        cellRow.push({
          rowOffset,
          colOffset,
          content: memo?.content || '',
          bg_color: memo?.bg_color || null,
          merge_span: memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
          prescription: memo?.prescription || '',
          body_part: memo?.body_part || '',
        });
        plainRow.push(memo?.content || '');
        sourceKeys.push(key);
      }
      cells.push(cellRow);
      plainRows.push(plainRow.join('\t'));
    }

    return {
      mode: 'copy',
      srcW: range.w,
      srcD: range.d,
      srcMinRow: range.minRow,
      srcMinCol: range.minCol,
      rowCount,
      colCount: colCountInRange,
      cells,
      sourceKeys,
      plainText: plainRows.join('\n'),
    };
  }, [selectedCell, selectionInfo, memos, cellKey]);

  const parsePlainTextClipboard = useCallback((plainText, htmlText = null) => {
    if (typeof plainText !== 'string') return null;
    const normalized = plainText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!normalized.length) return null;

    const rawRows = normalized.split('\n');
    while (rawRows.length > 1 && rawRows[rawRows.length - 1] === '') {
      rawRows.pop();
    }

    const cells = rawRows.map((rowText, rowOffset) =>
      rowText.split('\t').map((content, colOffset) => ({
        rowOffset,
        colOffset,
        content,
        bg_color: null,
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
        prescription: '',
      }))
    );

    if (htmlText) {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        // Parse <style> blocks for class-based backgrounds (common in Google Sheets)
        const styleText = Array.from(doc.querySelectorAll('style')).map(s => s.textContent).join('\n');
        const classColors = {};
        if (styleText) {
          const styleRegex = /\.([\w-]+)[^{]*\{([^}]+)\}/g;
          let match;
          while ((match = styleRegex.exec(styleText)) !== null) {
            const className = match[1];
            const rules = match[2].toLowerCase();
            const bgMatch = rules.match(/background(?:-color)?\s*:\s*([^;!}]+)/);
            if (bgMatch) {
              let parsedColor = bgMatch[1].trim().split(' ')[0];
              if (parsedColor && parsedColor !== 'none' && parsedColor !== 'transparent' && parsedColor !== 'windowtext') {
                classColors[className] = parsedColor;
              }
            }
          }
        }

        // Find the most likely data table (usually the one with the most rows or just the first)
        const tables = Array.from(doc.querySelectorAll('table'));
        let targetTable = tables.length > 0 ? tables[0] : null;
        
        // If no table found, fallback to body
        const root = targetTable || doc.body;
        const rows = Array.from(root.querySelectorAll('tr'));
        
        // We need to map the parsed rows to our `cells` array. 
        // We'll skip empty rows at the beginning if there's a mismatch.
        let cellRowIdx = 0;
        
        for (let i = 0; i < rows.length; i++) {
          if (cellRowIdx >= cells.length) break;
          const tr = rows[i];
          const tds = Array.from(tr.querySelectorAll('td, th'));
          
          // Only process rows that have actual cells
          if (tds.length === 0) continue;
          
          for (let j = 0; j < tds.length; j++) {
            if (j >= cells[cellRowIdx].length) break;
            const td = tds[j];
            
            let bgColor = td.style.backgroundColor || td.getAttribute('bgcolor');
            
            // Check for background shorthand in inline style
            if (!bgColor && td.hasAttribute('style')) {
              const styleStr = td.getAttribute('style').toLowerCase();
              const bgMatch = styleStr.match(/background(?:-color)?\s*:\s*([^;]+)/);
              if (bgMatch) {
                bgColor = bgMatch[1].trim().split(' ')[0];
              }
            }

            // Check class-based styling
            if (!bgColor && td.classList.length > 0) {
              for (const cls of Array.from(td.classList)) {
                if (classColors[cls]) {
                  bgColor = classColors[cls];
                  break;
                }
              }
            }
            
            if (bgColor && bgColor !== 'transparent' && bgColor !== 'none' && bgColor !== 'windowtext') {
              cells[cellRowIdx][j].bg_color = bgColor;
            }
          }
          cellRowIdx++;
        }
      } catch (e) {
        console.error("Failed to parse HTML from clipboard", e);
      }
    }

    const rowCount = cells.length;
    const pastedColCount = cells.reduce((max, row) => Math.max(max, row.length), 0);
    if (!rowCount || !pastedColCount) return null;

    return {
      mode: 'copy',
      srcW: selectedCell?.w ?? 0,
      srcD: selectedCell?.d ?? 0,
      srcMinRow: 0,
      srcMinCol: 0,
      rowCount,
      colCount: pastedColCount,
      cells,
      sourceKeys: [],
      plainText: normalized,
    };
  }, [selectedCell]);

  const buildPastePayload = useCallback((clip, target) => {
    if (!clip?.cells?.length) return [];
    const payload = [];
    const isCrossDate = clip.srcW !== target.w || clip.srcD !== target.d;
    const sourceMasterToTargetMaster = new Map();

    for (const row of clip.cells) {
      for (const cell of row) {
        const targetRow = target.r + cell.rowOffset;
        const targetCol = target.c + cell.colOffset;
        if (targetRow >= baseTimeSlots.length || targetCol >= colCount) continue;

        let nextContent = cell.content || '';
        if (clip.mode === 'copy' && isCrossDate && nextContent) {
          nextContent = incrementSessionCount(nextContent);
        }

        let nextMergeSpan = { rowSpan: 1, colSpan: 1, mergedInto: null };
        const mergeSpan = cell.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
        const sourceCellKey = cellKey(
          clip.srcW,
          clip.srcD,
          clip.srcMinRow + cell.rowOffset,
          clip.srcMinCol + cell.colOffset
        );

        if (mergeSpan?.mergedInto) {
          let mappedMasterKey = sourceMasterToTargetMaster.get(mergeSpan.mergedInto);
          if (!mappedMasterKey) {
            const [, , sourceMasterRow, sourceMasterCol] = mergeSpan.mergedInto.split('-').map(Number);
            const masterRowOffset = sourceMasterRow - clip.srcMinRow;
            const masterColOffset = sourceMasterCol - clip.srcMinCol;
            mappedMasterKey = cellKey(
              target.w,
              target.d,
              target.r + masterRowOffset,
              target.c + masterColOffset
            );
            sourceMasterToTargetMaster.set(mergeSpan.mergedInto, mappedMasterKey);
          }
          nextMergeSpan = cloneMergeSpanWithMeta(mergeSpan, { rowSpan: 1, colSpan: 1, mergedInto: mappedMasterKey });
        } else if (mergeSpan?.rowSpan > 1 || mergeSpan?.colSpan > 1) {
          const mappedMasterKey = cellKey(target.w, target.d, targetRow, targetCol);
          sourceMasterToTargetMaster.set(sourceCellKey, mappedMasterKey);
          nextMergeSpan = cloneMergeSpanWithMeta(mergeSpan, {
            rowSpan: mergeSpan.rowSpan || 1,
            colSpan: mergeSpan.colSpan || 1,
            mergedInto: null,
          });
        } else if (mergeSpan?.meta) {
          nextMergeSpan = cloneMergeSpanWithMeta(mergeSpan, { rowSpan: 1, colSpan: 1, mergedInto: null });
        }

        payload.push({
          year: currentYear,
          month: currentMonth,
          week_index: target.w,
          day_index: target.d,
          row_index: targetRow,
          col_index: targetCol,
          content: nextContent,
          bg_color: isCrossDate ? null : (cell.bg_color || null),
          merge_span: nextMergeSpan,
          prescription: cell.prescription || '',
          body_part: cell.body_part || '',
        });
      }
    }

    return payload;
  }, [baseTimeSlots.length, colCount, currentYear, currentMonth]);

  const handleCopySelection = useCallback(() => {
    const clip = buildClipboardSelection();
    if (!clip) return;
    clipboardRef.current = { ...clip, mode: 'copy' };
    setClipboardSource({ keys: new Set(clip.sourceKeys), mode: 'copy' });
    try { navigator.clipboard.writeText(clip.plainText); } catch (_) {}
    addToast('복사됨', 'info');
    setContextMenu(null);
  }, [buildClipboardSelection, addToast]);

  const handleCutSelection = useCallback(async () => {
    const clip = buildClipboardSelection();
    if (!clip) return;
    clipboardRef.current = { ...clip, mode: 'cut' };
    setClipboardSource({ keys: new Set(clip.sourceKeys), mode: 'cut' });
    try { navigator.clipboard.writeText(clip.plainText); } catch (_) {}
    addToast('잘라내기됨 (붙여넣기 시 원본 삭제)', 'info');
    setContextMenu(null);
  }, [buildClipboardSelection, addToast]);

  const handlePasteSelection = useCallback(async (forcedPlainText = null, forcedHtmlText = null, explicitTargetCell = null) => {
    const targetCell = explicitTargetCell || selectedCellRef.current || selectedCell;
    if (!targetCell) return;
    let clip = clipboardRef.current;
    const currentClipboardSource = clipboardSource;

    if (typeof forcedPlainText === 'string') {
      const externalClip = parsePlainTextClipboard(forcedPlainText, forcedHtmlText);
      const internalPlainText = clipboardRef.current?.plainText || '';
      const normalizedForced = forcedPlainText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const normalizedInternal = internalPlainText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      if (externalClip?.cells?.length && normalizedForced !== normalizedInternal) {
        clip = externalClip;
      }
    } else if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      try {
        const clipboardText = await navigator.clipboard.readText();
        if (clipboardText) {
          const externalClip = parsePlainTextClipboard(clipboardText);
          const internalPlainText = clipboardRef.current?.plainText || '';
          const normalizedForced = clipboardText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          const normalizedInternal = internalPlainText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          if (externalClip?.cells?.length && normalizedForced !== normalizedInternal) {
            clip = externalClip;
          }
        }
      } catch (_) {}
    }

    if (!clip?.cells?.length) {
      setContextMenu(null);
      return;
    }

    if (currentClipboardSource) {
      setClipboardSource(null);
    }

    // Record undo status for target area before paste
    const oldMemos = [];
    const targetRowCount = clip.rowCount;
    const targetColCountInRange = clip.colCount;
    for (let ro = 0; ro < targetRowCount; ro++) {
      for (let co = 0; co < targetColCountInRange; co++) {
        const tr = targetCell.r + ro;
        const tc = targetCell.c + co;
        if (tr >= baseTimeSlots.length || tc >= colCount) continue;
        const k = cellKey(targetCell.w, targetCell.d, tr, tc);
        const m = memos[k];
        oldMemos.push({
          year: currentYear, month: currentMonth,
          week_index: targetCell.w, day_index: targetCell.d,
          row_index: tr, col_index: tc,
          content: m?.content || '', bg_color: m?.bg_color || null,
          merge_span: m?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
          prescription: m?.prescription || ''
        });
      }
    }

    const targetPayload = buildPastePayload(clip, targetCell);
    if (targetPayload.length === 0) {
      setContextMenu(null);
      return;
    }

    const combinedPayload = new Map();

    if (clip.mode === 'cut' && currentClipboardSource?.keys) {
      Array.from(currentClipboardSource.keys).forEach((k) => {
        const [w, d, r, c] = k.split('-').map(Number);
        const m = memos[k];
        oldMemos.push({
          year: currentYear, month: currentMonth,
          week_index: w, day_index: d,
          row_index: r, col_index: c,
          content: m?.content || '', bg_color: m?.bg_color || null,
          merge_span: m?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
          prescription: m?.prescription || ''
        });
        combinedPayload.set(`${w}-${d}-${r}-${c}`, {
          year: currentYear, month: currentMonth,
          week_index: w, day_index: d,
          row_index: r, col_index: c,
          content: '', bg_color: null,
          merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
          prescription: ''
        });
      });
    }

    targetPayload.forEach((item) => {
      combinedPayload.set(
        `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`,
        item
      );
    });

    await saveShockwaveMemosBulk(Array.from(combinedPayload.values()));

    if (clip.mode === 'cut' && currentClipboardSource?.keys) {
      clipboardRef.current = { ...clip, mode: 'copy' };
    }
    
    recordUndo({ type: 'bulk-edit', oldMemos });
    addToast('붙여넣기 완료', 'success');
    setContextMenu(null);
  }, [selectedCell, clipboardSource, parsePlainTextClipboard, buildPastePayload, addToast, memos, cellKey, currentYear, currentMonth, baseTimeSlots.length, colCount, saveShockwaveMemosBulk]);

  const buildTreatmentStatusPayload = useCallback((mode) => {
    if (!selectedKeys || selectedKeys.size === 0) return null;

    const effectiveKeys = normalizeKeysToMergeMasters(selectedKeys);
    const oldMemos = [];
    const payload = [];
    const touchedKeys = new Set();
    const statusBg = mode === 'cancel-toggle' ? TREATMENT_CANCEL_BG : TREATMENT_COMPLETE_BG;
    const shouldClearSelection =
      mode === 'toggle'
        ? Array.from(effectiveKeys).some((key) => memos[key]?.bg_color === TREATMENT_COMPLETE_BG)
        : mode === 'cancel-toggle'
          ? Array.from(effectiveKeys).some((key) => memos[key]?.bg_color === TREATMENT_CANCEL_BG)
          : mode === 'clear';

    Array.from(effectiveKeys).forEach((key) => {
      const [w, d, r, c] = key.split('-').map(Number);
      const memo = memos[key];
      const content = memo?.content || '';

      if (!String(content).trim()) return;

      const masterSpan = memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
      const rowSpan = Math.max(1, masterSpan.rowSpan || 1);
      const colSpan = Math.max(1, masterSpan.colSpan || 1);
      const nextBgColor = shouldClearSelection ? null : statusBg;

      if ((memo?.bg_color || null) === nextBgColor) return;

      for (let row = r; row < r + rowSpan; row += 1) {
        for (let col = c; col < c + colSpan; col += 1) {
          const rangeKey = cellKey(w, d, row, col);
          if (touchedKeys.has(rangeKey)) continue;
          touchedKeys.add(rangeKey);

          const rangeMemo = memos[rangeKey];
          oldMemos.push({
            year: currentYear,
            month: currentMonth,
            week_index: w,
            day_index: d,
            row_index: row,
            col_index: col,
            content: rangeMemo?.content || '',
            bg_color: rangeMemo?.bg_color || null,
            merge_span: rangeMemo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
          });

          payload.push({
            year: currentYear,
            month: currentMonth,
            week_index: w,
            day_index: d,
            row_index: row,
            col_index: col,
            content: rangeMemo?.content || '',
            bg_color: nextBgColor,
            merge_span: rangeMemo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
          });
        }
      }
    });

    if (payload.length === 0) return null;
    return { oldMemos, payload };
  }, [selectedKeys, memos, currentYear, currentMonth, normalizeKeysToMergeMasters]);

  const applyTreatmentCompleteToSelection = useCallback(async (mode) => {
    const batch = buildTreatmentStatusPayload(mode);
    if (!batch) {
      setContextMenu(null);
      return false;
    }

    recordUndo({ type: 'bulk-edit', oldMemos: batch.oldMemos });
    const success = await saveShockwaveMemosBulk(batch.payload);
    if (!success) {
      addToast(
        mode === 'cancel-toggle'
          ? '취소 상태 변경 실패'
          : mode === 'complete'
            ? '치료 완료 표시 실패'
          : mode === 'clear'
            ? '치료 완료 해제 실패'
            : '치료 완료/해제 실패',
        'error'
      );
      setContextMenu(null);
      return false;
    }

    setContextMenu(null);
    return true;
  }, [buildTreatmentStatusPayload, saveShockwaveMemosBulk, addToast]);

  const handleToggleTreatmentComplete = useCallback(async () => {
    await applyTreatmentCompleteToSelection('toggle');
  }, [applyTreatmentCompleteToSelection]);

  const handleToggleTreatmentCancel = useCallback(async () => {
    await applyTreatmentCompleteToSelection('cancel-toggle');
  }, [applyTreatmentCompleteToSelection]);

  const handleToggleHolidayBackground = useCallback(async () => {
    if (!selectedKeys || selectedKeys.size === 0) return;

    const effectiveKeys = normalizeKeysToMergeMasters(selectedKeys);
    const shouldClearSelection = Array.from(effectiveKeys).some(
      (key) => memos[key]?.bg_color === SCHEDULER_HOLIDAY_BG
    );
    const nextBgColor = shouldClearSelection ? null : SCHEDULER_HOLIDAY_BG;
    const touchedKeys = new Set();
    const oldMemos = [];
    const payload = [];

    Array.from(effectiveKeys).forEach((key) => {
      const [w, d, r, c] = key.split('-').map(Number);
      const memo = memos[key];
      const masterSpan = memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
      const rowSpan = Math.max(1, masterSpan.rowSpan || 1);
      const colSpan = Math.max(1, masterSpan.colSpan || 1);

      for (let row = r; row < r + rowSpan; row += 1) {
        for (let col = c; col < c + colSpan; col += 1) {
          const rangeKey = cellKey(w, d, row, col);
          if (touchedKeys.has(rangeKey)) continue;
          touchedKeys.add(rangeKey);

          const rangeMemo = memos[rangeKey];
          if ((rangeMemo?.bg_color || null) === nextBgColor) continue;

          oldMemos.push({
            year: currentYear,
            month: currentMonth,
            week_index: w,
            day_index: d,
            row_index: row,
            col_index: col,
            content: rangeMemo?.content || '',
            bg_color: rangeMemo?.bg_color || null,
            merge_span: rangeMemo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
            prescription: rangeMemo?.prescription || null,
            body_part: rangeMemo?.body_part || null,
          });

          payload.push({
            year: currentYear,
            month: currentMonth,
            week_index: w,
            day_index: d,
            row_index: row,
            col_index: col,
            content: rangeMemo?.content || '',
            bg_color: nextBgColor,
            merge_span: rangeMemo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
            prescription: rangeMemo?.prescription || null,
            body_part: rangeMemo?.body_part || null,
          });
        }
      }
    });

    if (payload.length === 0) return;
    recordUndo({ type: 'bulk-edit', oldMemos });
    const success = await saveShockwaveMemosBulk(payload);
    if (!success) addToast('배경색 변경 실패', 'error');
  }, [selectedKeys, memos, currentYear, currentMonth, normalizeKeysToMergeMasters, cellKey, saveShockwaveMemosBulk, addToast]);

  const handleContextAction = useCallback(async (action) => {
    if (action === 'copy') handleCopySelection();
    else if (action === 'cut') handleCutSelection();
    else if (action === 'paste') handlePasteSelection();
    else if (action === 'complete-toggle') handleToggleTreatmentComplete();
    else if (action === 'cancel-toggle') handleToggleTreatmentCancel();
    else if (action === 'merge' || action === 'unmerge') tryMergeSelection();
    else if (action?.type === 'prescription') {
      const keys = Array.from(selectedKeys || []);
      const newMemos = { ...memos };
      let anyChanged = false;
      
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        let updatedContent = memo.content;
        // 처방이 설정될 때 이름에 40/60이 있으면 숫자 자동 제거
        if (action.value && has4060Pattern(memo.content)) {
          updatedContent = strip4060FromContent(memo.content);
        }
        if (memo.prescription !== action.value || updatedContent !== memo.content) {
          const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, updatedContent, memo.bg_color, memo.merge_span, action.value);
          if (success) anyChanged = true;
        }
      }
      if (anyChanged) addToast('처방이 적용되었습니다.', 'success');
    }
    else if (action?.type === 'bodyPart') {
      const keys = Array.from(selectedKeys || []);
      let anyChanged = false;
      
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        if (memo.body_part !== action.value) {
          const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, memo.content, memo.bg_color, memo.merge_span, memo.prescription, action.value);
          if (success) anyChanged = true;
        }
      }
      if (anyChanged) addToast('부위가 적용되었습니다.', 'success');
      return; // don't close menu
    }
    else if (action?.type === 'bodyPartAdd') {
      // 기존 부위에 추가
      const keys = Array.from(selectedKeys || []);
      let anyChanged = false;
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        const existing = (memo.body_part || '').trim();
        const newPart = formatBodyPartInput(action.value);
        if (!newPart) continue;
        const combined = existing ? `${existing}, ${newPart}` : newPart;
        const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, memo.content, memo.bg_color, memo.merge_span, memo.prescription, combined);
        if (success) anyChanged = true;
      }
      if (anyChanged) addToast('부위가 추가되었습니다.', 'success');
      return;
    }
    else if (action?.type === 'bodyPartRemove') {
      // 특정 부위 삭제
      const keys = Array.from(selectedKeys || []);
      let anyChanged = false;
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        const parts = (memo.body_part || '').split(',').map(p => p.trim()).filter(Boolean);
        const updated = parts.filter((_, i) => i !== action.index).join(', ');
        const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, memo.content, memo.bg_color, memo.merge_span, memo.prescription, updated);
        if (success) anyChanged = true;
      }
      if (anyChanged) addToast('부위가 삭제되었습니다.', 'success');
      return;
    }
    else if (action?.type === 'bodyPartEdit') {
      // 특정 부위 수정
      const keys = Array.from(selectedKeys || []);
      let anyChanged = false;
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        const parts = (memo.body_part || '').split(',').map(p => p.trim()).filter(Boolean);
        parts[action.index] = formatBodyPartInput(action.value);
        const updated = parts.filter(Boolean).join(', ');
        const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, memo.content, memo.bg_color, memo.merge_span, memo.prescription, updated);
        if (success) anyChanged = true;
      }
      if (anyChanged) addToast('부위가 수정되었습니다.', 'success');
      return;
    }
    else if (action?.type === 'bodyPartClear') {
      const keys = Array.from(selectedKeys || []);
      let anyChanged = false;
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, memo.content, memo.bg_color, memo.merge_span, memo.prescription, '');
        if (success) anyChanged = true;
      }
      if (anyChanged) addToast('부위가 삭제되었습니다.', 'success');
      return;
    }
    else if (action?.type === 'bodyPartToggle') {
      const keys = Array.from(selectedKeys || []);
      let anyChanged = false;
      const targetPart = action.value.trim();
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        const parts = (memo.body_part || '').split(',').map(p => p.trim()).filter(Boolean);
        const idx = parts.findIndex(p => p.toLowerCase() === targetPart.toLowerCase());
        if (idx >= 0) {
          parts.splice(idx, 1);
        } else {
          parts.push(targetPart);
        }
        const updated = parts.join(', ');
        const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, memo.content, memo.bg_color, memo.merge_span, memo.prescription, updated);
        if (success) anyChanged = true;
      }
      return;
    }
    else if (action?.type === 'memoAdd') {
      const keys = Array.from(selectedKeys || []);
      let anyChanged = false;
      const newMemo = String(action.value || '').trim();
      if (!newMemo) return;
      setContextMenuMemoDrafts((prev) => [...prev, newMemo]);
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        const memoList = getMemoListFromMergeSpan(memo.merge_span);
        const nextMemoList = [...memoList, newMemo];
        const nextMergeSpan = buildMergeSpanWithMemoList(memo.merge_span, nextMemoList);
        const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, memo.content, memo.bg_color, nextMergeSpan, memo.prescription, memo.body_part);
        if (success) anyChanged = true;
      }
      if (anyChanged) addToast('메모가 추가되었습니다.', 'success');
      return;
    }
    else if (action?.type === 'memoRemove') {
      const keys = Array.from(selectedKeys || []);
      let anyChanged = false;
      setContextMenuMemoDrafts((prev) => prev.filter((_, index) => index !== action.index));
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        const memoList = getMemoListFromMergeSpan(memo.merge_span);
        const nextMemoList = memoList.filter((_, index) => index !== action.index);
        const nextMergeSpan = buildMergeSpanWithMemoList(memo.merge_span, nextMemoList);
        const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, memo.content, memo.bg_color, nextMergeSpan, memo.prescription, memo.body_part);
        if (success) anyChanged = true;
      }
      if (anyChanged) addToast('메모가 삭제되었습니다.', 'success');
      return;
    }
    else if (action?.type === 'memoUpdate') {
      const keys = Array.from(selectedKeys || []);
      let anyChanged = false;
      const nextValue = String(action.value || '').trim();
      setContextMenuMemoDrafts((prev) => prev.map((item, index) => index === action.index ? nextValue : item).filter(Boolean));
      for (const key of keys) {
        const [w, d, r, c] = key.split('-').map(Number);
        const memo = memos[key] || {};
        const memoList = getMemoListFromMergeSpan(memo.merge_span);
        const nextMemoList = memoList.map((item, index) => index === action.index ? nextValue : item).filter(Boolean);
        const nextMergeSpan = buildMergeSpanWithMemoList(memo.merge_span, nextMemoList);
        const success = await onSaveMemo(currentYear, currentMonth, w, d, r, c, memo.content, memo.bg_color, nextMergeSpan, memo.prescription, memo.body_part);
        if (success) anyChanged = true;
      }
      if (anyChanged) addToast('메모가 수정되었습니다.', 'success');
      return;
    }
    setContextMenu(null);
  }, [selectedKeys, memos, currentYear, currentMonth, onSaveMemo, addToast, handleCopySelection, handleCutSelection, handlePasteSelection, handleToggleTreatmentComplete, handleToggleTreatmentCancel, tryMergeSelection]);

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

  const repositionContextMenu = useCallback(() => {
    if (!contextMenuRef.current) return;
    const rect = contextMenuRef.current.getBoundingClientRect();
    const VIEWPORT_GAP = 12;
    const maxX = Math.max(VIEWPORT_GAP, window.innerWidth - rect.width - VIEWPORT_GAP);
    const maxY = Math.max(VIEWPORT_GAP, window.innerHeight - rect.height - VIEWPORT_GAP);

    setContextMenu((prev) => {
      if (!prev) return prev;
      const nextX = Math.min(Math.max(VIEWPORT_GAP, prev.x), maxX);
      const nextY = Math.min(Math.max(VIEWPORT_GAP, prev.y), maxY);
      if (nextX === prev.x && nextY === prev.y) return prev;
      return { ...prev, x: nextX, y: nextY };
    });
  }, []);

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
    flushSync(() => {
      setEditingCell(key);
      setEditValue(nextValue);
      if (preserveValue) setEditSessionId(Date.now());
    });
    focusEditInputImmediately();
  }, [focusEditInputImmediately]);

  const promoteFocusedInputToEditor = useCallback((key, value) => {
    flushSync(() => {
      setEditingCell(key);
      setEditValue(value);
    });
  }, []);

  // ── 키보드 이벤트 핸들러 (구글 시트 방식) ──
  const handleKeyDown = useCallback((e) => {
    if (e.defaultPrevented) return;
    if (isEditableTarget(e.target)) return;
    if (!selectedCell) return;
    const { w, d, r, c } = selectedCell;

    // 편집 중이면 대부분의 키를 무시
    if (editingCell) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setEditingCell(null);
      }
      return; // 편집 중에는 input이 키 이벤트를 처리
    }

    const isMeta = e.metaKey || e.ctrlKey;

    if (e.key === 'Hangul' || e.code === 'Lang1' || e.code === 'Lang2') {
      return;
    }

    // Enter → 편집 모드 진입
    if (e.key === 'Enter') {
      e.preventDefault();
      const key = cellKey(w, d, r, c);
      beginEditingCell(key, memos[key]?.content || '', true);
      return;
    }

    // F2 → 편집 모드 진입
    if (e.key === 'F2') {
      e.preventDefault();
      const key = cellKey(w, d, r, c);
      beginEditingCell(key, memos[key]?.content || '', true);
      return;
    }

    // Delete / Backspace → 선택된 셀 내용 삭제
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteCells(selectedKeys);
      return;
    }

    // 화살표 키 → 셀 이동
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const nextCell = getAdjacentCell({ w, d, r, c }, e.key);

      if (e.shiftKey) {
        setRangeEnd(nextCell);
        setSelectedKeys(buildRangeKeys(selectedCell, nextCell));
      } else {
        selectSingleCell(nextCell);
      }
      return;
    }

    // Ctrl/Cmd+G → 치료 완료 토글
    if (isMeta && e.code === 'KeyG') {
      e.preventDefault();
      e.stopPropagation();
      handleToggleTreatmentComplete();
      return;
    }

    // Ctrl/Cmd+B -> 휴일 배경색 토글
    if (isMeta && e.code === 'KeyB') {
      e.preventDefault();
      e.stopPropagation();
      handleToggleHolidayBackground();
      return;
    }

    // Cmd+E → 병합 / 병합 해제
    if (isMeta && e.code === 'KeyE') {
      e.preventDefault();
      tryMergeSelection();
      return;
    }

    // Tab → 우측 이동
    if (e.key === 'Tab') {
      e.preventDefault();
      const nc = e.shiftKey ? Math.max(0, c - 1) : Math.min(colCount - 1, c + 1);
      selectSingleCell({ w, d, r, c: nc });
      return;
    }

    // Cmd+C → 복사
    if (isMeta && e.code === 'KeyC') {
      e.preventDefault();
      handleCopySelection();
      return;
    }

    // Cmd+X → 잘라내기
    if (isMeta && e.code === 'KeyX') {
      e.preventDefault();
      handleCutSelection();
      return;
    }


    // 일반 문자 입력 → 편집 모드 진입 (기존 내용 대체)
    if ((e.key.length === 1 || e.key === 'Process' || e.keyCode === 229) && !isMeta && !e.altKey) {
      const key = cellKey(w, d, r, c);
      const isImeCompositionKey =
        e.key === 'Process' ||
        e.keyCode === 229 ||
        e.nativeEvent?.isComposing ||
        /[^\x00-\x7F]/.test(e.key);
      if (isImeCompositionKey) {
        e.stopPropagation();
        imeOpenRef.current = true;
        promoteFocusedInputToEditor(key, '');
      } else {
        e.preventDefault();
        beginEditingCell(key, e.key, false);
      }
      return;
    }
  }, [selectedCell, editingCell, selectedKeys, deleteCells, buildRangeKeys, selectSingleCell, getAdjacentCell, beginEditingCell, promoteFocusedInputToEditor, handleCopySelection, handleCutSelection, handlePasteSelection, handleToggleTreatmentComplete, handleToggleHolidayBackground, tryMergeSelection, isEditableTarget]);

  const dismissContextMenu = useCallback(() => setContextMenu(null), []);

  // 키보드 이벤트 등록

  useEffect(() => {
    const el = viewRef.current;
    if (el) {
      el.addEventListener('keydown', handleKeyDown);
      return () => el.removeEventListener('keydown', handleKeyDown);
    }
  }, [handleKeyDown]);

  useEffect(() => {
    const handlePasteEvent = (event) => {
      if (!selectedCell) return;

      const target = event.target;
      const isEditableTarget =
        (target instanceof HTMLInputElement && !target.dataset.hiddenInput) ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;
      if (isEditableTarget) return;

      const pastedText = event.clipboardData?.getData('text/plain');
      const pastedHtml = event.clipboardData?.getData('text/html');
      if (!pastedText) return;
      event.preventDefault();
      handlePasteSelection(pastedText, pastedHtml);
    };

    window.addEventListener('paste', handlePasteEvent, true);
    return () => window.removeEventListener('paste', handlePasteEvent, true);
  }, [selectedCell, handlePasteSelection]);

  useEffect(() => {
    const handleWindowKeyDown = (event) => {
      const target = event.target;
      if (isEditableTarget(target)) return;
      handleKeyDown(event);
    };

    window.addEventListener('keydown', handleWindowKeyDown, true);
    return () => window.removeEventListener('keydown', handleWindowKeyDown, true);
  }, [handleKeyDown, isEditableTarget]);

  useEffect(() => {
    const handleMouseUp = () => {
      dragSelectionRef.current = null;
    };

    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const handleContext = (event) => {
      if (!selectedKeys || selectedKeys.size === 0 || editingCell) {
        setContextMenu(null);
        return;
      }
      event.preventDefault();
      const MENU_WIDTH = 180;
      const MENU_HEIGHT = 180;
      const VIEWPORT_GAP = 12;
      const maxX = Math.max(VIEWPORT_GAP, window.innerWidth - MENU_WIDTH - VIEWPORT_GAP);
      const maxY = Math.max(VIEWPORT_GAP, window.innerHeight - MENU_HEIGHT - VIEWPORT_GAP);
      setContextMenu({
        x: Math.min(event.clientX, maxX),
        y: Math.min(event.clientY, maxY),
      });
    };
    el.addEventListener('contextmenu', handleContext);
    return () => el.removeEventListener('contextmenu', handleContext);
  }, [selectedKeys, editingCell]);

  useEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;

    repositionContextMenu();

    const menuEl = contextMenuRef.current;
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          repositionContextMenu();
        })
      : null;

    if (resizeObserver) resizeObserver.observe(menuEl);
    window.addEventListener('resize', repositionContextMenu);
    window.addEventListener('scroll', repositionContextMenu, true);

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', repositionContextMenu);
      window.removeEventListener('scroll', repositionContextMenu, true);
    };
  }, [contextMenu, repositionContextMenu]);

  useEffect(() => {
    if (contextMenu && (!selectedKeys || selectedKeys.size === 0)) {
      setContextMenu(null);
    }
  }, [contextMenu, selectedKeys]);

  useEffect(() => {
    const handleWindowClick = () => setContextMenu(null);
    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, []);

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
  }, [editingCell, editSessionId]);

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

  const handleContextMerge = useCallback(() => {
    tryMergeSelection();
  }, [tryMergeSelection]);

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

    if (left + width + edgePadding > viewportWidth) {
      left = clientX - width - offset;
    }
    if (top + height + edgePadding > viewportHeight) {
      top = clientY - height - offset;
    }

    left = Math.min(Math.max(edgePadding, left), Math.max(edgePadding, viewportWidth - width - edgePadding));
    top = Math.min(Math.max(edgePadding, top), Math.max(edgePadding, viewportHeight - height - edgePadding));

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
    tooltipEl.style.opacity = hoverData ? '1' : '0';
  }, [hoverData]);

  useEffect(() => {
    if (!hoverData || !tooltipRef.current) return;
    const { x, y } = tooltipMousePosRef.current;
    const rafId = window.requestAnimationFrame(() => {
      positionTooltip(x, y);
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [hoverData, positionTooltip]);

  const scrollToTodayWeek = useCallback(() => {
    if (todayWeekIdx < 0) return;
    const weekEl = weekRefs.current[todayWeekIdx];
    if (!weekEl) return;
    weekEl.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
  }, [todayWeekIdx]);

  return (
    <>
      <div 
        className="shockwave-view animate-fade-in" 
        ref={viewRef} 
        tabIndex={0} 
        style={{ outline: 'none' }}
        onMouseLeave={() => setHoverData(null)}
        onMouseMove={(e) => {
          tooltipMousePosRef.current = { x: e.clientX, y: e.clientY };
          if (tooltipRef.current) positionTooltip(e.clientX, e.clientY);
        }}
      >
      {weeks.map((weekDays, weekIdx) => (
        <div
          key={weekIdx}
          className={`shockwave-week${weekIdx === todayWeekIdx ? ' is-today-week' : ''}`}
          ref={(el) => {
            weekRefs.current[weekIdx] = el;
          }}
        >
          <div className="shockwave-week-label">
            <div className="shockwave-week-label-main">
              {weekIdx === 0 && (
                <div className="shockwave-month-title-group">
                  <button
                    type="button"
                    className="shockwave-month-nav-btn"
                    onClick={() => navigateMonth(-1)}
                    aria-label="이전 달"
                  >
                    ‹
                  </button>
                  <span className="shockwave-month-title">
                    {currentYear}년 {String(currentMonth).padStart(2, '0')}월 충격파/도수 스케줄
                  </span>
                  <button
                    type="button"
                    className="shockwave-month-nav-btn"
                    onClick={() => navigateMonth(1)}
                    aria-label="다음 달"
                  >
                    ›
                  </button>
                </div>
              )}
              <span className="shockwave-week-label-text">{weekIdx + 1}주차</span>
              <button
                type="button"
                className="shockwave-week-today-btn"
                onClick={scrollToTodayWeek}
                disabled={todayWeekIdx < 0}
              >
                오늘
              </button>
            </div>
            <div className="shockwave-week-label-actions">
              {weekIdx === 0 && (
                <button
                  type="button"
                  className="shockwave-week-today-btn"
                  onClick={() => setShowTherapistConfig(true)}
                >
                  🩺 치료사 설정
                </button>
              )}
            </div>
          </div>
          <div className="shockwave-days" style={{ position: 'relative' }}>
            {weekDays.map((dayInfo, dayIdx) => {
              const isToday = isSameDate(dayInfo.date, today);
              const thisDayKey = dayKey(weekIdx, dayIdx);
              const daySlots = getTimeSlotsForDay(dayInfo);
              // 첫 번째 요일에만 시간 열 표사
              const showTimeCol = dayIdx === 0;
              const therapistCols = colRatios
                ? colRatios.map(r => `minmax(0, ${r}fr)`).join(' ')
                : `repeat(${colCount}, minmax(0, 1fr))`;
              const gridCols = showTimeCol
                ? `${TIME_COL_WIDTH}px ${therapistCols}`
                : therapistCols;

              let headerClass = 'sw-day-header';
              if (dayInfo.isHoliday) headerClass += ' holiday';
              else if (!dayInfo.isCurrentMonth) headerClass += ' other-month';
              else if (isToday) headerClass += ' today';
              else if (dayInfo.dow === 6) headerClass += ' saturday';

              const targetColWidth = showTimeCol && dayColWidth ? dayColWidth + TIME_COL_WIDTH : dayColWidth;
              const flexBasis = showTimeCol ? TIME_COL_WIDTH : 0;
              const dayFlexStyle = targetColWidth
                ? { flex: `0 0 ${targetColWidth}px`, width: `${targetColWidth}px` }
                : { flex: `1 1 ${flexBasis}px`, minWidth: 0 };

              return (
                <div key={dayIdx} className={`shockwave-day${isToday ? ' is-today' : ''}`} style={dayFlexStyle}>
                  {/* 날짜 헤더 */}
                  <div className={headerClass}>
                    {formatDisplayDate(dayInfo.year, dayInfo.month, dayInfo.day)} ({DAY_NAMES[dayInfo.dow]})
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
                          <div key={ci} className={nameClass}>
                            {getTherapistNameForDate(ci, dayInfo.day) || `치료사${ci + 1}`}
                          </div>
                        );
                      })}
                    </div>
                    {/* 열 리사이즈 핸들 오버레이 */}
                    {colCount > 1 && Array.from({ length: colCount - 1 }, (_, ci) => {
                      const ratios = colRatios || Array(colCount).fill(1);
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
                            e.preventDefault(); e.stopPropagation();
                            const cur = colRatios ? [...colRatios] : Array(colCount).fill(1);
                            const cw = e.target.closest('.sw-therapist-header-wrapper').getBoundingClientRect().width - timeColPx;
                            colResizeRef.current = { active: true, colIdx: ci, startX: e.clientX, startRatios: [...cur], containerWidth: cw };
                            const onMove = (ev) => {
                              if (!colResizeRef.current.active) return;
                              const { startRatios: sr, containerWidth: w, colIdx: c, startX } = colResizeRef.current;
                              const d = ev.clientX - startX;
                              const tR = sr.reduce((a, b) => a + b, 0);
                              const dR = (d / w) * tR;
                              const nr = [...sr]; nr[c] = Math.max(0.2, sr[c] + dR); nr[c+1] = Math.max(0.2, sr[c+1] - dR);
                              setColRatios(nr);
                            };
                            const onUp = () => { colResizeRef.current.active = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                            window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
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
                        const cellData = memos[key];
                        const content = pendingDisplayValues[key] ?? cellData?.content ?? '';
                        const mergeSpan = cellData?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
                        const displayData = buildSchedulerCellDisplay(content, mergeSpan);
                          
                          if (mergeSpan.mergedInto) {
                            continue; // 병합된 하위 셀은 묶어서 렌더링 생략
                          }

                          const isEditing = editingCell === key;
                          const isSelected = selectedKeys.has(key);
                          const isPrimary = selectedCell && selectedCell.w === weekIdx && selectedCell.d === dayIdx && selectedCell.r === rowIdx && selectedCell.c === colIdx;
                          const gridColumnStart = showTimeCol ? colIdx + 2 : colIdx + 1;

                          // View Span Calculation (in case it spans across omitted rows like lunch)
                          let visualRowSpan = 1;
                          if (mergeSpan.rowSpan > 1) {
                            const endRowIdx = rowIdx + mergeSpan.rowSpan - 1;
                            visualRowSpan = daySlots.filter(s => s.idx >= rowIdx && s.idx <= endRowIdx).length;
                          }

                          let cls = 'sw-cell';
                          if (!dayInfo.isCurrentMonth) cls += ' other-month-bg';
                          else if (dayInfo.isHoliday) cls += ' holiday-bg';
                          
                          if (slotInfo.disabled && !displayData.hasDisplayText) cls += ' disabled';
                          
                          if (cellData?.bg_color === TREATMENT_COMPLETE_BG) cls += ' preserve';
                          if (cellData?.bg_color === TREATMENT_CANCEL_BG) cls += ' cancelled';
                          if (has4060Pattern(content)) cls += ' color-4060';
                          if (isSelected) cls += ' selected';
                          if (isPrimary) cls += ' primary-selected';

                          // Marching Ants Feedback
                          if (clipboardSource?.keys?.has(key)) {
                            cls += ` ants-active ${clipboardSource.mode === 'cut' ? 'ants-red' : 'ants-blue'}`;
                          }

                          const dateKey = `${dayInfo.year}-${dayInfo.month}-${dayInfo.day}`;
                          const therapistName = getTherapistNameForDate(colIdx, dayInfo.day) || '';
                          const workState = getTherapistWorkState(dateKey, therapistName);
                          if (!isSelected && workState === 'off') {
                            cls += ' staff-off';
                          } else if (!isSelected && workState === 'early-leave' && isLastHourSlot(dayInfo, slotInfo.time)) {
                            cls += ' staff-off';
                          }

                          let inlineStyle = {
                            gridColumn: `${gridColumnStart}${mergeSpan.colSpan > 1 ? ` / span ${mergeSpan.colSpan}` : ''}`,
                            gridRow: `${gridRowStart}${visualRowSpan > 1 ? ` / span ${visualRowSpan}` : ''}`,
                            borderBottom: isLastRenderedRow ? 'none' : `1px solid ${HORIZONTAL_BORDER_COLOR}`,
                          };

                          if (cellData?.bg_color) {
                            inlineStyle.backgroundColor = cellData.bg_color;
                          }
                          
                          if (cellData?.prescription && settings?.prescription_colors?.[cellData.prescription]) {
                            inlineStyle.color = settings.prescription_colors[cellData.prescription];
                            inlineStyle.fontWeight = '700';
                          }

                          // 마스터 셀 중앙 효과
                          if (visualRowSpan > 1 || mergeSpan.colSpan > 1) {
                            inlineStyle.display = 'flex';
                            inlineStyle.alignItems = 'center';
                            inlineStyle.justifyContent = 'center';
                            cls += ' merged-master';
                          }

                          const showInput = isPrimary || isEditing;

                          if (showInput) {
                            elements.push(
                              <div key={key} className={`sw-cell ${isEditing ? 'editing' : ''} ${cls}`} style={inlineStyle}
                                onMouseDown={(e) => handleCellMouseDown(weekIdx, dayIdx, rowIdx, colIdx, e)}
                                onMouseEnter={() => {
                                  handleCellMouseEnter(weekIdx, dayIdx, rowIdx, colIdx);
                                  let text = `⏱ [${slotInfo.label}]`;
                                  if (content && content !== '\u200B') text += `\n📝 ${content}`;
                                  if (cellData?.prescription) text += `\n💊 처방: ${cellData.prescription}`;
                                  if (cellData?.body_part) text += `\n🦴 부위: ${cellData.body_part}`;
                                  const memoList = getMemoListFromMergeSpan(cellData?.merge_span);
                                  if (memoList.length > 0) text += `\n📌 메모: ${memoList.join(' / ')}`;
                                  setHoverData({ text });
                                }}
                                onMouseLeave={() => setHoverData(null)}
                                onDoubleClick={() => handleCellDoubleClick(weekIdx, dayIdx, rowIdx, colIdx, content)}
                                onContextMenu={(e) => {
                                  // 내용이 있을 때만 처방을 설정할 수 있도록 함
                                  if (displayData.hasDisplayText && content.trim() !== '\u200B') {
                                    handleCellContextMenu(e, weekIdx, dayIdx, rowIdx, colIdx, cellData?.prescription);
                                  }
                                }}
                              >
                                {!isEditing && (
                                  <div className="sw-cell-display" style={{ pointerEvents: 'none', position: 'absolute', inset: 0, padding: 4 }}>
                                    {displayData.mainText ? <span className="sw-cell-main">{displayData.mainText}</span> : null}
                                  </div>
                                )}
                                <input
                                  key={isEditing && editSessionId ? editSessionId : 'hidden'}
                                  ref={(isEditing || isPrimary) ? editInputRef : null}
                                  className="sw-cell-input"
                                  data-hidden-input={!isEditing ? 'true' : undefined}
                                  defaultValue={isEditing ? editValue : ''}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => e.stopPropagation()}
                                  style={isEditing ? {
                                    position: 'relative',
                                    width: '100%', height: '100%',
                                    zIndex: 2,
                                    boxSizing: 'border-box'
                                  } : {
                                    position: 'absolute',
                                    top: 0, left: 0,
                                    width: '100%', height: '100%',
                                    opacity: 0,
                                    padding: 0, border: 'none', outline: 'none',
                                    pointerEvents: 'none',
                                    zIndex: 1,
                                  }}
                                  onInput={(e) => {
                                    if (!isEditing && e.currentTarget.value) {
                                      promoteFocusedInputToEditor(key, e.currentTarget.value);
                                    }
                                  }}
                                  onBlur={(e) => {
                                    if (isEditing) handleCellSave(weekIdx, dayIdx, rowIdx, colIdx, e.target.value);
                                  }}
                                  onKeyDown={e => {
                                    if (isEditing) handleEditKeyDown(e, weekIdx, dayIdx, rowIdx, colIdx);
                                  }}
                                  onCompositionStart={() => {
                                    imeOpenRef.current = true;
                                  }}
                                  onCompositionEnd={() => {
                                    imeOpenRef.current = false;
                                  }}
                                />
                              </div>
                            );
                          } else {
                            elements.push(
                              <div
                                key={key}
                                className={cls}
                                style={inlineStyle}
                                onMouseDown={(e) => handleCellMouseDown(weekIdx, dayIdx, rowIdx, colIdx, e)}
                                onMouseEnter={() => {
                                  handleCellMouseEnter(weekIdx, dayIdx, rowIdx, colIdx);
                                  let text = `⏱ [${slotInfo.label}]`;
                                  if (content && content !== '\u200B') text += `\n📝 ${content}`;

                                  if (isSelected && selectedKeys.size > 1 && selectionInfo && selectionInfo.w === weekIdx && selectionInfo.d === dayIdx && selectionInfo.minRow !== selectionInfo.maxRow) {
                                    const slots = getTimeSlotsForDay(dayInfo);
                                    const sStart = slots.find(s => s.idx === selectionInfo.minRow);
                                    const sEnd = slots.find(s => s.idx === selectionInfo.maxRow);
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
                                      
                                      text = `⏱ [${t1} ~ ${t2}] (총 ${dStr})`;
                                      if (content && content !== '\u200B') text += `\n📝 ${content}`;
                                    }
                                  }
                                  if (cellData?.prescription) text += `\n💊 처방: ${cellData.prescription}`;
                                  if (cellData?.body_part) text += `\n🦴 부위: ${cellData.body_part}`;
                                  const memoList = getMemoListFromMergeSpan(cellData?.merge_span);
                                  if (memoList.length > 0) text += `\n📌 메모: ${memoList.join(' / ')}`;
                                  setHoverData({ text });
                                }}
                                onMouseLeave={() => setHoverData(null)}
                                onDoubleClick={() => handleCellDoubleClick(weekIdx, dayIdx, rowIdx, colIdx, content)}
                                onContextMenu={(e) => {
                                  // 내용이 있을 때만 처방을 설정할 수 있도록 함
                                  if (displayData.hasDisplayText && content.trim() !== '\u200B') {
                                    handleCellContextMenu(e, weekIdx, dayIdx, rowIdx, colIdx, cellData?.prescription);
                                  }
                                }}
                              >
                                <div className="sw-cell-display">
                                  {displayData.mainText ? <span className="sw-cell-main">{displayData.mainText}</span> : null}
                                </div>
                              </div>
                            );
                          }
                        }
                      return elements;
                    })}
                  </div>

                  {dayIdx < weekDays.length - 1 && (
                    <div
                      className="sw-day-resize-handle"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const currentDayWidth = e.currentTarget.closest('.shockwave-day').getBoundingClientRect().width;
                        const normalizedDayWidth = showTimeCol
                          ? Math.max(100, currentDayWidth - TIME_COL_WIDTH)
                          : currentDayWidth;
                        dayResizeRef.current = { active: true, startX: e.clientX, startWidth: currentDayWidth, factor: 1 };
                        const onMove = (ev) => {
                          if (!dayResizeRef.current.active) return;
                          const { startX } = dayResizeRef.current;
                          const delta = ev.clientX - startX;
                          const newWidth = Math.max(100, Math.min(600, normalizedDayWidth + delta));
                          setDayColWidth(newWidth);
                        };
                        const onUp = () => {
                          dayResizeRef.current.active = false;
                          window.removeEventListener('mousemove', onMove);
                          window.removeEventListener('mouseup', onUp);
                        };
                        window.addEventListener('mousemove', onMove);
                        window.addEventListener('mouseup', onUp);
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      </div>
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="shockwave-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const firstKey = selectedKeys ? Array.from(selectedKeys)[0] : null;
            const currentMemo = firstKey ? (memos[firstKey] || {}) : {};
            const currentPrescription = currentMemo?.prescription || '';
            const currentBodyPart = currentMemo?.body_part || '';
            const currentParts = splitBodyParts(currentBodyPart);
            const currentMemoList = getMemoListFromMergeSpan(currentMemo?.merge_span);
            const { patientChart, patientName } = parseSchedulerPatientIdentity(currentMemo?.content || '');
            const currentKeyParts = firstKey ? firstKey.split('-').map(Number) : null;
            const currentSortKey = currentKeyParts
              ? `${weeks[currentKeyParts[0]]?.[currentKeyParts[1]]?.date?.toISOString?.().slice(0, 10) || ''}-${String(currentKeyParts[2]).padStart(3, '0')}-${String(currentKeyParts[3]).padStart(3, '0')}`
              : '';
            let previousPrescription = null;

            const patientBodyPartsMap = new Map();
            Object.entries(memos || {}).forEach(([memoKey, m]) => {
              if (!m?.content) return;
              const { patientChart: mChart, patientName: mName } = parseSchedulerPatientIdentity(m.content);
              const isMatch = (patientChart && mChart && patientChart === mChart) || (patientName && mName && patientName === mName);
              if (isMatch) {
                if (m.body_part) {
                  splitBodyParts(m.body_part).forEach((part) => addBodyPartToMap(patientBodyPartsMap, part));
                }
                if (!m.prescription || memoKey === firstKey) return;
                const memoKeyParts = memoKey.split('-').map(Number);
                const memoSortKey = `${weeks[memoKeyParts[0]]?.[memoKeyParts[1]]?.date?.toISOString?.().slice(0, 10) || ''}-${String(memoKeyParts[2]).padStart(3, '0')}-${String(memoKeyParts[3]).padStart(3, '0')}`;
                if (memoSortKey < currentSortKey && (!previousPrescription || memoSortKey > previousPrescription.sortKey)) {
                  previousPrescription = { value: m.prescription, sortKey: memoSortKey };
                }
              }
            });
            currentParts.forEach((part) => addBodyPartToMap(patientBodyPartsMap, part));
            const availableParts = Array.from(patientBodyPartsMap.values()).sort();
            const previousPrescriptionValue = previousPrescription?.value || '';

            return (
              <>
                <div className="context-menu-action-panel">
                  <div className="context-menu-actions-grid">
                    <button type="button" className="context-menu-item" onClick={() => handleContextAction('copy')}>
                      복사
                    </button>
                    <button type="button" className="context-menu-item" onClick={() => handleContextAction('cut')}>
                      잘라내기
                    </button>
                    <button type="button" className="context-menu-item" onClick={() => handleContextAction('paste')}>
                      붙여넣기
                    </button>
                    {!selectionInfo?.isMergedMaster ? (
                      <button
                        type="button"
                        className="context-menu-item"
                        onClick={() => handleContextAction('merge')}
                        disabled={!selectionInfo?.selectionMultiple}
                      >
                        셀 병합
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="context-menu-item"
                        onClick={() => handleContextAction('unmerge')}
                      >
                        병합 해제
                      </button>
                    )}
                    <button
                      type="button"
                      className="context-menu-item context-menu-item-complete"
                      onClick={() => handleContextAction('complete-toggle')}
                      disabled={!hasCompletableSelection}
                    >
                      {treatmentCompleteButtonLabel}
                    </button>
                    <button
                      type="button"
                      className="context-menu-item context-menu-item-clear-complete"
                      onClick={() => handleContextAction('cancel-toggle')}
                      disabled={!hasCompletableSelection}
                    >
                      예약 취소
                    </button>
                  </div>
                </div>

                <div className="context-menu-editor-panel">
                  <div className="context-menu-inline-grid">
                    <div className="context-menu-inline-column">
                      <div className="context-menu-inline-label">처방</div>
                      <div className="context-menu-prescription-row">
                        {previousPrescriptionValue ? (
                          <span className="context-menu-current-prescription">{previousPrescriptionValue}</span>
                        ) : null}
                        <select
                          className="context-menu-select"
                          value={currentPrescription}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleContextAction({ type: 'prescription', value: e.target.value || null });
                          }}
                          onMouseDown={e => e.stopPropagation()}
                          onClick={e => e.stopPropagation()}
                        >
                          <option value="">처방 없음</option>
                          {settings?.prescriptions?.map((pres) => (
                            <option key={pres} value={pres}>{pres}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="context-menu-inline-column">
                      <div className="context-menu-inline-label">부위</div>
                      <details className="context-menu-body-dropdown" onMouseDown={(e) => e.stopPropagation()}>
                        <summary className="context-menu-body-summary">
                          {currentParts.join(', ') || '부위 선택'}
                        </summary>
                        <div className="context-menu-body-panel">
                          {availableParts.length > 0 ? (
                            <div className="context-menu-checklist">
                              {availableParts.map((part, idx) => {
                                const isChecked = currentParts.some((p) => normalizeBodyPartKey(p) === normalizeBodyPartKey(part));
                                return (
                                  <label key={idx} className="context-menu-check-item">
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
                                );
                              })}
                            </div>
                          ) : currentParts.length === 0 ? (
                            <div className="context-menu-empty">등록된 부위가 없습니다.</div>
                          ) : null}
                          <div className="context-menu-input-row">
                            <input
                              type="text"
                              placeholder="새 부위 추가"
                              className="context-menu-input"
                              value={contextMenuBodyInput}
                              onChange={(e) => {
                                e.stopPropagation();
                                setContextMenuBodyInput(e.target.value);
                              }}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  submitContextMenuBodyInput();
                                }
                              }}
                              onCompositionStart={() => {
                                imeOpenRef.current = true;
                              }}
                              onCompositionEnd={() => {
                                imeOpenRef.current = false;
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
                                submitContextMenuBodyInput();
                              }}
                            >
                              추가
                            </button>
                          </div>
                        </div>
                      </details>
                    </div>

                    <div className="context-menu-inline-column context-menu-inline-column--full">
                      <div className="context-menu-inline-label">메모</div>
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
                        ) : (
                          <div className="context-menu-empty">메모 없음</div>
                        )}
                        <div className="context-menu-input-row">
                          <input
                            type="text"
                            placeholder="메모 추가"
                            className="context-menu-input"
                            value={contextMenuNoteInput}
                            onChange={(e) => {
                              e.stopPropagation();
                              setContextMenuNoteInput(e.target.value);
                            }}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                submitContextMenuNoteInput();
                              }
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
                              submitContextMenuNoteInput();
                            }}
                          >
                            추가
                          </button>
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

      {chartSelector && (
        <div className="shockwave-chart-selector-backdrop" onMouseDown={() => handleChartSelectorClose(null)}>
          <div className="shockwave-chart-selector" onMouseDown={(e) => e.stopPropagation()}>
            <div className="shockwave-chart-selector-title">이력 선택</div>
            <div className="shockwave-chart-selector-subtitle">
              {chartSelector.rawName} 환자의 자동완성 이력을 선택하세요.
            </div>
            <div className="shockwave-chart-selector-options">
              {chartSelector.options.map((option) => (
                <button
                  key={`${option.chartNumber}-${option.type}-${option.doseTag || 'default'}-${option.lastDate}`}
                  type="button"
                  className="shockwave-chart-selector-option"
                  onClick={() => handleChartSelectorClose(option)}
                >
                  <span>{option.chartNumber}</span>
                  <span>{option.namePart}</span>
                  <span>{option.optionLabel}</span>
                  <span>{option.nextVisit}회차</span>
                  <span>{option.lastDate}</span>
                </button>
              ))}
            </div>
            <div className="shockwave-chart-selector-actions">
              <button
                type="button"
                className="shockwave-chart-selector-cancel"
                onClick={() => handleChartSelectorClose(null)}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {autoFillDialog && (
        <AutoFillDialogInner
          dlg={autoFillDialog}
          onConfirm={handleAutoFillConfirm}
          onCancel={handleAutoFillCancel}
        />
      )}

      {hoverData && (
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
          {hoverData.text.split('\n').map((line, i) => <div key={i}>{line}</div>)}
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
          onClose={() => setShowTherapistConfig(false)}
        />
      )}
    </>
  );
}

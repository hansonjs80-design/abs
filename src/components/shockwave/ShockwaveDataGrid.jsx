import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } from 'react';
/* eslint-disable react-hooks/exhaustive-deps */
import { supabase } from '../../lib/supabaseClient';
import { normalizeNameForMatch } from '../../lib/memoParser';
import { buildDisplayTherapists } from '../../lib/therapistDisplayUtils';
import { getTodayKST } from '../../lib/calendarUtils';
import { useSchedule } from '../../contexts/ScheduleContext';
import { useToast } from '../common/Toast';
import {
  FIXED_FIELDS,
  SUMMARY_COL_WIDTH,
  THERAPIST_COLORS,
  THERAPIST_TOTAL_COLORS,
  findNearestDateRowIndex,
  isEditableShortcutTarget,
  prescriptionsMatch,
  toDateKey,
  toTitleCaseBodyPart,
} from './shockwaveDataGridUtils';
import '../../styles/shockwave_stats.css';

function parseFlexibleDate(val, currentYear, currentMonth) {
  const clean = String(val || '').trim();
  if (!clean) return '';

  // 1. 이미 YYYY-MM-DD 형식인 경우 그대로 리턴
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;

  // 2. YYYY.MM.DD 또는 YYYY/MM/DD 또는 YYYY-MM-DD 대응
  const fullDateMatch = clean.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (fullDateMatch) {
    return `${fullDateMatch[1]}-${fullDateMatch[2].padStart(2, '0')}-${fullDateMatch[3].padStart(2, '0')}`;
  }

  // 3. MM.DD 또는 MM/DD 또는 MM-DD 대응
  const partialDateMatch = clean.match(/^(\d{1,2})[-./](\d{1,2})$/);
  if (partialDateMatch) {
    return `${currentYear}-${partialDateMatch[1].padStart(2, '0')}-${partialDateMatch[2].padStart(2, '0')}`;
  }

  // 4. MMDD 또는 YYYYMMDD 대응 (구분자 없는 경우)
  if (/^\d{8}$/.test(clean)) {
    return `${clean.substring(0, 4)}-${clean.substring(4, 6)}-${clean.substring(6, 8)}`;
  }
  if (/^\d{4}$/.test(clean)) {
    return `${currentYear}-${clean.substring(0, 2)}-${clean.substring(2, 4)}`;
  }

  // 5. 1~2자리 숫자만 있는 경우 (일(Day) 정보로 간주)
  if (/^\d{1,2}$/.test(clean)) {
    return `${currentYear}-${String(currentMonth).padStart(2, '0')}-${clean.padStart(2, '0')}`;
  }

  // 기본값으로 원본 반환
  return clean;
}

const TOOLTIP_ACCENT_COLORS = {
  '#dbeafe': '#2563eb',
  '#ffedd5': '#c2410c',
  '#e9ddff': '#7c3aed',
  '#d8f3ea': '#047857',
  '#ffe7c7': '#b45309',
  '#ffdced': '#be185d',
};

function getTooltipAccentColor(backgroundColor) {
  return TOOLTIP_ACCENT_COLORS[String(backgroundColor || '').toLowerCase()] || '#1e293b';
}

export default function ShockwaveDataGrid({
  logs,
  therapists,
  monthlyTherapists,
  currentYear,
  currentMonth,
  fetchLogs,
  extraDraftRows = 0,
  tableName = 'shockwave_patient_logs',
  prescriptions: prescriptionsProp,
  frozenColumnCount: _frozenColumnCountProp,
  title,
  secondarySummaryLabel = '신환',
  selectedTherapistNames: externalSelectedNames,
  onSelectedTherapistNamesChange,
  readOnly = false,
}) {
  const { addToast } = useToast();
  const { shockwaveSettings: settings } = useSchedule();
  const safeInputLogs = useMemo(
    () => (Array.isArray(logs) ? logs.filter(Boolean) : []),
    [logs]
  );
  const safeTherapists = useMemo(
    () => (Array.isArray(therapists) ? therapists.filter(Boolean) : []),
    [therapists]
  );
  const displayTherapists = useMemo(
    () => buildDisplayTherapists(safeTherapists, monthlyTherapists),
    [safeTherapists, monthlyTherapists]
  );
  const [internalSelectedNames, setInternalSelectedNames] = useState([]);
  const isControlled = externalSelectedNames !== undefined && onSelectedTherapistNamesChange !== undefined;
  const selectedTherapistNames = isControlled ? externalSelectedNames : internalSelectedNames;
  const therapistNameList = useMemo(
    () => displayTherapists.map((therapist) => therapist.name).filter(Boolean),
    [displayTherapists]
  );
  useEffect(() => {
    if (isControlled) return;
    setInternalSelectedNames((prev) => {
      if (therapistNameList.length === 0) return [];
      const valid = prev.filter((name) => therapistNameList.includes(name));
      return valid.length > 0 ? valid : therapistNameList;
    });
  }, [therapistNameList, isControlled]);
  const selectedTherapistSet = useMemo(
    () => new Set(selectedTherapistNames),
    [selectedTherapistNames]
  );
  const isAllTherapistsSelected = selectedTherapistNames.length === therapistNameList.length;
  const filteredInputLogs = useMemo(() => {
    if (isAllTherapistsSelected || selectedTherapistSet.size === 0) return safeInputLogs;
    return safeInputLogs.filter((log) => selectedTherapistSet.has(log?.therapist_name));
  }, [isAllTherapistsSelected, safeInputLogs, selectedTherapistSet]);
  const visibleTherapists = useMemo(() => {
    if (isAllTherapistsSelected || selectedTherapistSet.size === 0) return displayTherapists;
    return displayTherapists.filter((therapist) => selectedTherapistSet.has(therapist.name));
  }, [displayTherapists, isAllTherapistsSelected, selectedTherapistSet]);
  const prescriptions = useMemo(() => {
    const source = prescriptionsProp || settings?.prescriptions || ['F1.5', 'F/Rdc', 'F/R'];
    return Array.isArray(source) ? source.filter(Boolean) : ['F1.5', 'F/Rdc', 'F/R'];
  }, [prescriptionsProp, settings?.prescriptions]);
  const gridTitle = title || `${currentYear}년 ${String(currentMonth).padStart(2, '0')}월 충격파 현황`;
  const runSyncForDate = useCallback(async () => {
    // 통계/현황 탭은 스케줄 표를 다시 쓰지 않는다.
    // 스케줄 표가 원본이고, 현황 로그는 스케줄 저장 시 단방향으로 갱신된다.
  }, []);

  const [insertedDraftRows, setInsertedDraftRows] = useState([]);
  const [draftCellValues, setDraftCellValues] = useState({});
  const [clipboardSource, setClipboardSource] = useState(null); // { r1, c1, r2, c2, mode: 'copy'|'cut' }
  const [undoStack, setUndoStack] = useState([]);
  const rowClipboardRef = useRef({ row: null, mode: null });
  const rowOrderRef = useRef(new Map());
  const editSaveRequestRef = useRef(0);
  const bulkMutationRequestRef = useRef(0);
  const isComposingRef = useRef(false);

  // ─── 1. DATA PREPARATION ─────────────────────────────────
  const gridData = useMemo(() => {
    // Filter out saved logs that have no patient name (Row Compaction)
    const namedLogs = filteredInputLogs.filter(log => log && log.patient_name?.trim());
    const sorted = [...namedLogs]
      .sort((a, b) => {
        const dateCompare = String(a?.date || '').localeCompare(String(b?.date || ''));
        if (dateCompare !== 0) return dateCompare;
        // Group same chart_number/patient_name together within the same date
        const aChart = String(a?.chart_number || '').trim();
        const bChart = String(b?.chart_number || '').trim();
        const aName = String(a?.patient_name || '').replace(/\*/g, '').trim();
        const bName = String(b?.patient_name || '').replace(/\*/g, '').trim();
        const groupKeyA = aChart || aName;
        const groupKeyB = bChart || bName;
        if (groupKeyA && groupKeyB && groupKeyA !== groupKeyB) {
          // Preserve first-appearance order: use the earliest rowOrder or created_at within each group
          const aOrder = rowOrderRef.current.get(a?.id);
          const bOrder = rowOrderRef.current.get(b?.id);
          const aFirst = typeof aOrder === 'number' ? aOrder : Infinity;
          const bFirst = typeof bOrder === 'number' ? bOrder : Infinity;
          return aFirst - bFirst;
        }
        // Within same group (same patient), preserve existing order
        const aOrder = rowOrderRef.current.get(a?.id);
        const bOrder = rowOrderRef.current.get(b?.id);
        if (typeof aOrder === 'number' && typeof bOrder === 'number' && aOrder !== bOrder) {
          return aOrder - bOrder;
        }
        if (typeof aOrder === 'number' && typeof bOrder !== 'number') return -1;
        if (typeof aOrder !== 'number' && typeof bOrder === 'number') return 1;
        return String(a?.created_at || '').localeCompare(String(b?.created_at || ''));
      })
      .map((log) => ({ ...log, ...(draftCellValues[log.id] || {}) }));

    const rows = [...sorted];

    insertedDraftRows.forEach((draft) => {
      const row = {
        id: draft.id,
        date: draft.date || '',
        patient_name: draft.patient_name || '',
        chart_number: draft.chart_number || '',
        visit_count: draft.visit_count || '',
        body_part: draft.body_part || '',
        therapist_name: draft.therapist_name || '',
        prescription: draft.prescription || '',
        prescription_count: draft.prescription_count || '',
        isDraft: true,
        isInsertedDraft: true,
      };

      const anchorIndex = rows.findIndex((item) => item.id === draft.anchorId);
      if (anchorIndex < 0) {
        rows.push(row);
        return;
      }

      const insertIndex = draft.placement === 'after' ? anchorIndex + 1 : anchorIndex;
      rows.splice(insertIndex, 0, row);
    });

    const flat = [];
    for (let i = 0; i < rows.length; ) {
      const current = rows[i];
      const date = String(current?.date || '');

      if (!date) {
        flat.push({ ...current, _isFirst: true, _isLast: true, _groupSize: 1 });
        i += 1;
        continue;
      }

      let j = i;
      while (j < rows.length && String(rows[j]?.date || '') === date) j += 1;

      for (let k = i; k < j; k += 1) {
        flat.push({
          ...rows[k],
          _isFirst: k === i,
          _isLast: k === j - 1,
          _groupSize: j - i,
        });
      }

      i = j;
    }

    // Read-only stats pages should not pay to render unused editable draft rows.
    const draftsNeeded = readOnly
      ? Math.max(0, extraDraftRows)
      : Math.max(60 - flat.length, 30) + extraDraftRows;
    for (let i = 0; i < draftsNeeded; i++) {
      const draftId = `draft-${i}`;
      flat.push({
        id: draftId,
        date: '', patient_name: '', chart_number: '', visit_count: '',
        body_part: '', therapist_name: '', prescription: '', prescription_count: '',
        ...(draftCellValues[draftId] || {}),
        isDraft: true, _isFirst: true, _isLast: true, _groupSize: 1,
      });
    }
    return flat;
  }, [filteredInputLogs, extraDraftRows, insertedDraftRows, draftCellValues, readOnly]);

  const rememberCurrentRowOrder = useCallback(() => {
    const nextOrder = new Map();
    gridData.forEach((row, index) => {
      if (!row?.id || row.isDraft) return;
      nextOrder.set(row.id, index);
    });
    rowOrderRef.current = nextOrder;
  }, [gridData]);

  useEffect(() => {
    setInsertedDraftRows([]);
    setDraftCellValues({});
  }, [currentYear, currentMonth]);

  const frozenColumnCount = 0;

  const totalCountColIndex = FIXED_FIELDS.length + visibleTherapists.length * prescriptions.length;
  const newPatientColIndex = totalCountColIndex + 1;
  const totalColCount = newPatientColIndex + 1;
  const therapistColumnWidth = useMemo(() => {
    const count = Math.max(1, visibleTherapists.length);
    if (count <= 2) return 69;
    if (count <= 4) return 64;
    if (count <= 6) return 57;
    return 52;
  }, [visibleTherapists.length]);
  const gridMinWidth = useMemo(() => {
    const fixedWidth = FIXED_FIELDS.reduce((sum, field) => sum + field.w, 0);
    const therapistWidth = visibleTherapists.length * prescriptions.length * therapistColumnWidth;
    return fixedWidth + therapistWidth + SUMMARY_COL_WIDTH * 2;
  }, [visibleTherapists.length, prescriptions.length, therapistColumnWidth]);
  const getColumnWidth = useCallback((colIndex) => {
    if (colIndex < FIXED_FIELDS.length) return FIXED_FIELDS[colIndex]?.w || 48;
    if (colIndex >= FIXED_FIELDS.length && colIndex < totalCountColIndex) return therapistColumnWidth;
    return SUMMARY_COL_WIDTH;
  }, [totalCountColIndex, therapistColumnWidth]);
  const getFrozenLeft = useCallback((colIndex) => {
    let left = 0;
    for (let i = 0; i < colIndex; i += 1) {
      left += getColumnWidth(i);
    }
    return left;
  }, [getColumnWidth]);
  const ROW_DATA_FIELDS = [
    ...FIXED_FIELDS.filter(f => f.id !== 'idx').map((field) => field.field),
    'therapist_name',
    'prescription',
    'prescription_count',
  ];

  const isTherapistGroupStartCol = (colIdx) => (
    colIdx >= FIXED_FIELDS.length &&
    colIdx < totalCountColIndex &&
    (colIdx - FIXED_FIELDS.length) % prescriptions.length === 0
  );
  const isTherapistGroupEndCol = (colIdx) => (
    colIdx >= FIXED_FIELDS.length &&
    colIdx < totalCountColIndex &&
    (colIdx - FIXED_FIELDS.length) % prescriptions.length === prescriptions.length - 1
  );
  const isBlankValue = (value) => value == null || String(value).trim() === '';
  const toPrescriptionCount = (value) => {
    const parsed = parseInt(String(value ?? '').trim(), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const isRowEmpty = (row) => ROW_DATA_FIELDS.every((field) => isBlankValue(row?.[field]));
  const createEmptyPrescriptionCounts = () => Object.fromEntries(prescriptions.map(p => [p, 0]));
  const createEmptyTherapistCounts = () => Object.fromEntries(
    visibleTherapists.map(t => [t.name, createEmptyPrescriptionCounts()])
  );
  const createEmptyNewPatientCounts = () => Object.fromEntries(
    visibleTherapists.map(t => [t.name, 0])
  );
  const dateSummaries = useMemo(() => {
    const summaries = new Map();
    gridData.forEach((row) => {
      if (!row?.date) return;
      const current = summaries.get(row.date) || { 
        total: 0, 
        newPatient: 0, 
        byPrescription: createEmptyPrescriptionCounts(),
        byTherapistPrescription: createEmptyTherapistCounts(),
        newPatientByTherapist: createEmptyNewPatientCounts(),
      };
      if (row.prescription) {
        const count = toPrescriptionCount(row.prescription_count);
        current.total += count;
        const matched = prescriptions.find(p => prescriptionsMatch(row.prescription, p));
        if (matched) {
          current.byPrescription[matched] = (current.byPrescription[matched] || 0) + count;
          if (row.therapist_name) {
            if (!current.byTherapistPrescription[row.therapist_name]) {
              current.byTherapistPrescription[row.therapist_name] = createEmptyPrescriptionCounts();
            }
            current.byTherapistPrescription[row.therapist_name][matched] =
              (current.byTherapistPrescription[row.therapist_name][matched] || 0) + count;
          }
        }
      }
      if (String(row.patient_name || '').includes('*')) {
        current.newPatient += 1;
        if (row.therapist_name) {
          current.newPatientByTherapist[row.therapist_name] =
            (current.newPatientByTherapist[row.therapist_name] || 0) + 1;
        }
      }
      summaries.set(row.date, current);
    });
    return summaries;
  }, [gridData, prescriptions, visibleTherapists]);

  const formatFullDateLabel = useCallback((date) => {
    const parts = String(date || '').split('-');
    if (parts.length !== 3) return String(date || '');
    return `${Number(parts[0])}년 ${Number(parts[1])}월 ${Number(parts[2])}일`;
  }, []);

  const getTherapistCountTooltip = useCallback((row, colIdx) => {
    if (!row?.date || colIdx < FIXED_FIELDS.length || colIdx >= totalCountColIndex) return null;
    const tIdx = Math.floor((colIdx - FIXED_FIELDS.length) / prescriptions.length);
    const therapist = visibleTherapists[tIdx];
    if (!therapist) return null;
    const summary = dateSummaries.get(row.date);
    const counts = summary?.byTherapistPrescription?.[therapist.name] || {};
    const items = prescriptions.map(p => ({ label: p, count: counts[p] || 0 }));
    return {
      date: formatFullDateLabel(row.date),
      therapistName: therapist.name,
      therapistColor: THERAPIST_COLORS[tIdx % THERAPIST_COLORS.length],
      tooltipAccentColor: getTooltipAccentColor(THERAPIST_COLORS[tIdx % THERAPIST_COLORS.length]),
      totalCount: items.reduce((sum, item) => sum + item.count, 0),
      items,
    };
  }, [dateSummaries, formatFullDateLabel, prescriptions, totalCountColIndex, visibleTherapists]);

  // ─── 2. CELL VALUE HELPERS ────────────────────────────────
  const getVal = (row, colIdx) => {
    if (colIdx === 0) {
      const idx = gridData.indexOf(row);
      return idx >= 0 ? idx + 1 : '';
    }
    if (colIdx < FIXED_FIELDS.length) {
      const f = FIXED_FIELDS[colIdx];
      if (f.id === 'date') {
        if (!row.date) return '';
        const p = row.date.split('-');
        return p.length === 3 ? `${p[1]}/${p[2]}` : row.date;
      }
      return row[f.field] || '';
    }
    if (colIdx === totalCountColIndex) {
      if (!row._isFirst) return '';
      return dateSummaries.get(row.date)?.total || '';
    }
    if (colIdx === newPatientColIndex) {
      if (!row._isFirst) return '';
      return dateSummaries.get(row.date)?.newPatient || '';
    }
    const tIdx = Math.floor((colIdx - FIXED_FIELDS.length) / prescriptions.length);
    const pIdx = (colIdx - FIXED_FIELDS.length) % prescriptions.length;
    const t = visibleTherapists[tIdx];
    if (!t) return '';
    const pres = prescriptions[pIdx];
    if (row.therapist_name === t.name && prescriptionsMatch(row.prescription, pres)) {
      return (row.prescription_count !== null && row.prescription_count !== undefined) ? row.prescription_count : '1';
    }
    return '';
  };

  // ─── 3. SELECTION, FOCUS, EDIT STATE ──────────────────────
  const [focus, setFocus] = useState(null); // {r, c}
  const [sel, setSel] = useState(null); // {r1,c1,r2,c2}
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(null); // {r,c,val}
  const [ctxMenu, setCtxMenu] = useState(null);
  const [countTooltip, setCountTooltip] = useState(null);
  const [mergedCells, setMergedCells] = useState({}); // key "r-c" -> {rs, cs}

  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const imeOpenRef = useRef(false);
  const editingValueRef = useRef('');
  const datePickerRef = useRef(null);
  const ctxMenuRef = useRef(null);
  const todayDateKey = useMemo(() => toDateKey(getTodayKST()), []);

  const showCountTooltip = useCallback((target, tooltip) => {
    if (!target || !tooltip) return;
    const rect = target.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
    const tooltipWidth = Math.min(224, Math.max(154, viewportWidth - 24));
    const halfWidth = tooltipWidth / 2;
    const minX = 12 + halfWidth;
    const maxX = viewportWidth - 12 - halfWidth;
    const rawX = rect.left + rect.width / 2;
    const x = Math.min(Math.max(rawX, minX), Math.max(minX, maxX));
    const estimatedHeight = 94;
    const showAbove = rect.bottom + estimatedHeight + 12 > viewportHeight && rect.top > estimatedHeight + 12;
    setCountTooltip({
      ...tooltip,
      x,
      y: showAbove ? rect.top - 8 : rect.bottom + 8,
      width: tooltipWidth,
      placement: showAbove ? 'above' : 'below',
    });
  }, []);

  const hideCountTooltip = useCallback(() => {
    setCountTooltip(null);
  }, []);

  const selNorm = sel ? {
    r1: Math.min(sel.r1, sel.r2), c1: Math.min(sel.c1, sel.c2),
    r2: Math.max(sel.r1, sel.r2), c2: Math.max(sel.c1, sel.c2),
  } : null;

  const inSel = (r, c) => selNorm && r >= selNorm.r1 && r <= selNorm.r2 && c >= selNorm.c1 && c <= selNorm.c2;

  // ─── 4. MERGE / UNMERGE ───────────────────────────────────
  const getMergeKey = (r, c) => `${r}-${c}`;
  const makeRowSnapshot = useCallback((row) => ({
    date: row?.date || '',
    patient_name: row?.patient_name || '',
    chart_number: row?.chart_number || '',
    visit_count: row?.visit_count || '',
    body_part: row?.body_part || '',
    therapist_name: row?.therapist_name || '',
    prescription: row?.prescription || '',
    prescription_count: row?.prescription_count || '',
  }), []);

  const setLocalDraftRow = useCallback((rowId, nextValues, isInsertedDraft) => {
    const normalized = {
      date: nextValues?.date || '',
      patient_name: nextValues?.patient_name || '',
      chart_number: nextValues?.chart_number || '',
      visit_count: nextValues?.visit_count || '',
      body_part: nextValues?.body_part || '',
      therapist_name: nextValues?.therapist_name || '',
      prescription: nextValues?.prescription || '',
      prescription_count: nextValues?.prescription_count || '',
    };

    if (isInsertedDraft) {
      setInsertedDraftRows((prev) => prev.map((item) => (
        item.id === rowId ? { ...item, ...normalized } : item
      )));
      return;
    }

    setDraftCellValues((prev) => ({
      ...prev,
      [rowId]: normalized,
    }));
  }, []);

  const clearLocalDraftRow = useCallback((rowId, isInsertedDraft) => {
    if (isInsertedDraft) {
      setInsertedDraftRows((prev) => prev.filter((item) => item.id !== rowId));
      return;
    }
    setDraftCellValues((prev) => {
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
  }, []);

  const applyRowSnapshot = useCallback(async (targetRow, snapshot) => {
    if (!targetRow || !snapshot) return;
    const affectedDates = new Set();
    if (targetRow?.date) affectedDates.add(targetRow.date);
    if (snapshot?.date) affectedDates.add(snapshot.date);

    const payload = {
      date: snapshot.date || `${currentYear}-${String(currentMonth).padStart(2,'0')}-01`,
      patient_name: snapshot.patient_name || '',
      chart_number: snapshot.chart_number || '',
      visit_count: snapshot.visit_count || '',
      body_part: snapshot.body_part || '',
      therapist_name: snapshot.therapist_name || '',
      prescription: snapshot.prescription || '',
      prescription_count: snapshot.prescription_count || '',
      source: targetRow.source || 'manual',
    };

    if (targetRow.isDraft) {
      await supabase.from(tableName).insert([payload]);
      clearLocalDraftRow(targetRow.id, targetRow.isInsertedDraft);
    } else {
      await supabase.from(tableName).update(payload).eq('id', targetRow.id);
    }

    rememberCurrentRowOrder();
    await fetchLogs();
    for (const date of affectedDates) {
      if (!date) continue;
      try {
        await runSyncForDate(date);
      } catch (error) {
        console.error('Failed to sync stats row snapshot to scheduler:', error);
      }
    }
  }, [clearLocalDraftRow, currentMonth, currentYear, fetchLogs, rememberCurrentRowOrder, runSyncForDate, tableName]);

  const insertDraftRow = useCallback((anchorRow, placement) => {
    if (!anchorRow) return;
    setInsertedDraftRows((prev) => ([
      ...prev,
      {
        id: `inserted-draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        anchorId: anchorRow.id,
        placement,
        date: anchorRow.date || '',
        patient_name: '',
        chart_number: '',
        visit_count: '',
        body_part: '',
        therapist_name: '',
        prescription: '',
        prescription_count: '',
      }
    ]));
  }, []);

  const getMergedInto = (r, c) => {
    for (const [key, { rs, cs }] of Object.entries(mergedCells)) {
      const [mr, mc] = key.split('-').map(Number);
      if (r >= mr && r < mr + rs && c >= mc && c < mc + cs && !(r === mr && c === mc)) {
        return key;
      }
    }
    return null;
  };

  const handleMerge = () => {
    if (!selNorm) return;
    const { r1, c1, r2, c2 } = selNorm;
    if (r1 === r2 && c1 === c2) return;
    const key = getMergeKey(r1, c1);
    setMergedCells(prev => ({
      ...prev,
      [key]: { rs: r2 - r1 + 1, cs: c2 - c1 + 1 }
    }));
  };

  const handleUnmerge = () => {
    if (!focus) return;
    const key = getMergeKey(focus.r, focus.c);
    if (mergedCells[key]) {
      setMergedCells(prev => { const n = { ...prev }; delete n[key]; return n; });
      return;
    }
    const into = getMergedInto(focus.r, focus.c);
    if (into) {
      setMergedCells(prev => { const n = { ...prev }; delete n[into]; return n; });
    }
  };

  // ─── 5. EDITING ───────────────────────────────────────────
  const startEdit = useCallback((r, c, isDblClick = false, initialChar = null) => {
    if (readOnly) return;
    if (c === totalCountColIndex || c === newPatientColIndex) return;
    
    const nextValue = initialChar !== null ? initialChar : getVal(gridData[r], c);
    const isKorean = initialChar && /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(initialChar);
    imeOpenRef.current = !!isKorean;

    editingValueRef.current = nextValue;
    setEditing({ r, c, val: nextValue, isDblClick });
  }, [gridData, newPatientColIndex, readOnly, totalCountColIndex]);

  const finishEdit = async () => {
    if (!editing) return;
    if (readOnly) {
      setEditing(null);
      wrapRef.current?.focus();
      return;
    }
    const saveRequestId = ++editSaveRequestRef.current;
    const { r, c } = editing;
    const val = editingValueRef.current ?? editing.val ?? '';
    setEditing(null);
    wrapRef.current?.focus();

    const row = gridData[r];
    const oldVal = getVal(row, c);
    if (val === oldVal) return;
    const affectedDates = new Set();
    if (row?.date) affectedDates.add(row.date);

    try {
    if (c < FIXED_FIELDS.length) {
      const field = FIXED_FIELDS[c].field;
      let v = val;
      if (field === 'date' && v.trim()) {
        v = parseFlexibleDate(v, currentYear, currentMonth);
      }

      let updatePayload = { [field]: v };
      if (field === 'body_part' && v.trim()) updatePayload.body_part = toTitleCaseBodyPart(v);

      if (field === 'patient_name' && v.trim()) {
        const queryName = v.trim().replace(/\*/g, '').replace(/\(-\)/g, '').trim();
        const normalizedQueryName = normalizeNameForMatch(queryName);
        const pastLogs = safeInputLogs.filter((l) => l.id !== row.id && normalizeNameForMatch(l.patient_name) === normalizedQueryName);
        if (pastLogs.length > 0) {
          pastLogs.sort((a, b) => (a.date !== b.date ? b.date.localeCompare(a.date) : (parseInt(b.visit_count || '0') || 0) - (parseInt(a.visit_count || '0') || 0)));
          const lastLog = pastLogs[0];
          updatePayload.patient_name = queryName;
          updatePayload.chart_number = lastLog.chart_number || '';
          updatePayload.body_part = lastLog.body_part || '';
          const lastVisit = parseInt(lastLog.visit_count || '0', 10);
          updatePayload.visit_count = lastVisit > 0 ? String(lastVisit + 1) : '2';
        }
      }

      if (row.isDraft) {
        let fallbackDate = `${currentYear}-${String(currentMonth).padStart(2,'0')}-01`;
        if (safeInputLogs.length > 0) {
            const validDates = safeInputLogs.map(l => l.date).filter(Boolean).sort();
            if (validDates.length > 0) fallbackDate = validDates[validDates.length - 1];
        }
        const nextDraft = {
          date: row.date || fallbackDate,
          patient_name: row.patient_name || '',
          chart_number: row.chart_number || '',
          visit_count: row.visit_count || '',
          body_part: row.body_part || '',
          therapist_name: row.therapist_name || '',
          prescription: row.prescription || '',
          prescription_count: row.prescription_count || 0,
          ...updatePayload,
        };
        if (!nextDraft.date) nextDraft.date = fallbackDate;

        if (!String(nextDraft.patient_name || '').trim()) {
          setLocalDraftRow(row.id, nextDraft, row.isInsertedDraft);
          return;
        }

        if (nextDraft.date) affectedDates.add(nextDraft.date);
        const ins = { ...nextDraft, source: 'manual' };
        const { error } = await supabase.from(tableName).insert([ins]);
        if (error) throw error;
        if (editSaveRequestRef.current === saveRequestId) {
          clearLocalDraftRow(row.id, row.isInsertedDraft);
        }
      } else {
        const nextRow = { ...row, ...updatePayload };
        setLocalDraftRow(row.id, nextRow, false); // 낙관적 업데이트
        if (nextRow?.date) affectedDates.add(nextRow.date);
        
        const { error } = isRowEmpty(nextRow)
          ? await supabase.from(tableName).delete().eq('id', row.id)
          : await supabase.from(tableName).update(updatePayload).eq('id', row.id);
        if (error) throw error;
      }
    } else {
      const tIdx = Math.floor((c - FIXED_FIELDS.length) / prescriptions.length);
      const pIdx = (c - FIXED_FIELDS.length) % prescriptions.length;
      const t = visibleTherapists[tIdx];
      if (!t) return;
      const pres = prescriptions[pIdx];
      const intVal = parseInt(val.trim(), 10) || 0;

      if (row.isDraft) {
        if (!val.trim()) return;
        let fallbackDate = `${currentYear}-${String(currentMonth).padStart(2,'0')}-01`;
        if (safeInputLogs.length > 0) {
            const validDates = safeInputLogs.map(l => l.date).filter(Boolean).sort();
            if (validDates.length > 0) fallbackDate = validDates[validDates.length - 1];
        }
        const nextDraft = {
          date: row.date || fallbackDate,
          patient_name: row.patient_name || '',
          chart_number: row.chart_number || '',
          visit_count: row.visit_count || '',
          body_part: row.body_part || '',
          therapist_name: t.name,
          prescription: pres,
          prescription_count: intVal,
        };

        if (!String(nextDraft.patient_name || '').trim()) {
          setLocalDraftRow(row.id, nextDraft, row.isInsertedDraft);
          return;
        }

        if (nextDraft.date) affectedDates.add(nextDraft.date);
        const { error } = await supabase.from(tableName).insert([{ ...nextDraft, source: 'manual' }]);
        if (error) throw error;
        if (editSaveRequestRef.current === saveRequestId) {
          clearLocalDraftRow(row.id, row.isInsertedDraft);
        }
      } else {
        const expectedName = t.name;
        if (val.trim() === '') {
          if (row.therapist_name === expectedName && prescriptionsMatch(row.prescription, pres)) {
            const clearedFields = { therapist_name: '', prescription: '', prescription_count: 0 };
            const nextRow = { ...row, ...clearedFields };
            setLocalDraftRow(row.id, nextRow, false); // 낙관적 업데이트
            const { error } = isRowEmpty(nextRow)
              ? await supabase.from(tableName).delete().eq('id', row.id)
              : await supabase.from(tableName).update(clearedFields).eq('id', row.id);
            if (error) throw error;
          }
        } else {
          const updateFields = { therapist_name: expectedName, prescription: pres, prescription_count: intVal };
          const nextRow = { ...row, ...updateFields };
          setLocalDraftRow(row.id, nextRow, false); // 낙관적 업데이트
          const { error } = await supabase.from(tableName).update(updateFields).eq('id', row.id);
          if (error) throw error;
        }
      }
    }
    rememberCurrentRowOrder();
    if (editSaveRequestRef.current === saveRequestId) {
      await fetchLogs();
      for (const date of affectedDates) {
        if (!date) continue;
        try {
          await runSyncForDate(date);
        } catch (error) {
          console.error('Failed to sync stats edit to scheduler:', error);
        }
      }
    }
    } catch (error) {
      console.error('Failed to save stats grid edit:', error);
      if (editSaveRequestRef.current === saveRequestId) {
        await fetchLogs();
      }
    }
  };

  const updateEditingValue = useCallback((r, c, value, isDblClick = false) => {
    if (readOnly) return;
    editingValueRef.current = value;
    setEditing((prev) => {
      if (prev && prev.r === r && prev.c === c) {
        return { ...prev, val: value, isDblClick };
      }
      return { r, c, val: value, isDblClick };
    });
  }, [readOnly]);

  // ─── 6. MOUSE HANDLERS ───────────────────────────────────
  const onMouseDown = (e, r, c) => {
    if (e.button === 2) return;
    if (editing) finishEdit();
    setFocus({ r, c });
    setSel({ r1: r, c1: c, r2: r, c2: c });
    setDragging(true);
    setCtxMenu(null);
  };
  const onMouseEnter = (r, c) => { if (dragging) setSel(prev => prev ? { ...prev, r2: r, c2: c } : prev); };
  const onMouseUp = () => setDragging(false);
  const onDblClick = (r, c) => { startEdit(r, c, true); };
  const onCtxMenu = (e, r, c) => {
    e.preventDefault();
    if (editing) finishEdit();
    if (!inSel(r, c)) { setFocus({ r, c }); setSel({ r1: r, c1: c, r2: r, c2: c }); }
    setCtxMenu({ x: e.clientX, y: e.clientY, r, c });
  };

  const onRowHeaderMouseDown = (e, r) => {
    if (e.button === 2) return;
    if (editing) finishEdit();
    selectRow(r);
    setDragging(false);
  };

  const onRowHeaderContextMenu = (e, r) => {
    e.preventDefault();
    if (editing) finishEdit();
    selectRow(r);
    setCtxMenu({ x: e.clientX, y: e.clientY, r, type: 'row' });
  };

  // ─── 7. CLIPBOARD ────────────────────────────────────────
  const doCopy = () => {
    if (!selNorm) return;
    setClipboardSource({ ...selNorm, mode: 'copy' });
    let tsv = '';
    for (let r = selNorm.r1; r <= selNorm.r2; r++) {
      const row = [];
      for (let c = selNorm.c1; c <= selNorm.c2; c++) row.push(getVal(gridData[r], c));
      tsv += row.join('\t') + '\n';
    }
    navigator.clipboard.writeText(tsv);
  };

  const recordUndo = (action) => {
    setUndoStack(prev => [action, ...prev].slice(0, 50));
  };

  const doUndo = async () => {
    if (readOnly) return;
    const action = undoStack[0];
    if (!action) return;
    const mutationRequestId = ++bulkMutationRequestRef.current;
    setUndoStack(prev => prev.slice(1));

    try {
      if (action.type === 'edit') {
        const { id, field, oldVal, date } = action;
        const { error } = await supabase.from(tableName).update({ [field]: oldVal }).eq('id', id);
        if (error) throw error;
        if (date) await runSyncForDate(date);
      } else if (action.type === 'bulk') {
        const upsertPayloadMap = new Map();

        action.changes.forEach(c => {
          const existing = upsertPayloadMap.get(c.id) || { id: c.id };
          if (c.field === 'prescription_stats') {
            existing.therapist_name = c.oldVal.t;
            existing.prescription = c.oldVal.p;
            existing.prescription_count = c.oldVal.c;
          } else {
            existing[c.field] = c.oldVal;
          }
          upsertPayloadMap.set(c.id, existing);
        });

        const upsertPayloads = Array.from(upsertPayloadMap.values());
        if (upsertPayloads.length > 0) {
          const { error } = await supabase.from(tableName).upsert(upsertPayloads);
          if (error) throw error;
        }

        for (const d of action.affectedDates) {
          if (d) await runSyncForDate(d);
        }
      }
      if (bulkMutationRequestRef.current === mutationRequestId) {
        await fetchLogs();
      }
    } catch (error) {
      console.error('Failed to undo stats grid change:', error);
      addToast('실행 취소(Undo) 작업을 적용하지 못했습니다.', 'error');
      if (bulkMutationRequestRef.current === mutationRequestId) {
        await fetchLogs();
      }
    }
  };
  const doPaste = async (text, startR, startC) => {
    if (readOnly) return;
    const mutationRequestId = ++bulkMutationRequestRef.current;
    const affectedDates = new Set();
    const rows = text.split('\n').map(l => l.split('\t'));
    const undoChanges = [];
    const bulkUpdates = [];
    const bulkInserts = [];

    for (let i = 0; i < rows.length; i++) {
      if (rows[i].length === 1 && rows[i][0] === '') continue;
      const r = startR + i;
      if (r >= gridData.length) break;
      const row = gridData[r];
      if (row?.date) affectedDates.add(row.date);

      for (let j = 0; j < rows[i].length; j++) {
        const c = startC + j;
        if (c >= totalCountColIndex) break;
        const v = rows[i][j].trim();
        const oldVal = getVal(row, c);
        if (oldVal === v) continue;

        if (c < FIXED_FIELDS.length) {
          const field = FIXED_FIELDS[c].field;
          undoChanges.push({ id: row.id, field, oldVal, newVal: v });
          if (row.isDraft) {
            if (v) {
              const parsedDate = field === 'date' ? parseFlexibleDate(v, currentYear, currentMonth) : `${currentYear}-${String(currentMonth).padStart(2,'0')}-01`;
              const ins = { date: parsedDate, patient_name: '', chart_number: '', visit_count: '', body_part: '', therapist_name: '', prescription: '', prescription_count: '' };
              ins[field] = v;
              bulkInserts.push(ins);
              if (ins.date) affectedDates.add(ins.date);
            }
          } else {
            const nextVal = field === 'date' ? parseFlexibleDate(v, currentYear, currentMonth) : v;
            bulkUpdates.push({ id: row.id, data: { [field]: nextVal } });
            if (field === 'date') {
               affectedDates.add(nextVal);
            }
          }
        } else {
          const tIdx = Math.floor((c - FIXED_FIELDS.length) / prescriptions.length);
          const pIdx = (c - FIXED_FIELDS.length) % prescriptions.length;
          const t = visibleTherapists[tIdx];
          if (!t) continue;
          const pres = prescriptions[pIdx];
          const expectedName = t.name;
          undoChanges.push({ id: row.id, field: 'prescription_stats', oldVal: { t: row.therapist_name, p: row.prescription, c: row.prescription_count }, newVal: { t: expectedName, p: pres, c: v } });
          if (!row.isDraft) {
            bulkUpdates.push({ id: row.id, data: { therapist_name: expectedName, prescription: pres, prescription_count: v } });
          }
        }
      }
    }

    try {
      if (bulkInserts.length > 0) {
        const { error } = await supabase.from(tableName).insert(bulkInserts);
        if (error) throw error;
      }
      if (bulkUpdates.length > 0) {
        const upsertPayload = bulkUpdates.map(u => ({ id: u.id, ...u.data }));
        const { error } = await supabase.from(tableName).upsert(upsertPayload);
        if (error) throw error;
      }

      // Clear visual source highlight after a successful paste.
      if (clipboardSource?.mode === 'cut') {
        await clearRange(clipboardSource);
      }
      if (clipboardSource) {
        setClipboardSource(null);
      }

      recordUndo({ type: 'bulk', changes: undoChanges, affectedDates: Array.from(affectedDates) });
      rememberCurrentRowOrder();
      if (bulkMutationRequestRef.current === mutationRequestId) {
        await fetchLogs();
        for (const d of affectedDates) {
          if (d) await runSyncForDate(d);
        }
      }
    } catch (error) {
      console.error('Failed to paste stats grid range:', error);
      addToast('붙여넣기한 데이터를 저장하는 중 일부 혹은 전체가 실패했습니다.', 'error');
      if (bulkMutationRequestRef.current === mutationRequestId) {
        await fetchLogs();
      }
    }
  };

  const clearRange = async (range) => {
    const affectedDates = new Set();
    const undoChanges = [];
    const deleteIds = [];
    const upsertPayloads = [];

    for (let r = range.r1; r <= range.r2; r++) {
      const row = gridData[r];
      if (row.isDraft) continue;
      if (row?.date) affectedDates.add(row.date);
      const updatePayload = {};
      for (let c = range.c1; c <= range.c2; c++) {
        if (c >= totalCountColIndex) continue;
        const oldVal = getVal(row, c);
        if (c < FIXED_FIELDS.length) {
          const field = FIXED_FIELDS[c].field;
          updatePayload[field] = '';
          undoChanges.push({ id: row.id, field, oldVal, newVal: '' });
        } else {
          const tIdx = Math.floor((c - FIXED_FIELDS.length) / prescriptions.length);
          const pIdx = (c - FIXED_FIELDS.length) % prescriptions.length;
          const t = visibleTherapists[tIdx];
          if (t && row.therapist_name === t.name && prescriptionsMatch(row.prescription, prescriptions[pIdx])) {
            updatePayload.therapist_name = '';
            updatePayload.prescription = '';
            updatePayload.prescription_count = '';
            undoChanges.push({ id: row.id, field: 'prescription_stats', oldVal: { t: row.therapist_name, p: row.prescription, c: row.prescription_count }, newVal: { t: '', p: '', c: '' } });
          }
        }
      }
      if (Object.keys(updatePayload).length > 0) {
        const nextRow = { ...row, ...updatePayload };
        if (isRowEmpty(nextRow)) {
          deleteIds.push(row.id);
        } else {
          upsertPayloads.push({ id: row.id, ...updatePayload });
        }
      }
    }

    try {
      if (deleteIds.length > 0) {
        const { error } = await supabase.from(tableName).delete().in('id', deleteIds);
        if (error) throw error;
      }
      if (upsertPayloads.length > 0) {
        const { error } = await supabase.from(tableName).upsert(upsertPayloads);
        if (error) throw error;
      }
    } catch (error) {
      console.error('Failed to clear stats grid range:', error);
      addToast('선택한 범위의 데이터를 비우는 중 오류가 발생했습니다.', 'error');
      throw error;
    }

    return { undoChanges, affectedDates: Array.from(affectedDates) };
  };

  const doDelete = async () => {
    if (readOnly) return;
    if (!selNorm) return;
    const mutationRequestId = ++bulkMutationRequestRef.current;
    const { undoChanges, affectedDates } = await clearRange(selNorm);
    recordUndo({ type: 'bulk', changes: undoChanges, affectedDates });
    rememberCurrentRowOrder();
    if (bulkMutationRequestRef.current === mutationRequestId) {
      await fetchLogs();
      for (const date of affectedDates) {
        if (date) await runSyncForDate(date);
      }
    }
  };

  const doDeleteRow = async (r, options = {}) => {
    if (readOnly) return;
    const { skipConfirm = false } = options;
    const row = gridData[r];
    if (row?.isDraft) {
      clearLocalDraftRow(row.id, row.isInsertedDraft);
      setCtxMenu(null);
      return;
    }
    if (row && !row.isDraft && (skipConfirm || window.confirm(`${row.patient_name} 행을 삭제하시겠습니까?`))) {
      const affectedDate = row.date || '';
      try {
        const { error } = await supabase.from(tableName).delete().eq('id', row.id);
        if (error) throw error;
        setCtxMenu(null);
        rememberCurrentRowOrder();
        await fetchLogs();
        if (affectedDate) {
          try {
            await runSyncForDate(affectedDate);
          } catch (error) {
            console.error('Failed to sync deleted stats row to scheduler:', error);
          }
        }
      } catch (error) {
        console.error('Failed to delete stats row:', error);
        addToast('행 삭제에 실패했습니다. 다시 시도해 주세요.', 'error');
      }
    }
  };

  const selectRow = useCallback((r) => {
    setFocus({ r, c: 0 });
    setSel({ r1: r, c1: 0, r2: r, c2: totalColCount - 1 });
    setCtxMenu(null);
    wrapRef.current?.focus();
  }, [totalColCount]);

  const copyRow = useCallback((r) => {
    const row = gridData[r];
    if (!row) return;
    const snapshot = makeRowSnapshot(row);
    rowClipboardRef.current = { row: snapshot, mode: 'copy' };
    const values = [snapshot.date, snapshot.patient_name, snapshot.chart_number, snapshot.visit_count, snapshot.body_part, snapshot.therapist_name, snapshot.prescription, snapshot.prescription_count];
    navigator.clipboard?.writeText(values.join('\t')).catch(() => {});
  }, [gridData, makeRowSnapshot]);

  const cutRow = useCallback(async (r) => {
    copyRow(r);
    rowClipboardRef.current.mode = 'cut';
    await doDeleteRow(r);
  }, [copyRow, doDeleteRow]);

  const pasteRow = useCallback(async (r) => {
    const clipboard = rowClipboardRef.current;
    const row = gridData[r];
    if (!clipboard?.row || !row) return;
    await applyRowSnapshot(row, clipboard.row);
    if (clipboard.mode === 'cut') rowClipboardRef.current = { row: null, mode: null };
  }, [applyRowSnapshot, gridData]);

  // ─── 8. KEYBOARD ─────────────────────────────────────────
  useEffect(() => {
    const kd = (e) => {
      if (ctxMenu && e.key === 'Escape') { setCtxMenu(null); return; }
      if (clipboardSource && e.key === 'Escape') { setClipboardSource(null); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); doUndo(); return; }
      if (editing) {
        if (e.key === 'Escape') { setEditing(null); return; }
        if (e.key === 'Enter') {
          if (e.isComposing || isComposingRef.current) {
            return;
          }
          e.preventDefault();
          finishEdit().then(() => {
            const nr = Math.min(editing.r + 1, gridData.length - 1);
            setFocus({ r: nr, c: editing.c });
            setSel({ r1: nr, c1: editing.c, r2: nr, c2: editing.c });
          });
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          finishEdit().then(() => {
            const nc = Math.min(editing.c + 1, totalColCount - 1);
            setFocus({ r: editing.r, c: nc });
            setSel({ r1: editing.r, c1: nc, r2: editing.r, c2: nc });
          });
          return;
        }
        return;
      }
      if (!focus) return;
      let { r, c } = focus;
      const isWholeRowSelected = !!selNorm && selNorm.r1 === selNorm.r2 && selNorm.r1 === r && selNorm.c1 === 0 && selNorm.c2 === totalColCount - 1;
      if (e.key === 'ArrowUp') r = Math.max(0, r - 1);
      if (e.key === 'ArrowDown') r = Math.min(gridData.length - 1, r + 1);
      if (e.key === 'ArrowLeft') c = Math.max(0, c - 1);
      if (e.key === 'ArrowRight') c = Math.min(totalColCount - 1, c + 1);
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        setFocus({ r, c });
        setSel(e.shiftKey && sel ? { ...sel, r2: r, c2: c } : { r1: r, c1: c, r2: r, c2: c });
        return;
      }
      if (e.key === 'Enter') { e.preventDefault(); startEdit(r, c, true); return; }
      if (e.key === 'Tab') { e.preventDefault(); const nc = Math.min(c+1, totalColCount-1); setFocus({r, c:nc}); setSel({r1:r,c1:nc,r2:r,c2:nc}); return; }
      if (!readOnly && (e.metaKey || e.ctrlKey) && (e.key === '+' || e.key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd')) {
        if (isWholeRowSelected) {
          e.preventDefault();
          insertDraftRow(gridData[r], 'after');
          return;
        }
      }
      if (!readOnly && (e.metaKey || e.ctrlKey) && (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract')) {
        if (isWholeRowSelected) {
          e.preventDefault();
          doDeleteRow(r, { skipConfirm: true });
          return;
        }
      }
      if (!readOnly && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); doDelete(); return; }
      if (!readOnly && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g') { e.preventDefault(); e.shiftKey ? handleUnmerge() : handleMerge(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') { e.preventDefault(); doCopy(); return; }
      if (!readOnly && (e.metaKey || e.ctrlKey) && e.key === 'x') { e.preventDefault(); doCopy(); doDelete(); return; }
      
      // Let keydown handle the first keystroke to prevent focus loss issues
      if (!readOnly && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && c < totalCountColIndex) {
        e.preventDefault();
        startEdit(r, c, false, e.key);
      }
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [clipboardSource, doCopy, doDelete, doDeleteRow, doUndo, editing, finishEdit, focus, gridData, handleMerge, handleUnmerge, insertDraftRow, readOnly, sel, selNorm, startEdit, totalColCount, totalCountColIndex, ctxMenu]);

  const scrollToTodayRow = useCallback(() => {
    const todayRowIndex = findNearestDateRowIndex(gridData, todayDateKey);
    if (todayRowIndex < 0) return false;

    setFocus({ r: todayRowIndex, c: 1 });
    setSel({ r1: todayRowIndex, c1: 1, r2: todayRowIndex, c2: 1 });

    requestAnimationFrame(() => {
      const targetRow = wrapRef.current?.querySelector(`[data-grid-row-index="${todayRowIndex}"]`);
      if (!targetRow) return;
      targetRow.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    });

    return true;
  }, [gridData, todayDateKey]);

  useEffect(() => {
    const handleTodayShortcut = (event) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 't') return;
      if (editing || isEditableShortcutTarget(event.target)) return;

      event.preventDefault();
      event.stopPropagation();
      scrollToTodayRow();
    };

    window.addEventListener('keydown', handleTodayShortcut, true);
    return () => window.removeEventListener('keydown', handleTodayShortcut, true);
  }, [editing, scrollToTodayRow]);

  useEffect(() => {
    const handler = (e) => {
      if (editing) return;
      if (readOnly) return;
      if (!focus) return;
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (text) { e.preventDefault(); doPaste(text, focus.r, focus.c); }
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [focus, editing, doPaste, readOnly]);

  useEffect(() => {
    if (editing && inputRef.current) { 
      inputRef.current.focus(); 
      if (editing.isDblClick && editing.c === FIXED_FIELDS.findIndex(f => f.field === 'date') && datePickerRef.current) {
        try {
          datePickerRef.current.showPicker();
        } catch {
          // showPicker is best effort.
        }
      }
    }
  }, [editing]);

  useEffect(() => {
    if (editing && inputRef.current && !imeOpenRef.current) inputRef.current.select();
  }, [editing]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [ctxMenu]);

  useLayoutEffect(() => {
    if (!ctxMenu || !ctxMenuRef.current) return;

    const menuRect = ctxMenuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 12;

    let nextX = ctxMenu.x;
    let nextY = ctxMenu.y;

    if (nextX + menuRect.width + margin > viewportWidth) {
      nextX = Math.max(margin, viewportWidth - menuRect.width - margin);
    }

    if (nextY + menuRect.height + margin > viewportHeight) {
      nextY = Math.max(margin, viewportHeight - menuRect.height - margin);
    }

    if (nextX < margin) nextX = margin;
    if (nextY < margin) nextY = margin;

    if (nextX !== ctxMenu.x || nextY !== ctxMenu.y) {
      setCtxMenu((prev) => (prev ? { ...prev, x: nextX, y: nextY } : prev));
    }
  }, [ctxMenu]);

  // ─── 9. COMPUTED TOTALS ───────────────────────────────────
  const { grandTotal, newPatientTotal, therapistTotals } = useMemo(() => {
    const totalsByTherapist = new Map();
    visibleTherapists.forEach((therapist) => {
      totalsByTherapist.set(therapist.name, {
        total: 0,
        byPres: Object.fromEntries(prescriptions.map((prescription) => [prescription, 0])),
      });
    });

    let total = 0;
    let newPatients = 0;

    filteredInputLogs.forEach((log) => {
      if (String(log?.patient_name || '').includes('*')) {
        newPatients += 1;
      }
      if (!log?.prescription) return;

      const count = toPrescriptionCount(log.prescription_count);
      total += count;

      const therapistTotal = totalsByTherapist.get(log.therapist_name);
      if (!therapistTotal) return;

      therapistTotal.total += count;
      const matchedPrescription = prescriptions.find((prescription) => prescriptionsMatch(log.prescription, prescription));
      if (matchedPrescription) {
        therapistTotal.byPres[matchedPrescription] = (therapistTotal.byPres[matchedPrescription] || 0) + count;
      }
    });

    return {
      grandTotal: total,
      newPatientTotal: newPatients,
      therapistTotals: visibleTherapists.map((therapist) => totalsByTherapist.get(therapist.name) || { total: 0, byPres: {} }),
    };
  }, [filteredInputLogs, visibleTherapists, prescriptions]);

  // ─── 10. RENDER ───────────────────────────────────────────
  const gridWrapperClassName = [
    'sw-grid-wrapper',
    tableName === 'manual_therapy_patient_logs' ? 'sw-grid-wrapper--manual' : 'sw-grid-wrapper--shockwave',
  ].join(' ');

  return (
    <div className="sw-grid-shell">
    <div className={gridWrapperClassName} ref={wrapRef} tabIndex={0} onMouseUp={onMouseUp}>
      <table className="sw-grid-table" style={{ minWidth: `${gridMinWidth}px` }}>
        <colgroup>
          {FIXED_FIELDS.map((f) => <col key={f.id} style={{ width: f.w, minWidth: f.w }} />)}
          {visibleTherapists.map(t => prescriptions.map(p => (
            <col key={`${t.key}-${p}`} style={{ width: therapistColumnWidth, minWidth: therapistColumnWidth }} />
          )))}
          <col style={{ width: SUMMARY_COL_WIDTH, minWidth: SUMMARY_COL_WIDTH }} />
          <col style={{ width: SUMMARY_COL_WIDTH, minWidth: SUMMARY_COL_WIDTH }} />
        </colgroup>

        <thead>
          {/* Row 1: Title */}
          <tr className="sw-header-row sw-header-row-title">
            <th colSpan={totalColCount} className="grid-title">
              <div className="grid-title-inner">
                <span className="grid-title-text">{gridTitle}</span>
              </div>
            </th>
          </tr>

          {/* Row 2: Fixed Fields + Therapist Names + Summary Labels */}
          <tr className="sw-header-row sw-header-row-therapists">
            {FIXED_FIELDS.map((f, i) => (
              <th
                key={f.id}
                rowSpan={3}
                className={frozenColumnCount > 0 && i < frozenColumnCount
                  ? `hdr-fixed hdr-fixed-${i + 1} ${i === frozenColumnCount - 1 ? 'hdr-fixed-last' : ''}`
                  : ''
                }
              >
                {f.label}
              </th>
            ))}
            {visibleTherapists.map((t, idx) => (
              <th key={`tn-${t.key}`} colSpan={prescriptions.length} className={`hdr-therapist ${idx > 0 ? 'therapist-group-start' : ''} therapist-group-end`} style={{ backgroundColor: THERAPIST_COLORS[idx % THERAPIST_COLORS.length] }}>
                {t.displayName} ( {therapistTotals[idx]?.total || 0}건 )
              </th>
            ))}
            <th rowSpan={2} className="hdr-total total-group-start">총건수</th>
            <th rowSpan={2} className="hdr-total hdr-new-patient">{secondarySummaryLabel}</th>
          </tr>

          {/* Row 3: Prescription Names */}
          <tr className="sw-header-row sw-header-row-prescriptions">
            {visibleTherapists.map((t, idx) => prescriptions.map((p, pIdx) => (
              <th key={`${t.key}-${pIdx}`} className={`hdr-pres ${pIdx === 0 ? 'therapist-group-start' : ''} ${pIdx === prescriptions.length - 1 ? 'therapist-group-end' : ''}`} style={{ backgroundColor: THERAPIST_COLORS[idx % THERAPIST_COLORS.length] }}>
                {p}
              </th>
            )))}
          </tr>

          {/* Row 4: Column-wise totals (Prescription Totals + Grand Totals) */}
          <tr className="sw-header-row sw-header-row-prescription-totals">
            {visibleTherapists.map((t, idx) => prescriptions.map((p, pIdx) => (
              <th
                key={`${t.key}-${pIdx}-inner`}
                className={`hdr-pres-total ${pIdx === 0 ? 'therapist-group-start' : ''} ${pIdx === prescriptions.length - 1 ? 'therapist-group-end' : ''}`}
                style={{ backgroundColor: THERAPIST_TOTAL_COLORS[idx % THERAPIST_TOTAL_COLORS.length] }}
              >
                {therapistTotals[idx]?.byPres[p] || 0}
              </th>
            )))}
            <th className="hdr-grand-total total-group-start">{grandTotal}건</th>
            <th className="hdr-grand-total hdr-new-patient-total">{newPatientTotal}명</th>
          </tr>
        </thead>

        <tbody>
          {gridData.map((row, ri) => {
            const isWholeRowSelected = !!selNorm && selNorm.r1 === ri && selNorm.r2 === ri && selNorm.c1 === 0 && selNorm.c2 === totalColCount - 1;
            const isTodayRow = row._isFirst && row.date === todayDateKey;
            const rowClasses = [
              row._isFirst && row.date ? 'tr-date-start' : '',
              row._isLast && row.date ? 'tr-date-end' : '',
              isTodayRow ? 'tr-today-row' : '',
              isWholeRowSelected ? 'tr-row-selected' : '',
            ].filter(Boolean).join(' ');
            return (
            <tr key={row.id} data-grid-row-index={ri} className={rowClasses}>
              {Array.from({ length: totalColCount }, (_, ci) => {
                const isDateCol = ci === 1;
                const isTotalCol = ci === totalCountColIndex;
                const isNewPatientCol = ci === newPatientColIndex;

                const isDateGroupMergedCol = (isDateCol || isTotalCol || isNewPatientCol) && row.date;
                const isSingleDateGroupMergedCol = isDateGroupMergedCol && (row._groupSize || 1) === 1;

                // 날짜별 그룹 병합 셀의 경우 첫 행이 아닐 때는 td를 렌더링하지 않아야 정상 병합됨
                if (isDateGroupMergedCol && !row._isFirst) {
                  return null;
                }

                if (getMergedInto(ri, ci)) return null;

                const mergeInfo = mergedCells[getMergeKey(ri, ci)];
                const rs = isDateGroupMergedCol ? (row._groupSize || 1) : (mergeInfo?.rs || 1);
                const cs = isDateGroupMergedCol ? 1 : (mergeInfo?.cs || 1);

                const isSel = inSel(ri, ci);
                const isFoc = focus?.r === ri && focus?.c === ci;
                const isEdit = editing?.r === ri && editing?.c === ci;
                let val = getVal(row, ci);

                let groupCls = '';
                if (isDateGroupMergedCol) {
                  if (!row._isFirst) { val = ''; groupCls = row._isLast ? 'grp-last' : 'grp-mid'; }
                  else if (!row._isLast) groupCls = 'grp-first';
                }
                let cls = 'gc';
                if (isSel) cls += ' gc-sel';
                if (isWholeRowSelected) cls += ' gc-row-selected';
                if (isFoc) cls += ' gc-foc';
                if (groupCls) cls += ' ' + groupCls;
                if (ci < frozenColumnCount) {
                    cls += ` gc-fixed gc-fixed-${ci + 1}`;
                }
                if (ci === 0) cls += ' gc-row-index';
                if (isDateCol) cls += ' gc-date-cell';
                if (isSingleDateGroupMergedCol) cls += ' gc-single-date-group';
                if (ci === FIXED_FIELDS.length - 1) cls += ' fixed-field-last';
                if (clipboardSource && ri >= clipboardSource.r1 && ri <= clipboardSource.r2 && ci >= clipboardSource.c1 && ci <= clipboardSource.c2) {
                    cls += clipboardSource.mode === 'cut' ? ' gc-cut-source' : ' gc-copy-source';
                }
                if (ci < FIXED_FIELDS.length && FIXED_FIELDS[ci]?.bold) cls += ' gc-bold';
                if (ci >= FIXED_FIELDS.length && ci < totalCountColIndex) cls += ' gc-therapist-value';
                if (isTotalCol) cls += ' gc-total total-group-start';
                if (isNewPatientCol) cls += ' gc-total gc-new-patient';
                if (isTherapistGroupStartCol(ci)) cls += ' therapist-group-start';
                if (isTherapistGroupEndCol(ci)) cls += ' therapist-group-end';

                const isFrozenCol = ci < frozenColumnCount;
                const fixedLeft = isFrozenCol ? getFrozenLeft(ci) : undefined;
                const frozenStyle = isFrozenCol ? {
                  position: 'sticky',
                  left: fixedLeft,
                  zIndex: isFoc || isEdit ? 35 : 28,
                  borderRight: ci === frozenColumnCount - 1 ? '1px solid var(--grid-strong)' : undefined,
                } : undefined;

                const showInput = isEdit || (!readOnly && isFoc);

                if (showInput) {
                  return (
                    <td
                      key={ci}
                      className={cls}
                      rowSpan={rs > 1 ? rs : undefined}
                      colSpan={cs > 1 ? cs : undefined}
                      style={{ padding: 0, ...frozenStyle }}
                      onMouseDown={e => (ci === 0 ? onRowHeaderMouseDown(e, ri) : onMouseDown(e, ri, ci))}
                      onMouseEnter={() => onMouseEnter(ri, ci)}
                      onContextMenu={e => (ci === 0 ? onRowHeaderContextMenu(e, ri) : onCtxMenu(e, ri, ci))}
                    >
                      <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: '30px' }}>
                        {!isEdit && (
                          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                            <div style={{ padding: '0 8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{val}</div>
                            <div className="gc-dot" />
                          </div>
                        )}
                        <input 
                          key={isEdit && editing.isDblClick ? 'edit' : 'hidden'}
                          ref={isEdit ? inputRef : (el) => { if (el && !isEdit) { el.focus(); } }} 
                          className="gc-input" 
                          data-hidden-input={!isEdit ? 'true' : undefined}
                          style={isEdit ? {
                            width: '100%', height: '100%', boxSizing: 'border-box',
                            position: 'relative',
                            zIndex: 2,
                          } : {
                            position: 'absolute',
                            top: 0, left: 0,
                            width: '1px', height: '1px',
                            opacity: 0,
                            padding: 0, border: 'none', outline: 'none',
                            pointerEvents: 'none',
                          }}
                          value={isEdit ? editing.val : ''} 
                          onCompositionStart={() => {
                            isComposingRef.current = true;
                          }}
                          onCompositionEnd={() => {
                            isComposingRef.current = false;
                          }}
                          onInput={(e) => {
                            if (!isEdit) {
                              updateEditingValue(ri, ci, e.target.value, false);
                            }
                          }}
                          onChange={(e) => {
                            if (isEdit) {
                              updateEditingValue(ri, ci, e.target.value, editing.isDblClick);
                            }
                          }}
                          onBlur={isEdit ? finishEdit : undefined} 
                        />
                        {isDateCol && isEdit && (
                          <input 
                            type="date"
                            ref={datePickerRef}
                            style={{ position: 'absolute', opacity: 0, right: 0, top: 0, width: 0, height: 0, pointerEvents: 'none' }}
                            onChange={e => {
                              if (e.target.value) {
                                updateEditingValue(ri, ci, e.target.value, true);
                                setTimeout(finishEdit, 50);
                              }
                            }}
                          />
                        )}
                      </div>
                    </td>
                  );
                }

                const countTooltipData = (!isTotalCol && !isNewPatientCol && ci >= FIXED_FIELDS.length && ci < totalCountColIndex)
                  ? getTherapistCountTooltip(row, ci)
                  : null;
                let displayVal = val;
                if (isTotalCol && val !== '') {
                  const summary = dateSummaries.get(row.date);
                  if (summary?.byPrescription) {
                    const counts = prescriptions.map(p => summary.byPrescription[p] || 0);
                    const countsStr = counts.join('/');
                    displayVal = (
                      <div className="sw-grid-total-cell">
                        <span className="sw-grid-summary-main-number">{val}</span>
                        <span className="sw-grid-summary-breakdown">({countsStr})</span>
                      </div>
                    );
                  }
                }
                if (isNewPatientCol && val !== '') {
                  const summary = dateSummaries.get(row.date);
                  const counts = visibleTherapists.map(t => summary?.newPatientByTherapist?.[t.name] || 0);
                  displayVal = (
                    <div className="sw-grid-new-patient-cell">
                      <span className="sw-grid-new-patient-total">{val}</span>
                      <span className="sw-grid-new-patient-breakdown">({counts.join('/')})</span>
                    </div>
                  );
                }
                if (countTooltipData) {
                  displayVal = (
                    <div className="sw-grid-count-hover">
                      <span className="sw-grid-count-value">{val}</span>
                    </div>
                  );
                }

                const cellStyle = {
                  ...frozenStyle,
                  ...(isDateGroupMergedCol
                    ? isSingleDateGroupMergedCol
                      ? { verticalAlign: 'middle', paddingTop: 0, paddingBottom: 0 }
                      : { verticalAlign: 'top', paddingTop: '4px' }
                    : {})
                };

                return (
                  <td
                    key={ci}
                    className={cls}
                    rowSpan={rs > 1 ? rs : undefined}
                    colSpan={cs > 1 ? cs : undefined}
                    style={cellStyle}
                    onMouseDown={e => (ci === 0 ? onRowHeaderMouseDown(e, ri) : onMouseDown(e, ri, ci))}
                    onMouseEnter={(e) => {
                      onMouseEnter(ri, ci);
                      if (countTooltipData) showCountTooltip(e.currentTarget, countTooltipData);
                    }}
                    onMouseLeave={countTooltipData ? hideCountTooltip : undefined}
                    onDoubleClick={() => onDblClick(ri, ci)}
                    onContextMenu={e => (ci === 0 ? onRowHeaderContextMenu(e, ri) : onCtxMenu(e, ri, ci))}
                  >
                    {displayVal}
                  </td>
                );
              })}
            </tr>
          );
        })}
        </tbody>
      </table>

      {countTooltip && (
        <div
          className={`sw-grid-count-tooltip sw-grid-count-tooltip--fixed sw-grid-count-tooltip--${countTooltip.placement}`}
          role="tooltip"
          style={{
            left: `${countTooltip.x}px`,
            top: `${countTooltip.y}px`,
            width: `${countTooltip.width}px`,
            backgroundColor: countTooltip.therapistColor,
            '--tooltip-accent-color': countTooltip.tooltipAccentColor,
          }}
        >
          <div className="sw-grid-count-tooltip-header">
            <div className="sw-grid-count-tooltip-date">{countTooltip.date}</div>
            <div className="sw-grid-count-tooltip-name">
              {countTooltip.therapistName} {countTooltip.totalCount}건
            </div>
          </div>
          <div className="sw-grid-count-tooltip-line">
            {countTooltip.items.map(({ label, count }, idx) => (
              <React.Fragment key={label}>
                {idx > 0 && <span className="sw-grid-count-tooltip-divider">|</span>}
                <span>{label} {count}건</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Context Menu */}
      {ctxMenu && (
        <div ref={ctxMenuRef} className="shockwave-context-menu" style={{ top: ctxMenu.y, left: ctxMenu.x }} onMouseDown={e => e.stopPropagation()}>
          {ctxMenu.type === 'row' ? (
            <>
              <button type="button" className="context-menu-item" onClick={() => { selectRow(ctxMenu.r); setCtxMenu(null); }}>행 선택</button>
              <button type="button" className="context-menu-item" onClick={() => { copyRow(ctxMenu.r); setCtxMenu(null); }}>행 복사</button>
              {!readOnly && (
                <>
                  <button type="button" className="context-menu-item" onClick={() => { cutRow(ctxMenu.r); setCtxMenu(null); }}>행 잘라내기</button>
                  <button type="button" className="context-menu-item" onClick={() => { pasteRow(ctxMenu.r); setCtxMenu(null); }}>행 붙여넣기</button>
                  <div className="context-menu-divider" />
                  <button type="button" className="context-menu-item" onClick={() => { insertDraftRow(gridData[ctxMenu.r], 'before'); setCtxMenu(null); }}>위에 행 삽입</button>
                  <button type="button" className="context-menu-item" onClick={() => { insertDraftRow(gridData[ctxMenu.r], 'after'); setCtxMenu(null); }}>아래에 행 삽입</button>
                  <div className="context-menu-divider" />
                  <button type="button" className="context-menu-item context-menu-danger" onClick={() => { doDeleteRow(ctxMenu.r); setCtxMenu(null); }}>행 삭제</button>
                </>
              )}
            </>
          ) : (
            <>
              <button type="button" className="context-menu-item" onClick={() => { doCopy(); setCtxMenu(null); }}>복사 <span className="ctx-shortcut">⌘C</span></button>
              {!readOnly && (
                <>
                  <button type="button" className="context-menu-item" onClick={() => { doCopy(); doDelete(); setCtxMenu(null); }}>잘라내기 <span className="ctx-shortcut">⌘X</span></button>
                  <button type="button" className="context-menu-item" onClick={async () => {
                    try { const t = await navigator.clipboard.readText(); doPaste(t, ctxMenu.r, ctxMenu.c); } catch { alert('Ctrl+V를 사용하세요.'); }
                    setCtxMenu(null);
                  }}>붙여넣기 <span className="ctx-shortcut">⌘V</span></button>
                  <div className="context-menu-divider" />
                  <button type="button" className="context-menu-item" onClick={() => { handleMerge(); setCtxMenu(null); }}>셀 병합 <span className="ctx-shortcut">⌘G</span></button>
                  <button type="button" className="context-menu-item" onClick={() => { handleUnmerge(); setCtxMenu(null); }}>셀 병합 해제 <span className="ctx-shortcut">⌘⇧G</span></button>
                  <div className="context-menu-divider" />
                  <button type="button" className="context-menu-item" onClick={() => { doDelete(); setCtxMenu(null); }}>선택 내용 지우기 <span className="ctx-shortcut">Del</span></button>
                  <button type="button" className="context-menu-item context-menu-danger" onClick={() => { doDeleteRow(ctxMenu.r); setCtxMenu(null); }}>이 행 영구 삭제</button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
    </div>
  );
}

import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { normalizeNameForMatch } from '../../lib/memoParser';
import { syncStatsDateToScheduler } from '../../lib/shockwaveSyncUtils';
import { useSchedule } from '../../contexts/ScheduleContext';
import '../../styles/shockwave_stats.css';

// Dynamic labels from settings will be used instead
const THERAPIST_COLORS = [
  '#dbeafe',
  '#e9ddff',
  '#d8f3ea',
  '#ffe7c7',
  '#ffdced',
];

const THERAPIST_TOTAL_COLORS = [
  '#bfdbfe',
  '#d8b4fe',
  '#b7ead8',
  '#ffd39a',
  '#ffb9d8',
];
function toTitleCaseBodyPart(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export default function ShockwaveDataGrid({
  logs,
  therapists,
  currentYear,
  currentMonth,
  fetchLogs,
  extraDraftRows = 0,
  onApplyTodaySchedule,
  isApplyingTodaySchedule = false,
}) {
  const { shockwaveSettings: settings } = useSchedule();
  const prescriptions = useMemo(() => settings?.prescriptions || ['F1.5', 'F/Rdc', 'F/R'], [settings?.prescriptions]);
  const frozenColumnCount = settings?.frozen_columns ?? 6;

  const [insertedDraftRows, setInsertedDraftRows] = useState([]);
  const [clipboardSource, setClipboardSource] = useState(null); // { r1, c1, r2, c2, mode: 'copy'|'cut' }
  const [undoStack, setUndoStack] = useState([]);
  const rowClipboardRef = useRef({ row: null, mode: null });
  const rowOrderRef = useRef(new Map());

  // ─── 1. DATA PREPARATION ─────────────────────────────────
  const gridData = useMemo(() => {
    // Filter out saved logs that have no patient name (Row Compaction)
    const safeLogs = Array.isArray(logs) ? logs.filter(log => log && log.patient_name?.trim()) : [];
    const sorted = [...safeLogs]
      .sort((a, b) => {
        const dateCompare = String(a?.date || '').localeCompare(String(b?.date || ''));
        if (dateCompare !== 0) return dateCompare;
        const aOrder = rowOrderRef.current.get(a?.id);
        const bOrder = rowOrderRef.current.get(b?.id);
        if (typeof aOrder === 'number' && typeof bOrder === 'number' && aOrder !== bOrder) {
          return aOrder - bOrder;
        }
        if (typeof aOrder === 'number' && typeof bOrder !== 'number') return -1;
        if (typeof aOrder !== 'number' && typeof bOrder === 'number') return 1;
        return String(a?.created_at || '').localeCompare(String(b?.created_at || ''));
      })
      .map((log) => ({ ...log }));

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

    // Add 40+ empty draft rows
    const draftsNeeded = Math.max(60 - flat.length, 30) + extraDraftRows;
    for (let i = 0; i < draftsNeeded; i++) {
      flat.push({
        id: `draft-${i}`,
        date: '', patient_name: '', chart_number: '', visit_count: '',
        body_part: '', therapist_name: '', prescription: '', prescription_count: '',
        isDraft: true, _isFirst: true, _isLast: true, _groupSize: 1,
      });
    }
    return flat;
  }, [logs, extraDraftRows, insertedDraftRows]);

  const rememberCurrentRowOrder = useCallback(() => {
    const nextOrder = new Map();
    gridData.forEach((row, index) => {
      if (!row?.id || row.isDraft) return;
      nextOrder.set(row.id, index);
    });
    rowOrderRef.current = nextOrder;
  }, [gridData]);

  // Column definitions (flat array matching <colgroup>)
  const FIXED_FIELDS = [
    { id: 'idx', label: '#', field: 'idx', w: 48 },
    { id: 'date', label: '날짜', field: 'date', w: 70 },
    { id: 'name', label: '이름', field: 'patient_name', w: 85, bold: true },
    { id: 'chart', label: '차트번호', field: 'chart_number', w: 75 },
    { id: 'visit', label: '회차', field: 'visit_count', w: 45 },
    { id: 'body', label: '부위', field: 'body_part', w: 120 },
  ];

  const totalCountColIndex = FIXED_FIELDS.length + therapists.length * prescriptions.length;
  const newPatientColIndex = totalCountColIndex + 1;
  const totalColCount = newPatientColIndex + 1;
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
  const isBlankValue = (value) => value == null || String(value).trim() === '';
  const toPrescriptionCount = (value) => {
    const parsed = parseInt(String(value ?? '').trim(), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const isRowEmpty = (row) => ROW_DATA_FIELDS.every((field) => isBlankValue(row?.[field]));

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
      const sameDate = gridData.filter(r => r.date === row.date && r.date);
      return sameDate.reduce((s, r) => s + (r.prescription ? toPrescriptionCount(r.prescription_count) : 0), 0) || '';
    }
    if (colIdx === newPatientColIndex) {
      if (!row._isFirst) return '';
      const sameDate = gridData.filter(r => r.date === row.date && r.date);
      return sameDate.filter((r) => String(r.patient_name || '').includes('*')).length || '';
    }
    const tIdx = Math.floor((colIdx - FIXED_FIELDS.length) / prescriptions.length);
    const pIdx = (colIdx - FIXED_FIELDS.length) % prescriptions.length;
    const t = therapists[tIdx];
    if (!t) return '';
    const pres = prescriptions[pIdx];
    if (row.therapist_name === t.name && row.prescription === pres) {
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
  const [mergedCells, setMergedCells] = useState({}); // key "r-c" -> {rs, cs}

  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const imeOpenRef = useRef(false);
  const datePickerRef = useRef(null);
  const theadRef = useRef(null);
  const ctxMenuRef = useRef(null);
  const rowRefs = useRef([]);
  const [headerHeight, setHeaderHeight] = useState(132);
  const [rowHeights, setRowHeights] = useState([]);

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
      await supabase.from('shockwave_patient_logs').insert([payload]);
      if (targetRow.isInsertedDraft) {
        setInsertedDraftRows((prev) => prev.filter((item) => item.id !== targetRow.id));
      }
    } else {
      await supabase.from('shockwave_patient_logs').update(payload).eq('id', targetRow.id);
    }

    rememberCurrentRowOrder();
    await fetchLogs();
    for (const date of affectedDates) {
      if (!date) continue;
      try {
        await syncStatsDateToScheduler({ year: currentYear, month: currentMonth, date, therapists });
      } catch (error) {
        console.error('Failed to sync stats row snapshot to scheduler:', error);
      }
    }
  }, [currentMonth, currentYear, fetchLogs, rememberCurrentRowOrder]);

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
  const startEdit = (r, c, isDblClick = false) => {
    if (c === totalCountColIndex || c === newPatientColIndex) return;
    imeOpenRef.current = false;
    setEditing({ r, c, val: getVal(gridData[r], c), isDblClick });
  };

  const finishEdit = async () => {
    if (!editing) return;
    const { r, c, val } = editing;
    setEditing(null);
    wrapRef.current?.focus();

    const row = gridData[r];
    const oldVal = getVal(row, c);
    if (val === oldVal) return;
    const affectedDates = new Set();
    if (row?.date) affectedDates.add(row.date);

    if (c < FIXED_FIELDS.length) {
      const field = FIXED_FIELDS[c].field;
      let v = val;
      if (field === 'date' && v.trim()) {
        const tv = v.trim();
        if (tv.length === 5 && tv.includes('/')) v = `${currentYear}-${tv.replace('/', '-')}`;
        else if (tv.length === 4 && !tv.includes('-')) v = `${currentYear}-${tv.substring(0,2)}-${tv.substring(2,4)}`;
        else if (/^\d{1,2}$/.test(tv)) v = `${currentYear}-${String(currentMonth).padStart(2,'0')}-${tv.padStart(2,'0')}`;
      }

      let updatePayload = { [field]: v };
      if (field === 'body_part' && v.trim()) updatePayload.body_part = toTitleCaseBodyPart(v);

      if (field === 'patient_name' && v.trim()) {
        const queryName = v.trim().replace(/\*/g, '').replace(/\(-\)/g, '').trim();
        const normalizedQueryName = normalizeNameForMatch(queryName);
        const pastLogs = logs.filter((l) => l.id !== row.id && normalizeNameForMatch(l.patient_name) === normalizedQueryName);
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
        if (logs.length > 0) {
            const validDates = logs.map(l => l.date).filter(Boolean).sort();
            if (validDates.length > 0) fallbackDate = validDates[validDates.length - 1];
        }
        const ins = { date: row.date || fallbackDate, patient_name: row.patient_name || '', chart_number: row.chart_number || '', visit_count: row.visit_count || '', body_part: row.body_part || '', therapist_name: '', prescription: '', prescription_count: 0, source: 'manual', ...updatePayload };
        if (!ins.date) ins.date = fallbackDate;
        if (ins.date) affectedDates.add(ins.date);
        await supabase.from('shockwave_patient_logs').insert([ins]);
        if (row.isInsertedDraft) setInsertedDraftRows((prev) => prev.filter((item) => item.id !== row.id));
      } else {
        const nextRow = { ...row, ...updatePayload };
        if (nextRow?.date) affectedDates.add(nextRow.date);
        if (isRowEmpty(nextRow)) await supabase.from('shockwave_patient_logs').delete().eq('id', row.id);
        else await supabase.from('shockwave_patient_logs').update(updatePayload).eq('id', row.id);
      }
    } else {
      const tIdx = Math.floor((c - FIXED_FIELDS.length) / prescriptions.length);
      const pIdx = (c - FIXED_FIELDS.length) % prescriptions.length;
      const t = therapists[tIdx];
      if (!t) return;
      const pres = prescriptions[pIdx];
      const intVal = parseInt(val.trim(), 10) || 0;

      if (row.isDraft) {
        if (!val.trim()) return;
        let fallbackDate = `${currentYear}-${String(currentMonth).padStart(2,'0')}-01`;
        if (logs.length > 0) {
            const validDates = logs.map(l => l.date).filter(Boolean).sort();
            if (validDates.length > 0) fallbackDate = validDates[validDates.length - 1];
        }
        const ins = { date: fallbackDate, patient_name: '(이름없음)', chart_number: '', visit_count: '', body_part: '', therapist_name: t.name, prescription: pres, prescription_count: intVal, source: 'manual' };
        if (ins.date) affectedDates.add(ins.date);
        await supabase.from('shockwave_patient_logs').insert([ins]);
        if (row.isInsertedDraft) setInsertedDraftRows((prev) => prev.filter((item) => item.id !== row.id));
      } else {
        if (val.trim() === '') {
          if (row.therapist_name === t.name && row.prescription === pres) {
            const clearedFields = { therapist_name: '', prescription: '', prescription_count: 0 };
            const nextRow = { ...row, ...clearedFields };
            if (isRowEmpty(nextRow)) await supabase.from('shockwave_patient_logs').delete().eq('id', row.id);
            else await supabase.from('shockwave_patient_logs').update(clearedFields).eq('id', row.id);
          }
        } else {
          await supabase.from('shockwave_patient_logs').update({ therapist_name: t.name, prescription: pres, prescription_count: intVal }).eq('id', row.id);
        }
      }
    }
    rememberCurrentRowOrder();
    await fetchLogs();
    for (const date of affectedDates) {
      if (!date) continue;
      try {
        await syncStatsDateToScheduler({ year: currentYear, month: currentMonth, date, therapists });
      } catch (error) {
        console.error('Failed to sync stats edit to scheduler:', error);
      }
    }
  };

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

  const doCut = () => {
    if (!selNorm) return;
    setClipboardSource({ ...selNorm, mode: 'cut' });
    doCopy();
    // No immediate delete - will be deleted on paste
  };

  const recordUndo = (action) => {
    setUndoStack(prev => [action, ...prev].slice(0, 50));
  };

  const doUndo = async () => {
    const action = undoStack[0];
    if (!action) return;
    setUndoStack(prev => prev.slice(1));

    if (action.type === 'edit') {
      const { id, field, oldVal, date } = action;
      await supabase.from('shockwave_patient_logs').update({ [field]: oldVal }).eq('id', id);
      if (date) await syncStatsDateToScheduler({ year: currentYear, month: currentMonth, date, therapists });
    } else if (action.type === 'bulk') {
      const chunkSize = 50;
      for (let i = 0; i < action.changes.length; i += chunkSize) {
        const chunk = action.changes.slice(i, i + chunkSize);
        await Promise.all(chunk.map(c => {
          if (c.field === 'prescription_stats') {
             return supabase.from('shockwave_patient_logs').update({ 
               therapist_name: c.oldVal.t, 
               prescription: c.oldVal.p, 
               prescription_count: c.oldVal.c 
             }).eq('id', c.id);
          } else {
             return supabase.from('shockwave_patient_logs').update({ [c.field]: c.oldVal }).eq('id', c.id);
          }
        }));
      }
      for (const d of action.affectedDates) {
        if (d) await syncStatsDateToScheduler({ year: currentYear, month: currentMonth, date: d, therapists });
      }
    }
    await fetchLogs();
  };
  const doPaste = async (text, startR, startC) => {
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
              const ins = { date: `${currentYear}-${String(currentMonth).padStart(2,'0')}-01`, patient_name: '', chart_number: '', visit_count: '', body_part: '', therapist_name: '', prescription: '', prescription_count: '' };
              ins[field] = v;
              bulkInserts.push(ins);
              if (ins.date) affectedDates.add(ins.date);
            }
          } else {
            bulkUpdates.push({ id: row.id, data: { [field]: v } });
            if (field === 'date') {
               let nextDate = v;
               const tv = v.trim();
               if (tv.length === 5 && tv.includes('/')) nextDate = `${currentYear}-${tv.replace('/', '-')}`;
               else if (tv.length === 4 && !tv.includes('-')) nextDate = `${currentYear}-${tv.substring(0,2)}-${tv.substring(2,4)}`;
               else if (/^\d{1,2}$/.test(tv)) nextDate = `${currentYear}-${String(currentMonth).padStart(2,'0')}-${tv.padStart(2,'0')}`;
               affectedDates.add(nextDate);
               bulkUpdates[bulkUpdates.length-1].data.date = nextDate;
            }
          }
        } else {
          const tIdx = Math.floor((c - FIXED_FIELDS.length) / prescriptions.length);
          const pIdx = (c - FIXED_FIELDS.length) % prescriptions.length;
          const t = therapists[tIdx];
          if (!t) continue;
          const pres = prescriptions[pIdx];
          undoChanges.push({ id: row.id, field: 'prescription_stats', oldVal: { t: row.therapist_name, p: row.prescription, c: row.prescription_count }, newVal: { t: t.name, p: pres, c: v } });
          if (!row.isDraft) {
            bulkUpdates.push({ id: row.id, data: { therapist_name: t.name, prescription: pres, prescription_count: v } });
          }
        }
      }
    }

    if (bulkInserts.length > 0) await supabase.from('shockwave_patient_logs').insert(bulkInserts);
    for (const update of bulkUpdates) {
      await supabase.from('shockwave_patient_logs').update(update.data).eq('id', update.id);
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
    await fetchLogs();
    for (const d of affectedDates) {
      if (d) await syncStatsDateToScheduler({ year: currentYear, month: currentMonth, date: d, therapists });
    }
  };

  const clearRange = async (range) => {
    const affectedDates = new Set();
    const undoChanges = [];
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
          const t = therapists[tIdx];
          if (t && row.therapist_name === t.name && row.prescription === prescriptions[pIdx]) {
            updatePayload.therapist_name = '';
            updatePayload.prescription = '';
            updatePayload.prescription_count = '';
            undoChanges.push({ id: row.id, field: 'prescription_stats', oldVal: { t: row.therapist_name, p: row.prescription, c: row.prescription_count }, newVal: { t: '', p: '', c: '' } });
          }
        }
      }
      if (Object.keys(updatePayload).length > 0) {
        const nextRow = { ...row, ...updatePayload };
        if (isRowEmpty(nextRow)) await supabase.from('shockwave_patient_logs').delete().eq('id', row.id);
        else await supabase.from('shockwave_patient_logs').update(updatePayload).eq('id', row.id);
      }
    }
    return { undoChanges, affectedDates: Array.from(affectedDates) };
  };

  const doDelete = async () => {
    if (!selNorm) return;
    const { undoChanges, affectedDates } = await clearRange(selNorm);
    recordUndo({ type: 'bulk', changes: undoChanges, affectedDates });
    rememberCurrentRowOrder();
    await fetchLogs();
    for (const date of affectedDates) {
      if (date) await syncStatsDateToScheduler({ year: currentYear, month: currentMonth, date, therapists });
    }
  };

  const doDeleteRow = async (r) => {
    const row = gridData[r];
    if (row?.isInsertedDraft) {
      setInsertedDraftRows((prev) => prev.filter((item) => item.id !== row.id));
      setCtxMenu(null);
      return;
    }
    if (row && !row.isDraft && window.confirm(`${row.patient_name} 행을 삭제하시겠습니까?`)) {
      const affectedDate = row.date || '';
      await supabase.from('shockwave_patient_logs').delete().eq('id', row.id);
      setCtxMenu(null);
      rememberCurrentRowOrder();
      await fetchLogs();
      if (affectedDate) {
        try {
          await syncStatsDateToScheduler({ year: currentYear, month: currentMonth, date: affectedDate, therapists });
        } catch (error) {
          console.error('Failed to sync deleted stats row to scheduler:', error);
        }
      }
    }
  };

  const selectRow = useCallback((r) => {
    setFocus({ r, c: 0 });
    setSel({ r1: r, c1: 0, r2: r, c2: totalColCount - 1 });
    setCtxMenu(null);
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
  }, [copyRow]);

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
      if ((e.metaKey || e.ctrlKey) && (e.key === '-' || e.key === '_' || e.code === 'Minus') && isWholeRowSelected) {
        e.preventDefault();
        doDeleteRow(r);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); doDelete(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); e.shiftKey ? handleUnmerge() : handleMerge(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') { e.preventDefault(); doCopy(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === 'x') { e.preventDefault(); doCopy(); doDelete(); return; }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && c < totalCountColIndex) {
        imeOpenRef.current = true;
        setEditing({ r, c, val: '' });
      }
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [focus, sel, editing, gridData, totalColCount, totalCountColIndex, ctxMenu]);

  useEffect(() => {
    const handler = (e) => {
      if (editing) return;
      if (!focus) return;
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (text) { e.preventDefault(); doPaste(text, focus.r, focus.c); }
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [focus, editing, gridData]);

  useEffect(() => {
    if (editing && inputRef.current) { 
      inputRef.current.focus(); 
      if (editing.isDblClick && editing.c === FIXED_FIELDS.findIndex(f => f.field === 'date') && datePickerRef.current) {
        try { datePickerRef.current.showPicker(); } catch (e) {}
      }
    }
  }, [editing?.r, editing?.c]);

  useEffect(() => {
    if (editing && inputRef.current && !imeOpenRef.current) inputRef.current.select();
  }, [editing?.r, editing?.c]);

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

  useLayoutEffect(() => {
    const measure = () => {
      if (theadRef.current) setHeaderHeight(Math.round(theadRef.current.getBoundingClientRect().height));
      setRowHeights(rowRefs.current.map((rowEl) => (rowEl ? Math.round(rowEl.getBoundingClientRect().height) : 25)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [gridData, therapists.length, currentMonth]);

  // ─── 9. COMPUTED TOTALS ───────────────────────────────────
  const grandTotal = logs.reduce((s, l) => s + (l.prescription ? toPrescriptionCount(l.prescription_count) : 0), 0);
  const newPatientTotal = logs.filter((l) => String(l?.patient_name || '').includes('*')).length;

  const therapistTotals = useMemo(() => {
    return therapists.map(t => {
      const all = logs.filter(l => l.therapist_name === t.name && l.prescription);
      const total = all.reduce((s, l) => s + toPrescriptionCount(l.prescription_count), 0);
      const byPres = {};
      prescriptions.forEach(p => {
        byPres[p] = all.filter(l => l.prescription === p).reduce((s, l) => s + toPrescriptionCount(l.prescription_count), 0);
      });
      return { total, byPres };
    });
  }, [logs, therapists, prescriptions]);

  // ─── 10. RENDER ───────────────────────────────────────────
  return (
    <div className="sw-grid-wrapper" ref={wrapRef} tabIndex={0} onMouseUp={onMouseUp}>
      <table className="sw-grid-table">
        <colgroup>
          {FIXED_FIELDS.map((f, i) => <col key={f.id} style={{ width: f.w, minWidth: f.w }} />)}
          {therapists.map(t => prescriptions.map(p => <col key={`${t.id}-${p}`} style={{ width: 48 }} />))}
          <col style={{ width: 60 }} />
          <col style={{ width: 60 }} />
        </colgroup>

        <thead ref={theadRef}>
          {/* Row 1: Title */}
          <tr className="sw-header-row sw-header-row-title">
            <th colSpan={totalColCount} className="grid-title">
              <div className="grid-title-inner">
                <span>{currentMonth}월 충격파 현황</span>
                <button type="button" className="grid-title-action" onClick={onApplyTodaySchedule} disabled={!onApplyTodaySchedule || isApplyingTodaySchedule}>
                  {isApplyingTodaySchedule ? '적용 중...' : '오늘 스케줄 적용'}
                </button>
              </div>
            </th>
          </tr>

          {/* Row 2: Fixed Fields + Therapist Names + Summary Labels */}
          <tr className="sw-header-row sw-header-row-therapists">
            {FIXED_FIELDS.map((f, i) => (
              <th key={f.id} rowSpan={3} className={`hdr-fixed hdr-fixed-${i + 1} ${i === FIXED_FIELDS.length - 1 ? 'hdr-fixed-last' : ''}`}>
                {f.label}
              </th>
            ))}
            {therapists.map((t, idx) => (
              <th key={`tn-${t.id}`} colSpan={prescriptions.length} className={`hdr-therapist ${idx > 0 ? 'therapist-group-start' : ''}`} style={{ backgroundColor: THERAPIST_COLORS[idx % THERAPIST_COLORS.length] }}>
                {t.name} ( {therapistTotals[idx]?.total || 0}건 )
              </th>
            ))}
            <th rowSpan={2} className="hdr-total sticky-right-last-2 total-group-start">총건수</th>
            <th rowSpan={2} className="hdr-total hdr-new-patient sticky-right-last-1">신환</th>
          </tr>

          {/* Row 3: Prescription Names */}
          <tr className="sw-header-row sw-header-row-prescriptions">
            {therapists.map((t, idx) => prescriptions.map((p, pIdx) => (
              <th key={`${t.name}-${pIdx}`} className={`hdr-pres ${pIdx === 0 && idx > 0 ? 'therapist-group-start' : ''}`} style={{ backgroundColor: THERAPIST_COLORS[idx % THERAPIST_COLORS.length] }}>
                {p}
              </th>
            )))}
          </tr>

          {/* Row 4: Column-wise totals (Prescription Totals + Grand Totals) */}
          <tr className="sw-header-row sw-header-row-prescription-totals">
            {therapists.map((t, idx) => prescriptions.map((p, pIdx) => (
              <th
                key={`${t.name}-${pIdx}-inner`}
                className={`hdr-pres-total ${pIdx === 0 && idx > 0 ? 'therapist-group-start' : ''}`}
                style={{ backgroundColor: THERAPIST_TOTAL_COLORS[idx % THERAPIST_TOTAL_COLORS.length] }}
              >
                {therapistTotals[idx]?.byPres[p] || 0}
              </th>
            )))}
            <th className="hdr-grand-total sticky-right-last-2 total-group-start">{grandTotal}건</th>
            <th className="hdr-grand-total hdr-new-patient-total sticky-right-last-1">{newPatientTotal}명</th>
          </tr>
        </thead>

        <tbody>
          {gridData.map((row, ri) => {
            const isWholeRowSelected = !!selNorm && selNorm.r1 === ri && selNorm.r2 === ri && selNorm.c1 === 0 && selNorm.c2 === totalColCount - 1;
            const rowClasses = [
              row._isFirst && row.date ? 'tr-date-start' : '',
              isWholeRowSelected ? 'tr-row-selected' : '',
            ].filter(Boolean).join(' ');
            return (
            <tr key={row.id} className={rowClasses} ref={(el) => { rowRefs.current[ri] = el; }}>
              {Array.from({ length: totalColCount }, (_, ci) => {
                if (getMergedInto(ri, ci)) return null;
                const mergeInfo = mergedCells[getMergeKey(ri, ci)];
                const rs = mergeInfo?.rs || 1;
                const cs = mergeInfo?.cs || 1;
                const isSel = inSel(ri, ci);
                const isFoc = focus?.r === ri && focus?.c === ci;
                const isEdit = editing?.r === ri && editing?.c === ci;
                let val = getVal(row, ci);
                const isDateCol = ci === 1;
                const isTotalCol = ci === totalCountColIndex;
                const isNewPatientCol = ci === newPatientColIndex;
                let groupCls = '';
                if ((isDateCol || isTotalCol || isNewPatientCol) && row.date) {
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
                if (clipboardSource && ri >= clipboardSource.r1 && ri <= clipboardSource.r2 && ci >= clipboardSource.c1 && ci <= clipboardSource.c2) {
                    cls += clipboardSource.mode === 'cut' ? ' gc-cut-source' : ' gc-copy-source';
                }
                if (ci < FIXED_FIELDS.length && FIXED_FIELDS[ci]?.bold) cls += ' gc-bold';
                if (ci >= FIXED_FIELDS.length && ci < totalCountColIndex) cls += ' gc-therapist-value';
                if (isTotalCol) cls += ' gc-total total-group-start';
                if (isNewPatientCol) cls += ' gc-total gc-new-patient';
                if (isTherapistGroupStartCol(ci)) cls += ' therapist-group-start';

                let fixedLeft = 0;
                if (ci < frozenColumnCount) {
                    for (let i = 0; i < ci; i++) fixedLeft += (FIXED_FIELDS[i]?.w || 48);
                }

                if (isEdit) {
                  return (
                    <td key={ci} className={cls} rowSpan={rs > 1 ? rs : undefined} colSpan={cs > 1 ? cs : undefined} style={{ padding: 0, position: ci < frozenColumnCount ? 'sticky' : undefined, left: ci < frozenColumnCount ? fixedLeft : undefined, zIndex: 10 }}>
                      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                        <input ref={inputRef} className="gc-input" style={{ width: '100%', height: '100%', boxSizing: 'border-box' }} value={editing.val} onChange={e => setEditing({ ...editing, val: e.target.value })} onBlur={finishEdit} />
                        {isDateCol && (
                          <input 
                            type="date"
                            ref={datePickerRef}
                            style={{ position: 'absolute', opacity: 0, right: 0, top: 0, width: 0, height: 0, pointerEvents: 'none' }}
                            onChange={e => {
                              if (e.target.value) {
                                setEditing({ ...editing, val: e.target.value });
                                setTimeout(finishEdit, 50);
                              }
                            }}
                          />
                        )}
                      </div>
                    </td>
                  );
                }

                return (
                  <td
                    key={ci}
                    className={cls}
                    rowSpan={rs > 1 ? rs : undefined}
                    colSpan={cs > 1 ? cs : undefined}
                    onMouseDown={e => onMouseDown(e, ri, ci)}
                    onMouseEnter={() => onMouseEnter(ri, ci)}
                    onDoubleClick={() => onDblClick(ri, ci)}
                    onContextMenu={e => onCtxMenu(e, ri, ci)}
                  >
                    {val}
                    {isFoc && <div className="gc-dot" />}
                  </td>
                );
              })}
            </tr>
          );
        })}
        </tbody>
      </table>

      {/* Context Menu */}
      {ctxMenu && (
        <div ref={ctxMenuRef} className="ctx-menu" style={{ top: ctxMenu.y, left: ctxMenu.x }} onMouseDown={e => e.stopPropagation()}>
          {ctxMenu.type === 'row' ? (
            <>
              <div className="ctx-item" onClick={() => { selectRow(ctxMenu.r); setCtxMenu(null); }}>☰ 행 선택</div>
              <div className="ctx-item" onClick={() => { copyRow(ctxMenu.r); setCtxMenu(null); }}>📋 행 복사</div>
              <div className="ctx-item" onClick={() => { cutRow(ctxMenu.r); setCtxMenu(null); }}>✂️ 행 잘라내기</div>
              <div className="ctx-item" onClick={() => { pasteRow(ctxMenu.r); setCtxMenu(null); }}>📥 행 붙여넣기</div>
              <div className="ctx-sep" />
              <div className="ctx-item" onClick={() => { insertDraftRow(gridData[ctxMenu.r], 'before'); setCtxMenu(null); }}>⬆ 위에 행 삽입</div>
              <div className="ctx-item" onClick={() => { insertDraftRow(gridData[ctxMenu.r], 'after'); setCtxMenu(null); }}>⬇ 아래에 행 삽입</div>
              <div className="ctx-sep" />
              <div className="ctx-item ctx-danger" onClick={() => { doDeleteRow(ctxMenu.r); }}>❌ 행 삭제</div>
            </>
          ) : (
            <>
              <div className="ctx-item" onClick={() => { doCopy(); setCtxMenu(null); }}>📋 복사 <span className="ctx-shortcut">⌘C</span></div>
              <div className="ctx-item" onClick={() => { doCopy(); doDelete(); setCtxMenu(null); }}>✂️ 잘라내기 <span className="ctx-shortcut">⌘X</span></div>
              <div className="ctx-item" onClick={async () => {
                try { const t = await navigator.clipboard.readText(); doPaste(t, ctxMenu.r, ctxMenu.c); } catch { alert('Ctrl+V를 사용하세요.'); }
                setCtxMenu(null);
              }}>📥 붙여넣기 <span className="ctx-shortcut">⌘V</span></div>
              <div className="ctx-sep" />
              <div className="ctx-item" onClick={() => { handleMerge(); setCtxMenu(null); }}>⬛ 셀 병합 <span className="ctx-shortcut">⌘E</span></div>
              <div className="ctx-item" onClick={() => { handleUnmerge(); setCtxMenu(null); }}>⬜ 셀 병합 해제 <span className="ctx-shortcut">⌘⇧E</span></div>
              <div className="ctx-sep" />
              <div className="ctx-item" onClick={() => { doDelete(); setCtxMenu(null); }}>🗑️ 선택 내용 지우기 <span className="ctx-shortcut">Del</span></div>
              <div className="ctx-item ctx-danger" onClick={() => { doDeleteRow(ctxMenu.r); }}>❌ 이 행 영구 삭제</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

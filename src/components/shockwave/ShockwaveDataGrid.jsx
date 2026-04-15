import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { normalizeNameForMatch } from '../../lib/memoParser';
import { syncStatsDateToScheduler } from '../../lib/shockwaveSyncUtils';
import '../../styles/shockwave_stats.css';

const PRESCRIPTIONS = ['F1.5', 'F/Rdc', 'F/R'];
const PRES_DB_MAP = { 'F1.5': 'F1.5', 'F/Rdc': 'F/R DC', 'F/R': 'F/R' };
const PRES_DISPLAY_MAP = { 'F1.5': 'F1.5', 'F/R DC': 'F/Rdc', 'F/R': 'F/R' };
const THERAPIST_COLORS = ['#cde4f9', '#ffebb4', '#d9ead3', '#fce5cd', '#ead1dc'];
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
  const [insertedDraftRows, setInsertedDraftRows] = useState([]);
  const rowClipboardRef = useRef({ row: null, mode: null });
  const rowOrderRef = useRef(new Map());

  // ─── 1. DATA PREPARATION ─────────────────────────────────
  const gridData = useMemo(() => {
    const safeLogs = Array.isArray(logs) ? logs.filter(Boolean) : [];
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
  // Fixed: 날짜, 이름, 차트번호, 회차, 부위
  // Dynamic: per therapist × 3 prescriptions
  // Final: 총건수, 신환
  const FIXED_FIELDS = [
    { id: 'date', label: '날짜', field: 'date', w: 70 },
    { id: 'name', label: '이름', field: 'patient_name', w: 85, bold: true },
    { id: 'chart', label: '차트번호', field: 'chart_number', w: 75 },
    { id: 'visit', label: '회차', field: 'visit_count', w: 45 },
    { id: 'body', label: '부위', field: 'body_part', w: 120 },
  ];

  const totalCountColIndex = FIXED_FIELDS.length + therapists.length * 3;
  const newPatientColIndex = totalCountColIndex + 1;
  const totalColCount = newPatientColIndex + 1;
  const ROW_DATA_FIELDS = [
    ...FIXED_FIELDS.map((field) => field.field),
    'therapist_name',
    'prescription',
    'prescription_count',
  ];

  // Helper: get therapist column index offset
  const tColStart = (tIdx) => FIXED_FIELDS.length + tIdx * 3;
  const isTherapistGroupStartCol = (colIdx) => (
    colIdx >= FIXED_FIELDS.length &&
    colIdx < totalColCount - 1 &&
    (colIdx - FIXED_FIELDS.length) % 3 === 0 &&
    colIdx !== tColStart(0)
  );
  const isBlankValue = (value) => value == null || String(value).trim() === '';
  const isRowEmpty = (row) => ROW_DATA_FIELDS.every((field) => isBlankValue(row?.[field]));

  // ─── 2. CELL VALUE HELPERS ────────────────────────────────
  const getVal = (row, colIdx) => {
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
      // 총건수 — only show on first row of date group
      if (!row._isFirst) return '';
      const sameDate = gridData.filter(r => r.date === row.date && r.date);
      return sameDate.reduce((s, r) => s + (r.prescription ? (parseInt(r.prescription_count || '1') || 1) : 0), 0) || '';
    }
    if (colIdx === newPatientColIndex) {
      if (!row._isFirst) return '';
      const sameDate = gridData.filter(r => r.date === row.date && r.date);
      return sameDate.filter((r) => String(r.patient_name || '').includes('*')).length || '';
    }
    // Therapist prescription cell
    const tIdx = Math.floor((colIdx - FIXED_FIELDS.length) / 3);
    const pIdx = (colIdx - FIXED_FIELDS.length) % 3;
    const t = therapists[tIdx];
    if (!t) return '';
    const pres = PRESCRIPTIONS[pIdx];
    const dbPres = PRES_DB_MAP[pres];
    if (row.therapist_name === t.name && row.prescription === dbPres) {
      return row.prescription_count || '1';
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

  // Check if cell (r,c) is hidden by a merge
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
    if (r1 === r2 && c1 === c2) return; // single cell
    const key = getMergeKey(r1, c1);
    setMergedCells(prev => ({
      ...prev,
      [key]: { rs: r2 - r1 + 1, cs: c2 - c1 + 1 }
    }));
  };

  const handleUnmerge = () => {
    if (!focus) return;
    // Find merge that contains focus
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
    if (c === totalCountColIndex || c === newPatientColIndex) return; // summary columns read-only
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
      // Normal field
      const field = FIXED_FIELDS[c].field;
      let v = val;
      if (field === 'date' && v.trim()) {
        const tv = v.trim();
        if (tv.length === 5 && tv.includes('/')) v = `${currentYear}-${tv.replace('/', '-')}`;
        else if (tv.length === 4 && !tv.includes('-')) v = `${currentYear}-${tv.substring(0,2)}-${tv.substring(2,4)}`;
        else if (/^\d{1,2}$/.test(tv)) v = `${currentYear}-${String(currentMonth).padStart(2,'0')}-${tv.padStart(2,'0')}`;
      }

      let updatePayload = { [field]: v };

      if (field === 'body_part' && v.trim()) {
        updatePayload.body_part = toTitleCaseBodyPart(v);
      }

      // 이름 입력 시 과거 기록 바탕으로 차트번호, 부위, 회차(+1) 자동 완성
      if (field === 'patient_name' && v.trim()) {
        const queryName = v.trim().replace(/\*/g, '').replace(/\(-\)/g, '').trim();
        const normalizedQueryName = normalizeNameForMatch(queryName);
        const pastLogs = logs.filter((l) => {
          if (l.id === row.id) return false;
          return normalizeNameForMatch(l.patient_name) === normalizedQueryName;
        });
        if (pastLogs.length > 0) {
          pastLogs.sort((a, b) => {
             if (a.date !== b.date) return b.date.localeCompare(a.date);
             return (parseInt(b.visit_count || '0') || 0) - (parseInt(a.visit_count || '0') || 0);
          });
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
            if (validDates.length > 0) fallbackDate = validDates[validDates.length - 1]; // 가장 마지막 작성된 날짜를 기본값으로
        }

        const ins = {
          date: row.date || fallbackDate,
          patient_name: row.patient_name || '',
          chart_number: row.chart_number || '',
          visit_count: row.visit_count || '',
          body_part: row.body_part || '',
          therapist_name: '', prescription: '', prescription_count: '',
          source: 'manual',
          ...updatePayload
        };
        if (!ins.date) ins.date = fallbackDate;
        if (ins.date) affectedDates.add(ins.date);
        await supabase.from('shockwave_patient_logs').insert([ins]);
        if (row.isInsertedDraft) {
          setInsertedDraftRows((prev) => prev.filter((item) => item.id !== row.id));
        }
      } else {
        const nextRow = { ...row, ...updatePayload };
        if (nextRow?.date) affectedDates.add(nextRow.date);
        if (isRowEmpty(nextRow)) await supabase.from('shockwave_patient_logs').delete().eq('id', row.id);
        else await supabase.from('shockwave_patient_logs').update(updatePayload).eq('id', row.id);
      }
    } else {
      // Therapist cell
      const tIdx = Math.floor((c - FIXED_FIELDS.length) / 3);
      const pIdx = (c - FIXED_FIELDS.length) % 3;
      const t = therapists[tIdx];
      if (!t) return;
      const pres = PRESCRIPTIONS[pIdx];
      const dbPres = PRES_DB_MAP[pres];

      if (row.isDraft) {
        if (!val.trim()) return;
        
        let fallbackDate = `${currentYear}-${String(currentMonth).padStart(2,'0')}-01`;
        if (logs.length > 0) {
            const validDates = logs.map(l => l.date).filter(Boolean).sort();
            if (validDates.length > 0) fallbackDate = validDates[validDates.length - 1];
        }

        const ins = {
          date: fallbackDate,
          patient_name: '(이름없음)', chart_number: '', visit_count: '', body_part: '',
          therapist_name: t.name, prescription: dbPres, prescription_count: val.trim(),
          source: 'manual',
        };
        if (ins.date) affectedDates.add(ins.date);
        await supabase.from('shockwave_patient_logs').insert([ins]);
        if (row.isInsertedDraft) {
          setInsertedDraftRows((prev) => prev.filter((item) => item.id !== row.id));
        }
      } else {
        if (val.trim() === '') {
          if (row.therapist_name === t.name && row.prescription === dbPres) {
            const clearedFields = { therapist_name: '', prescription: '', prescription_count: '' };
            const nextRow = { ...row, ...clearedFields };
            if (isRowEmpty(nextRow)) await supabase.from('shockwave_patient_logs').delete().eq('id', row.id);
            else await supabase.from('shockwave_patient_logs').update(clearedFields).eq('id', row.id);
          }
        } else {
          await supabase.from('shockwave_patient_logs').update({
            therapist_name: t.name, prescription: dbPres, prescription_count: val.trim()
          }).eq('id', row.id);
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
  const onDblClick = (r, c) => {
    startEdit(r, c, true);
  };
  const onCtxMenu = (e, r, c) => {
    e.preventDefault();
    if (editing) finishEdit();
    if (!inSel(r, c)) {
      setFocus({ r, c });
      setSel({ r1: r, c1: c, r2: r, c2: c });
    }
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
    let tsv = '';
    for (let r = selNorm.r1; r <= selNorm.r2; r++) {
      const row = [];
      for (let c = selNorm.c1; c <= selNorm.c2; c++) row.push(getVal(gridData[r], c));
      tsv += row.join('\t') + '\n';
    }
    navigator.clipboard.writeText(tsv);
  };

  const doPaste = async (text, startR, startC) => {
    const affectedDates = new Set();
    const rows = text.split('\n').map(l => l.split('\t'));
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].length === 1 && rows[i][0] === '') continue;
      const r = startR + i;
      if (r >= gridData.length) break;
      const row = gridData[r];
      if (row?.date) affectedDates.add(row.date);

      for (let j = 0; j < rows[i].length; j++) {
        const c = startC + j;
        if (c >= totalCountColIndex) break; // skip summary columns
        const v = rows[i][j].trim();

        if (c < FIXED_FIELDS.length) {
          const field = FIXED_FIELDS[c].field;
          if (row.isDraft) {
            if (v) {
              const ins = {
                date: `${currentYear}-${String(currentMonth).padStart(2,'0')}-01`,
                patient_name: '', chart_number: '', visit_count: '', body_part: '',
                therapist_name: '', prescription: '', prescription_count: '',
              };
              ins[field] = v;
              if (ins.date) affectedDates.add(ins.date);
              await supabase.from('shockwave_patient_logs').insert([ins]);
            }
          } else {
            if (field === 'date' && v) {
              let nextDate = v;
              const tv = v.trim();
              if (tv.length === 5 && tv.includes('/')) nextDate = `${currentYear}-${tv.replace('/', '-')}`;
              else if (tv.length === 4 && !tv.includes('-')) nextDate = `${currentYear}-${tv.substring(0,2)}-${tv.substring(2,4)}`;
              else if (/^\d{1,2}$/.test(tv)) nextDate = `${currentYear}-${String(currentMonth).padStart(2,'0')}-${tv.padStart(2,'0')}`;
              affectedDates.add(nextDate);
            }
            await supabase.from('shockwave_patient_logs').update({ [field]: v }).eq('id', row.id);
          }
        } else {
          const tIdx = Math.floor((c - FIXED_FIELDS.length) / 3);
          const pIdx = (c - FIXED_FIELDS.length) % 3;
          const t = therapists[tIdx];
          if (!t || !v) continue;
          const dbPres = PRES_DB_MAP[PRESCRIPTIONS[pIdx]];
          if (!row.isDraft) {
            await supabase.from('shockwave_patient_logs').update({
              therapist_name: t.name, prescription: dbPres, prescription_count: v
            }).eq('id', row.id);
          }
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
        console.error('Failed to sync pasted stats to scheduler:', error);
      }
    }
  };

  const doDelete = async () => {
    if (!selNorm) return;
    const affectedDates = new Set();
    for (let r = selNorm.r1; r <= selNorm.r2; r++) {
      const row = gridData[r];
      if (row.isDraft) continue;
      if (row?.date) affectedDates.add(row.date);
      const updatePayload = {};
      for (let c = selNorm.c1; c <= selNorm.c2; c++) {
        if (c >= totalCountColIndex) continue;
        if (c < FIXED_FIELDS.length) {
          updatePayload[FIXED_FIELDS[c].field] = '';
        } else {
          const tIdx = Math.floor((c - FIXED_FIELDS.length) / 3);
          const pIdx = (c - FIXED_FIELDS.length) % 3;
          const t = therapists[tIdx];
          if (t && row.therapist_name === t.name && row.prescription === PRES_DB_MAP[PRESCRIPTIONS[pIdx]]) {
            updatePayload.therapist_name = '';
            updatePayload.prescription = '';
            updatePayload.prescription_count = '';
          }
        }
      }
      if (Object.keys(updatePayload).length === 0) continue;
      const nextRow = { ...row, ...updatePayload };
      if (isRowEmpty(nextRow)) await supabase.from('shockwave_patient_logs').delete().eq('id', row.id);
      else await supabase.from('shockwave_patient_logs').update(updatePayload).eq('id', row.id);
    }
    rememberCurrentRowOrder();
    await fetchLogs();
    for (const date of affectedDates) {
      if (!date) continue;
      try {
        await syncStatsDateToScheduler({ year: currentYear, month: currentMonth, date, therapists });
      } catch (error) {
        console.error('Failed to sync deleted stats to scheduler:', error);
      }
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
    const values = [
      snapshot.date,
      snapshot.patient_name,
      snapshot.chart_number,
      snapshot.visit_count,
      snapshot.body_part,
      snapshot.therapist_name,
      snapshot.prescription,
      snapshot.prescription_count,
    ];
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
    if (clipboard.mode === 'cut') {
      rowClipboardRef.current = { row: null, mode: null };
    }
  }, [applyRowSnapshot, gridData]);

  // ─── 8. KEYBOARD ─────────────────────────────────────────
  useEffect(() => {
    const kd = (e) => {
      if (ctxMenu && e.key === 'Escape') { setCtxMenu(null); return; }

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

      // Arrows
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
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); doDelete(); return; }

      // Merge/Unmerge: Ctrl+E / Ctrl+Shift+E
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        e.shiftKey ? handleUnmerge() : handleMerge();
        return;
      }

      // Copy/Cut
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') { e.preventDefault(); doCopy(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === 'x') { e.preventDefault(); doCopy(); doDelete(); return; }

      // Printable char starts edit
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && c < totalCountColIndex) {
        imeOpenRef.current = true;
        setEditing({ r, c, val: '' });
      }
    };

    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [focus, sel, editing, gridData, totalColCount, totalCountColIndex, ctxMenu]);

  // Paste listener
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

  // Focus input on edit start
  useEffect(() => {
    if (editing && inputRef.current) { 
      inputRef.current.focus(); 
      // 달력 피커 자동 팝업 (날짜 셀 더블클릭 시)
      if (editing.isDblClick && editing.c === FIXED_FIELDS.findIndex(f => f.field === 'date') && datePickerRef.current) {
        try { datePickerRef.current.showPicker(); } catch (e) {}
      }
    }
  }, [editing?.r, editing?.c]);

  // Initial select when first double-clicked / enter pressed
  useEffect(() => {
    if (editing && inputRef.current && !imeOpenRef.current) {
      inputRef.current.select();
    }
  }, [editing?.r, editing?.c]);

  // Close context menu
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [ctxMenu]);

  useLayoutEffect(() => {
    const measure = () => {
      if (theadRef.current) {
        setHeaderHeight(Math.round(theadRef.current.getBoundingClientRect().height));
      }
      setRowHeights(
        rowRefs.current.map((rowEl) => (
          rowEl ? Math.round(rowEl.getBoundingClientRect().height) : 25
        ))
      );
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [gridData, therapists.length, currentMonth]);

  // ─── 9. COMPUTED TOTALS ───────────────────────────────────
  const grandTotal = logs.reduce((s, l) => s + (l.prescription ? (parseInt(l.prescription_count || '1') || 1) : 0), 0);
  const newPatientTotal = logs.filter((l) => String(l?.patient_name || '').includes('*')).length;

  const therapistTotals = useMemo(() => {
    return therapists.map(t => {
      const all = logs.filter(l => l.therapist_name === t.name && l.prescription);
      const total = all.reduce((s, l) => s + (parseInt(l.prescription_count || '1') || 1), 0);
      const byPres = {};
      PRESCRIPTIONS.forEach(p => {
        const dbP = PRES_DB_MAP[p];
        byPres[p] = all.filter(l => l.prescription === dbP).reduce((s, l) => s + (parseInt(l.prescription_count || '1') || 1), 0);
      });
      return { total, byPres };
    });
  }, [logs, therapists]);

  // ─── 10. RENDER ───────────────────────────────────────────
  return (
    <div className="sw-grid-wrapper" ref={wrapRef} tabIndex={0} onMouseUp={onMouseUp}>
      <div className="sw-grid-inner">
        <div className="sw-row-headers">
          <div className="sw-row-headers-spacer" style={{ height: `${headerHeight}px` }} />
          {gridData.map((row, ri) => {
            const rowHeaderCls = [
              'sw-row-header',
              row._isFirst && row.date ? 'sw-row-header-date-start' : '',
              focus?.r === ri ? 'active' : '',
            ].filter(Boolean).join(' ');

            return (
              <button
                key={`row-hdr-${row.id}`}
                type="button"
                className={rowHeaderCls}
                style={{ height: `${rowHeights[ri] || 25}px` }}
                onMouseDown={(e) => onRowHeaderMouseDown(e, ri)}
                onContextMenu={(e) => onRowHeaderContextMenu(e, ri)}
              >
                {ri + 1}
              </button>
            );
          })}
        </div>

      <table className="sw-grid-table">
        {/* ── COLGROUP: controls widths without conflicting with colspan ── */}
        <colgroup>
          {FIXED_FIELDS.map(f => <col key={f.id} style={{ width: f.w }} />)}
          {therapists.map(t => PRESCRIPTIONS.map(p => <col key={`${t.id}-${p}`} style={{ width: 48 }} />))}
          <col style={{ width: 60 }} />
          <col style={{ width: 60 }} />
        </colgroup>

        <thead ref={theadRef}>
          {/* Row 1: Title */}
          <tr>
            <th colSpan={totalColCount} className="grid-title">
              <div className="grid-title-inner">
                <span>{currentMonth}월 충격파 현황</span>
                <button
                  type="button"
                  className="grid-title-action"
                  onClick={onApplyTodaySchedule}
                  disabled={!onApplyTodaySchedule || isApplyingTodaySchedule}
                >
                  {isApplyingTodaySchedule ? '적용 중...' : '오늘 스케줄 적용'}
                </button>
              </div>
            </th>
          </tr>

          {/* Row 2: Fixed headers (rowSpan=3) + Therapist names (colSpan=3) + 총건수/신환 (rowSpan=2) */}
          <tr>
            {FIXED_FIELDS.map((f, i) => (
              <th key={f.id} rowSpan={3} className={`hdr-fixed hdr-fixed-${i + 1} ${i === FIXED_FIELDS.length - 1 ? 'hdr-fixed-last' : ''}`}>
                {f.label}
              </th>
            ))}
            {therapists.map((t, idx) => (
              <th
                key={`tn-${t.id}`}
                colSpan={3}
                className={`hdr-therapist ${idx > 0 ? 'therapist-group-start' : ''}`}
                style={{ backgroundColor: THERAPIST_COLORS[idx % THERAPIST_COLORS.length] }}
              >
                {t.name} ( {therapistTotals[idx]?.total || 0}건 )
              </th>
            ))}
            <th rowSpan={2} className="hdr-total total-group-start">총건수</th>
            <th rowSpan={2} className="hdr-total hdr-new-patient">신환</th>
          </tr>

          {/* Row 3: Prescription names */}
          <tr>
            {therapists.map((t, idx) => PRESCRIPTIONS.map(p => (
              <th
                key={`pn-${t.id}-${p}`}
                className={`hdr-pres ${PRESCRIPTIONS.indexOf(p) === 0 && idx > 0 ? 'therapist-group-start' : ''}`}
                style={{ backgroundColor: THERAPIST_COLORS[idx % THERAPIST_COLORS.length] }}
              >
                {p}
              </th>
            )))}
          </tr>

          {/* Row 4: Prescription totals */}
          <tr>
            {therapists.map((t, idx) => PRESCRIPTIONS.map(p => (
              <th
                key={`pt-${t.id}-${p}`}
                className={`hdr-pres-total ${PRESCRIPTIONS.indexOf(p) === 0 && idx > 0 ? 'therapist-group-start' : ''}`}
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
            const rowClasses = [
              row._isFirst && row.date ? 'tr-date-start' : '',
            ].filter(Boolean).join(' ');

            return (
            <tr
              key={row.id}
              className={rowClasses}
              ref={(el) => { rowRefs.current[ri] = el; }}
            >
              {Array.from({ length: totalColCount }, (_, ci) => {
                // Skip if merged into another cell
                if (getMergedInto(ri, ci)) return null;

                const mergeInfo = mergedCells[getMergeKey(ri, ci)];
                const rs = mergeInfo?.rs || 1;
                const cs = mergeInfo?.cs || 1;

                const isSel = inSel(ri, ci);
                const isFoc = focus?.r === ri && focus?.c === ci;
                const isEdit = editing?.r === ri && editing?.c === ci;

                let val = getVal(row, ci);

                // Date & total: hide text for non-first rows of same date group
                const isDateCol = ci === 0;
                const isTotalCol = ci === totalCountColIndex;
                const isNewPatientCol = ci === newPatientColIndex;
                let groupCls = '';
                if ((isDateCol || isTotalCol || isNewPatientCol) && row.date) {
                  if (!row._isFirst) {
                    val = '';
                    groupCls = row._isLast ? 'grp-last' : 'grp-mid';
                  } else if (!row._isLast) {
                    groupCls = 'grp-first';
                  }
                }

                let cls = 'gc';
                if (isSel) cls += ' gc-sel';
                if (isFoc) cls += ' gc-foc';
                if (groupCls) cls += ' ' + groupCls;
                if (ci < FIXED_FIELDS.length) cls += ` gc-fixed gc-fixed-${ci + 1}`;
                if (ci < FIXED_FIELDS.length && FIXED_FIELDS[ci]?.bold) cls += ' gc-bold';
                if (ci >= FIXED_FIELDS.length && ci < totalCountColIndex) cls += ' gc-therapist-value';
                if (isDateCol) cls += ' gc-date';
                if (isTotalCol) cls += ' gc-total total-group-start';
                if (isNewPatientCol) cls += ' gc-total gc-new-patient';
                if (isTherapistGroupStartCol(ci)) cls += ' therapist-group-start';

                if (isEdit) {
                  return (
                    <td key={ci} className={cls} rowSpan={rs > 1 ? rs : undefined} colSpan={cs > 1 ? cs : undefined} style={{ padding: 0 }}>
                      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                        <input
                          ref={inputRef}
                          className="gc-input"
                          style={{ width: '100%', height: '100%', boxSizing: 'border-box' }}
                          value={editing.val}
                          onChange={e => setEditing({ ...editing, val: e.target.value })}
                          onBlur={finishEdit}
                        />
                        {isDateCol && (
                          <input 
                            type="date"
                            ref={datePickerRef}
                            style={{ position: 'absolute', opacity: 0, right: 0, top: 0, width: 0, height: 0, pointerEvents: 'none' }}
                            onChange={e => {
                              if (e.target.value) {
                                // e.target.value is "YYYY-MM-DD"
                                setEditing({ ...editing, val: e.target.value });
                                setTimeout(finishEdit, 50);
                              }
                            }}
                            onBlur={() => {}} // focus out doesn't trigger anything special here
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
          )})}
        </tbody>
      </table>
      </div>

      {/* Context Menu */}
      {ctxMenu && (
        <div className="ctx-menu" style={{ top: ctxMenu.y, left: ctxMenu.x }} onMouseDown={e => e.stopPropagation()}>
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

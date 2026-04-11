import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../../lib/supabaseClient';
import '../../styles/shockwave_stats.css';

const PRESCRIPTIONS = ['F1.5', 'F/Rdc', 'F/R'];
const PRES_DB_MAP = { 'F1.5': 'F1.5', 'F/Rdc': 'F/R DC', 'F/R': 'F/R' };
const PRES_DISPLAY_MAP = { 'F1.5': 'F1.5', 'F/R DC': 'F/Rdc', 'F/R': 'F/R' };
const THERAPIST_COLORS = ['#cde4f9', '#ffebb4', '#d9ead3', '#fce5cd', '#ead1dc'];

export default function ShockwaveDataGrid({ logs, therapists, currentYear, currentMonth, fetchLogs }) {

  // ─── 1. DATA PREPARATION ─────────────────────────────────
  const gridData = useMemo(() => {
    const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
    const groups = {};
    sorted.forEach(log => {
      const d = log.date || '';
      if (!groups[d]) groups[d] = [];
      groups[d].push(log);
    });

    const flat = [];
    Object.keys(groups).sort().forEach(date => {
      const items = groups[date];
      items.forEach((log, idx) => {
        flat.push({
          ...log,
          _isFirst: idx === 0,
          _isLast: idx === items.length - 1,
          _groupSize: items.length,
        });
      });
    });

    // Add 40+ empty draft rows
    const draftsNeeded = Math.max(60 - flat.length, 30);
    for (let i = 0; i < draftsNeeded; i++) {
      flat.push({
        id: `draft-${i}`,
        date: '', patient_name: '', chart_number: '', visit_count: '',
        body_part: '', therapist_name: '', prescription: '', prescription_count: '',
        isDraft: true, _isFirst: true, _isLast: true, _groupSize: 1,
      });
    }
    return flat;
  }, [logs]);

  // Column definitions (flat array matching <colgroup>)
  // Fixed: 날짜, 이름, 차트번호, 회차, 부위
  // Dynamic: per therapist × 3 prescriptions
  // Final: 총건수
  const FIXED_FIELDS = [
    { id: 'date', label: '날짜', field: 'date', w: 70 },
    { id: 'name', label: '이름', field: 'patient_name', w: 85, bold: true },
    { id: 'chart', label: '차트번호', field: 'chart_number', w: 75 },
    { id: 'visit', label: '회차', field: 'visit_count', w: 45 },
    { id: 'body', label: '부위', field: 'body_part', w: 120 },
  ];

  const totalColCount = FIXED_FIELDS.length + therapists.length * 3 + 1;

  // Helper: get therapist column index offset
  const tColStart = (tIdx) => FIXED_FIELDS.length + tIdx * 3;

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
    if (colIdx === totalColCount - 1) {
      // 총건수 — only show on first row of date group
      if (!row._isFirst) return '';
      const sameDate = gridData.filter(r => r.date === row.date && r.date);
      return sameDate.reduce((s, r) => s + (r.prescription ? (parseInt(r.prescription_count || '1') || 1) : 0), 0) || '';
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

  const selNorm = sel ? {
    r1: Math.min(sel.r1, sel.r2), c1: Math.min(sel.c1, sel.c2),
    r2: Math.max(sel.r1, sel.r2), c2: Math.max(sel.c1, sel.c2),
  } : null;

  const inSel = (r, c) => selNorm && r >= selNorm.r1 && r <= selNorm.r2 && c >= selNorm.c1 && c <= selNorm.c2;

  // ─── 4. MERGE / UNMERGE ───────────────────────────────────
  const getMergeKey = (r, c) => `${r}-${c}`;

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
  const startEdit = (r, c) => {
    if (c === totalColCount - 1) return; // 총건수 read-only
    setEditing({ r, c, val: getVal(gridData[r], c) });
  };

  const finishEdit = async () => {
    if (!editing) return;
    const { r, c, val } = editing;
    setEditing(null);
    wrapRef.current?.focus();

    const row = gridData[r];
    const oldVal = getVal(row, c);
    if (val === oldVal) return;

    if (c < FIXED_FIELDS.length) {
      // Normal field
      const field = FIXED_FIELDS[c].field;
      let v = val;
      if (field === 'date') {
        if (v.length === 5 && v.includes('/')) v = `${currentYear}-${v.replace('/', '-')}`;
        else if (v.length === 4 && !v.includes('-')) v = `${currentYear}-${v.substring(0,2)}-${v.substring(2,4)}`;
      }

      if (row.isDraft) {
        const ins = {
          date: row.date || `${currentYear}-${String(currentMonth).padStart(2,'0')}-01`,
          patient_name: row.patient_name || '',
          chart_number: row.chart_number || '',
          visit_count: row.visit_count || '',
          body_part: row.body_part || '',
          therapist_name: '', prescription: '', prescription_count: '',
        };
        ins[field] = v;
        if (!ins.date) ins.date = `${currentYear}-${String(currentMonth).padStart(2,'0')}-01`;
        await supabase.from('shockwave_patient_logs').insert([ins]);
      } else {
        await supabase.from('shockwave_patient_logs').update({ [field]: v }).eq('id', row.id);
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
        const ins = {
          date: `${currentYear}-${String(currentMonth).padStart(2,'0')}-01`,
          patient_name: '(이름없음)', chart_number: '', visit_count: '', body_part: '',
          therapist_name: t.name, prescription: dbPres, prescription_count: val.trim(),
        };
        await supabase.from('shockwave_patient_logs').insert([ins]);
      } else {
        if (val.trim() === '') {
          if (row.therapist_name === t.name && row.prescription === dbPres) {
            await supabase.from('shockwave_patient_logs').update({
              therapist_name: '', prescription: '', prescription_count: ''
            }).eq('id', row.id);
          }
        } else {
          await supabase.from('shockwave_patient_logs').update({
            therapist_name: t.name, prescription: dbPres, prescription_count: val.trim()
          }).eq('id', row.id);
        }
      }
    }
    fetchLogs();
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
  const onDblClick = (r, c) => startEdit(r, c);
  const onCtxMenu = (e, r, c) => {
    e.preventDefault();
    if (editing) finishEdit();
    if (!inSel(r, c)) {
      setFocus({ r, c });
      setSel({ r1: r, c1: c, r2: r, c2: c });
    }
    setCtxMenu({ x: e.clientX, y: e.clientY, r, c });
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
    const rows = text.split('\n').map(l => l.split('\t'));
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].length === 1 && rows[i][0] === '') continue;
      const r = startR + i;
      if (r >= gridData.length) break;
      const row = gridData[r];

      for (let j = 0; j < rows[i].length; j++) {
        const c = startC + j;
        if (c >= totalColCount - 1) break; // skip 총건수
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
              await supabase.from('shockwave_patient_logs').insert([ins]);
            }
          } else {
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
    fetchLogs();
  };

  const doDelete = async () => {
    if (!selNorm) return;
    for (let r = selNorm.r1; r <= selNorm.r2; r++) {
      const row = gridData[r];
      if (row.isDraft) continue;
      for (let c = selNorm.c1; c <= selNorm.c2; c++) {
        if (c >= totalColCount - 1) continue;
        if (c < FIXED_FIELDS.length) {
          await supabase.from('shockwave_patient_logs').update({ [FIXED_FIELDS[c].field]: '' }).eq('id', row.id);
        } else {
          const tIdx = Math.floor((c - FIXED_FIELDS.length) / 3);
          const pIdx = (c - FIXED_FIELDS.length) % 3;
          const t = therapists[tIdx];
          if (t && row.therapist_name === t.name && row.prescription === PRES_DB_MAP[PRESCRIPTIONS[pIdx]]) {
            await supabase.from('shockwave_patient_logs').update({ therapist_name: '', prescription: '', prescription_count: '' }).eq('id', row.id);
          }
        }
      }
    }
    fetchLogs();
  };

  const doDeleteRow = async (r) => {
    const row = gridData[r];
    if (row && !row.isDraft && window.confirm(`${row.patient_name} 행을 삭제하시겠습니까?`)) {
      await supabase.from('shockwave_patient_logs').delete().eq('id', row.id);
      setCtxMenu(null);
      fetchLogs();
    }
  };

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

      if (e.key === 'Enter') { e.preventDefault(); startEdit(r, c); return; }
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
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && c < totalColCount - 1) {
        setEditing({ r, c, val: '' });
        setTimeout(() => { if (inputRef.current) inputRef.current.value = e.key; }, 0);
      }
    };

    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [focus, sel, editing, gridData, totalColCount, ctxMenu]);

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
      // Do not re-select on every keystroke, only when first entering edit mode for a cell
    }
  }, [editing?.r, editing?.c]);

  // Initial select when first double-clicked / enter pressed
  useEffect(() => {
    if (editing && inputRef.current) {
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

  // ─── 9. COMPUTED TOTALS ───────────────────────────────────
  const grandTotal = logs.reduce((s, l) => s + (l.prescription ? (parseInt(l.prescription_count || '1') || 1) : 0), 0);

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

      <table className="sw-grid-table">
        {/* ── COLGROUP: controls widths without conflicting with colspan ── */}
        <colgroup>
          {FIXED_FIELDS.map(f => <col key={f.id} style={{ width: f.w }} />)}
          {therapists.map(t => PRESCRIPTIONS.map(p => <col key={`${t.id}-${p}`} style={{ width: 48 }} />))}
          <col style={{ width: 60 }} />
        </colgroup>

        <thead>
          {/* Row 1: Title */}
          <tr>
            <th colSpan={totalColCount} className="grid-title">
              {currentMonth}월 충격파 현황
            </th>
          </tr>

          {/* Row 2: Fixed headers (rowSpan=3) + Therapist names (colSpan=3) + 총건수 (rowSpan=2) */}
          <tr>
            {FIXED_FIELDS.map((f, i) => (
              <th key={f.id} rowSpan={3} className={`hdr-fixed ${i === FIXED_FIELDS.length - 1 ? 'hdr-fixed-last' : ''}`}>
                {f.label}
              </th>
            ))}
            {therapists.map((t, idx) => (
              <th key={`tn-${t.id}`} colSpan={3} className="hdr-therapist" style={{ backgroundColor: THERAPIST_COLORS[idx % THERAPIST_COLORS.length] }}>
                {t.name} ( {therapistTotals[idx]?.total || 0}건 )
              </th>
            ))}
            <th rowSpan={2} className="hdr-total">총건수</th>
          </tr>

          {/* Row 3: Prescription names */}
          <tr>
            {therapists.map((t, idx) => PRESCRIPTIONS.map(p => (
              <th key={`pn-${t.id}-${p}`} className="hdr-pres" style={{ backgroundColor: THERAPIST_COLORS[idx % THERAPIST_COLORS.length] }}>
                {p}
              </th>
            )))}
          </tr>

          {/* Row 4: Prescription totals */}
          <tr>
            {therapists.map((t, idx) => PRESCRIPTIONS.map(p => (
              <th key={`pt-${t.id}-${p}`} className="hdr-pres-total">
                {therapistTotals[idx]?.byPres[p] || 0}
              </th>
            )))}
            <th className="hdr-grand-total">{grandTotal}건</th>
          </tr>
        </thead>

        <tbody>
          {gridData.map((row, ri) => (
            <tr key={row.id}>
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
                const isTotalCol = ci === totalColCount - 1;
                let groupCls = '';
                if ((isDateCol || isTotalCol) && row.date) {
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
                if (ci < FIXED_FIELDS.length && FIXED_FIELDS[ci]?.bold) cls += ' gc-bold';
                if (isTotalCol) cls += ' gc-total';

                if (isEdit) {
                  return (
                    <td key={ci} className={cls} rowSpan={rs > 1 ? rs : undefined} colSpan={cs > 1 ? cs : undefined} style={{ padding: 0 }}>
                      <input
                        ref={inputRef}
                        className="gc-input"
                        value={editing.val}
                        onChange={e => setEditing({ ...editing, val: e.target.value })}
                        onBlur={finishEdit}
                      />
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
          ))}
        </tbody>
      </table>

      {/* Context Menu */}
      {ctxMenu && (
        <div className="ctx-menu" style={{ top: ctxMenu.y, left: ctxMenu.x }} onMouseDown={e => e.stopPropagation()}>
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
        </div>
      )}
    </div>
  );
}

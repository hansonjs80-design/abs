import { useEffect, useRef, useState } from 'react';
import { Plus, Save, Settings2, Trash2, X } from 'lucide-react';
import { useSchedule } from '../contexts/ScheduleContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabaseClient';
import {
  cArmColumns, cArmColumnGroups, cArmIncentive, cArmMonthTotal, cArmPersonTotals, createCArmMonth,
  daysInCArmMonth, DEFAULT_C_ARM_RATE, loadCArmTemplate, loadCArmYear, MAX_C_ARM_COUNT,
  MAX_C_ARM_RATE, saveCArmMonth, validateCArmMonth,
} from '../lib/cArmStats';
import { pasteCArmCounts } from '../lib/cArmClipboard';
import { clearCArmSelection, copyCArmSelection } from '../lib/cArmSelection';
import useCArmGridSelection from '../hooks/useCArmGridSelection';
import '../styles/c_arm_stats.css';

const format = (value) => value.toLocaleString('ko-KR');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const monthDocument = (row) => ({
  incentive_rate: row.incentive_rate,
  columns: cArmColumns(row),
  radiographers: row.radiographers,
});

function readDraft(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; }
}

function RadiographerSettings({ document, year, month, onApply, onClose }) {
  const [groups, setGroups] = useState(() => {
    const cols = cArmColumns(document);
    const colGroups = cArmColumnGroups(cols);
    return colGroups.map((g, idx) => ({
      id: `grp_${idx}_${Date.now()}`,
      name: g.category,
      items: g.columns.map((c) => ({ id: c.id, label: c.label, rate: c.rate })),
    }));
  });
  const [people, setPeople] = useState(() => document.radiographers.map((person) => ({ ...person })));
  const [error, setError] = useState('');
  const dialog = useRef(null);

  useEffect(() => {
    const previousFocus = window.document.activeElement;
    const element = dialog.current;
    element.showModal();
    return () => { element.close(); previousFocus?.focus?.(); };
  }, []);

  const totalItemCount = groups.reduce((sum, g) => sum + g.items.length, 0);

  const changeGroupName = (groupId, name) => {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, name } : g)));
  };

  const addGroup = () => {
    if (totalItemCount >= 10 || groups.length >= 5) return;
    const nextGroupIdx = groups.length + 1;
    const nextColIdx = totalItemCount + 1;
    const baseRate = groups[0]?.items[0]?.rate ?? document.incentive_rate ?? DEFAULT_C_ARM_RATE;
    setGroups((prev) => [
      ...prev,
      {
        id: `grp_${Date.now()}`,
        name: `상위 항목 ${nextGroupIdx}`,
        items: [{ id: `col_${Date.now()}`, label: `항목 ${nextColIdx}`, rate: baseRate }],
      },
    ]);
  };

  const removeGroup = (groupId) => {
    if (groups.length <= 1) return;
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const hasCounts = group.items.some((item) =>
      people.some((person) => Object.values(person.days || {}).some((day) => (Number(day[item.id]) || 0) > 0))
    );
    if (hasCounts) {
      setError('기록된 건수가 있는 항목이 포함된 상위 항목은 삭제할 수 없습니다.');
      return;
    }
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
  };

  const changeItem = (groupId, itemId, field, value) => {
    setGroups((prev) => prev.map((g) => {
      if (g.id !== groupId) return g;
      return {
        ...g,
        items: g.items.map((item) => {
          if (item.id !== itemId) return item;
          if (field === 'rate') {
            if (value !== '' && (!/^\d+$/.test(value) || Number(value) > MAX_C_ARM_RATE)) return item;
            return { ...item, rate: value === '' ? 0 : Number(value) };
          }
          return { ...item, [field]: value };
        }),
      };
    }));
  };

  const addItem = (groupId) => {
    if (totalItemCount >= 10) return;
    const baseRate = groups.find((g) => g.id === groupId)?.items[0]?.rate ?? document.incentive_rate ?? DEFAULT_C_ARM_RATE;
    setGroups((prev) => prev.map((g) => {
      if (g.id !== groupId) return g;
      return {
        ...g,
        items: [...g.items, { id: `col_${Date.now()}`, label: `세부 항목 ${g.items.length + 1}`, rate: baseRate }],
      };
    }));
  };

  const removeItem = (groupId, itemId) => {
    if (totalItemCount <= 1) return;
    const hasCounts = people.some((person) => Object.values(person.days || {}).some((day) => (Number(day[itemId]) || 0) > 0));
    if (hasCounts) {
      setError('기록된 건수가 있는 세부 항목은 삭제할 수 없습니다.');
      return;
    }
    setGroups((prev) => prev.map((g) => {
      if (g.id !== groupId) return g;
      return {
        ...g,
        items: g.items.filter((item) => item.id !== itemId),
      };
    }).filter((g) => g.items.length > 0));
  };

  const apply = (event) => {
    event.preventDefault();
    const columns = groups.flatMap((group) => {
      const category = group.name.trim() || 'C-Arm';
      return group.items.map((item) => ({
        id: item.id,
        label: item.label.trim(),
        rate: item.rate,
        category,
      }));
    });
    const updated = {
      ...document,
      columns,
      radiographers: people.map((person) => ({
        ...person,
        name: person.name.trim(),
        columns,
      })),
    };
    try {
      validateCArmMonth(updated, year, month);
      onApply(updated);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <dialog ref={dialog} className="c-arm-settings" onCancel={onClose} aria-labelledby="c-arm-settings-title">
      <form onSubmit={apply}>
        <div className="c-arm-dialog-heading">
          <h2 id="c-arm-settings-title">방사선사 및 항목 설정</h2>
          <button type="button" onClick={onClose} aria-label="닫기"><X size={19} /></button>
        </div>
        <p>{year}년 {month}월 기록표에 표시할 상위 항목, 세부 항목 및 방사선사 명단을 설정합니다.</p>
        <p className="c-arm-help">건수가 있는 항목과 방사선사는 제거할 수 없습니다. 새 달은 이전 설정을 이어받습니다.</p>

        <section className="c-arm-settings-section">
          <div className="c-arm-section-header">
            <h3>상위 항목 및 세부 항목(열) 설정</h3>
            <button
              type="button"
              className="c-arm-add-group-btn"
              disabled={totalItemCount >= 10 || groups.length >= 5}
              onClick={addGroup}
            >
              <Plus size={15} /> 상위 항목 추가
            </button>
          </div>
          <div className="c-arm-group-list">
            {groups.map((group, gIdx) => {
              const groupHasCounts = group.items.some((item) =>
                people.some((person) => Object.values(person.days || {}).some((day) => (Number(day[item.id]) || 0) > 0))
              );
              return (
                <div key={group.id} className="c-arm-group-card">
                  <div className="c-arm-group-card-header">
                    <span className="c-arm-group-badge">상위 {gIdx + 1}</span>
                    <input
                      type="text"
                      value={group.name}
                      maxLength={40}
                      placeholder="상위 항목명 (예: C-Arm)"
                      aria-label={`상위 항목 ${gIdx + 1} 이름`}
                      onChange={(e) => changeGroupName(group.id, e.target.value)}
                      className="c-arm-group-name-input"
                    />
                    {groups.length > 1 && (
                      <button
                        type="button"
                        className="c-arm-icon-btn"
                        disabled={groupHasCounts}
                        title={groupHasCounts ? '기록이 있는 항목이 포함된 상위 항목은 삭제할 수 없습니다' : '상위 항목 삭제'}
                        aria-label={`${group.name} 상위 항목 삭제`}
                        onClick={() => removeGroup(group.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                  <div className="c-arm-column-list">
                    {group.items.map((item, itemIdx) => {
                      const hasCounts = people.some((p) =>
                        Object.values(p.days || {}).some((d) => (Number(d[item.id]) || 0) > 0)
                      );
                      return (
                        <div key={item.id} className="c-arm-column-setting">
                          <span className="c-arm-setting-num">{itemIdx + 1}</span>
                          <input
                            type="text"
                            value={item.label}
                            maxLength={30}
                            placeholder="세부 항목명 (예: 초진)"
                            aria-label={`${group.name} 세부 항목 ${itemIdx + 1} 이름`}
                            onChange={(e) => changeItem(group.id, item.id, 'label', e.target.value)}
                          />
                          <div className="c-arm-rate-input-wrap">
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={item.rate ?? 0}
                              aria-label={`${item.label || `세부 항목 ${itemIdx + 1}`} 인센티브 단가`}
                              onChange={(e) => changeItem(group.id, item.id, 'rate', e.target.value)}
                            />
                            <span>원</span>
                          </div>
                          <button
                            type="button"
                            className="c-arm-icon-btn"
                            disabled={totalItemCount <= 1 || group.items.length <= 1 || hasCounts}
                            title={hasCounts ? '기록이 있는 열은 삭제할 수 없습니다' : '세부 항목 삭제'}
                            aria-label={`${item.label} 세부 항목 삭제`}
                            onClick={() => removeItem(group.id, item.id)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    className="c-arm-add-subitem-btn"
                    disabled={totalItemCount >= 10}
                    onClick={() => addItem(group.id)}
                  >
                    <Plus size={14} /> 세부 항목 추가
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="c-arm-settings-section" style={{ marginTop: '20px' }}>
          <h3>방사선사 명단</h3>
          <div className="c-arm-person-list">
            {people.map((person, index) => {
              const currentCols = groups.flatMap((g) => g.items.map((i) => ({ ...i, category: g.name })));
              const hasCounts = cArmPersonTotals(person, currentCols).total > 0;
              return (
                <div key={person.id} className="c-arm-person-setting">
                  <label htmlFor={`c-arm-name-${person.id}`}>{index + 1}</label>
                  <input
                    id={`c-arm-name-${person.id}`}
                    aria-label={`방사선사 ${index + 1} 이름`}
                    value={person.name}
                    maxLength={40}
                    onChange={(event) => setPeople((prev) => prev.map((item) => item.id === person.id ? { ...item, name: event.target.value } : item))}
                    placeholder="방사선사 이름"
                  />
                  <button
                    type="button"
                    className="c-arm-icon-btn"
                    disabled={hasCounts}
                    title={hasCounts ? '기록이 있는 방사선사는 제거할 수 없습니다' : '방사선사 제거'}
                    aria-label={`${person.name || index + 1} 방사선사 제거`}
                    onClick={() => setPeople((prev) => prev.filter((item) => item.id !== person.id))}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="c-arm-add-person"
            disabled={people.length >= 30}
            onClick={() => setPeople((prev) => [...prev, { id: crypto.randomUUID(), name: '', days: {} }])}
          >
            <Plus size={16} /> 방사선사 추가
          </button>
        </section>

        {error && <p role="alert" className="c-arm-error" style={{ marginTop: '14px' }}>{error}</p>}
        <div className="c-arm-dialog-actions">
          <button type="button" onClick={onClose}>취소</button>
          <button type="submit" className="c-arm-primary">적용</button>
        </div>
      </form>
    </dialog>
  );
}

        {error && <p role="alert" className="c-arm-error" style={{ marginTop: '14px' }}>{error}</p>}
        <div className="c-arm-dialog-actions">
          <button type="button" onClick={onClose}>취소</button>
          <button type="submit" className="c-arm-primary">적용</button>
        </div>
      </form>
    </dialog>
  );
}

function CArmMonthEditor({ year, month, records, template, holidays, holidayNames, userId, onSaved, onReload }) {
  const saved = records.find((row) => row.month === month);
  const prior = records.filter((row) => row.month < month).at(-1) || template;
  const draftKey = `abs.c-arm.draft:${supabase.supabaseUrl || 'local'}:${userId}:${year}:${month}`;
  const [initial] = useState(() => {
    const draft = readDraft(draftKey);
    const baseline = saved ? monthDocument(saved) : createCArmMonth(prior);
    if (draft?.document) {
      try {
        validateCArmMonth(draft.document, year, month);
        return { document: draft.document, baseline, revision: draft.revision, restored: true };
      } catch { /* Ignore invalid local draft data. */ }
    }
    return { document: baseline, baseline, revision: saved?.revision ?? null, restored: false };
  });
  const [document, setDocument] = useState(initial.document);
  const [baseline, setBaseline] = useState(initial.baseline);
  const [revision, setRevision] = useState(initial.revision);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const [saving, setSaving] = useState(false);
  const [autosavePaused, setAutosavePaused] = useState(false);
  const documentRef = useRef(initial.document);
  const revisionRef = useRef(initial.revision);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const saveRef = useRef(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(initial.restored ? '임시 입력을 복원했습니다. 자동 저장합니다.' : '');
  const [viewMode, setViewMode] = useState('all');
  const dirty = !same(document, baseline);
  const conflict = revision !== (saved?.revision ?? null);
  const cols = cArmColumns(document);
  const colGroups = cArmColumnGroups(cols);
  const colCount = cols.length;
  const numberOfDays = daysInCArmMonth(year, month);
  const total = cArmMonthTotal(document);
  const annualTotal = records.filter((row) => row.month !== month).reduce((sum, row) => sum + cArmMonthTotal(row), total);

  useEffect(() => {
    if (!dirty && !saving) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saving]);

  const change = (next, remember = true) => {
    if (same(next, document)) return;
    if (remember) {
      undoRef.current = [...undoRef.current.slice(-99), document];
      redoRef.current = [];
    }
    documentRef.current = next;
    setDocument(next);
    setAutosavePaused(false);
    setStatus('자동 저장 대기 중…');
    setError('');
    try { sessionStorage.setItem(draftKey, JSON.stringify({ document: next, revision })); }
    catch { setError('이 브라우저에서 임시 보관할 수 없습니다. 화면을 이동하기 전에 저장해주세요.'); }
  };
  const changeCount = (id, day, kind, input) => {
    if (input !== '' && (!/^\d+$/.test(input) || Number(input) > MAX_C_ARM_COUNT)) return;
    const value = input === '' ? null : Number(input);
    change({ ...document, radiographers: document.radiographers.map((person) => {
      if (person.id !== id) return person;
      const values = { ...person.days[day], [kind]: value };
      return { ...person, days: { ...person.days, [day]: values } };
    }) });
  };
  const undo = () => {
    const previous = undoRef.current.pop();
    if (!previous) return;
    redoRef.current.push(document);
    change(previous, false);
  };
  const redo = () => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(document);
    change(next, false);
  };
  const grid = useCArmGridSelection({
    rowCount: numberOfDays,
    columnCount: document.radiographers.length * colCount,
    disabled: conflict,
    onClear: (bounds) => change(clearCArmSelection(document, bounds, cols)),
    onUndo: undo,
    onRedo: redo,
  });
  const copyCounts = (event, cut = false) => {
    if (!grid.bounds || conflict) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', copyCArmSelection(document, grid.bounds, cols));
    if (cut) change(clearCArmSelection(document, grid.bounds, cols));
    setStatus(cut ? '선택한 셀을 잘라냈습니다. 실행 취소로 되돌릴 수 있습니다.' : '선택한 셀을 복사했습니다.');
  };
  const pasteCounts = (event, personId, day, kind) => {
    event.preventDefault();
    if (conflict) return;
    try {
      const personIndex = document.radiographers.findIndex((person) => person.id === personId);
      const colSubIndex = cols.findIndex((col) => col.id === kind);
      const start = grid.bounds ? { row: grid.bounds.top, col: grid.bounds.left } : {
        row: day,
        col: (personIndex >= 0 ? personIndex : 0) * colCount + (colSubIndex >= 0 ? colSubIndex : 0),
      };
      const targetPersonIndex = Math.min(document.radiographers.length - 1, Math.floor(start.col / colCount));
      const targetColSubIndex = start.col % colCount;
      const targetPerson = document.radiographers[targetPersonIndex];
      const targetKind = cols[targetColSubIndex]?.id || cols[0].id;
      const result = pasteCArmCounts(document, {
        text: event.clipboardData.getData('text/plain'),
        year,
        month,
        personId: targetPerson?.id || personId,
        day: start.row,
        kind: targetKind,
      });
      change(result.document);
      grid.selectRange({ anchor: start, end: { row: start.row + result.rows - 1, col: start.col + result.columns - 1 } });
      setStatus(`${result.rows}행 × ${result.columns}열을 붙여넣었습니다. 자동 저장합니다.`);
    } catch (err) { setError(err.message); }
  };
  const save = async () => {
    if (busyRef.current || conflict || !dirty) return;
    busyRef.current = true;
    setSaving(true);
    setError('');
    let snapshot = documentRef.current;
    let baseRevision = revisionRef.current;
    try {
      // If navigation happens during a request, finish any newer input as well.
      for (;;) {
        const row = await saveCArmMonth(supabase, { year, month, document: snapshot, revision: baseRevision });
        revisionRef.current = row.revision;
        const stored = readDraft(draftKey);
        if (same(stored?.document, snapshot)) sessionStorage.removeItem(draftKey);
        else if (stored && stored.revision === baseRevision) {
          sessionStorage.setItem(draftKey, JSON.stringify({ ...stored, revision: row.revision }));
        }
        onSaved(row);
        if (mountedRef.current) {
          setBaseline(snapshot);
          setRevision(row.revision);
          setAutosavePaused(false);
          setStatus('자동 저장되었습니다.');
        }
        if (mountedRef.current || same(documentRef.current, snapshot)) break;
        snapshot = documentRef.current;
        baseRevision = row.revision;
      }
    } catch (err) {
      if (mountedRef.current) {
        setAutosavePaused(true);
        setError(`자동 저장 실패: ${err.message || '연결을 확인해주세요.'} 입력은 유지됩니다. 다시 저장을 눌러주세요.`);
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };
  saveRef.current = save;
  useEffect(() => {
    if (!dirty || saving || conflict || autosavePaused) return undefined;
    const timer = window.setTimeout(() => { saveRef.current(); }, 700);
    return () => window.clearTimeout(timer);
  }, [document, dirty, saving, conflict, autosavePaused]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // A StrictMode remount is not a navigation away from the editor.
      queueMicrotask(() => { if (!mountedRef.current) saveRef.current?.(); });
    };
  }, []);
  const reload = () => {
    if ((dirty || conflict) && !window.confirm('저장하지 않은 이 달의 입력을 버리고 서버 기록을 다시 불러올까요?')) return;
    sessionStorage.removeItem(draftKey);
    onReload();
  };

  const uniformRate = cols.length > 0 && cols.every((c) => (c.rate ?? document.incentive_rate) === (cols[0]?.rate ?? document.incentive_rate));
  const totalIncentiveAmount = document.radiographers.reduce((sum, person) => sum + cArmIncentive(person, document, cols), 0);

  return (
    <section className="c-arm-stats" aria-label="C-Arm 통계">
      <header className="c-arm-toolbar">
        <div><h1>{year}년 {String(month).padStart(2, '0')}월 장곡 씨암 현황</h1></div>
        <div className="c-arm-actions">
          <div className="c-arm-view-tabs" role="group" aria-label="방사선사 테이블 보기">
            <button
              type="button"
              className={`c-arm-tab-btn ${viewMode === 'all' ? 'is-active' : ''}`}
              aria-pressed={viewMode === 'all'}
              onClick={() => setViewMode('all')}
            >
              전체
            </button>
            <button
              type="button"
              className={`c-arm-tab-btn ${viewMode === 'summary' ? 'is-active' : ''}`}
              aria-pressed={viewMode === 'summary'}
              onClick={() => setViewMode('summary')}
            >
              요약
            </button>
          </div>
          <button type="button" disabled={saving} onClick={() => setSettingsOpen(true)}><Settings2 size={17} /> 방사선사 설정</button>
          <button type="button" disabled={saving} onClick={reload}>다시 불러오기</button>
          <button type="button" className="c-arm-primary" disabled={saving || !dirty || conflict} onClick={save}><Save size={17} /> {saving ? '저장 중…' : autosavePaused ? '다시 저장' : dirty ? '지금 저장' : '저장됨'}</button>
        </div>
      </header>
      {(saving || status || dirty) && (
        <div className="c-arm-status" role="status">
          {saving ? '자동 저장 중…' : status}
          {dirty && (status ? ' · 변경사항은 이 탭에 임시 보관됩니다.' : '변경사항은 이 탭에 임시 보관됩니다.')}
        </div>
      )}
      {conflict && <p role="alert" className="c-arm-error">다른 기기에서 저장한 기록과 입력 중인 내용이 다릅니다. 입력 내용을 확인한 뒤 다시 불러오기를 눌러주세요.</p>}
      {error && <p role="alert" className="c-arm-error">{error}</p>}
      <div className="c-arm-layout">
        <div
          ref={grid.rootRef}
          className="c-arm-records"
          style={{
            '--c-arm-person-count': Math.max(1, document.radiographers.length),
            '--c-arm-col-count': colCount,
          }}
        >
          {document.radiographers.length === 0 && <div className="c-arm-empty"><Settings2 size={28} /><h2>방사선사를 등록해주세요</h2><p>설정에서 이름을 추가하면 날짜별 기록표가 만들어집니다.</p><button type="button" className="c-arm-primary" onClick={() => setSettingsOpen(true)}>방사선사 설정</button></div>}
          {document.radiographers.map((person, index) => {
            const totals = cArmPersonTotals(person, cols);
            const allDays = Array.from({ length: numberOfDays }, (_, i) => i + 1);
            const visibleDays = viewMode === 'summary'
              ? allDays.filter((day) => {
                  const dayData = person.days[day];
                  return cols.some((col) => (Number(dayData?.[col.id]) || 0) > 0);
                })
              : allDays;
            return (
              <table key={person.id} className={`c-arm-table c-arm-person-table c-arm-person-table--${index % 4}`}>
                <colgroup>
                  <col className="c-arm-col-date" />
                  {cols.map((col) => (
                    <col key={col.id} className="c-arm-col-count" />
                  ))}
                </colgroup>
                <caption>{person.name}</caption>
                <thead>
                  <tr className="c-arm-header-categories">
                    <th scope="col" rowSpan={2} className="c-arm-th-date">날짜</th>
                    {colGroups.map((group, gIdx) => (
                      <th
                        key={`grp-${gIdx}-${group.category}`}
                        scope="colgroup"
                        colSpan={group.columns.length}
                        className="c-arm-th-category"
                      >
                        {group.category}
                      </th>
                    ))}
                  </tr>
                  <tr className="c-arm-header-subitems">
                    {cols.map((col) => (
                      <th key={col.id} scope="col" className="c-arm-th-subitem">{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>{visibleDays.length > 0 ? (
                  visibleDays.map((day) => {
                    const weekday = new Date(year, month - 1, day).getDay();
                    const dateKey = `${year}-${month}-${day}`;
                    const isHoliday = holidays.has(dateKey);
                    return (
                      <tr key={day} className={isHoliday || weekday === 0 ? 'c-arm-sunday' : weekday === 6 ? 'c-arm-saturday' : ''}>
                        <th scope="row" title={holidayNames.get(dateKey)}>{month}월 {day}일 <span>({['일', '월', '화', '수', '목', '금', '토'][weekday]})</span></th>
                        {cols.map((col, colSubIdx) => {
                          const gridColIdx = index * colCount + colSubIdx;
                          const editing = grid.isEditing(day, gridColIdx);
                          return (
                            <td key={col.id} {...grid.getCellProps(day, gridColIdx)}>
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                disabled={conflict}
                                className={editing ? 'is-editing' : ''}
                                aria-label={`${person.name} ${month}월 ${day}일 ${col.label}`}
                                value={person.days[day]?.[col.id] ?? ''}
                                onFocus={() => grid.onFocus(day, gridColIdx)}
                                onBlur={() => grid.onBlur(day, gridColIdx)}
                                onDoubleClick={(event) => {
                                  event.stopPropagation();
                                  grid.startEdit(day, gridColIdx);
                                }}
                                onKeyDown={grid.onKeyDown}
                                onCopy={copyCounts}
                                onCut={(event) => copyCounts(event, true)}
                                onPaste={(event) => pasteCounts(event, person.id, day, col.id)}
                                onChange={(event) => changeCount(person.id, day, col.id, event.target.value)}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                ) : (
                  <tr className="c-arm-empty-row"><td colSpan={cols.length + 1}>기록된 건수가 없습니다.</td></tr>
                )}</tbody>
                <tfoot>
                  <tr>
                    <th scope="row">합계</th>
                    {cols.map((col) => (
                      <td key={col.id}>{format(totals[col.id] || 0)}</td>
                    ))}
                  </tr>
                  <tr className="c-arm-grand-total">
                    <th scope="row">전체 합계</th>
                    <td colSpan={cols.length} data-testid={`person-total-${index}`}>{format(totals.total)}</td>
                  </tr>
                </tfoot>
              </table>
            );
          })}
        </div>
        <aside className="c-arm-summary">
          <table className="c-arm-table c-arm-annual"><caption>{year}년 월별 C-Arm 개수</caption>
            <thead><tr><th scope="col">월</th><th scope="col">총 건수</th></tr></thead>
            <tbody>{Array.from({ length: 12 }, (_, i) => i + 1).map((item) => {
              const row = records.find((record) => record.month === item);
              return <tr key={item} className={item === month ? 'c-arm-selected-month' : ''}><th scope="row">{item}월 총 C-Arm{item === month && dirty ? ' *' : ''}</th><td data-testid={`month-total-${item}`}>{format(item === month ? total : cArmMonthTotal(row))}</td></tr>;
            })}</tbody>
            <tfoot><tr><th scope="row">연간 합계</th><td>{format(annualTotal)}</td></tr></tfoot>
          </table>
          <div className="c-arm-incentive-card">
            <div className="c-arm-incentive-header">
              <h2>인센티브</h2>
            </div>
            <table className="c-arm-table c-arm-incentives">
              <colgroup>
                <col className="c-arm-incentive-col-name" />
                <col className="c-arm-incentive-col-count" />
                <col className="c-arm-incentive-col-rate" />
                <col className="c-arm-incentive-col-amount" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">방사선사</th>
                  <th scope="col">건수</th>
                  <th scope="col">건당</th>
                  <th scope="col">인센티브 금액</th>
                </tr>
              </thead>
              <tbody>{document.radiographers.map((person) => {
                const pTotals = cArmPersonTotals(person, cols);
                const pIncentive = cArmIncentive(person, document, cols);
                const rateText = uniformRate
                  ? `${format(cols[0]?.rate ?? document.incentive_rate)}원`
                  : (pTotals.total > 0 ? `${format(Math.round(pIncentive / pTotals.total))}원` : `${format(cols[0]?.rate ?? document.incentive_rate)}원`);
                return (
                  <tr key={person.id}>
                    <th scope="row">{person.name}</th>
                    <td>{format(pTotals.total)}건</td>
                    <td>{rateText}</td>
                    <td>{format(pIncentive)}원</td>
                  </tr>
                );
              })}</tbody>
              <tfoot>
                <tr>
                  <th scope="row">전체 합계</th>
                  <td>{format(total)}건</td>
                  <td>{uniformRate ? `${format(cols[0]?.rate ?? document.incentive_rate)}원` : (total > 0 ? `${format(Math.round(totalIncentiveAmount / total))}원` : '-')}</td>
                  <td data-testid="incentive-total">{format(totalIncentiveAmount)}원</td>
                </tr>
              </tfoot>
            </table>
            <p className="c-arm-help">단가는 해당 월에 적용됩니다. 열별 단가는 설정에서 변경할 수 있습니다.</p>
          </div>
        </aside>
      </div>
      {settingsOpen && <RadiographerSettings document={document} year={year} month={month} onClose={() => setSettingsOpen(false)} onApply={(next) => { change(next); setSettingsOpen(false); }} />}
    </section>
  );
}

export default function CArmStatsPage() {
  const { currentYear: year, currentMonth: month, holidays, holidayNames, loadHolidays } = useSchedule();
  const { user } = useAuth();
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [request, setRequest] = useState(0);
  const [holidayError, setHolidayError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setHolidayError(false);
    // Refresh on entry so edits in Settings are reflected even for the same month.
    loadHolidays(year, month, { force: true }).then((loaded) => {
      if (!cancelled) setHolidayError(loaded === null);
    });
    return () => { cancelled = true; };
  }, [year, month, request, loadHolidays]);
  useEffect(() => {
    let cancelled = false;
    setError('');
    setResult(null);
    Promise.all([loadCArmYear(supabase, year), loadCArmTemplate(supabase, year)]).then(([records, template]) => {
      if (!cancelled) setResult({ year, records, template });
    }).catch((err) => { if (!cancelled) setError(err.message || '연결을 확인해주세요.'); });
    return () => { cancelled = true; };
  }, [year, request]);
  if (error) return <div className="c-arm-stats"><p role="alert" className="c-arm-error">C-Arm 기록을 불러오지 못했습니다. {error}</p><button onClick={() => setRequest((value) => value + 1)}>다시 시도</button></div>;
  if (!result || result.year !== year) return <div className="c-arm-stats" role="status">C-Arm 기록을 불러오는 중…</div>;
  return <>
    {holidayError && <p role="alert" className="c-arm-error">공휴일 설정을 불러오지 못했습니다. 다시 불러오기를 눌러주세요.</p>}
    <CArmMonthEditor holidays={holidays} holidayNames={holidayNames} key={`${year}-${month}-${request}`} year={year} month={month} records={result.records} template={result.template} userId={user.id}
    onReload={() => setRequest((value) => value + 1)} onSaved={(row) => setResult((prev) => prev?.year === row.year ? { ...prev, records: [...prev.records.filter((item) => item.month !== row.month), row].sort((a, b) => a.month - b.month) } : prev)} />
  </>;
}

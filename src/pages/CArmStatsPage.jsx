import { useEffect, useRef, useState } from 'react';
import { Plus, Save, Settings2, Trash2, X } from 'lucide-react';
import { useSchedule } from '../contexts/ScheduleContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabaseClient';
import {
  cArmIncentive, cArmMonthTotal, cArmPersonTotals, createCArmMonth,
  daysInCArmMonth, loadCArmTemplate, loadCArmYear, MAX_C_ARM_COUNT,
  MAX_C_ARM_RATE, saveCArmMonth, validateCArmMonth,
} from '../lib/cArmStats';
import '../styles/c_arm_stats.css';

const format = (value) => value.toLocaleString('ko-KR');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const monthDocument = (row) => ({ incentive_rate: row.incentive_rate, radiographers: row.radiographers });

function readDraft(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; }
}

function RadiographerSettings({ document, year, month, onApply, onClose }) {
  const [people, setPeople] = useState(() => document.radiographers.map((person) => ({ ...person })));
  const [error, setError] = useState('');
  const dialog = useRef(null);
  useEffect(() => {
    const previousFocus = window.document.activeElement;
    const element = dialog.current;
    element.showModal();
    return () => { element.close(); previousFocus?.focus?.(); };
  }, []);
  const apply = (event) => {
    event.preventDefault();
    const updated = { ...document, radiographers: people.map((person) => ({ ...person, name: person.name.trim() })) };
    try { validateCArmMonth(updated, year, month); onApply(updated); } catch (err) { setError(err.message); }
  };
  return (
    <dialog ref={dialog} className="c-arm-settings" onCancel={onClose} aria-labelledby="c-arm-settings-title">
      <form onSubmit={apply}>
        <div className="c-arm-dialog-heading">
          <h2 id="c-arm-settings-title">방사선사 설정</h2>
          <button type="button" onClick={onClose} aria-label="닫기"><X size={19} /></button>
        </div>
        <p>{year}년 {month}월 기록표에 표시할 이름을 입력해주세요.</p>
        <p className="c-arm-help">건수가 있는 방사선사는 제거할 수 없습니다. 새 달은 이전에 저장한 설정을 이어받습니다.</p>
        <div className="c-arm-person-list">
          {people.map((person, index) => {
            const hasCounts = cArmPersonTotals(person).total > 0;
            return (
              <div key={person.id} className="c-arm-person-setting">
                <label htmlFor={`c-arm-name-${person.id}`}>{index + 1}</label>
                <input id={`c-arm-name-${person.id}`} aria-label={`방사선사 ${index + 1} 이름`} value={person.name} maxLength={40}
                  onChange={(event) => setPeople((prev) => prev.map((item) => item.id === person.id ? { ...item, name: event.target.value } : item))}
                  placeholder="방사선사 이름" autoFocus={index === 0} />
                <button type="button" disabled={hasCounts} title={hasCounts ? '기록이 있는 방사선사는 제거할 수 없습니다' : '방사선사 제거'}
                  aria-label={`${person.name || index + 1} 방사선사 제거`} onClick={() => setPeople((prev) => prev.filter((item) => item.id !== person.id))}><Trash2 size={17} /></button>
              </div>
            );
          })}
        </div>
        <button type="button" className="c-arm-add-person" disabled={people.length >= 30}
          onClick={() => setPeople((prev) => [...prev, { id: crypto.randomUUID(), name: '', days: {} }])}><Plus size={16} /> 방사선사 추가</button>
        {error && <p role="alert" className="c-arm-error">{error}</p>}
        <div className="c-arm-dialog-actions">
          <button type="button" onClick={onClose}>취소</button>
          <button type="submit" className="c-arm-primary">적용</button>
        </div>
      </form>
    </dialog>
  );
}

function CArmMonthEditor({ year, month, records, template, userId, onSaved, onReload }) {
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(initial.restored ? '저장 전 입력을 복원했습니다. 확인 후 저장해주세요.' : '');
  const dirty = !same(document, baseline);
  const conflict = revision !== (saved?.revision ?? null);
  const numberOfDays = daysInCArmMonth(year, month);
  const total = cArmMonthTotal(document);
  const annualTotal = records.filter((row) => row.month !== month).reduce((sum, row) => sum + cArmMonthTotal(row), total);

  useEffect(() => {
    if (!dirty && !saving) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saving]);

  const change = (next) => {
    setDocument(next);
    setStatus('저장 전 변경사항이 있습니다.');
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
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const row = await saveCArmMonth(supabase, { year, month, document, revision });
      setBaseline(document);
      setRevision(row.revision);
      // Do not remove newer input if the user navigated while this request was in flight.
      const stored = readDraft(draftKey);
      if (same(stored?.document, document)) sessionStorage.removeItem(draftKey);
      onSaved(row);
      setStatus('저장되었습니다.');
    } catch (err) {
      setError(`저장 실패: ${err.message || '연결을 확인하고 다시 시도해주세요.'}`);
    } finally { setSaving(false); }
  };
  const reload = () => {
    if ((dirty || conflict) && !window.confirm('저장하지 않은 이 달의 입력을 버리고 서버 기록을 다시 불러올까요?')) return;
    sessionStorage.removeItem(draftKey);
    onReload();
  };

  return (
    <section className="c-arm-stats" aria-label="C-Arm 통계">
      <header className="c-arm-toolbar">
        <div><h1>{year}년 {String(month).padStart(2, '0')}월 장곡 씨암 현황</h1><p>{month}월 · 방사선사별 초진·재진 건수를 직접 기록합니다.</p></div>
        <div className="c-arm-actions">
          <button type="button" disabled={saving} onClick={() => setSettingsOpen(true)}><Settings2 size={17} /> 방사선사 설정</button>
          <button type="button" disabled={saving} onClick={reload}>다시 불러오기</button>
          <button type="button" className="c-arm-primary" disabled={saving || !dirty || conflict} onClick={save}><Save size={17} /> {saving ? '저장 중…' : '저장'}</button>
        </div>
      </header>
      <div className="c-arm-status" role="status">{status || '합계는 즉시 계산됩니다. 입력 후 저장해주세요.'}{dirty && ' · 변경사항은 이 탭에 임시 보관됩니다.'}</div>
      {conflict && <p role="alert" className="c-arm-error">다른 기기에서 저장한 기록과 입력 중인 내용이 다릅니다. 입력 내용을 확인한 뒤 다시 불러오기를 눌러주세요.</p>}
      {error && <p role="alert" className="c-arm-error">{error}</p>}
      <div className="c-arm-layout">
        <div className="c-arm-records">
          {document.radiographers.length === 0 && <div className="c-arm-empty"><Settings2 size={28} /><h2>방사선사를 등록해주세요</h2><p>설정에서 이름을 추가하면 날짜별 기록표가 만들어집니다.</p><button type="button" className="c-arm-primary" onClick={() => setSettingsOpen(true)}>방사선사 설정</button></div>}
          {document.radiographers.map((person, index) => {
            const totals = cArmPersonTotals(person);
            return (
              <table key={person.id} className={`c-arm-table c-arm-person-table c-arm-person-table--${index % 4}`}>
                <caption>{person.name}</caption>
                <thead><tr><th scope="col">날짜</th><th scope="col">초진환자</th><th scope="col">재진환자</th></tr></thead>
                <tbody>{Array.from({ length: numberOfDays }, (_, i) => i + 1).map((day) => {
                  const weekday = new Date(year, month - 1, day).getDay();
                  return <tr key={day} className={weekday === 0 ? 'c-arm-sunday' : weekday === 6 ? 'c-arm-saturday' : ''}>
                    <th scope="row">{month}월 {day}일 <span>{['일', '월', '화', '수', '목', '금', '토'][weekday]}</span></th>
                    {['first', 'returning'].map((kind) => <td key={kind}><input type="text" inputMode="numeric" pattern="[0-9]*" disabled={saving || conflict}
                      aria-label={`${person.name} ${month}월 ${day}일 ${kind === 'first' ? '초진' : '재진'}`} value={person.days[day]?.[kind] ?? ''}
                      onChange={(event) => changeCount(person.id, day, kind, event.target.value)} /></td>)}
                  </tr>;
                })}</tbody>
                <tfoot><tr><th scope="row">합계</th><td>{format(totals.first)}</td><td>{format(totals.returning)}</td></tr><tr className="c-arm-grand-total"><th scope="row">전체 합계</th><td colSpan={2} data-testid={`person-total-${index}`}>{format(totals.total)}</td></tr></tfoot>
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
            <h2>인센티브</h2>
            <label className="c-arm-rate">건당 <input aria-label="건당 인센티브" type="text" inputMode="numeric" pattern="[0-9]*" disabled={saving || conflict} value={document.incentive_rate}
              onChange={(event) => { const value = event.target.value; if (value === '' || (/^\d+$/.test(value) && Number(value) <= MAX_C_ARM_RATE)) change({ ...document, incentive_rate: Number(value) }); }} /> 원</label>
            <table className="c-arm-table c-arm-incentives"><thead><tr><th scope="col">방사선사</th><th scope="col">인센티브 금액</th></tr></thead>
              <tbody>{document.radiographers.map((person) => <tr key={person.id}><th scope="row">{person.name}<small>{format(cArmPersonTotals(person).total)}건 × {format(document.incentive_rate)}원</small></th><td>{format(cArmIncentive(person, document.incentive_rate))}원</td></tr>)}</tbody>
              <tfoot><tr><th scope="row">전체 합계</th><td data-testid="incentive-total">{format(total * document.incentive_rate)}원</td></tr></tfoot>
            </table>
            <p className="c-arm-help">단가는 해당 월에 적용됩니다.</p>
          </div>
        </aside>
      </div>
      {settingsOpen && <RadiographerSettings document={document} year={year} month={month} onClose={() => setSettingsOpen(false)} onApply={(next) => { change(next); setSettingsOpen(false); }} />}
    </section>
  );
}

export default function CArmStatsPage() {
  const { currentYear: year, currentMonth: month } = useSchedule();
  const { user } = useAuth();
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [request, setRequest] = useState(0);
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
  return <CArmMonthEditor key={`${year}-${month}-${request}`} year={year} month={month} records={result.records} template={result.template} userId={user.id}
    onReload={() => setRequest((value) => value + 1)} onSaved={(row) => setResult((prev) => prev?.year === row.year ? { ...prev, records: [...prev.records.filter((item) => item.month !== row.month), row].sort((a, b) => a.month - b.month) } : prev)} />;
}

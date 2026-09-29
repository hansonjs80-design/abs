import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { cArmMonthTotal, loadCArmYear } from '../lib/cArmStats';
import { cArmRecentMonthRange, MAX_C_ARM_RECENT_MONTHS, parseCArmRecentMonths, readCArmRecentMonths, saveCArmRecentMonths } from '../lib/cArmRecentStats';

function browserStorage() {
  try { return window.localStorage; } catch { return null; }
}

export default function CArmRecentStats({ year, month, records, currentTotal, dirty }) {
  const [months, setMonths] = useState(() => readCArmRecentMonths(browserStorage()));
  const [input, setInput] = useState(() => String(months));
  const [history, setHistory] = useState(null);
  const [retry, setRetry] = useState(0);
  const range = cArmRecentMonthRange(year, month, months);
  const startYear = range[0].year;
  const historyKey = `${startYear}:${year}:${retry}`;

  useEffect(() => {
    let cancelled = false;
    const years = Array.from({ length: year - startYear }, (_, index) => startYear + index);
    Promise.all(years.map((item) => loadCArmYear(supabase, item))).then((rows) => {
      if (!cancelled) setHistory({ key: historyKey, records: rows.flat() });
    }).catch((error) => {
      if (!cancelled) setHistory({ key: historyKey, error: error.message || '연결을 확인해주세요.' });
    });
    return () => { cancelled = true; };
  }, [startYear, year, historyKey]);

  const needsHistory = startYear < year;
  const ready = !needsHistory || (history?.key === historyKey && !history.error);
  const error = needsHistory && history?.key === historyKey ? history.error : null;
  const allRecords = [...records, ...(ready && needsHistory ? history.records : [])];
  const rows = range.map((item) => ({
    ...item,
    total: item.year === year && item.month === month ? currentTotal
      : cArmMonthTotal(allRecords.find((record) => record.year === item.year && record.month === item.month)),
  }));

  return <table className="c-arm-table c-arm-annual">
    <caption>
      <label className="c-arm-recent-caption">
        최근 <input type="number" min="1" max={MAX_C_ARM_RECENT_MONTHS} step="1"
          aria-label="C-Arm 통계 조회 개월 수" value={input}
          onChange={(event) => {
            const value = event.target.value;
            setInput(value);
            const next = saveCArmRecentMonths(value, browserStorage());
            if (next !== null) setMonths(next);
          }} />개월간 C-Arm 통계
      </label>
      {parseCArmRecentMonths(input) !== months && <small className="c-arm-recent-hint">1~{MAX_C_ARM_RECENT_MONTHS}개월을 입력해주세요. 현재 {months}개월 표시 중입니다.</small>}
    </caption>
    <thead><tr><th scope="col">연월</th><th scope="col">총 건수</th></tr></thead>
    <tbody>
      {!ready ? <tr><td colSpan={2}>
        {error ? <span role="alert">기록을 불러오지 못했습니다. {error} <button type="button" onClick={() => setRetry((value) => value + 1)}>다시 시도</button></span>
          : <span role="status">기록을 불러오는 중…</span>}
      </td></tr> : rows.map((item) => {
        const current = item.year === year && item.month === month;
        return <tr key={`${item.year}-${item.month}`} className={current ? 'c-arm-selected-month' : ''}>
          <th scope="row">{item.year}년 {item.month}월{current && dirty ? ' *' : ''}</th>
          <td data-testid={`month-total-${item.year}-${item.month}`}>{item.total.toLocaleString('ko-KR')}</td>
        </tr>;
      })}
    </tbody>
    <tfoot><tr><th scope="row">최근 {months}개월 합계</th><td>{ready ? rows.reduce((sum, item) => sum + item.total, 0).toLocaleString('ko-KR') : '—'}</td></tr></tfoot>
  </table>;
}

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { cArmMonthTotal, loadCArmYear } from '../lib/cArmStats';
import { getCachedCArmYear, setCachedCArmYear } from '../lib/cArmStatsCache';
import { cArmRecentMonthRange, MAX_C_ARM_RECENT_MONTHS, parseCArmRecentMonths, readCArmRecentMonths, saveCArmRecentMonths } from '../lib/cArmRecentStats';

function browserStorage() {
  try { return window.localStorage; } catch { return null; }
}

function readAllCachedCArmYears(years) {
  if (!Array.isArray(years) || years.length === 0) return [];
  const rows = [];
  for (const item of years) {
    const cached = getCachedCArmYear(item);
    if (!Array.isArray(cached)) return null;
    rows.push(cached);
  }
  return rows.flat();
}

export default function CArmRecentStats({ year, month, records, currentTotal, dirty }) {
  const [months, setMonths] = useState(() => readCArmRecentMonths(browserStorage()));
  const [input, setInput] = useState(() => String(months));
  const [retry, setRetry] = useState(0);
  const range = cArmRecentMonthRange(year, month, months);
  const startYear = Math.min(...range.map((item) => item.year));
  const historyKey = `${startYear}:${year}:${retry}`;
  const [history, setHistory] = useState(() => {
    const initialYears = Array.from({ length: year - startYear }, (_, index) => startYear + index);
    if (initialYears.length === 0) return null;
    const cached = readAllCachedCArmYears(initialYears);
    return cached ? { key: historyKey, records: cached } : null;
  });

  useEffect(() => {
    let cancelled = false;
    const years = Array.from({ length: year - startYear }, (_, index) => startYear + index);
    if (years.length === 0) return undefined;

    if (retry === 0) {
      const cached = readAllCachedCArmYears(years);
      if (cached) {
        setHistory({ key: historyKey, records: cached });
        return undefined;
      }
    }

    Promise.all(years.map(async (item) => {
      if (retry === 0) {
        const cached = getCachedCArmYear(item);
        if (Array.isArray(cached)) return cached;
      }
      const rows = await loadCArmYear(supabase, item);
      setCachedCArmYear(item, rows);
      return rows;
    })).then((rows) => {
      if (!cancelled) setHistory({ key: historyKey, records: rows.flat() });
    }).catch((error) => {
      if (!cancelled) setHistory({ key: historyKey, error: error.message || '연결을 확인해주세요.' });
    });
    return () => { cancelled = true; };
  }, [startYear, year, retry, historyKey]);

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
    <colgroup>
      <col className="c-arm-recent-col-month" />
      <col className="c-arm-recent-col-count" />
    </colgroup>
    <caption>
      <span className="c-arm-recent-caption-print" aria-hidden="true">
        최근 {months}개월간 C-Arm 통계
      </span>
      <label className="c-arm-recent-caption c-arm-recent-caption-screen">
        최근 <input type="number" inputMode="numeric" min="1" max={MAX_C_ARM_RECENT_MONTHS} step="1"
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
    <thead><tr><th scope="col" className="c-arm-recent-th-month">연월</th><th scope="col" className="c-arm-recent-th-count">총 건수</th></tr></thead>
    <tbody>
      {!ready ? <tr><td colSpan={2}>
        {error ? <span role="alert">기록을 불러오지 못했습니다. {error} <button type="button" onClick={() => setRetry((value) => value + 1)}>다시 시도</button></span>
          : <span role="status">기록을 불러오는 중…</span>}
      </td></tr> : rows.map((item) => {
        const current = item.year === year && item.month === month;
        return <tr key={`${item.year}-${item.month}`} className={current ? 'c-arm-selected-month' : ''}>
          <th scope="row" className="c-arm-recent-cell-month">{item.year}년 {item.month}월{current && dirty ? ' *' : ''}</th>
          <td className="c-arm-recent-cell-count" data-testid={`month-total-${item.year}-${item.month}`}>{item.total.toLocaleString('ko-KR')}건</td>
        </tr>;
      })}
    </tbody>
    <tfoot><tr><th scope="row" className="c-arm-recent-foot-month">최근 {months}개월 합계</th><td className="c-arm-recent-foot-count">{ready ? `${rows.reduce((sum, item) => sum + item.total, 0).toLocaleString('ko-KR')}건` : '—'}</td></tr></tfoot>
  </table>;
}

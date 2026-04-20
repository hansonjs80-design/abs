import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

export default function ManualTherapySixMonthStats({
  currentYear,
  currentMonth,
  therapists,
  prescriptionPrices,
  incentivePercentage,
}) {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const safeTherapists = useMemo(
    () => (Array.isArray(therapists) ? therapists.filter((item) => item?.name) : []),
    [therapists]
  );
  const safePriceEntries = useMemo(
    () => (prescriptionPrices && typeof prescriptionPrices === 'object' && !Array.isArray(prescriptionPrices) ? prescriptionPrices : {}),
    [prescriptionPrices]
  );

  useEffect(() => {
    async function fetchSixMonths() {
      setIsLoading(true);
      try {
        const endDate = new Date(currentYear, currentMonth, 1);
        const startDate = new Date(currentYear, currentMonth - 6, 1);

        const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-01`;
        const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-01`;

        const { data, error } = await supabase
          .from('manual_therapy_patient_logs')
          .select('*')
          .gte('date', startStr)
          .lt('date', endStr)
          .order('date', { ascending: true });

        if (error) throw error;
        setLogs(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error(err);
        setLogs([]);
      } finally {
        setIsLoading(false);
      }
    }
    fetchSixMonths();
  }, [currentYear, currentMonth]);

  const monthKeys = useMemo(() => {
    const keys = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(currentYear, currentMonth - 1 - i, 1);
      keys.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: `${d.getMonth() + 1}월`,
      });
    }
    return keys;
  }, [currentYear, currentMonth]);

  const stats = useMemo(() => {
    const price40 = Number(safePriceEntries['40분']) || 0;
    const price60 = Number(safePriceEntries['60분']) || 0;
    const map = {};
    const totals = {};

    monthKeys.forEach((month) => {
      totals[month.key] = { count: 0, newPatient: 0, amount: 0 };
    });

    safeTherapists.forEach((therapist) => {
      map[therapist.name] = { totalCount: 0, totalNew: 0, totalAmount: 0 };
      monthKeys.forEach((month) => {
        map[therapist.name][month.key] = { count: 0, newPatient: 0, amount: 0 };
      });
    });

    logs.forEach((log) => {
      const date = new Date(log.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const therapistName = log.therapist_name;
      const isNew = String(log.patient_name || '').includes('*');
      const count = Number.parseInt(String(log.prescription_count ?? '1'), 10) || 1;
      let amount = 0;
      if (String(log.prescription || '').includes('40')) amount += price40 * count;
      if (String(log.prescription || '').includes('60')) amount += price60 * count;

      if (map[therapistName]?.[monthKey]) {
        map[therapistName][monthKey].count += count;
        if (isNew) map[therapistName][monthKey].newPatient += 1;
        map[therapistName][monthKey].amount += amount;
        map[therapistName].totalCount += count;
        if (isNew) map[therapistName].totalNew += 1;
        map[therapistName].totalAmount += amount;
      }

      if (totals[monthKey]) {
        totals[monthKey].count += count;
        if (isNew) totals[monthKey].newPatient += 1;
        totals[monthKey].amount += amount;
      }
    });

    return { map, totals };
  }, [logs, monthKeys, safeTherapists, safePriceEntries]);

  const safeTherapistNames = useMemo(() => Object.keys(stats.map), [stats.map]);

  return (
    <div className="sw-settlement-card">
      <div className="sw-settlement-header">
        <h2>최근 6개월 도수치료 결산 / 신환 현황</h2>
        <div className="sw-settlement-meta">
          {isLoading ? <span>불러오는 중...</span> : <span>치료사 {safeTherapistNames.length}명</span>}
        </div>
      </div>

      <div className="sw-settlement-table-wrap">
        <table className="sw-summary-table">
          <thead>
            <tr>
              <th rowSpan={2}>치료사</th>
              {monthKeys.map((month) => (
                <th key={month.key} colSpan={2}>{month.label}</th>
              ))}
              <th colSpan={2}>총계 (6개월)</th>
            </tr>
            <tr>
              {monthKeys.map((month) => (
                <React.Fragment key={`${month.key}-sub`}>
                  <th>건수 (신환)</th>
                  <th>인센티브</th>
                </React.Fragment>
              ))}
              <th>건수 (신환)</th>
              <th>인센티브</th>
            </tr>
          </thead>
          <tbody>
            {safeTherapistNames.map((therapistName) => (
              <tr key={therapistName}>
                <th className="month-label">{therapistName}</th>
                {monthKeys.map((month) => {
                  const data = stats.map[therapistName][month.key];
                  const incentive = Math.floor(data.amount * ((Number(incentivePercentage) || 0) / 100));
                  return (
                    <React.Fragment key={`${therapistName}-${month.key}`}>
                      <td>
                        {data.count > 0 ? (
                          <>
                            {data.count}
                            {data.newPatient > 0 && <span style={{ color: 'var(--status-red)', marginLeft: '4px', fontSize: '12px' }}>({data.newPatient})</span>}
                          </>
                        ) : '-'}
                      </td>
                      <td className="amount">{incentive > 0 ? incentive.toLocaleString() : '-'}</td>
                    </React.Fragment>
                  );
                })}
                <td>
                  {stats.map[therapistName].totalCount > 0 ? (
                    <>
                      {stats.map[therapistName].totalCount}
                      {stats.map[therapistName].totalNew > 0 && <span style={{ color: 'var(--status-red)', marginLeft: '4px', fontSize: '12px' }}>({stats.map[therapistName].totalNew})</span>}
                    </>
                  ) : '-'}
                </td>
                <td className="amount">
                  {stats.map[therapistName].totalAmount > 0
                    ? Math.floor(stats.map[therapistName].totalAmount * ((Number(incentivePercentage) || 0) / 100)).toLocaleString()
                    : '-'}
                </td>
              </tr>
            ))}
            <tr>
              <th className="month-label">전체 합계</th>
              {monthKeys.map((month) => {
                const data = stats.totals[month.key];
                const incentive = Math.floor(data.amount * ((Number(incentivePercentage) || 0) / 100));
                return (
                  <React.Fragment key={`total-${month.key}`}>
                    <td>
                      {data.count > 0 ? (
                        <>
                          {data.count}
                          {data.newPatient > 0 && <span style={{ color: 'var(--status-red)', marginLeft: '4px', fontSize: '12px' }}>({data.newPatient})</span>}
                        </>
                      ) : '-'}
                    </td>
                    <td className="amount">{incentive > 0 ? incentive.toLocaleString() : '-'}</td>
                  </React.Fragment>
                );
              })}
              <td>
                {safeTherapistNames.reduce((sum, name) => sum + stats.map[name].totalCount, 0) > 0 ? (
                  <>
                    {safeTherapistNames.reduce((sum, name) => sum + stats.map[name].totalCount, 0)}
                    <span style={{ color: 'var(--status-red)', marginLeft: '4px', fontSize: '12px' }}>
                      ({safeTherapistNames.reduce((sum, name) => sum + stats.map[name].totalNew, 0)})
                    </span>
                  </>
                ) : '-'}
              </td>
              <td className="amount">
                {Math.floor(
                  safeTherapistNames.reduce((sum, name) => sum + stats.map[name].totalAmount, 0) *
                    ((Number(incentivePercentage) || 0) / 100)
                ).toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

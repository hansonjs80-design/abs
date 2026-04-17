import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';

export default function ManualTherapySixMonthStats({ 
  currentYear, currentMonth, 
  therapists,
  prescriptionPrices,
  incentivePercentage
}) {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

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
        setLogs(data || []);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchSixMonths();
  }, [currentYear, currentMonth]);

  const monthKeys = useMemo(() => {
    const keys = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - 1 - i, 1);
      keys.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: `${d.getMonth() + 1}월`
      });
    }
    return keys;
  }, [currentYear, currentMonth]);

  const stats = useMemo(() => {
    const safeTherapists = Array.isArray(therapists) ? therapists.filter(t => t?.name) : [];
    const map = {};
    const totals = {};

    monthKeys.forEach(m => {
      totals[m.key] = { count: 0, newPatient: 0, amount: 0, count40: 0, count60: 0 };
    });

    safeTherapists.forEach(t => {
      map[t.name] = { totalCount: 0, totalNew: 0, totalAmount: 0 };
      monthKeys.forEach(m => {
        map[t.name][m.key] = { count: 0, newPatient: 0, amount: 0, count40: 0, count60: 0 };
      });
    });

    logs.forEach(log => {
      const d = new Date(log.date);
      const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const tName = log.therapist_name;
      
      const is40 = String(log.prescription || '').includes('40');
      const is60 = String(log.prescription || '').includes('60');
      const isNew = log.patient_name?.includes('*');
      
      const p40 = prescriptionPrices?.['40분'] || 0;
      const p60 = prescriptionPrices?.['60분'] || 0;
      let amt = 0;
      if (is40) amt += p40;
      if (is60) amt += p60;

      if (map[tName] && map[tName][mKey]) {
        map[tName][mKey].count += 1;
        if (isNew) map[tName][mKey].newPatient += 1;
        if (is40) map[tName][mKey].count40 += 1;
        if (is60) map[tName][mKey].count60 += 1;
        map[tName][mKey].amount += amt;

        map[tName].totalCount += 1;
        if (isNew) map[tName].totalNew += 1;
        map[tName].totalAmount += amt;
      }

      if (totals[mKey]) {
        totals[mKey].count += 1;
        if (isNew) totals[mKey].newPatient += 1;
        if (is40) totals[mKey].count40 += 1;
        if (is60) totals[mKey].count60 += 1;
        totals[mKey].amount += amt;
      }
    });
    return { map, totals };
  }, [logs, monthKeys, therapists, prescriptionPrices]);

  const { map, totals } = stats;

  return (
    <div className="section-container" style={{ marginTop: '24px' }}>
      <h3 className="section-title">
        최근 6개월 도수치료 결산 / 신환 현황
        {isLoading && <span style={{ fontSize: '14px', color: '#666', marginLeft: '12px' }}>(불러오는 중...)</span>}
      </h3>
      
      <div className="table-responsive">
        <table className="stats-table">
          <thead>
            <tr>
              <th rowSpan={2} style={{ width: '120px' }}>치료사</th>
              {monthKeys.map(m => (
                <th key={m.key} colSpan={2}>{m.label}</th>
              ))}
              <th colSpan={2} style={{ backgroundColor: 'var(--bg-highlight)' }}>총계 (6개월)</th>
            </tr>
            <tr>
              {monthKeys.map(m => (
                <React.Fragment key={m.key + '-sub'}>
                  <th style={{ fontSize: '13px', fontWeight: 'normal' }}>건수 (신환)</th>
                  <th style={{ fontSize: '13px', fontWeight: 'normal' }}>인센티브</th>
                </React.Fragment>
              ))}
              <th style={{ fontSize: '13px', fontWeight: 'normal', backgroundColor: 'var(--bg-highlight)' }}>건수 (신환)</th>
              <th style={{ fontSize: '13px', fontWeight: 'normal', backgroundColor: 'var(--bg-highlight)' }}>인센티브</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(map).map(tName => (
              <tr key={tName}>
                <td style={{ fontWeight: '600' }}>{tName}</td>
                {monthKeys.map(m => {
                  const data = map[tName][m.key];
                  const inc = Math.floor(data.amount * (incentivePercentage / 100));
                  return (
                    <React.Fragment key={m.key}>
                      <td style={{ textAlign: 'center' }}>
                        {data.count > 0 ? (
                          <>
                            {data.count}
                            {data.newPatient > 0 && <span style={{ color: 'var(--status-red)', marginLeft: '4px', fontSize: '12px' }}>({data.newPatient})</span>}
                          </>
                        ) : '-'}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--status-blue)' }}>
                        {inc > 0 ? inc.toLocaleString() : '-'}
                      </td>
                    </React.Fragment>
                  );
                })}
                <td style={{ textAlign: 'center', backgroundColor: 'var(--bg-highlight)', fontWeight: 'bold' }}>
                  {map[tName].totalCount > 0 ? (
                    <>
                      {map[tName].totalCount}
                      {map[tName].totalNew > 0 && <span style={{ color: 'var(--status-red)', marginLeft: '4px', fontSize: '12px' }}>({map[tName].totalNew})</span>}
                    </>
                  ) : '-'}
                </td>
                <td style={{ textAlign: 'right', backgroundColor: 'var(--bg-highlight)', fontWeight: 'bold', color: 'var(--status-blue)' }}>
                  {map[tName].totalAmount > 0 ? Math.floor(map[tName].totalAmount * (incentivePercentage / 100)).toLocaleString() : '-'}
                </td>
              </tr>
            ))}
            <tr style={{ backgroundColor: 'var(--bg-secondary)', fontWeight: 'bold' }}>
              <td>전체 합계</td>
              {monthKeys.map(m => {
                const data = totals[m.key];
                const inc = Math.floor(data.amount * (incentivePercentage / 100));
                return (
                  <React.Fragment key={m.key}>
                    <td style={{ textAlign: 'center' }}>
                      {data.count > 0 ? (
                        <>
                          {data.count}
                          {data.newPatient > 0 && <span style={{ color: 'var(--status-red)', marginLeft: '4px', fontSize: '12px' }}>({data.newPatient})</span>}
                        </>
                      ) : '-'}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--status-blue)' }}>
                      {inc > 0 ? inc.toLocaleString() : '-'}
                    </td>
                  </React.Fragment>
                );
              })}
              <td style={{ textAlign: 'center', backgroundColor: 'var(--bg-highlight)' }}>
                {Object.values(map).reduce((sum, t) => sum + t.totalCount, 0) > 0 ? (
                  <>
                    {Object.values(map).reduce((sum, t) => sum + t.totalCount, 0)}
                    <span style={{ color: 'var(--status-red)', marginLeft: '4px', fontSize: '12px' }}>
                      ({Object.values(map).reduce((sum, t) => sum + t.totalNew, 0)})
                    </span>
                  </>
                ) : '-'}
              </td>
              <td style={{ textAlign: 'right', backgroundColor: 'var(--bg-highlight)', color: 'var(--status-blue)' }}>
                {Math.floor(Object.values(map).reduce((sum, t) => sum + t.totalAmount, 0) * (incentivePercentage / 100)).toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

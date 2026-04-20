import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

function normalizePrescriptionKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export default function ManualTherapySixMonthStats({
  currentYear,
  currentMonth,
  prescriptionPrices,
}) {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const safePriceEntries = useMemo(
    () => (
      prescriptionPrices &&
      typeof prescriptionPrices === 'object' &&
      !Array.isArray(prescriptionPrices)
        ? prescriptionPrices
        : {}
    ),
    [prescriptionPrices]
  );

  useEffect(() => {
    async function fetchSixMonths() {
      setIsLoading(true);
      try {
        const startDate = new Date(currentYear, currentMonth - 6, 1);
        const endDate = new Date(currentYear, currentMonth, 1);
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
      } catch (error) {
        console.error(error);
        setLogs([]);
      } finally {
        setIsLoading(false);
      }
    }

    fetchSixMonths();
  }, [currentMonth, currentYear]);

  const monthKeys = useMemo(() => {
    const keys = [];
    for (let index = 5; index >= 0; index -= 1) {
      const monthDate = new Date(currentYear, currentMonth - 1 - index, 1);
      keys.push({
        key: `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`,
        label: `${monthDate.getMonth() + 1}월`,
      });
    }
    return keys;
  }, [currentMonth, currentYear]);

  const monthlySummaries = useMemo(() => {
    const normalizedPriceMap = Object.fromEntries(
      Object.entries(safePriceEntries).map(([key, amount]) => [
        normalizePrescriptionKey(key),
        Number(amount) || 0,
      ])
    );

    const base = monthKeys.map((month) => ({
      ...month,
      totalCount: 0,
      amount: 0,
      newPatientCount: 0,
    }));
    const summaryMap = Object.fromEntries(base.map((month) => [month.key, month]));

    logs.forEach((log) => {
      const logDate = new Date(log?.date);
      if (Number.isNaN(logDate.getTime())) return;

      const monthKey = `${logDate.getFullYear()}-${String(logDate.getMonth() + 1).padStart(2, '0')}`;
      const target = summaryMap[monthKey];
      if (!target) return;

      const count = Number.parseInt(String(log?.prescription_count ?? '1'), 10) || 1;
      const normalizedPrescription = normalizePrescriptionKey(log?.prescription);
      const unitPrice = normalizedPriceMap[normalizedPrescription] || 0;
      const isNewPatient = String(log?.patient_name || '').includes('*');

      target.totalCount += count;
      target.amount += unitPrice * count;
      if (isNewPatient) target.newPatientCount += 1;
    });

    return base;
  }, [logs, monthKeys, safePriceEntries]);

  return (
    <div className="sw-settlement-card">
      <div className="sw-settlement-header">
        <h2>최근 6개월 도수치료 결산/신환 현황</h2>
        <div className="sw-settlement-meta">
          {isLoading ? <span>불러오는 중...</span> : <span>{monthKeys.length}개월 집계</span>}
        </div>
      </div>

      <div className="sw-settlement-table-wrap">
        <table className="sw-summary-table">
          <thead>
            <tr>
              <th>월</th>
              <th>건수(건)</th>
              <th>결산 금액(원)</th>
              <th>신환(명)</th>
            </tr>
          </thead>
          <tbody>
            {monthlySummaries.map((summary) => (
              <tr key={summary.key}>
                <th className="month-label">{summary.label}</th>
                <td>{summary.totalCount > 0 ? summary.totalCount : '-'}</td>
                <td className="amount">{summary.amount > 0 ? summary.amount.toLocaleString('ko-KR') : '-'}</td>
                <td>{summary.newPatientCount > 0 ? summary.newPatientCount : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

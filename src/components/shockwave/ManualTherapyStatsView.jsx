import React, { useMemo } from 'react';
import { formatMonthDay, formatVisitLabel } from '../../lib/manualTherapyUtils';

export default function ManualTherapyStatsView({
  currentMonth,
  logs = [],
  therapists,
  prescriptions = ['40분', '60분'],
  incentivePercentage = 0,
}) {
  const entries = useMemo(() => {
    return [...(Array.isArray(logs) ? logs : [])]
      .filter(Boolean)
      .map((row) => ({
        ...row,
        dateLabel: formatMonthDay(row?.date),
        visitLabel: formatVisitLabel(row?.visit_count),
      }))
      .sort((a, b) => {
        if (String(a?.date || '') !== String(b?.date || '')) {
          return String(a?.date || '').localeCompare(String(b?.date || ''));
        }
        if (String(a?.therapist_name || '') !== String(b?.therapist_name || '')) {
          return String(a?.therapist_name || '').localeCompare(String(b?.therapist_name || ''), 'ko');
        }
        return String(a?.created_at || '').localeCompare(String(b?.created_at || ''));
      });
  }, [logs]);

  const summaryByTherapist = useMemo(() => {
    return (Array.isArray(therapists) ? therapists : [])
      .filter((therapist) => therapist?.name)
      .map((therapist) => {
        const therapistEntries = entries.filter((entry) => entry.therapist_name === therapist.name);
        const count40 = therapistEntries.filter((entry) => String(entry.prescription || '').includes('40')).length;
        const count60 = therapistEntries.filter((entry) => String(entry.prescription || '').includes('60')).length;

        return {
          therapist,
          count40,
          count60,
          totalCount: therapistEntries.length,
        };
      })
      .filter((item) => item.totalCount > 0);
  }, [entries, therapists]);

  const totalCount = entries.length;
  const duration40Label = useMemo(
    () => prescriptions.find((item) => String(item).includes('40')) || '40분',
    [prescriptions]
  );
  const duration60Label = useMemo(
    () => prescriptions.find((item) => String(item).includes('60')) || '60분',
    [prescriptions]
  );

  return (
    <div className="sw-settlement-stack">
      <div className="sw-settlement-card">
        <div className="sw-settlement-header">
          <h2>{currentMonth}월 도수치료 통계</h2>
          <div className="sw-settlement-meta">
            <span>총 {totalCount}건</span>
            <span>인센티브 {Number(incentivePercentage) || 0}%</span>
          </div>
        </div>

        <div className="sw-settlement-table-wrap">
          <table className="sw-manual-summary-table">
            <thead>
              <tr>
                {summaryByTherapist.map((item) => (
                  <th key={item.therapist.id || item.therapist.name} colSpan={3} className="therapist-col">
                    {item.therapist.name} ( {item.totalCount}건 )
                  </th>
                ))}
              </tr>
              <tr>
                {summaryByTherapist.flatMap((item) => ([
                  <th key={`${item.therapist.id || item.therapist.name}-40`}>{duration40Label}</th>,
                  <th key={`${item.therapist.id || item.therapist.name}-60`}>{duration60Label}</th>,
                  <th key={`${item.therapist.id || item.therapist.name}-total`}>총건수</th>,
                ]))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {summaryByTherapist.flatMap((item) => ([
                  <td key={`${item.therapist.id || item.therapist.name}-40-count`} className="duration-40">{item.count40}</td>,
                  <td key={`${item.therapist.id || item.therapist.name}-60-count`} className="duration-60">{item.count60}</td>,
                  <td key={`${item.therapist.id || item.therapist.name}-total-count`} className="total-count">{item.totalCount}</td>,
                ]))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="sw-settlement-card">
        <div className="sw-settlement-header">
          <h2>{currentMonth}월 도수치료 상세 내역</h2>
        </div>

        <div className="sw-settlement-table-wrap">
          <table className="sw-manual-detail-table">
            <thead>
              <tr>
                <th>날짜</th>
                <th>이름</th>
                <th>번호</th>
                <th>회차</th>
                <th>부위</th>
                <th>담당</th>
                <th>시간</th>
              </tr>
            </thead>
            <tbody>
              {entries.length > 0 ? entries.map((entry) => (
                <tr key={entry.id || `${entry.date}-${entry.patient_name}-${entry.therapist_name}`}>
                  <td>{entry.dateLabel}</td>
                  <td className="patient-name">{entry.patient_name}</td>
                  <td>{entry.chart_number || ''}</td>
                  <td>{entry.visitLabel}</td>
                  <td>{entry.body_part || '-'}</td>
                  <td>{entry.therapist_name || ''}</td>
                  <td className={String(entry.prescription || '').includes('40') ? 'duration-40' : 'duration-60'}>
                    {entry.prescription || ''}
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={7} className="manual-empty">이번 달 도수치료 기록이 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

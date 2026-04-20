import React, { useMemo } from 'react';
import { formatMonthDay, formatVisitLabel } from '../../lib/manualTherapyUtils';

function normalizePrescriptionKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function toCount(value) {
  const parsed = parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCount(value) {
  return `${value}건`;
}

function formatCurrency(value) {
  return `${Number(value || 0).toLocaleString('ko-KR')}원`;
}

export default function ManualTherapyStatsView({
  currentMonth,
  logs = [],
  therapists,
  prescriptions = ['40분', '60분'],
  incentivePercentage = 0,
  prescriptionPrices = {},
}) {
  const safeLogs = useMemo(() => (Array.isArray(logs) ? logs.filter(Boolean) : []), [logs]);
  const safeTherapists = useMemo(() => (Array.isArray(therapists) ? therapists.filter((item) => item?.name) : []), [therapists]);
  const safePrescriptions = useMemo(() => {
    const next = Array.isArray(prescriptions) ? prescriptions.filter(Boolean) : [];
    return next.length > 0 ? next : ['40분', '60분'];
  }, [prescriptions]);
  const safePriceEntries = useMemo(
    () => (prescriptionPrices && typeof prescriptionPrices === 'object' && !Array.isArray(prescriptionPrices) ? prescriptionPrices : {}),
    [prescriptionPrices]
  );

  const entries = useMemo(() => {
    return [...safeLogs]
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
  }, [safeLogs]);

  const normalizedPriceMap = useMemo(() => {
    return Object.fromEntries(
      Object.entries(safePriceEntries).map(([key, amount]) => [
        normalizePrescriptionKey(key),
        Number(amount) || 0,
      ])
    );
  }, [safePriceEntries]);

  const settlement = useMemo(() => {
    const summaryByTherapist = safeTherapists.map((therapist) => {
      const countsByPrescription = Object.fromEntries(
        safePrescriptions.map((prescription) => [prescription, 0])
      );

      const therapistLogs = entries.filter((entry) => entry.therapist_name === therapist.name);
      therapistLogs.forEach((entry) => {
        const matchedPrescription = safePrescriptions.find(
          (prescription) => normalizePrescriptionKey(prescription) === normalizePrescriptionKey(entry?.prescription)
        );
        if (!matchedPrescription) return;
        countsByPrescription[matchedPrescription] += toCount(entry?.prescription_count || 1);
      });

      const totalCount = safePrescriptions.reduce(
        (sum, prescription) => sum + (countsByPrescription[prescription] || 0),
        0
      );
      const amount = safePrescriptions.reduce((sum, prescription) => {
        const unitPrice = normalizedPriceMap[normalizePrescriptionKey(prescription)] || 0;
        return sum + (countsByPrescription[prescription] || 0) * unitPrice;
      }, 0);
      const incentive = Math.round(amount * ((Number(incentivePercentage) || 0) / 100));

      return {
        therapist,
        countsByPrescription,
        totalCount,
        amount,
        incentive,
      };
    });

    const grandPrescriptionCounts = Object.fromEntries(
      safePrescriptions.map((prescription) => [
        prescription,
        summaryByTherapist.reduce(
          (sum, item) => sum + (item.countsByPrescription[prescription] || 0),
          0
        ),
      ])
    );

    const grandTotalCount = summaryByTherapist.reduce((sum, item) => sum + item.totalCount, 0);
    const grandAmount = summaryByTherapist.reduce((sum, item) => sum + item.amount, 0);
    const grandIncentive = summaryByTherapist.reduce((sum, item) => sum + item.incentive, 0);

    return {
      summaryByTherapist,
      grandPrescriptionCounts,
      grandTotalCount,
      grandAmount,
      grandIncentive,
    };
  }, [entries, incentivePercentage, normalizedPriceMap, safePrescriptions, safeTherapists]);

  return (
    <div className="sw-settlement-stack">
      <div className="sw-settlement-card">
        <div className="sw-settlement-header">
          <h2>{currentMonth}월 도수치료 결산</h2>
          <div className="sw-settlement-meta">
            <span>총 {formatCount(settlement.grandTotalCount)}</span>
            <span>매출 {formatCurrency(settlement.grandAmount)}</span>
            <span>인센티브 {Number(incentivePercentage) || 0}%</span>
          </div>
        </div>

        <div className="sw-settlement-table-wrap">
          <table className="sw-settlement-table">
            <thead>
              <tr>
                <th className="label-col" rowSpan={2}>구분</th>
                {settlement.summaryByTherapist.map((item) => (
                  <th key={item.therapist.id || item.therapist.name} colSpan={safePrescriptions.length} className="therapist-col">
                    {item.therapist.name}
                  </th>
                ))}
                <th className="grand-col" rowSpan={2}>총 합계</th>
              </tr>
              <tr>
                {settlement.summaryByTherapist.flatMap((item) =>
                  safePrescriptions.map((prescription) => (
                    <th key={`${item.therapist.id || item.therapist.name}-${prescription}`} className="prescription-col">
                      {prescription}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className="row-label">처방 건수</th>
                {settlement.summaryByTherapist.flatMap((item) =>
                  safePrescriptions.map((prescription) => (
                    <td key={`count-${item.therapist.id || item.therapist.name}-${prescription}`}>
                      {item.countsByPrescription[prescription] || 0}
                    </td>
                  ))
                )}
                <td className="grand-value">{formatCount(settlement.grandTotalCount)}</td>
              </tr>
              <tr>
                <th className="row-label">도수치료 합계(건)</th>
                {settlement.summaryByTherapist.map((item) => (
                  <td key={`total-${item.therapist.id || item.therapist.name}`} colSpan={safePrescriptions.length} className="merged-value">
                    {formatCount(item.totalCount)}
                  </td>
                ))}
                <td className="grand-value">{formatCount(settlement.grandTotalCount)}</td>
              </tr>
              <tr>
                <th className="row-label">결산 금액(원)</th>
                {settlement.summaryByTherapist.map((item) => (
                  <td key={`amount-${item.therapist.id || item.therapist.name}`} colSpan={safePrescriptions.length} className="merged-value amount">
                    {formatCurrency(item.amount)}
                  </td>
                ))}
                <td className="grand-value amount">{formatCurrency(settlement.grandAmount)}</td>
              </tr>
              <tr>
                <th className="row-label">인센티브 ({Number(incentivePercentage) || 0}%)</th>
                {settlement.summaryByTherapist.map((item) => (
                  <td key={`incentive-${item.therapist.id || item.therapist.name}`} colSpan={safePrescriptions.length} className="merged-value incentive">
                    {formatCurrency(item.incentive)}
                  </td>
                ))}
                <td className="grand-value incentive">{formatCurrency(settlement.grandIncentive)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="sw-settlement-card">
        <div className="sw-settlement-header">
          <h2>{currentMonth}월 도수치료 상세 내역</h2>
          <div className="sw-settlement-meta">
            <span>기록 {entries.length}건</span>
          </div>
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

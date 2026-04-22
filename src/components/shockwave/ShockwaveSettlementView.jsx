import React, { useMemo } from 'react';
import { buildDisplayTherapists } from '../../lib/therapistDisplayUtils';

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

export default function ShockwaveSettlementView({
  logs,
  therapists,
  currentMonth,
  prescriptions,
  prescriptionPrices,
  incentivePercentage,
  recentMonthlySummaries = [],
  monthlyTherapists,
}) {
  const safeLogs = useMemo(() => (Array.isArray(logs) ? logs.filter(Boolean) : []), [logs]);
  const safeTherapists = useMemo(() => (Array.isArray(therapists) ? therapists.filter(Boolean) : []), [therapists]);
  const displayTherapists = useMemo(
    () => buildDisplayTherapists(safeTherapists, monthlyTherapists),
    [safeTherapists, monthlyTherapists]
  );
  const safePrescriptions = useMemo(() => (Array.isArray(prescriptions) ? prescriptions.filter(Boolean) : []), [prescriptions]);
  const safeRecentMonthlySummaries = useMemo(
    () => (Array.isArray(recentMonthlySummaries) ? recentMonthlySummaries.filter(Boolean) : []),
    [recentMonthlySummaries]
  );

  const normalizedPriceMap = useMemo(() => {
    const entries = Object.entries(prescriptionPrices || {}).map(([key, amount]) => [
      normalizePrescriptionKey(key),
      Number(amount) || 0,
    ]);
    return Object.fromEntries(entries);
  }, [prescriptionPrices]);

  const settlement = useMemo(() => {
    const summaryByTherapist = displayTherapists.map((therapist) => {
      const countsByPrescription = Object.fromEntries(
        safePrescriptions.map((prescription) => [prescription, 0])
      );

      const therapistLogs = safeLogs.filter((log) => log?.therapist_name === therapist.name);

      therapistLogs.forEach((log) => {
        const normalizedLogPrescription = normalizePrescriptionKey(log?.prescription);
        const matchedPrescription = safePrescriptions.find(
          (prescription) => normalizePrescriptionKey(prescription) === normalizedLogPrescription
        );
        if (!matchedPrescription) return;
        countsByPrescription[matchedPrescription] += toCount(log?.prescription_count || 1);
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
        therapist: { ...therapist, id: therapist.key || therapist.id || therapist.name, name: therapist.displayName || therapist.name },
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
  }, [safeLogs, displayTherapists, safePrescriptions, normalizedPriceMap, incentivePercentage]);

  if (!displayTherapists.length) {
    return (
      <div className="sw-stats-empty">
        활성화된 치료사가 없어 결산표를 계산할 수 없습니다.
        <div className="empty-subtext">설정 탭에서 치료사와 결산 기준을 먼저 저장해 주세요.</div>
      </div>
    );
  }

  return (
    <div className="sw-settlement-stack">
      <div className="sw-settlement-card">
        <div className="sw-settlement-header">
          <h2>{currentMonth}월 충격파 결산</h2>
          <div className="sw-settlement-meta">
            <span>인센티브 {Number(incentivePercentage) || 0}%</span>
          </div>
        </div>

        <div className="sw-settlement-table-wrap sw-compact-table-wrap">
          <table className="sw-settlement-table sw-compact-settlement-table">
            <thead>
              <tr>
                <th className="label-col" rowSpan={2}>구분</th>
                {settlement.summaryByTherapist.map((item, therapistIndex) => (
                  <th key={item.therapist.id || item.therapist.name} colSpan={safePrescriptions.length} className={`therapist-col therapist-tone-${therapistIndex % 5}`}>
                    {item.therapist.name}
                  </th>
                ))}
                <th className="grand-col" rowSpan={2}>총 합계</th>
              </tr>
              <tr>
                {settlement.summaryByTherapist.flatMap((item, therapistIndex) =>
                  safePrescriptions.map((prescription) => (
                    <th key={`${item.therapist.id || item.therapist.name}-${prescription}`} className={`prescription-col therapist-tone-${therapistIndex % 5}-sub`}>
                      {prescription}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className="row-label">처방 건수</th>
                {settlement.summaryByTherapist.flatMap((item, therapistIndex) =>
                  safePrescriptions.map((prescription) => (
                    <td key={`count-${item.therapist.id || item.therapist.name}-${prescription}`} className={`therapist-tone-${therapistIndex % 5}-cell`}>
                      {settlement.grandPrescriptionCounts[prescription] >= 0
                        ? item.countsByPrescription[prescription] || 0
                        : 0}
                    </td>
                  ))
                )}
                <td className="grand-value">{formatCount(settlement.grandTotalCount)}</td>
              </tr>
              <tr>
                <th className="row-label">충격파 합계(건)</th>
                {settlement.summaryByTherapist.map((item, therapistIndex) => (
                  <td key={`total-count-${item.therapist.id || item.therapist.name}`} colSpan={safePrescriptions.length} className={`merged-value therapist-tone-${therapistIndex % 5}-cell`}>
                    {formatCount(item.totalCount)}
                  </td>
                ))}
                <td className="grand-value">{formatCount(settlement.grandTotalCount)}</td>
              </tr>
              <tr>
                <th className="row-label">결산 금액(원)</th>
                {settlement.summaryByTherapist.map((item, therapistIndex) => (
                  <td key={`amount-${item.therapist.id || item.therapist.name}`} colSpan={safePrescriptions.length} className={`merged-value amount therapist-tone-${therapistIndex % 5}-cell`}>
                    {formatCurrency(item.amount)}
                  </td>
                ))}
                <td className="grand-value amount">{formatCurrency(settlement.grandAmount)}</td>
              </tr>
              <tr>
                <th className="row-label">인센티브 ({Number(incentivePercentage) || 0}%)</th>
                {settlement.summaryByTherapist.map((item, therapistIndex) => (
                  <td key={`incentive-${item.therapist.id || item.therapist.name}`} colSpan={safePrescriptions.length} className={`merged-value incentive therapist-tone-${therapistIndex % 5}-cell`}>
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
          <h2>최근 6개월 충격파 결산/신환 현황</h2>
        </div>

        <div className="sw-settlement-table-wrap sw-compact-table-wrap">
          <table className="sw-summary-table sw-compact-summary-table">
            <thead>
              <tr>
                <th>월</th>
                <th>건수(건)</th>
                <th>결산 금액(원)</th>
                <th>신환(명)</th>
              </tr>
            </thead>
            <tbody>
              {safeRecentMonthlySummaries.map((item) => (
                <tr key={item.monthKey}>
                  <th className="month-label">{item.label}</th>
                  <td>{formatCount(item.totalCount)}</td>
                  <td className="amount">{formatCurrency(item.amount)}</td>
                  <td className="new-patient">{item.newPatientCount}명</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

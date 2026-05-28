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

export default function ManualTherapyStatsView({
  currentMonth,
  logs = [],
  therapists,
  prescriptions = ['40분', '60분'],
  incentivePercentage = 0,
  prescriptionPrices = {},
  monthlyTherapists,
  selectedTherapistNames,
}) {
  const safeLogs = useMemo(() => (Array.isArray(logs) ? logs.filter(Boolean) : []), [logs]);
  const safeTherapists = useMemo(() => (Array.isArray(therapists) ? therapists.filter((item) => item?.name) : []), [therapists]);
  const allDisplayTherapists = useMemo(
    () => buildDisplayTherapists(safeTherapists, monthlyTherapists),
    [safeTherapists, monthlyTherapists]
  );
  const displayTherapists = useMemo(() => {
    if (!selectedTherapistNames || selectedTherapistNames.length === 0) return allDisplayTherapists;
    const nameSet = new Set(selectedTherapistNames);
    return allDisplayTherapists.filter((t) => nameSet.has(t.name));
  }, [allDisplayTherapists, selectedTherapistNames]);
  const safePrescriptions = useMemo(() => {
    const next = Array.isArray(prescriptions) ? prescriptions.filter(Boolean) : [];
    return next.length > 0 ? next : ['40분', '60분'];
  }, [prescriptions]);
  const safePriceEntries = useMemo(
    () => (prescriptionPrices && typeof prescriptionPrices === 'object' && !Array.isArray(prescriptionPrices) ? prescriptionPrices : {}),
    [prescriptionPrices]
  );

  const normalizedPriceMap = useMemo(() => {
    return Object.fromEntries(
      Object.entries(safePriceEntries).map(([key, amount]) => [
        normalizePrescriptionKey(key),
        Number(amount) || 0,
      ])
    );
  }, [safePriceEntries]);

  const settlement = useMemo(() => {
    const summaryByTherapist = displayTherapists.map((therapist) => {
      const countsByPrescription = Object.fromEntries(
        safePrescriptions.map((prescription) => [prescription, 0])
      );

      const therapistLogs = safeLogs.filter((entry) => entry.therapist_name === therapist.name);
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
      const amountsByPrescription = Object.fromEntries(
        safePrescriptions.map((prescription) => {
          const unitPrice = normalizedPriceMap[normalizePrescriptionKey(prescription)] || 0;
          return [prescription, (countsByPrescription[prescription] || 0) * unitPrice];
        })
      );
      const amount = safePrescriptions.reduce((sum, prescription) => sum + amountsByPrescription[prescription], 0);
      const incentivesByPrescription = Object.fromEntries(
        safePrescriptions.map((prescription) => [
          prescription,
          Math.round((amountsByPrescription[prescription] || 0) * ((Number(incentivePercentage) || 0) / 100))
        ])
      );
      const incentive = Math.round(amount * ((Number(incentivePercentage) || 0) / 100));

      return {
        therapist: { ...therapist, id: therapist.key || therapist.id || therapist.name, name: therapist.displayName || therapist.name },
        countsByPrescription,
        amountsByPrescription,
        incentivesByPrescription,
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

    const grandPrescriptionAmounts = Object.fromEntries(
      safePrescriptions.map((prescription) => [
        prescription,
        summaryByTherapist.reduce(
          (sum, item) => sum + (item.amountsByPrescription[prescription] || 0),
          0
        ),
      ])
    );

    const grandPrescriptionIncentives = Object.fromEntries(
      safePrescriptions.map((prescription) => [
        prescription,
        summaryByTherapist.reduce(
          (sum, item) => sum + (item.incentivesByPrescription[prescription] || 0),
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
      grandPrescriptionAmounts,
      grandPrescriptionIncentives,
      grandTotalCount,
      grandAmount,
      grandIncentive,
    };
  }, [incentivePercentage, normalizedPriceMap, safeLogs, safePrescriptions, displayTherapists]);

  const showGrandTotal = settlement.summaryByTherapist.length > 1;

  return (
    <div className="sw-settlement-stack sw-manual-settlement-stack">
      <div className="sw-settlement-card">
        <div className="sw-settlement-header">
          <h2>{currentMonth}월 도수치료 결산</h2>
          <div className="sw-settlement-meta">
            <span>총 {formatCount(settlement.grandTotalCount)}</span>
            <span>매출 {formatCurrency(settlement.grandAmount)}</span>
            <span>인센티브 {Number(incentivePercentage) || 0}%</span>
          </div>
        </div>

        <div className="sw-settlement-table-wrap sw-manual-settlement-table-wrap">
          <table className="sw-settlement-table sw-manual-compact-settlement-table" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th className="label-col" rowSpan={2}>구분</th>
                {settlement.summaryByTherapist.map((item, therapistIndex) => (
                  <th key={item.therapist.id || item.therapist.name} colSpan={safePrescriptions.length} className={`therapist-col therapist-group-end therapist-tone-${therapistIndex % 5}`}>
                    {item.therapist.name}
                  </th>
                ))}
                {showGrandTotal && <th className="grand-col" colSpan={safePrescriptions.length}>총 합계</th>}
              </tr>
              <tr>
                {settlement.summaryByTherapist.flatMap((item, therapistIndex) =>
                  safePrescriptions.map((prescription, prescriptionIndex) => (
                    <th key={`${item.therapist.id || item.therapist.name}-${prescription}`} className={`prescription-col therapist-tone-${therapistIndex % 5}-sub${prescriptionIndex === safePrescriptions.length - 1 ? ' therapist-group-end' : ''}`} style={{ width: '130px' }}>
                      {prescription}
                    </th>
                  ))
                )}
                {showGrandTotal && safePrescriptions.map((prescription, prescriptionIndex) => (
                  <th key={`grand-head-${prescription}`} className={`grand-col prescription-col${prescriptionIndex === safePrescriptions.length - 1 ? ' therapist-group-end' : ''}`} style={{ width: '130px' }}>
                    {prescription}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className="row-label">처방 건수</th>
                {settlement.summaryByTherapist.flatMap((item, therapistIndex) =>
                  safePrescriptions.map((prescription, prescriptionIndex) => (
                    <td key={`count-${item.therapist.id || item.therapist.name}-${prescription}`} className={`therapist-tone-${therapistIndex % 5}-cell${prescriptionIndex === safePrescriptions.length - 1 ? ' therapist-group-end' : ''}`}>
                      {formatCount(item.countsByPrescription[prescription] || 0)}
                    </td>
                  ))
                )}
                {showGrandTotal && safePrescriptions.map((prescription, prescriptionIndex) => (
                  <td key={`grand-count-${prescription}`} className={`grand-value${prescriptionIndex === safePrescriptions.length - 1 ? ' therapist-group-end' : ''}`}>
                    {formatCount(settlement.grandPrescriptionCounts[prescription] || 0)}
                  </td>
                ))}
              </tr>
              <tr>
                <th className="row-label">총 처방 건수</th>
                {settlement.summaryByTherapist.map((item, therapistIndex) => (
                  <td key={`total-count-${item.therapist.id || item.therapist.name}`} colSpan={safePrescriptions.length} className={`merged-value therapist-group-end therapist-tone-${therapistIndex % 5}-cell`}>
                    {formatCount(item.totalCount)}
                  </td>
                ))}
                {showGrandTotal && <td className="grand-value" colSpan={safePrescriptions.length}>{formatCount(settlement.grandTotalCount)}</td>}
              </tr>
              <tr>
                <th className="row-label">처방별 금액(원)</th>
                {settlement.summaryByTherapist.flatMap((item, therapistIndex) =>
                  safePrescriptions.map((prescription, prescriptionIndex) => (
                    <td key={`amount-by-presc-${item.therapist.id || item.therapist.name}-${prescription}`} className={`amount therapist-tone-${therapistIndex % 5}-cell${prescriptionIndex === safePrescriptions.length - 1 ? ' therapist-group-end' : ''}`}>
                      {formatCurrency(item.amountsByPrescription[prescription])}
                    </td>
                  ))
                )}
                {showGrandTotal && safePrescriptions.map((prescription, prescriptionIndex) => (
                  <td key={`grand-amount-presc-${prescription}`} className={`grand-value amount${prescriptionIndex === safePrescriptions.length - 1 ? ' therapist-group-end' : ''}`}>
                    {formatCurrency(settlement.grandPrescriptionAmounts[prescription] || 0)}
                  </td>
                ))}
              </tr>
              <tr className="settlement-amount-row">
                <th className="row-label">결산 금액(원)</th>
                {settlement.summaryByTherapist.map((item, therapistIndex) => (
                  <td key={`amount-${item.therapist.id || item.therapist.name}`} colSpan={safePrescriptions.length} className={`merged-value amount therapist-group-end therapist-tone-${therapistIndex % 5}-cell`}>
                    {formatCurrency(item.amount)}
                  </td>
                ))}
                {showGrandTotal && <td className="grand-value amount" colSpan={safePrescriptions.length}>{formatCurrency(settlement.grandAmount)}</td>}
              </tr>
              <tr className="prescription-incentive-row">
                <th className="row-label">처방별 인센티브(원)</th>
                {settlement.summaryByTherapist.flatMap((item, therapistIndex) =>
                  safePrescriptions.map((prescription, prescriptionIndex) => (
                    <td key={`incentive-by-presc-${item.therapist.id || item.therapist.name}-${prescription}`} className={`incentive therapist-tone-${therapistIndex % 5}-cell${prescriptionIndex === safePrescriptions.length - 1 ? ' therapist-group-end' : ''}`}>
                      {formatCurrency(item.incentivesByPrescription[prescription])}
                    </td>
                  ))
                )}
                {showGrandTotal && safePrescriptions.map((prescription, prescriptionIndex) => (
                  <td key={`grand-incentive-presc-${prescription}`} className={`grand-value incentive${prescriptionIndex === safePrescriptions.length - 1 ? ' therapist-group-end' : ''}`}>
                    {formatCurrency(settlement.grandPrescriptionIncentives[prescription] || 0)}
                  </td>
                ))}
              </tr>
              <tr className="settlement-incentive-row">
                <th className="row-label">총 인센티브 ({Number(incentivePercentage) || 0}%)</th>
                {settlement.summaryByTherapist.map((item, therapistIndex) => (
                  <td key={`incentive-${item.therapist.id || item.therapist.name}`} colSpan={safePrescriptions.length} className={`merged-value incentive therapist-group-end therapist-tone-${therapistIndex % 5}-cell`}>
                    {formatCurrency(item.incentive)}
                  </td>
                ))}
                {showGrandTotal && <td className="grand-value incentive" colSpan={safePrescriptions.length}>{formatCurrency(settlement.grandIncentive)}</td>}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

import React, { useMemo, useState } from 'react';
import { buildDisplayTherapists } from '../../lib/therapistDisplayUtils';
import {
  buildCryoAdjustedPrescriptionPrices,
  buildManualTherapySettlementSummary,
} from '../../lib/shockwaveStatsCountUtils';

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
  cryoPrescriptions = [],
  cryoPrices = {},
  monthlyTherapists,
  selectedTherapistNames,
}) {
  const [isCryoAdjusted, setIsCryoAdjusted] = useState(false);
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
    if (Array.isArray(prescriptions)) return prescriptions.filter(Boolean);
    return ['40분', '60분'];
  }, [prescriptions]);
  const effectivePrescriptionPrices = useMemo(() => (
    isCryoAdjusted
      ? buildCryoAdjustedPrescriptionPrices({
        prescriptionPrices,
        cryoPrescriptions,
        cryoPrices,
      })
      : prescriptionPrices
  ), [cryoPrescriptions, cryoPrices, isCryoAdjusted, prescriptionPrices]);
  const settlement = useMemo(() => buildManualTherapySettlementSummary({
    rows: safeLogs,
    prescriptions: safePrescriptions,
    therapists: displayTherapists,
    prescriptionPrices: effectivePrescriptionPrices,
    incentivePercentage,
  }), [displayTherapists, effectivePrescriptionPrices, incentivePercentage, safeLogs, safePrescriptions]);

  const showGrandTotal = settlement.summaryByTherapist.length > 1;
  const showPrescriptionBreakdown = safePrescriptions.length > 1;
  const valueColumnCount = Math.max(
    1,
    safePrescriptions.length * (settlement.summaryByTherapist.length + (showGrandTotal ? 1 : 0))
  );
  const isNarrowSettlement = valueColumnCount <= 3;
  const densityClass = isNarrowSettlement
    ? ' sw-manual-compact-settlement-table--narrow'
    : (valueColumnCount > 9
      ? ' sw-manual-compact-settlement-table--dense'
      : (valueColumnCount > 6 ? ' sw-manual-compact-settlement-table--compact' : ''));

  return (
    <div className={`sw-settlement-stack sw-manual-settlement-stack${isNarrowSettlement ? ' sw-manual-settlement-stack--narrow' : ''}`}>
      <div className="sw-settlement-card sw-manual-settlement-main-card">
        <div className="sw-settlement-header">
          <div className="sw-manual-settlement-heading">
            <h2>{currentMonth}월 {isCryoAdjusted ? '도수치료 크라이오 반영 결산' : '도수치료 결산'}</h2>
            <button
              type="button"
              className={`sw-manual-cryo-mode-button${isCryoAdjusted ? ' active' : ''}`}
              aria-pressed={isCryoAdjusted}
              onClick={() => setIsCryoAdjusted((current) => !current)}
            >
              크라이오 반영 통계
            </button>
          </div>
          <div className="sw-settlement-meta">
            <span className="sw-settlement-meta-total">총 {formatCount(settlement.grandTotalCount)}</span>
            <span className="sw-settlement-meta-sales">매출 {formatCurrency(settlement.grandAmount)}</span>
            <span className="sw-settlement-meta-incentive">인센티브 {Number(incentivePercentage) || 0}%</span>
          </div>
        </div>

        <div className="sw-settlement-table-wrap sw-manual-settlement-table-wrap">
          <table className={`sw-settlement-table sw-manual-compact-settlement-table${densityClass}`}>
            <colgroup>
              <col className="sw-manual-settlement-label-column" />
              {Array.from({ length: valueColumnCount }, (_, columnIndex) => (
                <col key={`manual-value-column-${columnIndex}`} className="sw-manual-settlement-value-column" />
              ))}
            </colgroup>
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
                    <th key={`${item.therapist.id || item.therapist.name}-${prescription}`} className={`prescription-col therapist-tone-${therapistIndex % 5}-sub${prescriptionIndex === safePrescriptions.length - 1 ? ' therapist-group-end' : ''}`}>
                      {prescription}
                    </th>
                  ))
                )}
                {showGrandTotal && safePrescriptions.map((prescription, prescriptionIndex) => (
                  <th key={`grand-head-${prescription}`} className={`grand-col prescription-col${prescriptionIndex === safePrescriptions.length - 1 ? ' therapist-group-end' : ''}`}>
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
              {showPrescriptionBreakdown && (
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
              )}
              <tr className="settlement-amount-row">
                <th className="row-label">결산 금액(원)</th>
                {settlement.summaryByTherapist.map((item, therapistIndex) => (
                  <td key={`amount-${item.therapist.id || item.therapist.name}`} colSpan={safePrescriptions.length} className={`merged-value amount therapist-group-end therapist-tone-${therapistIndex % 5}-cell`}>
                    {formatCurrency(item.amount)}
                  </td>
                ))}
                {showGrandTotal && <td className="grand-value amount" colSpan={safePrescriptions.length}>{formatCurrency(settlement.grandAmount)}</td>}
              </tr>
              {showPrescriptionBreakdown && (
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
              )}
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

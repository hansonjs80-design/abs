import React, { useMemo } from 'react';
import { buildShinjangSpraySettlementSummary } from '../../lib/shinjangSprayStatsUtils';

function formatCount(value) {
  return `${Number(value || 0).toLocaleString('ko-KR')}건`;
}

function formatCurrency(value) {
  return `${Number(value || 0).toLocaleString('ko-KR')}원`;
}

function formatPercentage(value) {
  const numeric = Number(value) || 0;
  return `${numeric.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%`;
}

function formatTreatmentTypes(types) {
  const labels = (Array.isArray(types) ? types : []).map((type) => (
    type === 'manual_therapy' ? '도수' : '충격파'
  ));
  return [...new Set(labels)].join(' · ') || '—';
}

export default function ShinjangSprayStatsView({
  currentYear,
  currentMonth,
  rows = [],
  therapists = [],
  prescriptions = [],
  prescriptionPrices = {},
  incentivePercentages = {},
}) {
  const summary = useMemo(() => buildShinjangSpraySettlementSummary({
    rows,
    therapists,
    prescriptions,
    prescriptionPrices,
    incentivePercentages,
  }), [incentivePercentages, prescriptionPrices, prescriptions, rows, therapists]);
  const therapistGroups = useMemo(() => {
    const groups = new Map();
    summary.detailRows.forEach((detail) => {
      const key = detail.therapist.id || detail.therapist.name;
      const current = groups.get(key) || {
        therapist: detail.therapist,
        rows: [],
        totalCount: 0,
        amount: 0,
        incentive: 0,
      };
      current.rows.push(detail);
      current.totalCount += detail.count;
      current.amount += detail.amount;
      current.incentive += detail.incentive;
      groups.set(key, current);
    });
    return [...groups.values()];
  }, [summary.detailRows]);

  return (
    <div className="sw-settlement-stack shinjang-spray-settlement-stack">
      <section className="sw-settlement-card shinjang-spray-settlement-card">
        <div className="sw-settlement-header shinjang-spray-settlement-header">
          <div>
            <h2>{currentYear}년 {String(currentMonth).padStart(2, '0')}월 신장분사 통계</h2>
            <p className="shinjang-spray-description">
              충격파·도수 처방 중 이름에 <strong>(신장분사)</strong>가 포함된 기록을 합산합니다.
            </p>
          </div>
          <div className="sw-settlement-meta">
            <span className="sw-settlement-meta-total">총 {formatCount(summary.grandTotalCount)}</span>
            <span className="sw-settlement-meta-sales">결산 {formatCurrency(summary.grandAmount)}</span>
            <span className="sw-settlement-meta-incentive">인센티브 {formatCurrency(summary.grandIncentive)}</span>
          </div>
        </div>

        {summary.detailRows.length === 0 ? (
          <div className="sw-stats-empty shinjang-spray-empty">
            <span>이번 달 신장분사 처방 기록이 없습니다.</span>
            <span className="empty-subtext">처방 이름에 (신장분사)를 포함하면 이 탭에 자동으로 집계됩니다.</span>
          </div>
        ) : (
          <div className="sw-settlement-table-wrap shinjang-spray-table-wrap">
            <table className="shinjang-spray-table">
              <thead>
                <tr>
                  <th>치료사</th>
                  <th>처방</th>
                  <th>원본 통계</th>
                  <th>건수</th>
                  <th>처방 단가</th>
                  <th>결산 금액</th>
                  <th>인센티브율</th>
                  <th>인센티브</th>
                </tr>
              </thead>
              <tbody>
                {therapistGroups.flatMap((group, groupIndex) => [
                  ...group.rows.map((detail, rowIndex) => (
                    <tr key={`${group.therapist.id}-${detail.prescription}`} className={`therapist-tone-${groupIndex % 5}-cell`}>
                      {rowIndex === 0 && (
                        <th className="shinjang-spray-therapist-cell" rowSpan={group.rows.length + 1}>
                          {group.therapist.displayName || group.therapist.name}
                        </th>
                      )}
                      <th className="shinjang-spray-prescription-cell">{detail.prescription}</th>
                      <td><span className="shinjang-spray-source-badge">{formatTreatmentTypes(detail.treatmentTypes)}</span></td>
                      <td>{formatCount(detail.count)}</td>
                      <td>{detail.hasMixedUnitPrices ? '혼합 단가' : formatCurrency(detail.unitPrice)}</td>
                      <td className="amount">{formatCurrency(detail.amount)}</td>
                      <td>{formatPercentage(detail.incentivePercentage)}</td>
                      <td className="incentive">{formatCurrency(detail.incentive)}</td>
                    </tr>
                  )),
                  <tr key={`${group.therapist.id}-subtotal`} className="shinjang-spray-subtotal-row">
                    <th colSpan={2}>치료사 소계</th>
                    <td>{formatCount(group.totalCount)}</td>
                    <td>—</td>
                    <td className="amount">{formatCurrency(group.amount)}</td>
                    <td>—</td>
                    <td className="incentive">{formatCurrency(group.incentive)}</td>
                  </tr>,
                ])}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={3}>전체 합계</th>
                  <td>{formatCount(summary.grandTotalCount)}</td>
                  <td>—</td>
                  <td>{formatCurrency(summary.grandAmount)}</td>
                  <td>처방별 적용</td>
                  <td>{formatCurrency(summary.grandIncentive)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

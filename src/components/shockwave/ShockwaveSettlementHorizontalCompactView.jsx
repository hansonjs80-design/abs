import React from 'react';

function normalizePrescriptionKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function formatCount(value) {
  return `${Number(value || 0).toLocaleString('ko-KR')}건`;
}

function formatOptionalCount(value) {
  const count = Number(value || 0);
  return count > 0 ? `${count.toLocaleString('ko-KR')}건` : '-';
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return amount > 0 ? `${amount.toLocaleString('ko-KR')}원` : '-';
}

function formatTotalCurrency(value) {
  return `${Number(value || 0).toLocaleString('ko-KR')}원`;
}

function TherapistNameStack({ name }) {
  const chars = Array.from(String(name || '')).filter((char) => char.trim());
  return (
    <span className="sw-horizontal2-therapist-name-stack">
      {chars.map((char, index) => (
        <span key={`${char}-${index}`}>{char}</span>
      ))}
    </span>
  );
}

export default function ShockwaveSettlementHorizontalCompactView({
  currentMonth,
  incentivePercentage,
  normalizedPriceMap,
  recentMonthlySummaries,
  recentPeriodInput,
  recentPeriodLabel,
  onRecentPeriodInputChange,
  prescriptions,
  settlement,
  viewModeSelector,
}) {
  const incentiveRate = (Number(incentivePercentage) || 0) / 100;
  const displayedPrescriptions = prescriptions.length > 0 ? prescriptions : ['-'];

  return (
    <div className="sw-horizontal2-layout">
      <div className="sw-horizontal2-left">
        <div className="sw-horizontal2-title-row">
          <h2>{currentMonth}월 충격파 결산</h2>
          <div className="sw-settlement-meta">
            {viewModeSelector}
            <span>인센티브 {Number(incentivePercentage) || 0}%</span>
          </div>
        </div>

        <div className="sw-horizontal2-therapist-list">
          {settlement.summaryByTherapist.map((item, therapistIndex) => {
            const toneClass = `therapist-tone-${therapistIndex % 5}`;
            const therapistKey = item.therapist.id || item.therapist.name || therapistIndex;
            return (
              <section key={therapistKey} className="sw-horizontal2-therapist-section">
                <table className="sw-settlement-table sw-horizontal2-therapist-table">
                  <thead>
                    <tr>
                      <th className="therapist-label-col">치료사</th>
                      <th>처방명</th>
                      <th>건수</th>
                      <th>건별 결산금액</th>
                      <th>건별 인센티브</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedPrescriptions.map((prescription, prescriptionIndex) => {
                      const count = item.countsByPrescription[prescription] || 0;
                      const unitPrice = normalizedPriceMap[normalizePrescriptionKey(prescription)] || 0;
                      const prescriptionAmount = count * unitPrice;
                      const prescriptionIncentive = Math.round(prescriptionAmount * incentiveRate);
                      return (
                        <tr key={`${therapistKey}-${prescription}`}>
                          {prescriptionIndex === 0 && (
                            <th className={`therapist-name-col ${toneClass}`} rowSpan={displayedPrescriptions.length + 1}>
                              <TherapistNameStack name={item.therapist.name} />
                            </th>
                          )}
                          <td className="prescription-name">{prescription}</td>
                          <td className="count-val">{formatOptionalCount(count)}</td>
                          <td className="amount-val">{formatCurrency(prescriptionAmount)}</td>
                          <td className="incentive-val">{formatCurrency(prescriptionIncentive)}</td>
                        </tr>
                      );
                    })}
                    <tr className={`horizontal2-total-row ${toneClass}`}>
                      <th>합계</th>
                      <td>{formatOptionalCount(item.totalCount)}</td>
                      <td className="amount-val">{formatCurrency(item.amount)}</td>
                      <td className="incentive-val">{formatCurrency(item.incentive)}</td>
                    </tr>
                  </tbody>
                </table>
              </section>
            );
          })}
        </div>

        <table className="sw-settlement-table sw-horizontal2-grand-table">
          <tbody>
            <tr>
              <th className="grand-title" rowSpan={2}>{currentMonth}월 총 결산</th>
              <th>총 건수</th>
              <th>결산 총액</th>
              <th>인센티브 총액</th>
            </tr>
            <tr className="horizontal2-grand-total-row">
              <td>{formatCount(settlement.grandTotalCount)}</td>
              <td className="amount-val">{formatTotalCurrency(settlement.grandAmount)}</td>
              <td className="incentive-val">{formatTotalCurrency(settlement.grandIncentive)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="sw-horizontal2-right">
        <div className="sw-horizontal2-title-row sw-horizontal2-recent-title-row">
          <h2>{recentPeriodLabel} 충격파 결산/신환 현황</h2>
          <input
            className="sw-horizontal2-period-input"
            type="text"
            value={recentPeriodInput}
            onChange={(event) => onRecentPeriodInputChange?.(event.target.value)}
            placeholder="최근 6개월"
            aria-label="충격파 최근 현황 기간"
          />
        </div>

        <table className="sw-settlement-table sw-horizontal2-recent-table">
          <thead>
            <tr>
              <th>연 월</th>
              <th>건수(건)</th>
              <th>결산 금액(원)</th>
              <th>신환(명)</th>
            </tr>
          </thead>
          <tbody>
            {recentMonthlySummaries.map((item, index) => (
              <tr key={item.monthKey} className={index === 0 ? 'current-period-row' : ''}>
                <th className="month-label">{item.label}</th>
                <td>{formatCount(item.totalCount)}</td>
                <td className="amount-val">{formatTotalCurrency(item.amount)}</td>
                <td className="new-patient-val">{Number(item.newPatientCount || 0).toLocaleString('ko-KR')}명</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

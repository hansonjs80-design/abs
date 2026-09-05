import React, { useCallback, useMemo, useState } from 'react';
import { buildDisplayTherapists } from '../../lib/therapistDisplayUtils';
import {
  buildCryoAdjustedPrescriptionPrices,
  buildShockwaveSettlementPrintColumnWidths,
  buildTherapistCompletedPrescriptionGroups,
  buildTherapistPrescriptionDisplayGroups,
  getTherapistCompletedPrescriptions,
  normalizePrescriptionKey,
  toStatsPrescriptionCount,
} from '../../lib/shockwaveStatsCountUtils';
import ShockwaveSettlementHorizontalCompactView from './ShockwaveSettlementHorizontalCompactView';

const SETTLEMENT_VIEW_MODE_STORAGE_KEY = 'shockwave:settlement:viewMode';
const VIEW_MODES = new Set(['horizontal', 'horizontal2', 'vertical']);

function readStoredViewMode(storageKey = SETTLEMENT_VIEW_MODE_STORAGE_KEY) {
  if (typeof window === 'undefined') return 'horizontal';
  try {
    const stored = window.localStorage.getItem(storageKey);
    return VIEW_MODES.has(stored) ? stored : 'horizontal';
  } catch {
    return 'horizontal';
  }
}

function writeStoredViewMode(nextViewMode, storageKey = SETTLEMENT_VIEW_MODE_STORAGE_KEY) {
  if (typeof window === 'undefined' || !VIEW_MODES.has(nextViewMode)) return;
  try {
    window.localStorage.setItem(storageKey, nextViewMode);
  } catch {
    // localStorage may be unavailable in private browsing or restricted contexts.
  }
}

function formatCount(value) {
  return `${value}건`;
}

function formatCurrency(value) {
  return `${Number(value || 0).toLocaleString('ko-KR')}원`;
}

function formatPercentage(value) {
  return `${Math.max(0, Number(value) || 0).toLocaleString('ko-KR', {
    maximumFractionDigits: 2,
  })}%`;
}

export default function ShockwaveSettlementView({
  logs,
  therapists,
  currentMonth,
  prescriptions,
  prescriptionPrices,
  cryoPrescriptions = [],
  cryoPrices = {},
  incentivePercentage,
  incentivePercentages,
  recentMonthlySummaries = [],
  recentPeriodInput = '최근 6개월',
  recentPeriodLabel = '최근 6개월',
  onRecentPeriodInputChange,
  monthlyTherapists,
  selectedTherapistNames,
  recentSummariesLoading = false,
  treatmentLabel = '충격파',
  showRecentSummaries = true,
  showOnlyTherapistPrescriptions = false,
  viewModeStorageKey = SETTLEMENT_VIEW_MODE_STORAGE_KEY,
}) {
  const [viewMode, setViewMode] = useState(() => readStoredViewMode(viewModeStorageKey)); // 'horizontal' | 'horizontal2' | 'vertical'
  const [pricingMode, setPricingMode] = useState('standard'); // 'standard' | 'cryo'
  const handleViewModeChange = useCallback((nextViewMode, nextPricingMode = 'standard') => {
    if (!VIEW_MODES.has(nextViewMode)) return;
    setViewMode(nextViewMode);
    setPricingMode(nextPricingMode === 'cryo' ? 'cryo' : 'standard');
    writeStoredViewMode(nextViewMode, viewModeStorageKey);
  }, [viewModeStorageKey]);
  const isCryoAdjusted = pricingMode === 'cryo';
  const safeLogs = useMemo(() => (Array.isArray(logs) ? logs.filter(Boolean) : []), [logs]);
  const safeTherapists = useMemo(() => (Array.isArray(therapists) ? therapists.filter(Boolean) : []), [therapists]);
  const allDisplayTherapists = useMemo(
    () => buildDisplayTherapists(safeTherapists, monthlyTherapists),
    [safeTherapists, monthlyTherapists]
  );
  const displayTherapists = useMemo(() => {
    if (!selectedTherapistNames || selectedTherapistNames.length === 0) return allDisplayTherapists;
    const nameSet = new Set(selectedTherapistNames);
    return allDisplayTherapists.filter((t) => nameSet.has(t.name));
  }, [allDisplayTherapists, selectedTherapistNames]);
  const safePrescriptions = useMemo(() => (Array.isArray(prescriptions) ? prescriptions.filter((p) => p && String(p).trim() !== '') : []), [prescriptions]);
  const safeRecentMonthlySummaries = useMemo(
    () => (Array.isArray(recentMonthlySummaries) ? recentMonthlySummaries.filter(Boolean) : []),
    [recentMonthlySummaries]
  );
  const displayedRecentMonthlySummaries = useMemo(() => {
    if (!isCryoAdjusted) return safeRecentMonthlySummaries;
    return safeRecentMonthlySummaries.map((item) => ({
      ...item,
      amount: item.cryoAdjustedAmount ?? item.amount,
    }));
  }, [isCryoAdjusted, safeRecentMonthlySummaries]);

  const effectivePrescriptionPrices = useMemo(() => (
    isCryoAdjusted
      ? buildCryoAdjustedPrescriptionPrices({
        prescriptionPrices,
        cryoPrescriptions,
        cryoPrices,
      })
      : prescriptionPrices || {}
  ), [cryoPrescriptions, cryoPrices, isCryoAdjusted, prescriptionPrices]);

  const normalizedPriceMap = useMemo(() => {
    const entries = Object.entries(effectivePrescriptionPrices).map(([key, amount]) => [
      normalizePrescriptionKey(key),
      Number(amount) || 0,
    ]);
    return Object.fromEntries(entries);
  }, [effectivePrescriptionPrices]);
  const normalizedIncentiveMap = useMemo(() => Object.fromEntries(
    Object.entries(
      incentivePercentages && typeof incentivePercentages === 'object'
        ? incentivePercentages
        : {}
    ).map(([prescription, percentage]) => [
      normalizePrescriptionKey(prescription),
      Math.max(0, Number(percentage) || 0),
    ])
  ), [incentivePercentages]);
  const usesPrescriptionIncentives = Object.keys(normalizedIncentiveMap).length > 0;
  const getIncentivePercentage = useCallback((prescription) => (
    normalizedIncentiveMap[normalizePrescriptionKey(prescription)]
      ?? Math.max(0, Number(incentivePercentage) || 0)
  ), [incentivePercentage, normalizedIncentiveMap]);
  const incentiveLabel = usesPrescriptionIncentives
    ? '처방별 인센티브'
    : `인센티브 ${Number(incentivePercentage) || 0}%`;
  const incentiveRowLabel = usesPrescriptionIncentives
    ? '인센티브 (처방별)'
    : `인센티브 (${Number(incentivePercentage) || 0}%)`;
  const renderPrescriptionLabel = (prescription) => {
    if (!prescription) return '—';
    return (
      <span className="sw-prescription-incentive-label">
        <span>{prescription}</span>
        {usesPrescriptionIncentives && (
          <span className="sw-prescription-incentive-rate">
            인센 {formatPercentage(getIncentivePercentage(prescription))}
          </span>
        )}
      </span>
    );
  };

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
        countsByPrescription[matchedPrescription] += toStatsPrescriptionCount(log?.prescription_count);
      });

      const totalCount = safePrescriptions.reduce(
        (sum, prescription) => sum + (countsByPrescription[prescription] || 0),
        0
      );

      const amount = safePrescriptions.reduce((sum, prescription) => {
        const unitPrice = normalizedPriceMap[normalizePrescriptionKey(prescription)] || 0;
        return sum + (countsByPrescription[prescription] || 0) * unitPrice;
      }, 0);

      const incentive = safePrescriptions.reduce((sum, prescription) => {
        const unitPrice = normalizedPriceMap[normalizePrescriptionKey(prescription)] || 0;
        const prescriptionAmount = (countsByPrescription[prescription] || 0) * unitPrice;
        return sum + Math.round(
          prescriptionAmount * (getIncentivePercentage(prescription) / 100)
        );
      }, 0);

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
  }, [safeLogs, displayTherapists, safePrescriptions, normalizedPriceMap, getIncentivePercentage]);

  const horizontalPrescriptions = useMemo(() => {
    return safePrescriptions.filter(
      (prescription) => (settlement.grandPrescriptionCounts[prescription] || 0) > 0
    );
  }, [safePrescriptions, settlement.grandPrescriptionCounts]);
  const horizontalSummaryPrescriptions = horizontalPrescriptions.length > 0
    ? horizontalPrescriptions
    : showOnlyTherapistPrescriptions
      ? [null]
      : horizontalPrescriptions;
  const displayedTherapistSummaries = settlement.summaryByTherapist;
  const horizontalTherapistPrescriptionGroups = useMemo(() => (
    showOnlyTherapistPrescriptions
      ? buildTherapistCompletedPrescriptionGroups({
          summaries: displayedTherapistSummaries,
          prescriptions: safePrescriptions,
          preserveEmptyColumn: true,
        })
      : buildTherapistPrescriptionDisplayGroups({
          rows: safeLogs,
          prescriptions: safePrescriptions,
          therapists: displayTherapists,
          sharedPrescriptionLimit: 0,
          emptyTherapistPrescriptionLimit: 3,
        })
  ), [
    displayTherapists,
    displayedTherapistSummaries,
    safeLogs,
    safePrescriptions,
    showOnlyTherapistPrescriptions,
  ]);
  const horizontalPrintColumns = useMemo(
    () => buildShockwaveSettlementPrintColumnWidths(horizontalTherapistPrescriptionGroups),
    [horizontalTherapistPrescriptionGroups]
  );

  if (!displayTherapists.length) {
    return (
      <div className="sw-stats-empty">
        활성화된 {treatmentLabel} 치료사가 없어 결산표를 계산할 수 없습니다.
        <div className="empty-subtext">설정 탭에서 치료사와 결산 기준을 먼저 저장해 주세요.</div>
      </div>
    );
  }

  const renderViewModeSelector = (targetPricingMode, ariaLabel) => (
    <div className="sw-view-mode-selector" aria-label={ariaLabel}>
      <button
        type="button"
        className={`sw-view-mode-btn ${pricingMode === targetPricingMode && viewMode === 'horizontal' ? 'active' : ''}`}
        onClick={() => handleViewModeChange('horizontal', targetPricingMode)}
      >
        가로보기
      </button>
      <button
        type="button"
        className={`sw-view-mode-btn ${pricingMode === targetPricingMode && viewMode === 'horizontal2' ? 'active' : ''}`}
        onClick={() => handleViewModeChange('horizontal2', targetPricingMode)}
      >
        가로보기 2
      </button>
      <button
        type="button"
        className={`sw-view-mode-btn ${pricingMode === targetPricingMode && viewMode === 'vertical' ? 'active' : ''}`}
        onClick={() => handleViewModeChange('vertical', targetPricingMode)}
      >
        세로보기
      </button>
    </div>
  );

  return (
    <div className={`sw-settlement-stack sw-settlement-stack--shockwave ${viewMode === 'vertical' ? 'sw-settlement-stack--vertical' : ''} ${viewMode === 'horizontal2' ? 'sw-settlement-stack--horizontal2' : ''}`}>
      <div className="sw-settlement-view-mode-row">
        {renderViewModeSelector('standard', `기본 ${treatmentLabel} 결산 보기 방식`)}
        <div className="sw-cryo-view-mode-group">
          <span className="sw-cryo-view-mode-label">크라이오 반영 통계</span>
          {renderViewModeSelector('cryo', `크라이오 반영 ${treatmentLabel} 결산 보기 방식`)}
        </div>
      </div>

      {viewMode === 'horizontal' ? (
        <>
          <div className="sw-settlement-card sw-settlement-main-card">
            <div className="sw-settlement-header">
              <h2>{currentMonth}월 {treatmentLabel}{isCryoAdjusted ? ' 크라이오 반영' : ''} 결산</h2>
              <div className="sw-settlement-meta">
                <span>{incentiveLabel}</span>
              </div>
            </div>

            <div className="sw-settlement-table-wrap sw-compact-table-wrap">
              <table className="sw-settlement-table sw-compact-settlement-table sw-horizontal-settlement-main-table">
                <colgroup>
                  <col className="sw-shockwave-settlement-label-column" />
                  {horizontalPrintColumns.map((column, columnIndex) => (
                    <col
                      key={`shockwave-print-column-${columnIndex}-${column.prescription}`}
                      className="sw-shockwave-settlement-prescription-column"
                      style={{ '--sw-shockwave-print-column-width': `${column.widthPercent}%` }}
                    />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th className="label-col" rowSpan={2}>구분</th>
                    {displayedTherapistSummaries.map((item, therapistIndex) => (
                      <th
                        key={item?.therapist?.id || item?.therapist?.name || therapistIndex}
                        colSpan={horizontalTherapistPrescriptionGroups[therapistIndex]?.prescriptions.length || 1}
                        className={`therapist-col therapist-group-end therapist-tone-${therapistIndex % 5}`}
                      >
                        {item?.therapist?.name || ''}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {displayedTherapistSummaries.flatMap((item, therapistIndex) =>
                      (horizontalTherapistPrescriptionGroups[therapistIndex]?.prescriptions || []).map((prescription, prescriptionIndex, therapistPrescriptions) => (
                        <th key={`${item?.therapist?.id || item?.therapist?.name || therapistIndex}-${prescription || 'empty'}`} className={`prescription-col therapist-tone-${therapistIndex % 5}-sub${!prescription ? ' prescription-col--empty' : ''}${prescriptionIndex === therapistPrescriptions.length - 1 ? ' therapist-group-end' : ''}`} title={!prescription ? '완료 처방 없음' : undefined}>
                          {renderPrescriptionLabel(prescription)}
                        </th>
                      ))
                    )}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th className="row-label">처방 건수</th>
                    {displayedTherapistSummaries.flatMap((item, therapistIndex) =>
                      (horizontalTherapistPrescriptionGroups[therapistIndex]?.prescriptions || []).map((prescription, prescriptionIndex, therapistPrescriptions) => (
                        <td key={`count-${item?.therapist?.id || item?.therapist?.name || therapistIndex}-${prescription || 'empty'}`} className={`therapist-tone-${therapistIndex % 5}-cell${!prescription ? ' prescription-value--empty' : ''}${prescriptionIndex === therapistPrescriptions.length - 1 ? ' therapist-group-end' : ''}`}>
                          {prescription && settlement.grandPrescriptionCounts[prescription] >= 0
                            ? item.countsByPrescription[prescription] || 0
                            : 0}
                        </td>
                      ))
                    )}
                  </tr>
                  <tr>
                    <th className="row-label">{treatmentLabel} 합계(건)</th>
                    {displayedTherapistSummaries.map((item, therapistIndex) => (
                      <td key={`total-count-${item?.therapist?.id || item?.therapist?.name || therapistIndex}`} colSpan={horizontalTherapistPrescriptionGroups[therapistIndex]?.prescriptions.length || 1} className={`merged-value therapist-group-end therapist-tone-${therapistIndex % 5}-cell${horizontalTherapistPrescriptionGroups[therapistIndex]?.prescriptions.length === 1 ? ' merged-value--single-prescription' : ''}`}>
                        {formatCount(item.totalCount)}
                      </td>
                    ))}
                  </tr>
                  <tr className="settlement-amount-row">
                    <th className="row-label">결산 금액(원)</th>
                    {displayedTherapistSummaries.map((item, therapistIndex) => (
                      <td key={`amount-${item?.therapist?.id || item?.therapist?.name || therapistIndex}`} colSpan={horizontalTherapistPrescriptionGroups[therapistIndex]?.prescriptions.length || 1} className={`merged-value amount therapist-group-end therapist-tone-${therapistIndex % 5}-cell${horizontalTherapistPrescriptionGroups[therapistIndex]?.prescriptions.length === 1 ? ' merged-value--single-prescription' : ''}`}>
                        {formatCurrency(item.amount)}
                      </td>
                    ))}
                  </tr>
                  <tr className="settlement-incentive-row">
                    <th className="row-label">{incentiveRowLabel}</th>
                    {displayedTherapistSummaries.map((item, therapistIndex) => (
                      <td key={`incentive-${item?.therapist?.id || item?.therapist?.name || therapistIndex}`} colSpan={horizontalTherapistPrescriptionGroups[therapistIndex]?.prescriptions.length || 1} className={`merged-value incentive therapist-group-end therapist-tone-${therapistIndex % 5}-cell${horizontalTherapistPrescriptionGroups[therapistIndex]?.prescriptions.length === 1 ? ' merged-value--single-prescription' : ''}`}>
                        {formatCurrency(item.incentive)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className={`sw-settlement-support-row${showRecentSummaries ? '' : ' sw-settlement-support-row--single'}`}>
            <div className="sw-settlement-card sw-grand-total-card">
              <div className="sw-settlement-header">
                <h2>총합계</h2>
                <div className="sw-settlement-meta">
                  <span>{currentMonth}월 전체</span>
                </div>
              </div>

              <div className="sw-settlement-table-wrap sw-compact-table-wrap">
                <table className="sw-settlement-table sw-grand-total-table">
                  <thead>
                    <tr>
                      <th className="label-col">구분</th>
                      {horizontalSummaryPrescriptions.map((prescription) => (
                        <th key={`grand-summary-head-${prescription || 'empty'}`} className="prescription-col">
                          {renderPrescriptionLabel(prescription)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th className="row-label">처방 건수</th>
                      {horizontalSummaryPrescriptions.map((prescription) => (
                        <td key={`grand-summary-count-${prescription || 'empty'}`} className="grand-value">
                          {formatCount(settlement.grandPrescriptionCounts[prescription] || 0)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th className="row-label">{treatmentLabel} 합계(건)</th>
                      <td className="grand-value merged-value" colSpan={horizontalSummaryPrescriptions.length}>
                        {formatCount(settlement.grandTotalCount)}
                      </td>
                    </tr>
                    <tr className="settlement-amount-row">
                      <th className="row-label">결산 금액(원)</th>
                      <td className="grand-value merged-value amount" colSpan={horizontalSummaryPrescriptions.length}>
                        {formatCurrency(settlement.grandAmount)}
                      </td>
                    </tr>
                    <tr className="settlement-incentive-row">
                      <th className="row-label">{incentiveRowLabel}</th>
                      <td className="grand-value merged-value incentive" colSpan={horizontalSummaryPrescriptions.length}>
                        {formatCurrency(settlement.grandIncentive)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {showRecentSummaries && (
            <div className="sw-settlement-card sw-recent-summary-card">
              <div className="sw-settlement-header">
                <h2>{recentPeriodLabel} {treatmentLabel}{isCryoAdjusted ? ' 크라이오 반영' : ''} 결산/신환 현황</h2>
                <div className="sw-settlement-meta sw-recent-period-control">
                  <input
                    type="text"
                    value={recentPeriodInput}
                    onChange={(event) => onRecentPeriodInputChange?.(event.target.value)}
                    placeholder="최근 6개월"
                    aria-label={`${treatmentLabel} 최근 현황 기간`}
                  />
                </div>
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
                    {recentSummariesLoading ? (
                      <tr>
                        <td colSpan={4}>최근 현황 불러오는 중...</td>
                      </tr>
                    ) : (
                      displayedRecentMonthlySummaries.map((item) => (
                        <tr key={item.monthKey}>
                          <th className="month-label">{item.label}</th>
                          <td>{formatCount(item.totalCount)}</td>
                          <td className="amount">{formatCurrency(item.amount)}</td>
                          <td className="new-patient">{item.newPatientCount}명</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            )}
          </div>
        </>
      ) : viewMode === 'horizontal2' ? (
        <ShockwaveSettlementHorizontalCompactView
          currentMonth={currentMonth}
          incentivePercentage={incentivePercentage}
          incentivePercentages={incentivePercentages}
          incentiveLabel={incentiveLabel}
          isCryoAdjusted={isCryoAdjusted}
          normalizedPriceMap={normalizedPriceMap}
          onRecentPeriodInputChange={onRecentPeriodInputChange}
          prescriptions={safePrescriptions}
          recentMonthlySummaries={displayedRecentMonthlySummaries}
          recentPeriodInput={recentPeriodInput}
          recentPeriodLabel={recentPeriodLabel}
          settlement={settlement}
          recentSummariesLoading={recentSummariesLoading}
          treatmentLabel={treatmentLabel}
          showRecentSummaries={showRecentSummaries}
          showOnlyTherapistPrescriptions={showOnlyTherapistPrescriptions}
        />
      ) : (
        <>
        <div className="sw-settlement-vertical-layout">
          <div className="sw-settlement-vertical-heading-row">
            <div className="sw-settlement-vertical-header-wrap">
              <div className="sw-settlement-header">
                <h2>{currentMonth}월 {treatmentLabel}{isCryoAdjusted ? ' 크라이오 반영' : ''} 결산</h2>
                <div className="sw-settlement-meta">
                  <span>{incentiveLabel}</span>
                </div>
              </div>
            </div>
            <div className="sw-settlement-header sw-settlement-vertical-summary-heading">
              <h2>{currentMonth}월 총 결산</h2>
            </div>
          </div>

          <div className="sw-settlement-vertical-body">
            <div className="sw-settlement-vertical-left">
              {displayedTherapistSummaries.map((item, therapistIndex) => {
                const completedPrescriptions = getTherapistCompletedPrescriptions(
                  item,
                  safePrescriptions
                );
                const therapistPrescriptions = completedPrescriptions.length > 0
                  ? completedPrescriptions
                  : showOnlyTherapistPrescriptions
                    ? [null]
                    : completedPrescriptions;

                return (
                <div key={item.therapist.id || item.therapist.name} className="sw-vertical-therapist-card">
                  <div className={`sw-vertical-therapist-header therapist-tone-${therapistIndex % 3}`}>
                    <h3>{item.therapist.name} 치료사</h3>
                  </div>
                  <div className="sw-settlement-table-wrap">
                    <table className="sw-vertical-therapist-table">
                      <thead>
                        <tr>
                          <th>처방명</th>
                          <th>건수</th>
                          <th>건별 결산금액</th>
                          <th>건별 인센티브</th>
                        </tr>
                      </thead>
                      <tbody>
                        {therapistPrescriptions.map((prescription) => {
                            const count = item.countsByPrescription[prescription] || 0;
                            const unitPrice = normalizedPriceMap[normalizePrescriptionKey(prescription)] || 0;
                            const prescriptionAmount = count * unitPrice;
                            const prescriptionIncentive = Math.round(
                              prescriptionAmount * (getIncentivePercentage(prescription) / 100)
                            );

                            return (
                              <tr key={prescription || 'empty'}>
                                <td className="prescription-name" title={!prescription ? '완료 처방 없음' : undefined}>{renderPrescriptionLabel(prescription)}</td>
                                <td className="count-val">{count > 0 ? `${count}건` : '-'}</td>
                                <td className="amount-val">{prescriptionAmount > 0 ? formatCurrency(prescriptionAmount) : '-'}</td>
                                <td className="incentive-val">{prescriptionIncentive > 0 ? formatCurrency(prescriptionIncentive) : '-'}</td>
                              </tr>
                            );
                          })}
                        <tr className={`vertical-total-row therapist-tone-${therapistIndex % 3}`}>
                          <th>합계</th>
                          <td>{item.totalCount > 0 ? `${item.totalCount}건` : '-'}</td>
                          <td className="amount-val">{item.amount > 0 ? formatCurrency(item.amount) : '-'}</td>
                          <td className="incentive-val">{item.incentive > 0 ? formatCurrency(item.incentive) : '-'}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                );
              })}
            </div>

            <div className="sw-settlement-vertical-right">
              {/* [월] 총 결산 */}
              <div className="sw-settlement-card sw-vertical-summary-card">
                <div className="sw-settlement-table-wrap">
                  <table className="sw-vertical-summary-table">
                    <thead>
                      <tr>
                        <th>구분</th>
                        <th>총 건수</th>
                        <th>결산 총액</th>
                        <th>인센티브 총액</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="grand-total-row">
                        <th>총 합계</th>
                        <td>{settlement.grandTotalCount}건</td>
                        <td className="amount-val">{formatCurrency(settlement.grandAmount)}</td>
                        <td className="incentive-val">{formatCurrency(settlement.grandIncentive)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* [월] 처방별 총 결산 */}
              <div className="sw-settlement-card sw-vertical-summary-card">
                <div className="sw-settlement-header">
                  <h2>{currentMonth}월 처방별 총 결산</h2>
                </div>
                <div className="sw-settlement-table-wrap">
                  <table className="sw-vertical-prescription-summary-table">
                    <thead>
                      <tr>
                        <th>처방명</th>
                        <th>건수</th>
                        <th>건별 결산금액</th>
                        <th>건별 인센티브</th>
                      </tr>
                    </thead>
                    <tbody>
                      {safePrescriptions
                        .filter((prescription) => (settlement.grandPrescriptionCounts[prescription] || 0) > 0)
                        .map((prescription) => {
                          const count = settlement.grandPrescriptionCounts[prescription] || 0;
                          const unitPrice = normalizedPriceMap[normalizePrescriptionKey(prescription)] || 0;
                          const prescriptionAmount = count * unitPrice;
                          const prescriptionIncentive = Math.round(
                            prescriptionAmount * (getIncentivePercentage(prescription) / 100)
                          );

                          return (
                            <tr key={prescription}>
                              <td className="prescription-name">{renderPrescriptionLabel(prescription)}</td>
                              <td className="count-val">{count > 0 ? `${count}건` : '-'}</td>
                              <td className="amount-val">{prescriptionAmount > 0 ? formatCurrency(prescriptionAmount) : '-'}</td>
                              <td className="incentive-val">{prescriptionIncentive > 0 ? formatCurrency(prescriptionIncentive) : '-'}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 최근 6개월 충격파 결산/신환 현황 */}
              {showRecentSummaries && (
              <div className="sw-settlement-card sw-recent-summary-card sw-vertical-recent-card">
                <div className="sw-settlement-header">
                  <h2>{recentPeriodLabel} {treatmentLabel}{isCryoAdjusted ? ' 크라이오 반영' : ''} 결산/신환 현황</h2>
                  <div className="sw-settlement-meta sw-recent-period-control">
                    <input
                      type="text"
                      value={recentPeriodInput}
                      onChange={(event) => onRecentPeriodInputChange?.(event.target.value)}
                      placeholder="최근 6개월"
                      aria-label={`${treatmentLabel} 최근 현황 기간`}
                    />
                  </div>
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
                      {recentSummariesLoading ? (
                        <tr>
                          <td colSpan={4}>최근 현황 불러오는 중...</td>
                        </tr>
                      ) : (
                        displayedRecentMonthlySummaries.map((item) => (
                          <tr key={item.monthKey}>
                            <th className="month-label">{item.label}</th>
                            <td>{formatCount(item.totalCount)}</td>
                            <td className="amount">{formatCurrency(item.amount)}</td>
                            <td className="new-patient">{item.newPatientCount}명</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              )}
            </div>
          </div>
        </div>
        </>
      )}
    </div>
  );
}

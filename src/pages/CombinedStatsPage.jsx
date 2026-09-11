import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSchedule } from '../contexts/ScheduleContext';
import { useToast } from '../components/common/Toast';
import { supabase } from '../lib/supabaseClient';
import { isAdminUser } from '../lib/authPermissions';
import { getTodayKST } from '../lib/calendarUtils';
import {
  buildCombinedStatsMonthSummary,
  COMBINED_STATS_TREATMENTS,
} from '../lib/combinedStatsUtils';
import { normalizeManualTherapyLogRows } from '../lib/manualTherapyLogUtils';
import { syncMonthManualTherapyScheduleToStats } from '../lib/manualTherapyUtils';
import { formatRecentPeriodLabel, parseRecentPeriodMonths } from '../lib/recentPeriodUtils';
import { getEffectiveSettlementSettings } from '../lib/settlementSettings';
import { syncMonthShockwaveScheduleToStats } from '../lib/shockwaveSyncUtils';
import {
  getRecentScheduleMonthTargets,
  loadScheduleMemosForStatsMonth,
  loadStatsMonthlyTherapists,
} from '../lib/statsScheduleSourceUtils';
import { loadStatsMonthsCurrentFirst } from '../lib/statsSectionLoadingUtils';
import '../styles/combined_stats.css';

const LOG_FIELDS = 'id,date,patient_name,chart_number,visit_count,body_part,therapist_name,prescription,prescription_count,source,scheduler_cell_key,created_at';

function formatCount(value) {
  return `${Math.max(0, Number(value) || 0).toLocaleString('ko-KR')}건`;
}

function formatCurrency(value) {
  return `${Math.max(0, Number(value) || 0).toLocaleString('ko-KR')}원`;
}

function formatIncentiveRate(value) {
  const rate = Math.max(0, Number(value) || 0);
  return `${rate.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%`;
}

function IncentiveRateList({ rates = [] }) {
  if (!Array.isArray(rates) || rates.length === 0) return <span>—</span>;
  return (
    <div className="combined-incentive-rate-list">
      {rates.map((rate) => (
        <span key={rate} className="combined-incentive-rate-badge">
          {formatIncentiveRate(rate)}
        </span>
      ))}
    </div>
  );
}

function buildTherapistTreatmentSections(item) {
  const hasAnyActivity = Math.max(0, Number(item?.total?.count) || 0) > 0;
  if (!hasAnyActivity) return [];

  return COMBINED_STATS_TREATMENTS.map((treatment) => {
    const value = item?.treatments?.[treatment.key] || { count: 0, amount: 0, incentive: 0 };
    if (treatment.key === 'shinjang_spray') {
      // 처방명별 실적이 있으면 처방명별로 행 생성 (우선)
      const prescriptionGroups = Array.isArray(item?.shinjangPrescriptionGroups)
        ? item.shinjangPrescriptionGroups
        : [];
      if (prescriptionGroups.length > 0) {
        const rows = prescriptionGroups.map((pg) => ({
          prescription: pg.prescription,
          count: Math.max(0, Number(pg.count) || 0),
          amount: Math.max(0, Number(pg.amount) || 0),
          incentive: Math.max(0, Number(pg.incentive) || 0),
          rates: Array.isArray(pg.rates) && pg.rates.length > 0 ? pg.rates : [pg.rate ?? 0],
        }));
        // 실적이 있는 행만 포함 (count > 0)
        const activeRows = rows.filter((r) => r.count > 0);
        if (activeRows.length > 0) {
          return { ...treatment, value, rows: activeRows };
        }
      }

      // 폴백: 인센율별 그룹 사용
      const therapistShinjangMap = new Map(
        (Array.isArray(item?.shinjangIncentiveGroups) ? item.shinjangIncentiveGroups : [])
          .map((g) => [Number(g.rate), g])
      );
      const configuredRates = Array.isArray(item?.configuredShinjangRates) && item.configuredShinjangRates.length > 0
        ? item.configuredShinjangRates.map(Number)
        : (item?.incentiveRates?.shinjang_spray?.length > 0
          ? item.incentiveRates.shinjang_spray.map(Number)
          : [7]);

      const rows = configuredRates.map((rate) => {
        const found = therapistShinjangMap.get(rate);
        if (found) {
          return { ...found, rates: [rate] };
        }
        return { rate, count: 0, amount: 0, incentive: 0, rates: [rate] };
      });

      return { ...treatment, value, rows };
    }

    const rows = [{ ...value, rates: item?.incentiveRates?.[treatment.key] || [] }];
    return { ...treatment, value, rows };
  }).filter((section) => {
    if (section.key === 'shinjang_spray') {
      return section.rows.some((r) => Math.max(0, Number(r.count) || 0) > 0)
        || Math.max(0, Number(section.value.count) || 0) > 0;
    }
    return Math.max(0, Number(section.value.count) || 0) > 0;
  });
}

function buildRecentMetricItems(summary, metric, { includeManual = true, totalOnly = false } = {}) {
  const treatmentTotals = summary?.treatmentTotals || {};
  const shinjangTotal = treatmentTotals.shinjang_spray || {};
  const shinjangGroups = Array.isArray(summary?.shinjangIncentiveGroups)
    ? summary.shinjangIncentiveGroups
    : [];
  const total = summary?.total || {
    count: summary?.totalCount,
    amount: summary?.amount,
    incentive: summary?.incentive,
  };
  const shinjangItems = shinjangGroups.length > 0
    ? shinjangGroups.map((group) => ({
        key: `shinjang-${group.rate}`,
        label: `신장분사 ${formatIncentiveRate(group.rate)}`,
        tone: 'shinjang',
        value: group?.[metric],
      }))
    : [{ key: 'shinjang', label: '신장분사', tone: 'shinjang', value: shinjangTotal?.[metric] }];

  if (totalOnly) {
    return [{ key: 'total', label: '전체', tone: 'total', value: total?.[metric] }];
  }

  return [
    { key: 'total', label: '전체', tone: 'total', value: total?.[metric] },
    {
      key: 'shockwave',
      label: '충격파',
      tone: 'shockwave',
      value: treatmentTotals.shockwave?.[metric],
    },
    ...shinjangItems,
    ...(includeManual ? [{
      key: 'manual',
      label: '도수치료',
      tone: 'manual',
      value: treatmentTotals.manual_therapy?.[metric],
    }] : []),
  ];
}

function RecentMetricBreakdown({ summary, metric, includeManual = true, totalOnly = false }) {
  const formatter = metric === 'count' ? formatCount : formatCurrency;
  const items = buildRecentMetricItems(summary, metric, { includeManual, totalOnly });

  if (totalOnly && items.length === 1) {
    const single = items[0];
    return (
      <div className={`combined-recent-single-value combined-recent-single-value--${metric}`}>
        <strong>{formatter(single.value)}</strong>
      </div>
    );
  }

  return (
    <div className={`combined-recent-breakdown combined-recent-breakdown--${metric}`}>
      {items.map((item) => (
        <div
          key={item.key}
          className={`combined-recent-breakdown-item combined-recent-breakdown-item--${item.tone}`}
        >
          <span>{item.label}</span>
          <strong>{formatter(item.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function buildMonthLogQuery(tableName, year, month) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  const today = getTodayKST();
  const isCurrentCalendarMonth = today.getFullYear() === Number(year)
    && today.getMonth() + 1 === Number(month);
  const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  let query = supabase
    .from(tableName)
    .select(LOG_FIELDS)
    .gte('date', startDate);
  query = isCurrentCalendarMonth ? query.lte('date', todayDate) : query.lt('date', endDate);
  return query
    .order('date', { ascending: true })
    .order('created_at', { ascending: true });
}

export default function CombinedStatsPage() {
  const {
    currentYear,
    currentMonth,
    therapists,
    manualTherapists,
    shockwaveSettings,
    loadTherapists,
    loadManualTherapists,
    loadShockwaveSettings,
  } = useSchedule();
  const { user } = useAuth();
  const { addToast } = useToast();
  const isAdmin = isAdminUser(user);
  const [recentPeriodInput, setRecentPeriodInput] = useState('최근 6개월');
  const [recentViewMode, setRecentViewMode] = useState('total-only');
  const [monthSummaries, setMonthSummaries] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);
  const settingsRef = useRef(shockwaveSettings);
  const therapistRef = useRef(therapists);
  const manualTherapistRef = useRef(manualTherapists);

  useEffect(() => {
    settingsRef.current = shockwaveSettings;
  }, [shockwaveSettings]);

  useEffect(() => {
    therapistRef.current = therapists;
  }, [therapists]);

  useEffect(() => {
    manualTherapistRef.current = manualTherapists;
  }, [manualTherapists]);

  const recentPeriodMonths = useMemo(
    () => parseRecentPeriodMonths(recentPeriodInput, 6),
    [recentPeriodInput]
  );
  const recentPeriodLabel = useMemo(
    () => formatRecentPeriodLabel(recentPeriodMonths),
    [recentPeriodMonths]
  );
  const monthTargets = useMemo(() => getRecentScheduleMonthTargets({
    currentYear,
    currentMonth,
    recentPeriodMonths,
  }), [currentMonth, currentYear, recentPeriodMonths]);

  const refreshData = useCallback(async ({ force = false } = {}) => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      const [loadedShockwaveTherapists, loadedManualTherapists, loadedSettings] = await Promise.all([
        loadTherapists({ force }),
        loadManualTherapists({ force }),
        loadShockwaveSettings({ force }),
      ]);
      if (requestId !== requestIdRef.current) return;

      const baseShockwaveTherapists = Array.isArray(loadedShockwaveTherapists)
        ? loadedShockwaveTherapists
        : therapistRef.current || [];
      const baseManualTherapists = Array.isArray(loadedManualTherapists)
        ? loadedManualTherapists
        : manualTherapistRef.current || [];
      const settings = loadedSettings || settingsRef.current || {};
      settingsRef.current = settings;

      const loadMonthSummary = async (target) => {
        const isCurrentMonth = Number(target.year) === Number(currentYear)
          && Number(target.month) === Number(currentMonth);

        const [
          memos,
          monthlyShockwaveTherapists,
          monthlyManualTherapists,
          monthlyShinjangTherapists,
        ] = await Promise.all([
          isCurrentMonth
            ? loadScheduleMemosForStatsMonth({
                year: target.year,
                month: target.month,
                settings,
              })
            : Promise.resolve({}),
          loadStatsMonthlyTherapists({
            year: target.year,
            month: target.month,
            type: 'shockwave',
            baseTherapists: baseShockwaveTherapists,
          }),
          loadStatsMonthlyTherapists({
            year: target.year,
            month: target.month,
            type: 'manual_therapy',
            baseTherapists: baseManualTherapists,
          }),
          loadStatsMonthlyTherapists({
            year: target.year,
            month: target.month,
            type: 'shinjang_spray',
            baseTherapists: baseShockwaveTherapists,
          }),
        ]);

        if (isCurrentMonth) {
          const syncResults = await Promise.allSettled([
            ...(baseShockwaveTherapists.length > 0 ? [syncMonthShockwaveScheduleToStats({
              year: target.year,
              month: target.month,
              memos,
              therapists: baseShockwaveTherapists,
              monthlyTherapists: monthlyShockwaveTherapists,
              settings,
              upToToday: true,
              scheduleAuthoritative: true,
              emitEvent: false,
              replaceExistingMonthLogs: true,
            })] : []),
            ...(baseManualTherapists.length > 0 ? [syncMonthManualTherapyScheduleToStats({
              year: target.year,
              month: target.month,
              memos,
              therapists: baseManualTherapists,
              monthlyTherapists: monthlyManualTherapists,
              settings,
              upToToday: true,
              scheduleAuthoritative: true,
              emitEvent: false,
              replaceExistingMonthLogs: true,
            })] : []),
          ]);
          syncResults.forEach((result) => {
            if (result.status === 'rejected') {
              console.error('전체 통계 원본 동기화 실패:', result.reason);
            }
          });
        }

        const [shockwaveResult, manualResult] = await Promise.all([
          buildMonthLogQuery('shockwave_patient_logs', target.year, target.month),
          buildMonthLogQuery('manual_therapy_patient_logs', target.year, target.month),
        ]);
        if (shockwaveResult.error) throw shockwaveResult.error;
        if (manualResult.error) throw manualResult.error;

        const manualSettings = getEffectiveSettlementSettings(
          settings,
          target.year,
          target.month,
          'manual_therapy'
        );
        const normalizedManualRows = normalizeManualTherapyLogRows(
          manualResult.data || [],
          manualSettings.prescriptions,
          {
            memos,
            year: target.year,
            month: target.month,
            settings,
            scheduleAuthoritative: isCurrentMonth,
          }
        );

        return buildCombinedStatsMonthSummary({
          year: target.year,
          month: target.month,
          shockwaveRows: shockwaveResult.data || [],
          manualTherapyRows: normalizedManualRows,
          shockwaveTherapists: baseShockwaveTherapists,
          manualTherapists: baseManualTherapists,
          monthlyShockwaveTherapists,
          monthlyManualTherapists,
          monthlyShinjangTherapists,
          settings,
          isAdmin,
        });
      };
      const summaries = await loadStatsMonthsCurrentFirst({
        targets: monthTargets,
        currentYear,
        currentMonth,
        loadMonth: loadMonthSummary,
        concurrency: 2,
        onCurrentLoaded: (summary) => {
          if (requestId !== requestIdRef.current || !summary) return;
          setMonthSummaries((previous) => {
            const summariesByMonth = new Map(
              previous.map((item) => [item.monthKey, item])
            );
            summariesByMonth.set(summary.monthKey, summary);
            return monthTargets
              .map((target) => summariesByMonth.get(
                `${Number(target.year)}-${String(Number(target.month)).padStart(2, '0')}`
              ))
              .filter(Boolean);
          });
        },
      });
      if (requestId !== requestIdRef.current) return;
      setMonthSummaries(summaries);
    } catch (error) {
      if (requestId === requestIdRef.current) {
        console.error('전체 통계 로드 실패:', error);
        addToast('전체 통계를 불러오는데 실패했습니다.', 'error');
      }
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [
    addToast,
    isAdmin,
    loadManualTherapists,
    loadShockwaveSettings,
    loadTherapists,
    currentMonth,
    currentYear,
    monthTargets,
  ]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  useEffect(() => {
    const handleStatsUpdated = () => refreshData();
    window.addEventListener('clinic-stats-updated', handleStatsUpdated);
    return () => window.removeEventListener('clinic-stats-updated', handleStatsUpdated);
  }, [refreshData]);

  const currentMonthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
  const currentSummary = monthSummaries.find((summary) => summary.monthKey === currentMonthKey);
  const recentRows = useMemo(() => [...monthSummaries].reverse(), [monthSummaries]);

  return (
    <div className="combined-stats-page animate-fade-in">
      {isLoading && <div className="top-loading-bar" />}
      <header className="combined-stats-header">
        <div>
          <h1>{currentYear}년 {String(currentMonth).padStart(2, '0')}월 전체 통계</h1>
          <p>
            {isAdmin
              ? '충격파 · 신장분사 · 도수치료의 크라이오 반영 결산입니다.'
              : '충격파 · 신장분사의 크라이오 반영 결산입니다.'}
          </p>
        </div>
        <button
          type="button"
          className="combined-stats-refresh"
          onClick={() => refreshData({ force: true })}
          disabled={isLoading}
        >
          <RefreshCw size={16} className={isLoading ? 'spin-animation' : ''} />
          {isLoading ? '새로 고침 중...' : '새로 고침'}
        </button>
      </header>

      <div className="combined-stats-dashboard">
        <section className="combined-stats-current" aria-label={`${currentMonth}월 치료사별 전체 통계`}>
          {currentSummary?.therapists?.length > 0 ? (
            <>
              {currentSummary.therapists.map((item, index) => {
                const visibleTreatments = buildTherapistTreatmentSections(item);
                return (
                  <article
                    key={item.therapist.key || item.therapist.id || item.therapist.name}
                    className={`combined-therapist-card combined-tone-${index % 5}`}
                  >
                    <table>
                      <colgroup>
                        <col className="combined-current-col-type" />
                        <col className="combined-current-col-count" />
                        <col className="combined-current-col-amount" />
                        <col className="combined-current-col-incentive" />
                        <col className="combined-current-col-rate" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th className="combined-therapist-name" colSpan={5}>
                            <div className="combined-therapist-name-content">
                              <span>{item.therapist.displayName || item.therapist.name} 치료사</span>
                              <span className="combined-therapist-header-count">
                                {formatCount(item.total.count)}
                              </span>
                            </div>
                          </th>
                        </tr>
                        {visibleTreatments.length > 0 && (
                          <tr>
                            <th>구분</th>
                            <th>총건수</th>
                            <th>처방별 총 결산 금액</th>
                            <th>처방별 총 인센티브</th>
                            <th>인센</th>
                          </tr>
                        )}
                      </thead>
                      {visibleTreatments.length > 0 && (
                        <tbody>
                          {visibleTreatments.flatMap((treatment) => (
                            treatment.rows.map((row, rowIndex) => {
                              const rowKey = row.prescription
                                ? `${treatment.key}-${row.prescription}`
                                : `${treatment.key}-${row.rates?.join('-') || 'total'}`;
                              // 처방명별 다중 행인 경우(신장분사 처방명 모드): 각 행에 구분 셀 독립 표시
                              const hasPrescription = Boolean(row.prescription);
                              return (
                                <tr
                                  key={rowKey}
                                  className={rowIndex === 0 ? 'combined-treatment-group-start' : undefined}
                                >
                                  {hasPrescription ? (
                                    // 처방명별 행: 처방명을 구분 셀로 표시
                                    rowIndex === 0 ? (
                                      <th rowSpan={treatment.rows.length}>{treatment.label}</th>
                                    ) : null
                                  ) : (
                                    rowIndex === 0 && (
                                      <th rowSpan={treatment.rows.length}>{treatment.label}</th>
                                    )
                                  )}
                                  <td className="combined-therapist-count-cell">{formatCount(row.count)}</td>
                                  <td className="combined-therapist-amount-cell">{formatCurrency(row.amount)}</td>
                                  <td className="combined-therapist-incentive-cell">{formatCurrency(row.incentive)}</td>
                                  <td className="combined-incentive-rate-cell">
                                    {hasPrescription
                                      ? <span className="combined-prescription-label">{row.prescription}</span>
                                      : <IncentiveRateList rates={row.rates} />}
                                  </td>
                                </tr>
                              );
                            })
                          ))}
                          <tr className="combined-therapist-total">
                            <th>합계</th>
                            <td className="combined-therapist-count-cell">{formatCount(item.total.count)}</td>
                            <td className="combined-therapist-amount-cell">{formatCurrency(item.total.amount)}</td>
                            <td className="combined-therapist-incentive-cell">{formatCurrency(item.total.incentive)}</td>
                            <td>—</td>
                          </tr>
                        </tbody>
                      )}
                    </table>
                  </article>
                );
              })}

              <article
                className="combined-therapist-card combined-therapist-summary-card"
                aria-label={`${currentMonth}월 치료사 합계`}
              >
                <table>
                  <colgroup>
                    <col className="combined-summary-col-therapist" />
                    <col className="combined-summary-col-amount" />
                    <col className="combined-summary-col-incentive" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="combined-therapist-name combined-summary-title-header" colSpan={3}>
                        <div className="combined-therapist-name-content">
                          <span>치료사별 합계</span>
                          <span className="combined-therapist-header-count">
                            {formatCount(currentSummary.total.count)}
                          </span>
                        </div>
                      </th>
                    </tr>
                    <tr className="combined-summary-column-header-row">
                      <th className="combined-summary-empty-header" aria-label="치료사"></th>
                      <th>총 결산 금액 합계</th>
                      <th>총 인센티브 합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentSummary.therapists.map((item, index) => (
                      <tr key={`summary-${item.therapist.key || item.therapist.id || item.therapist.name}`}>
                        <th className={`combined-summary-therapist-cell combined-summary-tone-${index % 5}`}>
                          {item.therapist.displayName || item.therapist.name} 치료사
                        </th>
                        <td className="combined-summary-amount-cell">{formatCurrency(item.total.amount)}</td>
                        <td className="combined-summary-incentive-cell">{formatCurrency(item.total.incentive)}</td>
                      </tr>
                    ))}
                    <tr className="combined-therapist-total combined-summary-grand-total">
                      <th>전체 합계</th>
                      <td className="combined-summary-amount-cell">{formatCurrency(currentSummary.total.amount)}</td>
                      <td className="combined-summary-incentive-cell">{formatCurrency(currentSummary.total.incentive)}</td>
                    </tr>
                  </tbody>
                </table>
              </article>

              <article
                className="combined-therapist-card combined-treatment-breakdown-card"
                aria-label={`${currentMonth}월 항목별 결산 내역`}
              >
                <table>
                  <colgroup>
                    <col className="combined-breakdown-col-label" />
                    <col className="combined-breakdown-col-count" />
                    <col className="combined-breakdown-col-amount" />
                    <col className="combined-breakdown-col-incentive" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="combined-therapist-name combined-summary-title-header" colSpan={4}>
                        <div className="combined-therapist-name-content">
                          <span>항목별 결산 내역</span>
                        </div>
                      </th>
                    </tr>
                    <tr className="combined-summary-column-header-row">
                      <th className="combined-summary-empty-header" aria-label="항목">항목</th>
                      <th>건수</th>
                      <th>결산 금액</th>
                      <th>인센티브</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="combined-breakdown-row combined-breakdown-shockwave">
                      <th>충격파</th>
                      <td>{formatCount(currentSummary.treatmentTotals?.shockwave?.count)}</td>
                      <td className="combined-summary-amount-cell">{formatCurrency(currentSummary.treatmentTotals?.shockwave?.amount)}</td>
                      <td className="combined-summary-incentive-cell">{formatCurrency(currentSummary.treatmentTotals?.shockwave?.incentive)}</td>
                    </tr>
                    {(Array.isArray(currentSummary.shinjangIncentiveGroups) && currentSummary.shinjangIncentiveGroups.length > 0)
                      ? currentSummary.shinjangIncentiveGroups.map((group) => (
                          <tr key={`breakdown-shinjang-${group.rate}`} className="combined-breakdown-row combined-breakdown-shinjang">
                            <th>신장분사 {formatIncentiveRate(group.rate)}</th>
                            <td>{formatCount(group.count)}</td>
                            <td className="combined-summary-amount-cell">{formatCurrency(group.amount)}</td>
                            <td className="combined-summary-incentive-cell">{formatCurrency(group.incentive)}</td>
                          </tr>
                        ))
                      : (
                          <tr className="combined-breakdown-row combined-breakdown-shinjang">
                            <th>신장분사</th>
                            <td>{formatCount(currentSummary.treatmentTotals?.shinjang_spray?.count)}</td>
                            <td className="combined-summary-amount-cell">{formatCurrency(currentSummary.treatmentTotals?.shinjang_spray?.amount)}</td>
                            <td className="combined-summary-incentive-cell">{formatCurrency(currentSummary.treatmentTotals?.shinjang_spray?.incentive)}</td>
                          </tr>
                        )}
                    {isAdmin && (
                      <tr className="combined-breakdown-row combined-breakdown-manual">
                        <th>도수치료</th>
                        <td>{formatCount(currentSummary.treatmentTotals?.manual_therapy?.count)}</td>
                        <td className="combined-summary-amount-cell">{formatCurrency(currentSummary.treatmentTotals?.manual_therapy?.amount)}</td>
                        <td className="combined-summary-incentive-cell">{formatCurrency(currentSummary.treatmentTotals?.manual_therapy?.incentive)}</td>
                      </tr>
                    )}
                    <tr className="combined-therapist-total combined-summary-grand-total">
                      <th>전체 합계</th>
                      <td>{formatCount(currentSummary.total.count)}</td>
                      <td className="combined-summary-amount-cell">{formatCurrency(currentSummary.total.amount)}</td>
                      <td className="combined-summary-incentive-cell">{formatCurrency(currentSummary.total.incentive)}</td>
                    </tr>
                  </tbody>
                </table>
              </article>
            </>
          ) : (
            <div className="combined-stats-empty">
              {isLoading ? '전체 통계를 계산하고 있습니다.' : '표시할 치료사 통계가 없습니다.'}
            </div>
          )}
        </section>

        <aside className="combined-stats-side">
          <section className="combined-stats-recent" aria-label={`${recentPeriodLabel} 전체 결산 현황`}>
            <div className="combined-stats-recent-heading">
              <div>
                <h2>{recentPeriodLabel} 결산 현황</h2>
                <span>크라이오 반영 전체 통계</span>
              </div>
              <div className="combined-recent-controls">
                <div className="combined-recent-filter-tabs" role="tablist" aria-label="결산 현황 보기 방식">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={recentViewMode === 'total-only'}
                    className={`combined-recent-tab-btn ${recentViewMode === 'total-only' ? 'is-active' : ''}`}
                    onClick={() => setRecentViewMode('total-only')}
                  >
                    전체만 보기
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={recentViewMode === 'detail'}
                    className={`combined-recent-tab-btn ${recentViewMode === 'detail' ? 'is-active' : ''}`}
                    onClick={() => setRecentViewMode('detail')}
                  >
                    상세 보기
                  </button>
                </div>
                <input
                  type="text"
                  value={recentPeriodInput}
                  onChange={(event) => setRecentPeriodInput(event.target.value)}
                  placeholder="최근 6개월"
                  aria-label="전체 통계 최근 결산 기간"
                />
              </div>
            </div>
            <div className="combined-stats-recent-table-wrap">
              <table className={recentViewMode === 'total-only' ? 'combined-stats-recent-table--total-only' : undefined}>
                <colgroup>
                  <col className="combined-recent-col-month" />
                  <col className="combined-recent-col-count" />
                  <col className="combined-recent-col-amount" />
                  <col className="combined-recent-col-incentive" />
                </colgroup>
                <thead>
                  <tr>
                    <th>월</th>
                    <th>총건수</th>
                    <th>결산 금액</th>
                    <th>인센티브</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRows.map((summary) => (
                    <tr
                      key={summary.monthKey}
                      className={summary.monthKey === currentMonthKey ? 'is-current' : undefined}
                    >
                      <th>{summary.label}</th>
                      <td className="combined-recent-breakdown-cell">
                        <RecentMetricBreakdown
                          summary={summary}
                          metric="count"
                          includeManual={isAdmin}
                          totalOnly={recentViewMode === 'total-only'}
                        />
                      </td>
                      <td className="combined-recent-breakdown-cell">
                        <RecentMetricBreakdown
                          summary={summary}
                          metric="amount"
                          includeManual={isAdmin}
                          totalOnly={recentViewMode === 'total-only'}
                        />
                      </td>
                      <td className="combined-recent-breakdown-cell">
                        <RecentMetricBreakdown
                          summary={summary}
                          metric="incentive"
                          includeManual={isAdmin}
                          totalOnly={recentViewMode === 'total-only'}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

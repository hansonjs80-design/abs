import CombinedRecentTreatmentTable from '../components/shockwave/CombinedRecentTreatmentTable';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Printer, RefreshCw } from 'lucide-react';
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
import { buildCombinedPrescriptionDetails, buildCombinedRateTotals, getCombinedSummaryAnchorIndex } from '../lib/combinedPrescriptionDetails';
import ManualTherapySixMonthIonTreatment from '../components/shockwave/ManualTherapySixMonthIonTreatment';
import { setManualTherapyIonTreatment } from '../lib/manualTherapyIonTreatmentUtils';
import { printSettlementTable } from '../lib/printSettlementTable';
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

function buildTherapistTreatmentDetailSections(item, isAdmin = false) {
  const hasAnyActivity = Math.max(0, Number(item?.total?.count) || 0) > 0;
  if (!hasAnyActivity) return [];

  const sections = [];

  // 1. 충격파
  const shockwaveTotal = item?.treatments?.shockwave || { count: 0, amount: 0, incentive: 0 };
  if (Number(shockwaveTotal.count) > 0) {
    const parentRow = {
      ...shockwaveTotal,
      label: '충격파 7%',
      rates: [7],
      isParent: true,
    };
    const childRows = (item?.prescriptionGroups?.shockwave || [])
      .filter((row) => Number(row?.count) > 0)
      .map((row) => ({
        ...row,
        label: row.prescription,
        rates: [7],
        isChild: true,
      }));
    sections.push({
      key: 'shockwave',
      label: '충격파',
      value: shockwaveTotal,
      rows: [parentRow, ...childRows],
    });
  }

  // 2. 신장분사 (7%와 15%가 각각 상위 항목으로 나옴)
  const therapistShinjangMap = new Map(
    (Array.isArray(item?.shinjangIncentiveGroups) ? item.shinjangIncentiveGroups : [])
      .map((g) => [Number(g.rate), g])
  );
  const shinjangRates = isAdmin ? [7, 15] : [7];
  shinjangRates.forEach((rate) => {
    const rateSummary = therapistShinjangMap.get(rate);
    if (!rateSummary || Number(rateSummary.count) <= 0) return;

    const parentRow = {
      ...rateSummary,
      label: `신장분사 ${formatIncentiveRate(rate)}`,
      rates: [rate],
      isParent: true,
    };
    const childRows = (item?.prescriptionGroups?.shinjang_spray || [])
      .filter((row) => Number(row?.rate) === rate && Number(row?.count) > 0)
      .map((row) => ({
        ...row,
        label: row.prescription,
        rates: [rate],
        isChild: true,
      }));
    sections.push({
      key: `shinjang_spray_${rate}`,
      label: '신장분사',
      value: rateSummary,
      rows: [parentRow, ...childRows],
    });
  });

  // 3. 도수치료 (isAdmin일 때만)
  if (isAdmin) {
    const manualTotal = item?.treatments?.manual_therapy || { count: 0, amount: 0, incentive: 0 };
    if (Number(manualTotal.count) > 0) {
      const parentRow = {
        ...manualTotal,
        label: '도수치료 15%',
        rates: [15],
        isParent: true,
      };
      const childRows = (item?.prescriptionGroups?.manual_therapy || [])
        .filter((row) => Number(row?.count) > 0)
        .map((row) => ({
          ...row,
          label: row.prescription,
          rates: [15],
          isChild: true,
        }));
      sections.push({
        key: 'manual_therapy',
        label: '도수치료',
        value: manualTotal,
        rows: [parentRow, ...childRows],
      });
    }
  }

  return sections;
}

function buildTherapistTreatmentSections(item, isAdmin = false) {
  const hasAnyActivity = Math.max(0, Number(item?.total?.count) || 0) > 0;
  if (!hasAnyActivity) return [];

  return COMBINED_STATS_TREATMENTS.map((treatment) => {
    const value = item?.treatments?.[treatment.key] || { count: 0, amount: 0, incentive: 0 };
    if (treatment.key === 'shinjang_spray') {
      const therapistShinjangMap = new Map(
        (Array.isArray(item?.shinjangIncentiveGroups) ? item.shinjangIncentiveGroups : [])
          .map((g) => [Number(g.rate), g])
      );
      // 처방명 대신 인센율로 구분하고, 실적이 있는 행만 표시한다.
      const rows = (isAdmin ? [7, 15] : [7]).map((rate) => {
        const found = therapistShinjangMap.get(rate);
        if (found) {
          return { ...found, label: `신장분사 ${formatIncentiveRate(rate)}`, rates: [rate] };
        }
        return {
          rate,
          label: `신장분사 ${formatIncentiveRate(rate)}`,
          count: 0,
          amount: 0,
          incentive: 0,
          rates: [rate],
        };
      });

      return { ...treatment, value, rows };
    }

    const rows = [{
      ...value,
      label: treatment.key === 'shockwave' ? '충격파 7%' : '도수치료 15%',
      rates: item?.incentiveRates?.[treatment.key] || [],
    }];
    return { ...treatment, value, rows };
  }).map((section) => ({
    ...section,
    rows: section.rows.filter((row) => Number(row.count) > 0),
  })).filter((section) => section.rows.length > 0);
}

function getTherapistRateTotals(item, isAdmin = false) {
  const shockwave = item?.treatments?.shockwave || { count: 0, amount: 0, incentive: 0 };
  const shinjangGroups = Array.isArray(item?.shinjangIncentiveGroups) ? item.shinjangIncentiveGroups : [];
  const shinjang7 = shinjangGroups.find((g) => Number(g?.rate) === 7);
  const shinjang15 = shinjangGroups.find((g) => Number(g?.rate) === 15);
  const manual = (isAdmin ? item?.treatments?.manual_therapy : null) || { count: 0, amount: 0, incentive: 0 };

  const rate7Total = {
    count: (Number(shockwave.count) || 0) + (Number(shinjang7?.count) || 0),
    amount: (Number(shockwave.amount) || 0) + (Number(shinjang7?.amount) || 0),
    incentive: (Number(shockwave.incentive) || 0) + (Number(shinjang7?.incentive) || 0),
  };

  const rate15Total = {
    count: (isAdmin ? Number(shinjang15?.count) || 0 : 0) + (Number(manual.count) || 0),
    amount: (isAdmin ? Number(shinjang15?.amount) || 0 : 0) + (Number(manual.amount) || 0),
    incentive: (isAdmin ? Number(shinjang15?.incentive) || 0 : 0) + (Number(manual.incentive) || 0),
  };

  return { rate7Total, rate15Total };
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
    saveShockwaveSettings,
  } = useSchedule();
  const { user } = useAuth();
  const { addToast } = useToast();
  const isAdmin = isAdminUser(user);
  const [recentPeriodInput, setRecentPeriodInput] = useState('최근 6개월');
  const [recentTableVisibility, setRecentTableVisibility] = useState({ overall: true, shockwave: true, shinjang_spray: true, manual_therapy: true });
  const [recentViewMode, setRecentViewMode] = useState('total-only');
  const [recentTreatmentViewModes, setRecentTreatmentViewModes] = useState({});
  const hasVisibleRecentDetails = (recentTableVisibility.overall && recentViewMode === 'detail') ||
    COMBINED_STATS_TREATMENTS.some(({ key }) => recentTableVisibility[key] && (isAdmin || key !== 'manual_therapy') && recentTreatmentViewModes[key] === 'detail');
  const [activeTab, setActiveTab] = useState('therapist'); // 'therapist' | 'summary' | 'settlement'
  const [summaryViewMode, setSummaryViewMode] = useState('total');
  const [showIonTreatment, setShowIonTreatment] = useState(false);
  const [recentIonLayout, setRecentIonLayout] = useState('horizontal');
  const [showTherapistSummary, setShowTherapistSummary] = useState(false);
  const [layoutMode, setLayoutMode] = useState('horizontal'); // 'horizontal' | 'vertical'
  const [breakdownViewMode, setBreakdownViewMode] = useState('total');
  const showBreakdownIncentive = breakdownViewMode !== 'detail-no-incentive';
  const breakdownRef = useRef(null);
  const [therapistViewModes, setTherapistViewModes] = useState({});
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

  const renderBreakdownRateTotal = (summary, rate) => {
    const total = buildCombinedRateTotals(summary, isAdmin).find((row) => row.rate === rate);
    if (!total) return null;
    return (
      <tr className={`combined-therapist-subtotal ${rate === 7 ? 'combined-therapist-subtotal--start ' : ''}combined-incentive-rate-row--${rate}`}>
        <th>{rate}% 합계</th>
        <td>{formatCount(total.count)}</td>
        <td className="combined-summary-amount-cell">{formatCurrency(total.amount)}</td>
        {showBreakdownIncentive && <td className="combined-summary-incentive-cell">{formatCurrency(total.incentive)}</td>}
      </tr>
    );
  };

  const renderBreakdownDetails = (summary, treatment, rate) => {
    if (breakdownViewMode === 'total') return null;
    return buildCombinedPrescriptionDetails(summary, treatment, rate, isAdmin).map((row) => (
      <tr key={row.key} className="combined-treatment-child-row combined-breakdown-detail-row">
        <th scope="row">↳ {row.label}</th>
        <td>{formatCount(row.count)}</td>
        <td className="combined-summary-amount-cell">{formatCurrency(row.amount)}</td>
        {showBreakdownIncentive && <td className="combined-summary-incentive-cell">{formatCurrency(row.incentive)}</td>}
      </tr>
    ));
  };

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
  const handleSaveIonTreatment = useCallback(async (year, month, nextIonTreatment) => {
    const settingsToUpdate = settingsRef.current || shockwaveSettings || {};
    const nextSettings = {
      ...settingsToUpdate,
      monthly_settlement_settings: setManualTherapyIonTreatment(
        settingsToUpdate,
        year,
        month,
        nextIonTreatment
      ),
    };
    settingsRef.current = nextSettings;
    const ok = await saveShockwaveSettings(nextSettings);
    if (ok) await loadShockwaveSettings();
    if (!ok) settingsRef.current = shockwaveSettings;
    addToast(ok ? '이온치료 현황을 저장했습니다.' : '이온치료 현황 저장에 실패했습니다.', ok ? 'success' : 'error');
    return ok;
  }, [addToast, loadShockwaveSettings, saveShockwaveSettings, shockwaveSettings]);

  const renderIonTreatment = () => isAdmin && showIonTreatment ? (
    <div className="combined-ion-treatment">
      <ManualTherapySixMonthIonTreatment
        currentYear={currentYear}
        currentMonth={currentMonth}
        settings={shockwaveSettings}
        onSave={handleSaveIonTreatment}
      />
    </div>
  ) : null;

  const renderTherapistSummary = () => currentSummary ? (
    <article className="combined-therapist-card combined-therapist-summary-card" data-summary-view={summaryViewMode}>
      <table>
        <thead>
          <tr><th className="combined-therapist-name combined-summary-title-header" colSpan={summaryViewMode === 'detail' ? 4 : 3}>
            <div className="combined-therapist-name-content">
              <span>치료사별 합계</span>
              <span className="combined-therapist-header-count">{formatCount(currentSummary.total.count)}</span>
              <div className="combined-breakdown-actions">
                <div className="combined-therapist-view-tabs">
                  <button type="button" className={`combined-therapist-tab-btn ${summaryViewMode === 'total' ? 'is-active' : ''}`} aria-pressed={summaryViewMode === 'total'} onClick={() => setSummaryViewMode('total')}>전체보기</button>
                  <button type="button" className={`combined-therapist-tab-btn ${summaryViewMode === 'detail' ? 'is-active' : ''}`} aria-pressed={summaryViewMode === 'detail'} onClick={() => setSummaryViewMode('detail')}>상세보기</button>
                </div>
                <button type="button" className="combined-table-print-button" onClick={(event) => printSettlementTable(event.currentTarget.closest('article'), `${currentYear}년 ${currentMonth}월 치료사별 합계`)}><Printer size={16} />인쇄</button>
              </div>
            </div>
          </th></tr>
          <tr className="combined-summary-column-header-row">
            {summaryViewMode === 'detail' ? <th>항목</th> : <th className="combined-summary-empty-header" aria-label="치료사"></th>}
            {summaryViewMode === 'detail' && <th>건수</th>}
            <th>총 결산 금액 합계</th><th>총 인센티브 합계</th>
          </tr>
        </thead>
        <tbody>
          {currentSummary.therapists.map((item, index) => (
            <Fragment key={`summary-${item.therapist.key || item.therapist.id || item.therapist.name}`}>
              <tr className={`combined-summary-parent-row combined-summary-tone-${index % 5}`}>
                <th className={`combined-summary-therapist-cell combined-summary-tone-${index % 5}`}>{item.therapist.displayName || item.therapist.name} 치료사</th>
                {summaryViewMode === 'detail' && <td>{formatCount(item.total.count)}</td>}
                <td className="combined-summary-amount-cell">{formatCurrency(item.total.amount)}</td>
                <td className="combined-summary-incentive-cell">{formatCurrency(item.total.incentive)}</td>
              </tr>
              {summaryViewMode === 'detail' && buildTherapistTreatmentSections(item, isAdmin).flatMap((section) => section.rows).map((row) => (
                <tr className="combined-breakdown-detail-row" key={row.label}>
                  <th scope="row">↳ {row.label}</th><td>{formatCount(row.count)}</td><td className="combined-summary-amount-cell">{formatCurrency(row.amount)}</td><td className="combined-summary-incentive-cell">{formatCurrency(row.incentive)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
          <tr className="combined-therapist-total combined-summary-grand-total">
            <th>전체 합계</th>
            {summaryViewMode === 'detail' && <td>{formatCount(currentSummary.total.count)}</td>}
            <td className="combined-summary-amount-cell">{formatCurrency(currentSummary.total.amount)}</td>
            <td className="combined-summary-incentive-cell">{formatCurrency(currentSummary.total.incentive)}</td>
          </tr>
        </tbody>
      </table>
    </article>
  ) : null;
  const recentRows = useMemo(() => [...monthSummaries].reverse(), [monthSummaries]);
  const visibleRecentTreatments = COMBINED_STATS_TREATMENTS.filter(({ key }) => recentTableVisibility[key] && (isAdmin || key !== 'manual_therapy'));
  const treatmentsBeforeIon = recentIonLayout === 'vertical'
    ? visibleRecentTreatments.length
    : recentTableVisibility.overall ? 1 : 2;
  const renderRecentTreatmentTable = ({ key, label }) => (
    <CombinedRecentTreatmentTable key={key} treatment={key} label={label} periodLabel={recentPeriodLabel} summaries={recentRows} currentMonthKey={currentMonthKey} viewMode={recentTreatmentViewModes[key] || 'total-only'} onViewModeChange={(mode) => setRecentTreatmentViewModes((current) => ({ ...current, [key]: mode }))} />
  );

  return (
    <div className="combined-stats-page animate-fade-in">
      {isLoading && <div className="top-loading-bar" />}
      <header className="combined-stats-header">
        <div>
          <h1 data-print-suffix={`(${isAdmin ? '충격파 · 신장분사 · 도수치료의 크라이오 차감 적용 결산 입니다.' : '신장분사 치료의 크라이오 차감 적용 결산 입니다.'})`}>
            {currentYear}년 {String(currentMonth).padStart(2, '0')}월 {activeTab === 'stats' ? '전체 통계' : '전체 결산'}
          </h1>
          <p>
            {isAdmin
              ? '충격파 · 신장분사 · 도수치료의 크라이오 차감 적용 결산 입니다.'
              : '신장분사 치료의 크라이오 차감 적용 결산 입니다.'}
          </p>
          <div className="combined-stats-nav-bar">
            <div className="combined-stats-nav-tabs" role="tablist" aria-label="전체 통계 탭 메뉴">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'therapist'}
                className={`combined-stats-nav-tab ${activeTab === 'therapist' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('therapist')}
              >
                치료사 통계
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'summary'}
                className={`combined-stats-nav-tab ${activeTab === 'summary' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('summary')}
              >
                전체 합계
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'settlement'}
                className={`combined-stats-nav-tab ${activeTab === 'settlement' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('settlement')}
              >
                전체 결산
              </button>
            </div>
            {activeTab === 'therapist' && (
              <div className="combined-stats-layout-tabs" role="tablist" aria-label="레이아웃 보기 방식">
                <button
                  type="button"
                  role="tab"
                  aria-selected={layoutMode === 'horizontal'}
                  className={`combined-stats-layout-tab ${layoutMode === 'horizontal' ? 'is-active' : ''}`}
                  onClick={() => setLayoutMode('horizontal')}
                >
                  가로보기
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={layoutMode === 'vertical'}
                  className={`combined-stats-layout-tab ${layoutMode === 'vertical' ? 'is-active' : ''}`}
                  onClick={() => setLayoutMode('vertical')}
                >
                  세로보기
                </button>
              </div>
            )}
            {isAdmin && activeTab === 'summary' && (
              <label className="combined-therapist-summary-toggle">
                <input type="checkbox" checked={showIonTreatment} onChange={(event) => setShowIonTreatment(event.target.checked)} />
                이온치료현황
              </label>
            )}
            {activeTab === 'therapist' && (
              <label className="combined-therapist-summary-toggle">
                <input type="checkbox" checked={showTherapistSummary} onChange={(event) => setShowTherapistSummary(event.target.checked)} />
                치료사별 합계 테이블 보기
              </label>
            )}
          </div>
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

      {activeTab === 'therapist' && (() => {
        const renderTherapistCard = (item, index) => {
          const therapistKey = item.therapist.key || item.therapist.id || item.therapist.name;
          const viewMode = therapistViewModes[therapistKey] || 'total-only';
          const visibleTreatments = viewMode === 'detail'
            ? buildTherapistTreatmentDetailSections(item, isAdmin)
            : buildTherapistTreatmentSections(item, isAdmin);
          const { rate7Total, rate15Total } = getTherapistRateTotals(item, isAdmin);
          return (
            <article
              key={therapistKey}
              className={`combined-therapist-card combined-tone-${index % 5}`}
            >
              <table>
                <colgroup>
                  <col className="combined-current-col-type" />
                  <col className="combined-current-col-count" />
                  <col className="combined-current-col-amount" />
                  <col className="combined-current-col-incentive" />
                </colgroup>
                <thead>
                  <tr>
                    <th className="combined-therapist-name" colSpan={4}>
                      <div className="combined-therapist-name-content">
                        <div className="combined-therapist-title-wrap">
                          <span>{item.therapist.displayName || item.therapist.name} 치료사</span>
                          <div className="combined-therapist-view-tabs" role="tablist" aria-label="치료사 통계 보기 방식">
                            <button
                              type="button"
                              role="tab"
                              aria-selected={viewMode === 'total-only'}
                              className={`combined-therapist-tab-btn ${viewMode === 'total-only' ? 'is-active' : ''}`}
                              onClick={() => setTherapistViewModes((prev) => ({ ...prev, [therapistKey]: 'total-only' }))}
                            >
                              전체 보기
                            </button>
                            <button
                              type="button"
                              role="tab"
                              aria-selected={viewMode === 'detail'}
                              className={`combined-therapist-tab-btn ${viewMode === 'detail' ? 'is-active' : ''}`}
                              onClick={() => setTherapistViewModes((prev) => ({ ...prev, [therapistKey]: 'detail' }))}
                            >
                              상세 보기
                            </button>
                          </div>
                        </div>
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
                      <th>총 결산 금액</th>
                      <th>총 인센티브</th>
                    </tr>
                  )}
                </thead>
                {visibleTreatments.length > 0 && (
                  <tbody>
                    {visibleTreatments.flatMap((treatment) => (
                      treatment.rows.map((row, rowIndex) => {
                        const rowKey = row.isParent
                          ? `${treatment.key}-parent-${row.label}`
                          : row.prescription
                            ? `${treatment.key}-${row.prescription}`
                            : `${treatment.key}-${row.rates?.join('-') || 'total'}`;
                        const rowLabel = row.label || row.prescription;
                        const incentiveRate = row.rates?.length === 1 ? Number(row.rates[0]) : null;
                        const incentiveRateRowClass = incentiveRate === 7
                          ? 'combined-incentive-rate-row--7'
                          : incentiveRate === 15
                            ? 'combined-incentive-rate-row--15'
                            : '';
                        const hierarchyClass = row.isParent
                          ? 'combined-treatment-parent-row'
                          : row.isChild
                            ? 'combined-treatment-child-row'
                            : '';
                        return (
                          <tr
                            key={rowKey}
                            className={[
                              rowIndex === 0 ? 'combined-treatment-group-start' : '',
                              incentiveRateRowClass,
                              hierarchyClass,
                            ].filter(Boolean).join(' ')}
                          >
                            {rowLabel ? (
                              <th>{rowLabel}</th>
                            ) : (
                              rowIndex === 0 && (
                                <th rowSpan={treatment.rows.length}>{treatment.label}</th>
                              )
                            )}
                            <td className="combined-therapist-count-cell">{formatCount(row.count)}</td>
                            <td className="combined-therapist-amount-cell">{formatCurrency(row.amount)}</td>
                            <td className="combined-therapist-incentive-cell">{formatCurrency(row.incentive)}</td>
                          </tr>
                        );
                      })
                    ))}
                    {Number(rate7Total.count) > 0 && (
                      <tr className="combined-therapist-subtotal combined-therapist-subtotal--start combined-incentive-rate-row--7">
                        <th>7% 합계</th>
                        <td className="combined-therapist-count-cell">{formatCount(rate7Total.count)}</td>
                        <td className="combined-therapist-amount-cell">{formatCurrency(rate7Total.amount)}</td>
                        <td className="combined-therapist-incentive-cell">{formatCurrency(rate7Total.incentive)}</td>
                      </tr>
                    )}
                    {isAdmin && Number(rate15Total.count) > 0 && (
                      <tr className={`combined-therapist-subtotal ${Number(rate7Total.count) <= 0 ? 'combined-therapist-subtotal--start ' : ''}combined-incentive-rate-row--15`}>
                        <th>15% 합계</th>
                        <td className="combined-therapist-count-cell">{formatCount(rate15Total.count)}</td>
                        <td className="combined-therapist-amount-cell">{formatCurrency(rate15Total.amount)}</td>
                        <td className="combined-therapist-incentive-cell">{formatCurrency(rate15Total.incentive)}</td>
                      </tr>
                    )}
                    <tr className="combined-therapist-total">
                      <th>합계</th>
                      <td className="combined-therapist-count-cell">{formatCount(item.total.count)}</td>
                      <td className="combined-therapist-amount-cell">{formatCurrency(item.total.amount)}</td>
                      <td className="combined-therapist-incentive-cell">{formatCurrency(item.total.incentive)}</td>
                    </tr>
                  </tbody>
                )}
              </table>
            </article>
          );
        };

        const therapists = currentSummary?.therapists || [];
        const summaryAnchorIndex = getCombinedSummaryAnchorIndex(therapists, layoutMode);
        const renderTherapistColumn = (item, index, includeSummary = true) => (
          <div className="combined-therapist-column" key={item.therapist.key || item.therapist.id || item.therapist.name}>
            {renderTherapistCard(item, index)}
            {includeSummary && showTherapistSummary && index === summaryAnchorIndex && renderTherapistSummary()}
          </div>
        );

        return (
          <div className={`combined-stats-dashboard combined-stats-dashboard--stats combined-stats-dashboard--${layoutMode}`}>
            {therapists.length > 0 ? (
              layoutMode === 'vertical' ? (
                <div className="combined-vertical-two-col">
                  <div className="combined-vertical-left">
                    {renderTherapistColumn(therapists[0], 0)}
                  </div>
                  {therapists.length > 1 && (
                    <div className="combined-vertical-right">
                      {therapists.slice(1).map((item, idx) => renderTherapistColumn(item, idx + 1))}
                    </div>
                  )}
                </div>
              ) : (
                <section className="combined-stats-current" aria-label={`${currentMonth}월 치료사별 전체 통계`}>
                  {therapists.map((item, index) => renderTherapistColumn(item, index, false))}
                  {showTherapistSummary && (
                    <div className="combined-therapist-column combined-therapist-summary-column">
                      {renderTherapistSummary()}
                    </div>
                  )}
                </section>
              )
            ) : (
              <div className="combined-stats-empty">
                {isLoading ? '전체 통계를 계산하고 있습니다.' : '표시할 치료사 통계가 없습니다.'}
              </div>
            )}
          </div>
        );
      })()}

      {activeTab === 'summary' && (
        <div className="combined-stats-dashboard combined-stats-dashboard--summary">
          {currentSummary?.therapists?.length > 0 ? (
            <div className="combined-stats-summary-container" data-print-title={`${currentYear}년 ${currentMonth}월 전체 통계 합계`}>
              <div className="combined-summary-stack">
                {renderTherapistSummary()}
              </div>

              <article
                ref={breakdownRef}
                className="combined-therapist-card combined-treatment-breakdown-card"
                data-breakdown-view={breakdownViewMode}
                aria-label={`${currentMonth}월 항목별 결산 내역`}
              >
                <table data-breakdown-view={breakdownViewMode}>
                  <colgroup>
                    <col className="combined-breakdown-col-label" />
                    <col className="combined-breakdown-col-count" />
                    <col className="combined-breakdown-col-amount" />
                    {showBreakdownIncentive && <col className="combined-breakdown-col-incentive" />}
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="combined-therapist-name combined-summary-title-header" colSpan={showBreakdownIncentive ? 4 : 3}>
                        <div className="combined-therapist-name-content">
                          <span>항목별 결산 내역</span>
                          <div className="combined-breakdown-actions">
                            <div className="combined-therapist-view-tabs" role="group" aria-label="항목별 결산 보기">
                              <button type="button" className={`combined-therapist-tab-btn ${breakdownViewMode === 'total' ? 'is-active' : ''}`} aria-pressed={breakdownViewMode === 'total'} onClick={() => setBreakdownViewMode('total')}>전체보기</button>
                              <button type="button" className={`combined-therapist-tab-btn ${breakdownViewMode === 'detail' ? 'is-active' : ''}`} aria-pressed={breakdownViewMode === 'detail'} onClick={() => setBreakdownViewMode('detail')}>상세보기</button>
                              <button type="button" className={`combined-therapist-tab-btn ${breakdownViewMode === 'detail-no-incentive' ? 'is-active' : ''}`} aria-pressed={breakdownViewMode === 'detail-no-incentive'} onClick={() => setBreakdownViewMode('detail-no-incentive')}>상세보기2</button>
                            </div>
                            <button type="button" className="combined-breakdown-print" aria-label="항목별 결산 내역만 인쇄" onClick={() => printSettlementTable(breakdownRef.current, `${currentYear}년 ${currentMonth}월 항목별 결산 내역`)}><Printer size={16} />인쇄</button>
                          </div>
                        </div>
                      </th>
                    </tr>
                    <tr className="combined-summary-column-header-row">
                      <th className="combined-summary-empty-header" aria-label="항목">항목</th>
                      <th>건수</th>
                      <th>결산 금액</th>
                      {showBreakdownIncentive && <th>인센티브</th>}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="combined-breakdown-row combined-breakdown-shockwave combined-incentive-rate-row--7">
                      <th>충격파 7%</th>
                      <td>{formatCount(currentSummary.treatmentTotals?.shockwave?.count)}</td>
                      <td className="combined-summary-amount-cell">{formatCurrency(currentSummary.treatmentTotals?.shockwave?.amount)}</td>
                      {showBreakdownIncentive && <td className="combined-summary-incentive-cell">{formatCurrency(currentSummary.treatmentTotals?.shockwave?.incentive)}</td>}
                    </tr>
                    {renderBreakdownDetails(currentSummary, 'shockwave')}
                    {(Array.isArray(currentSummary.shinjangIncentiveGroups) && currentSummary.shinjangIncentiveGroups.length > 0)
                      ? currentSummary.shinjangIncentiveGroups.map((group) => (
                          <Fragment key={`breakdown-shinjang-${group.rate}`}>
                          <tr
                            className={`combined-breakdown-row combined-breakdown-shinjang${Number(group.rate) === 7 ? ' combined-incentive-rate-row--7' : Number(group.rate) === 15 ? ' combined-incentive-rate-row--15' : ''}`}
                          >
                            <th>신장분사 {formatIncentiveRate(group.rate)}</th>
                            <td>{formatCount(group.count)}</td>
                            <td className="combined-summary-amount-cell">{formatCurrency(group.amount)}</td>
                            {showBreakdownIncentive && <td className="combined-summary-incentive-cell">{formatCurrency(group.incentive)}</td>}
                          </tr>
                          {renderBreakdownDetails(currentSummary, 'shinjang_spray', group.rate)}
                          </Fragment>
                        ))
                      : (
                          <tr className="combined-breakdown-row combined-breakdown-shinjang">
                            <th>신장분사</th>
                            <td>{formatCount(currentSummary.treatmentTotals?.shinjang_spray?.count)}</td>
                            <td className="combined-summary-amount-cell">{formatCurrency(currentSummary.treatmentTotals?.shinjang_spray?.amount)}</td>
                            {showBreakdownIncentive && <td className="combined-summary-incentive-cell">{formatCurrency(currentSummary.treatmentTotals?.shinjang_spray?.incentive)}</td>}
                          </tr>
                        )}
                    {isAdmin && (
                      <tr className="combined-breakdown-row combined-breakdown-manual combined-incentive-rate-row--15">
                        <th>도수치료 15%</th>
                        <td>{formatCount(currentSummary.treatmentTotals?.manual_therapy?.count)}</td>
                        <td className="combined-summary-amount-cell">{formatCurrency(currentSummary.treatmentTotals?.manual_therapy?.amount)}</td>
                        {showBreakdownIncentive && <td className="combined-summary-incentive-cell">{formatCurrency(currentSummary.treatmentTotals?.manual_therapy?.incentive)}</td>}
                      </tr>
                    )}
                    {isAdmin && renderBreakdownDetails(currentSummary, 'manual_therapy')}
                    {renderBreakdownRateTotal(currentSummary, 7)}
                    {renderBreakdownRateTotal(currentSummary, 15)}
                    <tr className="combined-therapist-total combined-summary-grand-total">
                      <th>전체 합계</th>
                      <td>{formatCount(currentSummary.total.count)}</td>
                      <td className="combined-summary-amount-cell">{formatCurrency(currentSummary.total.amount)}</td>
                      {showBreakdownIncentive && <td className="combined-summary-incentive-cell">{formatCurrency(currentSummary.total.incentive)}</td>}
                    </tr>
                  </tbody>
                </table>
              </article>
              {renderIonTreatment()}
            </div>
          ) : (
            <div className="combined-stats-empty">
              {isLoading ? '전체 합계를 계산하고 있습니다.' : '표시할 합계 통계가 없습니다.'}
            </div>
          )}
        </div>
      )}

      {activeTab === 'settlement' && (
        <>
        <div className="combined-recent-visibility-controls">
          {[{ key: 'overall', label: '전체결산' }, ...COMBINED_STATS_TREATMENTS].filter(({ key }) => isAdmin || key !== 'manual_therapy').map(({ key, label }) => (
            <label className="settlement-recent-visibility-toggle" key={key}><input type="checkbox" checked={recentTableVisibility[key]} onChange={(event) => setRecentTableVisibility((current) => ({ ...current, [key]: event.target.checked }))} />{label} 현황 보기</label>
          ))}
          {isAdmin && <div className="combined-recent-ion-controls">
            <label className="settlement-recent-visibility-toggle"><input type="checkbox" checked={showIonTreatment} onChange={(event) => setShowIonTreatment(event.target.checked)} />이온치료 현황 보기</label>
            {showIonTreatment && <div className="combined-recent-ion-layout-tabs" role="group" aria-label="이온치료 현황 배치">
              <button type="button" className={recentIonLayout === 'horizontal' ? 'is-active' : ''} aria-pressed={recentIonLayout === 'horizontal'} onClick={() => setRecentIonLayout('horizontal')}>가로보기</button>
              <button type="button" className={recentIonLayout === 'vertical' ? 'is-active' : ''} aria-pressed={recentIonLayout === 'vertical'} onClick={() => setRecentIonLayout('vertical')}>세로보기</button>
            </div>}
          </div>}
        </div>
        <div className="combined-recent-scroll" role="region" aria-label="최근 결산 표 가로 스크롤" tabIndex={0}>
        <div className="combined-stats-dashboard combined-stats-dashboard--settlement" data-recent-view={hasVisibleRecentDetails ? 'detail' : 'total-only'} data-recent-layout={isAdmin && showIonTreatment ? recentIonLayout : 'default'} data-print-title={`${recentPeriodLabel} 전체결산`}>
          {recentTableVisibility.overall && <section className="combined-stats-recent combined-settlement-recent-main" aria-label={`${recentPeriodLabel} 전체 결산 현황`}>
            <div className="combined-stats-recent-heading">
              <div>
                <h2>{recentPeriodLabel} 전체결산</h2>
                <span>크라이오 차감 적용 전체 통계</span>
              </div>
              <div className="combined-recent-controls">
                <button type="button" className="combined-table-print-button" onClick={(event) => printSettlementTable(event.currentTarget.closest('section'), `${recentPeriodLabel} 전체결산`)}><Printer size={16} />인쇄</button>
                <div className="combined-recent-filter-tabs" role="tablist" aria-label="결산 현황 보기 방식">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={recentViewMode === 'total-only'}
                    className={`combined-recent-tab-btn ${recentViewMode === 'total-only' ? 'is-active' : ''}`}
                    onClick={() => setRecentViewMode('total-only')}
                  >
                    전체 보기
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
          </section>}
          {visibleRecentTreatments.slice(0, treatmentsBeforeIon).map(renderRecentTreatmentTable)}
          {renderIonTreatment()}
          {visibleRecentTreatments.slice(treatmentsBeforeIon).map(renderRecentTreatmentTable)}
        </div>
        </div>
        </>
      )}
    </div>
  );
}

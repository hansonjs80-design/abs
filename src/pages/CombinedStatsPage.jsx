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
  buildCombinedStatsRecentTotal,
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
import { loadStatsMonthsWithConcurrency } from '../lib/statsSectionLoadingUtils';
import '../styles/combined_stats.css';

const LOG_FIELDS = 'id,date,patient_name,chart_number,visit_count,body_part,therapist_name,prescription,prescription_count,source,scheduler_cell_key,created_at';

function formatCount(value) {
  return `${Math.max(0, Number(value) || 0).toLocaleString('ko-KR')}건`;
}

function formatCurrency(value) {
  return `${Math.max(0, Number(value) || 0).toLocaleString('ko-KR')}원`;
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

      const summaries = await loadStatsMonthsWithConcurrency(monthTargets, async (target) => {
        const [
          memos,
          monthlyShockwaveTherapists,
          monthlyManualTherapists,
          monthlyShinjangTherapists,
        ] = await Promise.all([
          loadScheduleMemosForStatsMonth({
            year: target.year,
            month: target.month,
            settings,
          }),
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
            scheduleAuthoritative: true,
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
      }, 2);
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
  const recentTotal = useMemo(
    () => buildCombinedStatsRecentTotal(monthSummaries),
    [monthSummaries]
  );

  return (
    <div className="combined-stats-page animate-fade-in">
      {isLoading && <div className="top-loading-bar" />}
      <header className="combined-stats-header">
        <div>
          <h1>{currentYear}년 {String(currentMonth).padStart(2, '0')}월 전체 통계</h1>
          <p>충격파 · 신장분사 · 도수치료의 크라이오 반영 결산입니다.</p>
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
          {currentSummary?.therapists?.length > 0 ? currentSummary.therapists.map((item, index) => (
            <article
              key={item.therapist.key || item.therapist.id || item.therapist.name}
              className={`combined-therapist-card combined-tone-${index % 5}`}
            >
              <table>
                <thead>
                  <tr>
                    <th className="combined-therapist-name" colSpan={4}>
                      {item.therapist.displayName || item.therapist.name} 치료사
                    </th>
                  </tr>
                  <tr>
                    <th>구분</th>
                    <th>총건수</th>
                    <th>처방별 총 결산 금액</th>
                    <th>처방별 총 인센티브</th>
                  </tr>
                </thead>
                <tbody>
                  {COMBINED_STATS_TREATMENTS.map((treatment) => {
                    const value = item.treatments[treatment.key];
                    return (
                      <tr key={treatment.key}>
                        <th>{treatment.label}</th>
                        <td>{formatCount(value.count)}</td>
                        <td>{formatCurrency(value.amount)}</td>
                        <td>{formatCurrency(value.incentive)}</td>
                      </tr>
                    );
                  })}
                  <tr className="combined-therapist-total">
                    <th>총액</th>
                    <td>{formatCount(item.total.count)}</td>
                    <td>{formatCurrency(item.total.amount)}</td>
                    <td>{formatCurrency(item.total.incentive)}</td>
                  </tr>
                </tbody>
              </table>
            </article>
          )) : (
            <div className="combined-stats-empty">
              {isLoading ? '전체 통계를 계산하고 있습니다.' : '표시할 치료사 통계가 없습니다.'}
            </div>
          )}
        </section>

        <aside className="combined-stats-recent" aria-label={`${recentPeriodLabel} 전체 결산 현황`}>
          <div className="combined-stats-recent-heading">
            <div>
              <h2>{recentPeriodLabel} 결산 현황</h2>
              <span>크라이오 반영 전체 통계</span>
            </div>
            <input
              type="text"
              value={recentPeriodInput}
              onChange={(event) => setRecentPeriodInput(event.target.value)}
              placeholder="최근 6개월"
              aria-label="전체 통계 최근 결산 기간"
            />
          </div>
          <div className="combined-stats-recent-table-wrap">
            <table>
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
                    <td>{formatCount(summary.totalCount)}</td>
                    <td>{formatCurrency(summary.amount)}</td>
                    <td>{formatCurrency(summary.incentive)}</td>
                  </tr>
                ))}
                <tr className="combined-recent-total">
                  <th>{recentPeriodLabel} 합계</th>
                  <td>{formatCount(recentTotal.count)}</td>
                  <td>{formatCurrency(recentTotal.amount)}</td>
                  <td>{formatCurrency(recentTotal.incentive)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {!isAdmin && (
            <p className="combined-stats-permission-note">
              일반 계정에서는 신장분사 인센티브 15% 처방이 결산에서 제외됩니다.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

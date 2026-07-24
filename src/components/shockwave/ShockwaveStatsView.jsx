import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { syncTodayShockwaveScheduleToStats, syncMonthShockwaveScheduleToStats } from '../../lib/shockwaveSyncUtils';
import { useToast } from '../common/Toast';
import { useSchedule } from '../../contexts/ScheduleContext';
import { useAuth } from '../../contexts/AuthContext';
import { buildDisplayTherapists } from '../../lib/therapistDisplayUtils';
import { GridSkeleton, SettlementSkeleton } from '../common/LoadingSkeleton';
import '../../styles/shockwave_stats.css';
import '../../styles/shockwave_settlement_vertical.css';
import '../../styles/shockwave_settlement_horizontal2.css';
import ShockwaveDataGrid from './ShockwaveDataGrid';
import ShockwaveSettlementView from './ShockwaveSettlementView';
import ShockwaveNewPatientsView from './ShockwaveNewPatientsView';
import SettlementSettingsPanel from './SettlementSettingsPanel';
import { getEffectiveSettlementSettings } from '../../lib/settlementSettings';
import { formatRecentPeriodLabel, parseRecentPeriodMonths } from '../../lib/recentPeriodUtils';
import { isAdminUser } from '../../lib/authPermissions';
import { TREATMENT_COMPLETE_BG } from '../../lib/schedulerUtils';
import {
  buildScheduleMemoSignature,
  getRecentScheduleMonthTargets,
  loadScheduleMemosForStatsMonth,
  loadStatsMonthlyTherapists,
} from '../../lib/statsScheduleSourceUtils';
import {
  normalizePrescriptionKey,
  toStatsPrescriptionCount,
} from '../../lib/shockwaveStatsCountUtils';

class ShockwaveStatsErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('Shockwave stats render failed:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="sw-stats-empty">
          치료 내역 통계를 표시하는 중 오류가 발생했습니다.
          <div className="empty-subtext">페이지를 새로고침한 뒤 다시 확인해 주세요.</div>
        </div>
      );
    }
    return this.props.children;
  }
}

function buildSourceLogId(row, index, prefix) {
  const cellKey = String(row?.scheduler_cell_key || '').trim();
  if (cellKey) return `${prefix}:${cellKey}`;
  return [
    prefix,
    row?.date || 'no-date',
    row?.therapist_name || 'no-therapist',
    row?.chart_number || 'no-chart',
    row?.patient_name || 'no-name',
    row?.visit_count || 'no-visit',
    index,
  ].join(':');
}

function normalizeScheduleSourceLogs(rows, prefix) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => ({
    ...row,
    id: row?.id || buildSourceLogId(row, index, prefix),
    source: row?.source || 'scheduler',
    created_at: row?.created_at || `${row?.date || '1970-01-01'}T00:00:00.000Z`,
  }));
}

function getStatsMonthPrefix(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function replaceLogsForStatsMonth(existingLogs, year, month, nextMonthLogs) {
  const monthPrefix = getStatsMonthPrefix(year, month);
  return [
    ...(Array.isArray(existingLogs) ? existingLogs : []).filter(
      (log) => !String(log?.date || '').startsWith(monthPrefix)
    ),
    ...(Array.isArray(nextMonthLogs) ? nextMonthLogs : []),
  ];
}

const DEFAULT_SETTINGS_ID = '00000000-0000-0000-0000-000000000000';

export default function ShockwaveStatsView({
  currentYear,
  currentMonth,
  memos,
  therapists,
  onReloadMemos,
  monthlyTherapistsProp,
  monthlyTherapistsReady = false,
  memosLoadedKey = '',
  isScheduleLoading = false,
}) {
  const { addToast } = useToast();
  const { user } = useAuth();
  const canManageStatsSettings = isAdminUser(user);
  const { shockwaveSettings, loadShockwaveSettings, saveShockwaveSettings } = useSchedule();
  const monthlyTherapists = useMemo(
    () => (monthlyTherapistsReady && Array.isArray(monthlyTherapistsProp) ? monthlyTherapistsProp : []),
    [monthlyTherapistsReady, monthlyTherapistsProp]
  );
  const [logs, setLogs] = useState([]);
  const [recentLogs, setRecentLogs] = useState([]);
  const [isLogsLoading, setIsLogsLoading] = useState(false);
  const [currentLogsReadyKey, setCurrentLogsReadyKey] = useState('');
  const [isCurrentSyncing, setIsCurrentSyncing] = useState(false);
  const [isRecentLogsLoading, setIsRecentLogsLoading] = useState(false);
  const [settingsReady, setSettingsReady] = useState(() => (
    Boolean(shockwaveSettings?.id) && shockwaveSettings.id !== DEFAULT_SETTINGS_ID
  ));
  const isLoading = isLogsLoading || isScheduleLoading || isCurrentSyncing || isRecentLogsLoading;
  const [extraDraftRows, setExtraDraftRows] = useState(0);
  const [activeSection, setActiveSection] = useState('grid');
  const [recentPeriodInput, setRecentPeriodInput] = useState('최근 6개월');
  const [recentLogsRefreshKey, setRecentLogsRefreshKey] = useState(0);
  const lastAutoSyncKeyRef = useRef(null);
  const recentAutoSyncKeyRef = useRef(null);
  const currentAutoSyncRunRef = useRef({ key: '', promise: null });
  const recentAutoSyncRunRef = useRef({ key: '', promise: null });
  const settingsLoadPromiseRef = useRef(null);
  const logsLoadedKeyRef = useRef('');
  const fetchIdRef = useRef(0);
  const safeLogs = useMemo(() => (Array.isArray(logs) ? logs.filter(Boolean) : []), [logs]);
  const markCurrentLogsReady = useCallback(() => {
    const monthKey = `${currentYear}-${currentMonth}`;
    logsLoadedKeyRef.current = monthKey;
    setCurrentLogsReadyKey(monthKey);
  }, [currentMonth, currentYear]);

  useEffect(() => {
    if (!canManageStatsSettings && activeSection === 'settings') {
      setActiveSection('grid');
    }
  }, [activeSection, canManageStatsSettings]);
  const safeTherapists = useMemo(() => (Array.isArray(therapists) ? therapists.filter(Boolean) : []), [therapists]);
  const displayBaseTherapists = useMemo(
    () => safeTherapists,
    [safeTherapists]
  );
  const effectiveSettlementSettings = useMemo(
    () => getEffectiveSettlementSettings(shockwaveSettings, currentYear, currentMonth, 'shockwave'),
    [shockwaveSettings, currentYear, currentMonth]
  );
  const settlementPrescriptions = useMemo(
    () => {
      const hiddenSet = new Set(effectiveSettlementSettings.hidden_prescriptions || []);
      return (effectiveSettlementSettings.prescriptions || []).filter((prescription) => (
        prescription && !hiddenSet.has(prescription)
      ));
    },
    [effectiveSettlementSettings]
  );
  const settlementPrices = useMemo(
    () => effectiveSettlementSettings.prescription_prices,
    [effectiveSettlementSettings]
  );
  const incentivePercentage = useMemo(
    () => effectiveSettlementSettings.incentive_percentage,
    [effectiveSettlementSettings]
  );
  const recentPeriodMonths = useMemo(
    () => parseRecentPeriodMonths(recentPeriodInput, 6),
    [recentPeriodInput]
  );
  const recentPeriodLabel = useMemo(
    () => formatRecentPeriodLabel(recentPeriodMonths),
    [recentPeriodMonths]
  );
  const currentScheduleMonthKey = useMemo(
    () => `${currentYear}-${currentMonth}`,
    [currentYear, currentMonth]
  );
  const currentLogsReady = currentLogsReadyKey === currentScheduleMonthKey;
  const isCurrentScheduleReady = settingsReady && memosLoadedKey === currentScheduleMonthKey && !isScheduleLoading;
  const currentMemosSyncSignature = useMemo(
    () => buildScheduleMemoSignature(memos),
    [memos]
  );
  const gridPrescriptionKeys = useMemo(() => {
    const keys = new Set();

    if (currentLogsReady) {
      safeLogs.forEach((log) => {
        const key = normalizePrescriptionKey(log?.prescription);
        if (key) keys.add(key);
      });
    }

    if (keys.size === 0) {
      Object.values(memos || {}).forEach((cell) => {
        if (String(cell?.bg_color || '').toLowerCase() !== TREATMENT_COMPLETE_BG.toLowerCase()) return;
        const key = normalizePrescriptionKey(cell?.prescription);
        if (key) keys.add(key);
      });
    }

    return keys;
  }, [currentLogsReady, memos, safeLogs]);
  const gridPrescriptions = useMemo(() => {
    if (gridPrescriptionKeys.size === 0) return settlementPrescriptions;
    const filtered = settlementPrescriptions.filter((prescription) => (
      gridPrescriptionKeys.has(normalizePrescriptionKey(prescription))
    ));
    return filtered.length > 0 ? filtered : settlementPrescriptions;
  }, [gridPrescriptionKeys, settlementPrescriptions]);
  const scheduleLayoutSettingsKey = useMemo(
    () => JSON.stringify({
      start_time: shockwaveSettings?.start_time,
      end_time: shockwaveSettings?.end_time,
      interval_minutes: shockwaveSettings?.interval_minutes,
      time_label_interval_minutes: shockwaveSettings?.time_label_interval_minutes,
      day_overrides: shockwaveSettings?.day_overrides,
      date_overrides: shockwaveSettings?.date_overrides,
    }),
    [shockwaveSettings]
  );

  // Therapist filter state (lifted from ShockwaveDataGrid)
  const displayTherapists = useMemo(
    () => buildDisplayTherapists(displayBaseTherapists, monthlyTherapists),
    [displayBaseTherapists, monthlyTherapists]
  );
  const therapistNameList = useMemo(
    () => displayTherapists.map((t) => t.name).filter(Boolean),
    [displayTherapists]
  );
  const therapistNameKey = useMemo(
    () => therapistNameList.join('\u0001'),
    [therapistNameList]
  );
  const [selectedTherapistNames, setSelectedTherapistNames] = useState([]);
  useEffect(() => {
    if (!monthlyTherapistsReady) return;
    setSelectedTherapistNames(therapistNameList);
  }, [monthlyTherapistsReady, therapistNameKey, therapistNameList]);
  const selectedTherapistSet = useMemo(
    () => new Set(selectedTherapistNames),
    [selectedTherapistNames]
  );
  const toggleTherapistFilter = useCallback((name) => {
    setSelectedTherapistNames((prev) => {
      if (prev.includes(name)) {
        if (prev.length <= 1) return prev;
        return prev.filter((item) => item !== name);
      }
      return [...prev, name];
    });
  }, []);
  const fetchLogs = useCallback(async () => {
    const currentFetchId = ++fetchIdRef.current;
    const monthKey = `${currentYear}-${currentMonth}`;
    const hasCurrentMonthLogs = logsLoadedKeyRef.current === monthKey;
    if (!hasCurrentMonthLogs) setIsLogsLoading(true);
    try {
      const startStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
      const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;
      const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
      const endStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

      const { data, error } = await supabase
        .from('shockwave_patient_logs')
        .select('id,date,patient_name,chart_number,visit_count,body_part,therapist_name,prescription,prescription_count,source,scheduler_cell_key,created_at')
        .gte('date', startStr)
        .lt('date', endStr)
        .order('date', { ascending: true })
        .order('created_at', { ascending: true });

      if (error) throw error;
      if (currentFetchId !== fetchIdRef.current) return [];
      setCurrentLogsReadyKey(monthKey);
      logsLoadedKeyRef.current = monthKey;
      setLogs(data || []);
      return data || [];
    } catch (err) {
      if (currentFetchId === fetchIdRef.current) {
        console.error(err);
        addToast('통계 기록을 불러오는데 실패했습니다.', 'error');
      }
      return null;
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setIsLogsLoading(false);
      }
    }
  }, [currentYear, currentMonth, addToast]);

  const syncCurrentMonthFromScheduleSource = useCallback(async ({
    upToToday = true,
    overwriteManual = false,
    emitEvent = false,
    sourceMemosOverride = null,
    sourceMonthlyTherapistsOverride = null,
  } = {}) => {
    if (safeTherapists.length === 0) return null;
    const hasOverride = sourceMemosOverride &&
      typeof sourceMemosOverride === 'object' &&
      !Array.isArray(sourceMemosOverride);
    if (!hasOverride && !isCurrentScheduleReady) return null;

    const sourceMemos = hasOverride ? sourceMemosOverride : (memos || {});
    const sourceMonthlyTherapists = Array.isArray(sourceMonthlyTherapistsOverride)
      ? sourceMonthlyTherapistsOverride
      : monthlyTherapistsReady
        ? monthlyTherapists
        : await loadStatsMonthlyTherapists({
            year: currentYear,
            month: currentMonth,
            type: 'shockwave',
            baseTherapists: safeTherapists,
          });
    const sourcePrefix = `shockwave-source:${currentYear}-${String(currentMonth).padStart(2, '0')}`;

    const syncResult = await syncMonthShockwaveScheduleToStats({
      year: currentYear,
      month: currentMonth,
      memos: sourceMemos,
      therapists: safeTherapists,
      monthlyTherapists: sourceMonthlyTherapists,
      settings: shockwaveSettings,
      upToToday,
      overwriteManual,
      scheduleAuthoritative: true,
      emitEvent,
      replaceExistingMonthLogs: true,
    });

    return {
      memos: sourceMemos,
      monthlyTherapists: sourceMonthlyTherapists,
      therapists: safeTherapists,
      logs: normalizeScheduleSourceLogs(
        syncResult?.rebuiltRows,
        sourcePrefix
      ),
    };
  }, [
    currentMonth,
    currentYear,
    isCurrentScheduleReady,
    memos,
    monthlyTherapists,
    monthlyTherapistsReady,
    safeTherapists,
    shockwaveSettings,
  ]);

  // 수동 새로고침: 스케줄 메모 + 통계 로그 + 자동동기화 재실행
  const [isReloading, setIsReloading] = useState(false);
  const handleReload = useCallback(async () => {
    setIsReloading(true);
    try {
      // 1. 스케줄 메모를 다시 가져옴
      const reloadResult = onReloadMemos ? await onReloadMemos() : null;
      const synced = await syncCurrentMonthFromScheduleSource({
        upToToday: true,
        emitEvent: false,
        sourceMemosOverride: reloadResult?.memos,
        sourceMonthlyTherapistsOverride: reloadResult?.monthlyTherapists,
      });
      if (!synced?.memos) {
        addToast('스케줄 데이터를 불러오지 못해 통계 동기화를 건너뛰었습니다.', 'error');
        return;
      }
      if (!safeTherapists.length) {
        addToast('치료사 목록을 불러오지 못해 통계 동기화를 건너뛰었습니다.', 'error');
        return;
      }
      // 2. 자동동기화 키를 리셋하여 다시 실행되도록
      lastAutoSyncKeyRef.current = null;
      // 3. 스케줄 원본에서 재생성한 통계 행을 즉시 화면에 반영
      if (Array.isArray(synced.logs)) {
        markCurrentLogsReady();
        setLogs(synced.logs);
      } else {
        await fetchLogs();
      }
      addToast('통계 데이터를 새로 불러왔습니다.', 'success');
    } catch (err) {
      console.error(err);
      addToast('데이터 새로고침 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsReloading(false);
    }
  }, [
    onReloadMemos,
    safeTherapists,
    syncCurrentMonthFromScheduleSource,
    fetchLogs,
    addToast,
    markCurrentLogsReady,
  ]);

  useEffect(() => {
    logsLoadedKeyRef.current = '';
    setCurrentLogsReadyKey('');
    setLogs([]);
    currentAutoSyncRunRef.current = { key: '', promise: null };
    lastAutoSyncKeyRef.current = null;
  }, [currentYear, currentMonth]);

  useEffect(() => {
    if (safeTherapists.length === 0) return;
    if (!isCurrentScheduleReady) return;

    const monthKey = `${currentYear}-${currentMonth}`;
    const syncKey = `${currentYear}-${currentMonth}:${currentMemosSyncSignature}:${scheduleLayoutSettingsKey}`;
    if (lastAutoSyncKeyRef.current === syncKey && logsLoadedKeyRef.current === monthKey) return;

    let cancelled = false;

    let syncPromise = currentAutoSyncRunRef.current.key === syncKey
      ? currentAutoSyncRunRef.current.promise
      : null;

    if (!syncPromise) {
      syncPromise = syncCurrentMonthFromScheduleSource({
        upToToday: true,
        emitEvent: false,
      });
      currentAutoSyncRunRef.current = { key: syncKey, promise: syncPromise };
    }

    setIsCurrentSyncing(true);
    syncPromise
      .then(async (synced) => {
        if (cancelled) return;
        if (Array.isArray(synced?.logs)) {
          setCurrentLogsReadyKey(monthKey);
          logsLoadedKeyRef.current = monthKey;
          setLogs(synced.logs);
          lastAutoSyncKeyRef.current = syncKey;
        } else {
          await fetchLogs();
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('충격파 통계 자동 동기화 실패:', error);
        lastAutoSyncKeyRef.current = null;
      })
      .finally(() => {
        if (currentAutoSyncRunRef.current.promise === syncPromise) {
          currentAutoSyncRunRef.current = { key: '', promise: null };
        }
        if (!cancelled) {
          setIsCurrentSyncing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    currentMonth,
    currentYear,
    currentMemosSyncSignature,
    fetchLogs,
    isCurrentScheduleReady,
    scheduleLayoutSettingsKey,
    safeTherapists,
    syncCurrentMonthFromScheduleSource,
  ]);

  useEffect(() => {
    let active = true;

    const handleStatsUpdated = () => {
      if (!active || !isCurrentScheduleReady) return;
      lastAutoSyncKeyRef.current = null;
      setRecentLogsRefreshKey((value) => value + 1);
      setIsCurrentSyncing(true);
      (async () => {
        try {
          const synced = await syncCurrentMonthFromScheduleSource({
            upToToday: true,
            emitEvent: false,
          });
          if (!active) return;
          if (Array.isArray(synced?.logs)) {
            markCurrentLogsReady();
            setLogs(synced.logs);
          } else {
            await fetchLogs();
          }
        } catch (error) {
          if (!active) return;
          console.error('충격파 통계 이벤트 동기화 실패:', error);
          await fetchLogs();
        } finally {
          if (active) setIsCurrentSyncing(false);
        }
      })();
    };
    window.addEventListener('clinic-stats-updated', handleStatsUpdated);
    return () => {
      active = false;
      window.removeEventListener('clinic-stats-updated', handleStatsUpdated);
    };
  }, [
    currentMonth,
    currentYear,
    fetchLogs,
    isCurrentScheduleReady,
    markCurrentLogsReady,
    syncCurrentMonthFromScheduleSource,
  ]);

  useEffect(() => {
    if (shockwaveSettings?.id && shockwaveSettings.id !== DEFAULT_SETTINGS_ID) {
      setSettingsReady(true);
      return undefined;
    }

    let active = true;
    setSettingsReady(false);
    if (!settingsLoadPromiseRef.current) {
      settingsLoadPromiseRef.current = Promise.resolve(loadShockwaveSettings())
        .finally(() => {
          settingsLoadPromiseRef.current = null;
        });
    }
    settingsLoadPromiseRef.current
      .catch((error) => {
        console.error('충격파 설정 로드 실패:', error);
      })
      .finally(() => {
        if (active) setSettingsReady(true);
      });

    return () => {
      active = false;
    };
  }, [loadShockwaveSettings, shockwaveSettings?.id]);

  useEffect(() => {
    if (activeSection !== 'settlement') return;
    if (safeLogs.length === 0) return;
    setRecentLogs((prev) => replaceLogsForStatsMonth(prev, currentYear, currentMonth, safeLogs));
  }, [activeSection, currentMonth, currentYear, safeLogs]);

  useEffect(() => {
    if (activeSection !== 'settlement') return undefined;
    if (safeTherapists.length === 0) return undefined;
    if (!isCurrentScheduleReady) return undefined;

    const therapistKey = safeTherapists
      .map((therapist, index) => `${therapist?.slot_index ?? index}:${therapist?.name || ''}`)
      .join('|');
    const syncKey = `${currentYear}-${currentMonth}:${recentPeriodMonths}:${therapistKey}:${scheduleLayoutSettingsKey}:${currentMemosSyncSignature}:${recentLogsRefreshKey}`;
    if (recentAutoSyncKeyRef.current === syncKey) return undefined;

    let cancelled = false;
    const applyMonthLogs = (target, monthRows) => {
      const normalized = normalizeScheduleSourceLogs(
        monthRows,
        `shockwave-source:${target.year}-${String(target.month).padStart(2, '0')}`
      );
      if (!cancelled) {
        setRecentLogs((prev) => replaceLogsForStatsMonth(prev, target.year, target.month, normalized));
      }
      return normalized;
    };

    const runRecentSync = async () => {
      setIsRecentLogsLoading(true);
      const targets = getRecentScheduleMonthTargets({ currentYear, currentMonth, recentPeriodMonths });
      let sourceRecentLogs = [];

      for (const target of targets) {
        const isDisplayedMonth =
          Number(target.year) === Number(currentYear) &&
          Number(target.month) === Number(currentMonth);
        const [targetMemos, targetMonthlyTherapists] = await Promise.all([
          isDisplayedMonth
            ? Promise.resolve(memos || {})
            : loadScheduleMemosForStatsMonth({
                year: target.year,
                month: target.month,
                settings: shockwaveSettings,
              }),
          isDisplayedMonth && monthlyTherapistsReady
            ? Promise.resolve(monthlyTherapists)
            : loadStatsMonthlyTherapists({
                year: target.year,
                month: target.month,
                type: 'shockwave',
                baseTherapists: safeTherapists,
              }),
        ]);

        const syncResult = await syncMonthShockwaveScheduleToStats({
          year: target.year,
          month: target.month,
          memos: targetMemos,
          therapists: safeTherapists,
          monthlyTherapists: targetMonthlyTherapists,
          settings: shockwaveSettings,
          upToToday: true,
          scheduleAuthoritative: true,
          emitEvent: false,
          replaceExistingMonthLogs: true,
          onRowsRebuilt: (rebuiltRows) => {
            const normalized = applyMonthLogs(target, rebuiltRows);
            sourceRecentLogs = replaceLogsForStatsMonth(
              sourceRecentLogs,
              target.year,
              target.month,
              normalized
            );
          },
        });
        const normalized = normalizeScheduleSourceLogs(
          syncResult?.rebuiltRows,
          `shockwave-source:${target.year}-${String(target.month).padStart(2, '0')}`
        );
        sourceRecentLogs = replaceLogsForStatsMonth(
          sourceRecentLogs,
          target.year,
          target.month,
          normalized
        );
        if (!cancelled) setRecentLogs(sourceRecentLogs);
      }

      return sourceRecentLogs;
    };

    let syncPromise = recentAutoSyncRunRef.current.key === syncKey
      ? recentAutoSyncRunRef.current.promise
      : null;

    if (!syncPromise) {
      syncPromise = runRecentSync();
      recentAutoSyncRunRef.current = { key: syncKey, promise: syncPromise };
    } else {
      setIsRecentLogsLoading(true);
    }

    syncPromise
      .then((nextRecentLogs) => {
        if (cancelled) return;
        setRecentLogs(nextRecentLogs || []);
        recentAutoSyncKeyRef.current = syncKey;
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('최근 충격파 통계 자동 동기화 실패:', error);
        recentAutoSyncKeyRef.current = null;
      })
      .finally(() => {
        if (recentAutoSyncRunRef.current.promise === syncPromise) {
          recentAutoSyncRunRef.current = { key: '', promise: null };
        }
        if (!cancelled) setIsRecentLogsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeSection,
    currentMonth,
    currentYear,
    recentPeriodMonths,
    recentLogsRefreshKey,
    currentMemosSyncSignature,
    isCurrentScheduleReady,
    memos,
    monthlyTherapists,
    monthlyTherapistsReady,
    safeTherapists,
    scheduleLayoutSettingsKey,
    shockwaveSettings,
  ]);

  const recentLogsForSummaries = useMemo(() => {
    if (safeLogs.length === 0) return recentLogs;
    return replaceLogsForStatsMonth(recentLogs, currentYear, currentMonth, safeLogs);
  }, [currentMonth, currentYear, recentLogs, safeLogs]);

  const recentMonthlySummaries = useMemo(() => {
    return Array.from({ length: recentPeriodMonths }, (_, index) => {
      const targetDate = new Date(currentYear, currentMonth - 1 - index, 1);
      const year = targetDate.getFullYear();
      const month = targetDate.getMonth() + 1;
      const monthKey = `${year}-${String(month).padStart(2, '0')}`;

      const monthlyLogs = recentLogsForSummaries.filter((log) => String(log?.date || '').startsWith(monthKey));
      const monthSettings = getEffectiveSettlementSettings(shockwaveSettings, year, month, 'shockwave');
      const monthHiddenPrescriptions = new Set(monthSettings.hidden_prescriptions || []);
      const monthPrescriptionKeys = new Set(
        (monthSettings.prescriptions || [])
          .filter((prescription) => prescription && !monthHiddenPrescriptions.has(prescription))
          .map(normalizePrescriptionKey)
      );
      const settlementLogs = monthlyLogs.filter((log) => monthPrescriptionKeys.has(normalizePrescriptionKey(log?.prescription)));
      const totalCount = settlementLogs.reduce((sum, log) => sum + toStatsPrescriptionCount(log?.prescription_count), 0);
      const monthPriceMap = Object.fromEntries(
        Object.entries(monthSettings.prescription_prices || {}).map(([key, value]) => [
          normalizePrescriptionKey(key),
          Number(value) || 0,
        ])
      );
      const amount = settlementLogs.reduce((sum, log) => {
        const price = monthPriceMap[normalizePrescriptionKey(log?.prescription)] || 0;
        return sum + toStatsPrescriptionCount(log?.prescription_count) * price;
      }, 0);
      const newPatientCount = settlementLogs.filter((log) => String(log?.patient_name || '').includes('*')).length;

      return {
        monthKey,
        label: `${year}년 ${String(month).padStart(2, '0')}월`,
        totalCount,
        amount,
        newPatientCount,
      };
    });
  }, [currentYear, currentMonth, recentLogsForSummaries, shockwaveSettings, recentPeriodMonths]);

  const handleSaveSettlementSettings = useCallback(async (nextSettings) => {
    const ok = await saveShockwaveSettings(nextSettings);
    if (ok) await loadShockwaveSettings();
    addToast(ok ? '이번 달 충격파 결산 설정을 저장했습니다.' : '결산 설정 저장에 실패했습니다.', ok ? 'success' : 'error');
  }, [addToast, loadShockwaveSettings, saveShockwaveSettings]);

  useEffect(() => {
    setExtraDraftRows(0);
  }, [currentYear, currentMonth]);

  useEffect(() => {
    setActiveSection('grid');
  }, [currentYear, currentMonth]);

  // eslint-disable-next-line no-unused-vars
  const handleCellEdit = async (id, field, value) => {
    try {
      const { error } = await supabase.from('shockwave_patient_logs').update({ [field]: value }).eq('id', id);
      if (error) throw error;
      setLogs(prev => prev.map(log => log.id === id ? { ...log, [field]: value } : log));
    } catch {
      addToast('저장 실패', 'error');
    }
  };

  // 스케줄러 데이터 파싱 및 동기화 (One-way Sync)
  // eslint-disable-next-line no-unused-vars
  const handleSyncFromScheduler = async () => {
    setIsLogsLoading(true);
    try {
      const result = await syncTodayShockwaveScheduleToStats({
        year: currentYear,
        month: currentMonth,
        memos,
        therapists: safeTherapists,
        monthlyTherapists,
        settings: shockwaveSettings,
      });

      if (result.skipped && result.reason === 'today_outside_current_month') {
        addToast('오늘 날짜가 포함된 이번 달 스케줄러에서만 동기화할 수 있습니다.', 'info');
        return;
      }

      if (result.extractedCount === 0) {
        addToast('오늘 스케줄러에 해당하는 예약 내역이 없습니다.', 'info');
      }

      if (result.totalUpdates > 0) {
        addToast(`오늘 스케줄과 동기화 성공! (추가:${result.insertedCount}, 갱신:${result.updatedCount}, 제거:${result.deletedCount})`, 'success');
        await fetchLogs();
      } else {
        addToast('오늘 스케줄과 치료 내역 통계가 이미 일치합니다.', 'info');
      }
    } catch (err) {
      console.error(err);
      addToast('데이터 동기화 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsLogsLoading(false);
    }
  };

  // eslint-disable-next-line no-unused-vars
  const handleSyncMonthFromScheduler = async () => {
      if (!window.confirm(`${currentMonth}월 전체 스케줄을 스케줄러 기준으로 덮어씁니다.\n(수동으로 추가한 내역은 모두 삭제됩니다.) 진행하시겠습니까?`)) return;
    setIsLogsLoading(true);
    try {
      const result = await syncCurrentMonthFromScheduleSource({
        upToToday: false,
        overwriteManual: true,
        emitEvent: false,
      });

      if (result) {
        addToast('전체 월 스케줄을 스케줄러 기준으로 다시 동기화했습니다.', 'success');
        await fetchLogs();
      } else {
        addToast('치료사 목록을 불러오지 못해 전체 월 동기화를 건너뛰었습니다.', 'error');
      }
    } catch (err) {
      console.error(err);
      addToast('전체 월 데이터 동기화 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsLogsLoading(false);
    }
  };

  const isInitialDataLoading = isScheduleLoading || isLogsLoading;
  const showGridSkeleton = (!currentLogsReady || (isInitialDataLoading && safeLogs.length === 0)) && activeSection === 'grid';
  const showSettlementSkeleton = isInitialDataLoading && displayTherapists.length === 0 && activeSection === 'settlement';

  return (
    <div className="sw-stats-container sw-stats-container--shockwave animate-fade-in">
      {isLoading && <div className="top-loading-bar" />}
      <div className="sw-stats-layout">
        <aside className="sw-stats-sidebar">
          <button
            className={`sw-stats-side-tab sw-stats-side-tab--grid${activeSection === 'grid' ? ' active' : ''}`}
            onClick={() => setActiveSection('grid')}
          >
            충격파 현황
          </button>
          <button
            className={`sw-stats-side-tab sw-stats-side-tab--settlement${activeSection === 'settlement' ? ' active' : ''}`}
            onClick={() => setActiveSection('settlement')}
          >
            충격파 결산
          </button>
          <button
            className={`sw-stats-side-tab sw-stats-side-tab--new-patients${activeSection === 'new-patients' ? ' active' : ''}`}
            onClick={() => setActiveSection('new-patients')}
          >
            신규환자
          </button>
          {canManageStatsSettings && (
            <button
              className={`sw-stats-side-tab sw-stats-side-tab--settings${activeSection === 'settings' ? ' active' : ''}`}
              onClick={() => setActiveSection('settings')}
            >
              설정
            </button>
          )}

          <div style={{ marginTop: 'auto', padding: '12px 0' }}>
            <button
              type="button"
              className="sw-stats-side-tab"
              style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: isReloading ? 0.6 : 1 }}
              onClick={handleReload}
              disabled={isReloading || isLoading}
              title="스케줄 데이터를 다시 불러와 통계에 반영합니다"
            >
              <RefreshCw size={14} className={isReloading ? 'spin-animation' : ''} />
              {isReloading ? '새로고침 중...' : '데이터 새로고침'}
            </button>
          </div>

          {therapistNameList.length > 1 && (
            <div className="sw-sidebar-filter" aria-label="치료사 필터">
              <div className="sw-sidebar-filter-title">치료사 필터</div>
              <div className="sw-sidebar-filter-list">
                {displayTherapists.map((therapist, idx) => {
                  const isSelected = selectedTherapistSet.has(therapist.name);
                  const isLastSelected = isSelected && selectedTherapistNames.length <= 1;
                  return (
                    <label
                      key={therapist.key || therapist.name}
                      className={`sw-sidebar-filter-chip tone-${idx % 5} ${isSelected ? 'is-active' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isLastSelected}
                        onChange={() => toggleTherapistFilter(therapist.name)}
                      />
                      <span>{therapist.displayName || therapist.name}</span>
                    </label>
                  );
                })}
              </div>
              <button
                type="button"
                className="sw-sidebar-filter-reset"
                onClick={() => setSelectedTherapistNames(therapistNameList)}
              >
                전체 선택
              </button>
            </div>
          )}
        </aside>

        <div className="sw-stats-panel">
          {activeSection === 'grid' && (
            <div className="sw-stats-body sw-stats-body--grid fade-transition-wrapper">
              {showGridSkeleton ? (
                <GridSkeleton rows={15} cols={8} />
              ) : (
                <>
                  <div className="sw-grid-card">
                    <div className="sw-grid-card-table">
                      <ShockwaveStatsErrorBoundary>
                        <ShockwaveDataGrid
                          logs={safeLogs}
                          therapists={displayBaseTherapists}
                          monthlyTherapists={monthlyTherapists}
                          currentYear={currentYear}
                          currentMonth={currentMonth}
                          fetchLogs={fetchLogs}
                          prescriptions={gridPrescriptions}
                          extraDraftRows={extraDraftRows}
                          totalRecordCount={safeLogs.length}
                          therapistCount={safeTherapists.length}
                          selectedTherapistNames={selectedTherapistNames}
                          onSelectedTherapistNamesChange={setSelectedTherapistNames}
                          readOnly
                        />
                      </ShockwaveStatsErrorBoundary>
                    </div>
                  </div>

                  <div className="sw-stats-footer">
                    <button
                      className="btn btn-secondary sw-add-rows-btn"
                      onClick={() => setExtraDraftRows((prev) => prev + 10)}
                    >
                      + 10행 추가
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {activeSection === 'settlement' && (
            <div className="sw-stats-body sw-stats-body--settlement fade-transition-wrapper">
              {showSettlementSkeleton ? (
                <SettlementSkeleton />
              ) : (
                <ShockwaveSettlementView
                  logs={safeLogs}
                  therapists={displayBaseTherapists}
                  monthlyTherapists={monthlyTherapists}
                  currentMonth={currentMonth}
                  prescriptions={settlementPrescriptions}
                  prescriptionPrices={settlementPrices}
                  incentivePercentage={incentivePercentage}
                  recentMonthlySummaries={recentMonthlySummaries}
                  recentPeriodInput={recentPeriodInput}
                  recentPeriodLabel={recentPeriodLabel}
                  onRecentPeriodInputChange={setRecentPeriodInput}
                  selectedTherapistNames={selectedTherapistNames}
                />
              )}
            </div>
          )}

          {activeSection === 'new-patients' && (
            <div className="sw-stats-body sw-stats-body--settlement fade-transition-wrapper">
              <ShockwaveNewPatientsView
                logs={safeLogs}
                therapists={displayBaseTherapists}
                monthlyTherapists={monthlyTherapists}
                currentMonth={currentMonth}
                selectedTherapistNames={selectedTherapistNames}
              />
            </div>
          )}

          {canManageStatsSettings && activeSection === 'settings' && (
            <SettlementSettingsPanel
              type="shockwave"
              year={currentYear}
              month={currentMonth}
              settings={shockwaveSettings}
              effectiveSettings={effectiveSettlementSettings}
              onSave={handleSaveSettlementSettings}
            />
          )}
        </div>
      </div>
    </div>
  );
}

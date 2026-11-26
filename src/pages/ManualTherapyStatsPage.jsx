import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useSchedule } from '../contexts/ScheduleContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { useToast } from '../components/common/Toast';
import { syncTodayManualTherapyScheduleToStats, syncMonthManualTherapyScheduleToStats } from '../lib/manualTherapyUtils';
import { buildDisplayTherapists } from '../lib/therapistDisplayUtils';
import { GridSkeleton, SettlementSkeleton } from '../components/common/LoadingSkeleton';
import ShockwaveDataGrid from '../components/shockwave/ShockwaveDataGrid';
import ShockwaveNewPatientsView from '../components/shockwave/ShockwaveNewPatientsView';
import ManualTherapyStatsView from '../components/shockwave/ManualTherapyStatsView';
import ManualTherapySixMonthStats, {
  clearManualTherapySixMonthCache,
} from '../components/shockwave/ManualTherapySixMonthStats';
import SettlementSettingsPanel from '../components/shockwave/SettlementSettingsPanel';
import { getEffectiveSettlementSettings } from '../lib/settlementSettings';
import { normalizeManualTherapyLogRows } from '../lib/manualTherapyLogUtils';
import { isAdminUser } from '../lib/authPermissions';
import {
  buildScheduleMemoSignature,
  loadStatsMonthlyTherapists,
  resolveScheduleMemosForStatsMonth,
} from '../lib/statsScheduleSourceUtils';
import {
  createStatsMemoryCache,
  DEFAULT_STATS_CACHE_TTL_MS,
} from '../lib/statsMemoryCache';
import { normalizePrescriptionGroupKey } from '../lib/prescriptionScheduleSettings';
import { getTodayKST } from '../lib/calendarUtils';
import {
  shouldKeepStatsSectionMounted,
  shouldPrepareStatsSecondarySections,
} from '../lib/statsSectionLoadingUtils';

import { fetchAllPaginatedRows } from '../lib/scheduleStatsSyncUtils';

const DEFAULT_SETTINGS_ID = '00000000-0000-0000-0000-000000000000';
const manualTherapyCurrentCache = createStatsMemoryCache({
  ttlMs: DEFAULT_STATS_CACHE_TTL_MS,
  invalidateEvents: ['clinic-stats-updated'],
});

function buildManualSourceLogId(row, index, prefix) {
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

function normalizeManualSourceLogs(rows, prefix, prescriptions, options) {
  const hydrated = (Array.isArray(rows) ? rows : []).map((row, index) => ({
    ...row,
    id: row?.id || buildManualSourceLogId(row, index, prefix),
    source: row?.source || 'scheduler',
    created_at: row?.created_at || `${row?.date || '1970-01-01'}T00:00:00.000Z`,
  }));
  return normalizeManualTherapyLogRows(hydrated, prescriptions, options);
}

class ManualTherapyStatsPageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('ManualTherapyStatsPage failed:', error);
  }

  render() {
    if (this.state.hasError) {
      return <div style={{ padding: 24 }}>도수치료 통계 화면을 여는 중 오류가 발생했습니다.</div>;
    }
    return this.props.children;
  }
}

class ManualTherapySettlementErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('ManualTherapy settlement render failed:', error);
  }

  render() {
    if (this.state.hasError) {
      return <div style={{ padding: 24 }}>도수치료 결산을 표시하는 중 오류가 발생했습니다.</div>;
    }
    return this.props.children;
  }
}

export default function ManualTherapyStatsPage() {
  const {
    currentYear,
    currentMonth,
    manualTherapists,
    loadManualTherapists,
    shockwaveMemos,
    shockwaveMemosLoadedKey,
    loadShockwaveMemos,
    shockwaveSettings,
    loadShockwaveSettings,
    saveShockwaveSettings,
    monthlyTherapistsByMonth,
    loadMonthlyTherapists,
  } = useSchedule();
  const { user } = useAuth();
  const canManageStatsSettings = isAdminUser(user);
  const { addToast } = useToast();
  const [showRecentSummary, setShowRecentSummary] = useState(true);
  const currentMonthKey = useMemo(() => `${currentYear}-${currentMonth}`, [currentYear, currentMonth]);
  const initialCachedCurrent = manualTherapyCurrentCache.get(currentMonthKey);
  const cachedMonthlyFromContext = monthlyTherapistsByMonth?.manual_therapy?.[currentMonthKey];
  const [logs, setLogs] = useState(() => (
    Array.isArray(initialCachedCurrent?.logs) ? initialCachedCurrent.logs : []
  ));
  const [activeSection, setActiveSection] = useState('grid');
  const [isLogsLoading, setIsLogsLoading] = useState(false);
  const [isScheduleLoading, setIsScheduleLoading] = useState(false);
  const isLoading = isLogsLoading || isScheduleLoading;
  const [settingsReady, setSettingsReady] = useState(() => (
    Boolean(shockwaveSettings?.id) && shockwaveSettings.id !== DEFAULT_SETTINGS_ID
  ));
  const [therapistsReady, setTherapistsReady] = useState(() => (
    Array.isArray(manualTherapists) && manualTherapists.length > 0
  ));
  const [localMonthlyTherapists, setLocalMonthlyTherapists] = useState(() => (
    Array.isArray(cachedMonthlyFromContext)
      ? cachedMonthlyFromContext
      : (Array.isArray(initialCachedCurrent?.monthlyTherapists) ? initialCachedCurrent.monthlyTherapists : null)
  ));
  const lastAutoSyncKeyRef = useRef(initialCachedCurrent?.syncKey || null);
  const scheduleReloadRequestRef = useRef(0);
  const logsLoadedKeyRef = useRef(Array.isArray(initialCachedCurrent?.logs) ? currentMonthKey : '');
  const shockwaveMemosRef = useRef(shockwaveMemos);
  const monthlyTherapistsByMonthRef = useRef(monthlyTherapistsByMonth);

  useEffect(() => {
    shockwaveMemosRef.current = shockwaveMemos;
  }, [shockwaveMemos]);

  useEffect(() => {
    monthlyTherapistsByMonthRef.current = monthlyTherapistsByMonth;
  }, [monthlyTherapistsByMonth]);

  useEffect(() => {
    if (!canManageStatsSettings && activeSection === 'settings') {
      setActiveSection('grid');
    }
  }, [activeSection, canManageStatsSettings]);

  // 연월 변경 시 신선한 캐시가 있으면 즉시 복원하고, 없으면 초기화하여 잔류 데이터 방지
  useEffect(() => {
    const cached = manualTherapyCurrentCache.get(currentMonthKey);
    const contextMonthly = monthlyTherapistsByMonthRef.current?.manual_therapy?.[currentMonthKey];
    if (cached && Array.isArray(cached.logs)) {
      logsLoadedKeyRef.current = currentMonthKey;
      setLogs(cached.logs);
      lastAutoSyncKeyRef.current = cached.syncKey || null;
      setLocalMonthlyTherapists(
        Array.isArray(contextMonthly)
          ? contextMonthly
          : (Array.isArray(cached.monthlyTherapists) ? cached.monthlyTherapists : null)
      );
    } else {
      logsLoadedKeyRef.current = '';
      setLogs([]);
      lastAutoSyncKeyRef.current = null;
      setLocalMonthlyTherapists(Array.isArray(contextMonthly) ? contextMonthly : null);
    }
  }, [currentMonthKey]);

  const monthlyManualTherapists = useMemo(
    () => (Array.isArray(localMonthlyTherapists) ? localMonthlyTherapists : []),
    [localMonthlyTherapists]
  );
  const monthlyTherapistsReady = Array.isArray(localMonthlyTherapists);

  const safeTherapists = useMemo(
    () => (Array.isArray(manualTherapists) ? manualTherapists.filter(Boolean) : []),
    [manualTherapists]
  );
  const currentMemosSyncSignature = useMemo(
    () => buildScheduleMemoSignature(shockwaveMemos),
    [shockwaveMemos]
  );
  const displayBaseTherapists = useMemo(
    () => (monthlyTherapistsReady ? safeTherapists : []),
    [monthlyTherapistsReady, safeTherapists]
  );
  const effectiveSettlementSettings = useMemo(
    () => getEffectiveSettlementSettings(shockwaveSettings, currentYear, currentMonth, 'manual_therapy'),
    [shockwaveSettings, currentYear, currentMonth]
  );
  const allPrescriptions = useMemo(
    () => (Array.isArray(effectiveSettlementSettings.prescriptions)
      ? effectiveSettlementSettings.prescriptions.filter(Boolean)
      : []),
    [effectiveSettlementSettings]
  );
  const hiddenPrescriptionKeys = useMemo(
    () => new Set(
      (Array.isArray(effectiveSettlementSettings.hidden_prescriptions)
        ? effectiveSettlementSettings.hidden_prescriptions
        : []
      ).map(normalizePrescriptionGroupKey)
    ),
    [effectiveSettlementSettings]
  );
  const prescriptions = useMemo(
    () => allPrescriptions.filter(
      (prescription) => !hiddenPrescriptionKeys.has(normalizePrescriptionGroupKey(prescription))
    ),
    [allPrescriptions, hiddenPrescriptionKeys]
  );
  const activePrescriptionKeys = useMemo(
    () => new Set(allPrescriptions.map(normalizePrescriptionGroupKey).filter(Boolean)),
    [allPrescriptions]
  );
  const visibleLogs = useMemo(
    () => {
      return logs.filter((log) => {
        const treatmentKey = normalizePrescriptionGroupKey(log?.prescription);
        if (!treatmentKey || !activePrescriptionKeys.has(treatmentKey)) return false;
        return !hiddenPrescriptionKeys.has(treatmentKey);
      });
    },
    [activePrescriptionKeys, logs, hiddenPrescriptionKeys]
  );

  // Therapist filter state (lifted from ShockwaveDataGrid)
  const displayTherapists = useMemo(
    () => buildDisplayTherapists(displayBaseTherapists, monthlyManualTherapists),
    [displayBaseTherapists, monthlyManualTherapists]
  );
  const therapistNameList = useMemo(
    () => displayTherapists.map((t) => t.name).filter(Boolean),
    [displayTherapists]
  );
  const therapistNameKey = useMemo(
    () => therapistNameList.join('\u0001'),
    [therapistNameList]
  );
  const fetchIdRef = useRef(0);
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

  const fetchLogs = useCallback(async ({ memosOverride = null, scheduleAuthoritative = null } = {}) => {
    const currentFetchId = ++fetchIdRef.current;
    const monthKey = `${currentYear}-${currentMonth}`;
    const hasCurrentMonthLogs = logsLoadedKeyRef.current === monthKey;
    if (!hasCurrentMonthLogs) setIsLogsLoading(true);
    try {
      const startStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
      const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;
      const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
      const endStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
      const today = getTodayKST();
      const isCurrentCalendarMonth = (
        today.getFullYear() === currentYear &&
        today.getMonth() + 1 === currentMonth
      );
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      const data = await fetchAllPaginatedRows(() => {
        let query = supabase
          .from('manual_therapy_patient_logs')
          .select('id,date,patient_name,chart_number,visit_count,body_part,therapist_name,prescription,prescription_count,source,scheduler_cell_key,created_at')
          .gte('date', startStr);
        query = isCurrentCalendarMonth
          ? query.lte('date', todayStr)
          : query.lt('date', endStr);
        return query
          .order('date', { ascending: true })
          .order('created_at', { ascending: true })
          .order('id', { ascending: true });
      });

      if (currentFetchId !== fetchIdRef.current) return [];
      logsLoadedKeyRef.current = monthKey;
      const currentScheduleIsLoaded = shockwaveMemosLoadedKey === monthKey;
      const normalizedLogs = normalizeManualTherapyLogRows(data, allPrescriptions, {
        memos: memosOverride ?? shockwaveMemosRef.current,
        year: currentYear,
        month: currentMonth,
        settings: shockwaveSettings,
        scheduleAuthoritative: scheduleAuthoritative ?? currentScheduleIsLoaded,
      });
      setLogs(normalizedLogs);
      return normalizedLogs;
    } catch (error) {
      if (currentFetchId === fetchIdRef.current) {
        console.error(error);
        addToast('도수치료 기록을 불러오는데 실패했습니다.', 'error');
      }
      return null;
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setIsLogsLoading(false);
      }
    }
  }, [addToast, allPrescriptions, currentMonth, currentYear, shockwaveMemosLoadedKey, shockwaveSettings]);

  const manualSettingsSyncSignature = useMemo(
    () => JSON.stringify({
      start_time: shockwaveSettings?.start_time,
      end_time: shockwaveSettings?.end_time,
      interval_minutes: shockwaveSettings?.interval_minutes,
      time_label_interval_minutes: shockwaveSettings?.time_label_interval_minutes,
      day_overrides: shockwaveSettings?.day_overrides,
      date_overrides: shockwaveSettings?.date_overrides,
      manual_therapy_prescriptions: allPrescriptions,
      manual_therapy_dose_tags: effectiveSettlementSettings.dose_tags,
      manual_therapy_duration_minutes: effectiveSettlementSettings.duration_minutes,
      prescription_schedule_groups: shockwaveSettings?.prescription_schedule_groups,
    }),
    [allPrescriptions, effectiveSettlementSettings.dose_tags, effectiveSettlementSettings.duration_minutes, shockwaveSettings]
  );

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      loadManualTherapists(),
      loadShockwaveSettings(),
    ]).finally(() => {
      if (active) {
        setTherapistsReady(true);
        setSettingsReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, [loadManualTherapists, loadShockwaveSettings]);

  const reloadScheduleData = useCallback(async ({ force = false } = {}) => {
    const requestId = ++scheduleReloadRequestRef.current;
    setIsScheduleLoading(true);
    try {
      const [loadedMonthlyTherapists, loadedMemos] = await Promise.all([
        loadMonthlyTherapists(currentYear, currentMonth, 'manual_therapy'),
        loadShockwaveMemos(currentYear, currentMonth, { force, silent: true }),
      ]);
      if (scheduleReloadRequestRef.current === requestId) {
        if (Array.isArray(loadedMonthlyTherapists)) {
          setLocalMonthlyTherapists(loadedMonthlyTherapists);
        }
      }
      return { memos: loadedMemos, monthlyTherapists: loadedMonthlyTherapists, therapists: safeTherapists };
    } finally {
      if (scheduleReloadRequestRef.current === requestId) {
        setIsScheduleLoading(false);
      }
    }
  }, [currentYear, currentMonth, loadShockwaveMemos, loadMonthlyTherapists, safeTherapists]);

  const syncCurrentManualStatsFromScheduleSource = useCallback(async ({
    upToToday = true,
    overwriteManual = false,
    emitEvent = false,
    memosOverride = null,
    monthlyTherapistsOverride = null,
  } = {}) => {
    if (safeTherapists.length === 0) return null;

    const [sourceMemos, sourceMonthlyTherapists] = await Promise.all([
      resolveScheduleMemosForStatsMonth({
        year: currentYear,
        month: currentMonth,
        settings: shockwaveSettings,
        visibleMemos: memosOverride,
      }),
      Array.isArray(monthlyTherapistsOverride)
        ? Promise.resolve(monthlyTherapistsOverride)
        : loadStatsMonthlyTherapists({
            year: currentYear,
            month: currentMonth,
            type: 'manual_therapy',
            baseTherapists: safeTherapists,
          }),
    ]);
    const sourcePrefix = `manual-source:${currentYear}-${String(currentMonth).padStart(2, '0')}`;

    const syncResult = await syncMonthManualTherapyScheduleToStats({
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

    const normalizedSourceLogs = Array.isArray(syncResult?.rebuiltRows)
      ? normalizeManualSourceLogs(
          syncResult.rebuiltRows,
          sourcePrefix,
          allPrescriptions,
          {
            memos: sourceMemos,
            year: currentYear,
            month: currentMonth,
            settings: shockwaveSettings,
            scheduleAuthoritative: true,
          }
        )
      : null;

    return {
      memos: sourceMemos,
      monthlyTherapists: sourceMonthlyTherapists,
      therapists: safeTherapists,
      logs: normalizedSourceLogs,
    };
  }, [allPrescriptions, currentMonth, currentYear, safeTherapists, shockwaveSettings]);

  useEffect(() => {
    if (!settingsReady || !therapistsReady || safeTherapists.length === 0) return undefined;

    let active = true;
    const requestId = ++scheduleReloadRequestRef.current;

    (async () => {
      try {
        // 1. 서로 독립적인 월별 치료사/스케줄 데이터를 동시에 로드 (Context 캐시 우선 활용)
        const [loadedMonthlyTherapists, loadedMemos] = await Promise.all([
          loadMonthlyTherapists(currentYear, currentMonth, 'manual_therapy'),
          loadShockwaveMemos(currentYear, currentMonth, { silent: true }),
        ]);
        if (!active || scheduleReloadRequestRef.current !== requestId) return;
        if (Array.isArray(loadedMonthlyTherapists)) {
          setLocalMonthlyTherapists(loadedMonthlyTherapists);
        }
        if (!loadedMemos || typeof loadedMemos !== 'object') {
          throw new Error('현재 월 스케줄 화면 데이터를 불러오지 못했습니다.');
        }

        const therapistRosterSignature = safeTherapists
          .map((t, idx) => `${t?.slot_index ?? idx}:${t?.name || ''}`)
          .join('|');
        const monthlyRosterSignature = (Array.isArray(loadedMonthlyTherapists) ? loadedMonthlyTherapists : [])
          .map((t) => `${t?.slot_index ?? ''}:${t?.therapist_name || ''}:${t?.start_day ?? ''}:${t?.end_day ?? ''}`)
          .join('|');
        const syncKey = `${currentMonthKey}:${buildScheduleMemoSignature(loadedMemos)}:${therapistRosterSignature}:${monthlyRosterSignature}:${manualSettingsSyncSignature}`;

        const cached = manualTherapyCurrentCache.get(currentMonthKey);
        if (cached && cached.syncKey === syncKey && Array.isArray(cached.logs)) {
          logsLoadedKeyRef.current = currentMonthKey;
          lastAutoSyncKeyRef.current = syncKey;
          setLogs(cached.logs);
          return;
        }
        if (lastAutoSyncKeyRef.current === syncKey && logsLoadedKeyRef.current === currentMonthKey) {
          return;
        }

        if (logsLoadedKeyRef.current !== currentMonthKey) {
          setIsScheduleLoading(true);
        }

        // 2. 스케줄 원본 기준 자동 동기화 및 결과 행 직접 반영
        const synced = await syncCurrentManualStatsFromScheduleSource({
          upToToday: true,
          emitEvent: false,
          memosOverride: loadedMemos,
          monthlyTherapistsOverride: loadedMonthlyTherapists,
        });
        if (!active || scheduleReloadRequestRef.current !== requestId) return;

        let finalLogs = synced?.logs;
        if (Array.isArray(finalLogs)) {
          logsLoadedKeyRef.current = currentMonthKey;
          setLogs(finalLogs);
        } else {
          finalLogs = await fetchLogs({
            memosOverride: synced?.memos ?? loadedMemos ?? {},
            scheduleAuthoritative: true,
          });
        }

        if (active && scheduleReloadRequestRef.current === requestId && Array.isArray(finalLogs)) {
          lastAutoSyncKeyRef.current = syncKey;
          manualTherapyCurrentCache.set(currentMonthKey, {
            syncKey,
            logs: finalLogs,
            monthlyTherapists: Array.isArray(loadedMonthlyTherapists) ? loadedMonthlyTherapists : [],
          });
        }
      } catch (err) {
        console.error('달 이동 중 도수치료 통계 자동 동기화 실패:', err);
      } finally {
        if (active && scheduleReloadRequestRef.current === requestId) {
          setIsScheduleLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [
    currentMonth,
    currentMonthKey,
    currentYear,
    currentMemosSyncSignature,
    fetchLogs,
    loadMonthlyTherapists,
    loadShockwaveMemos,
    manualSettingsSyncSignature,
    safeTherapists,
    settingsReady,
    syncCurrentManualStatsFromScheduleSource,
    therapistsReady,
  ]);

  // 탭이 다시 보일 때 (visibility change) 과도한 강제 재조회를 방지하기 위해 최소 30초 간격으로 갱신
  const lastVisibilityRefreshAtRef = useRef(0);
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        if (now - lastVisibilityRefreshAtRef.current < 30000) return;
        lastVisibilityRefreshAtRef.current = now;
        reloadScheduleData({ force: false });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [reloadScheduleData]);

  // 수동 새로고침
  const [isReloading, setIsReloading] = useState(false);
  const handleReload = useCallback(async () => {
    setIsReloading(true);
    try {
      manualTherapyCurrentCache.delete(currentMonthKey);
      clearManualTherapySixMonthCache();
      const reloaded = await reloadScheduleData({ force: true });
      if (!reloaded?.memos || typeof reloaded.memos !== 'object') {
        throw new Error('현재 월 스케줄 화면 데이터를 불러오지 못했습니다.');
      }
      lastAutoSyncKeyRef.current = null;
      const synced = await syncCurrentManualStatsFromScheduleSource({
        upToToday: true,
        emitEvent: false,
        memosOverride: reloaded?.memos,
        monthlyTherapistsOverride: reloaded?.monthlyTherapists,
      });
      if (!synced) {
        addToast('도수치료사 목록을 불러오지 못해 통계 동기화를 건너뛰었습니다.', 'error');
        return;
      }
      let finalLogs = synced.logs;
      if (Array.isArray(finalLogs)) {
        logsLoadedKeyRef.current = currentMonthKey;
        setLogs(finalLogs);
      } else {
        finalLogs = await fetchLogs({
          memosOverride: synced?.memos ?? reloaded?.memos ?? shockwaveMemos,
          scheduleAuthoritative: true,
        });
      }
      if (Array.isArray(finalLogs)) {
        const therapistRosterSignature = safeTherapists
          .map((t, idx) => `${t?.slot_index ?? idx}:${t?.name || ''}`)
          .join('|');
        const monthlyRosterSignature = (Array.isArray(reloaded?.monthlyTherapists) ? reloaded.monthlyTherapists : [])
          .map((t) => `${t?.slot_index ?? ''}:${t?.therapist_name || ''}:${t?.start_day ?? ''}:${t?.end_day ?? ''}`)
          .join('|');
        const syncKey = `${currentMonthKey}:${buildScheduleMemoSignature(synced.memos)}:${therapistRosterSignature}:${monthlyRosterSignature}:${manualSettingsSyncSignature}`;
        lastAutoSyncKeyRef.current = syncKey;
        manualTherapyCurrentCache.set(currentMonthKey, {
          syncKey,
          logs: finalLogs,
          monthlyTherapists: Array.isArray(reloaded?.monthlyTherapists) ? reloaded.monthlyTherapists : [],
        });
      }
      addToast('도수치료 통계 데이터를 새로 불러왔습니다.', 'success');
    } catch (err) {
      console.error(err);
      addToast('데이터 새로고침 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsReloading(false);
    }
  }, [
    addToast,
    currentMonthKey,
    fetchLogs,
    manualSettingsSyncSignature,
    reloadScheduleData,
    safeTherapists,
    shockwaveMemos,
    syncCurrentManualStatsFromScheduleSource,
  ]);

  // 연월 변경 시의 로그 초기화 및 데이터 로드는 위 통합된 useEffect에서 자동으로 처리됩니다.

  useEffect(() => {
    const handleStatsUpdated = () => {
      manualTherapyCurrentCache.clear();
      clearManualTherapySixMonthCache();
      fetchLogs();
    };
    window.addEventListener('clinic-stats-updated', handleStatsUpdated);
    return () => {
      window.removeEventListener('clinic-stats-updated', handleStatsUpdated);
    };
  }, [fetchLogs]);

  useEffect(() => {
    setActiveSection('grid');
  }, [currentMonth, currentYear]);

  const handleSyncFromScheduler = useCallback(async () => {
    setIsLogsLoading(true);
    try {
      manualTherapyCurrentCache.delete(currentMonthKey);
      clearManualTherapySixMonthCache();
      const result = await syncTodayManualTherapyScheduleToStats({
        year: currentYear,
        month: currentMonth,
        memos: shockwaveMemos,
        therapists: safeTherapists,
        monthlyTherapists: monthlyManualTherapists,
        settings: shockwaveSettings,
      });

      if (result.skipped && result.reason === 'today_outside_current_month') {
        addToast('오늘 날짜가 포함된 이번 달 스케줄러에서만 동기화할 수 있습니다.', 'info');
        return;
      }

      if (result.extractedCount === 0) {
        addToast('오늘 스케줄러에 해당하는 도수치료 내역이 없습니다.', 'info');
      }

      if (result.totalUpdates > 0) {
        addToast(`오늘 스케줄과 동기화 성공! (추가:${result.insertedCount}, 제거:${result.deletedCount})`, 'success');
        await fetchLogs();
      } else {
        addToast('오늘 스케줄과 도수치료 현황이 이미 일치합니다.', 'info');
      }
    } catch (error) {
      console.error(error);
      addToast('도수치료 데이터 동기화 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsLogsLoading(false);
    }
  }, [addToast, currentMonth, currentMonthKey, currentYear, fetchLogs, safeTherapists, shockwaveMemos, monthlyManualTherapists, shockwaveSettings]);

  const handleSyncMonthFromScheduler = useCallback(async () => {
    if (!window.confirm(`${currentMonth}월 전체 도수치료 스케줄을 스케줄러 기준으로 덮어씁니다.\n(수동으로 추가한 내역은 모두 삭제됩니다.) 진행하시겠습니까?`)) return;
    setIsLogsLoading(true);
    try {
      manualTherapyCurrentCache.delete(currentMonthKey);
      clearManualTherapySixMonthCache();
      const reloaded = await reloadScheduleData({ force: true });
      if (!reloaded?.memos || typeof reloaded.memos !== 'object') {
        throw new Error('현재 월 스케줄 화면 데이터를 불러오지 못했습니다.');
      }
      const result = await syncCurrentManualStatsFromScheduleSource({
        upToToday: false,
        overwriteManual: true,
        emitEvent: false,
        memosOverride: reloaded?.memos,
        monthlyTherapistsOverride: reloaded?.monthlyTherapists,
      });

      if (result) {
        addToast('전체 월 도수치료 스케줄을 스케줄러 기준으로 다시 동기화했습니다.', 'success');
        if (Array.isArray(result.logs)) {
          logsLoadedKeyRef.current = currentMonthKey;
          setLogs(result.logs);
        } else {
          await fetchLogs({ memosOverride: result.memos, scheduleAuthoritative: true });
        }
      } else {
        addToast('도수치료사 목록을 불러오지 못해 전체 월 동기화를 건너뛰었습니다.', 'error');
      }
    } catch (error) {
      console.error(error);
      addToast('전체 월 데이터 동기화 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsLogsLoading(false);
    }
  }, [addToast, currentMonth, currentMonthKey, fetchLogs, reloadScheduleData, syncCurrentManualStatsFromScheduleSource]);

  const handleSaveSettlementSettings = useCallback(async (nextSettings) => {
    const ok = await saveShockwaveSettings(nextSettings);
    if (ok) {
      manualTherapyCurrentCache.clear();
      clearManualTherapySixMonthCache();
      lastAutoSyncKeyRef.current = null;
      await loadShockwaveSettings();
    }
    addToast(ok ? '이번 달 도수치료 결산 설정을 저장했습니다.' : '결산 설정 저장에 실패했습니다.', ok ? 'success' : 'error');
  }, [addToast, loadShockwaveSettings, saveShockwaveSettings]);


  const secondarySectionsReady = shouldPrepareStatsSecondarySections({
    dataReady: monthlyTherapistsReady,
    isPrimaryLoading: isLoading,
  });
  const keepSettlementMounted = shouldKeepStatsSectionMounted({
    activeSection,
    targetSection: 'settlement',
    secondarySectionsReady,
  });
  const keepNewPatientsMounted = shouldKeepStatsSectionMounted({
    activeSection,
    targetSection: 'new-patients',
    secondarySectionsReady,
  });

  return (
    <div className="animate-fade-in" style={{ height: '100%', overflow: 'auto' }}>
      <ManualTherapyStatsPageErrorBoundary>
        <div className="sw-stats-container sw-stats-container--manual animate-fade-in">
          {isLoading && <div className="top-loading-bar" />}
          <div className="sw-stats-layout sw-stats-layout--compact">
            <aside className="sw-stats-sidebar sw-stats-sidebar--compact" aria-label="통계 메뉴 및 치료사 필터">
              <button
                className={`sw-stats-side-tab sw-stats-side-tab--grid${activeSection === 'grid' ? ' active' : ''}`}
                aria-pressed={activeSection === 'grid'}
                onClick={() => setActiveSection('grid')}
              >
                도수치료 현황
              </button>
              <button
                className={`sw-stats-side-tab sw-stats-side-tab--settlement${activeSection === 'settlement' ? ' active' : ''}`}
                aria-pressed={activeSection === 'settlement'}
                onClick={() => setActiveSection('settlement')}
              >
                도수치료 결산
              </button>
              <button
                className={`sw-stats-side-tab sw-stats-side-tab--new-patients${activeSection === 'new-patients' ? ' active' : ''}`}
                aria-pressed={activeSection === 'new-patients'}
                onClick={() => setActiveSection('new-patients')}
              >
                신규 환자
              </button>
              {canManageStatsSettings && (
                <button
                  className={`sw-stats-side-tab sw-stats-side-tab--settings${activeSection === 'settings' ? ' active' : ''}`}
                  aria-pressed={activeSection === 'settings'}
                  onClick={() => setActiveSection('settings')}
                >
                  설정
                </button>
              )}

              <div className="sw-stats-sidebar-refresh">
                <button
                  type="button"
                  className="sw-stats-side-tab"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: isReloading ? 0.6 : 1 }}
                  onClick={handleReload}
                  disabled={isReloading || isLoading}
                  title="스케줄 데이터를 다시 불러와 통계에 반영합니다"
                >
                  <RefreshCw size={14} className={isReloading ? 'spin-animation' : ''} />
                  {isReloading ? '새로 고침 중...' : '새로 고침'}
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
                  {isLoading && visibleLogs.length === 0 ? (
                    <GridSkeleton rows={12} cols={8} />
                  ) : (
                    <div className="sw-grid-card">
                      <div className="sw-grid-card-table">
                        <ShockwaveDataGrid
                          logs={visibleLogs}
                          therapists={displayBaseTherapists}
                          monthlyTherapists={monthlyManualTherapists}
                          currentYear={currentYear}
                          currentMonth={currentMonth}
                          fetchLogs={fetchLogs}
                          onApplyTodaySchedule={handleSyncFromScheduler}
                          isApplyingTodaySchedule={isLoading}
                          onApplyMonthSchedule={handleSyncMonthFromScheduler}
                          isApplyingMonthSchedule={isLoading}
                          tableName="manual_therapy_patient_logs"
                          prescriptions={prescriptions}
                          frozenColumnCount={shockwaveSettings?.frozen_columns ?? 6}
                          title={`${currentYear}년 ${String(currentMonth).padStart(2, '0')}월 도수치료 현황`}
                          applyTodayLabel="오늘 도수 스케줄 적용"
                          secondarySummaryLabel="신환"
                          selectedTherapistNames={selectedTherapistNames}
                          onSelectedTherapistNamesChange={setSelectedTherapistNames}
                          readOnly
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {keepSettlementMounted && (
                <ManualTherapySettlementErrorBoundary>
                  <div
                    className="sw-stats-body sw-stats-body--settlement fade-transition-wrapper"
                    hidden={activeSection !== 'settlement'}
                  >
                    {isLoading && visibleLogs.length === 0 ? (
                      <SettlementSkeleton />
                    ) : (
                      <div className="sw-manual-settlement-container sw-manual-settlement-container--readable">
                        <ManualTherapyStatsView
                          currentMonth={currentMonth}
                          logs={visibleLogs}
                          therapists={displayBaseTherapists}
                          monthlyTherapists={monthlyManualTherapists}
                          prescriptions={prescriptions}
                          incentivePercentage={effectiveSettlementSettings.incentive_percentage}
                          prescriptionPrices={effectiveSettlementSettings.prescription_prices}
                          cryoPrescriptions={effectiveSettlementSettings.cryo_prescriptions}
                          cryoPrices={effectiveSettlementSettings.cryo_prices}
                          selectedTherapistNames={selectedTherapistNames}
                        />
                        <div className="sw-manual-summary-stack">
                          <label className="settlement-recent-visibility-toggle"><input type="checkbox" checked={showRecentSummary} onChange={(event) => setShowRecentSummary(event.target.checked)} />최근 결산/신환 현황 보기</label>
                          {showRecentSummary && activeSection === 'settlement' && (
                            <ManualTherapySixMonthStats
                              currentYear={currentYear}
                              currentMonth={currentMonth}
                              therapists={displayBaseTherapists}
                              settings={shockwaveSettings}
                              selectedTherapistNames={selectedTherapistNames}
                              currentMonthLogs={visibleLogs}
                            />
                          )}

                        </div>
                      </div>
                    )}
                  </div>
                </ManualTherapySettlementErrorBoundary>
              )}

          {keepNewPatientsMounted && (
            <div
              className="sw-stats-body sw-stats-body--settlement fade-transition-wrapper"
              hidden={activeSection !== 'new-patients'}
            >
              <ShockwaveNewPatientsView
                logs={visibleLogs}
                therapists={displayBaseTherapists}
                currentMonth={currentMonth}
                title={`${currentMonth}월 도수치료 신규환자`}
                monthlyTherapists={monthlyManualTherapists}
                selectedTherapistNames={selectedTherapistNames}
              />
            </div>
          )}

              {canManageStatsSettings && activeSection === 'settings' && (
                <SettlementSettingsPanel
                  type="manual_therapy"
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
      </ManualTherapyStatsPageErrorBoundary>
    </div>
  );
}

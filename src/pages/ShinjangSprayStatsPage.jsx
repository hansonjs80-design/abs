import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSchedule } from '../contexts/ScheduleContext';
import { useToast } from '../components/common/Toast';
import { GridSkeleton, SettlementSkeleton } from '../components/common/LoadingSkeleton';
import ShockwaveDataGrid from '../components/shockwave/ShockwaveDataGrid';
import ShockwaveNewPatientsView from '../components/shockwave/ShockwaveNewPatientsView';
import ShinjangSprayStatsView from '../components/shockwave/ShinjangSprayStatsView';
import ShinjangSpraySettingsPanel from '../components/shockwave/ShinjangSpraySettingsPanel';
import { supabase } from '../lib/supabaseClient';
import { isAdminUser } from '../lib/authPermissions';
import { getTodayKST } from '../lib/calendarUtils';
import { buildDisplayTherapists } from '../lib/therapistDisplayUtils';
import { normalizeManualTherapyLogRows } from '../lib/manualTherapyLogUtils';
import { syncMonthManualTherapyScheduleToStats } from '../lib/manualTherapyUtils';
import { syncMonthShockwaveScheduleToStats } from '../lib/shockwaveSyncUtils';
import {
  getEffectiveSettlementSettings,
  getEffectiveShinjangSpraySettings,
  setMonthlyShinjangSpraySettings,
} from '../lib/settlementSettings';
import {
  applyMonthlyShinjangSprayTherapists,
  buildShinjangSprayDefaultTherapists,
  buildShinjangSprayPrescriptions,
  mergeShinjangSprayLogs,
} from '../lib/shinjangSprayStatsUtils';
import '../styles/shockwave_stats.css';
import '../styles/shinjang_spray_stats.css';

const LOG_FIELDS = 'id,date,patient_name,chart_number,visit_count,body_part,therapist_name,prescription,prescription_count,source,scheduler_cell_key,created_at';

function buildUniqueTherapists({
  rows,
  shinjangSprayTherapists,
  monthlyShinjangSprayTherapists,
}) {
  const therapistsByName = new Map();
  const add = (therapist) => {
    const name = String(therapist?.name || therapist?.therapist_name || '').trim();
    if (!name || therapistsByName.has(name)) return;
    therapistsByName.set(name, {
      ...therapist,
      id: therapist?.key || therapist?.id || name,
      key: therapist?.key || therapist?.id || name,
      name,
      displayName: therapist?.displayName || name,
    });
  };

  buildDisplayTherapists(
    shinjangSprayTherapists,
    monthlyShinjangSprayTherapists
  ).forEach(add);
  (Array.isArray(rows) ? rows : []).forEach(add);
  return [...therapistsByName.values()];
}

function buildMonthQuery(tableName, currentYear, currentMonth) {
  const startDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
  const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;
  const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  const today = getTodayKST();
  const isCurrentMonth = today.getFullYear() === currentYear
    && today.getMonth() + 1 === currentMonth;
  const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  let query = supabase
    .from(tableName)
    .select(LOG_FIELDS)
    .gte('date', startDate);
  query = isCurrentMonth ? query.lte('date', todayDate) : query.lt('date', endDate);
  return query
    .order('date', { ascending: true })
    .order('created_at', { ascending: true });
}

export default function ShinjangSprayStatsPage() {
  const {
    currentYear,
    currentMonth,
    therapists,
    manualTherapists,
    shockwaveMemos,
    shockwaveSettings,
    loadTherapists,
    loadManualTherapists,
    loadMonthlyTherapists,
    loadShockwaveMemos,
    loadShockwaveSettings,
    saveShockwaveSettings,
  } = useSchedule();
  const { user } = useAuth();
  const { addToast } = useToast();
  const canManageSettings = isAdminUser(user);
  const [activeSection, setActiveSection] = useState('grid');
  const [shockwaveLogs, setShockwaveLogs] = useState([]);
  const [manualLogs, setManualLogs] = useState([]);
  const [localShockwaveTherapists, setLocalShockwaveTherapists] = useState([]);
  const [localManualTherapists, setLocalManualTherapists] = useState([]);
  const [monthlyShinjangSprayTherapists, setMonthlyShinjangSprayTherapists] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);
  const settingsRef = useRef(shockwaveSettings);
  const memosRef = useRef(shockwaveMemos);

  useEffect(() => {
    settingsRef.current = shockwaveSettings;
  }, [shockwaveSettings]);

  useEffect(() => {
    memosRef.current = shockwaveMemos;
  }, [shockwaveMemos]);

  useEffect(() => {
    if (!canManageSettings && activeSection === 'settings') {
      setActiveSection('grid');
    }
  }, [activeSection, canManageSettings]);

  const refreshData = useCallback(async ({ force = false } = {}) => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      const [
        loadedShockwaveTherapists,
        loadedManualTherapists,
        loadedMonthlyShockwave,
        loadedMonthlyManual,
        loadedMonthlyShinjangSpray,
        loadedMemos,
        loadedSettings,
      ] = await Promise.all([
        loadTherapists({ force }),
        loadManualTherapists({ force }),
        loadMonthlyTherapists(currentYear, currentMonth, 'shockwave'),
        loadMonthlyTherapists(currentYear, currentMonth, 'manual_therapy'),
        loadMonthlyTherapists(currentYear, currentMonth, 'shinjang_spray'),
        loadShockwaveMemos(currentYear, currentMonth, { force, silent: true }),
        loadShockwaveSettings({ force }),
      ]);
      if (requestId !== requestIdRef.current) return;

      const settingsForMonth = loadedSettings || settingsRef.current || {};
      const manualSettings = getEffectiveSettlementSettings(
        settingsForMonth,
        currentYear,
        currentMonth,
        'manual_therapy'
      );
      const memosForMonth = loadedMemos && typeof loadedMemos === 'object'
        ? loadedMemos
        : memosRef.current;
      const hasAuthoritativeSchedule = Boolean(loadedMemos && typeof loadedMemos === 'object');

      if (hasAuthoritativeSchedule) {
        const syncTasks = [];
        if (Array.isArray(loadedShockwaveTherapists) && loadedShockwaveTherapists.length > 0) {
          syncTasks.push(syncMonthShockwaveScheduleToStats({
            year: currentYear,
            month: currentMonth,
            memos: memosForMonth,
            therapists: loadedShockwaveTherapists,
            monthlyTherapists: loadedMonthlyShockwave,
            settings: settingsForMonth,
            upToToday: true,
            scheduleAuthoritative: true,
            emitEvent: false,
            replaceExistingMonthLogs: true,
          }));
        }
        if (Array.isArray(loadedManualTherapists) && loadedManualTherapists.length > 0) {
          syncTasks.push(syncMonthManualTherapyScheduleToStats({
            year: currentYear,
            month: currentMonth,
            memos: memosForMonth,
            therapists: loadedManualTherapists,
            monthlyTherapists: loadedMonthlyManual,
            settings: settingsForMonth,
            upToToday: true,
            scheduleAuthoritative: true,
            emitEvent: false,
            replaceExistingMonthLogs: true,
          }));
        }
        const syncResults = await Promise.allSettled(syncTasks);
        syncResults.forEach((result) => {
          if (result.status === 'rejected') {
            console.error('Shinjang spray source statistics sync failed:', result.reason);
          }
        });
      }

      const [shockwaveResult, manualResult] = await Promise.all([
        buildMonthQuery('shockwave_patient_logs', currentYear, currentMonth),
        buildMonthQuery('manual_therapy_patient_logs', currentYear, currentMonth),
      ]);
      if (requestId !== requestIdRef.current) return;
      if (shockwaveResult.error) throw shockwaveResult.error;
      if (manualResult.error) throw manualResult.error;
      const normalizedManualLogs = normalizeManualTherapyLogRows(
        manualResult.data || [],
        manualSettings.prescriptions,
        {
          memos: memosForMonth,
          year: currentYear,
          month: currentMonth,
          settings: settingsForMonth,
          scheduleAuthoritative: hasAuthoritativeSchedule,
        }
      );

      setLocalShockwaveTherapists(Array.isArray(loadedShockwaveTherapists) ? loadedShockwaveTherapists : []);
      setLocalManualTherapists(Array.isArray(loadedManualTherapists) ? loadedManualTherapists : []);
      setMonthlyShinjangSprayTherapists(
        Array.isArray(loadedMonthlyShinjangSpray) ? loadedMonthlyShinjangSpray : []
      );
      setShockwaveLogs(shockwaveResult.data || []);
      setManualLogs(normalizedManualLogs);
    } catch (error) {
      if (requestId === requestIdRef.current) {
        console.error('Shinjang spray statistics load failed:', error);
        addToast('신장분사 통계를 불러오는데 실패했습니다.', 'error');
      }
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [
    addToast,
    currentMonth,
    currentYear,
    loadManualTherapists,
    loadMonthlyTherapists,
    loadShockwaveMemos,
    loadShockwaveSettings,
    loadTherapists,
  ]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  useEffect(() => {
    const handleStatsUpdated = () => refreshData();
    window.addEventListener('clinic-stats-updated', handleStatsUpdated);
    return () => window.removeEventListener('clinic-stats-updated', handleStatsUpdated);
  }, [refreshData]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshData({ force: true });
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [refreshData]);

  const spraySettings = useMemo(() => getEffectiveShinjangSpraySettings(
    shockwaveSettings,
    currentYear,
    currentMonth
  ), [currentMonth, currentYear, shockwaveSettings]);
  const sourceCombinedRows = useMemo(() => mergeShinjangSprayLogs({
    shockwaveRows: shockwaveLogs,
    manualTherapyRows: manualLogs,
    shockwavePrescriptionPrices: spraySettings.prescription_prices,
    manualTherapyPrescriptionPrices: spraySettings.prescription_prices,
    shockwaveCryoPrescriptions: spraySettings.cryo_prescriptions,
    shockwaveCryoPrices: spraySettings.cryo_prices,
    manualTherapyCryoPrescriptions: spraySettings.cryo_prescriptions,
    manualTherapyCryoPrices: spraySettings.cryo_prices,
  }), [
    manualLogs,
    shockwaveLogs,
    spraySettings.cryo_prescriptions,
    spraySettings.cryo_prices,
    spraySettings.prescription_prices,
  ]);
  const combinedRows = useMemo(() => applyMonthlyShinjangSprayTherapists(
    sourceCombinedRows,
    monthlyShinjangSprayTherapists
  ), [monthlyShinjangSprayTherapists, sourceCombinedRows]);
  const prescriptions = useMemo(() => buildShinjangSprayPrescriptions({
    configuredPrescriptions: spraySettings.prescriptions,
    rows: combinedRows,
  }), [combinedRows, spraySettings.prescriptions]);
  const prescriptionPrices = spraySettings.prescription_prices;
  const shinjangSprayTherapists = useMemo(() => buildShinjangSprayDefaultTherapists({
    shockwaveTherapists: localShockwaveTherapists.length > 0
      ? localShockwaveTherapists
      : therapists,
    manualTherapists: localManualTherapists.length > 0
      ? localManualTherapists
      : manualTherapists,
  }), [
    localManualTherapists,
    localShockwaveTherapists,
    manualTherapists,
    therapists,
  ]);
  const availableTherapists = useMemo(() => buildUniqueTherapists({
    rows: combinedRows,
    shinjangSprayTherapists,
    monthlyShinjangSprayTherapists,
  }), [
    combinedRows,
    monthlyShinjangSprayTherapists,
    shinjangSprayTherapists,
  ]);
  const displayTherapists = useMemo(() => {
    if (!Array.isArray(spraySettings.therapist_names)) return availableTherapists;
    const configuredNames = new Set(spraySettings.therapist_names);
    return availableTherapists.filter((therapist) => configuredNames.has(therapist.name));
  }, [availableTherapists, spraySettings.therapist_names]);
  const therapistNameList = useMemo(
    () => displayTherapists.map((therapist) => therapist.name).filter(Boolean),
    [displayTherapists]
  );
  const therapistNameKey = useMemo(() => therapistNameList.join('\u0001'), [therapistNameList]);
  const [selectedTherapistNames, setSelectedTherapistNames] = useState([]);
  useEffect(() => {
    setSelectedTherapistNames(therapistNameList);
  }, [therapistNameKey, therapistNameList]);
  const selectedTherapistSet = useMemo(
    () => new Set(selectedTherapistNames),
    [selectedTherapistNames]
  );
  const selectedDisplayTherapists = useMemo(() => (
    displayTherapists.filter((therapist) => selectedTherapistSet.has(therapist.name))
  ), [displayTherapists, selectedTherapistSet]);
  const toggleTherapistFilter = useCallback((name) => {
    setSelectedTherapistNames((current) => {
      if (current.includes(name)) {
        if (current.length <= 1) return current;
        return current.filter((item) => item !== name);
      }
      return [...current, name];
    });
  }, []);

  const handleSaveSettings = useCallback(async ({
    prescriptions: nextPrescriptions,
    prescriptionPrices: nextPrescriptionPrices,
    cryoPrescriptions: nextCryoPrescriptions,
    cryoPrices: nextCryoPrices,
    prescriptionColors: nextPrescriptionColors,
    prescriptionIncentivePercentages,
    therapistNames,
  }) => {
    const settingsToUpdate = settingsRef.current || shockwaveSettings || {};
    const nextSettings = {
      ...settingsToUpdate,
      monthly_settlement_settings: setMonthlyShinjangSpraySettings(
        settingsToUpdate,
        currentYear,
        currentMonth,
        {
          prescriptions: nextPrescriptions,
          prescription_prices: nextPrescriptionPrices,
          cryo_prescriptions: nextCryoPrescriptions,
          cryo_prices: nextCryoPrices,
          prescription_colors: nextPrescriptionColors,
          prescription_incentive_percentages: prescriptionIncentivePercentages,
          therapist_names: therapistNames,
        }
      ),
    };
    const ok = await saveShockwaveSettings(nextSettings);
    if (ok) {
      settingsRef.current = nextSettings;
      await loadShockwaveSettings({ force: true });
    }
    addToast(
      ok ? '이번 달 신장분사 처방·크라이오·인센티브 설정을 저장했습니다.' : '신장분사 설정 저장에 실패했습니다.',
      ok ? 'success' : 'error'
    );
    return ok;
  }, [
    addToast,
    currentMonth,
    currentYear,
    loadShockwaveSettings,
    saveShockwaveSettings,
    shockwaveSettings,
  ]);

  return (
    <div className="animate-fade-in" style={{ height: '100%', overflow: 'auto' }}>
      <div className="sw-stats-container sw-stats-container--shinjang animate-fade-in">
        {isLoading && <div className="top-loading-bar" />}
        <div className="sw-stats-layout">
          <aside className="sw-stats-sidebar">
            <button
              type="button"
              className={`sw-stats-side-tab sw-stats-side-tab--grid${activeSection === 'grid' ? ' active' : ''}`}
              onClick={() => setActiveSection('grid')}
            >
              신장분사 현황
            </button>
            <button
              type="button"
              className={`sw-stats-side-tab sw-stats-side-tab--settlement${activeSection === 'settlement' ? ' active' : ''}`}
              onClick={() => setActiveSection('settlement')}
            >
              신장분사 결산
            </button>
            <button
              type="button"
              className={`sw-stats-side-tab sw-stats-side-tab--new-patients${activeSection === 'new-patients' ? ' active' : ''}`}
              onClick={() => setActiveSection('new-patients')}
            >
              신환
            </button>
            {canManageSettings && (
              <button
                type="button"
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
                style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: isLoading ? 0.6 : 1 }}
                onClick={() => refreshData({ force: true })}
                disabled={isLoading}
                title="충격파·도수 통계 기록을 다시 불러옵니다"
              >
                <RefreshCw size={14} className={isLoading ? 'spin-animation' : ''} />
                {isLoading ? '새로 고침 중...' : '새로 고침'}
              </button>
            </div>
            {therapistNameList.length > 1 && (
              <div className="sw-sidebar-filter" aria-label="치료사 필터">
                <div className="sw-sidebar-filter-title">치료사 필터</div>
                <div className="sw-sidebar-filter-list">
                  {displayTherapists.map((therapist, index) => {
                    const isSelected = selectedTherapistSet.has(therapist.name);
                    const isLastSelected = isSelected && selectedTherapistNames.length <= 1;
                    return (
                      <label
                        key={therapist.key || therapist.name}
                        className={`sw-sidebar-filter-chip tone-${index % 5} ${isSelected ? 'is-active' : ''}`}
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

          <main className="sw-stats-panel">
            {activeSection === 'grid' && (
              <div className="sw-stats-body sw-stats-body--grid fade-transition-wrapper">
                {isLoading && combinedRows.length === 0 ? (
                  <GridSkeleton rows={12} cols={8} />
                ) : (
                  <div className="sw-grid-card">
                    <div className="sw-grid-card-table">
                      <ShockwaveDataGrid
                        logs={combinedRows}
                        therapists={displayTherapists}
                        monthlyTherapists={[]}
                        currentYear={currentYear}
                        currentMonth={currentMonth}
                        fetchLogs={refreshData}
                        prescriptions={prescriptions}
                        totalRecordCount={combinedRows.length}
                        therapistCount={displayTherapists.length}
                        title={`${currentYear}년 ${String(currentMonth).padStart(2, '0')}월 신장분사 현황`}
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
            {activeSection === 'settlement' && (
              <div className="sw-stats-body sw-stats-body--settlement fade-transition-wrapper">
                {isLoading && combinedRows.length === 0 ? (
                  <SettlementSkeleton />
                ) : (
                  <ShinjangSprayStatsView
                    currentYear={currentYear}
                    currentMonth={currentMonth}
                    rows={combinedRows}
                    therapists={selectedDisplayTherapists}
                    prescriptions={prescriptions}
                    prescriptionPrices={prescriptionPrices}
                    incentivePercentages={spraySettings.prescription_incentive_percentages}
                    cryoPrescriptions={spraySettings.cryo_prescriptions}
                    cryoPrices={spraySettings.cryo_prices}
                  />
                )}
              </div>
            )}
            {activeSection === 'new-patients' && (
              <div className="sw-stats-body sw-stats-body--settlement fade-transition-wrapper">
                <ShockwaveNewPatientsView
                  logs={combinedRows}
                  therapists={displayTherapists}
                  monthlyTherapists={[]}
                  currentMonth={currentMonth}
                  title={`${currentMonth}월 신장분사 신환`}
                  selectedTherapistNames={selectedTherapistNames}
                />
              </div>
            )}
            {canManageSettings && activeSection === 'settings' && (
              <div className="sw-stats-body sw-stats-body--settlement fade-transition-wrapper">
                <ShinjangSpraySettingsPanel
                  year={currentYear}
                  month={currentMonth}
                  therapists={availableTherapists}
                  effectiveSettings={spraySettings}
                  onSave={handleSaveSettings}
                />
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSchedule } from '../contexts/ScheduleContext';
import { useToast } from '../components/common/Toast';
import { SettlementSkeleton } from '../components/common/LoadingSkeleton';
import ShinjangSprayStatsView from '../components/shockwave/ShinjangSprayStatsView';
import ShinjangSpraySettingsPanel from '../components/shockwave/ShinjangSpraySettingsPanel';
import { supabase } from '../lib/supabaseClient';
import { isAdminUser } from '../lib/authPermissions';
import { getTodayKST } from '../lib/calendarUtils';
import { buildDisplayTherapists } from '../lib/therapistDisplayUtils';
import { normalizeManualTherapyLogRows } from '../lib/manualTherapyLogUtils';
import {
  getEffectiveSettlementSettings,
  getEffectiveShinjangSpraySettings,
  setMonthlyShinjangSpraySettings,
} from '../lib/settlementSettings';
import {
  buildShinjangSprayPrescriptions,
  mergeShinjangSprayLogs,
} from '../lib/shinjangSprayStatsUtils';
import '../styles/shockwave_stats.css';
import '../styles/shinjang_spray_stats.css';

const LOG_FIELDS = 'id,date,patient_name,chart_number,visit_count,body_part,therapist_name,prescription,prescription_count,source,scheduler_cell_key,created_at';

function buildUniqueTherapists({
  rows,
  shockwaveTherapists,
  manualTherapists,
  monthlyShockwaveTherapists,
  monthlyManualTherapists,
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

  buildDisplayTherapists(shockwaveTherapists, monthlyShockwaveTherapists).forEach(add);
  buildDisplayTherapists(manualTherapists, monthlyManualTherapists).forEach(add);
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
  const [activeSection, setActiveSection] = useState('settlement');
  const [shockwaveLogs, setShockwaveLogs] = useState([]);
  const [manualLogs, setManualLogs] = useState([]);
  const [localShockwaveTherapists, setLocalShockwaveTherapists] = useState([]);
  const [localManualTherapists, setLocalManualTherapists] = useState([]);
  const [monthlyShockwaveTherapists, setMonthlyShockwaveTherapists] = useState([]);
  const [monthlyManualTherapists, setMonthlyManualTherapists] = useState([]);
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
      setActiveSection('settlement');
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
        loadedMemos,
        loadedSettings,
        shockwaveResult,
        manualResult,
      ] = await Promise.all([
        loadTherapists({ force }),
        loadManualTherapists({ force }),
        loadMonthlyTherapists(currentYear, currentMonth, 'shockwave'),
        loadMonthlyTherapists(currentYear, currentMonth, 'manual_therapy'),
        loadShockwaveMemos(currentYear, currentMonth, { force, silent: true }),
        loadShockwaveSettings({ force }),
        buildMonthQuery('shockwave_patient_logs', currentYear, currentMonth),
        buildMonthQuery('manual_therapy_patient_logs', currentYear, currentMonth),
      ]);
      if (requestId !== requestIdRef.current) return;
      if (shockwaveResult.error) throw shockwaveResult.error;
      if (manualResult.error) throw manualResult.error;

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
      const normalizedManualLogs = normalizeManualTherapyLogRows(
        manualResult.data || [],
        manualSettings.prescriptions,
        {
          memos: memosForMonth,
          year: currentYear,
          month: currentMonth,
          settings: settingsForMonth,
          scheduleAuthoritative: loadedMemos && typeof loadedMemos === 'object',
        }
      );

      setLocalShockwaveTherapists(Array.isArray(loadedShockwaveTherapists) ? loadedShockwaveTherapists : []);
      setLocalManualTherapists(Array.isArray(loadedManualTherapists) ? loadedManualTherapists : []);
      setMonthlyShockwaveTherapists(Array.isArray(loadedMonthlyShockwave) ? loadedMonthlyShockwave : []);
      setMonthlyManualTherapists(Array.isArray(loadedMonthlyManual) ? loadedMonthlyManual : []);
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
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshData({ force: true });
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [refreshData]);

  const shockwaveSettlementSettings = useMemo(() => getEffectiveSettlementSettings(
    shockwaveSettings,
    currentYear,
    currentMonth,
    'shockwave'
  ), [currentMonth, currentYear, shockwaveSettings]);
  const manualSettlementSettings = useMemo(() => getEffectiveSettlementSettings(
    shockwaveSettings,
    currentYear,
    currentMonth,
    'manual_therapy'
  ), [currentMonth, currentYear, shockwaveSettings]);
  const spraySettings = useMemo(() => getEffectiveShinjangSpraySettings(
    shockwaveSettings,
    currentYear,
    currentMonth
  ), [currentMonth, currentYear, shockwaveSettings]);
  const combinedRows = useMemo(() => mergeShinjangSprayLogs({
    shockwaveRows: shockwaveLogs,
    manualTherapyRows: manualLogs,
    shockwavePrescriptionPrices: shockwaveSettlementSettings.prescription_prices,
    manualTherapyPrescriptionPrices: manualSettlementSettings.prescription_prices,
  }), [manualLogs, manualSettlementSettings.prescription_prices, shockwaveLogs, shockwaveSettlementSettings.prescription_prices]);
  const prescriptions = useMemo(() => buildShinjangSprayPrescriptions({
    configuredPrescriptions: [
      ...shockwaveSettlementSettings.prescriptions,
      ...manualSettlementSettings.prescriptions,
    ],
    rows: combinedRows,
  }), [combinedRows, manualSettlementSettings.prescriptions, shockwaveSettlementSettings.prescriptions]);
  const prescriptionPrices = useMemo(() => ({
    ...shockwaveSettlementSettings.prescription_prices,
    ...manualSettlementSettings.prescription_prices,
  }), [manualSettlementSettings.prescription_prices, shockwaveSettlementSettings.prescription_prices]);
  const displayTherapists = useMemo(() => buildUniqueTherapists({
    rows: combinedRows,
    shockwaveTherapists: localShockwaveTherapists.length > 0 ? localShockwaveTherapists : therapists,
    manualTherapists: localManualTherapists.length > 0 ? localManualTherapists : manualTherapists,
    monthlyShockwaveTherapists,
    monthlyManualTherapists,
  }), [
    combinedRows,
    localManualTherapists,
    localShockwaveTherapists,
    manualTherapists,
    monthlyManualTherapists,
    monthlyShockwaveTherapists,
    therapists,
  ]);

  const handleSaveSettings = useCallback(async (prescriptionIncentivePercentages) => {
    const settingsToUpdate = settingsRef.current || shockwaveSettings || {};
    const nextSettings = {
      ...settingsToUpdate,
      monthly_settlement_settings: setMonthlyShinjangSpraySettings(
        settingsToUpdate,
        currentYear,
        currentMonth,
        { prescription_incentive_percentages: prescriptionIncentivePercentages }
      ),
    };
    const ok = await saveShockwaveSettings(nextSettings);
    if (ok) {
      settingsRef.current = nextSettings;
      await loadShockwaveSettings({ force: true });
    }
    addToast(
      ok ? '이번 달 신장분사 인센티브 설정을 저장했습니다.' : '신장분사 설정 저장에 실패했습니다.',
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
              className={`sw-stats-side-tab sw-stats-side-tab--shinjang${activeSection === 'settlement' ? ' active' : ''}`}
              onClick={() => setActiveSection('settlement')}
            >
              신장분사 통계
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
          </aside>

          <main className="sw-stats-panel">
            {activeSection === 'settlement' && (
              <div className="sw-stats-body sw-stats-body--settlement fade-transition-wrapper">
                {isLoading && combinedRows.length === 0 ? (
                  <SettlementSkeleton />
                ) : (
                  <ShinjangSprayStatsView
                    currentYear={currentYear}
                    currentMonth={currentMonth}
                    rows={combinedRows}
                    therapists={displayTherapists}
                    prescriptions={prescriptions}
                    prescriptionPrices={prescriptionPrices}
                    incentivePercentages={spraySettings.prescription_incentive_percentages}
                  />
                )}
              </div>
            )}
            {canManageSettings && activeSection === 'settings' && (
              <div className="sw-stats-body sw-stats-body--settlement fade-transition-wrapper">
                <ShinjangSpraySettingsPanel
                  year={currentYear}
                  month={currentMonth}
                  prescriptions={prescriptions}
                  prescriptionPrices={prescriptionPrices}
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

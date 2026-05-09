import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useSchedule } from '../contexts/ScheduleContext';
import { supabase } from '../lib/supabaseClient';
import { useToast } from '../components/common/Toast';
import { syncTodayManualTherapyScheduleToStats, syncMonthManualTherapyScheduleToStats } from '../lib/manualTherapyUtils';
import { getTodayKST } from '../lib/calendarUtils';
import { buildDisplayTherapists } from '../lib/therapistDisplayUtils';
import { GridSkeleton, SettlementSkeleton } from '../components/common/LoadingSkeleton';
import ShockwaveDataGrid from '../components/shockwave/ShockwaveDataGrid';
import ShockwaveNewPatientsView from '../components/shockwave/ShockwaveNewPatientsView';
import ManualTherapyStatsView from '../components/shockwave/ManualTherapyStatsView';
import ManualTherapySixMonthStats from '../components/shockwave/ManualTherapySixMonthStats';
import SettlementSettingsPanel from '../components/shockwave/SettlementSettingsPanel';
import { getEffectiveSettlementSettings } from '../lib/settlementSettings';
const MANUAL_THERAPY_SHEET_ID = '1-R_p3eyxwXISFTYX5G7_ec5L0kgUIhNbIwA9AdEj-9U';

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
    loadShockwaveMemos,
    shockwaveSettings,
    loadShockwaveSettings,
    saveShockwaveSettings,
    monthlyManualTherapists: contextMonthlyManualTherapists,
    loadMonthlyTherapists,
  } = useSchedule();
  const { addToast } = useToast();
  const [logs, setLogs] = useState([]);
  const [activeSection, setActiveSection] = useState('grid');
  const [schedulerMemosReady, setSchedulerMemosReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [extraDraftRows, setExtraDraftRows] = useState(0);
  const [isAutoSyncingToday, setIsAutoSyncingToday] = useState(false);
  const [localMonthlyTherapists, setLocalMonthlyTherapists] = useState([]);
  const lastAutoSyncKeyRef = useRef(null);
  const scheduleReloadRequestRef = useRef(0);

  // 연월 변경 시 로컬 치료사 목록을 즉시 초기화
  const monthKeyRef = useRef(`${currentYear}-${currentMonth}`);
  const currentMonthKey = useMemo(() => `${currentYear}-${currentMonth}`, [currentYear, currentMonth]);
  if (monthKeyRef.current !== currentMonthKey) {
    monthKeyRef.current = currentMonthKey;
    setLocalMonthlyTherapists([]);
  }

  // prop으로 관리되는 로컬 치료사 목록이 있으면 우선 사용 (전역 상태 race condition 방지)
  const monthlyManualTherapists = (Array.isArray(localMonthlyTherapists) && localMonthlyTherapists.length > 0)
    ? localMonthlyTherapists
    : contextMonthlyManualTherapists;

  const safeTherapists = useMemo(
    () => (Array.isArray(manualTherapists) ? manualTherapists.filter(Boolean) : []),
    [manualTherapists]
  );
  const effectiveSettlementSettings = useMemo(
    () => getEffectiveSettlementSettings(shockwaveSettings, currentYear, currentMonth, 'manual_therapy'),
    [shockwaveSettings, currentYear, currentMonth]
  );
  const prescriptions = useMemo(
    () => effectiveSettlementSettings.prescriptions,
    [effectiveSettlementSettings]
  );

  // Therapist filter state (lifted from ShockwaveDataGrid)
  const displayTherapists = useMemo(
    () => buildDisplayTherapists(safeTherapists, monthlyManualTherapists),
    [safeTherapists, monthlyManualTherapists]
  );
  const therapistNameList = useMemo(
    () => displayTherapists.map((t) => t.name).filter(Boolean),
    [displayTherapists]
  );
  const fetchIdRef = useRef(0);
  const [selectedTherapistNames, setSelectedTherapistNames] = useState([]);
  useEffect(() => {
    setSelectedTherapistNames((prev) => {
      if (therapistNameList.length === 0) return [];
      if (prev.length === 0) return therapistNameList;
      const valid = prev.filter((name) => therapistNameList.includes(name));
      return valid.length > 0 ? valid : therapistNameList;
    });
  }, [therapistNameList]);
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
    setIsLoading(true);
    try {
      const startStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
      const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;
      const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
      const endStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

      const currentFetchId = ++fetchIdRef.current;
      const { data, error } = await supabase
        .from('manual_therapy_patient_logs')
        .select('*')
        .gte('date', startStr)
        .lt('date', endStr)
        .order('date', { ascending: true })
        .order('created_at', { ascending: true });

      if (error) throw error;
      if (currentFetchId !== fetchIdRef.current) return [];
      setLogs(Array.isArray(data) ? data : []);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      if (currentFetchId === fetchIdRef.current) {
        console.error(error);
        addToast('도수치료 기록을 불러오는데 실패했습니다.', 'error');
      }
      return null;
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [addToast, currentMonth, currentYear]);

  useEffect(() => {
    loadManualTherapists();
    loadShockwaveSettings();
  }, [loadManualTherapists, loadShockwaveSettings]);

  const reloadScheduleData = useCallback(async ({ force = false } = {}) => {
    const requestId = ++scheduleReloadRequestRef.current;
    setSchedulerMemosReady(false);
    const loadedTherapists = await loadManualTherapists();
    const [loadedMemos, loadedMonthlyTherapists] = await Promise.all([
      loadShockwaveMemos(currentYear, currentMonth, { force }),
      loadMonthlyTherapists(currentYear, currentMonth, 'manual_therapy'),
    ]);
    if (scheduleReloadRequestRef.current === requestId) {
      setSchedulerMemosReady(true);
      if (Array.isArray(loadedMonthlyTherapists)) {
        setLocalMonthlyTherapists(loadedMonthlyTherapists);
      }
    }
    return { memos: loadedMemos, monthlyTherapists: loadedMonthlyTherapists, therapists: loadedTherapists };
  }, [currentYear, currentMonth, loadShockwaveMemos, loadMonthlyTherapists, loadManualTherapists]);

  useEffect(() => {
    let active = true;
    const requestId = ++scheduleReloadRequestRef.current;
    setSchedulerMemosReady(false);

    (async () => {
      await loadManualTherapists();
      const [, loadedMonthlyTherapists] = await Promise.all([
        loadShockwaveMemos(currentYear, currentMonth),
        loadMonthlyTherapists(currentYear, currentMonth, 'manual_therapy'),
      ]);
      if (active && scheduleReloadRequestRef.current === requestId) {
        setSchedulerMemosReady(true);
        if (Array.isArray(loadedMonthlyTherapists)) {
          setLocalMonthlyTherapists(loadedMonthlyTherapists);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [currentMonth, currentYear, loadShockwaveMemos, loadMonthlyTherapists, loadManualTherapists]);

  // 탭이 다시 보일 때 (visibility change) 자동으로 데이터 갱신
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        reloadScheduleData({ force: true });
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
      setSchedulerMemosReady(false);
      const reloaded = await reloadScheduleData({ force: true });
      lastAutoSyncKeyRef.current = null;
      const latestTherapists = Array.isArray(reloaded?.therapists) && reloaded.therapists.length > 0
        ? reloaded.therapists
        : safeTherapists;
      await syncMonthManualTherapyScheduleToStats({
        year: currentYear,
        month: currentMonth,
        memos: reloaded?.memos || shockwaveMemos,
        therapists: latestTherapists,
        monthlyTherapists: reloaded?.monthlyTherapists || monthlyManualTherapists,
        upToToday: true,
      });
      await fetchLogs();
      addToast('도수치료 통계 데이터를 새로 불러왔습니다.', 'success');
    } catch (err) {
      console.error(err);
      addToast('데이터 새로고침 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsReloading(false);
    }
  }, [reloadScheduleData, currentYear, currentMonth, shockwaveMemos, safeTherapists, monthlyManualTherapists, fetchLogs, addToast]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    setExtraDraftRows(0);
    setActiveSection('grid');
  }, [currentMonth, currentYear]);

  useEffect(() => {
    const today = getTodayKST();
    const isTodayMonth =
      currentYear === today.getFullYear() &&
      currentMonth === today.getMonth() + 1;
    const autoSyncKey = `${currentYear}-${currentMonth}`;

    if (
      !schedulerMemosReady ||
      safeTherapists.length === 0 ||
      isAutoSyncingToday
    ) {
      return;
    }
    if (lastAutoSyncKeyRef.current === autoSyncKey) {
      return;
    }

    let cancelled = false;

    (async () => {
      setIsAutoSyncingToday(true);
      lastAutoSyncKeyRef.current = autoSyncKey;
      try {
        const result = await syncMonthManualTherapyScheduleToStats({
          year: currentYear,
          month: currentMonth,
          memos: shockwaveMemos,
          therapists: safeTherapists,
          monthlyTherapists: monthlyManualTherapists,
          upToToday: true,
        });

        if (!cancelled && result?.totalUpdates > 0) {
          await fetchLogs();
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          addToast('오늘 도수치료 스케줄 동기화 중 오류가 발생했습니다.', 'error');
        }
      } finally {
        if (!cancelled) setIsAutoSyncingToday(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [schedulerMemosReady, currentYear, currentMonth, safeTherapists, isAutoSyncingToday, shockwaveMemos, monthlyManualTherapists, fetchLogs, addToast]);

  const handleSyncFromScheduler = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await syncTodayManualTherapyScheduleToStats({
        year: currentYear,
        month: currentMonth,
        memos: shockwaveMemos,
        therapists: safeTherapists,
        monthlyTherapists: monthlyManualTherapists,
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
      setIsLoading(false);
    }
  }, [addToast, currentMonth, currentYear, fetchLogs, safeTherapists, shockwaveMemos]);

  const handleSyncMonthFromScheduler = useCallback(async () => {
    if (!window.confirm(`${currentMonth}월 전체 도수치료 스케줄을 스케줄러 기준으로 덮어씁니다.\n(수동으로 추가한 내역은 모두 삭제됩니다.) 진행하시겠습니까?`)) return;
    setIsLoading(true);
    try {
      const result = await syncMonthManualTherapyScheduleToStats({
        year: currentYear,
        month: currentMonth,
        memos: shockwaveMemos,
        therapists: safeTherapists,
        monthlyTherapists: monthlyManualTherapists,
        upToToday: false,
        overwriteManual: true,
      });

      if (result.totalUpdates > 0) {
        addToast(`전체 월 스케줄 동기화 성공! (추가:${result.totalInserted}, 삭제:${result.totalDeleted})`, 'success');
        await fetchLogs();
      } else {
        addToast('전체 스케줄과 도수치료 현황이 이미 일치합니다.', 'info');
      }
    } catch (error) {
      console.error(error);
      addToast('전체 월 데이터 동기화 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [addToast, currentMonth, currentYear, fetchLogs, safeTherapists, shockwaveMemos]);

  const handleImportFromGoogleSheet = useCallback(async () => {
    if (!window.confirm('현재 월의 도수치료 현황 데이터를 구글 시트 B:I 기준으로 다시 불러옵니다.\n기존 이번 달 도수치료 현황 데이터는 교체됩니다. 진행할까요?')) {
      return;
    }

    setIsLoading(true);
    try {
      const sheetName = `${String(currentYear).slice(-2)}.${String(currentMonth).padStart(2, '0')}`;
      const rows = await new Promise((resolve, reject) => {
        const callbackName = `manualTherapyImport_${Date.now()}`;
        const script = document.createElement('script');

        window[callbackName] = (data) => {
          try {
            delete window[callbackName];
            script.remove();
            if (!data || data.status !== 'ok' || !data.table?.rows) {
              reject(new Error('구글 시트 응답 형식이 올바르지 않습니다.'));
              return;
            }

            const normalizedRows = data.table.rows.map((row) =>
              (row.c || []).map((cell) => cell?.f ?? cell?.v ?? '')
            );
            resolve(normalizedRows);
          } catch (error) {
            reject(error);
          }
        };

        script.src =
          `https://docs.google.com/spreadsheets/d/${MANUAL_THERAPY_SHEET_ID}/gviz/tq?` +
          `tq=${encodeURIComponent('select B,C,D,E,F,G,H,I')}&` +
          `tqx=responseHandler:${callbackName}&sheet=${encodeURIComponent(sheetName)}`;
        script.onerror = () => {
          delete window[callbackName];
          script.remove();
          reject(new Error(`${sheetName} 시트를 불러오지 못했습니다.`));
        };
        document.body.appendChild(script);
      });

      const therapistHeaders = rows[2] || [];
      const prescriptionHeaders = rows[3] || [];
      const dynamicColumns = [];
      let activeTherapistName = '';

      for (let colIndex = 5; colIndex < therapistHeaders.length; colIndex += 1) {
        const therapistCell = String(therapistHeaders[colIndex] || '').trim();
        const prescriptionCell = String(prescriptionHeaders[colIndex] || '').trim();

        if (therapistCell.includes('총건수') || prescriptionCell.includes('건')) break;
        if (therapistCell) {
          activeTherapistName = therapistCell.replace(/\s*\(.+\)\s*$/, '').trim();
        }
        if (!activeTherapistName || !prescriptionCell) continue;

        dynamicColumns.push({
          colIndex,
          therapistName: activeTherapistName,
          prescription: prescriptionCell,
        });
      }

      let currentDateLabel = '';
      const importedRows = [];

      rows.slice(5).forEach((row) => {
        const dateCell = String(row[0] || '').trim();
        if (dateCell) currentDateLabel = dateCell;
        if (!currentDateLabel) return;

        const [mm, dd] = currentDateLabel.split('/');
        if (!mm || !dd) return;
        const isoDate = `${currentYear}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;

        dynamicColumns.forEach(({ colIndex, therapistName, prescription }) => {
          const rawCount = String(row[colIndex] || '').trim();
          const parsedCount = parseInt(rawCount, 10);
          if (!Number.isFinite(parsedCount) || parsedCount <= 0) return;

          importedRows.push({
            date: isoDate,
            patient_name: String(row[1] || '').trim(),
            chart_number: String(row[2] || '').trim(),
            visit_count: String(row[3] || '').trim(),
            body_part: String(row[4] || '').trim(),
            therapist_name: therapistName,
            prescription,
            prescription_count: parsedCount,
            source: 'sheet',
          });
        });
      });

      const startStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
      const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;
      const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
      const endStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

      const { error: deleteError } = await supabase
        .from('manual_therapy_patient_logs')
        .delete()
        .gte('date', startStr)
        .lt('date', endStr);
      if (deleteError) throw deleteError;

      if (importedRows.length > 0) {
        const { error: insertError } = await supabase
          .from('manual_therapy_patient_logs')
          .insert(importedRows);
        if (insertError) throw insertError;
      }

      await fetchLogs();
      addToast(`${sheetName} 시트에서 ${importedRows.length}건을 가져왔습니다.`, 'success');
    } catch (error) {
      console.error(error);
      addToast('구글 시트 B:I 가져오기에 실패했습니다.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [addToast, currentMonth, currentYear, fetchLogs]);

  const handleSaveSettlementSettings = useCallback(async (nextSettings) => {
    const ok = await saveShockwaveSettings(nextSettings);
    if (ok) await loadShockwaveSettings();
    addToast(ok ? '이번 달 도수치료 결산 설정을 저장했습니다.' : '결산 설정 저장에 실패했습니다.', ok ? 'success' : 'error');
  }, [addToast, loadShockwaveSettings, saveShockwaveSettings]);

  return (
    <div className="animate-fade-in" style={{ height: '100%', overflow: 'auto' }}>
      <ManualTherapyStatsPageErrorBoundary>
        <div className="sw-stats-container animate-fade-in">
          {isLoading && <div className="top-loading-bar" />}
          <div className="sw-stats-layout">
            <aside className="sw-stats-sidebar">
              <button
                className={`sw-stats-side-tab${activeSection === 'grid' ? ' active' : ''}`}
                onClick={() => setActiveSection('grid')}
              >
                도수치료 현황
              </button>
              <button
                className={`sw-stats-side-tab${activeSection === 'settlement' ? ' active' : ''}`}
                onClick={() => setActiveSection('settlement')}
              >
                도수치료 결산
              </button>
              <button
                className={`sw-stats-side-tab${activeSection === 'new-patients' ? ' active' : ''}`}
                onClick={() => setActiveSection('new-patients')}
              >
                신규환자
              </button>
              <button
                className={`sw-stats-side-tab${activeSection === 'settings' ? ' active' : ''}`}
                onClick={() => setActiveSection('settings')}
              >
                설정
              </button>

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
                  {isLoading && logs.length === 0 ? (
                    <GridSkeleton rows={12} cols={8} />
                  ) : (
                    <>
                      <div className="sw-grid-card">
                        <div className="sw-grid-card-table">
                          <ShockwaveDataGrid
                            logs={logs}
                            therapists={safeTherapists}
                            monthlyTherapists={monthlyManualTherapists}
                            currentYear={currentYear}
                            currentMonth={currentMonth}
                            fetchLogs={fetchLogs}
                            extraDraftRows={extraDraftRows}
                            onApplyTodaySchedule={handleSyncFromScheduler}
                            isApplyingTodaySchedule={isLoading}
                            onApplyMonthSchedule={handleSyncMonthFromScheduler}
                            isApplyingMonthSchedule={isLoading}
                            tableName="manual_therapy_patient_logs"
                            prescriptions={prescriptions}
                            frozenColumnCount={shockwaveSettings?.frozen_columns ?? 6}
                            title={`${currentMonth}월 도수치료 현황`}
                            applyTodayLabel="오늘 도수 스케줄 적용"
                            secondarySummaryLabel="신규"
                            selectedTherapistNames={selectedTherapistNames}
                            onSelectedTherapistNamesChange={setSelectedTherapistNames}
                          />
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
                <ManualTherapySettlementErrorBoundary>
                  <div className="sw-stats-body sw-stats-body--settlement fade-transition-wrapper">
                    {isLoading && logs.length === 0 ? (
                      <SettlementSkeleton />
                    ) : (
                      <>
                        <ManualTherapyStatsView
                          currentMonth={currentMonth}
                          logs={logs}
                          therapists={safeTherapists}
                          monthlyTherapists={monthlyManualTherapists}
                          prescriptions={prescriptions}
                          incentivePercentage={effectiveSettlementSettings.incentive_percentage}
                          prescriptionPrices={effectiveSettlementSettings.prescription_prices}
                          selectedTherapistNames={selectedTherapistNames}
                        />
                        <ManualTherapySixMonthStats
                          currentYear={currentYear}
                          currentMonth={currentMonth}
                          therapists={safeTherapists}
                          settings={shockwaveSettings}
                          selectedTherapistNames={selectedTherapistNames}
                        />
                      </>
                    )}
                  </div>
                </ManualTherapySettlementErrorBoundary>
              )}

              {activeSection === 'new-patients' && (
                <div className="sw-stats-body sw-stats-body--settlement fade-transition-wrapper">
                  <ShockwaveNewPatientsView
                    logs={logs}
                    therapists={safeTherapists}
                    currentMonth={currentMonth}
                    title={`${currentMonth}월 도수치료 신규환자`}
                    monthlyTherapists={monthlyManualTherapists}
                    selectedTherapistNames={selectedTherapistNames}
                  />
                </div>
              )}

              {activeSection === 'settings' && (
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

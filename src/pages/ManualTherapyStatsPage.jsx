import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { supabase } from '../lib/supabaseClient';
import { useToast } from '../components/common/Toast';
import { syncTodayManualTherapyScheduleToStats } from '../lib/manualTherapyUtils';
import { getTodayKST } from '../lib/calendarUtils';
import ShockwaveDataGrid from '../components/shockwave/ShockwaveDataGrid';

const ManualTherapyStatsView = React.lazy(() => import('../components/shockwave/ManualTherapyStatsView'));
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

export default function ManualTherapyStatsPage() {
  const {
    currentYear,
    currentMonth,
    manualTherapists,
    loadManualTherapists,
    shockwaveMemos,
    loadShockwaveMemos,
    shockwaveSettings,
  } = useSchedule();
  const { addToast } = useToast();
  const [logs, setLogs] = useState([]);
  const [activeSection, setActiveSection] = useState('grid');
  const [schedulerMemosReady, setSchedulerMemosReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [extraDraftRows, setExtraDraftRows] = useState(0);
  const [isAutoSyncingToday, setIsAutoSyncingToday] = useState(false);
  const lastAutoSyncKeyRef = useRef(null);

  const safeTherapists = useMemo(
    () => (Array.isArray(manualTherapists) ? manualTherapists.filter(Boolean) : []),
    [manualTherapists]
  );
  const prescriptions = useMemo(
    () => shockwaveSettings?.manual_therapy_prescriptions || ['40분', '60분'],
    [shockwaveSettings?.manual_therapy_prescriptions]
  );

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const startStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
      const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;
      const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
      const endStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

      const { data, error } = await supabase
        .from('manual_therapy_patient_logs')
        .select('*')
        .gte('date', startStr)
        .lt('date', endStr)
        .order('date', { ascending: true })
        .order('created_at', { ascending: true });

      if (error) throw error;
      setLogs(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      addToast('도수치료 기록을 불러오는데 실패했습니다.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [addToast, currentMonth, currentYear]);

  useEffect(() => {
    loadManualTherapists();
  }, [loadManualTherapists]);

  useEffect(() => {
    let active = true;
    setSchedulerMemosReady(false);

    (async () => {
      await loadShockwaveMemos(currentYear, currentMonth);
      if (active) setSchedulerMemosReady(true);
    })();

    return () => {
      active = false;
    };
  }, [currentMonth, currentYear, loadShockwaveMemos]);

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
      !isTodayMonth ||
      safeTherapists.length === 0 ||
      isAutoSyncingToday ||
      lastAutoSyncKeyRef.current === autoSyncKey
    ) {
      return;
    }

    let cancelled = false;

    (async () => {
      setIsAutoSyncingToday(true);
      lastAutoSyncKeyRef.current = autoSyncKey;
      try {
        const result = await syncTodayManualTherapyScheduleToStats({
          year: currentYear,
          month: currentMonth,
          memos: shockwaveMemos,
          therapists: safeTherapists,
        });

        if (!cancelled && !result?.skipped && result?.totalUpdates > 0) {
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
  }, [schedulerMemosReady, currentYear, currentMonth, safeTherapists, isAutoSyncingToday, shockwaveMemos, fetchLogs, addToast]);

  const handleSyncFromScheduler = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await syncTodayManualTherapyScheduleToStats({
        year: currentYear,
        month: currentMonth,
        memos: shockwaveMemos,
        therapists: safeTherapists,
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

  return (
    <div className="animate-fade-in" style={{ height: '100%', overflow: 'auto' }}>
      <ManualTherapyStatsPageErrorBoundary>
        <div className="sw-stats-container animate-fade-in">
          <div className="sw-stats-layout">
            <aside className="sw-stats-sidebar">
              <button
                className={`sw-stats-side-tab${activeSection === 'grid' ? ' active' : ''}`}
                onClick={() => setActiveSection('grid')}
              >
                도수치료 현황
              </button>
              <button
                className={`sw-stats-side-tab${activeSection === 'overview' ? ' active' : ''}`}
                onClick={() => setActiveSection('overview')}
              >
                도수치료 통계
              </button>
            </aside>

            <div className="sw-stats-panel">
              {activeSection === 'grid' && (
                <div className="sw-stats-body sw-stats-body--grid">
                  <div className="sw-grid-card">
                    <div className="sw-grid-card-header">
                      <div className="sw-grid-card-title">
                        <h2>{currentMonth}월 도수치료 현황</h2>
                        <p>도수치료 치료사와 처방 목록 기준으로 날짜별 내역을 입력하고 수정합니다.</p>
                      </div>
                      <div className="sw-grid-card-meta">
                        <span>총 기록 {logs.length}건</span>
                        <span>치료사 {safeTherapists.length}명</span>
                      </div>
                    </div>

                    <div className="sw-grid-card-table">
                      <div className="sw-stats-actions" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end', padding: '0 20px 16px' }}>
                        <button
                          className="btn btn-secondary"
                          onClick={handleImportFromGoogleSheet}
                          disabled={isLoading}
                          style={{ borderColor: '#2563eb', color: '#2563eb' }}
                        >
                          📥 구글시트 B:I 가져오기
                        </button>
                      </div>
                      <ShockwaveDataGrid
                        logs={logs}
                        therapists={safeTherapists}
                        currentYear={currentYear}
                        currentMonth={currentMonth}
                        fetchLogs={fetchLogs}
                        extraDraftRows={extraDraftRows}
                        onApplyTodaySchedule={handleSyncFromScheduler}
                        isApplyingTodaySchedule={isLoading}
                        tableName="manual_therapy_patient_logs"
                        prescriptions={prescriptions}
                        frozenColumnCount={shockwaveSettings?.frozen_columns ?? 6}
                        title={`${currentMonth}월 도수치료 현황`}
                        applyTodayLabel="오늘 도수 스케줄 적용"
                        secondarySummaryLabel="신규"
                        onSyncDateToScheduler={null}
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
                </div>
              )}

              {activeSection === 'overview' && (
                <Suspense fallback={<div style={{ padding: 24 }}>도수치료 통계를 불러오는 중...</div>}>
                  <div className="sw-stats-body sw-stats-body--settlement">
                    <ManualTherapyStatsView
                      currentMonth={currentMonth}
                      logs={logs}
                      therapists={safeTherapists}
                      prescriptions={prescriptions}
                      incentivePercentage={shockwaveSettings?.manual_therapy_incentive_percentage ?? 0}
                    />
                  </div>
                </Suspense>
              )}
            </div>
          </div>
        </div>
      </ManualTherapyStatsPageErrorBoundary>
    </div>
  );
}

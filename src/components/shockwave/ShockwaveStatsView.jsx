import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { syncTodayShockwaveScheduleToStats, syncMonthShockwaveScheduleToStats } from '../../lib/shockwaveSyncUtils';
import { getTodayKST } from '../../lib/calendarUtils';
import { useToast } from '../common/Toast';
import { useSchedule } from '../../contexts/ScheduleContext';
import '../../styles/shockwave_stats.css';
import ShockwaveDataGrid from './ShockwaveDataGrid';
import ShockwaveSettlementView from './ShockwaveSettlementView';
import ShockwaveNewPatientsView from './ShockwaveNewPatientsView';

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

export default function ShockwaveStatsView({ currentYear, currentMonth, memos, therapists, schedulerMemosReady = false }) {
  const { addToast } = useToast();
  const { shockwaveSettings, monthlyTherapists } = useSchedule();
  const [logs, setLogs] = useState([]);
  const [recentLogs, setRecentLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [extraDraftRows, setExtraDraftRows] = useState(0);
  const [activeSection, setActiveSection] = useState('grid');
  const [isAutoSyncingToday, setIsAutoSyncingToday] = useState(false);
  const lastAutoSyncKeyRef = useRef(null);
  const safeLogs = useMemo(() => (Array.isArray(logs) ? logs.filter(Boolean) : []), [logs]);
  const safeTherapists = useMemo(() => (Array.isArray(therapists) ? therapists.filter(Boolean) : []), [therapists]);
  const settlementPrescriptions = useMemo(
    () => shockwaveSettings?.prescriptions || ['F1.5', 'F/Rdc', 'F/R'],
    [shockwaveSettings?.prescriptions]
  );
  const settlementPrices = useMemo(
    () => shockwaveSettings?.prescription_prices || { 'F1.5': 50000, 'F/Rdc': 70000, 'F/R': 80000 },
    [shockwaveSettings?.prescription_prices]
  );
  const incentivePercentage = useMemo(
    () => shockwaveSettings?.incentive_percentage ?? 7,
    [shockwaveSettings?.incentive_percentage]
  );
  const normalizedPriceMap = useMemo(() => {
    return Object.fromEntries(
      Object.entries(settlementPrices || {}).map(([key, value]) => [
        String(key || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
        Number(value) || 0,
      ])
    );
  }, [settlementPrices]);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const startStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
      const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;
      const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
      const endStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

      const { data, error } = await supabase
        .from('shockwave_patient_logs')
        .select('*')
        .gte('date', startStr)
        .lt('date', endStr)
        .order('date', { ascending: true })
        .order('created_at', { ascending: true });

      if (error) throw error;
      setLogs(data || []);
    } catch (err) {
      console.error(err);
      addToast('통계 기록을 불러오는데 실패했습니다.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [currentYear, currentMonth, addToast]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    let cancelled = false;

    const fetchRecentLogs = async () => {
      try {
        const currentDate = new Date(currentYear, currentMonth - 1, 1);
        const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 5, 1);
        const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);

        const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-01`;
        const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-01`;

        const { data, error } = await supabase
          .from('shockwave_patient_logs')
          .select('*')
          .gte('date', startStr)
          .lt('date', endStr);

        if (error) throw error;
        if (!cancelled) setRecentLogs(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error(error);
        if (!cancelled) setRecentLogs([]);
      }
    };

    fetchRecentLogs();
    return () => {
      cancelled = true;
    };
  }, [currentYear, currentMonth]);

  const recentMonthlySummaries = useMemo(() => {
    const normalizePrescriptionKey = (value) =>
      String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const toCount = (value) => {
      const parsed = parseInt(String(value ?? '').trim(), 10);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    return Array.from({ length: 6 }, (_, index) => {
      const targetDate = new Date(currentYear, currentMonth - 1 - index, 1);
      const year = targetDate.getFullYear();
      const month = targetDate.getMonth() + 1;
      const monthKey = `${year}-${String(month).padStart(2, '0')}`;

      const monthlyLogs = recentLogs.filter((log) => String(log?.date || '').startsWith(monthKey));
      const totalCount = monthlyLogs.reduce((sum, log) => sum + toCount(log?.prescription_count || 1), 0);
      const amount = monthlyLogs.reduce((sum, log) => {
        const price = normalizedPriceMap[normalizePrescriptionKey(log?.prescription)] || 0;
        return sum + toCount(log?.prescription_count || 1) * price;
      }, 0);
      const newPatientCount = monthlyLogs.filter((log) => String(log?.patient_name || '').includes('*')).length;

      return {
        monthKey,
        label: `${year}년 ${String(month).padStart(2, '0')}월`,
        totalCount,
        amount,
        newPatientCount,
      };
    });
  }, [currentYear, currentMonth, recentLogs, normalizedPriceMap]);

  useEffect(() => {
    setExtraDraftRows(0);
  }, [currentYear, currentMonth]);

  useEffect(() => {
    setActiveSection('grid');
  }, [currentYear, currentMonth]);

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
        const result = await syncMonthShockwaveScheduleToStats({
          year: currentYear,
          month: currentMonth,
          memos,
          therapists: safeTherapists,
          monthlyTherapists,
          upToToday: true,
        });

        if (!cancelled && result?.totalUpdates > 0) {
          await fetchLogs();
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          addToast('오늘 충격파 스케줄 동기화 중 오류가 발생했습니다.', 'error');
        }
      } finally {
        if (!cancelled) setIsAutoSyncingToday(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [schedulerMemosReady, currentYear, currentMonth, safeTherapists, fetchLogs, addToast, isAutoSyncingToday]);

  const handleCellEdit = async (id, field, value) => {
    try {
      const { error } = await supabase.from('shockwave_patient_logs').update({ [field]: value }).eq('id', id);
      if (error) throw error;
      setLogs(prev => prev.map(log => log.id === id ? { ...log, [field]: value } : log));
    } catch (err) {
      addToast('저장 실패', 'error');
    }
  };

  // 스케줄러 데이터 파싱 및 동기화 (One-way Sync)
  const handleSyncFromScheduler = async () => {
    setIsLoading(true);
    try {
      const result = await syncTodayShockwaveScheduleToStats({
        year: currentYear,
        month: currentMonth,
        memos,
        therapists: safeTherapists,
        monthlyTherapists,
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
      setIsLoading(false);
    }
  };

  const handleSyncMonthFromScheduler = async () => {
    if (!window.confirm(`${currentMonth}월 전체 스케줄을 스케줄러 기준으로 덮어씁니다.\n(수동으로 추가한 내역은 모두 삭제됩니다.) 진행하시겠습니까?`)) return;
    setIsLoading(true);
    try {
      const result = await syncMonthShockwaveScheduleToStats({
        year: currentYear,
        month: currentMonth,
        memos,
        therapists: safeTherapists,
        monthlyTherapists,
        upToToday: false,
        overwriteManual: true,
      });

      if (result.totalUpdates > 0) {
        addToast(`전체 월 스케줄 동기화 성공! (추가:${result.totalInserted}, 삭제:${result.totalDeleted})`, 'success');
        await fetchLogs();
      } else {
        addToast('전체 스케줄과 치료 내역 통계가 이미 일치합니다.', 'info');
      }
    } catch (err) {
      console.error(err);
      addToast('전체 월 데이터 동기화 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFullGoogleSheetImport = async () => {
    if (!window.confirm('⚠️ 기존 치료 내역을 모두 삭제하고 구글 시트에서 새로 가져옵니다.\n정말 진행하시겠습니까?')) return;
    setIsLoading(true);
    
    try {
      // 1단계: 기존 DB 데이터 정리
      addToast('기존 데이터 정리 중...', 'info');
      const { error: delError } = await supabase
        .from('shockwave_patient_logs')
        .delete()
        .gte('id', '00000000-0000-0000-0000-000000000000'); // 전체 삭제
      
      if (delError) {
        console.error('DB 정리 실패:', delError);
        addToast('DB 정리 실패: ' + delError.message, 'error');
        return;
      }
      addToast('기존 데이터 정리 완료. 구글 시트에서 가져오기 시작...', 'info');
      const fetchGoogleSheetJSONP = (sheetName) => {
        return new Promise((resolve) => {
          const callbackName = `gvizCallback_${sheetName.replace(/\./g, '_')}`;
          window[callbackName] = (data) => {
            delete window[callbackName];
            document.body.removeChild(script);
            resolve(data);
          };
          
          const script = document.createElement('script');
          script.src = `https://docs.google.com/spreadsheets/d/1ieBva8HCugMM3j2PlV6HamMgCOmfxxS5MIdqeBid1Cw/gviz/tq?tq=${encodeURIComponent('select B,C,D,E,F,G,H,I,J,K,L,M,N,O,P')}&tqx=responseHandler:${callbackName}&sheet=${sheetName}`;
          script.onerror = () => {
            delete window[callbackName];
            document.body.removeChild(script);
            resolve(null);
          };
          document.body.appendChild(script);
        });
      };

      let allNewLogs = [];
      
      for (let y = 24; y <= 26; y++) {
        for (let m = 1; m <= 12; m++) {
          const sheetName = `${y}.${String(m).padStart(2, '0')}`;
          addToast(`${sheetName} 시트 확인 중...`, 'info');
          
          const data = await fetchGoogleSheetJSONP(sheetName);
          if (data && data.status === 'ok' && data.table && data.table.rows) {
            let currentDate = null;
            const sheetLogs = [];
            
            // B:P 범위로 가져왔으므로 인덱스가 0부터 시작 (0=B, 1=C, ... 14=P)
            const headerCells = data.table.rows[0]?.c || [];
            const t1 = headerCells[5]?.v ? String(headerCells[5].v).split('(')[0].trim() : "치료사 1";
            const t2 = headerCells[8]?.v ? String(headerCells[8].v).split('(')[0].trim() : "치료사 2";
            const t3 = headerCells[11]?.v ? String(headerCells[11].v).split('(')[0].trim() : "치료사 3";
            
            data.table.rows.forEach((row, rowIndex) => {
              if (rowIndex < 5) return;
              const cells = row.c || [];
              // B=0, C=1, D=2, E=3, F=4
              const colB = cells[0]?.f || cells[0]?.v;
              const colC = cells[1]?.f || cells[1]?.v;
              const colD = cells[2]?.f || cells[2]?.v;
              const colE = cells[3]?.f || cells[3]?.v;
              const colF = cells[4]?.f || cells[4]?.v;
              
              if (colB) {
                const strB = String(colB).trim();
                
                // 구글 시트 네이티브 Date 포맷: "Date(2024,0,1)" (월은 0부터 시작)
                const dateMatch = strB.match(/Date\((\d+),\s*(\d+),\s*(\d+)\)/);
                if (dateMatch) {
                  const py = parseInt(dateMatch[1], 10);
                  const pm = parseInt(dateMatch[2], 10) + 1; // 0-indexed month
                  const pd = parseInt(dateMatch[3], 10);
                  currentDate = `${py}-${String(pm).padStart(2, '0')}-${String(pd).padStart(2, '0')}`;
                } else {
                  // 일반 텍스트 mm/dd, mm.dd 포맷
                  const dm = strB.match(/(\d{1,2})[\/\.\-](\d{1,2})/);
                  if (dm) {
                    currentDate = `20${y}-${String(dm[1]).padStart(2, '0')}-${String(dm[2]).padStart(2, '0')}`;
                  } else if (/^\d{1,2}$/.test(strB)) {
                    // 일(dd)만 적혀있는 경우
                    currentDate = `20${y}-${String(m).padStart(2, '0')}-${strB.padStart(2, '0')}`;
                  }
                }
              }

              if (!currentDate || !colC) return;
              
              // 이름의 * 표시는 1회차를 의미하는 시각적 표식이므로 그대로 유지
              const name = String(colC).trim();
              if (name && !/^\d+$/.test(name) && !/^(이름|성함|차트|합계|건수)/.test(name)) {
                
                let therapist = '구글 시트 연동';
                let presType = '';
                let presCount = 0;
                
                // 각 치료사 별 처방 컬럼 확인: 첫번째(F1.5), 두번째(F/R DC), 세번째(F/R)
                // B:P 범위이므로 G=5, H=6, I=7, J=8, K=9, L=10, M=11, N=12, O=13
                const checkPrescription = (colStart, tName) => {
                  const v1 = cells[colStart]?.v;
                  const v2 = cells[colStart + 1]?.v;
                  const v3 = cells[colStart + 2]?.v;
                  if (v1 && String(v1).trim() !== '0' && String(v1).trim() !== '') {
                    therapist = tName;
                    presType = 'F1.5';
                    presCount = parseInt(v1, 10) || 1;
                  } else if (v2 && String(v2).trim() !== '0' && String(v2).trim() !== '') {
                    therapist = tName;
                    presType = 'F/R DC';
                    presCount = parseInt(v2, 10) || 1;
                  } else if (v3 && String(v3).trim() !== '0' && String(v3).trim() !== '') {
                    therapist = tName;
                    presType = 'F/R';
                    presCount = parseInt(v3, 10) || 1;
                  }
                };

                checkPrescription(5, t1);  // G=5, H=6, I=7
                if (!presType) checkPrescription(8, t2);  // J=8, K=9, L=10
                if (!presType) checkPrescription(11, t3); // M=11, N=12, O=13

                sheetLogs.push({
                  date: currentDate,
                  patient_name: name,
                  chart_number: colD ? String(colD) : '',
                  visit_count: colE ? String(colE) : '1',
                  body_part: colF ? String(colF) : '',
                  therapist_name: therapist,
                  prescription: presType,
                  prescription_count: presCount || null,
                });
              }
            });
            allNewLogs = allNewLogs.concat(sheetLogs);
          }
        }
      }

      if (allNewLogs.length === 0) {
        addToast('구글 시트에서 유효한 기록을 찾지 못했습니다.', 'info');
        return;
      }

      // 1차: 가져온 데이터 자체에서 중복 제거 (같은 date+name+chart+body_part 조합)
      const seenKeys = new Set();
      const dedupedLogs = [];
      allNewLogs.forEach(l => {
        const key = `${l.date}_${l.patient_name}_${l.chart_number}_${l.body_part}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          dedupedLogs.push(l);
        }
      });

      addToast(`총 ${allNewLogs.length}건 중 중복 제외 ${dedupedLogs.length}건 저장 시작...`, 'info');
      allNewLogs = dedupedLogs;

      // DB를 비웠으므로 단순 insert만 수행
      const chunkSize = 500;
      let totalInserted = 0;

      for (let i = 0; i < allNewLogs.length; i += chunkSize) {
        const chunk = allNewLogs.slice(i, i + chunkSize);
        const { error } = await supabase.from('shockwave_patient_logs').insert(chunk);
        if (error) {
          console.error('Insert 오류:', error);
        } else {
          totalInserted += chunk.length;
        }
        addToast(`저장 중... ${totalInserted} / ${allNewLogs.length}`, 'info');
      }

      addToast(`가져오기 완료! 총 ${totalInserted}건 저장됨`, 'success');
      await fetchLogs();

    } catch (err) {
      console.error(err);
      addToast('구글 시트 연동 중 오류 발생', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="sw-stats-container animate-fade-in">
      <div className="sw-stats-layout">
        <aside className="sw-stats-sidebar">
          <button
            className={`sw-stats-side-tab${activeSection === 'grid' ? ' active' : ''}`}
            onClick={() => setActiveSection('grid')}
          >
            충격파 현황
          </button>
          <button
            className={`sw-stats-side-tab${activeSection === 'overview' ? ' active' : ''}`}
            onClick={() => setActiveSection('overview')}
          >
            치료 내역 통계
          </button>
          <button
            className={`sw-stats-side-tab${activeSection === 'settlement' ? ' active' : ''}`}
            onClick={() => setActiveSection('settlement')}
          >
            충격파 결산
          </button>
          <button
            className={`sw-stats-side-tab${activeSection === 'new-patients' ? ' active' : ''}`}
            onClick={() => setActiveSection('new-patients')}
          >
            신규환자
          </button>
        </aside>

        <div className="sw-stats-panel">
          {activeSection === 'overview' && (
            <div className="sw-stats-header">
              <div className="sw-stats-summary">
                <h2>📊 {currentMonth}월 치료 내역 통계</h2>
                <div className="sw-stats-cards">
                  <div className="sw-stats-card">
                    <span className="card-label">해당 월 총 처방수</span>
                    <span className="card-value sum-value">
                      {safeLogs.reduce((s, l) => s + (l?.prescription ? (parseInt(l.prescription_count || '1') || 1) : 0), 0)}건
                    </span>
                  </div>
                  <div className="sw-stats-card">
                    <span className="card-label">초진 포함 전체 목록</span>
                    <span className="card-value">
                      {safeLogs.filter(l => l?.patient_name?.includes('*')).length}명 (*)
                    </span>
                  </div>
                </div>
              </div>

              <div className="sw-stats-actions" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-secondary"
                  onClick={handleFullGoogleSheetImport}
                  disabled={isLoading}
                  style={{ borderColor: '#ea4335', color: '#ea4335' }}
                  title="기존 스프레드시트의 24년~26년 모든 시트 데이터를 읽어와 누적합니다."
                >
                  🔥 과거 기록 전체 연동 (Google Sheets)
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={async () => {
                    let fallbackDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
                    if (safeLogs.length > 0) {
                      const dates = safeLogs.map(l => l?.date).filter(Boolean).sort();
                      if (dates.length > 0) fallbackDate = dates[dates.length - 1];
                    }
                    const { error } = await supabase.from('shockwave_patient_logs').insert([{
                      date: fallbackDate, patient_name: '', chart_number: '', visit_count: '', body_part: '', therapist_name: '', prescription: '', prescription_count: 0, source: 'manual'
                    }]);
                    if (!error) fetchLogs();
                  }}
                >
                  + 수동 추가
                </button>
                <button
                  className="sw-sync-btn"
                  onClick={handleSyncFromScheduler}
                  disabled={isLoading}
                >
                  {isLoading ? '동기화 중...' : '⬇ 현재 스케줄러 데이터 가져오기'}
                </button>
              </div>
            </div>
          )}

          {activeSection === 'grid' && (
            <div className="sw-stats-body sw-stats-body--grid">
              <div className="sw-grid-card">
                <div className="sw-grid-card-header">
                  <div className="sw-grid-card-title">
                    <h2>{currentMonth}월 충격파 현황</h2>
                    <p>날짜별 치료 내역과 치료사별 처방 분포를 한 화면에서 확인하고 수정합니다.</p>
                  </div>
                  <div className="sw-grid-card-meta">
                    <span>총 기록 {safeLogs.length}건</span>
                    <span>치료사 {safeTherapists.length}명</span>
                  </div>
                </div>

                <div className="sw-grid-card-table">
                  <ShockwaveStatsErrorBoundary>
                    <ShockwaveDataGrid
                      logs={safeLogs}
                      therapists={safeTherapists}
                      monthlyTherapists={monthlyTherapists}
                      currentYear={currentYear}
                      currentMonth={currentMonth}
                      fetchLogs={fetchLogs}
                      extraDraftRows={extraDraftRows}
                      onApplyTodaySchedule={handleSyncFromScheduler}
                      isApplyingTodaySchedule={isLoading}
                      onApplyMonthSchedule={handleSyncMonthFromScheduler}
                      isApplyingMonthSchedule={isLoading}
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
            </div>
          )}

          {activeSection === 'settlement' && (
            <div className="sw-stats-body sw-stats-body--settlement">
              <ShockwaveSettlementView
                logs={safeLogs}
                therapists={safeTherapists}
                monthlyTherapists={monthlyTherapists}
                currentMonth={currentMonth}
                prescriptions={settlementPrescriptions}
                prescriptionPrices={settlementPrices}
                incentivePercentage={incentivePercentage}
                recentMonthlySummaries={recentMonthlySummaries}
              />
            </div>
          )}

          {activeSection === 'new-patients' && (
            <div className="sw-stats-body sw-stats-body--settlement">
              <ShockwaveNewPatientsView
                logs={safeLogs}
                therapists={safeTherapists}
                monthlyTherapists={monthlyTherapists}
                currentMonth={currentMonth}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

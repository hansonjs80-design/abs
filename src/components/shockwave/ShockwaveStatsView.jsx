import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { generateShockwaveCalendar, isSameDate } from '../../lib/calendarUtils';
import { parseTherapyInfo } from '../../lib/shockwaveSyncUtils';
import { useToast } from '../common/Toast';
import '../../styles/shockwave_stats.css';
import ShockwaveDataGrid from './ShockwaveDataGrid';

export default function ShockwaveStatsView({ currentYear, currentMonth, memos, therapists }) {
  const { addToast } = useToast();
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const startStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
      const endStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`; // This naturally rolls over months due to postgres date handling or via proper end date.
      
      const lastDay = new Date(currentYear, currentMonth, 0).getDate();
      const properEndStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      const { data, error } = await supabase
        .from('shockwave_patient_logs')
        .select('*')
        .gte('date', startStr)
        .lte('date', properEndStr)
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
      if (!memos) return;
      
      const weeks = generateShockwaveCalendar(currentYear, currentMonth);
      const newLogs = [];

      Object.entries(memos).forEach(([key, cell]) => {
        const [w, d, r, c] = key.split('-').map(Number);
        const dayInfo = weeks[w]?.[d];
        if (!dayInfo || !dayInfo.isCurrentMonth) return;
        
        const content = cell.content;
        const parsed = parseTherapyInfo(content);
        if (parsed) {
          const dateStr = `${dayInfo.year}-${String(dayInfo.month).padStart(2, '0')}-${String(dayInfo.day).padStart(2, '0')}`;
          const therapistName = therapists[c] ? therapists[c].name : `치료사 ${c + 1}`;
          
          newLogs.push({
            date: dateStr,
            patient_name: parsed.patient_name,
            chart_number: parsed.chart_number || '',
            visit_count: parsed.visit_count || '1',
            body_part: parsed.body_part || '',
            therapist_name: therapistName,
            prescription: '',
          });
        }
      });

      if (newLogs.length === 0) {
        addToast('가져올 스케줄 데이터가 없습니다.', 'info');
        setIsLoading(false);
        return;
      }

      // 1. 기존 달력 데이터 조회
      const minDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
      const maxDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(new Date(currentYear, currentMonth, 0).getDate()).padStart(2, '0')}`;
      
      const { data: existingLogs } = await supabase
        .from('shockwave_patient_logs')
        .select('*')
        .gte('date', minDate)
        .lte('date', maxDate);
        
      const existingMap = new Map((existingLogs || []).map(l => [`${l.date}_${l.patient_name}`, l]));
      
      const toUpsert = [];
      const toInsert = [];

      for (const n of newLogs) {
        const key = `${n.date}_${n.patient_name}`;
        if (existingMap.has(key)) {
          const old = existingMap.get(key);
          toUpsert.push({
            id: old.id,
            date: n.date,
            patient_name: n.patient_name,
            chart_number: n.chart_number || old.chart_number,
            visit_count: n.visit_count || old.visit_count,
            body_part: n.body_part || old.body_part,
            therapist_name: n.therapist_name || old.therapist_name,
            prescription: old.prescription || '',
          });
        } else {
          toInsert.push(n);
        }
      }

      if (toUpsert.length > 0) {
        const { error: upError } = await supabase.from('shockwave_patient_logs').upsert(toUpsert);
        if (upError) console.error("Upsert error:", upError);
      }
      
      if (toInsert.length > 0) {
        const { error: insError } = await supabase.from('shockwave_patient_logs').insert(toInsert);
        if (insError) console.error("Insert error:", insError);
      }

      const totalSync = toInsert.length + toUpsert.length;
      if (totalSync > 0) {
        addToast(`스케줄러에서 ${toInsert.length}건 추가, ${toUpsert.length}건 갱신을 완료했습니다.`, 'success');
        await fetchLogs();
      } else {
        addToast('이미 모든 스케줄이 최신 상태입니다.', 'info');
      }

    } catch (err) {
      console.error(err);
      addToast('데이터 동기화 중 오류가 발생했습니다.', 'error');
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
                
                // 각 치료사 별 처방 컬럼 확인: 첫번째(F1.5), 두번째(F/R DC), 세번째(F/R)
                // B:P 범위이므로 G=5, H=6, I=7, J=8, K=9, L=10, M=11, N=12, O=13
                const checkPrescription = (colStart, tName) => {
                  const v1 = cells[colStart]?.v;
                  const v2 = cells[colStart + 1]?.v;
                  const v3 = cells[colStart + 2]?.v;
                  if (v1 && String(v1).trim() !== '0' && String(v1).trim() !== '') {
                    therapist = tName;
                    presType = 'F1.5';
                  } else if (v2 && String(v2).trim() !== '0' && String(v2).trim() !== '') {
                    therapist = tName;
                    presType = 'F/R DC';
                  } else if (v3 && String(v3).trim() !== '0' && String(v3).trim() !== '') {
                    therapist = tName;
                    presType = 'F/R';
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

  const groupedLogs = useMemo(() => {
    const groups = {};
    logs.forEach(log => {
      if (!groups[log.date]) groups[log.date] = [];
      groups[log.date].push(log);
    });
    return Object.keys(groups).sort().map(date => ({
      date,
      items: groups[date]
    }));
  }, [logs]);

  const totalCount = logs.length;

  return (
    <div className="sw-stats-container animate-fade-in">
      <div className="sw-stats-header">
        <div className="sw-stats-summary">
          <h2>📊 {currentMonth}월 치료 내역 통계</h2>
          <div className="sw-stats-cards">
            <div className="sw-stats-card">
              <span className="card-label">해당 월 총 처방수</span>
              <span className="card-value sum-value">{totalCount}건</span>
            </div>
            <div className="sw-stats-card">
              <span className="card-label">초진 포함 전체 목록</span>
              <span className="card-value">
                {logs.filter(l => l.patient_name?.includes('*')).length}명 (*)
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
              if (logs && logs.length > 0) {
                 const dates = logs.map(l => l.date).filter(Boolean).sort();
                 if (dates.length > 0) fallbackDate = dates[dates.length - 1];
              }
              const { error } = await supabase.from('shockwave_patient_logs').insert([{
                date: fallbackDate, patient_name: '', chart_number: '', visit_count: '', body_part: '', therapist_name: '', prescription: ''
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

      <div className="sw-stats-body">
        <ShockwaveDataGrid 
          logs={logs} 
          therapists={therapists} 
          currentYear={currentYear} 
          currentMonth={currentMonth} 
          fetchLogs={fetchLogs} 
        />
      </div>
    </div>
  );
}

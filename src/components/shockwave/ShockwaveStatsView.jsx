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
      
      const today = new Date();
      const todayY = today.getFullYear();
      const todayM = today.getMonth() + 1;
      const todayD = today.getDate();
      const todayDateStr = `${todayY}-${String(todayM).padStart(2, '0')}-${String(todayD).padStart(2, '0')}`;
      
      if (todayY !== currentYear || todayM !== currentMonth) {
         addToast('오늘 날짜가 포함된 이번 달 스케줄러에서만 동기화할 수 있습니다.', 'info');
         setIsLoading(false);
         return;
      }
      
      const weeks = generateShockwaveCalendar(currentYear, currentMonth);
      const newLogs = [];

      // 1. 오늘 날짜 스케줄러 내용 추출
      Object.entries(memos).forEach(([key, cell]) => {
        const [w, d, r, c] = key.split('-').map(Number);
        const dayInfo = weeks[w]?.[d];
        if (!dayInfo || !dayInfo.isCurrentMonth) return;
        
        if (dayInfo.year === todayY && dayInfo.month === todayM && dayInfo.day === todayD) {
          const content = cell.content;
          const parsed = parseTherapyInfo(content);
          if (parsed) {
            const therapistName = therapists[c] ? therapists[c].name : `치료사 ${c + 1}`;
            newLogs.push({
              r,
              c,
              date: todayDateStr,
              patient_name: parsed.patient_name,
              chart_number: parsed.chart_number || '',
              visit_count: parsed.visit_count || '',
              body_part: parsed.body_part || '',
              therapist_name: therapistName,
              prescription: '',
            });
          }
        }
      });

      if (newLogs.length === 0) {
        addToast('오늘 스케줄러에 해당하는 예약 내역이 없습니다.', 'info');
      }

      // 예약 시간순(r) 정렬
      newLogs.sort((a, b) => {
        if (a.r !== b.r) return a.r - b.r;
        return a.c - b.c;
      });

      // 2. 과거 데이터 조회 (차트번호, 회차, 부위 계산용)
      const cleanNamesSet = new Set(newLogs.map(l => l.patient_name.replace(/\*/g, '')));
      const queryNames = [];
      cleanNamesSet.forEach(n => {
         queryNames.push(n);
         queryNames.push(`${n}*`);
      });
      
      const { data: pastData } = await supabase
        .from('shockwave_patient_logs')
        .select('patient_name, chart_number, visit_count, body_part, date')
        .in('patient_name', queryNames)
        .order('date', { ascending: false });

      // 빈 값 자동 계산
      newLogs.forEach(n => {
         const cleanName = n.patient_name.replace(/\*/g, '');
         // 과거 기록 중 오늘이 아닌 가장 최신 기록 탐색
         const pLogs = (pastData || []).filter(p => p.patient_name.replace(/\*/g, '') === cleanName && p.date !== todayDateStr);
         
         if (pLogs.length > 0) {
            pLogs.sort((a, b) => {
               if (a.date !== b.date) return b.date.localeCompare(a.date);
               return (parseInt(b.visit_count || '0') || 0) - (parseInt(a.visit_count || '0') || 0);
            });
            const lastLog = pLogs[0];
            
            if (!n.chart_number) n.chart_number = lastLog.chart_number || '';
            if (!n.body_part) n.body_part = lastLog.body_part || '';
            
            if (!n.visit_count) {
                const lastVisit = parseInt(lastLog.visit_count || '0', 10);
                n.visit_count = lastVisit > 0 ? String(lastVisit + 1) : '1';
            }
         } else {
            if (!n.visit_count) n.visit_count = '1';
         }
      });

      // 3. 통계 DB의 오늘 데이터 중 자동(scheduler) 항목만 동기화 대상
      const { data: todayStats } = await supabase
        .from('shockwave_patient_logs')
        .select('*')
        .eq('date', todayDateStr);
        
      // scheduler 소스만 동기화 대상, manual은 절대 건드리지 않음
      const schedulerEntries = (todayStats || []).filter(l => l.source === 'scheduler');
      
      const existingGroups = {};
      schedulerEntries.forEach(l => {
         const key = l.patient_name.replace(/\*/g, '');
         if (!existingGroups[key]) existingGroups[key] = [];
         existingGroups[key].push(l);
      });

      const toUpsert = [];
      const toInsert = [];
      const usedIds = new Set();

      newLogs.forEach(n => {
        const key = n.patient_name.replace(/\*/g, '');
        const group = existingGroups[key];
        
        let old = null;
        if (group && group.length > 0) {
            old = group.find(g => !usedIds.has(g.id));
        }

        const out = {
            date: n.date,
            patient_name: n.patient_name,
            chart_number: n.chart_number,
            visit_count: n.visit_count,
            body_part: n.body_part,
            therapist_name: n.therapist_name,
            source: 'scheduler',
        };

        if (old) {
          out.id = old.id;
          out.prescription = old.prescription || '';
          out.prescription_count = old.prescription_count || '';
          toUpsert.push(out);
          usedIds.add(old.id);
        } else {
          toInsert.push(out);
        }
      });
      
      // scheduler 소스 중 스케줄러에서 삭제된 것만 제거 (manual은 유지)
      const toDeleteIds = schedulerEntries.filter(l => !usedIds.has(l.id)).map(l => l.id);

      if (toDeleteIds.length > 0) {
        await supabase.from('shockwave_patient_logs').delete().in('id', toDeleteIds);
      }
      if (toUpsert.length > 0) {
        await supabase.from('shockwave_patient_logs').upsert(toUpsert);
      }
      if (toInsert.length > 0) {
        await supabase.from('shockwave_patient_logs').insert(toInsert);
      }

      const totalUpdates = toInsert.length + toUpsert.length + toDeleteIds.length;
      if (totalUpdates > 0) {
        addToast(`오늘 스케줄과 동기화 성공! (추가:${toInsert.length}, 갱신:${toUpsert.length}, 제거:${toDeleteIds.length})`, 'success');
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
              <span className="card-value sum-value">
                {logs.reduce((s, l) => s + (l.prescription ? (parseInt(l.prescription_count || '1') || 1) : 0), 0)}건
              </span>
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
                date: fallbackDate, patient_name: '', chart_number: '', visit_count: '', body_part: '', therapist_name: '', prescription: '', source: 'manual'
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

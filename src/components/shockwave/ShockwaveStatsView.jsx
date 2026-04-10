import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { generateShockwaveCalendar, isSameDate } from '../../lib/calendarUtils';
import { parseTherapyInfo } from '../../lib/shockwaveSyncUtils';
import { useToast } from '../common/Toast';
import '../../styles/shockwave_stats.css';

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
    if (!window.confirm('구글 시트에서 과거 전체 기록을 가져오시겠습니까? 시간이 소요될 수 있습니다.')) return;
    setIsLoading(true);
    
    try {
      const fetchGoogleSheetJSONP = (sheetName) => {
        return new Promise((resolve) => {
          const callbackName = `gvizCallback_${sheetName.replace(/\./g, '_')}`;
          window[callbackName] = (data) => {
            delete window[callbackName];
            document.body.removeChild(script);
            resolve(data);
          };
          
          const script = document.createElement('script');
          script.src = `https://docs.google.com/spreadsheets/d/1ieBva8HCugMM3j2PlV6HamMgCOmfxxS5MIdqeBid1Cw/gviz/tq?tq=select%20*&tqx=responseHandler:${callbackName}&sheet=${sheetName}`;
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
            
            const headerCells = data.table.rows[0]?.c || [];
            const t1 = headerCells[6]?.v ? String(headerCells[6].v).split('(')[0].trim() : "치료사 1";
            const t2 = headerCells[9]?.v ? String(headerCells[9].v).split('(')[0].trim() : "치료사 2";
            const t3 = headerCells[12]?.v ? String(headerCells[12].v).split('(')[0].trim() : "치료사 3";
            
            data.table.rows.forEach((row, rowIndex) => {
              if (rowIndex < 5) return;
              const cells = row.c || [];
              const colB = cells[1]?.f || cells[1]?.v;
              const colC = cells[2]?.f || cells[2]?.v;
              const colD = cells[3]?.f || cells[3]?.v;
              const colE = cells[4]?.f || cells[4]?.v;
              const colF = cells[5]?.f || cells[5]?.v;
              
              if (colB) {
                const strB = String(colB).trim();
                const dm = strB.match(/(\d{1,2})[\/\.\-](\d{1,2})/);
                if (dm) {
                  currentDate = `20${y}-${String(dm[1]).padStart(2, '0')}-${String(dm[2]).padStart(2, '0')}`;
                } else if (/^\d{1,2}$/.test(strB)) {
                  currentDate = `20${y}-${String(m).padStart(2, '0')}-${strB.padStart(2, '0')}`;
                }
              }

              if (!currentDate || !colC) return;
              
              const name = String(colC).trim();
              if (name && !/^\d+$/.test(name) && !/^(이름|성함|차트|합계|건수)/.test(name)) {
                
                let therapist = '구글 시트 연동';
                let presType = '';
                
                // 각 치료사 별 처방 컬럼 확인: 첫번째(F1.5), 두번째(F/R DC), 세번째(F/R)
                const checkPrescription = (colStart, tName) => {
                  if (cells[colStart]?.f || cells[colStart]?.v) {
                    therapist = tName;
                    presType = 'F1.5';
                  } else if (cells[colStart + 1]?.f || cells[colStart + 1]?.v) {
                    therapist = tName;
                    presType = 'F/R DC';
                  } else if (cells[colStart + 2]?.f || cells[colStart + 2]?.v) {
                    therapist = tName;
                    presType = 'F/R';
                  }
                };

                checkPrescription(6, t1);
                if (!presType) checkPrescription(9, t2);
                if (!presType) checkPrescription(12, t3);

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

      addToast(`총 ${allNewLogs.length}건을 읽었습니다. 중복 제외 저장 시작...`, 'info');

      const chunkSize = 1000;
      let totalInserted = 0;
      let totalUpserted = 0;

      for (let i = 0; i < allNewLogs.length; i += chunkSize) {
        const chunk = allNewLogs.slice(i, i + chunkSize);
        
        const dates = chunk.map(l => l.date);
        const minDate = dates.reduce((a, b) => a < b ? a : b);
        const maxDate = dates.reduce((a, b) => a > b ? a : b);

        const { data: existing } = await supabase
          .from('shockwave_patient_logs')
          .select('*')
          .gte('date', minDate)
          .lte('date', maxDate);
          
        const existingMap = new Map((existing || []).map(l => [`${l.date}_${l.patient_name}`, l]));
        
        const toUpsert = [];
        const toInsert = [];

        chunk.forEach(n => {
          const key = `${n.date}_${n.patient_name}`;
          if (existingMap.has(key)) {
            const old = existingMap.get(key);
            // 만약 구글시트에 기록된 담당치료사/처방 값이 새로 생겼는데 DB가 비어있거나 '구글 시트 연동' 상태면 업데이트
            const shouldUpdateTherapist = n.therapist_name !== '구글 시트 연동' && 
                (old.therapist_name === '구글 시트 연동' || !old.therapist_name);
            const shouldUpdatePres = n.prescription && !old.prescription;
            
            if (shouldUpdateTherapist || shouldUpdatePres) {
              toUpsert.push({
                id: old.id,
                date: n.date,
                patient_name: n.patient_name,
                chart_number: old.chart_number || n.chart_number,
                visit_count: old.visit_count || n.visit_count,
                body_part: old.body_part || n.body_part,
                therapist_name: shouldUpdateTherapist ? n.therapist_name : old.therapist_name,
                prescription: shouldUpdatePres ? n.prescription : (old.prescription || ''),
              });
            }
          } else {
            toInsert.push(n);
          }
        });

        if (toUpsert.length > 0) {
          await supabase.from('shockwave_patient_logs').upsert(toUpsert);
          totalUpserted += toUpsert.length;
        }

        if (toInsert.length > 0) {
          await supabase.from('shockwave_patient_logs').insert(toInsert);
          totalInserted += toInsert.length;
        }
      }

      addToast(`과거 기록 연동 완료! (${totalInserted}건 추가, ${totalUpserted}건 정보 갱신)`, 'success');
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
              const dateStr = `${current          <table className="sw-stats-table spreadsheet-theme">
            <thead>
              {/* === ROW 1: TITLE === */}
              <tr>
                <th colSpan={5 + therapists.length * 3 + 2} className="spreadsheet-title" style={{ backgroundColor: '#c3b4f3', fontSize: '1.2rem', padding: '10px' }}>
                  {currentMonth}월 충격파 현황
                </th>
              </tr>
              
              {/* === ROW 2: HEADERS & THERAPIST NAMES === */}
              <tr className="spreadsheet-header-row2">
                <th rowSpan={3} style={{ width: '80px', backgroundColor: '#e2f0d9' }}>날짜</th>
                <th rowSpan={3} style={{ width: '90px', backgroundColor: '#e2f0d9' }}>이름</th>
                <th rowSpan={3} style={{ width: '90px', backgroundColor: '#e2f0d9' }}>차트번호</th>
                <th rowSpan={3} style={{ width: '60px', backgroundColor: '#e2f0d9' }}>회차</th>
                <th rowSpan={3} style={{ width: '140px', backgroundColor: '#e2f0d9' }}>부위</th>
                
                {therapists.map((t, idx) => {
                  const colors = ['#cde4f9', '#ffebb4', '#d9ead3', '#fce5cd', '#ead1dc'];
                  const bgColor = colors[idx % colors.length];
                  
                  // Calculate total sum for this therapist
                  const total = logs.reduce((sum, log) => {
                    if (log.therapist_name === t.name && log.prescription) {
                      return sum + (parseInt(log.prescription_count || '1', 10) || 1);
                    }
                    return sum;
                  }, 0);

                  return (
                    <th key={'th1_'+t.id} colSpan={3} style={{ backgroundColor: bgColor }}>
                      {t.name} ( {total}건 )
                    </th>
                  );
                })}
                
                <th rowSpan={2} style={{ width: '60px', backgroundColor: '#c1a8c8' }}>총건수</th>
                <th rowSpan={3} style={{ width: '40px', backgroundColor: '#e2f0d9' }}>🗑️</th>
              </tr>

              {/* === ROW 3: PRESCRIPTION TYPES === */}
              <tr className="spreadsheet-header-row3">
                {therapists.map((t, idx) => {
                  const colors = ['#cde4f9', '#ffebb4', '#d9ead3', '#fce5cd', '#ead1dc'];
                  const bgColor = colors[idx % colors.length];
                  return (
                    <React.Fragment key={'th2_'+t.id}>
                      <th style={{ width: '45px', backgroundColor: bgColor }}>F1.5</th>
                      <th style={{ width: '45px', backgroundColor: bgColor }}>F/Rdc</th>
                      <th style={{ width: '45px', backgroundColor: bgColor }}>F/R</th>
                    </React.Fragment>
                  );
                })}
              </tr>

              {/* === ROW 4: PRESCRIPTION TOTALS === */}
              <tr className="spreadsheet-header-row4">
                {therapists.map((t, idx) => {
                  let f15 = 0, frdc = 0, fr = 0;
                  logs.forEach(log => {
                    if (log.therapist_name === t.name && log.prescription) {
                      const cnt = parseInt(log.prescription_count || '1', 10) || 1;
                      const p = log.prescription === 'F/R DC' ? 'F/Rdc' : log.prescription;
                      if (p === 'F1.5') f15 += cnt;
                      else if (p === 'F/Rdc') frdc += cnt;
                      else if (p === 'F/R') fr += cnt;
                    }
                  });
                  return (
                    <React.Fragment key={'th3_'+t.id}>
                      <th style={{ color: 'blue' }}>{f15}</th>
                      <th style={{ color: 'blue' }}>{frdc}</th>
                      <th style={{ color: 'blue' }}>{fr}</th>
                    </React.Fragment>
                  );
                })}
                <th rowSpan={1} style={{ fontSize: '1.2rem', color: '#cc0000', backgroundColor: '#f4cccc' }}>
                  {logs.reduce((s, l) => s + (l.prescription ? (parseInt(l.prescription_count || '1', 10) || 1) : 0), 0)}건
                </th>
              </tr>
            </thead>
            <tbody>
              {groupedLogs.length === 0 ? (
                <tr>
                  <td colSpan={5 + therapists.length * 3 + 2} className="center-text text-gray" style={{ padding: '40px' }}>
                    이번 달 기록이 없습니다. '가져오기'를 누르거나 '수동 추가'를 클릭하세요.
                  </td>
                </tr>
              ) : (
                groupedLogs.map(group => {
                  const dailyGroupTotal = group.items.reduce((s, l) => s + (l.prescription ? (parseInt(l.prescription_count || '1', 10) || 1) : 0), 0);
                  const parsedDate = group.date.split('-');
                  const shortDate = parsedDate.length === 3 ? `${parsedDate[1]}/${parsedDate[2]}` : group.date;

                  return group.items.map((log, index) => {
                    return (
                      <tr key={log.id} className={log.patient_name?.includes('*') ? 'is-first-visit' : ''}>
                        {index === 0 && (
                          <td rowSpan={group.items.length} className="center-text bold-text" style={{ backgroundColor: '#fff', verticalAlign: 'top', paddingTop: '8px' }}>
                            {shortDate}
                          </td>
                        )}
                        <td className="center-text bold-text" style={{ padding: 0 }}>
                          <input 
                            type="text" 
                            defaultValue={log.patient_name}
                            onBlur={(e) => e.target.value !== log.patient_name && handleCellEdit(log.id, 'patient_name', e.target.value)}
                            className="sw-stats-input center-text bold-text"
                          />
                        </td>
                        <td className="center-text" style={{ padding: 0 }}>
                          <input 
                            type="text" 
                            defaultValue={log.chart_number}
                            onBlur={(e) => e.target.value !== log.chart_number && handleCellEdit(log.id, 'chart_number', e.target.value)}
                            className="sw-stats-input center-text text-gray"
                          />
                        </td>
                        <td className="center-text" style={{ padding: 0 }}>
                          <input 
                            type="text" 
                            defaultValue={log.visit_count}
                            onBlur={(e) => e.target.value !== log.visit_count && handleCellEdit(log.id, 'visit_count', e.target.value)}
                            className="sw-stats-input center-text"
                          />
                        </td>
                        <td style={{ padding: 0 }}>
                          <input 
                            type="text" 
                            defaultValue={log.body_part}
                            onBlur={(e) => e.target.value !== log.body_part && handleCellEdit(log.id, 'body_part', e.target.value)}
                            className="sw-stats-input center-text"
                          />
                        </td>

                        {/* 치료사 & 처방 입력 셀 */}
                        {therapists.map(t => {
                          const isThisTherapist = log.therapist_name === t.name;
                          const currentP = log.prescription === 'F/R DC' ? 'F/Rdc' : log.prescription;
                          const currentCount = log.prescription_count || '1';

                          return ['F1.5', 'F/Rdc', 'F/R'].map(ptype => {
                            const isCellActive = isThisTherapist && currentP === ptype;
                            const cellValue = isCellActive ? currentCount : '';
                            
                            return (
                              <td key={`cell_${t.id}_${ptype}`} className="center-text" style={{ padding: 0 }}>
                                <input
                                  type="text"
                                  className="sw-stats-input center-text"
                                  defaultValue={cellValue}
                                  onBlur={async (e) => {
                                    const val = e.target.value.trim();
                                    if (val === cellValue) return;
                                    
                                    if (val === '') {
                                      // 값을 지웠으면 해당 셀의 처방 정보를 제거
                                      if (isCellActive) {
                                        await supabase.from('shockwave_patient_logs').update({ 
                                          therapist_name: '', prescription: '', prescription_count: '' 
                                        }).eq('id', log.id);
                                        fetchLogs();
                                      }
                                    } else {
                                      // 값을 입력했으면 이 담당자와 이 처방으로 덮어씀 (문자열 그대로 저장)
                                      const pDbType = ptype === 'F/Rdc' ? 'F/R DC' : ptype;
                                      await supabase.from('shockwave_patient_logs').update({ 
                                        therapist_name: t.name, prescription: pDbType, prescription_count: val 
                                      }).eq('id', log.id);
                                      fetchLogs();
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') e.target.blur();
                                  }}
                                />
                              </td>
                            );
                          });
                        })}

                        {/* 총건수 (날짜별 로우 병합) */}
                        {index === 0 && (
                          <td rowSpan={group.items.length} className="center-text bold-text" style={{ backgroundColor: '#fff', fontSize: '1.1rem', verticalAlign: 'top', paddingTop: '8px' }}>
                            {dailyGroupTotal > 0 ? dailyGroupTotal : ''}
                          </td>
                        )}

                        {/* 삭제 버튼 */}
                        <td className="center-text">
                          <button 
                            style={{ border: 'none', background: 'none', color: '#ea4335', cursor: 'pointer', padding: '4px', width: '100%', height: '100%' }}
                            onClick={async () => {
                              if(window.confirm('삭제하시겠습니까?')) {
                                await supabase.from('shockwave_patient_logs').delete().eq('id', log.id);
                                fetchLogs();
                              }
                            }}
                            title="행 삭제"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  });
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

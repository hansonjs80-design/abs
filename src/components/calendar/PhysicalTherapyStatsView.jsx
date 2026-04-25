import React, { useMemo, useState, useEffect } from 'react';
import { useSchedule } from '../../contexts/ScheduleContext';
import { generateCalendarGrid } from '../../lib/calendarUtils';
import { supabase } from '../../lib/supabaseClient';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const WEEKDAYS = [1, 2, 3, 4, 5]; // 월~금
const WEEKENDS = [6, 0]; // 토, 일

export default function PhysicalTherapyStatsView() {
  const { currentYear, currentMonth, navigateMonth, staffMemos, loadStaffMemos, calendarSlotSettings } = useSchedule();
  
  const [activeTab, setActiveTab] = useState('monthly'); // 'monthly' | 'yearly'
  
  // 연간 데이터
  const [yearlyYear, setYearlyYear] = useState(new Date().getFullYear());
  const [yearlyData, setYearlyData] = useState({});
  const [loadingYearly, setLoadingYearly] = useState(false);

  // 요일별/평일 통계 제외 설정
  const [selectedDows, setSelectedDows] = useState([1, 2, 3, 4, 5, 6]);
  const [excludedWeekdays, setExcludedWeekdays] = useState([]);

  // 이번 달 데이터 로드
  useEffect(() => {
    if (activeTab === 'monthly') {
      loadStaffMemos(currentYear, currentMonth, { includeAdjacentMonths: false });
    }
  }, [currentYear, currentMonth, loadStaffMemos, activeTab]);

  // 연간 데이터 로드
  useEffect(() => {
    if (activeTab === 'yearly') {
      fetchYearlyData(yearlyYear);
    }
  }, [yearlyYear, activeTab]);

  const fetchYearlyData = async (year) => {
    setLoadingYearly(true);
    try {
      const { data, error } = await supabase
        .from('staff_schedules')
        .select('month, day, slot_index, content')
        .eq('year', year);

      if (error) throw error;
      
      // 월,일별로 가장 높은 slot_index (내용이 있는 것) 찾기
      const dayMaxSlot = {};
      (data || []).forEach(item => {
        if (!item.content || !item.content.trim()) return;
        const k = `${item.month}-${item.day}`;
        if (!dayMaxSlot[k] || item.slot_index > dayMaxSlot[k].slot_index) {
          dayMaxSlot[k] = item;
        }
      });

      // 월별로 매핑
      const mapped = {};
      for (let i = 1; i <= 12; i++) {
        mapped[i] = [];
      }

      Object.values(dayMaxSlot).forEach(item => {
        const match = (item.content || '').match(/\d+/);
        if (match) {
          const val = parseInt(match[0], 10);
          const d = new Date(year, item.month - 1, item.day);
          mapped[item.month].push({
            day: item.day,
            dow: d.getDay(),
            value: val
          });
        }
      });
      setYearlyData(mapped);
    } catch (err) {
      console.error('연간 물리치료 통계 로드 실패:', err);
    } finally {
      setLoadingYearly(false);
    }
  };

  // --- 월간 상세 통계 데이터 ---
  const { grid } = useMemo(() => generateCalendarGrid(currentYear, currentMonth, new Set()), [currentYear, currentMonth]);

  const getSlotCount = (wi) => {
    if (!calendarSlotSettings?.week_slot_counts) return 6;
    return Number(calendarSlotSettings.week_slot_counts[String(wi)]) || 6;
  };

  const weeksData = useMemo(() => {
    return grid.map((week, wi) => {
      const slotCount = getSlotCount(wi);
      const targetSlot = slotCount - 1; // 해당 주차의 마지막 행
      return week.map(day => {
        if (!day.isCurrentMonth) return null;
        const key = `${day.year}-${day.month}-${day.day}-${targetSlot}`;
        const content = staffMemos[key]?.content || '';
        const match = content.match(/\d+/);
        return {
          day: day.day,
          dow: day.dow,
          value: match ? parseInt(match[0], 10) : null
        };
      });
    });
  }, [grid, staffMemos, calendarSlotSettings]);

  const monthlySummary = useMemo(() => {
    let total = 0; let daysWithData = 0;
    weeksData.forEach(week => week.forEach(day => {
      if (day && day.value !== null) { total += day.value; daysWithData++; }
    }));
    return { total, days: daysWithData, average: daysWithData > 0 ? Math.round(total / daysWithData) : 0 };
  }, [weeksData]);

  const weeklyStats = useMemo(() => {
    return weeksData.map((week, idx) => {
      let total = 0; let daysWithData = 0;
      week.forEach(day => {
        if (day && day.value !== null) { total += day.value; daysWithData++; }
      });
      return { weekNumber: idx + 1, total, days: daysWithData, average: daysWithData > 0 ? Math.round(total / daysWithData) : 0 };
    }).filter(w => w.days > 0);
  }, [weeksData]);

  const customDowStats = useMemo(() => {
    let total = 0; let daysWithData = 0;
    weeksData.forEach(week => week.forEach(day => {
      if (day && day.value !== null && selectedDows.includes(day.dow)) { total += day.value; daysWithData++; }
    }));
    return { total, days: daysWithData, average: daysWithData > 0 ? Math.round(total / daysWithData) : 0 };
  }, [weeksData, selectedDows]);

  const typeStats = useMemo(() => {
    let weekdayTotal = 0; let weekdayDays = 0;
    let weekendTotal = 0; let weekendDays = 0;
    weeksData.forEach(week => week.forEach(day => {
      if (day && day.value !== null) {
        if (WEEKDAYS.includes(day.dow)) {
          if (!excludedWeekdays.includes(day.dow)) { weekdayTotal += day.value; weekdayDays++; }
        } else if (WEEKENDS.includes(day.dow)) {
          weekendTotal += day.value; weekendDays++;
        }
      }
    }));
    return {
      weekday: { total: weekdayTotal, days: weekdayDays, average: weekdayDays > 0 ? Math.round(weekdayTotal / weekdayDays) : 0 },
      weekend: { total: weekendTotal, days: weekendDays, average: weekendDays > 0 ? Math.round(weekendTotal / weekendDays) : 0 }
    };
  }, [weeksData, excludedWeekdays]);

  // --- 연간 통계 계산 ---
  const yearlyStatsAgg = useMemo(() => {
    const arr = [];
    let yearTotal = 0; let yearDays = 0;
    let yearWdTotal = 0; let yearWdDays = 0;
    let yearWeTotal = 0; let yearWeDays = 0;
    
    // 개별 요일 누적
    const yearDowTotals = [0, 0, 0, 0, 0, 0, 0];
    const yearDowDays = [0, 0, 0, 0, 0, 0, 0];

    // 특정 그룹 누적
    let yearMtthfTotal = 0; let yearMtthfDays = 0;

    for (let m = 1; m <= 12; m++) {
      const monthDays = yearlyData[m] || [];
      let mTotal = 0; let mDays = 0;
      let mWdTotal = 0; let mWdDays = 0;
      let mWeTotal = 0; let mWeDays = 0;
      
      const mDowTotals = [0, 0, 0, 0, 0, 0, 0];
      const mDowDays = [0, 0, 0, 0, 0, 0, 0];
      let mMtthfTotal = 0; let mMtthfDays = 0;

      monthDays.forEach(d => {
        mTotal += d.value; mDays++;
        if (WEEKDAYS.includes(d.dow)) {
          mWdTotal += d.value; mWdDays++;
        } else {
          mWeTotal += d.value; mWeDays++;
        }
        
        mDowTotals[d.dow] += d.value;
        mDowDays[d.dow]++;
        
        if ([1, 2, 4, 5].includes(d.dow)) { // 월, 화, 목, 금
          mMtthfTotal += d.value;
          mMtthfDays++;
        }
      });

      arr.push({
        month: m,
        total: mTotal,
        days: mDays,
        avg: mDays > 0 ? Math.round(mTotal / mDays) : 0,
        wdAvg: mWdDays > 0 ? Math.round(mWdTotal / mWdDays) : 0,
        weAvg: mWeDays > 0 ? Math.round(mWeTotal / mWeDays) : 0,
        dows: mDowTotals.map((tot, i) => mDowDays[i] > 0 ? Math.round(tot / mDowDays[i]) : 0),
        mtthfAvg: mMtthfDays > 0 ? Math.round(mMtthfTotal / mMtthfDays) : 0,
        wedAvg: mDowDays[3] > 0 ? Math.round(mDowTotals[3] / mDowDays[3]) : 0,
      });

      yearTotal += mTotal; yearDays += mDays;
      yearWdTotal += mWdTotal; yearWdDays += mWdDays;
      yearWeTotal += mWeTotal; yearWeDays += mWeDays;
      
      mDowTotals.forEach((tot, i) => { yearDowTotals[i] += tot; yearDowDays[i] += mDowDays[i]; });
      yearMtthfTotal += mMtthfTotal; yearMtthfDays += mMtthfDays;
    }

    return {
      months: arr,
      year: {
        total: yearTotal,
        days: yearDays,
        avg: yearDays > 0 ? Math.round(yearTotal / yearDays) : 0,
        wdAvg: yearWdDays > 0 ? Math.round(yearWdTotal / yearWdDays) : 0,
        weAvg: yearWeDays > 0 ? Math.round(yearWeTotal / yearWeDays) : 0,
        dows: yearDowTotals.map((tot, i) => yearDowDays[i] > 0 ? Math.round(tot / yearDowDays[i]) : 0),
        mtthfAvg: yearMtthfDays > 0 ? Math.round(yearMtthfTotal / yearMtthfDays) : 0,
        wedAvg: yearDowDays[3] > 0 ? Math.round(yearDowTotals[3] / yearDowDays[3]) : 0,
      }
    };
  }, [yearlyData]);


  const toggleDow = (dow) => setSelectedDows(prev => prev.includes(dow) ? prev.filter(d => d !== dow) : [...prev, dow].sort());
  const toggleExcludeWeekday = (dow) => setExcludedWeekdays(prev => prev.includes(dow) ? prev.filter(d => d !== dow) : [...prev, dow].sort());

  return (
    <div className="pt-stats-container animate-fade-in">
      <div className="pt-stats-header">
        <div className="pt-stats-title">
          <h1>물리치료 데이터 랩</h1>
          <p>직원 근무표의 마지막 줄 숫자를 바탕으로 산출된 엑셀 기반 통계입니다.</p>
        </div>
      </div>

      <div className="pt-stats-tabs">
        <button className={`pt-stats-tab-btn ${activeTab === 'monthly' ? 'active' : ''}`} onClick={() => setActiveTab('monthly')}>월간 상세 통계</button>
        <button className={`pt-stats-tab-btn ${activeTab === 'yearly' ? 'active' : ''}`} onClick={() => setActiveTab('yearly')}>연간 비교 데이터</button>
      </div>

      {activeTab === 'monthly' && (
        <div className="animate-fade-in">
          <div className="year-nav" style={{ marginBottom: '16px', justifyContent: 'flex-start' }}>
            <button onClick={() => navigateMonth(-1)}><ChevronLeft size={16} /></button>
            <span style={{ fontSize: '1.2rem', fontWeight: 800 }}>{currentYear}년 {currentMonth}월</span>
            <button onClick={() => navigateMonth(1)}><ChevronRight size={16} /></button>
          </div>

          <div className="pt-stats-controls">
            <span className="pt-stats-controls-label">맞춤 요일 선택</span>
            <div className="pt-stats-checkbox-group" style={{ paddingRight: 16, borderRight: '1px solid var(--border-color)' }}>
              {[1, 2, 3, 4, 5, 6, 0].map(dow => (
                <label key={`dow-${dow}`} className="pt-stats-checkbox">
                  <input type="checkbox" checked={selectedDows.includes(dow)} onChange={() => toggleDow(dow)} />
                  {DOW_LABELS[dow]}
                </label>
              ))}
            </div>

            <span className="pt-stats-controls-label" style={{ marginLeft: 16 }}>평일(월~금) 제외 요일</span>
            <div className="pt-stats-checkbox-group">
              {WEEKDAYS.map(dow => (
                <label key={`ex-dow-${dow}`} className="pt-stats-checkbox">
                  <input type="checkbox" checked={excludedWeekdays.includes(dow)} onChange={() => toggleExcludeWeekday(dow)} />
                  {DOW_LABELS[dow]} 제외
                </label>
              ))}
            </div>
          </div>

          <div className="pt-stats-grid-row">
            {/* 왼쪽: 주차별 데이터 */}
            <div className="excel-table-wrapper">
              <table className="excel-table">
                <thead>
                  <tr>
                    <th>{currentMonth}월 주차</th>
                    <th>운영 일수</th>
                    <th>총 방문</th>
                    <th>일 평균</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyStats.map(stat => (
                    <tr key={`week-${stat.weekNumber}`}>
                      <td>{stat.weekNumber}주차</td>
                      <td>{stat.days}일</td>
                      <td>{stat.total}</td>
                      <td className="val-highlight">{stat.average}</td>
                    </tr>
                  ))}
                  {weeklyStats.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: 20 }}>데이터가 없습니다.</td></tr>
                  )}
                  {weeklyStats.length > 0 && (
                    <tr className="total-row">
                      <td>월간 총계</td>
                      <td>{monthlySummary.days}일</td>
                      <td>{monthlySummary.total}</td>
                      <td className="val-highlight">{monthlySummary.average}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* 오른쪽: 분석 데이터 */}
            <div className="excel-table-wrapper">
              <table className="excel-table">
                <thead>
                  <tr>
                    <th>분석 항목</th>
                    <th>집계 일수</th>
                    <th>합계 방문</th>
                    <th>산출 평균</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>평일 평균 (월~금)</td>
                    <td>{typeStats.weekday.days}일</td>
                    <td>{typeStats.weekday.total}</td>
                    <td className="val-highlight">{typeStats.weekday.average}</td>
                  </tr>
                  <tr>
                    <td>주말 평균 (토,일)</td>
                    <td>{typeStats.weekend.days}일</td>
                    <td>{typeStats.weekend.total}</td>
                    <td className="val-highlight">{typeStats.weekend.average}</td>
                  </tr>
                  <tr>
                    <td>선택 요일 맞춤</td>
                    <td>{customDowStats.days}일</td>
                    <td>{customDowStats.total}</td>
                    <td className="val-highlight">{customDowStats.average}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'yearly' && (
        <div className="animate-fade-in">
          <div className="year-nav" style={{ marginBottom: '16px', justifyContent: 'center' }}>
            <button onClick={() => setYearlyYear(y => y - 1)}><ChevronLeft size={16} /></button>
            <span style={{ fontSize: '1.2rem', fontWeight: 800 }}>{yearlyYear}년 월별 비교</span>
            <button onClick={() => setYearlyYear(y => y + 1)}><ChevronRight size={16} /></button>
          </div>

          <div className="excel-table-wrapper">
            {loadingYearly ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>데이터를 불러오는 중입니다...</div>
            ) : (
              <table className="excel-table" style={{ minWidth: 800 }}>
                <thead>
                  <tr>
                    <th>{yearlyYear}년</th>
                    {yearlyStatsAgg.months.map(m => (
                      <th key={`th-${m.month}`}>{m.month}월</th>
                    ))}
                    <th style={{ background: 'var(--brand-primary-light)', color: 'var(--brand-primary)' }}>연간 누적/평균</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>총 방문자</td>
                    {yearlyStatsAgg.months.map(m => (
                      <td key={`td-total-${m.month}`}>{m.total || '-'}</td>
                    ))}
                    <td className="val-highlight">{yearlyStatsAgg.year.total || '-'}</td>
                  </tr>
                  <tr>
                    <td>전체 일평균</td>
                    {yearlyStatsAgg.months.map(m => (
                      <td key={`td-avg-${m.month}`} className="val-highlight" style={{ color: m.avg > 0 ? 'var(--brand-primary)' : 'inherit' }}>{m.avg || '-'}</td>
                    ))}
                    <td className="val-highlight" style={{ background: 'var(--bg-tertiary)' }}>{yearlyStatsAgg.year.avg || '-'}</td>
                  </tr>
                  <tr>
                    <td>평일(월~금) 평균</td>
                    {yearlyStatsAgg.months.map(m => (
                      <td key={`td-wd-${m.month}`}>{m.wdAvg || '-'}</td>
                    ))}
                    <td style={{ fontWeight: 800, background: 'var(--bg-tertiary)' }}>{yearlyStatsAgg.year.wdAvg || '-'}</td>
                  </tr>
                  <tr>
                    <td>월/화/목/금 평균</td>
                    {yearlyStatsAgg.months.map(m => (
                      <td key={`td-mtthf-${m.month}`}>{m.mtthfAvg || '-'}</td>
                    ))}
                    <td style={{ fontWeight: 800, background: 'var(--bg-tertiary)' }}>{yearlyStatsAgg.year.mtthfAvg || '-'}</td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--text-secondary)' }}>수요일 평균</td>
                    {yearlyStatsAgg.months.map(m => (
                      <td key={`td-wed-${m.month}`} style={{ color: 'var(--text-secondary)' }}>{m.wedAvg || '-'}</td>
                    ))}
                    <td style={{ fontWeight: 800, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)' }}>{yearlyStatsAgg.year.wedAvg || '-'}</td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--text-secondary)' }}>토요일 평균</td>
                    {yearlyStatsAgg.months.map(m => (
                      <td key={`td-sat-${m.month}`} style={{ color: 'var(--text-secondary)' }}>{m.dows[6] || '-'}</td>
                    ))}
                    <td style={{ fontWeight: 800, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)' }}>{yearlyStatsAgg.year.dows[6] || '-'}</td>
                  </tr>
                  <tr>
                    <td>주말(토,일) 평균</td>
                    {yearlyStatsAgg.months.map(m => (
                      <td key={`td-we-${m.month}`}>{m.weAvg || '-'}</td>
                    ))}
                    <td style={{ fontWeight: 800, background: 'var(--bg-tertiary)' }}>{yearlyStatsAgg.year.weAvg || '-'}</td>
                  </tr>
                  {/* 개별 요일 세부 평균 표기 */}
                  <tr style={{ height: 4 }}>
                    <td colSpan={14} style={{ padding: 0, background: 'var(--bg-tertiary)' }} />
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>월요일 평균</td>
                    {yearlyStatsAgg.months.map(m => <td key={`td-mon-${m.month}`} style={{ color: 'var(--text-tertiary)' }}>{m.dows[1] || '-'}</td>)}
                    <td style={{ color: 'var(--text-tertiary)', background: 'var(--bg-tertiary)' }}>{yearlyStatsAgg.year.dows[1] || '-'}</td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>화요일 평균</td>
                    {yearlyStatsAgg.months.map(m => <td key={`td-tue-${m.month}`} style={{ color: 'var(--text-tertiary)' }}>{m.dows[2] || '-'}</td>)}
                    <td style={{ color: 'var(--text-tertiary)', background: 'var(--bg-tertiary)' }}>{yearlyStatsAgg.year.dows[2] || '-'}</td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>목요일 평균</td>
                    {yearlyStatsAgg.months.map(m => <td key={`td-thu-${m.month}`} style={{ color: 'var(--text-tertiary)' }}>{m.dows[4] || '-'}</td>)}
                    <td style={{ color: 'var(--text-tertiary)', background: 'var(--bg-tertiary)' }}>{yearlyStatsAgg.year.dows[4] || '-'}</td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>금요일 평균</td>
                    {yearlyStatsAgg.months.map(m => <td key={`td-fri-${m.month}`} style={{ color: 'var(--text-tertiary)' }}>{m.dows[5] || '-'}</td>)}
                    <td style={{ color: 'var(--text-tertiary)', background: 'var(--bg-tertiary)' }}>{yearlyStatsAgg.year.dows[5] || '-'}</td>
                  </tr>
                  <tr style={{ height: 4 }}>
                    <td colSpan={14} style={{ padding: 0, background: 'var(--bg-tertiary)' }} />
                  </tr>
                  <tr>
                    <td>영업(기록) 일수</td>
                    {yearlyStatsAgg.months.map(m => (
                      <td key={`td-days-${m.month}`} style={{ color: 'var(--text-tertiary)' }}>{m.days > 0 ? `${m.days}일` : '-'}</td>
                    ))}
                    <td style={{ color: 'var(--text-tertiary)', background: 'var(--bg-tertiary)' }}>{yearlyStatsAgg.year.days > 0 ? `${yearlyStatsAgg.year.days}일` : '-'}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { useSchedule } from '../../contexts/ScheduleContext';
import { usePTCalendarCounts } from '../../hooks/usePTCalendarCounts';
import { fetchPTStatsYear, getPTStatsWeeks } from '../../lib/physicalTherapyStats';
import { supabase } from '../../lib/supabaseClient';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const WEEKDAYS = [1, 2, 3, 4, 5]; // 월~금
const WEEKENDS = [6, 0]; // 토, 일

export default function PhysicalTherapyStatsView() {
  const { currentYear, currentMonth, navigateMonth, staffMemos, loadStaffMemos, calendarSlotSettings, loadCalendarSlotSettings } = useSchedule();
  
  const [activeTab, setActiveTab] = useState('monthly'); // 'monthly' | 'yearly'
  
  // 연간 데이터
  const [yearlyYear, setYearlyYear] = useState(new Date().getFullYear());
  const [yearlySnapshot, setYearlySnapshot] = useState(null);
  const [yearlyError, setYearlyError] = useState(false);
  const [loadingYearly, setLoadingYearly] = useState(false);

  // 요일별/평일 통계 제외 설정
  const [selectedDows, setSelectedDows] = useState([1, 2, 3, 4, 5, 6]);
  const [excludedWeekdays, setExcludedWeekdays] = useState([]);

  const rangeYear = activeTab === 'yearly' ? yearlyYear : currentYear;
  const startDate = `${rangeYear}-${activeTab === 'yearly' ? '01' : String(currentMonth).padStart(2, '0')}-01`;
  const endDate = activeTab === 'yearly' ? `${rangeYear}-12-31`
    : `${rangeYear}-${String(currentMonth).padStart(2, '0')}-${new Date(rangeYear, currentMonth, 0).getDate()}`;
  const ptCounts = usePTCalendarCounts(startDate, endDate, { readOnly: true });

  useEffect(() => {
    if (activeTab === 'monthly') {
      loadStaffMemos(currentYear, currentMonth, { includeAdjacentMonths: false });
      loadCalendarSlotSettings(currentYear, currentMonth);
    }
  }, [currentYear, currentMonth, loadStaffMemos, loadCalendarSlotSettings, activeTab]);

  useEffect(() => {
    if (activeTab !== 'yearly') return;
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    setLoadingYearly(true);
    setYearlyError(false);
    fetchPTStatsYear(supabase, yearlyYear, controller.signal)
      .then(data => { if (active) setYearlySnapshot({ ...data, year: yearlyYear }); })
      .catch(() => { if (active) setYearlyError(true); })
      .finally(() => { clearTimeout(timeout); if (active) setLoadingYearly(false); });
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [yearlyYear, activeTab]);

  const weeksData = useMemo(() => getPTStatsWeeks(
    currentYear, currentMonth, staffMemos, calendarSlotSettings, ptCounts
  ), [currentYear, currentMonth, staffMemos, calendarSlotSettings, ptCounts]);

  const yearlyData = useMemo(() => {
    if (yearlySnapshot?.year !== yearlyYear) return {};
    return Object.fromEntries(Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      return [month, getPTStatsWeeks(yearlyYear, month, yearlySnapshot.memos,
        yearlySnapshot.settings[month], ptCounts).flat().filter(day => day && day.value !== null)];
    }));
  }, [yearlySnapshot, yearlyYear, ptCounts]);

  // 두 체크박스 그룹을 모든 월간 집계에 동일하게 적용한다.
  const isIncludedDow = useCallback(dow => selectedDows.includes(dow) && !excludedWeekdays.includes(dow), [selectedDows, excludedWeekdays]);

  const monthlySummary = useMemo(() => {
    let total = 0; let daysWithData = 0;
    weeksData.forEach(week => week.forEach(day => {
      if (day && day.value !== null && isIncludedDow(day.dow)) { total += day.value; daysWithData++; }
    }));
    return { total, days: daysWithData, average: daysWithData > 0 ? Math.round(total / daysWithData) : 0 };
  }, [weeksData, isIncludedDow]);

  const weeklyStats = useMemo(() => {
    return weeksData.map((week, idx) => {
      let total = 0; let daysWithData = 0;
      week.forEach(day => {
        if (day && day.value !== null && isIncludedDow(day.dow)) { total += day.value; daysWithData++; }
      });
      return { weekNumber: idx + 1, dates: week, total, days: daysWithData, average: daysWithData > 0 ? Math.round(total / daysWithData) : 0 };
    });
  }, [weeksData, isIncludedDow]);

  const monthlyDowStats = useMemo(() => DOW_LABELS.map((_, dow) => {
    const recordedDays = weeksData.flat().filter(day => day?.dow === dow && day.value !== null && isIncludedDow(dow));
    const total = recordedDays.reduce((sum, day) => sum + day.value, 0);
    return { total: recordedDays.length ? total : null, average: recordedDays.length ? Math.round(total / recordedDays.length) : null };
  }), [weeksData, isIncludedDow]);

  const customDowStats = monthlySummary;

  const typeStats = useMemo(() => {
    let weekdayTotal = 0; let weekdayDays = 0;
    let weekendTotal = 0; let weekendDays = 0;
    weeksData.forEach(week => week.forEach(day => {
      if (day && day.value !== null && isIncludedDow(day.dow)) {
        if (WEEKDAYS.includes(day.dow)) {
          weekdayTotal += day.value; weekdayDays++;
        } else if (WEEKENDS.includes(day.dow)) {
          weekendTotal += day.value; weekendDays++;
        }
      }
    }));
    return {
      weekday: { total: weekdayTotal, days: weekdayDays, average: weekdayDays > 0 ? Math.round(weekdayTotal / weekdayDays) : 0 },
      weekend: { total: weekendTotal, days: weekendDays, average: weekendDays > 0 ? Math.round(weekendTotal / weekendDays) : 0 }
    };
  }, [weeksData, isIncludedDow]);

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
    <div className={`pt-stats-container animate-fade-in ${activeTab === 'monthly' ? 'pt-stats-monthly' : ''}`}>
      <div className="pt-stats-header">
        <div className="pt-stats-title">
          <h1>물리치료 데이터 랩</h1>
          <p>직원 근무표 마지막 줄에 표시되는 인원(PT현황 연동·수동 수정 포함)을 집계합니다.</p>
        </div>
      </div>

      <div className="pt-stats-tabs">
        <button className={`pt-stats-tab-btn ${activeTab === 'monthly' ? 'active' : ''}`} onClick={() => setActiveTab('monthly')}>월간 상세 통계</button>
        <button className={`pt-stats-tab-btn ${activeTab === 'yearly' ? 'active' : ''}`} onClick={() => setActiveTab('yearly')}>연간 비교 데이터</button>
      </div>

      {ptCounts.loading && <p role="status">PT현황 연동 인원을 불러오는 중입니다.</p>}
      {ptCounts.error && <p role="alert">PT현황 연동 조회에 실패했습니다. 표시된 통계가 최신 연동값과 다를 수 있습니다. 연결 복구 후 자동 갱신합니다.</p>}
      {yearlyError && activeTab === 'yearly' && <p role="alert">연간 근무표 조회에 실패했습니다. 다른 연도를 선택하거나 화면을 다시 열어 주세요.</p>}
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

          <p className="pt-calendar-guide">체크한 요일에서 평일 제외 요일을 빼고 집계합니다. 흐린 칸은 집계 제외 · —는 미입력 · 평균은 숫자가 표시된 날 기준(수동 0명 포함, 연동 공란 제외, 반올림)입니다.</p>
          <div className="pt-stats-grid-row pt-stats-monthly-grid">
            <div className="excel-table-wrapper pt-calendar-wrapper" tabIndex={0} role="region" aria-label="날짜별 방문 통계 표, 좁은 화면에서는 좌우로 스크롤">
              <table className="excel-table pt-calendar-table" aria-label={`${currentYear}년 ${currentMonth}월 주차별 요일별 방문 통계`}>
                <thead>
                  <tr>
                    <th scope="col">{currentMonth}월 주차</th>
                    {DOW_LABELS.map((label, dow) => <th key={label} scope="col" className={`${dow === 0 ? 'pt-calendar-sunday' : dow === 6 ? 'pt-calendar-saturday' : ''} ${!isIncludedDow(dow) ? 'pt-calendar-excluded' : ''}`}>{label}</th>)}
                    <th scope="col" className="pt-calendar-summary-start">주간 합계</th>
                    <th scope="col">운영 일수</th>
                    <th scope="col">일 평균</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyStats.map(stat => (
                    <tr key={`week-${stat.weekNumber}`}>
                      <th scope="row">{stat.weekNumber}주차</th>
                      {stat.dates.map((day, dow) => (
                        <td key={dow} className={`pt-calendar-day ${!day ? 'pt-calendar-outside' : ''} ${!isIncludedDow(dow) ? 'pt-calendar-excluded' : ''}`} title={!isIncludedDow(dow) ? '집계 제외' : undefined}>
                          {day && <>
                            <span className={`pt-calendar-date ${dow === 0 ? 'pt-calendar-sunday' : dow === 6 ? 'pt-calendar-saturday' : ''}`}>{day.day}일</span>
                            <span className={`pt-calendar-count ${day.value === null ? 'pt-calendar-missing' : ''}`} aria-label={`${currentMonth}월 ${day.day}일 ${DOW_LABELS[dow]}요일 ${day.value === null ? '미입력' : `${day.value}명`}`}>
                              {day.value === null ? '—' : `${day.value.toLocaleString()}명`}
                            </span>
                          </>}
                        </td>
                      ))}
                      <td className="val-highlight pt-calendar-summary-start">{stat.days ? `${stat.total.toLocaleString()}명` : '—'}</td>
                      <td>{stat.days}일</td>
                      <td className="val-highlight">{stat.days ? `${stat.average.toLocaleString()}명` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                    <tr className="total-row">
                      <th scope="row">요일별 합계</th>
                      {monthlyDowStats.map(({ total }, dow) => <td key={dow} className={!isIncludedDow(dow) ? 'pt-calendar-excluded' : ''} aria-label={`${DOW_LABELS[dow]}요일 합계 ${!isIncludedDow(dow) ? '집계 제외' : total === null ? '미입력' : `${total}명`}`}>{total === null ? '—' : `${total.toLocaleString()}명`}</td>)}
                      <td className="pt-calendar-summary-start">{monthlySummary.days ? `${monthlySummary.total.toLocaleString()}명` : '—'}</td>
                      <td>{monthlySummary.days}일</td>
                      <td>{monthlySummary.days ? `${monthlySummary.average.toLocaleString()}명` : '—'}</td>
                    </tr>
                    <tr className="pt-calendar-average-row">
                      <th scope="row">요일별 평균</th>
                      {monthlyDowStats.map(({ average }, dow) => <td key={dow} className={!isIncludedDow(dow) ? 'pt-calendar-excluded' : ''} aria-label={`${DOW_LABELS[dow]}요일 평균 ${!isIncludedDow(dow) ? '집계 제외' : average === null ? '미입력' : `${average}명`}`}>{average === null ? '—' : `${average.toLocaleString()}명`}</td>)}
                      <td colSpan={2} className="pt-calendar-summary-start">전체 일 평균</td>
                      <td>{monthlySummary.days ? `${monthlySummary.average.toLocaleString()}명` : '—'}</td>
                    </tr>
                </tfoot>
              </table>
            </div>

            {/* 달력 아래: 기존 요일 선택 / 평일·주말 분석 */}
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
            {loadingYearly || ptCounts.loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>데이터를 불러오는 중입니다...</div>
            ) : (
              <table className="excel-table">
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

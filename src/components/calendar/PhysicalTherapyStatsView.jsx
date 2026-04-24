import React, { useMemo, useState, useEffect } from 'react';
import { useSchedule } from '../../contexts/ScheduleContext';
import { generateCalendarGrid } from '../../lib/calendarUtils';

const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const WEEKDAYS = [1, 2, 3, 4, 5]; // 월~금
const WEEKENDS = [6, 0]; // 토, 일

export default function PhysicalTherapyStatsView() {
  const { currentYear, currentMonth, navigateMonth, staffMemos, loadStaffMemos } = useSchedule();

  useEffect(() => {
    loadStaffMemos(currentYear, currentMonth, { includeAdjacentMonths: false });
  }, [currentYear, currentMonth, loadStaffMemos]);

  const { grid } = useMemo(() => generateCalendarGrid(currentYear, currentMonth, new Set()), [currentYear, currentMonth]);

  // 요일별 통계: 선택된 요일 (기본: 월~토)
  const [selectedDows, setSelectedDows] = useState([1, 2, 3, 4, 5, 6]);
  
  // 평일 통계: 제외할 평일 (기본: 없음)
  const [excludedWeekdays, setExcludedWeekdays] = useState([]);

  // 데이터 추출
  const weeksData = useMemo(() => {
    return grid.map(week => {
      return week.map(day => {
        if (!day.isCurrentMonth) return null;
        // 6번째 줄 (슬롯 5)
        const key = `${day.year}-${day.month}-${day.day}-5`;
        const content = staffMemos[key]?.content || '';
        const match = content.match(/\d+/);
        return {
          day: day.day,
          dow: day.dow,
          value: match ? parseInt(match[0], 10) : null
        };
      });
    });
  }, [grid, staffMemos]);

  // 월간 전체 요약
  const monthlySummary = useMemo(() => {
    let total = 0;
    let daysWithData = 0;

    weeksData.forEach(week => {
      week.forEach(day => {
        if (day && day.value !== null) {
          total += day.value;
          daysWithData++;
        }
      });
    });

    return {
      total,
      days: daysWithData,
      average: daysWithData > 0 ? Math.round(total / daysWithData) : 0
    };
  }, [weeksData]);

  // 주차별 통계
  const weeklyStats = useMemo(() => {
    return weeksData.map((week, idx) => {
      let total = 0;
      let daysWithData = 0;
      week.forEach(day => {
        if (day && day.value !== null) {
          total += day.value;
          daysWithData++;
        }
      });
      return {
        weekNumber: idx + 1,
        total,
        days: daysWithData,
        average: daysWithData > 0 ? Math.round(total / daysWithData) : 0
      };
    }).filter(w => w.days > 0); // 데이터가 아예 없는 주차는 제외할 수 있음 (선택 사항)
  }, [weeksData]);

  // 요일별 통계 (체크박스 반영)
  const customDowStats = useMemo(() => {
    let total = 0;
    let daysWithData = 0;

    weeksData.forEach(week => {
      week.forEach(day => {
        if (day && day.value !== null && selectedDows.includes(day.dow)) {
          total += day.value;
          daysWithData++;
        }
      });
    });

    return {
      total,
      days: daysWithData,
      average: daysWithData > 0 ? Math.round(total / daysWithData) : 0
    };
  }, [weeksData, selectedDows]);

  // 평일/주말 통계
  const typeStats = useMemo(() => {
    let weekdayTotal = 0;
    let weekdayDays = 0;
    let weekendTotal = 0;
    let weekendDays = 0;

    weeksData.forEach(week => {
      week.forEach(day => {
        if (day && day.value !== null) {
          if (WEEKDAYS.includes(day.dow)) {
            // 평일 중 제외 요일이 아니면
            if (!excludedWeekdays.includes(day.dow)) {
              weekdayTotal += day.value;
              weekdayDays++;
            }
          } else if (WEEKENDS.includes(day.dow)) {
            weekendTotal += day.value;
            weekendDays++;
          }
        }
      });
    });

    return {
      weekday: {
        total: weekdayTotal,
        days: weekdayDays,
        average: weekdayDays > 0 ? Math.round(weekdayTotal / weekdayDays) : 0
      },
      weekend: {
        total: weekendTotal,
        days: weekendDays,
        average: weekendDays > 0 ? Math.round(weekendTotal / weekendDays) : 0
      }
    };
  }, [weeksData, excludedWeekdays]);

  const toggleDow = (dow) => {
    setSelectedDows(prev => 
      prev.includes(dow) ? prev.filter(d => d !== dow) : [...prev, dow].sort()
    );
  };

  const toggleExcludeWeekday = (dow) => {
    setExcludedWeekdays(prev => 
      prev.includes(dow) ? prev.filter(d => d !== dow) : [...prev, dow].sort()
    );
  };

  return (
    <div className="pt-stats-container animate-fade-in">
      <div className="pt-stats-header">
        <div className="pt-stats-title">
          <h1>물리치료 방문자 통계</h1>
          <p>직원 근무표 달력의 일별 합계(6번째 줄) 데이터를 기준으로 집계됩니다.</p>
        </div>
        <div className="pt-stats-summary">
          <div className="pt-stats-summary-item">
            <span className="pt-stats-summary-label">월 총 방문</span>
            <span className="pt-stats-summary-value">{monthlySummary.total}명</span>
          </div>
          <div className="pt-stats-summary-item">
            <span className="pt-stats-summary-label">일 평균 ({monthlySummary.days}일)</span>
            <span className="pt-stats-summary-value">{monthlySummary.average}명</span>
          </div>
        </div>
      </div>

      <div className="pt-stats-grid">
        {/* 주차별 통계 */}
        <div className="pt-stats-card">
          <div className="pt-stats-card-header">주차별 통계</div>
          <div className="pt-stats-card-body" style={{ padding: 0 }}>
            <table className="pt-stats-table">
              <thead>
                <tr>
                  <th>주차</th>
                  <th>운영 일수</th>
                  <th>총 방문</th>
                  <th>평균</th>
                </tr>
              </thead>
              <tbody>
                {weeklyStats.map(stat => (
                  <tr key={`week-${stat.weekNumber}`}>
                    <td>{stat.weekNumber}주차</td>
                    <td>{stat.days}일</td>
                    <td>{stat.total}명</td>
                    <td style={{ fontWeight: 600, color: 'var(--brand-primary)' }}>{stat.average}명</td>
                  </tr>
                ))}
                {weeklyStats.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-tertiary)' }}>
                      기록된 데이터가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 요일별 선택 통계 */}
        <div className="pt-stats-card">
          <div className="pt-stats-card-header">맞춤 요일별 통계</div>
          <div className="pt-stats-card-body">
            <div className="pt-stats-checkbox-group">
              {[1, 2, 3, 4, 5, 6, 0].map(dow => (
                <label key={`dow-${dow}`} className="pt-stats-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedDows.includes(dow)}
                    onChange={() => toggleDow(dow)}
                  />
                  {DOW_LABELS[dow]}요일
                </label>
              ))}
            </div>
            
            <div className="pt-stats-result-box">
              <div className="pt-stats-result-item">
                <span className="pt-stats-result-label">선택 요일 총합</span>
                <span className="pt-stats-result-value">{customDowStats.total}명</span>
              </div>
              <div className="pt-stats-result-item">
                <span className="pt-stats-result-label">선택 요일 평균 ({customDowStats.days}일)</span>
                <span className="pt-stats-result-value" style={{ color: 'var(--brand-primary)' }}>{customDowStats.average}명</span>
              </div>
            </div>
          </div>
        </div>

        {/* 평일/주말 통계 */}
        <div className="pt-stats-card">
          <div className="pt-stats-card-header">평일 및 주말 통계</div>
          <div className="pt-stats-card-body">
            <div style={{ marginBottom: '16px' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
                평일(월~금) 통계에서 제외할 요일:
              </span>
              <div className="pt-stats-checkbox-group" style={{ borderBottom: 'none', paddingBottom: 0, marginBottom: 0 }}>
                {WEEKDAYS.map(dow => (
                  <label key={`ex-dow-${dow}`} className="pt-stats-checkbox">
                    <input
                      type="checkbox"
                      checked={excludedWeekdays.includes(dow)}
                      onChange={() => toggleExcludeWeekday(dow)}
                    />
                    {DOW_LABELS[dow]} 제외
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="pt-stats-result-box" style={{ margin: 0, justifyContent: 'space-between', padding: '16px 20px' }}>
                <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>평일 평균 ({typeStats.weekday.days}일)</div>
                <div className="pt-stats-result-value" style={{ color: 'var(--brand-primary)' }}>{typeStats.weekday.average}명 <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontWeight: 'normal' }}>/ {typeStats.weekday.total}</span></div>
              </div>
              <div className="pt-stats-result-box" style={{ margin: 0, justifyContent: 'space-between', padding: '16px 20px' }}>
                <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>주말 평균 ({typeStats.weekend.days}일)</div>
                <div className="pt-stats-result-value" style={{ color: 'var(--brand-primary)' }}>{typeStats.weekend.average}명 <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontWeight: 'normal' }}>/ {typeStats.weekend.total}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

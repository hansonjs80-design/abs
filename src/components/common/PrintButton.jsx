import { useEffect, useMemo, useRef, useState } from 'react';
import { Printer } from 'lucide-react';

const PRINT_STYLE_ID = 'clinic-print-orientation-style';

function setPrintOrientation(orientation) {
  document.documentElement.dataset.printOrientation = orientation;

  let style = document.getElementById(PRINT_STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = PRINT_STYLE_ID;
    document.head.appendChild(style);
  }

  style.textContent = `@media print { @page { size: ${orientation}; margin: 6mm; } }`;
}

/**
 * 달력 그리드에서 실제 주차 수와 마지막 주차에 이번 달 평일이 있는지 감지
 */
function detectCalendarWeekInfo() {
  const calendarGrid = document.querySelector('.calendar-grid');
  if (!calendarGrid) return { totalWeeks: 5, lastWeekHasWeekday: true };

  const weekdayHeaders = calendarGrid.querySelectorAll('.calendar-weekday-header').length;
  const allCells = Array.from(calendarGrid.children).slice(weekdayHeaders); // 요일 헤더 제외
  const totalWeeks = Math.round(allCells.length / 7);

  if (totalWeeks <= 5) return { totalWeeks, lastWeekHasWeekday: true };

  // 마지막 주(6주차)의 셀 확인: 이번 달 평일(월~토)이 있는지
  const lastWeekCells = allCells.slice((totalWeeks - 1) * 7);
  const lastWeekHasWeekday = lastWeekCells.some((cell, colIdx) => {
    // colIdx 0 = 일요일 → 평일이 아님
    if (colIdx === 0) return false;
    // other-month 클래스가 없으면 이번 달 셀
    return !cell.classList.contains('other-month');
  });

  return { totalWeeks, lastWeekHasWeekday };
}

export default function PrintButton({ isStaffSchedule }) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef(null);

  // 메뉴가 열릴 때마다 달력 주차 정보를 감지
  const weekInfo = useMemo(() => {
    if (!isOpen || !isStaffSchedule) return null;
    return detectCalendarWeekInfo();
  }, [isOpen, isStaffSchedule]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const handlePrint = (orientation, calendarOnly = false, forceWeeks = null) => {
    setPrintOrientation(orientation);
    
    if (calendarOnly) {
      document.body.classList.add('calendar-only-print');

      // 주차 수 결정
      let weekCount;
      if (forceWeeks) {
        weekCount = forceWeeks;
      } else {
        const info = detectCalendarWeekInfo();
        weekCount = info.totalWeeks;
      }
      document.body.dataset.calendarWeeks = String(weekCount);

      // 5주로 강제 인쇄 시 6주차 행 숨기기
      if (forceWeeks === 5 && weekInfo?.totalWeeks === 6) {
        document.body.classList.add('hide-last-week');
      }
    } else {
      document.body.classList.remove('calendar-only-print');
      document.body.classList.remove('hide-last-week');
      delete document.body.dataset.calendarWeeks;
    }
    
    setIsOpen(false);
    
    window.setTimeout(() => {
      window.print();
      window.setTimeout(() => {
        document.body.classList.remove('calendar-only-print');
        document.body.classList.remove('hide-last-week');
        delete document.body.dataset.calendarWeeks;
      }, 500);
    }, 0);
  };

  // 6주차 달인데 마지막 주에 평일이 없는 경우 → 5주/6주 선택 옵션 제공
  const show6WeekChoice = isStaffSchedule && weekInfo && weekInfo.totalWeeks === 6 && !weekInfo.lastWeekHasWeekday;

  return (
    <div className="print-menu-root" ref={rootRef}>
      <button
        className="print-toggle"
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label="현재 화면 인쇄"
        title="현재 화면 인쇄"
        aria-expanded={isOpen}
      >
        <Printer size={20} />
      </button>
      {isOpen && (
        <div className="print-orientation-menu" role="menu" aria-label="인쇄 방향 선택">
          <button type="button" onClick={() => handlePrint('landscape')} role="menuitem">
            가로
          </button>
          <button type="button" onClick={() => handlePrint('portrait')} role="menuitem">
            세로
          </button>
          {isStaffSchedule && !show6WeekChoice && (
            <button type="button" onClick={() => handlePrint('landscape', true)} role="menuitem" style={{ color: 'var(--brand-primary)', fontWeight: 600 }}>
              달력만 인쇄 (가로)
            </button>
          )}
          {show6WeekChoice && (
            <>
              <button type="button" onClick={() => handlePrint('landscape', true, 5)} role="menuitem" style={{ color: 'var(--brand-primary)', fontWeight: 600 }}>
                달력만 인쇄 (5주)
              </button>
              <button type="button" onClick={() => handlePrint('landscape', true, 6)} role="menuitem" style={{ color: '#6366f1', fontWeight: 600 }}>
                달력만 인쇄 (6주)
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

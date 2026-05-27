import { useEffect, useMemo, useRef, useState } from 'react';
import { Printer } from 'lucide-react';

const PRINT_STYLE_ID = 'clinic-print-orientation-style';

function setPrintOrientation(orientation, margin = '6mm') {
  document.documentElement.dataset.printOrientation = orientation;

  const pageSize = orientation === 'landscape' ? 'A4 landscape' :
                   orientation === 'portrait' ? 'A4 portrait' : orientation;

  let style = document.getElementById(PRINT_STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = PRINT_STYLE_ID;
    document.head.appendChild(style);
  }

  style.textContent = `@media print { @page { size: ${pageSize}; margin: ${margin}; } }`;
}

/**
 * 각 주(calendar-cell 7개 묶음)에서 특정 슬롯 인덱스의 모든 7개 셀이 비어있으면
 * 해당 슬롯을 숨겨 인쇄 공간을 확보합니다.
 * 각 주에서 최대 1개의 빈 행만 숨깁니다.
 */
const HIDDEN_MEMO_ATTR = 'data-print-hidden';
const ORIGINAL_GRID_ROWS_ATTR = 'data-original-grid-rows';

function hideEmptyMemoRows() {
  const calendarGrid = document.querySelector('.calendar-grid');
  if (!calendarGrid) return;

  const weekdayHeaders = calendarGrid.querySelectorAll('.calendar-weekday-header').length;
  const allCells = Array.from(calendarGrid.children).slice(weekdayHeaders);
  const totalWeeks = Math.round(allCells.length / 7);

  for (let w = 0; w < totalWeeks; w++) {
    const weekCells = allCells.slice(w * 7, (w + 1) * 7);
    const memoContainers = weekCells.map(cell => cell.querySelector('.calendar-memos'));
    const slotCount = memoContainers[0]?.children.length || 0;
    if (slotCount <= 1) continue;

    // 마지막 슬롯부터 역순으로 확인하여 첫 번째로 모든 7개가 비어있는 행 숨기기
    for (let s = slotCount - 1; s >= 0; s--) {
      const allEmpty = memoContainers.every(container => {
        const slot = container?.children[s];
        if (!slot) return true;
        return (slot.textContent?.trim() || '') === '';
      });

      if (allEmpty) {
        const newRowCount = slotCount - 1;
        memoContainers.forEach(container => {
          const slot = container?.children[s];
          if (slot) {
            slot.setAttribute(HIDDEN_MEMO_ATTR, 'true');
            slot.style.display = 'none';
          }
          // grid-template-rows 업데이트하여 남은 행이 공간을 꽉 채우도록
          if (container) {
            container.setAttribute(ORIGINAL_GRID_ROWS_ATTR, container.style.gridTemplateRows || '');
            container.style.gridTemplateRows = `repeat(${newRowCount}, minmax(0, 1fr))`;
          }
        });
        break; // 주당 최대 1개만 숨김
      }
    }
  }
}

function restoreHiddenMemoRows() {
  document.querySelectorAll(`[${HIDDEN_MEMO_ATTR}]`).forEach(el => {
    el.removeAttribute(HIDDEN_MEMO_ATTR);
    el.style.display = '';
  });
  document.querySelectorAll(`[${ORIGINAL_GRID_ROWS_ATTR}]`).forEach(el => {
    el.style.gridTemplateRows = el.getAttribute(ORIGINAL_GRID_ROWS_ATTR) || '';
    el.removeAttribute(ORIGINAL_GRID_ROWS_ATTR);
  });
}

function cleanupPrintState() {
  document.body.classList.remove('calendar-only-print');
  document.body.classList.remove('hide-last-week');
  document.body.classList.remove('new-patient-print');
  document.body.classList.remove('settlement-print');
  delete document.body.dataset.calendarWeeks;
  restoreHiddenMemoRows();
}

function registerPrintCleanup() {
  let cleaned = false;
  let printDialogOpened = false;

  const cleanupOnce = () => {
    if (cleaned) return;
    cleaned = true;
    cleanupPrintState();
    window.removeEventListener('afterprint', cleanupOnce);
    window.removeEventListener('blur', handlePrintWindowBlur);
    window.removeEventListener('focus', handlePrintWindowFocus);
  };

  const handlePrintWindowBlur = () => {
    printDialogOpened = true;
  };

  const handlePrintWindowFocus = () => {
    if (printDialogOpened) cleanupOnce();
  };

  window.addEventListener('afterprint', cleanupOnce, { once: true });
  window.addEventListener('blur', handlePrintWindowBlur, { once: true });
  window.addEventListener('focus', handlePrintWindowFocus);

  return cleanupOnce;
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
    const isNewPatientPortraitPrint = !calendarOnly && orientation === 'portrait' && Boolean(document.querySelector('.sw-new-patient-table'));
    setPrintOrientation(isNewPatientPortraitPrint ? 'A4 portrait' : orientation, isNewPatientPortraitPrint ? '8mm 5mm 6mm' : '6mm');
    
    if (calendarOnly) {
      document.body.classList.remove('new-patient-print');
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

      // 각 주차마다 비어있는 메모 슬롯 행 1개 숨기기 (공간 절약)
      hideEmptyMemoRows();
    } else {
      document.body.classList.remove('calendar-only-print');
      document.body.classList.remove('hide-last-week');
      delete document.body.dataset.calendarWeeks;
      
      const isSettlementPrint = Boolean(document.querySelector('.sw-settlement-table'));
      if (isNewPatientPortraitPrint) {
        document.body.classList.add('new-patient-print');
        document.body.classList.remove('settlement-print');
      } else if (isSettlementPrint) {
        document.body.classList.remove('new-patient-print');
        document.body.classList.add('settlement-print');
      } else {
        document.body.classList.remove('new-patient-print');
        document.body.classList.remove('settlement-print');
      }
    }
    
    setIsOpen(false);
    registerPrintCleanup();
    window.print();
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

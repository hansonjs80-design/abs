import { useEffect, useMemo, useRef, useState } from 'react';
import { Printer } from 'lucide-react';

const PRINT_STYLE_ID = 'clinic-print-orientation-style';
const STATS_GRID_PRINT_FRAME_ID = 'stats-grid-print-frame';

function hasVisiblePrintTarget(selector) {
  return Array.from(document.querySelectorAll(selector)).some(
    (element) => !element.closest('[hidden]')
  );
}

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

function removeStatsGridPrintFrame() {
  document.getElementById(STATS_GRID_PRINT_FRAME_ID)?.remove();
}

function expandStatsGridPrintRowSpans(printGrid) {
  const table = printGrid.querySelector('.sw-grid-table');
  if (!table) return;

  const bodyRows = Array.from(table.tBodies).flatMap((body) => Array.from(body.rows));

  bodyRows.forEach((row, rowIndex) => {
    const spanningCells = Array.from(row.cells).filter((cell) => (
      cell.rowSpan > 1
      && (cell.classList.contains('gc-date-cell') || cell.classList.contains('gc-total'))
    ));

    spanningCells.forEach((cell) => {
      const rowSpan = cell.rowSpan;
      cell.removeAttribute('rowspan');

      for (let offset = 1; offset < rowSpan; offset += 1) {
        const targetRow = bodyRows[rowIndex + offset];
        if (!targetRow) break;

        const placeholder = cell.cloneNode(false);
        placeholder.removeAttribute('rowspan');
        placeholder.removeAttribute('colspan');
        placeholder.removeAttribute('style');
        placeholder.removeAttribute('title');
        placeholder.textContent = '';

        if (cell.classList.contains('gc-date-cell')) {
          const rowIndexCell = targetRow.querySelector('.gc-row-index');
          if (rowIndexCell) {
            rowIndexCell.after(placeholder);
          } else {
            targetRow.prepend(placeholder);
          }
        } else {
          targetRow.append(placeholder);
        }
      }
    });
  });
}

function appendStatsGridPrintHeaderDividers(printGrid) {
  const table = printGrid.querySelector('.sw-grid-table');
  const header = table?.tHead;
  if (
    !table
    || !header
    || header.querySelector('.sw-grid-print-title-divider')
    || header.querySelector('.sw-grid-print-header-divider')
  ) return;

  const columnCount = table.querySelectorAll('colgroup > col').length;
  if (!columnCount) return;

  const createDividerRow = (className) => {
    const dividerRow = printGrid.ownerDocument.createElement('tr');
    dividerRow.className = className;

    const dividerCell = printGrid.ownerDocument.createElement('th');
    dividerCell.colSpan = columnCount;
    dividerCell.setAttribute('aria-hidden', 'true');

    dividerRow.append(dividerCell);
    return dividerRow;
  };

  const titleRow = header.rows[0];
  if (titleRow) {
    header.insertBefore(
      createDividerRow('sw-grid-print-title-divider'),
      titleRow.nextElementSibling
    );
  }

  header.append(createDividerRow('sw-grid-print-header-divider'));
}

function prepareStatsGridPrintFrame(orientation, margin) {
  removeStatsGridPrintFrame();

  const sourceGrid = Array.from(document.querySelectorAll('.sw-stats-body--grid')).find(
    (element) => !element.closest('[hidden]')
  );
  if (!sourceGrid) return false;

  // Row-spanned date summaries make Chromium keep an entire date group together.
  // The print copy uses blank per-row cells instead, so page breaks consume the remaining space.
  const printGrid = sourceGrid.cloneNode(true);
  expandStatsGridPrintRowSpans(printGrid);
  appendStatsGridPrintHeaderDividers(printGrid);

  const frame = document.createElement('iframe');
  frame.id = STATS_GRID_PRINT_FRAME_ID;
  frame.title = '현황 표 인쇄';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;border:0;pointer-events:none;';
  document.body.appendChild(frame);

  const printDocument = frame.contentDocument;
  const printWindow = frame.contentWindow;
  if (!printDocument || !printWindow) {
    frame.remove();
    return false;
  }

  const styleMarkup = Array.from(document.head.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((node) => node.outerHTML)
    .join('');
  const baseUrl = String(document.baseURI).replace(/"/g, '&quot;');
  const pageSize = orientation === 'landscape' ? 'A4 landscape' : 'A4 portrait';

  printDocument.open();
  printDocument.write(`<!doctype html>
<html data-print-orientation="${orientation}">
  <head>
    <base href="${baseUrl}">
    ${styleMarkup}
    <style>
      @page { size: ${pageSize}; margin: ${margin}; }
      html, body { width: 100%; min-height: auto; margin: 0; padding: 0; background: #fff; }
      .stats-grid-print-document { width: 100%; min-height: 0 !important; margin: 0; padding: 0; }
      .stats-grid-print-document .sw-stats-body--grid,
      .stats-grid-print-document .sw-grid-card,
      .stats-grid-print-document .sw-grid-card-table,
      .stats-grid-print-document .sw-grid-shell,
      .stats-grid-print-document .sw-grid-wrapper { display: block !important; width: 100% !important; height: auto !important; min-height: 0 !important; max-height: none !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; }
      .stats-grid-print-document .sw-grid-table { display: table !important; width: 100% !important; min-width: 0 !important; height: auto !important; min-height: 0 !important; max-height: none !important; table-layout: fixed !important; border: 0 !important; border-collapse: separate !important; border-spacing: 0 !important; font-size: 8pt !important; }
      .stats-grid-print-document .sw-stats-body--grid .sw-grid-table { border: 0 !important; }
      .sw-grid-table thead {
        display: table-header-group !important;
        position: static !important;
        break-after: avoid !important;
        page-break-after: avoid !important;
      }
      .sw-grid-table thead > tr {
        display: table-row !important;
        break-inside: avoid !important;
        page-break-inside: avoid !important;
      }
      .sw-grid-table tbody { display: table-row-group !important; }
      .sw-grid-table tr { break-inside: avoid !important; page-break-inside: avoid !important; }
      .sw-grid-table,
      .sw-grid-table thead,
      .sw-grid-table tbody,
      .sw-grid-table tr,
      .sw-grid-table th,
      .sw-grid-table td { position: static !important; inset: auto !important; z-index: auto !important; transform: none !important; will-change: auto !important; visibility: visible !important; opacity: 1 !important; }
      .sw-grid-table th,
      .sw-grid-table td,
      .sw-grid-table th *,
      .sw-grid-table td * { color: #172033 !important; visibility: visible !important; opacity: 1 !important; }
      .sw-grid-table th,
      .sw-grid-table td { height: 6mm !important; padding: 0 0.7mm !important; border: 0 !important; border-right: 1px solid #d5deea !important; border-bottom: 1px solid #d5deea !important; font-size: 8pt !important; line-height: 1.15 !important; text-align: center !important; }
      .stats-grid-print-document .sw-grid-table th,
      .stats-grid-print-document .sw-grid-table td { border-right: 1px solid #d5deea !important; border-bottom: 1px solid #d5deea !important; }
      .stats-grid-print-document .sw-grid-wrapper--shockwave .grid-title::before,
      .stats-grid-print-document .sw-grid-wrapper--shockwave .grid-title::after { display: none !important; }
      .sw-grid-table .grid-title { height: 10mm !important; max-height: 10mm !important; padding: 1mm !important; border-top: 3px solid #94a3b8 !important; border-bottom: 0 !important; border-right: 1px solid #94a3b8 !important; border-radius: 0 !important; font-size: 12pt !important; }
      .stats-grid-print-document .sw-grid-table tr > :last-child { border-right: 1px solid #d5deea !important; }
      .stats-grid-print-document .sw-grid-table .therapist-group-start { border-left: 0 !important; box-shadow: none !important; }
      .stats-grid-print-document .sw-grid-table .therapist-group-end { border-right: 2px solid #9fb0c4 !important; }
      .stats-grid-print-document .sw-grid-table .fixed-field-last,
      .stats-grid-print-document .sw-grid-table .hdr-fixed-last { border-right: 2px solid #b9c6d6 !important; }
      .stats-grid-print-document .sw-grid-table .gc-total,
      .stats-grid-print-document .sw-grid-table .hdr-total,
      .stats-grid-print-document .sw-grid-table .hdr-grand-total { border-right: 1px solid #d5deea !important; }
      .stats-grid-print-document .sw-grid-table td.gc-date-cell { vertical-align: middle !important; }
      .stats-grid-print-document .sw-grid-table .sw-header-row-title > :first-child,
      .stats-grid-print-document .sw-grid-table .sw-header-row-therapists > :first-child,
      .stats-grid-print-document .sw-grid-table tbody tr > :first-child { border-left: 3px solid #94a3b8 !important; }
      .stats-grid-print-document .sw-grid-table .sw-header-row-title > :last-child,
      .stats-grid-print-document .sw-grid-table .sw-header-row-therapists > .hdr-new-patient,
      .stats-grid-print-document .sw-grid-table .sw-header-row-prescription-totals > :last-child,
      .stats-grid-print-document .sw-grid-table tbody tr > :last-child { border-right: 3px solid #94a3b8 !important; }
      .stats-grid-print-document .sw-grid-table thead .sw-header-row-prescription-totals > th,
      .stats-grid-print-document .sw-grid-table thead .sw-header-row-therapists > th[rowspan="3"] { border-bottom: 0 !important; }
      .stats-grid-print-document .sw-grid-table thead .sw-grid-print-title-divider > th { height: 0 !important; min-height: 0 !important; max-height: 0 !important; padding: 0 !important; border-top: 0 !important; border-right: 3px solid #94a3b8 !important; border-bottom: 3px solid #64748b !important; border-left: 3px solid #94a3b8 !important; font-size: 0 !important; line-height: 0 !important; }
      .stats-grid-print-document .sw-grid-table thead .sw-grid-print-header-divider > th { height: 2px !important; min-height: 2px !important; max-height: 2px !important; padding: 0 !important; border-top: 0 !important; border-right: 3px solid #94a3b8 !important; border-bottom: 2px solid #64748b !important; border-left: 3px solid #94a3b8 !important; font-size: 0 !important; line-height: 0 !important; }
      .stats-grid-print-document .sw-grid-table tbody tr.tr-date-end > td { border-bottom: 0 !important; }
      .stats-grid-print-document .sw-grid-table tbody tr.tr-date-start > td,
      .stats-grid-print-document .sw-grid-table tbody tr.tr-date-start > td.fixed-field-last,
      .stats-grid-print-document .sw-grid-table tbody tr.tr-date-start > td.gc-therapist-value.therapist-group-start,
      .stats-grid-print-document .sw-grid-table tbody tr.tr-date-start > td.gc-therapist-value.therapist-group-end { border-top: 2px solid #9fb0c4 !important; box-shadow: none !important; }
      .stats-grid-print-document .sw-grid-table tbody tr:last-child > td { border-bottom: 3px solid #94a3b8 !important; }
      .stats-grid-print-document .sw-grid-table .hdr-therapist--single-prescription .sw-grid-therapist-count { display: block !important; margin-top: 0.25mm !important; white-space: nowrap !important; }
      .sw-grid-table .fixed-field-last { text-align: left !important; }
      .sw-grid-table thead .hdr-fixed,
      .sw-grid-table thead .hdr-therapist,
      .sw-grid-table thead .hdr-pres,
      .sw-grid-table thead .hdr-pres-total,
      .sw-grid-table thead .hdr-total,
      .sw-grid-table thead .hdr-grand-total,
      .sw-grid-table thead .hdr-new-patient,
      .sw-grid-table thead .hdr-new-patient-total { font-size: 8pt !important; }
      .sw-grid-table col { width: auto !important; min-width: 0 !important; }
      .sw-grid-table col:nth-child(1) { width: 3% !important; }
      .sw-grid-table col:nth-child(2) { width: 5% !important; }
      .sw-grid-table col:nth-child(3) { width: 7% !important; }
      .sw-grid-table col:nth-child(4) { width: 6% !important; }
      .sw-grid-table col:nth-child(5) { width: 3.5% !important; }
      .sw-grid-table col:nth-child(6) { width: 12% !important; }
      .sw-grid-table col:nth-last-child(-n + 2) { width: 5.5% !important; }
      html[data-print-orientation="portrait"] .sw-grid-table { font-size: 6.8pt !important; }
      html[data-print-orientation="portrait"] .sw-grid-table th,
      html[data-print-orientation="portrait"] .sw-grid-table td {
        height: auto !important;
        min-height: 4.9mm !important;
        padding: 0.45mm 0.35mm !important;
        font-size: 6.8pt !important;
        line-height: 1.1 !important;
        vertical-align: middle !important;
        white-space: normal !important;
        overflow-wrap: anywhere !important;
        word-break: break-word !important;
      }
      html[data-print-orientation="portrait"] .sw-grid-table th *,
      html[data-print-orientation="portrait"] .sw-grid-table td * {
        max-width: 100% !important;
        min-width: 0 !important;
        white-space: inherit !important;
        overflow-wrap: anywhere !important;
        word-break: break-word !important;
      }
      html[data-print-orientation="portrait"] .sw-grid-table td.gc-row-index {
        white-space: nowrap !important;
        overflow-wrap: normal !important;
        word-break: normal !important;
      }
      html[data-print-orientation="portrait"] .sw-grid-table .grid-title {
        height: 8.5mm !important;
        max-height: none !important;
        padding: 0.8mm !important;
        font-size: 10pt !important;
        line-height: 1.1 !important;
        white-space: nowrap !important;
      }
      html[data-print-orientation="portrait"] .sw-grid-table thead .hdr-fixed,
      html[data-print-orientation="portrait"] .sw-grid-table thead .hdr-therapist,
      html[data-print-orientation="portrait"] .sw-grid-table thead .hdr-pres,
      html[data-print-orientation="portrait"] .sw-grid-table thead .hdr-pres-total,
      html[data-print-orientation="portrait"] .sw-grid-table thead .hdr-total,
      html[data-print-orientation="portrait"] .sw-grid-table thead .hdr-grand-total,
      html[data-print-orientation="portrait"] .sw-grid-table thead .hdr-new-patient,
      html[data-print-orientation="portrait"] .sw-grid-table thead .hdr-new-patient-total {
        min-height: 5.1mm !important;
        padding: 0.45mm 0.25mm !important;
        font-size: 6.7pt !important;
        line-height: 1.05 !important;
        white-space: normal !important;
      }
      html[data-print-orientation="portrait"] .sw-grid-table .gc-bold { padding: 0.45mm 0.35mm !important; text-align: center !important; }
      html[data-print-orientation="portrait"] .sw-grid-table .sw-grid-count-hover,
      html[data-print-orientation="portrait"] .sw-grid-table .sw-grid-total-cell,
      html[data-print-orientation="portrait"] .sw-grid-table .sw-grid-new-patient-cell {
        width: 100% !important;
        min-width: 0 !important;
        min-height: 0 !important;
        line-height: inherit !important;
        white-space: inherit !important;
      }
      html[data-print-orientation="portrait"] .sw-grid-table .sw-grid-summary-main-number,
      html[data-print-orientation="portrait"] .sw-grid-table .sw-grid-new-patient-total,
      html[data-print-orientation="portrait"] .sw-grid-table .sw-grid-count-value {
        font-size: 6.8pt !important;
        line-height: inherit !important;
        white-space: inherit !important;
      }
      html[data-print-orientation="portrait"] .sw-grid-table col:nth-child(1) { width: 3.5% !important; }
      html[data-print-orientation="portrait"] .sw-grid-table col:nth-child(2) { width: 5.1% !important; }
      html[data-print-orientation="portrait"] .sw-grid-table col:nth-child(3) { width: 7.4% !important; }
      html[data-print-orientation="portrait"] .sw-grid-table col:nth-child(4) { width: 6.1% !important; }
      html[data-print-orientation="portrait"] .sw-grid-table col:nth-child(5) { width: 3.4% !important; }
      html[data-print-orientation="portrait"] .sw-grid-table col:nth-child(6) { width: 9.5% !important; }
      html[data-print-orientation="portrait"] .sw-grid-table col:nth-last-child(-n + 2) { width: 5% !important; }
      .sw-grid-count-tooltip,
      .shockwave-context-menu,
      .gc-input[data-hidden-input="true"] { display: none !important; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    </style>
  </head>
  <body>
    <main class="stats-grid-print-document">${printGrid.outerHTML}</main>
  </body>
</html>`);
  printDocument.close();

  return () => {
    void printDocument.body.offsetHeight;
    printWindow.focus();
    printWindow.print();
  };
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
  document.body.classList.remove('manual-settlement-print');
  document.body.classList.remove('shockwave-settlement-print');
  document.body.classList.remove('vertical-settlement-print');
  document.body.classList.remove('stats-grid-print');
  delete document.body.dataset.calendarWeeks;
  restoreHiddenMemoRows();
}

function registerPrintCleanup() {
  let cleaned = false;

  const cleanupOnce = () => {
    if (cleaned) return;
    cleaned = true;
    cleanupPrintState();
    window.removeEventListener('afterprint', cleanupOnce);
  };

  window.addEventListener('afterprint', cleanupOnce, { once: true });

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
  const rawTotalWeeks = Math.round(allCells.length / 7);

  // 이번 달 일자(other-month가 아닌 셀)가 포함된 실제 주차 수 판별
  let actualWeeks = 0;
  for (let w = 0; w < rawTotalWeeks; w++) {
    const weekCells = allCells.slice(w * 7, (w + 1) * 7);
    const hasCurrentMonthCell = weekCells.some(cell => !cell.classList.contains('other-month'));
    if (hasCurrentMonthCell) {
      actualWeeks = w + 1;
    }
  }

  const totalWeeks = actualWeeks >= 4 ? actualWeeks : rawTotalWeeks;

  if (totalWeeks <= 5) return { totalWeeks, lastWeekHasWeekday: true };

  // 마지막 주(6주차)의 셀 확인: 이번 달 평일(월~토)이 있는지
  const lastWeekCells = allCells.slice((rawTotalWeeks - 1) * 7);
  const lastWeekHasWeekday = lastWeekCells.some((cell, colIdx) => {
    if (colIdx === 0) return false;
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
    // 근무표 탭(isStaffSchedule)에서 인쇄 시 가로/세로 모든 인쇄 모드에서 우측 3개 창(.staff-side) 숨김 처리
    const effectiveCalendarOnly = calendarOnly || isStaffSchedule;
    const isNewPatientPortraitPrint = !effectiveCalendarOnly
      && orientation === 'portrait'
      && hasVisiblePrintTarget('.sw-new-patient-table');
    const isVerticalSettlementPrint = !effectiveCalendarOnly && hasVisiblePrintTarget(
      '.sw-settlement-stack--shockwave.sw-settlement-stack--vertical',
    );
    const isSettlementPrint = !effectiveCalendarOnly
      && !isVerticalSettlementPrint
      && hasVisiblePrintTarget('.sw-settlement-table, .sw-manual-settlement-stack');
    const isStatsGridPrint = !effectiveCalendarOnly
      && hasVisiblePrintTarget('.sw-stats-body--grid');
    // 기본 여백 인쇄 시에도 좌측이 미세하게 잘리지 않도록 좌우 여백을 8mm로 안전하게 확보
    const printMargin = isNewPatientPortraitPrint
      ? '8mm 5mm 6mm'
      : (isSettlementPrint ? (orientation === 'portrait' ? '4mm' : '5mm') : (effectiveCalendarOnly ? '5mm 8mm 5mm 8mm' : '6mm'));
    setPrintOrientation(isNewPatientPortraitPrint ? 'A4 portrait' : orientation, printMargin);
    const statsGridPrinter = isStatsGridPrint
      ? prepareStatsGridPrintFrame(orientation, printMargin)
      : null;
    
    if (effectiveCalendarOnly) {
      document.body.classList.remove('new-patient-print');
      document.body.classList.remove('settlement-print');
      document.body.classList.remove('manual-settlement-print');
      document.body.classList.remove('shockwave-settlement-print');
      document.body.classList.remove('vertical-settlement-print');
      document.body.classList.remove('stats-grid-print');
      removeStatsGridPrintFrame();
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
      document.documentElement.dataset.calendarWeeks = String(weekCount);

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
      delete document.documentElement.dataset.calendarWeeks;
      
      if (isNewPatientPortraitPrint) {
        document.body.classList.add('new-patient-print');
        document.body.classList.remove('settlement-print');
        document.body.classList.remove('manual-settlement-print');
        document.body.classList.remove('shockwave-settlement-print');
        document.body.classList.remove('vertical-settlement-print');
        document.body.classList.remove('stats-grid-print');
        removeStatsGridPrintFrame();
      } else if (isVerticalSettlementPrint) {
        document.body.classList.remove('new-patient-print');
        document.body.classList.remove('settlement-print');
        document.body.classList.remove('manual-settlement-print');
        document.body.classList.remove('shockwave-settlement-print');
        document.body.classList.add('vertical-settlement-print');
        document.body.classList.remove('stats-grid-print');
        removeStatsGridPrintFrame();
      } else if (isSettlementPrint) {
        const isManualSettlementPrint = hasVisiblePrintTarget('.sw-manual-settlement-stack');
        const isShockwaveSettlementPrint = hasVisiblePrintTarget('.sw-settlement-stack--shockwave');
        document.body.classList.remove('new-patient-print');
        document.body.classList.remove('vertical-settlement-print');
        document.body.classList.add('settlement-print');
        document.body.classList.toggle('manual-settlement-print', isManualSettlementPrint);
        document.body.classList.toggle('shockwave-settlement-print', isShockwaveSettlementPrint);
        document.body.classList.remove('stats-grid-print');
        removeStatsGridPrintFrame();
      } else {
        document.body.classList.remove('new-patient-print');
        document.body.classList.remove('settlement-print');
        document.body.classList.remove('manual-settlement-print');
        document.body.classList.remove('shockwave-settlement-print');
        document.body.classList.remove('vertical-settlement-print');
        document.body.classList.toggle('stats-grid-print', isStatsGridPrint && !statsGridPrinter);
      }
    }
    
    setIsOpen(false);
    registerPrintCleanup();
    // Keep the browser print request within the user activation that selected the menu item.
    void document.body.offsetHeight;
    if (statsGridPrinter) {
      statsGridPrinter();
      return;
    }
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

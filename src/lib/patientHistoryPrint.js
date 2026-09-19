export const PATIENT_HISTORY_PRINT_CSS = `
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #1e293b; font-family: Arial, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; }
  h1 { margin: 0 0 4mm; font-size: 17pt; }
  .print-context { margin: 0 0 5mm; font-size: 9pt; color: #475569; white-space: pre-wrap; overflow-wrap: anywhere; }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 0 0 6mm; font-size: 8pt; }
  caption { text-align: left; font-weight: bold; font-size: 11pt; padding: 3mm 0; }
  thead { display: table-header-group; }
  th, td { border: 0.2mm solid #b8c4d2; padding: 1.5mm; vertical-align: middle; text-align: center; white-space: normal; overflow-wrap: anywhere; }
  th { background: #e2e8f0; font-weight: bold; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .print-detail { text-align: left; }
  * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
`;

const HIDDEN_PRINT_COLUMNS = new Set(['처방', '담당', '챠트번호', '차트번호', '메모', '적용']);
const PRINT_COLUMN_WEIGHTS = { 번호: 4, '치료 구분': 9, 날짜: 12, 부위: 40, 회차: 6, 실비소진: 16, '갱신 일자': 13 };

export function getPatientHistoryPrintColumns(labels) {
  const columns = labels.map((label, index) => ({ label: label.trim(), index }))
    .filter(({ label }) => !HIDDEN_PRINT_COLUMNS.has(label));
  const total = columns.reduce((sum, { label }) => sum + (PRINT_COLUMN_WEIGHTS[label] || 8), 0);
  return columns.map((column) => ({
    ...column,
    width: (PRINT_COLUMN_WEIGHTS[column.label] || 8) / total * 100,
  }));
}

export function formatPatientHistoryPrintText(text, label) {
  return label === '부위'
    ? text.split(/\r?\n/).map((part) => part.trim()).filter(Boolean).join(', ')
    : text.replace(/\s+/g, ' ').trim();
}

// Use live form values, including text hidden by textarea scrolling or ellipsis.
export function getPatientHistoryPrintCellText(cell) {
  const copy = cell.cloneNode(true);
  const originalFields = cell.querySelectorAll('input, textarea, select');
  copy.querySelectorAll('input, textarea, select').forEach((field, index) => {
    const original = originalFields[index];
    const value = original.tagName === 'SELECT'
      ? original.selectedOptions[0]?.textContent || original.value
      : original.value;
    field.replaceWith(copy.ownerDocument.createTextNode(value || '—'));
  });
  copy.querySelectorAll('.patient-history-fill-handle, [role="tooltip"]').forEach((node) => node.remove());
  return copy.textContent.trim();
}

export function buildPatientHistoryPrintDocument(source, doc) {
  doc.title = '스케줄 내역 검색';
  const style = doc.createElement('style');
  style.textContent = PATIENT_HISTORY_PRINT_CSS;
  doc.head.appendChild(style);
  const title = doc.createElement('h1');
  title.textContent = '스케줄 내역 검색';
  doc.body.appendChild(title);
  const context = doc.createElement('p');
  context.className = 'print-context';
  const target = source.querySelector('.patient-history-search-target');
  const tab = source.querySelector('.patient-history-treatment-tab.is-active > span');
  const sort = source.querySelector('.patient-history-sort-control select');
  context.textContent = [
    target ? getPatientHistoryPrintCellText(target) : '',
    tab ? `치료 구분: ${tab.textContent}` : '',
    sort ? `정렬: ${sort.selectedOptions[0]?.textContent || ''}` : '',
  ].filter(Boolean).join('  ·  ');
  doc.body.appendChild(context);

  source.querySelectorAll('.patient-history-table').forEach((original) => {
    const table = doc.createElement('table');
    const group = original.parentElement.parentElement;
    const caption = doc.createElement('caption');
    const filters = [...group.querySelectorAll('.patient-history-filter-section')].map((section) => {
      const selected = [...section.querySelectorAll('.is-checked > span:first-of-type')].map((node) => node.textContent);
      return `${section.getAttribute('aria-label')}: ${selected.join(', ')}`;
    });
    caption.textContent = [group.querySelector('.patient-history-group-title-row')?.textContent, ...filters].filter(Boolean).join(' · ');
    table.appendChild(caption);
    const headers = [...original.querySelectorAll('thead th')];
    const columns = getPatientHistoryPrintColumns(headers.map((header) => header.textContent));
    const colgroup = doc.createElement('colgroup');
    columns.forEach(({ width }) => {
      const col = doc.createElement('col');
      col.style.width = `${width}%`;
      colgroup.appendChild(col);
    });
    table.appendChild(colgroup);
    const head = table.createTHead().insertRow();
    columns.forEach(({ label }) => {
      const th = doc.createElement('th');
      th.scope = 'col';
      th.textContent = label;
      head.appendChild(th);
    });
    const body = table.createTBody();
    // Every rendered result is copied, independent of viewport and scroll position.
    original.querySelectorAll('tbody tr').forEach((row) => {
      const printedRow = body.insertRow();
      if (row.cells.length === 1 && row.cells[0].colSpan > 1) {
        const cell = printedRow.insertCell();
        cell.colSpan = columns.length;
        cell.textContent = getPatientHistoryPrintCellText(row.cells[0]);
        return;
      }
      columns.forEach(({ label, index }) => {
        const cell = printedRow.insertCell();
        cell.textContent = row.cells[index]
          ? formatPatientHistoryPrintText(getPatientHistoryPrintCellText(row.cells[index]), label) : '';
        if (label === '부위') cell.className = 'print-detail';
      });
    });
    doc.body.appendChild(table);
  });
}

export function printPatientHistory(source) {
  if (!source) return;
  document.getElementById('patient-history-print-frame')?.remove();
  const frame = document.createElement('iframe');
  frame.id = 'patient-history-print-frame';
  frame.title = '스케줄 내역 인쇄';
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;bottom:0;left:0;';
  document.body.appendChild(frame);
  buildPatientHistoryPrintDocument(source, frame.contentDocument);
  frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
  void frame.contentDocument.body.offsetHeight;
  frame.contentWindow.focus();
  frame.contentWindow.print();
}

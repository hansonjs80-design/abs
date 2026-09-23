// Isolated document keeps application navigation and other tables out of print.
export function printSettlementTable(element, title, { includeTherapistSummary = false, includeRecentTables = false, orientation = 'portrait' } = {}) {
  const tables = includeRecentTables
    ? [...element.querySelectorAll('section table')]
    : includeTherapistSummary
    ? [...(element?.querySelectorAll('.combined-therapist-summary-card > table, .combined-treatment-breakdown-card > table, .combined-ion-treatment table') || [])]
      .sort((a, b) => {
        const rank = (table) => table.closest('.combined-ion-treatment') ? 2
          : table.closest('.combined-treatment-breakdown-card') ? 1 : 0;
        return rank(a) - rank(b);
      })
    : [element?.querySelector('table')].filter(Boolean);
  if (!tables.length) return;
  document.getElementById('combined-settlement-print-frame')?.remove();
  const frame = document.createElement('iframe');
  frame.id = 'combined-settlement-print-frame';
  frame.title = title;
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;bottom:0;left:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.title = title;
  if (includeTherapistSummary) doc.body.className = `combined-summary-print--${orientation}`;
  const style = doc.createElement('style');
  style.textContent = `
    @page { size: A4 ${orientation === 'landscape' ? 'landscape' : 'portrait'}; margin: 12mm; }
    body { margin: 0; font-family: sans-serif; color: #172033; }
    h1 { font-size: 18px; margin: 0 0 16px; }
    table { width: auto; max-width: 100%; table-layout: auto; border-collapse: collapse; font-size: 12px; margin: 0 0 8mm; }
    col { width: auto; }
    th, td { border: 1px solid #94a3b8; padding: 6px 8px; text-align: right; overflow-wrap: anywhere; }
    th:first-child { text-align: left; }
    thead { display: table-header-group; background: #e2e8f0; }
    tr { break-inside: avoid; }
    .combined-therapist-name { background: #475569; color: white; }
    .combined-therapist-name-content { display: flex; justify-content: space-between; gap: 12px; }
    .combined-summary-tone-0 { background: #ffedd5; }
    .combined-summary-tone-1 { background: #ede9fe; }
    .combined-summary-tone-2 { background: #dcfce7; }
    .combined-breakdown-row { font-weight: bold; }
    .combined-summary-column-header-row { color: #475569; font-size: 11px; }
    .combined-breakdown-detail-row { background: #fbfcfe; color: #475569; font-size: 11px; }
    .combined-therapist-subtotal { font-weight: bold; }
    .combined-therapist-total { font-size: 13px; }
    .combined-therapist-subtotal--start > * { border-top: 2px solid #64748b; }
    .combined-therapist-total { font-weight: bold; background: #e2e8f0; }
    .combined-incentive-rate-row--7 { background: #eaf2fd; }
    .combined-incentive-rate-row--15 { background: #f6ecfb; }
    .combined-treatment-child-row th { padding-left: 22px; font-weight: normal; }
    caption { text-align: left; font-size: 13px; font-weight: bold; padding: 0 0 8px; }
    .combined-recent-print-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5mm; align-items: start; }
    .combined-recent-print-grid[data-view="detail"] { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 2mm; }
    .combined-recent-print-grid table { width: 100%; table-layout: auto; font-size: 9px; }
    .combined-recent-print-grid col { width: auto !important; }
    .combined-recent-print-grid th, .combined-recent-print-grid td { padding: 3px; }
    .combined-recent-print-grid[data-view="detail"] table { font-size: 8px; }
    .combined-summary-print--landscape { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 6mm; align-items: start; }
    .combined-summary-print--landscape h1 { grid-column: 1 / -1; }
    .combined-summary-print--landscape table { width: 100%; min-width: 0; font-size: 10px; }
    .combined-summary-print--landscape th, .combined-summary-print--landscape td { padding: 5px; }
    .combined-recent-breakdown-item { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px; padding: 3px; margin: 2px 0 2px 3px; background: #f8fafc; }
    .combined-recent-breakdown-item--total { border-left: 2px solid #0f172a; margin-left: 0; background: #e2e8f0; font-weight: bold; }
    .combined-summary-grand-total > *, .combined-treatment-breakdown-card .combined-therapist-total > *, .combined-therapist-total > * { color: #9f1239; }
    ::-webkit-scrollbar { display: none; width: 0; height: 0; }
    * { scrollbar-width: none; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  `;
  doc.head.appendChild(style);
  const heading = doc.createElement('h1');
  heading.textContent = title;
  doc.body.appendChild(heading);
  const container = includeRecentTables ? doc.createElement('div') : doc.body;
  if (includeRecentTables) {
    container.className = 'combined-recent-print-grid';
    container.dataset.view = element.dataset.recentView;
    doc.body.appendChild(container);
  }
  tables.forEach((table) => {
    const copy = table.cloneNode(true);
    copy.querySelectorAll('.combined-breakdown-actions').forEach((node) => node.remove());
    if (table.closest('.combined-ion-treatment')) {
      if (includeRecentTables) copy.style.gridColumn = '1';
      const caption = doc.createElement('caption');
      caption.textContent = '최근 6개월 이온치료 현황';
      copy.prepend(caption);
      copy.querySelectorAll('input').forEach((input) => input.remove());
    }
    if (table.closest('.combined-stats-recent')) {
      const caption = doc.createElement('caption');
      caption.textContent = table.closest('section').querySelector('h2')?.textContent || title;
      copy.prepend(caption);
    }
    container.appendChild(copy);
  });
  frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
  // Force layout before opening the print dialog within the click activation.
  void doc.body.offsetHeight;
  frame.contentWindow.focus();
  frame.contentWindow.print();
}

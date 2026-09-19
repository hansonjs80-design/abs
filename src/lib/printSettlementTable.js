// Isolated document keeps application navigation and other tables out of print.
export function printSettlementTable(element, title) {
  const table = element?.querySelector('table');
  if (!table) return;
  document.getElementById('combined-settlement-print-frame')?.remove();
  const frame = document.createElement('iframe');
  frame.id = 'combined-settlement-print-frame';
  frame.title = title;
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;bottom:0;left:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.title = title;
  const style = doc.createElement('style');
  style.textContent = `
    @page { size: A4 portrait; margin: 12mm; }
    body { margin: 0; font-family: sans-serif; color: #172033; }
    h1 { font-size: 18px; margin: 0 0 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #94a3b8; padding: 9px; text-align: right; }
    th:first-child { text-align: left; }
    thead { display: table-header-group; background: #e2e8f0; }
    tr { break-inside: avoid; }
    .combined-therapist-total { font-weight: bold; background: #e2e8f0; }
    .combined-incentive-rate-row--7 { background: #eaf2fd; }
    .combined-incentive-rate-row--15 { background: #f6ecfb; }
    .combined-treatment-child-row th { padding-left: 22px; font-weight: normal; }
    * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  `;
  doc.head.appendChild(style);
  const heading = doc.createElement('h1');
  heading.textContent = title;
  doc.body.appendChild(heading);
  const copy = table.cloneNode(true);
  copy.querySelectorAll('.combined-breakdown-actions').forEach((node) => node.remove());
  doc.body.appendChild(copy);
  frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
  // Force layout before opening the print dialog within the click activation.
  void doc.body.offsetHeight;
  frame.contentWindow.focus();
  frame.contentWindow.print();
}

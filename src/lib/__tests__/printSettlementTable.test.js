import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printSettlementTable } from '../printSettlementTable.js';

test('prints an isolated clone with the selected rows and removes controls, then cleans up', (t) => {
  let removedControls = false;
  let removedFrame = false;
  let printed = false;
  let afterprint;
  const copy = { querySelectorAll: () => [{ remove: () => { removedControls = true; } }] };
  const table = { closest: () => null, cloneNode: (deep) => { assert.equal(deep, true); return copy; } };
  const nodes = [];
  const doc = {
    createElement: () => ({}),
    head: { appendChild() {} },
    body: { appendChild: (node) => nodes.push(node), offsetHeight: 100 },
  };
  const frame = {
    style: {}, contentDocument: doc, remove: () => { removedFrame = true; },
    contentWindow: {
      addEventListener: (event, callback) => { assert.equal(event, 'afterprint'); afterprint = callback; },
      focus() {}, print: () => { printed = true; },
    },
  };
  const originalDocument = globalThis.document;
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  globalThis.document = { getElementById: () => null, createElement: () => frame, body: { appendChild() {} } };
  printSettlementTable({ querySelector: () => table }, '2026년 9월 항목별 결산 내역');
  assert.equal(doc.title, '2026년 9월 항목별 결산 내역');
  assert.equal(nodes[0].textContent, doc.title);
  assert.equal(nodes[1], copy);
  assert.equal(removedControls, true);
  assert.equal(printed, true);
  afterprint();
  assert.equal(removedFrame, true);
});

test('global summary printing includes both tables in order and honors orientation', (t) => {
  const copies = [{ querySelectorAll: () => [] }, { querySelectorAll: () => [] }];
  const tables = [
    { closest: (selector) => selector === '.combined-treatment-breakdown-card' ? {} : null, cloneNode: () => copies[1] },
    { closest: () => null, cloneNode: () => copies[0] },
  ];
  const nodes = [];
  const styles = [];
  let printed = false;
  const doc = {
    createElement: () => ({}), head: { appendChild: (node) => styles.push(node) },
    body: { appendChild: (node) => nodes.push(node), offsetHeight: 100 },
  };
  const frame = { style: {}, contentDocument: doc, contentWindow: {
    addEventListener() {}, focus() {}, print: () => { printed = true; },
  } };
  const originalDocument = globalThis.document;
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  globalThis.document = { getElementById: () => null, createElement: () => frame, body: { appendChild() {} } };
  const source = { querySelectorAll: (selector) => {
    assert.equal(selector, '.combined-therapist-summary-card > table, .combined-treatment-breakdown-card > table, .combined-ion-treatment table');
    return tables;
  } };
  printSettlementTable(source, '2026년 9월 전체 통계 합계', { includeTherapistSummary: true, orientation: 'landscape' });
  assert.deepEqual(nodes.slice(1), copies);
  assert.equal(printed, true);
  assert.match(styles[0].textContent, /size: A4 landscape/);
  assert.equal(doc.body.className, 'combined-summary-print--landscape');
  assert.match(styles[0].textContent, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles[0].textContent, /\.combined-summary-parent-row > \*, \.combined-breakdown-row > \* \{ font-size: 13px; font-weight: 800; \}/);
  assert.match(styles[0].textContent, /\.combined-breakdown-detail-row > \* \{ font-size: 11px; font-weight: 500; \}/);
  assert.match(styles[0].textContent, /\.combined-summary-print--landscape :is\(\.combined-summary-parent-row, \.combined-breakdown-row\) > \* \{ font-size: 12px; \}/);
  assert.equal(doc.title, '2026년 9월 전체 통계 합계');
});

test('landscape summary prints the ion table to the right of the two settlement tables', (t) => {
  const copies = Array.from({ length: 3 }, () => ({ querySelectorAll: () => [], prepend() {} }));
  const tables = [
    { closest: (selector) => selector === '.combined-ion-treatment' ? {} : null, cloneNode: () => copies[2] },
    { closest: () => null, cloneNode: () => copies[0] },
    { closest: (selector) => selector === '.combined-treatment-breakdown-card' ? {} : null, cloneNode: () => copies[1] },
  ];
  const nodes = [];
  const styles = [];
  const doc = {
    createElement: () => ({}),
    head: { appendChild: (node) => styles.push(node) },
    body: { appendChild: (node) => nodes.push(node), offsetHeight: 100 },
  };
  const frame = { style: {}, contentDocument: doc, contentWindow: { addEventListener() {}, focus() {}, print() {} } };
  const originalDocument = globalThis.document;
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  globalThis.document = { getElementById: () => null, createElement: () => frame, body: { appendChild() {} } };

  printSettlementTable({ querySelectorAll: () => tables }, '전체 통계 합계', { includeTherapistSummary: true, orientation: 'landscape' });

  assert.deepEqual(nodes.slice(1), copies);
  assert.equal(doc.body.className, 'combined-summary-print--landscape combined-summary-print--with-ion');
  assert.match(styles[0].textContent, /\.combined-summary-print--landscape\.combined-summary-print--with-ion \{ grid-template-columns: minmax\(0, 1\.2fr\) repeat\(2, minmax\(0, 1fr\)\)/);
});

test('includes the checked ion table with its title and printable values', (t) => {
  let removedInput = false;
  let caption;
  const copy = {
    querySelectorAll: (selector) => selector === 'input' ? [{ remove: () => { removedInput = true; } }] : [],
    prepend: (node) => { caption = node.textContent; },
  };
  const table = { closest: (selector) => selector === '.combined-ion-treatment' ? {} : null, cloneNode: () => copy };
  const nodes = [];
  const doc = { createElement: () => ({}), head: { appendChild() {} }, body: { appendChild: (node) => nodes.push(node) } };
  const frame = { style: {}, contentDocument: doc, contentWindow: { addEventListener() {}, focus() {}, print() {} } };
  const originalDocument = globalThis.document;
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  globalThis.document = { getElementById: () => null, createElement: () => frame, body: { appendChild() {} } };
  printSettlementTable({ querySelectorAll: () => [table] }, '전체 통계', { includeTherapistSummary: true });
  assert.equal(caption, '최근 6개월 이온치료 현황');
  assert.equal(removedInput, true);
  assert.equal(nodes[1], copy);
});

test('recent settlement printing includes the selected ion table in the first column', (t) => {
  const printedTables = [];
  const styles = [];
  const copy = {
    style: {},
    querySelectorAll: () => [],
    prepend: () => {},
  };
  const table = {
    closest: (selector) => selector === '.combined-ion-treatment' ? {} : null,
    cloneNode: () => copy,
  };
  const doc = {
    createElement: (tag) => tag === 'div'
      ? { dataset: {}, appendChild: (node) => printedTables.push(node) }
      : {},
    head: { appendChild: (node) => styles.push(node) },
    body: { appendChild() {}, offsetHeight: 100 },
  };
  const frame = { style: {}, contentDocument: doc, contentWindow: { addEventListener() {}, focus() {}, print() {} } };
  const originalDocument = globalThis.document;
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  globalThis.document = { getElementById: () => null, createElement: () => frame, body: { appendChild() {} } };
  printSettlementTable({ dataset: { recentView: 'total-only' }, querySelectorAll: () => [table] }, '전체결산', { includeRecentTables: true, orientation: 'landscape' });
  assert.deepEqual(printedTables, [copy]);
  assert.equal(copy.style.gridColumn, '1');
  assert.equal(doc.body.className, 'combined-recent-print--landscape');
  assert.match(styles[0].textContent, /\.combined-recent-print-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles[0].textContent, /\.combined-recent-print--landscape \.combined-recent-print-grid \{ width: 94%; margin-inline: auto; \}/);
  assert.match(styles[0].textContent, /\.combined-recent-print--landscape \.combined-recent-print-grid table \{ font-size: 8\.5px; \}/);
});

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
  const tables = copies.map((copy) => ({ closest: () => null, cloneNode: () => copy }));
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
  assert.equal(doc.title, '2026년 9월 전체 통계 합계');
});

test('includes the checked ion table with its title and printable values', (t) => {
  let removedInput = false;
  let caption;
  const copy = {
    querySelectorAll: (selector) => selector === 'input' ? [{ remove: () => { removedInput = true; } }] : [],
    prepend: (node) => { caption = node.textContent; },
  };
  const table = { closest: () => ({}), cloneNode: () => copy };
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

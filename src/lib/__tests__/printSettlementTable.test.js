import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printSettlementTable } from '../printSettlementTable.js';

test('prints an isolated clone with the selected rows and removes controls, then cleans up', (t) => {
  let removedControls = false;
  let removedFrame = false;
  let printed = false;
  let afterprint;
  const copy = { querySelectorAll: () => [{ remove: () => { removedControls = true; } }] };
  const table = { cloneNode: (deep) => { assert.equal(deep, true); return copy; } };
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

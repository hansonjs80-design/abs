import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cArmCellSelected, cArmSelectionBounds, clearCArmSelection, copyCArmSelection } from '../cArmSelection.js';
import { pasteCArmCounts } from '../cArmClipboard.js';

const document = () => ({ incentive_rate: 2000, radiographers: [
  { id: 'a', name: '가', days: { 1: { first: 1, returning: 2 }, 2: { first: 3, returning: 4 } } },
  { id: 'b', name: '나', days: { 1: { first: 5, returning: 6 } } },
] });

describe('C-Arm rectangular selection', () => {
  it('normalizes reversed drags and identifies all cells in the rectangle', () => {
    const range = cArmSelectionBounds({ anchor: { row: 3, col: 3 }, end: { row: 1, col: 0 } });
    assert.deepEqual(range, { top: 1, bottom: 3, left: 0, right: 3 });
    assert.equal(cArmCellSelected(range, 2, 1), true);
    assert.equal(cArmCellSelected(range, 4, 1), false);
    assert.equal(cArmCellSelected(null, 1, 1), false);
  });
  it('copies counts across staff tables in spreadsheet column order, including empty cells', () => {
    assert.equal(copyCArmSelection(document(), { top: 1, bottom: 2, left: 0, right: 3 }), '1\t2\t5\t6\n3\t4\t\t');
  });
  it('clears only selected cells without mutating the source for cut and undo', () => {
    const original = document();
    const snapshot = structuredClone(original);
    const result = clearCArmSelection(original, { top: 1, bottom: 2, left: 1, right: 2 });
    assert.equal(result.radiographers[0].days[1].first, 1);
    assert.equal(result.radiographers[0].days[1].returning, null);
    assert.equal(result.radiographers[1].days[1].first, null);
    assert.equal(result.radiographers[1].days[1].returning, 6);
    assert.deepEqual(original, snapshot);
  });
  it('round trips a copied multi-column range into a later day', () => {
    const original = document();
    const text = copyCArmSelection(original, { top: 1, bottom: 2, left: 0, right: 3 });
    const result = pasteCArmCounts(original, { text, year: 2026, month: 9, day: 5, personId: 'a', kind: 'first' });
    assert.deepEqual(result.document.radiographers[0].days[5], { first: 1, returning: 2 });
    assert.deepEqual(result.document.radiographers[1].days[5], { first: 5, returning: 6 });
    assert.deepEqual(result.document.radiographers[1].days[6], { first: null, returning: null });
  });
  it('renders compact table with 초진 and 재진 headers and explicit column widths', async () => {
    const { readFile } = await import('node:fs/promises');
    const pageSource = await readFile(new URL('../../pages/CArmStatsPage.jsx', import.meta.url), 'utf8');
    const cssSource = await readFile(new URL('../../styles/c_arm_stats.css', import.meta.url), 'utf8');

    assert.match(pageSource, /<th scope="col">초진<\/th>/);
    assert.match(pageSource, /<th scope="col">재진<\/th>/);
    assert.doesNotMatch(pageSource, /<th scope="col">초진환자<\/th>/);
    assert.doesNotMatch(pageSource, /<th scope="col">재진환자<\/th>/);
    assert.match(pageSource, /<col className="c-arm-col-date" \/>/);
    assert.match(pageSource, /<col className="c-arm-col-first" \/>/);
    assert.match(pageSource, /<col className="c-arm-col-returning" \/>/);

    assert.match(cssSource, /\.c-arm-person-table \.c-arm-col-date\s*\{\s*width:\s*96px;/);
    assert.match(cssSource, /\.c-arm-person-table \.c-arm-col-first\s*\{\s*width:\s*52px;/);
    assert.match(cssSource, /\.c-arm-person-table \.c-arm-col-returning\s*\{\s*width:\s*52px;/);
  });
  it('renders incentive table with separate 건수 column instead of small description', async () => {
    const { readFile } = await import('node:fs/promises');
    const pageSource = await readFile(new URL('../../pages/CArmStatsPage.jsx', import.meta.url), 'utf8');

    assert.match(pageSource, /<th scope="col">방사선사<\/th><th scope="col">건수<\/th><th scope="col">인센티브 금액<\/th>/);
    assert.doesNotMatch(pageSource, /<small>.*건 × .*원<\/small>/);
    assert.match(pageSource, /<col className="c-arm-incentive-col-name" \/>/);
    assert.match(pageSource, /<col className="c-arm-incentive-col-count" \/>/);
    assert.match(pageSource, /<col className="c-arm-incentive-col-amount" \/>/);
  });
  it('hides the toolbar subtitle description during print', async () => {
    const { readFile } = await import('node:fs/promises');
    const cssSource = await readFile(new URL('../../styles/c_arm_stats.css', import.meta.url), 'utf8');

    assert.match(cssSource, /@media print\s*\{[\s\S]*?\.c-arm-toolbar p[^}]*display:\s*none !important;/);
  });
});

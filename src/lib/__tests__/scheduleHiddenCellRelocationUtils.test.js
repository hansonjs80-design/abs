import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getShockwaveScheduleBaseRowCount,
  relocateHiddenMergedScheduleRows,
} from '../scheduleHiddenCellRelocationUtils.js';

const defaultSpan = { rowSpan: 1, colSpan: 1, mergedInto: null };

function cellKey(item) {
  return `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
}

function rowsByKey(rows) {
  return new Map(rows.map((item) => [cellKey(item), item]));
}

describe('hidden merged shockwave schedule relocation', () => {
  it('moves content stored in a covered merged child below the merged master', () => {
    const result = relocateHiddenMergedScheduleRows([
      {
        year: 2026,
        month: 7,
        week_index: 0,
        day_index: 1,
        row_index: 3,
        col_index: 0,
        content: '111/마스터',
        merge_span: { rowSpan: 2, colSpan: 1, mergedInto: null },
      },
      {
        year: 2026,
        month: 7,
        week_index: 0,
        day_index: 1,
        row_index: 4,
        col_index: 0,
        content: '222/숨은환자',
        bg_color: '#ffe599',
        prescription: 'F2.5',
        body_part: 'Elbow',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-1-3-0' },
      },
    ], { rowCount: 8 });

    const map = rowsByKey(result.rows);
    assert.equal(map.get('0-1-4-0').content, '');
    assert.equal(map.get('0-1-4-0').merge_span.mergedInto, '0-1-3-0');

    const moved = map.get('0-1-5-0');
    assert.equal(moved.content, '222/숨은환자');
    assert.equal(moved.bg_color, '#ffe599');
    assert.equal(moved.prescription, 'F2.5');
    assert.equal(moved.body_part, 'Elbow');
    assert.equal(moved.merge_span.mergedInto, null);
    assert.equal(moved.merge_span.meta.relocated_from_hidden_merge_cell, '0-1-4-0');
    assert.equal(result.payload.length, 2);
  });

  it('uses the nearest row above when the row below the merge is occupied', () => {
    const result = relocateHiddenMergedScheduleRows([
      {
        year: 2026,
        month: 7,
        week_index: 1,
        day_index: 2,
        row_index: 3,
        col_index: 1,
        content: '111/마스터',
        merge_span: { rowSpan: 2, colSpan: 1, mergedInto: null },
      },
      {
        year: 2026,
        month: 7,
        week_index: 1,
        day_index: 2,
        row_index: 4,
        col_index: 1,
        content: '222/숨은환자',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '1-2-3-1' },
      },
      {
        year: 2026,
        month: 7,
        week_index: 1,
        day_index: 2,
        row_index: 5,
        col_index: 1,
        content: '333/기존환자',
        merge_span: defaultSpan,
      },
    ], { rowCount: 7 });

    const map = rowsByKey(result.rows);
    assert.equal(map.get('1-2-2-1').content, '222/숨은환자');
    assert.equal(map.get('1-2-5-1').content, '333/기존환자');
  });

  it('does not create a duplicate when a relocation target already exists', () => {
    const result = relocateHiddenMergedScheduleRows([
      {
        year: 2026,
        month: 7,
        week_index: 2,
        day_index: 3,
        row_index: 6,
        col_index: 2,
        content: '111/마스터',
        merge_span: { rowSpan: 2, colSpan: 1, mergedInto: null },
      },
      {
        year: 2026,
        month: 7,
        week_index: 2,
        day_index: 3,
        row_index: 7,
        col_index: 2,
        content: '222/숨은환자',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '2-3-6-2' },
      },
      {
        year: 2026,
        month: 7,
        week_index: 2,
        day_index: 3,
        row_index: 8,
        col_index: 2,
        content: '222/수정된환자',
        merge_span: {
          ...defaultSpan,
          meta: { relocated_from_hidden_merge_cell: '2-3-7-2' },
        },
      },
    ], { rowCount: 12 });

    const map = rowsByKey(result.rows);
    assert.equal(map.get('2-3-7-2').content, '');
    assert.equal(map.get('2-3-8-2').content, '222/수정된환자');
    assert.deepEqual(
      result.payload.map((item) => cellKey(item)),
      ['2-3-7-2']
    );
  });

  it('clears a covered child that duplicates the merged master appointment', () => {
    const result = relocateHiddenMergedScheduleRows([
      {
        year: 2026,
        month: 6,
        week_index: 0,
        day_index: 0,
        row_index: 0,
        col_index: 0,
        content: '11383/임태용(16)',
        bg_color: '#ffe599',
        prescription: 'F/R',
        body_part: 'Rt Ankle',
        merge_span: { rowSpan: 2, colSpan: 1, mergedInto: null },
      },
      {
        year: 2026,
        month: 6,
        week_index: 0,
        day_index: 0,
        row_index: 1,
        col_index: 0,
        content: '11383/임태용(16)',
        bg_color: '#ffe599',
        prescription: 'F/R',
        body_part: 'Rt Ankle',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-0-0-0' },
      },
    ], { rowCount: 8 });

    const map = rowsByKey(result.rows);
    assert.equal(map.get('0-0-0-0').content, '11383/임태용(16)');
    assert.equal(map.get('0-0-1-0').content, '');
    assert.equal(map.get('0-0-1-0').prescription, null);
    assert.equal(map.get('0-0-1-0').body_part, null);
    assert.deepEqual(
      result.payload.map((item) => cellKey(item)),
      ['0-0-1-0']
    );
  });

  it('clears a covered stale visit marker for the same chart and patient', () => {
    const result = relocateHiddenMergedScheduleRows([
      {
        year: 2026,
        month: 6,
        week_index: 1,
        day_index: 0,
        row_index: 18,
        col_index: 1,
        content: '14122/전지환(1)',
        bg_color: '#ffe599',
        prescription: 'F2.5',
        body_part: 'Lt Elbow',
        merge_span: { rowSpan: 2, colSpan: 1, mergedInto: null },
      },
      {
        year: 2026,
        month: 6,
        week_index: 1,
        day_index: 0,
        row_index: 19,
        col_index: 1,
        content: '14122/전지환*',
        bg_color: '#ffe599',
        prescription: 'F2.5',
        body_part: 'Lt Elbow',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
      },
    ], { rowCount: 40 });

    const map = rowsByKey(result.rows);
    assert.equal(map.get('1-0-18-1').content, '14122/전지환(1)');
    assert.equal(map.get('1-0-19-1').content, '');
    assert.equal(map.get('1-0-19-1').prescription, null);
    assert.equal(map.get('1-0-19-1').body_part, null);
  });

  it('keeps a covered same-patient cell when its prescription or body part is different', () => {
    const result = relocateHiddenMergedScheduleRows([
      {
        year: 2026,
        month: 6,
        week_index: 0,
        day_index: 0,
        row_index: 0,
        col_index: 0,
        content: '11383/임태용(16)',
        bg_color: '#ffe599',
        prescription: 'F/R',
        body_part: 'Rt Ankle',
        merge_span: { rowSpan: 2, colSpan: 1, mergedInto: null },
      },
      {
        year: 2026,
        month: 6,
        week_index: 0,
        day_index: 0,
        row_index: 1,
        col_index: 0,
        content: '11383/임태용(16)',
        bg_color: '#ffe599',
        prescription: 'F/RDC',
        body_part: 'Rt Hip',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-0-0-0' },
      },
    ], { rowCount: 8 });

    const map = rowsByKey(result.rows);
    const moved = map.get('0-0-2-0');
    assert.equal(moved.content, '11383/임태용(16)');
    assert.equal(moved.prescription, 'F/RDC');
    assert.equal(moved.body_part, 'Rt Hip');
    assert.equal(map.get('0-0-1-0').content, '');
  });

  it('detaches a stale merged child with content when its master is missing', () => {
    const result = relocateHiddenMergedScheduleRows([
      {
        year: 2026,
        month: 7,
        week_index: 0,
        day_index: 0,
        row_index: 1,
        col_index: 0,
        content: '222/고립셀',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-0-0-0' },
      },
    ], { rowCount: 4 });

    const map = rowsByKey(result.rows);
    assert.equal(map.get('0-0-1-0').content, '222/고립셀');
    assert.deepEqual(map.get('0-0-1-0').merge_span, defaultSpan);
    assert.equal(result.payload.length, 1);
  });

  it('calculates the schedule row count from the widest configured operating hours', () => {
    assert.equal(getShockwaveScheduleBaseRowCount({
      start_time: '09:00:00',
      end_time: '18:00:00',
      time_label_interval_minutes: 10,
    }, 2026, 7), 54);

    assert.equal(getShockwaveScheduleBaseRowCount({
      start_time: '09:00:00',
      end_time: '18:00:00',
      time_label_interval_minutes: 10,
      date_overrides: {
        '2026-07-20': { start_time: '08:00', end_time: '19:00' },
      },
    }, 2026, 7), 66);
  });
});

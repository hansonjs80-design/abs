import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatStatsRowForScheduler,
  getVisibleShockwaveScheduleMemoEntriesForStats,
  parseTherapyInfo,
  resolveShockwaveSchedulePrescriptionCount,
  shouldUseExistingShockwaveSchedulerLogForCopy,
  syncMonthShockwaveScheduleToStats,
} from '../shockwaveSyncUtils.js';

describe('shockwave scheduler/stat sync formatting', () => {
  it('keeps a new-patient marker when stats rows store the first visit as 1', () => {
    assert.equal(
      formatStatsRowForScheduler({
        chart_number: '12745',
        patient_name: '신금란*',
        visit_count: '1',
      }),
      '12745/신금란*'
    );
  });

  it('keeps a new-patient marker when stats rows keep it as the visit marker', () => {
    assert.equal(
      formatStatsRowForScheduler({
        chart_number: '12745',
        patient_name: '신금란*',
        visit_count: '*',
      }),
      '12745/신금란*'
    );
  });

  it('uses explicit later visit counts instead of leaving the new-patient marker', () => {
    assert.equal(
      formatStatsRowForScheduler({
        chart_number: '12745',
        patient_name: '신금란*',
        visit_count: '3',
      }),
      '12745/신금란(3)'
    );
  });

  it('parses scheduler new-patient cells into the stats representation used by sync', () => {
    assert.deepEqual(parseTherapyInfo('12745/신금란*'), {
      patient_name: '신금란*',
      chart_number: '12745',
      visit_count: '1',
      body_part: '',
      original: '12745/신금란*',
    });
  });

  it('keeps 40/60-tagged patient names when an independent shinjang prescription is synced', () => {
    assert.equal(parseTherapyInfo('12745/신금란40(2)'), null);
    assert.deepEqual(
      parseTherapyInfo('12745/신금란40(2)', { allowManualDuration: true }),
      {
        patient_name: '신금란',
        chart_number: '12745',
        visit_count: '2',
        body_part: '',
        original: '12745/신금란40(2)',
      }
    );
  });

  it('rebuilds completed shinjang 1 and 2 cells even when patient names carry manual duration tags', async () => {
    const settings = {
      monthly_settlement_settings: {
        '2026-09': {
          shinjang_spray: {
            prescriptions: ['신장분사 1', '신장분사 2'],
          },
        },
      },
    };
    const result = await syncMonthShockwaveScheduleToStats({
      year: 2026,
      month: 9,
      memos: {
        '0-5-0-0': {
          content: '12745/신금란40(2)',
          prescription: '신장분사 1',
          bg_color: '#ffe599',
        },
        '0-5-1-0': {
          content: '12746/홍길동60(3)',
          prescription: '신장분사 2',
          bg_color: '#ffe599',
        },
      },
      therapists: [{ name: '주한솔' }],
      monthlyTherapists: [],
      settings,
      replaceExistingMonthLogs: true,
      emitEvent: false,
    });

    assert.deepEqual(
      result.rebuiltRows.map((row) => [row.prescription, row.patient_name]),
      [
        ['신장분사 1', '신금란'],
        ['신장분사 2', '홍길동'],
      ]
    );
  });

  it('counts each completed scheduler cell as one prescription even when old stats had larger counts', () => {
    assert.equal(
      resolveShockwaveSchedulePrescriptionCount({
        prescription: '',
        fallbackPrescription: 'F2.5',
        fallbackPrescriptionCount: 4,
      }),
      1
    );
    assert.equal(
      resolveShockwaveSchedulePrescriptionCount({
        prescription: 'F4.0',
        fallbackPrescription: 'F2.5',
        fallbackPrescriptionCount: 4,
      }),
      1
    );
  });

  it('does not copy prescription metadata from sheet/manual rows during scheduler sync', () => {
    assert.equal(shouldUseExistingShockwaveSchedulerLogForCopy({ source: 'sheet' }), false);
    assert.equal(shouldUseExistingShockwaveSchedulerLogForCopy({ source: 'manual' }), false);
    assert.equal(shouldUseExistingShockwaveSchedulerLogForCopy({ source: 'scheduler' }), true);
    assert.equal(
      shouldUseExistingShockwaveSchedulerLogForCopy({ source: 'manual', scheduler_cell_key: '2026:06:0:0:1:0' }),
      true
    );
  });

  it('extracts only rendered schedule cells for stats sync', () => {
    const entries = getVisibleShockwaveScheduleMemoEntriesForStats({
      '0-0-10-1': {
        content: '14122/전지환(1)',
        bg_color: '#fff2cc',
        prescription: 'F2.5',
        merge_span: { rowSpan: 2, colSpan: 1, mergedInto: null },
      },
      '0-0-11-1': {
        content: '14122/전지환*',
        bg_color: '#fff2cc',
        prescription: 'F2.5',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: '0-0-10-1' },
      },
      '0-0-15-1': {
        content: '14122/전지환(1)',
        bg_color: '#fff2cc',
        prescription: 'F2.5',
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
      },
    });

    assert.deepEqual(entries.map(([key]) => key), ['0-0-10-1', '0-0-15-1']);
  });

  it('ignores completed cells outside the rendered schedule rows and therapist columns', () => {
    const entries = getVisibleShockwaveScheduleMemoEntriesForStats({
      '1-0-10-0': {
        content: '2629/조다슬(3)',
        bg_color: '#ffe599',
        prescription: 'F/RDC',
      },
      '1-0-11-0': {
        content: '2629/조다슬(3)',
        bg_color: '#ffe599',
        prescription: 'F/RDC',
      },
      '1-0-54-0': {
        content: '2629/조다슬(3)',
        bg_color: '#ffe599',
        prescription: 'F/RDC',
      },
      '1-0-12-4': {
        content: '2629/조다슬(3)',
        bg_color: '#ffe599',
        prescription: 'F/RDC',
      },
    }, {
      rowCount: 31,
      colCount: 3,
    });

    assert.deepEqual(entries.map(([key]) => key), ['1-0-10-0', '1-0-11-0']);
  });
});

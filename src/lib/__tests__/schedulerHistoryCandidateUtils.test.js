import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPatientHistorySchedulePresenceKeys,
  buildScheduleRowsBySchedulerCellKey,
  getSchedulerLinkedLogQueryTargets,
  shouldUseScheduleContentForPatientHistory,
  shouldKeepSchedulerLinkedPatientLog,
  shouldKeepUnkeyedSchedulerLogForPatientHistory,
  shouldUseScheduleRowForPatientHistory,
  isUnmarkedSameDaySchedulerLog,
} from '../schedulerHistoryCandidateUtils.js';

describe('scheduler history candidate filtering', () => {
  it('does not treat an unmarked schedule name as confirmed patient history', () => {
    assert.equal(shouldUseScheduleContentForPatientHistory('신지숙'), false);
    assert.equal(shouldUseScheduleContentForPatientHistory('12745/신지숙'), false);
  });

  it('uses schedule cells with explicit visit markers as patient history', () => {
    assert.equal(shouldUseScheduleContentForPatientHistory('신지숙*'), true);
    assert.equal(shouldUseScheduleContentForPatientHistory('12745/신지숙(2)'), true);
    assert.equal(shouldUseScheduleContentForPatientHistory('12745/신지숙(-)'), true);
  });

  it('ignores same-day scheduler logs that were synced before the new-patient marker was added', () => {
    assert.equal(
      isUnmarkedSameDaySchedulerLog({
        date: '2026-07-02',
        patient_name: '신지숙',
        visit_count: '1',
        source: 'scheduler',
        scheduler_cell_key: '2026:07:0:4:2:0',
      }, '2026-07-02'),
      true
    );
  });

  it('keeps marked or older scheduler logs available as history', () => {
    assert.equal(
      isUnmarkedSameDaySchedulerLog({
        date: '2026-07-02',
        patient_name: '신지숙*',
        visit_count: '1',
        source: 'scheduler',
      }, '2026-07-02'),
      false
    );
    assert.equal(
      isUnmarkedSameDaySchedulerLog({
        date: '2026-07-01',
        patient_name: '신지숙',
        visit_count: '1',
        source: 'scheduler',
      }, '2026-07-02'),
      false
    );
  });

  it('ignores adjacent-month mirrored schedule rows when building history', () => {
    assert.equal(
      shouldUseScheduleRowForPatientHistory(
        {
          content: '6245/박병수(13)',
          row_index: 1,
          col_index: 2,
        },
        {
          year: 2026,
          month: 6,
          day: 29,
          isCurrentMonth: false,
        }
      ),
      false
    );
  });

  it('does not use the current editing cell as its own latest history', () => {
    assert.equal(
      shouldUseScheduleRowForPatientHistory(
        {
          content: '6245/박병수(3)',
          row_index: 10,
          col_index: 1,
        },
        {
          year: 2026,
          month: 7,
          day: 16,
          isCurrentMonth: true,
        },
        {
          targetDate: '2026-07-16',
          targetRowIndex: 10,
          targetColIndex: 1,
        }
      ),
      false
    );
  });

  it('keeps other real schedule rows on or before the target date', () => {
    assert.equal(
      shouldUseScheduleRowForPatientHistory(
        {
          content: '6245/박병수(2)',
          row_index: 7,
          col_index: 1,
        },
        {
          year: 2026,
          month: 7,
          day: 9,
          isCurrentMonth: true,
        },
        {
          targetDate: '2026-07-16',
          targetRowIndex: 10,
          targetColIndex: 1,
        }
      ),
      true
    );
  });

  it('groups scheduler-linked log keys by month for live schedule validation', () => {
    assert.deepEqual(
      getSchedulerLinkedLogQueryTargets([
        { scheduler_cell_key: '2026:07:3:0:12:1' },
        { scheduler_cell_key: '2026:07:3:1:13:2' },
        { scheduler_cell_key: '2026:08:4:0:8:0' },
        { scheduler_cell_key: 'invalid' },
      ]),
      [
        {
          year: 2026,
          month: 7,
          weekIndexes: [3],
          dayIndexes: [0, 1],
          rowIndexes: [12, 13],
          colIndexes: [1, 2],
        },
        {
          year: 2026,
          month: 8,
          weekIndexes: [4],
          dayIndexes: [0],
          rowIndexes: [8],
          colIndexes: [0],
        },
      ]
    );
  });

  it('removes a scheduler-linked patient log when the linked schedule cell is gone', () => {
    assert.equal(
      shouldKeepSchedulerLinkedPatientLog(
        {
          date: '2026-07-27',
          patient_name: '이지운',
          chart_number: '6281',
          source: 'scheduler',
          scheduler_cell_key: '2026:07:3:0:12:1',
        },
        buildScheduleRowsBySchedulerCellKey([])
      ),
      false
    );
  });

  it('keeps a scheduler-linked patient log only when the live schedule cell still matches', () => {
    const rowsByKey = buildScheduleRowsBySchedulerCellKey([
      {
        year: 2026,
        month: 7,
        week_index: 3,
        day_index: 0,
        row_index: 12,
        col_index: 1,
        content: '6281/이지운40(2)',
        prescription: '40분',
      },
    ]);

    assert.equal(
      shouldKeepSchedulerLinkedPatientLog(
        {
          date: '2026-07-20',
          patient_name: '이지운',
          chart_number: '6281',
          source: 'scheduler',
          scheduler_cell_key: '2026:07:3:0:12:1',
          history_group: 'manual',
        },
        rowsByKey,
        {
          getLogHistoryGroup: (log) => log.history_group,
          getScheduleHistoryGroup: () => 'manual',
        }
      ),
      true
    );

    assert.equal(
      shouldKeepSchedulerLinkedPatientLog(
        {
          date: '2026-07-27',
          patient_name: '다른환자',
          chart_number: '9999',
          source: 'scheduler',
          scheduler_cell_key: '2026:07:3:0:12:1',
        },
        rowsByKey
      ),
      false
    );
  });

  it('keeps a future scheduler-linked patient log when the live schedule cell still exists', () => {
    const rowsByKey = buildScheduleRowsBySchedulerCellKey([
      {
        year: 2026,
        month: 7,
        week_index: 4,
        day_index: 0,
        row_index: 12,
        col_index: 1,
        content: '6281/이지운40(2)',
        prescription: '40분',
      },
    ]);

    assert.equal(
      shouldKeepSchedulerLinkedPatientLog(
        {
          date: '2026-07-27',
          patient_name: '이지운',
          chart_number: '6281',
          source: 'scheduler',
          scheduler_cell_key: '2026:07:4:0:12:1',
          history_group: 'manual',
        },
        rowsByKey,
        {
          getLogHistoryGroup: (log) => log.history_group,
          getScheduleHistoryGroup: () => 'manual',
        }
      ),
      true
    );
  });

  it('removes an unkeyed future scheduler log when no matching schedule row exists', () => {
    const schedulePresenceKeys = buildPatientHistorySchedulePresenceKeys([
      {
        dateStr: '2026-07-27',
        historyGroup: 'manual',
        parsed: {
          patientChart: '9999',
          patientName: '다른환자',
        },
      },
    ]);

    assert.equal(
      shouldKeepUnkeyedSchedulerLogForPatientHistory(
        {
          date: '2026-07-27',
          patient_name: '이지운',
          chart_number: '6281',
          source: 'scheduler',
          history_group: 'manual',
        },
        schedulePresenceKeys,
        '2026-07-20'
      ),
      false
    );
  });

  it('keeps an unkeyed future scheduler log when a matching schedule row exists', () => {
    const schedulePresenceKeys = buildPatientHistorySchedulePresenceKeys([
      {
        dateStr: '2026-07-27',
        historyGroup: 'manual',
        parsed: {
          patientChart: '6281',
          patientName: '이지운',
        },
      },
    ]);

    assert.equal(
      shouldKeepUnkeyedSchedulerLogForPatientHistory(
        {
          date: '2026-07-27',
          patient_name: '이지운',
          chart_number: '6281',
          source: 'scheduler',
          history_group: 'manual',
        },
        schedulePresenceKeys,
        '2026-07-20'
      ),
      true
    );
  });

  it('removes scheduler-linked logs after the selected target date', () => {
    const rowsByKey = buildScheduleRowsBySchedulerCellKey([
      {
        year: 2026,
        month: 7,
        week_index: 4,
        day_index: 0,
        row_index: 12,
        col_index: 1,
        content: '6281/이지운40(2)',
        prescription: '40분',
      },
    ]);

    assert.equal(
      shouldKeepSchedulerLinkedPatientLog(
        {
          date: '2026-07-27',
          patient_name: '이지운',
          chart_number: '6281',
          source: 'scheduler',
          scheduler_cell_key: '2026:07:4:0:12:1',
        },
        rowsByKey,
        { targetDate: '2026-07-20' }
      ),
      false
    );
  });

  it('removes scheduler-linked logs when the live schedule treatment group changed', () => {
    const rowsByKey = buildScheduleRowsBySchedulerCellKey([
      {
        year: 2026,
        month: 7,
        week_index: 3,
        day_index: 0,
        row_index: 12,
        col_index: 1,
        content: '6281/이지운(2)',
        prescription: 'F2.5',
      },
    ]);

    assert.equal(
      shouldKeepSchedulerLinkedPatientLog(
        {
          date: '2026-07-27',
          patient_name: '이지운',
          chart_number: '6281',
          source: 'scheduler',
          scheduler_cell_key: '2026:07:3:0:12:1',
          history_group: 'manual',
        },
        rowsByKey,
        {
          getLogHistoryGroup: (log) => log.history_group,
          getScheduleHistoryGroup: () => 'shockwave',
        }
      ),
      false
    );
  });
});

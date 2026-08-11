import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPatientHistoryCellUpdate,
  dedupePatientHistoryLogsByScheduleCell,
  getConfiguredPatientHistoryTreatmentGroup,
  getPatientHistoryChartOptions,
  getPatientHistoryBodyPartText,
  getPatientHistoryBodyPartTextareaRows,
  getPatientHistoryListTextAlign,
  getPatientHistoryMemoDisplayText,
  getPatientHistoryMemoText,
  getPatientHistoryMemoTextareaRows,
  getPatientHistoryNameOnlySearchTarget,
  getPatientHistoryScheduleOverrideKey,
  getPatientHistorySearchTarget,
  getPatientHistoryTreatmentGroup,
  isNameOnlyPatientHistoryDraft,
  parsePatientHistoryBodyPartText,
  parsePatientHistoryMemoText,
  patientHistoryLogsShareScheduleCell,
  patientHistoryIdentityMatches,
  resolvePatientHistorySearchChart,
  resolvePatientHistoryApplyTarget,
} from '../patientHistoryModalUtils.js';

describe('patient history treatment grouping', () => {
  const settings = {
    prescriptions: ['F2.5'],
    manual_therapy_prescriptions: ['40분', '60분'],
    monthly_settlement_settings: {
      '2026-07': {
        shockwave: {
          prescriptions: ['F2.5'],
        },
        manual_therapy: {
          prescriptions: ['30분'],
          dose_tags: { '30분': '30' },
        },
      },
    },
  };

  it('routes a monthly 30 minute manual prescription away from shockwave history', () => {
    assert.equal(getPatientHistoryTreatmentGroup({
      type: 'shockwave',
      prescription: '30분',
      settings,
      date: '2026-07-20',
    }), 'manual');
    assert.equal(getConfiguredPatientHistoryTreatmentGroup({
      content: '9307/주한솔30(2)',
      settings,
      year: 2026,
      month: 7,
    }), 'manual');
  });

  it('keeps configured shockwave prescriptions in shockwave history', () => {
    assert.equal(getPatientHistoryTreatmentGroup({
      type: 'schedule',
      prescription: 'F2.5',
      settings,
      date: '2026-07-20',
    }), 'shockwave');
  });
});

describe('patient history modal search target', () => {
  it('opens as an empty manual search when the selected cell is blank', () => {
    assert.deepEqual(getPatientHistorySearchTarget(''), {
      shouldFetch: false,
      searchName: '',
      searchChart: '',
    });
  });

  it('searches by chart number when the cell has chart/name content', () => {
    assert.deepEqual(getPatientHistorySearchTarget('14634/김보람(3)'), {
      shouldFetch: true,
      searchName: '김보람',
      searchChart: '14634',
    });
  });

  it('keeps non-visit parenthetical notes out of the search name', () => {
    assert.deepEqual(getPatientHistorySearchTarget('3275/손연희(진료후도수)*'), {
      shouldFetch: true,
      searchName: '손연희',
      searchChart: '3275',
    });
  });

  it('drops the chart number when the displayed name is searched again', () => {
    assert.deepEqual(getPatientHistoryNameOnlySearchTarget('14634/김보람(3)'), {
      shouldFetch: true,
      searchName: '김보람',
      searchChart: '',
    });
    assert.deepEqual(getPatientHistoryNameOnlySearchTarget('김보람'), {
      shouldFetch: true,
      searchName: '김보람',
      searchChart: '',
    });
  });

  it('builds one dropdown option per chart number for exact same-name patients', () => {
    assert.deepEqual(getPatientHistoryChartOptions([
      { patient_name: '김보람', chart_number: '14634' },
      { patient_name: '김보람', chart_number: '14634' },
      { patient_name: '김보람', chart_number: '204' },
      { patient_name: '김보람', chart_number: '' },
      { patient_name: '김보람A', chart_number: '999' },
    ], '김보람'), [
      { patientName: '김보람', chartNumber: '204' },
      { patientName: '김보람', chartNumber: '14634' },
    ]);
  });

  it('keeps name and chart only when there is no same-name chart alternative', () => {
    assert.equal(resolvePatientHistorySearchChart('', [
      { patientName: '김보람', chartNumber: '14634' },
    ]), '14634');
    assert.equal(resolvePatientHistorySearchChart('', [
      { patientName: '김보람', chartNumber: '204' },
      { patientName: '김보람', chartNumber: '14634' },
    ]), '');
    assert.equal(resolvePatientHistorySearchChart('14634', []), '14634');
  });

  it('defers automatic completion only while a plain patient name is being edited', () => {
    assert.equal(isNameOnlyPatientHistoryDraft('주한솔'), true);
    assert.equal(isNameOnlyPatientHistoryDraft('  주한솔  '), true);
    assert.equal(isNameOnlyPatientHistoryDraft('9307/주한솔'), false);
    assert.equal(isNameOnlyPatientHistoryDraft('주한솔(2)'), false);
    assert.equal(isNameOnlyPatientHistoryDraft('주한솔40'), false);
    assert.equal(isNameOnlyPatientHistoryDraft(''), false);
  });
});

describe('patient history schedule memos', () => {
  it('shows multiple body parts as separate editable lines without changing the saved list format', () => {
    assert.equal(
      getPatientHistoryBodyPartText('Rt. Shoulder, Lt. Knee'),
      '• Rt. Shoulder\n• Lt. Knee',
    );
    assert.deepEqual(
      parsePatientHistoryBodyPartText(' • Rt. Shoulder\n\n• Lt. Knee '),
      ['Rt. Shoulder', 'Lt. Knee'],
    );
    assert.equal(getPatientHistoryBodyPartText('Rt. Shoulder'), 'Rt. Shoulder');
    assert.equal(
      getPatientHistoryBodyPartText('경추근막통증(M79180)'),
      '경추근막통증(M79180)',
    );
    assert.equal(getPatientHistoryBodyPartTextareaRows('Rt. Shoulder'), 1);
    assert.equal(getPatientHistoryBodyPartTextareaRows('Rt. Shoulder, Lt. Knee'), 2);
  });

  it('shows the existing scheduler memo list as an editable multiline value', () => {
    assert.equal(getPatientHistoryMemoText({
      meta: { memo_list: ['예약 확인', '보호자 동반'] },
    }), '예약 확인\n보호자 동반');
  });

  it('keeps one non-empty memo entry per line when saving from the modal', () => {
    assert.deepEqual(
      parsePatientHistoryMemoText(' • 예약 확인 \n\n• 보호자 동반\n '),
      ['예약 확인', '보호자 동반']
    );
  });

  it('shows bullets only when the memo cell contains multiple entries', () => {
    assert.equal(getPatientHistoryMemoDisplayText('예약 확인'), '예약 확인');
    assert.equal(
      getPatientHistoryMemoDisplayText('예약 확인\n보호자 동반'),
      '• 예약 확인\n• 보호자 동반',
    );
    assert.equal(
      getPatientHistoryMemoDisplayText('예약 확인\n'),
      '예약 확인\n',
    );
  });

  it('uses a normal single-line height until a memo contains a line break', () => {
    assert.equal(getPatientHistoryMemoTextareaRows(''), 1);
    assert.equal(getPatientHistoryMemoTextareaRows('예약 확인'), 1);
    assert.equal(getPatientHistoryMemoTextareaRows('예약 확인\n보호자 동반'), 2);
  });

  it('centers one body or memo item and left-aligns a list', () => {
    assert.equal(getPatientHistoryListTextAlign(0), 'center');
    assert.equal(getPatientHistoryListTextAlign(1), 'center');
    assert.equal(getPatientHistoryListTextAlign(2), 'left');
  });
});

describe('patient history identity matching', () => {
  it('requires chart and exact normalized name when both are available', () => {
    assert.equal(patientHistoryIdentityMatches({
      chartParam: '11081',
      nameParam: '강민성',
      chartValue: '11081',
      nameValue: '강민성',
    }), true);

    assert.equal(patientHistoryIdentityMatches({
      chartParam: '11081',
      nameParam: '강민성',
      chartValue: '11081',
      nameValue: '다른환자',
    }), false);
  });

  it('does not match partial patient names', () => {
    assert.equal(patientHistoryIdentityMatches({
      nameParam: '김민',
      nameValue: '김민호',
    }), false);
  });
});

describe('patient history schedule row matching', () => {
  it('merges a scheduler-linked therapy log with its live schedule row despite body-part differences', () => {
    const historyLog = {
      type: 'manual',
      schedule_id: 'schedule-row-28',
      date: '2026-08-28',
      body_part: 'Lt. Knee',
    };
    const scheduleLog = {
      type: 'schedule',
      id: 'schedule-row-28',
      date: '2026-08-28',
      body_part: '',
    };

    assert.equal(patientHistoryLogsShareScheduleCell(historyLog, scheduleLog), true);
    assert.equal(
      getPatientHistoryScheduleOverrideKey(historyLog),
      'schedule__schedule-row-28'
    );
  });

  it('keeps separate schedule cells distinct when their treatments share a date', () => {
    assert.equal(patientHistoryLogsShareScheduleCell(
      { type: 'schedule', id: 'schedule-row-28-a' },
      { type: 'schedule', id: 'schedule-row-28-b' }
    ), false);
  });

  it('removes duplicate history rows only when they point to the same schedule cell', () => {
    assert.deepEqual(
      dedupePatientHistoryLogsByScheduleCell([
        { type: 'manual', schedule_id: 'schedule-row-28' },
        { type: 'schedule', id: 'schedule-row-28' },
        { type: 'schedule', id: 'schedule-row-28-other' },
        { type: 'manual', id: 'manual-log-28' },
      ]).map((log) => log.id || log.schedule_id),
      ['schedule-row-28', 'schedule-row-28-other', 'manual-log-28']
    );
  });
});

describe('patient history apply payload', () => {
  it('keeps the captured schedule cell after modal clicks clear the live selection', () => {
    assert.deepEqual(
      resolvePatientHistoryApplyTarget(
        { w: 1, d: 2, r: 18, c: 0 },
        null
      ),
      { w: 1, d: 2, r: 18, c: 0 }
    );
  });

  it('builds shockwave cell content from a selected history row', () => {
    const update = buildPatientHistoryCellUpdate({
      chart_number: '14634',
      patient_name: '김보람*',
      prescription: 'F/R',
      body_part: 'Lumbar',
      visit_count: '3',
      history_group: 'shockwave',
    });

    assert.equal(update.content, '14634/김보람(3)');
    assert.equal(update.prescription, 'F/R');
    assert.equal(update.body_part, 'Lumbar');
  });

  it('keeps special visit markers when applying a selected history row', () => {
    assert.equal(buildPatientHistoryCellUpdate({
      chart_number: '14634',
      patient_name: '김보람',
      visit_count: '*',
      history_group: 'shockwave',
    }).content, '14634/김보람*');

    assert.equal(buildPatientHistoryCellUpdate({
      chart_number: '14634',
      patient_name: '김보람',
      visit_count: '-',
      history_group: 'shockwave',
    }).content, '14634/김보람(-)');
  });

  it('adds manual therapy dose text once when applying a manual history row', () => {
    const update = buildPatientHistoryCellUpdate({
      chart_number: '3275',
      patient_name: '손연희',
      prescription: '40분',
      body_part: 'Cervical',
      visit_count: '2',
      history_group: 'manual',
    });

    assert.equal(update.content, '3275/손연희40(2)');
  });

  it('does not duplicate manual therapy dose text already included in the name', () => {
    const update = buildPatientHistoryCellUpdate({
      chart_number: '13015',
      patient_name: '한동균40',
      prescription: '40분',
      body_part: 'Lumbar',
      visit_count: '30',
      history_group: 'manual',
    });

    assert.equal(update.content, '13015/한동균40(30)');
  });

  it('does not clear an existing body part when a history row is missing body metadata', () => {
    const update = buildPatientHistoryCellUpdate({
      chart_number: '12089',
      patient_name: '김정미',
      prescription: 'F/R',
      visit_count: '5',
      history_group: 'shockwave',
    }, {
      body_part: 'Lt. Hip',
    });

    assert.equal(update.body_part, 'Lt. Hip');
  });

  it('omits inactive previous prescriptions while keeping patient metadata and resetting visit to first', () => {
    const update = buildPatientHistoryCellUpdate({
      chart_number: '13015',
      patient_name: '한동균',
      prescription: '40분',
      body_part: 'Lumbar',
      visit_count: '7',
      history_group: 'manual',
    }, {}, {
      omitPrescription: true,
      omitPrescriptionDoseTag: true,
      resetVisitCount: true,
    });

    assert.equal(update.content, '13015/한동균(1)');
    assert.equal(update.prescription, null);
    assert.equal(update.body_part, 'Lumbar');
  });
});

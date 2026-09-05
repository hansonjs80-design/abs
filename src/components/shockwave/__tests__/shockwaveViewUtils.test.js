import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildShockwaveHoverTooltipText,
  buildPatientHistoryLogGroups,
  buildPatientHistoryTreatmentFilterOptions,
  getPatientHistoryColumnWidths,
  getPatientHistoryFilterWidthWeight,
  getPatientHistoryModalLayout,
  getPatientHistoryPrescriptionColor,
  getPatientHistoryScheduleNavigationTarget,
  resolvePatientHistoryGroupTargetCell,
  togglePatientHistoryFilterSelection,
  togglePatientHistoryTreatmentSelection,
} from '../shockwaveViewUtils.js';

describe('shockwave view patient history model', () => {
  it('orders the selected treatment group first and applies body filters', () => {
    const groups = buildPatientHistoryLogGroups({
      selectedGroupKey: 'manual',
      bodyFilters: { manual: 'shoulder' },
      logs: [
        { id: 'shockwave-1', history_group: 'shockwave', body_part: 'Knee' },
        { id: 'manual-1', history_group: 'manual', body_part: 'Shoulder' },
        { id: 'manual-2', history_group: 'manual', body_part: 'Lumbar' },
      ],
    });

    assert.equal(groups[0].key, 'manual');
    assert.deepEqual(groups[0].logs.map((log) => log.id), ['manual-1']);
    assert.equal(groups[0].totalLogs.length, 2);
    assert.deepEqual(groups[0].activeBodyFilters, ['shoulder']);
  });

  it('keeps the captured schedule cell as the group-order source while history is open', () => {
    const capturedCell = { w: 0, d: 1, r: 2, c: 3 };
    const selectedCell = { w: 1, d: 2, r: 3, c: 4 };

    assert.equal(resolvePatientHistoryGroupTargetCell({
      modalOpen: true,
      capturedCell,
      selectedCell: null,
    }), capturedCell);
    assert.equal(resolvePatientHistoryGroupTargetCell({
      modalOpen: false,
      capturedCell,
      selectedCell,
    }), selectedCell);
  });

  it('derives visit sequence colors from the currently visible group rows', () => {
    const groups = buildPatientHistoryLogGroups({
      logs: [
        { id: 'visit-3', history_group: 'shockwave', date: '2026-08-03', visit_count: '3' },
        { id: 'visit-2', history_group: 'shockwave', date: '2026-08-02', visit_count: '2' },
        { id: 'visit-1', history_group: 'shockwave', date: '2026-08-01', visit_count: '1' },
      ],
    });

    assert.deepEqual(groups[0].visitSequenceColors, ['#bfdbfe', '#bfdbfe', '#bfdbfe']);
  });

  it('keeps shinjang visit colors continuous across different prescriptions', () => {
    const groups = buildPatientHistoryLogGroups({
      logs: [
        { id: 'shinjang-3', history_group: 'shinjang_spray', date: '2026-09-03', visit_count: '3', prescription: '신장분사 3.0' },
        { id: 'shinjang-2', history_group: 'shinjang_spray', date: '2026-09-02', visit_count: '2', prescription: '신장분사 2' },
        { id: 'shinjang-1', history_group: 'shinjang_spray', date: '2026-09-01', visit_count: '1', prescription: '신장분사 1' },
      ],
      selectedTreatmentGroups: ['shinjang'],
    });

    assert.equal(groups[0].key, 'shinjang');
    assert.deepEqual(groups[0].visitSequenceColors, ['#bbf7d0', '#bbf7d0', '#bbf7d0']);
  });

  it('combines all three treatment groups chronologically and splits exactly two selections', () => {
    const logs = [
      { id: 'manual', history_group: 'manual', date: '2026-09-02', prescription: '40분' },
      { id: 'shockwave', history_group: 'shockwave', date: '2026-09-03', prescription: 'F2.5' },
      { id: 'shinjang', history_group: 'shinjang', date: '2026-09-01', prescription: 'F3.0(신장분사DC)' },
    ];
    const combined = buildPatientHistoryLogGroups({
      logs,
      selectedTreatmentGroups: ['shockwave', 'manual', 'shinjang'],
    });
    assert.equal(combined.length, 1);
    assert.equal(combined[0].key, 'all');
    assert.deepEqual(combined[0].logs.map((log) => log.id), [
      'shockwave',
      'manual',
      'shinjang',
    ]);

    const split = buildPatientHistoryLogGroups({
      logs,
      selectedGroupKey: 'manual',
      selectedTreatmentGroups: ['shockwave', 'manual'],
    });
    assert.deepEqual(split.map((group) => group.key), ['manual', 'shockwave']);

    const shinjangOnly = buildPatientHistoryLogGroups({
      logs,
      selectedTreatmentGroups: ['shinjang'],
    });
    assert.deepEqual(shinjangOnly.map((group) => group.key), ['shinjang']);
    assert.deepEqual(shinjangOnly[0].logs.map((log) => log.id), ['shinjang']);
  });

  it('sorts selected history rows by prescription or body while keeping recent rows first within a label', () => {
    const logs = [
      { id: 'b-new', history_group: 'shockwave', date: '2026-09-03', prescription: 'B', body_part: 'Shoulder' },
      { id: 'a-old', history_group: 'manual', date: '2026-09-01', prescription: 'A', body_part: 'Knee' },
      { id: 'a-new', history_group: 'shinjang', date: '2026-09-02', prescription: 'A', body_part: 'Lumbar' },
    ];
    const build = (sortOrder) => buildPatientHistoryLogGroups({
      logs,
      selectedTreatmentGroups: ['shockwave', 'manual', 'shinjang'],
      sortOrder,
    })[0].logs.map((log) => log.id);

    assert.deepEqual(build('prescription'), ['a-new', 'a-old', 'b-new']);
    assert.deepEqual(build('body'), ['a-old', 'a-new', 'b-new']);
  });

  it('tracks treatment filter counts and never lets the final treatment be unchecked', () => {
    const options = buildPatientHistoryTreatmentFilterOptions([
      { history_group: 'shockwave' },
      { history_group: 'shinjang' },
      { history_group: 'shinjang' },
    ]);
    assert.deepEqual(options.map(({ key, count }) => [key, count]), [
      ['shockwave', 1],
      ['manual', 0],
      ['shinjang', 2],
    ]);
    assert.deepEqual(
      togglePatientHistoryTreatmentSelection(['shockwave', 'manual', 'shinjang'], 'manual'),
      ['shockwave', 'shinjang']
    );
    assert.deepEqual(
      togglePatientHistoryTreatmentSelection(['shinjang'], 'shinjang'),
      ['shinjang']
    );
  });

  it('filters by body and prescription together and recalculates both option counts', () => {
    const groups = buildPatientHistoryLogGroups({
      selectedGroupKey: 'manual',
      bodyFilters: { manual: 'shoulder' },
      prescriptionFilters: { manual: '40분' },
      logs: [
        { id: 'manual-1', history_group: 'manual', body_part: 'Shoulder', prescription: '40분' },
        { id: 'manual-2', history_group: 'manual', body_part: 'Shoulder', prescription: '60분' },
        { id: 'manual-3', history_group: 'manual', body_part: 'Lumbar', prescription: '40분' },
        { id: 'manual-4', history_group: 'manual', body_part: 'Lumbar', prescription: '30분' },
        { id: 'manual-5', history_group: 'manual', body_part: '', prescription: '' },
      ],
    });

    assert.deepEqual(groups[0].logs.map((log) => log.id), ['manual-1']);
    assert.deepEqual(groups[0].activeBodyFilters, ['shoulder']);
    assert.deepEqual(groups[0].activePrescriptionFilters, ['40분']);
    assert.deepEqual(
      groups[0].bodyFilterOptions.map(({ label, count }) => [label, count]),
      [
        ['전체', 2],
        ['Shoulder', 1],
        ['Lumbar', 1],
        ['부위 없음', 0],
      ]
    );
    assert.deepEqual(
      groups[0].prescriptionFilterOptions.map(({ label, count }) => [label, count]),
      [
        ['전체', 2],
        ['40분', 1],
        ['60분', 1],
        ['30분', 0],
        ['처방 없음', 0],
      ]
    );
  });

  it('combines checked values within each filter and intersects body with prescription', () => {
    const groups = buildPatientHistoryLogGroups({
      selectedGroupKey: 'manual',
      bodyFilters: { manual: ['shoulder', 'lumbar'] },
      prescriptionFilters: { manual: ['40분', '60분'] },
      logs: [
        { id: 'manual-1', history_group: 'manual', body_part: 'Shoulder', prescription: '40분' },
        { id: 'manual-2', history_group: 'manual', body_part: 'Shoulder', prescription: '60분' },
        { id: 'manual-3', history_group: 'manual', body_part: 'Lumbar', prescription: '40분' },
        { id: 'manual-4', history_group: 'manual', body_part: 'Lumbar', prescription: '30분' },
        { id: 'manual-5', history_group: 'manual', body_part: 'Knee', prescription: '40분' },
      ],
    });

    assert.deepEqual(groups[0].logs.map((log) => log.id), [
      'manual-1',
      'manual-2',
      'manual-3',
    ]);
    assert.deepEqual(groups[0].activeBodyFilters, ['shoulder', 'lumbar']);
    assert.deepEqual(groups[0].activePrescriptionFilters, ['40분', '60분']);
    assert.deepEqual(
      groups[0].bodyFilterOptions.map(({ label, count }) => [label, count]),
      [
        ['전체', 4],
        ['Shoulder', 2],
        ['Lumbar', 1],
        ['Knee', 1],
      ]
    );
    assert.deepEqual(
      groups[0].prescriptionFilterOptions.map(({ label, count }) => [label, count]),
      [
        ['전체', 4],
        ['40분', 2],
        ['60분', 1],
        ['30분', 1],
      ]
    );
  });

  it('orders body and prescription checkbox options by their newest history date', () => {
    const groups = buildPatientHistoryLogGroups({
      selectedGroupKey: 'manual',
      logs: [
        { id: 'older', date: '2026-05-10', history_group: 'manual', body_part: 'Shoulder', prescription: '40분' },
        { id: 'newer', date: '2026-08-10', history_group: 'manual', body_part: 'Knee', prescription: '60분' },
        { id: 'middle', date: '2026-07-10', history_group: 'manual', body_part: 'Lumbar', prescription: '30분' },
        { id: 'newest', date: '2026-09-10', history_group: 'manual', body_part: 'Shoulder', prescription: '40분' },
      ],
    });

    assert.deepEqual(
      groups[0].bodyFilterOptions.map(({ label }) => label),
      ['전체', 'Shoulder', 'Knee', 'Lumbar']
    );
    assert.deepEqual(
      groups[0].prescriptionFilterOptions.map(({ label }) => label),
      ['전체', '40분', '60분', '30분']
    );
  });

  it('groups legacy spaced and compact preset labels into one body filter', () => {
    const groups = buildPatientHistoryLogGroups({
      selectedGroupKey: 'shockwave',
      logs: [
        { id: 'legacy', date: '2026-08-10', history_group: 'shockwave', body_part: 'Rt. 석회성 건염(M6521)' },
        { id: 'compact', date: '2026-08-11', history_group: 'shockwave', body_part: 'Rt. 석회성건염(M6521)' },
      ],
    });

    assert.deepEqual(
      groups[0].bodyFilterOptions.map(({ label, count }) => [label, count]),
      [['전체', 2], ['Rt. 석회성건염(M6521)', 2]]
    );
  });

  it('toggles checkbox selections and uses all as a reset', () => {
    assert.deepEqual(togglePatientHistoryFilterSelection(undefined, 'shoulder'), ['shoulder']);
    assert.deepEqual(togglePatientHistoryFilterSelection(['shoulder'], 'lumbar'), ['shoulder', 'lumbar']);
    assert.deepEqual(togglePatientHistoryFilterSelection(['shoulder', 'lumbar'], 'shoulder'), ['lumbar']);
    assert.deepEqual(togglePatientHistoryFilterSelection(['lumbar'], '__all__'), []);
  });

  it('allocates more filter width to the section with more option content', () => {
    const bodyWeight = getPatientHistoryFilterWidthWeight([
      { label: '전체', count: 3 },
      { label: '어깨', count: 3 },
    ]);
    const prescriptionWeight = getPatientHistoryFilterWidthWeight([
      { label: '전체', count: 3 },
      { label: 'F2.5', count: 1 },
      { label: 'F2.5(본인)', count: 1 },
      { label: 'F3.0', count: 1 },
    ]);

    assert.ok(prescriptionWeight > bodyWeight);
    assert.equal(getPatientHistoryFilterWidthWeight([]), 1);
  });

  it('returns stable modal sizing for single and split layouts', () => {
    assert.equal(getPatientHistoryModalLayout(1).maxWidth, 800);
    assert.equal(getPatientHistoryModalLayout(1).width, '85%');
    assert.equal(getPatientHistoryModalLayout(2).maxWidth, 1574);
    assert.equal(getPatientHistoryModalLayout(2).width, '100%');
    const combinedLayout = getPatientHistoryModalLayout([{ key: 'all' }]);
    const shinjangLayout = getPatientHistoryModalLayout([{ key: 'shinjang' }]);
    assert.equal(combinedLayout.maxWidth, 890);
    assert.equal(combinedLayout.width, '95%');
    assert.equal(shinjangLayout.maxWidth, 819);
    assert.equal(shinjangLayout.width, '85%');
    const columnWidths = getPatientHistoryColumnWidths(1);
    const combinedColumnWidths = getPatientHistoryColumnWidths(1, true);
    const shinjangColumnWidths = getPatientHistoryColumnWidths(1, false, 'shinjang');
    assert.ok(
      Math.abs(
        columnWidths
          .reduce((sum, width) => sum + Number.parseFloat(width), 0) - 100
      ) < 0.0001
    );
    assert.deepEqual(
      getPatientHistoryColumnWidths(2),
      getPatientHistoryColumnWidths(1)
    );
    assert.equal(combinedColumnWidths.length, columnWidths.length + 1);
    assert.ok(
      Math.abs(
        combinedColumnWidths
          .reduce((sum, width) => sum + Number.parseFloat(width), 0) - 100
      ) < 0.0001
    );

    const projectedWidths = columnWidths
      .map((width) => (Number.parseFloat(width) / 100) * getPatientHistoryModalLayout(1).maxWidth);
    const combinedProjectedWidths = combinedColumnWidths
      .map((width) => (Number.parseFloat(width) / 100) * combinedLayout.maxWidth);
    assert.ok(projectedWidths[1] >= (735 * 0.114) * 1.15);
    assert.ok(projectedWidths[2] >= 735 * 0.078);
    assert.ok(projectedWidths[3] >= (770 * 0.108) * 1.1);
    assert.ok(projectedWidths[5] >= (780 * 0.2183) * 1.1);
    assert.ok(projectedWidths[7] >= 735 * 0.069);
    assert.ok(projectedWidths[8] >= (780 * 0.0363) * 1.1);
    assert.ok(projectedWidths[8] < (780 * 0.0363) * 1.11);
    assert.ok(combinedProjectedWidths[4] >= projectedWidths[3] * 1.319);
    assert.ok(combinedProjectedWidths[4] <= projectedWidths[3] * 1.321);
    assert.ok(Math.abs(combinedProjectedWidths[2] - projectedWidths[1]) < 0.2);

    const shinjangProjectedWidths = shinjangColumnWidths.map(
      (width) => (Number.parseFloat(width) / 100) * shinjangLayout.maxWidth
    );
    assert.ok(shinjangProjectedWidths[3] >= projectedWidths[3] * 1.19);
    assert.ok(shinjangProjectedWidths[3] <= projectedWidths[3] * 1.21);
    assert.ok(Math.abs(shinjangProjectedWidths[1] - projectedWidths[1]) < 0.2);
  });

  it('uses each configured prescription color in the patient history list', () => {
    const colorMap = {
      'F2.5': '#2563eb',
      'F2.5(본인)': '#db2777',
    };

    assert.equal(getPatientHistoryPrescriptionColor('F2.5', colorMap), '#2563eb');
    assert.equal(getPatientHistoryPrescriptionColor('F 2.5(본인)', colorMap), '#db2777');
    assert.equal(
      getPatientHistoryPrescriptionColor('색상 미설정', colorMap),
      'var(--text-primary, #1f2937)'
    );
  });

  it('parses a patient-history date into a local schedule navigation target', () => {
    const target = getPatientHistoryScheduleNavigationTarget({
      date: '2026-08-31',
      scheduler_cell_key: '2026:08:1:2:3:4',
    });

    assert.deepEqual(
      { year: target.year, month: target.month, day: target.day },
      { year: 2026, month: 8, day: 31 }
    );
    assert.equal(target.date.getFullYear(), 2026);
    assert.equal(target.date.getMonth(), 7);
    assert.equal(target.date.getDate(), 31);
    assert.deepEqual(target.cell, { w: 1, d: 2, r: 3, c: 4 });
    assert.deepEqual(
      getPatientHistoryScheduleNavigationTarget({
        id: 'draft-2-3-4-5',
        type: 'draft',
        date: '2026-08-31',
        schedule_cell_key: '2-3-4-5',
      })?.cell,
      { w: 2, d: 3, r: 4, c: 5 }
    );
    assert.equal(
      getPatientHistoryScheduleNavigationTarget({
        date: '2026-08-31',
        scheduler_cell_key: '2026:07:1:2:3:4',
      })?.cell,
      null
    );
    assert.equal(getPatientHistoryScheduleNavigationTarget('2026-02-30'), null);
    assert.equal(getPatientHistoryScheduleNavigationTarget('날짜 없음'), null);
  });
});

describe('shockwave hover tooltip model', () => {
  const cellKey = (weekIdx, dayIdx, rowIdx, colIdx) => (
    `${weekIdx}-${dayIdx}-${rowIdx}-${colIdx}`
  );

  it('keeps cell details and memo formatting in the extracted helper', () => {
    const text = buildShockwaveHoverTooltipText({
      hoverCell: {
        weekIdx: 0,
        dayIdx: 1,
        rowIdx: 2,
        colIdx: 0,
        slotInfo: { label: '10:00' },
        staffBlockRule: { keyword: '연차' },
      },
      renderMemos: {
        '0-1-2-0': {
          content: '100/홍길동(2)',
          prescription: 'F2.5',
          body_part: 'Rt. Shoulder',
          merge_span: {
            rowSpan: 2,
            colSpan: 1,
            mergedInto: null,
            meta: { memo_list: ['첫 메모', '둘째 메모'] },
          },
        },
      },
      cellKey,
      getReservationTimeForMemo: () => '10:00',
    });

    assert.equal(
      text,
      [
        '⏱ 10:00',
        '👤 100/홍길동(2)',
        '근무표: 연차',
        '💊 처방: F2.5',
        '🦴 부위: Rt. Shoulder',
        '📝 메모:',
        '  • 첫 메모',
        '  • 둘째 메모',
      ].join('\n')
    );
  });

  it('keeps selected range time and duration formatting', () => {
    const selectedKey = '0-1-2-0';
    const text = buildShockwaveHoverTooltipText({
      hoverCell: {
        weekIdx: 0,
        dayIdx: 1,
        rowIdx: 2,
        colIdx: 0,
        slotInfo: { label: '10:00' },
        selectionInfo: {
          w: 0,
          d: 1,
          minRow: 2,
          maxRow: 3,
        },
      },
      renderMemos: {
        [selectedKey]: { content: '200/김환자(1)' },
      },
      selectedKeys: new Set([selectedKey]),
      cellKey,
      getTimeSlotsForDay: () => [
        { idx: 2, time: '10:00' },
        { idx: 3, time: '10:30' },
      ],
      getReservationTimeForMemo: () => '10:00',
      slotMinutes: 30,
    });

    assert.equal(text, '⏱ 10:00 ~ 11:00 (총 1시간)\n👤 200/김환자(1)');
  });

  it('uses compact preset labels in scheduler cell hover details', () => {
    const text = buildShockwaveHoverTooltipText({
      hoverCell: {
        weekIdx: 0,
        dayIdx: 1,
        rowIdx: 2,
        colIdx: 0,
        slotInfo: { label: '10:00' },
      },
      renderMemos: {
        '0-1-2-0': {
          content: '100/홍길동(2)',
          body_part: 'Rt. 석회성 건염(M6521), 외측 상과염(M771)',
        },
      },
      cellKey,
      getReservationTimeForMemo: () => '10:00',
    });

    assert.match(text, /🦴 부위: Rt\. 석회성건염\(M6521\), 외측상과염\(M771\)/);
  });
});

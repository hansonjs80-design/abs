import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildShockwaveHoverTooltipText,
  buildPatientHistoryLogGroups,
  getPatientHistoryColumnWidths,
  getPatientHistoryModalLayout,
  getPatientHistoryPrescriptionColor,
  togglePatientHistoryFilterSelection,
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

  it('toggles checkbox selections and uses all as a reset', () => {
    assert.deepEqual(togglePatientHistoryFilterSelection(undefined, 'shoulder'), ['shoulder']);
    assert.deepEqual(togglePatientHistoryFilterSelection(['shoulder'], 'lumbar'), ['shoulder', 'lumbar']);
    assert.deepEqual(togglePatientHistoryFilterSelection(['shoulder', 'lumbar'], 'shoulder'), ['lumbar']);
    assert.deepEqual(togglePatientHistoryFilterSelection(['lumbar'], '__all__'), []);
  });

  it('returns stable modal sizing for single and split layouts', () => {
    assert.equal(getPatientHistoryModalLayout(1).maxWidth, 735);
    assert.equal(getPatientHistoryModalLayout(2).maxWidth, 1446);
    assert.equal(getPatientHistoryModalLayout(2).width, '96%');
    assert.deepEqual(
      getPatientHistoryColumnWidths(1),
      ['4.5%', '10.8%', '7.3%', '9.1%', '28.9%', '23.1%', '5.7%', '6.5%', '4.1%']
    );
    assert.ok(
      Math.abs(
        getPatientHistoryColumnWidths(1)
          .reduce((sum, width) => sum + Number.parseFloat(width), 0) - 100
      ) < 0.0001
    );
    assert.deepEqual(
      getPatientHistoryColumnWidths(2),
      getPatientHistoryColumnWidths(1)
    );
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
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildShockwaveHoverTooltipText,
  buildPatientHistoryLogGroups,
  getPatientHistoryColumnWidths,
  getPatientHistoryModalLayout,
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
    assert.equal(groups[0].activeBodyFilter, 'shoulder');
    assert.equal(groups[0].activePrescriptionFilter, '40분');
    assert.deepEqual(
      groups[0].bodyFilterOptions.map(({ label, count }) => [label, count]),
      [
        ['전체', 2],
        ['부위 없음', 0],
        ['Lumbar', 1],
        ['Shoulder', 1],
      ]
    );
    assert.deepEqual(
      groups[0].prescriptionFilterOptions.map(({ label, count }) => [label, count]),
      [
        ['전체', 2],
        ['30분', 0],
        ['40분', 1],
        ['60분', 1],
        ['처방 없음', 0],
      ]
    );
  });

  it('returns stable modal sizing for single and split layouts', () => {
    assert.equal(getPatientHistoryModalLayout(1).maxWidth, 735);
    assert.equal(getPatientHistoryModalLayout(2).maxWidth, 1446);
    assert.equal(getPatientHistoryModalLayout(2).width, '96%');
    assert.deepEqual(
      getPatientHistoryColumnWidths(1),
      ['13%', '10%', '12%', '25%', '20%', '7%', '8%', '5%']
    );
    assert.deepEqual(
      getPatientHistoryColumnWidths(2),
      getPatientHistoryColumnWidths(1)
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

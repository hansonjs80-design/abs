import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { generateShockwaveCalendar } from '../calendarUtils.js';
import { buildScheduleReservationWarnings, findShinjangReplacement, getNextReservationActionIndex, getReservationWarningReplacement, prepareReservationPayload, resolveReservationWarnings } from '../scheduleReservationWarningUtils.js';

describe('reservation action keyboard navigation', () => {
  it('moves left and right and wraps at either end', () => {
    assert.equal(getNextReservationActionIndex([false, false, false], 1, 'ArrowLeft'), 0);
    assert.equal(getNextReservationActionIndex([false, false, false], 1, 'ArrowRight'), 2);
    assert.equal(getNextReservationActionIndex([false, false, false], 2, 'ArrowRight'), 0);
    assert.equal(getNextReservationActionIndex([false, false, false], 0, 'ArrowLeft'), 2);
  });
  it('skips disabled buttons and leaves Enter, Tab and Escape to their native handlers', () => {
    assert.equal(getNextReservationActionIndex([false, false, true], 1, 'ArrowRight'), 0);
    assert.equal(getNextReservationActionIndex([false, false, true], 0, 'ArrowLeft'), 1);
    assert.equal(getNextReservationActionIndex([true, true, true], 0, 'ArrowRight'), -1);
    for (const key of ['Enter', 'Tab', 'Escape']) assert.equal(getNextReservationActionIndex([false, false, false], 1, key), -1);
  });
});

describe('manual warning default replacement', () => {
  it('uses the registered shinjang 1 prescription for both manual warnings', () => {
    for (const type of ['manual-week-limit', 'manual-visit-limit']) {
      for (const name of ['신장분사1', '신장분사 1']) {
        const request = { type, prescription: '30분', prescriptions: { shinjangSpray: ['신장분사2', '신장분사1.0', name] } };
        assert.equal(getReservationWarningReplacement(request), name);
        assert.equal(getReservationWarningReplacement(request, '60분'), '60분');
      }
    }
  });
  it('does not substitute an unregistered or ambiguous prescription', () => {
    assert.equal(getReservationWarningReplacement({ type: 'manual-week-limit', prescription: '30분' }), '');
    assert.equal(getReservationWarningReplacement({ type: 'manual-week-limit', prescriptions: { shinjangSpray: ['신장분사1', '신장분사 1'] } }), '');
  });
  it('preserves the existing shockwave replacement', () => {
    assert.equal(getReservationWarningReplacement({ type: 'shockwave-interval', prescription: 'F2.5', replacement: '신장분사2.5' }), '신장분사2.5');
  });
  it('passes shinjang 1 through the existing reservation payload flow', async () => {
    const payload = [{ content: '1001/가상환자(6)', prescription: '30분' }];
    const result = await prepareReservationPayload(payload, () => getReservationWarningReplacement({ type: 'manual-week-limit', prescriptions: { shinjangSpray: ['신장분사 1'] } }));
    assert.equal(result[0].prescription, '신장분사 1');
    assert.equal(payload[0].prescription, '30분');
  });
});

describe('reservation warning prescription changes', () => {
  const getWarnings = (prescription) => prescription === '충격파'
    ? [{ type: 'shockwave-interval', message: '7일 미경과' }, { type: 'shockwave-visit-limit', message: '7회차' }]
    : prescription === '도수치료' ? [{ type: 'manual-week-limit', message: '주 2일 초과' }] : [];
  it('rechecks the selected treatment and permits shinjang without the obsolete shockwave warning', async () => {
    let calls = 0;
    assert.equal(await resolveReservationWarnings({ prescription: '충격파', getWarnings, ask: async () => { calls++; return '신장분사'; } }), '신장분사');
    assert.equal(calls, 1);
  });
  it('cancels if the user declines a warning for the newly selected manual prescription', async () => {
    const shown = [];
    const answer = await resolveReservationWarnings({ prescription: '충격파', getWarnings, ask: async (warning) => {
      shown.push(warning.type);
      return shown.length === 1 ? '도수치료' : false;
    } });
    assert.equal(answer, false);
    assert.deepEqual(shown, ['shockwave-interval', 'manual-week-limit']);
  });
  it('confirms each warning once when keeping the current prescription', async () => {
    let count = 0;
    assert.equal(await resolveReservationWarnings({ prescription: '충격파', getWarnings, ask: async () => { count++; return true; } }), true);
    assert.equal(count, 2);
  });
});

describe('shinjang replacement selection', () => {
  it('matches decimal doses including self-pay shockwave prescriptions', () => {
    for (const source of ['충격파2.5', 'F2.5', '2.5(본인)', 'F2.5(본인)']) {
      assert.equal(findShinjangReplacement(source, ['신장분사2', '신장분사2.5', '신장분사3.0']), '신장분사2.5');
      assert.equal(findShinjangReplacement(source, ['F2.5(신장분사)']), 'F2.5(신장분사)');
    }
    assert.equal(findShinjangReplacement('F3.0', ['신장분사3']), '신장분사3');
    assert.equal(findShinjangReplacement('F3.0(본인)', ['신장분사3.0', '신장분사3.0 DC']), '신장분사3.0');
    assert.equal(findShinjangReplacement('F3.0 DC', ['신장분사3.0', '신장분사3.0 DC']), '신장분사3.0 DC');
  });
  it('does not guess missing, ambiguous or nonnumeric prescriptions', () => {
    assert.equal(findShinjangReplacement('F2.5', ['신장분사2', '신장분사3']), '');
    assert.equal(findShinjangReplacement('F2.5', ['신장분사2.5', 'F2.5(신장분사)']), '');
    assert.equal(findShinjangReplacement('F/R', ['신장분사2.5']), '');
  });
});

describe('reservation payload confirmation', () => {
  const source = { content: '', prescription: '', week_index: 1, day_index: 0, row_index: 0, col_index: 0 };
  const destination = { content: '1001/김환자(7)', prescription: 'F2.5', week_index: 1, day_index: 2, row_index: 0, col_index: 0 };
  it('cancels the whole cut-and-paste batch before any source deletion', async () => {
    const payload = [source, destination];
    let calls = 0;
    const result = await prepareReservationPayload(payload, async (row, batch) => {
      calls++;
      assert.equal(row.content, destination.content);
      assert.equal(batch[0].content, '');
      return false;
    });
    assert.equal(result, null);
    assert.equal(calls, 1);
    assert.equal(payload[1].prescription, 'F2.5');
  });
  it('applies the selected prescription to clipboard and history payloads without changing patient content', async () => {
    for (const payload of [[destination], [source, destination]]) {
      const result = await prepareReservationPayload(payload, async () => '신장분사2.5');
      assert.equal(result.at(-1).prescription, '신장분사2.5');
      assert.equal(result.at(-1).content, destination.content);
      assert.equal(destination.prescription, 'F2.5');
    }
  });
});

const settings = {
  monthly_settlement_settings: {
    '2026-09': {
      shockwave: { prescriptions: ['충격파 A', '충격파 B'] },
      manual_therapy: { prescriptions: ['도수치료'] },
      shinjang_spray: { prescriptions: [] },
    },
  },
};

function findDateCell(dateKey) {
  const weeks = generateShockwaveCalendar(2026, 9);
  for (let weekIndex = 0; weekIndex < weeks.length; weekIndex += 1) {
    const dayIndex = weeks[weekIndex].findIndex((day) => (
      `${day.year}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}` === dateKey
    ));
    if (dayIndex >= 0) return { weekIndex, dayIndex };
  }
  throw new Error(`Missing date cell: ${dateKey}`);
}

function scheduleRow({ date, content, prescription, rowIndex = 0 }) {
  const { weekIndex, dayIndex } = findDateCell(date);
  return {
    year: 2026,
    month: 9,
    week_index: weekIndex,
    day_index: dayIndex,
    row_index: rowIndex,
    col_index: 0,
    content,
    prescription,
  };
}

function target({ date, content, prescription }) {
  return {
    ...scheduleRow({ date, content, prescription, rowIndex: 9 }),
    date,
  };
}

describe('schedule reservation warnings', () => {
  it('warns only on the third manual-therapy booking for the same chart number and name in one week', () => {
    const result = buildScheduleReservationWarnings({
      target: target({ date: '2026-09-09', content: '1001/김환자(3)', prescription: '도수치료' }),
      scheduleRows: [
        scheduleRow({ date: '2026-09-07', content: '1001/김환자(1)', prescription: '도수치료' }),
        scheduleRow({ date: '2026-09-08', content: '1001/김환자(2)', prescription: '도수치료' }),
        scheduleRow({ date: '2026-09-08', content: '1001/다른이름(2)', prescription: '도수치료', rowIndex: 2 }),
      ],
      settings,
      year: 2026,
      month: 9,
    });

    assert.deepEqual(result.map((item) => item.type), ['manual-week-limit']);
    assert.equal(result[0].message, '한 주에 2일을 초과해 예약할 수 없습니다. 그래도 예약하시겠습니까?');
  });

  it('warns when a shockwave appointment is less than seven days after the previous appointment', () => {
    const result = buildScheduleReservationWarnings({
      target: target({ date: '2026-09-12', content: '1001/김환자(2)', prescription: '충격파 B' }),
      scheduleRows: [
        scheduleRow({ date: '2026-09-07', content: '1001/김환자(1)', prescription: '충격파 A' }),
      ],
      settings,
      year: 2026,
      month: 9,
    });

    assert.deepEqual(result.map((item) => item.type), ['shockwave-interval']);
  });

  it('warns from the sixteenth manual-therapy visit onward', () => {
    const result = buildScheduleReservationWarnings({
      target: target({ date: '2026-09-14', content: '1001/김환자(99)', prescription: '도수치료' }),
      scheduleRows: Array.from({ length: 15 }, (_, rowIndex) => scheduleRow({ date: '2026-09-01', content: '1001/김환자(1)', prescription: '도수치료', rowIndex })),
      settings,
      year: 2026,
      month: 9,
    });

    assert.deepEqual(result.map(({ type, message }) => ({ type, message })), [{
      type: 'manual-visit-limit',
      message: '도수치료 16회차째 입니다. 그래도 예약하시겠습니까?',
    }]);
  });

  it('allows shockwave booking exactly seven days later and separately warns at visit seven', () => {
    const result = buildScheduleReservationWarnings({
      target: target({ date: '2026-09-14', content: '1001/김환자(7)', prescription: '충격파 A' }),
      scheduleRows: [
        ...Array.from({ length: 6 }, (_, rowIndex) => scheduleRow({ date: '2026-09-07', content: '1001/김환자(1)', prescription: '충격파 B', rowIndex })),
      ],
      settings,
      year: 2026,
      month: 9,
    });

    assert.deepEqual(result.map((item) => item.type), ['shockwave-visit-limit']);
    assert.equal(result[0].insuranceUsage.count, 7);
  });
  it('does not infer insurance usage from the editable visit suffix', () => {
    const result = buildScheduleReservationWarnings({ target: target({ date: '2026-09-14', content: '1001/김환자(99)', prescription: '도수치료' }), settings, year: 2026, month: 9 });
    assert.deepEqual(result, []);
  });
});

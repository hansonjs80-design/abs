import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHolidayUpdateRequest,
  getHolidayEditDraft,
} from '../holidaySettingsUtils.js';

test('builds an editable holiday draft from a stored row', () => {
  assert.deepEqual(getHolidayEditDraft({
    id: 'holiday-1',
    date: '2026-08-15T00:00:00.000Z',
    name: '광복절',
  }), {
    id: 'holiday-1',
    date: '2026-08-15',
    name: '광복절',
  });
});

test('builds a normalized holiday update request', () => {
  assert.deepEqual(buildHolidayUpdateRequest({
    id: 'holiday-1',
    date: '2026-08-16',
    name: '  대체공휴일  ',
  }, []), {
    ok: true,
    id: 'holiday-1',
    payload: {
      date: '2026-08-16',
      name: '대체공휴일',
    },
  });
});

test('rejects a duplicate holiday date without changing the existing row', () => {
  assert.deepEqual(buildHolidayUpdateRequest({
    id: 'holiday-1',
    date: '2026-08-15',
    name: '수정',
  }, [
    { id: 'holiday-1', date: '2026-08-14' },
    { id: 'holiday-2', date: '2026-08-15' },
  ]), {
    ok: false,
    message: '같은 날짜의 공휴일이 이미 등록되어 있습니다.',
  });
});

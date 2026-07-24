import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildShockwavePatientHistoryIndex,
  findLatestPatientHistoryLog,
} from '../shockwavePatientHistoryIndex.js';

describe('shockwave patient history index', () => {
  it('finds the latest matching patient without repeatedly sorting all logs', () => {
    const older = {
      id: 'older',
      date: '2026-07-01',
      patient_name: '홍길동',
      visit_count: '8',
    };
    const latest = {
      id: 'latest',
      date: '2026-07-20',
      patient_name: '홍길동*',
      visit_count: '2',
    };
    const index = buildShockwavePatientHistoryIndex([older, latest]);

    assert.equal(index.latestDate, '2026-07-20');
    assert.equal(findLatestPatientHistoryLog(index, '홍길동', null)?.id, 'latest');
  });

  it('uses visit count as the tie breaker and can exclude the edited row', () => {
    const lowerVisit = {
      id: 'lower',
      date: '2026-07-20',
      patient_name: '김환자',
      visit_count: '2',
    };
    const higherVisit = {
      id: 'higher',
      date: '2026-07-20',
      patient_name: '김환자',
      visit_count: '7',
    };
    const index = buildShockwavePatientHistoryIndex([lowerVisit, higherVisit]);

    assert.equal(findLatestPatientHistoryLog(index, '김환자', null)?.id, 'higher');
    assert.equal(findLatestPatientHistoryLog(index, '김환자', 'higher')?.id, 'lower');
  });
});

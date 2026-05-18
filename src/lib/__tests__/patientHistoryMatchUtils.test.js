import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getPastLogsForPatient,
  isSameHistoryPatient,
  sortPastLogsLatestFirst,
} from '../patientHistoryMatchUtils.js';

describe('patient history matching for schedule stats sync', () => {
  it('uses chart number before patient name when chart is available', () => {
    const current = { chart_number: '577', patient_name: '이승윤' };

    assert.equal(isSameHistoryPatient(current, { chart_number: '34234', patient_name: '이승윤' }), false);
    assert.equal(isSameHistoryPatient(current, { chart_number: '577', patient_name: '이승윤40' }), true);
  });

  it('falls back to cleaned patient name only when chart number is missing', () => {
    const current = { chart_number: '', patient_name: '김보람*' };

    assert.equal(isSameHistoryPatient(current, { chart_number: '14634', patient_name: '김보람' }), true);
    assert.equal(isSameHistoryPatient(current, { chart_number: '232', patient_name: '다른이름' }), false);
  });

  it('excludes same-day rows and sorts older logs latest first', () => {
    const current = { chart_number: '14402', patient_name: '서동환' };
    const logs = getPastLogsForPatient(current, [
      { chart_number: '14402', patient_name: '서동환', visit_count: '3', date: '2026-05-15' },
      { chart_number: '14402', patient_name: '서동환', visit_count: '4', date: '2026-05-21' },
      { chart_number: '14402', patient_name: '서동환', visit_count: '5', date: '2026-05-22' },
      { chart_number: '99999', patient_name: '서동환', visit_count: '9', date: '2026-05-21' },
    ], '2026-05-22');

    assert.deepEqual(sortPastLogsLatestFirst(logs).map((log) => log.visit_count), ['4', '3']);
  });
});

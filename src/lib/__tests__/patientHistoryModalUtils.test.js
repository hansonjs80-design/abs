import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPatientHistoryCellUpdate,
  getPatientHistorySearchTarget,
  patientHistoryIdentityMatches,
} from '../patientHistoryModalUtils.js';

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

describe('patient history apply payload', () => {
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
});

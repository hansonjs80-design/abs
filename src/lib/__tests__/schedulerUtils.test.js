import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyVisitCountToSchedulerContent,
  buildSchedulerCellDisplay,
  getNonVisitParentheticalSuffix,
  normalizeSchedulerVisitSuffix,
  parseSchedulerPatientIdentity,
} from '../schedulerCellTextUtils.js';

describe('scheduler cell patient parsing', () => {
  it('parses chart number and patient name while ignoring numeric visit suffixes', () => {
    assert.deepEqual(parseSchedulerPatientIdentity('23234/주한솔(2)'), {
      patientChart: '23234',
      patientName: '주한솔',
    });
  });

  it('keeps chart identity separate when only the chart number changes', () => {
    assert.deepEqual(parseSchedulerPatientIdentity('23456/주한솔*'), {
      patientChart: '23456',
      patientName: '주한솔',
    });
  });

  it('treats non-numeric parenthetical text as a note, not a visit suffix', () => {
    assert.deepEqual(parseSchedulerPatientIdentity('3275/손연희(진료후도수)*'), {
      patientChart: '3275',
      patientName: '손연희',
    });
    assert.equal(getNonVisitParentheticalSuffix('3275/손연희(진료후도수)*'), '(진료후도수)');
  });
});

describe('scheduler visit suffix normalization', () => {
  it('collapses repeated numeric visit suffixes to the latest explicit suffix', () => {
    assert.equal(normalizeSchedulerVisitSuffix('23234/주한솔(1)(2)'), '23234/주한솔(2)');
  });

  it('does not remove non-numeric parenthetical notes', () => {
    assert.equal(normalizeSchedulerVisitSuffix('3275/손연희(진료후도수)*'), '3275/손연희(진료후도수)*');
    assert.equal(normalizeSchedulerVisitSuffix('3275/손연희(진료후도수)'), '3275/손연희(진료후도수)');
  });

  it('applies visit counts without removing non-visit parenthetical notes', () => {
    assert.equal(applyVisitCountToSchedulerContent('3275/손연희(진료후도수)', '2'), '3275/손연희(진료후도수)(2)');
    assert.equal(applyVisitCountToSchedulerContent('3275/손연희(진료후도수)*', '2'), '3275/손연희(진료후도수)(2)');
  });
});

describe('scheduler cell display splitting', () => {
  it('splits base text, non-visit note, and visit suffix independently', () => {
    assert.deepEqual(buildSchedulerCellDisplay('3275/손연희(진료후도수)(2)', null), {
      mainText: '3275/손연희(진료후도수)(2)',
      baseText: '3275/손연희',
      noteSuffix: '(진료후도수)',
      visitSuffix: '(2)',
      hasDisplayText: true,
    });
  });

  it('keeps a non-visit note visible even without a visit suffix', () => {
    assert.deepEqual(buildSchedulerCellDisplay('3275/손연희(진료후도수)', null), {
      mainText: '3275/손연희(진료후도수)',
      baseText: '3275/손연희',
      noteSuffix: '(진료후도수)',
      visitSuffix: '',
      hasDisplayText: true,
    });
  });
});

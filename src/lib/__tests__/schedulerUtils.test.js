import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyVisitCountToSchedulerContent,
  buildSchedulerCellDisplay,
  getNonVisitParentheticalSuffix,
  normalizeSchedulerVisitSuffix,
  stepVisitShortcutInputValue,
  stepVisitInputValue,
  parseSchedulerPatientIdentity,
} from '../schedulerCellTextUtils.js';
import { convertKoreanQwertyMistypeToEnglish } from '../keyboardLayoutUtils.js';
import { toProperCase } from '../bodyPartFormatUtils.js';

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

  it('replaces special visit markers with explicit numeric visits', () => {
    assert.equal(applyVisitCountToSchedulerContent('12745/신금란*', '1'), '12745/신금란(1)');
    assert.equal(applyVisitCountToSchedulerContent('12745/신금란(-)', '1'), '12745/신금란(1)');
  });

  it('keeps the shared visit stepper behavior used by non-shortcut flows', () => {
    assert.equal(stepVisitInputValue('*', 1), '2');
    assert.equal(stepVisitInputValue('2', -1), '*');
  });

  it('steps shortcut visit counts through new, first visit, and cancellation markers', () => {
    assert.equal(stepVisitShortcutInputValue('*', 1), '1');
    assert.equal(stepVisitShortcutInputValue('1', 1), '2');
    assert.equal(stepVisitShortcutInputValue('2', -1), '1');
    assert.equal(stepVisitShortcutInputValue('1', -1), '*');
    assert.equal(stepVisitShortcutInputValue('*', -1), '-');
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

describe('keyboard layout normalization for body part shortcuts', () => {
  it('converts Korean keyboard mistypes back to the intended English shortcut keys', () => {
    assert.equal(convertKoreanQwertyMistypeToEnglish('ㅊㅌ'), 'cx');
    assert.equal(convertKoreanQwertyMistypeToEnglish('ㅣㅌ'), 'lx');
    assert.equal(convertKoreanQwertyMistypeToEnglish('ㄱㅅ ㅊㅌ'), 'rt cx');
  });
});

describe('Korean body part normalization', () => {
  it('converts Korean body part names to the standard English labels', () => {
    assert.equal(toProperCase('목'), 'Cervical');
    assert.equal(toProperCase('허리'), 'Lumbar');
    assert.equal(toProperCase('등'), 'Thoracic');
    assert.equal(toProperCase('발'), 'Foot');
    assert.equal(toProperCase('발바닥'), 'Plantar Foot');
    assert.equal(toProperCase('발목'), 'Ankle');
    assert.equal(toProperCase('ank'), 'Ankle');
    assert.equal(toProperCase('손'), 'Hand');
    assert.equal(toProperCase('손목'), 'Wrist');
    assert.equal(toProperCase('w'), 'Wrist');
    assert.equal(toProperCase('무릎'), 'Knee');
    assert.equal(toProperCase('무'), 'Knee');
    assert.equal(toProperCase('k'), 'Knee');
    assert.equal(toProperCase('lt k'), 'Lt. Knee');
    assert.equal(toProperCase('rt k'), 'Rt. Knee');
    assert.equal(toProperCase('b k'), 'Both Knee');
    assert.equal(toProperCase('both k'), 'Both Knee');
    assert.equal(toProperCase('무릎 안쪽'), 'Medial Knee');
    assert.equal(toProperCase('안쪽 무릎'), 'Medial Knee');
    assert.equal(toProperCase('내측 무릎'), 'Medial Knee');
    assert.equal(toProperCase('무릎 내측'), 'Medial Knee');
    assert.equal(toProperCase('무릎 바깥쪽'), 'Lateral Knee');
    assert.equal(toProperCase('바깥쪽 무릎'), 'Lateral Knee');
    assert.equal(toProperCase('외측 무릎'), 'Lateral Knee');
    assert.equal(toProperCase('무릎 외측'), 'Lateral Knee');
    assert.equal(toProperCase('전완'), 'Fore Arm');
    assert.equal(toProperCase('상완'), 'Upper Arm');
    assert.equal(toProperCase('위팔'), 'Upper Arm');
    assert.equal(toProperCase('윗팔'), 'Upper Arm');
    assert.equal(toProperCase('하완'), 'Lower Arm');
    assert.equal(toProperCase('아래 팔'), 'Lower Arm');
    assert.equal(toProperCase('아랫 팔'), 'Lower Arm');
    assert.equal(toProperCase('허벅지'), 'Thigh');
    assert.equal(toProperCase('삼두'), 'Triceps');
    assert.equal(toProperCase('삼두근'), 'Triceps');
    assert.equal(toProperCase('햄스트링'), 'Hamstring');
    assert.equal(toProperCase('햄스'), 'Hamstring');
    assert.equal(toProperCase('팔꿈치'), 'Elbow');
    assert.equal(toProperCase('엘보'), 'Elbow');
    assert.equal(toProperCase('el'), 'Elbow');
    assert.equal(toProperCase('elb'), 'Elbow');
    assert.equal(toProperCase('손가락'), 'Finger');
    assert.equal(toProperCase('엄지'), 'Thumb');
    assert.equal(toProperCase('엄지손가락'), 'Thumb');
    assert.equal(toProperCase('어깨'), 'Shoulder');
    assert.equal(toProperCase('어'), 'Shoulder');
    assert.equal(toProperCase('ㅣㅅ노'), 'Lt. Shoulder');
    assert.equal(toProperCase('ㄱㅅ노'), 'Rt. Shoulder');
    assert.equal(toProperCase('ㅠㅐ소노'), 'Both Shoulder');
    assert.equal(toProperCase('ㅣㅅㅊㅌ'), 'Lt. Cervical');
    assert.equal(toProperCase('ㄱㅅㅊㅌ'), 'Rt. Cervical');
    assert.equal(toProperCase('골반'), 'Pelvis');
    assert.equal(toProperCase('고관절'), 'Hip');
    assert.equal(toProperCase('엉'), 'Hip');
    assert.equal(toProperCase('엉덩이'), 'Hip');
    assert.equal(toProperCase('테니스엘보'), 'Tennis Elbow');
    assert.equal(toProperCase('테니스 엘보'), 'Tennis Elbow');
    assert.equal(toProperCase('골퍼엘보'), 'Golfer\'s Elbow');
    assert.equal(toProperCase('골프 엘보'), 'Golfer\'s Elbow');
    assert.equal(toProperCase('종아리'), 'Calf');
    assert.equal(toProperCase('뒤꿈치'), 'Heel');
  });

  it('converts Korean direction prefixes without mixing Korean and English output', () => {
    assert.equal(toProperCase('왼 목'), 'Lt. Cervical');
    assert.equal(toProperCase('왼쪽 목'), 'Lt. Cervical');
    assert.equal(toProperCase('좌측 목'), 'Lt. Cervical');
    assert.equal(toProperCase('오른 팔꿈치'), 'Rt. Elbow');
    assert.equal(toProperCase('오 팔꿈치'), 'Rt. Elbow');
    assert.equal(toProperCase('오른쪽 팔꿈치'), 'Rt. Elbow');
    assert.equal(toProperCase('우측 팔꿈치'), 'Rt. Elbow');
    assert.equal(toProperCase('우 팔꿈치'), 'Rt. Elbow');
    assert.equal(toProperCase('양 무릎'), 'Both Knee');
    assert.equal(toProperCase('양쪽 무릎'), 'Both Knee');
    assert.equal(toProperCase('왼어'), 'Lt. Shoulder');
    assert.equal(toProperCase('오어'), 'Rt. Shoulder');
    assert.equal(toProperCase('오른 팔꿈치'), 'Rt. Elbow');
    assert.equal(toProperCase('왼 테니스 엘보'), 'Lt. Tennis Elbow');
    assert.equal(toProperCase('양쪽 골반'), 'Both Pelvis');
    assert.equal(toProperCase('우측 엉덩이'), 'Rt. Hip');
  });
});

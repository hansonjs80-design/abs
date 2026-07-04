import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyVisitCountToSchedulerContent,
  buildSchedulerCellDisplay,
  getNonVisitParentheticalSuffix,
  getSchedulerVisitInputValue,
  isOnlySchedulerVisitSuffixChange,
  isStaleNumericVisitRestoreAfterNewPatientAutoFormat,
  markSchedulerContentAsNewPatient,
  normalizeSchedulerVisitSuffix,
  splitSchedulerInlineNote,
  stepVisitShortcutInputValue,
  stepVisitInputValue,
  parseSchedulerPatientIdentity,
} from '../schedulerCellTextUtils.js';
import { convertKoreanQwertyMistypeToEnglish } from '../keyboardLayoutUtils.js';
import { toProperCase } from '../bodyPartFormatUtils.js';
import {
  applyDoseTagToContent,
  getConfiguredDoseTagFromContent,
  normalizeConfiguredDoseTagInContent,
  normalizeDoseTagInput,
  stripDoseTagFromContent,
  updateDoseTagForPrescriptionContent,
} from '../schedulerContentFormat.js';
import {
  readDeletedScheduleDrafts,
  readPendingScheduleDrafts,
  rememberDeletedScheduleDraft,
  rememberPendingScheduleDraft,
  removeDeletedScheduleDraft,
  SHOCKWAVE_DELETED_DRAFTS_KEY,
  SHOCKWAVE_PENDING_DRAFTS_KEY,
} from '../schedulerUtils.js';

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

  it('parses patient identity while ignoring inline scheduler notes', () => {
    assert.deepEqual(parseSchedulerPatientIdentity('13015/한동군(1)o*'), {
      patientChart: '13015',
      patientName: '한동군',
    });
    assert.deepEqual(parseSchedulerPatientIdentity('234/주한솔 진료후 도수'), {
      patientChart: '234',
      patientName: '주한솔',
    });
    assert.deepEqual(parseSchedulerPatientIdentity('주한솔 도수예약'), {
      patientChart: '',
      patientName: '주한솔',
    });
  });

  it('can clear a transient deleted draft marker after a failed delete save', () => {
    const originalWindow = globalThis.window;
    const storage = new Map();
    try {
      globalThis.window = {
        localStorage: {
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, value),
          removeItem: (key) => storage.delete(key),
        },
      };

      rememberDeletedScheduleDraft(2026, 6, '2-5-12-0');
      assert.equal(Object.keys(readDeletedScheduleDrafts()).length, 1);

      removeDeletedScheduleDraft(2026, 6, '2-5-12-0');
      assert.equal(storage.has(SHOCKWAVE_DELETED_DRAFTS_KEY), false);
      assert.deepEqual(readDeletedScheduleDrafts(), {});
    } finally {
      globalThis.window = originalWindow;
    }
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

  it('normalizes x2, x3 suffix to uppercase X2, X3', () => {
    assert.equal(normalizeSchedulerVisitSuffix('홍길동x2'), '홍길동X2');
    assert.equal(normalizeSchedulerVisitSuffix('홍길동 x2'), '홍길동 X2');
    assert.equal(normalizeSchedulerVisitSuffix('홍길동(x2)'), '홍길동(X2)');
    assert.equal(normalizeSchedulerVisitSuffix('홍길동 F1.5 x3'), '홍길동 F1.5 X3');
  });

  it('applies visit counts without removing non-visit parenthetical notes', () => {
    assert.equal(applyVisitCountToSchedulerContent('3275/손연희(진료후도수)', '2'), '3275/손연희(진료후도수)(2)');
    assert.equal(applyVisitCountToSchedulerContent('3275/손연희(진료후도수)*', '2'), '3275/손연희(진료후도수)(2)');
  });

  it('normalizes parenthesized new-patient markers to a bare star', () => {
    assert.equal(normalizeSchedulerVisitSuffix('12745/신금란(*)'), '12745/신금란*');
    assert.equal(applyVisitCountToSchedulerContent('12745/신금란(*)', '*'), '12745/신금란*');
    assert.equal(applyVisitCountToSchedulerContent('12745/신금란(*)', '1'), '12745/신금란(1)');
    assert.deepEqual(parseSchedulerPatientIdentity('12745/신금란(*)'), {
      patientChart: '12745',
      patientName: '신금란',
    });
  });

  it('keeps trailing inline notes separate from visit suffixes', () => {
    assert.equal(getSchedulerVisitInputValue('13015/한동군(1)o*'), '1');
    assert.equal(normalizeSchedulerVisitSuffix('13015/한동군(1)o*'), '13015/한동군(1) o*');
    assert.deepEqual(splitSchedulerInlineNote('234/주한솔 진료후 도수'), {
      baseText: '234/주한솔',
      visitSuffix: '',
      noteText: '진료후 도수',
      hasInlineNote: true,
      noteAfterVisit: false,
    });
    assert.equal(markSchedulerContentAsNewPatient('4566/김은영(3) 도수예약'), '4566/김은영* 도수예약');
    assert.equal(applyVisitCountToSchedulerContent('4566/김은영(3) 도수예약', '4'), '4566/김은영(4) 도수예약');
  });

  it('marks a changed chart patient as a new patient and removes old visit suffixes', () => {
    assert.equal(markSchedulerContentAsNewPatient('4566/김은영(3)'), '4566/김은영*');
    assert.equal(markSchedulerContentAsNewPatient('4566/김은영(*)'), '4566/김은영*');
    assert.equal(markSchedulerContentAsNewPatient('4566/김은영*'), '4566/김은영*');
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

  it('detects direct edits that only change the visit suffix', () => {
    assert.equal(isOnlySchedulerVisitSuffixChange('6281/이지운60(2)', '6281/이지운60(3)'), true);
    assert.equal(isOnlySchedulerVisitSuffixChange('6281/이지운60*', '6281/이지운60(1)'), true);
    assert.equal(isOnlySchedulerVisitSuffixChange('6281/이지운60(-)', '6281/이지운60*'), true);
    assert.equal(isOnlySchedulerVisitSuffixChange('6281/이지운60(2)', '6281/이지운40(2)'), false);
    assert.equal(isOnlySchedulerVisitSuffixChange('6281/이지운60(2)', '6281/이지운60(메모)(2)'), false);
  });

  it('detects stale numeric visit restores after new-patient auto-formatting', () => {
    assert.equal(
      isStaleNumericVisitRestoreAfterNewPatientAutoFormat('4566/김은영*', '4566/김은영(3)', '4566/김은영*'),
      true
    );
    assert.equal(
      isStaleNumericVisitRestoreAfterNewPatientAutoFormat('4566/김은영*', '4566/김은영(3)', ''),
      false
    );
    assert.equal(
      isStaleNumericVisitRestoreAfterNewPatientAutoFormat('4566/김은영(2)', '4566/김은영(3)', '4566/김은영(2)'),
      false
    );
  });
});

describe('manual therapy dose tag formatting', () => {
  it('adds a dose tag before new-patient and visit suffixes', () => {
    assert.equal(applyDoseTagToContent('/김지인*', '40'), '/김지인40*');
    assert.equal(applyDoseTagToContent('234/김지인(2)', '40'), '234/김지인40(2)');
    assert.equal(applyDoseTagToContent('김지인', '40'), '김지인40');
  });

  it('replaces an existing dose tag without removing the visit marker', () => {
    assert.equal(applyDoseTagToContent('/김지인60*', '40'), '/김지인40*');
    assert.equal(applyDoseTagToContent('234/김지인60(2)', '40'), '234/김지인40(2)');
  });

  it('supports text and decimal scheduler cell tags', () => {
    assert.equal(normalizeDoseTagInput(' 1.5 '), '1.5');
    assert.equal(normalizeDoseTagInput('FR-DC'), 'FR-DC');
    assert.equal(normalizeDoseTagInput('F/Rdc'), 'F/Rdc');
    assert.equal(applyDoseTagToContent('234/김지인60(2)', '1.5', '60'), '234/김지인1.5(2)');
    assert.equal(stripDoseTagFromContent('234/김지인1.5(2)', '1.5'), '234/김지인(2)');
    assert.equal(getConfiguredDoseTagFromContent('234/김지인F/Rdc(2)', { 'F/Rdc': 'F/Rdc' }), 'F/Rdc');
    assert.equal(getConfiguredDoseTagFromContent('234/김지인1.5*', { 'F1.5': '1.5' }), '1.5');
  });

  it('normalizes typed tag casing to the configured scheduler tag', () => {
    assert.equal(
      normalizeConfiguredDoseTagInContent('14634/김보람dc(15)', { 도수DC: 'DC' }),
      '14634/김보람DC(15)'
    );
    assert.equal(
      normalizeConfiguredDoseTagInContent('14634/김보람f/rdc*', { 'F/Rdc': 'F/Rdc' }),
      '14634/김보람F/Rdc*'
    );
    assert.equal(stripDoseTagFromContent('14634/김보람dc(15)', 'DC'), '14634/김보람(15)');
  });

  it('updates or removes the existing cell tag when the prescription changes', () => {
    const doseTags = {
      'F2.5': 'E',
      'F3.0': 'S',
      'F2.0': '',
    };

    assert.equal(
      updateDoseTagForPrescriptionContent('14634/김보람E(15)', '', '', doseTags),
      '14634/김보람(15)'
    );
    assert.equal(
      updateDoseTagForPrescriptionContent('14634/김보람E(15)', 'S', '', doseTags),
      '14634/김보람S(15)'
    );
    assert.equal(
      updateDoseTagForPrescriptionContent('14634/김보람60*', '40', '60', doseTags),
      '14634/김보람40*'
    );
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

  it('splits trailing text after visit suffix for wrapped merged cells', () => {
    assert.deepEqual(buildSchedulerCellDisplay('13015/한동군(1)도수예약', null), {
      mainText: '13015/한동군(1)도수예약',
      baseText: '13015/한동군',
      noteSuffix: '도수예약',
      visitSuffix: '(1)',
      noteAfterVisit: true,
      hasDisplayText: true,
    });
  });

  it('splits compact visit notes that include a trailing star as display notes', () => {
    assert.deepEqual(buildSchedulerCellDisplay('13015/한동군(1)o*', null), {
      mainText: '13015/한동군(1)o*',
      baseText: '13015/한동군',
      noteSuffix: 'o*',
      visitSuffix: '(1)',
      noteAfterVisit: true,
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

describe('scheduler pending draft persistence', () => {
  it('marks only failed-save drafts as recoverable', () => {
    const originalWindow = globalThis.window;
    const storage = new Map();
    try {
      globalThis.window = {
        localStorage: {
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, value),
          removeItem: (key) => storage.delete(key),
        },
      };

      rememberPendingScheduleDraft(2026, 6, '2-5-10-0', '14314/정경훈40(6)', { source: 'editing-draft' });
      rememberPendingScheduleDraft(2026, 6, '2-5-11-0', '14314/정경훈40(6)');

      const raw = JSON.parse(storage.get(SHOCKWAVE_PENDING_DRAFTS_KEY));
      assert.equal(raw['2026-06:2-5-10-0'].source, 'editing-draft');
      assert.equal(raw['2026-06:2-5-10-0'].failedSave, false);
      assert.equal(raw['2026-06:2-5-11-0'].source, 'failed-save');
      assert.equal(raw['2026-06:2-5-11-0'].failedSave, true);
      assert.deepEqual(Object.keys(readPendingScheduleDrafts()).sort(), [
        '2026-06:2-5-10-0',
        '2026-06:2-5-11-0',
      ]);
    } finally {
      globalThis.window = originalWindow;
    }
  });
});

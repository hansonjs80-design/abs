import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildBodyPartPresetValue,
  findBodyPartPresetItem,
  findBodyPartPresetItemByValue,
  getBodyPartPresetState,
  replaceBodyPartPreset,
  replaceBodyPartPresetOptions,
} from '../bodyPartPresetUtils.js';

describe('bodyPartPresetUtils', () => {
  const calcificTendinitis = findBodyPartPresetItem('calcific-tendinitis');

  it('formats preset values consistently', () => {
    assert.equal(buildBodyPartPresetValue(calcificTendinitis, 'left'), 'Lt. 석회성 건염(M6521)');
    assert.equal(buildBodyPartPresetValue(calcificTendinitis, 'right'), 'Rt. 석회성 건염(M6521)');
  });

  it('uses the compact lumbar label only in the preset list', () => {
    const lumbarMyofascialPain = findBodyPartPresetItem('lumbar-spine-myofascial-pain');

    assert.equal(lumbarMyofascialPain.displayLabel, '요추/척추부근막통');
    assert.equal(buildBodyPartPresetValue(lumbarMyofascialPain), '요추/척추부 근막통(M79180)');
  });

  it('distinguishes preset-generated values from custom body parts', () => {
    assert.equal(
      findBodyPartPresetItemByValue('Rt. 석회성 건염(M6521)')?.id,
      'calcific-tendinitis'
    );
    assert.equal(findBodyPartPresetItemByValue('사용자 직접 입력 부위'), null);
  });

  it('recognizes diagnosis selection and directions despite spacing and case differences', () => {
    assert.deepEqual(
      getBodyPartPresetState(['lt. 석회성 건염 (m6521)', 'Rt. 석회성 건염(M6521)'], calcificTendinitis),
      { isSelected: true, directions: ['left', 'right'] }
    );
  });

  it('keeps a selected diagnosis without laterality', () => {
    assert.deepEqual(
      replaceBodyPartPreset(
        ['Rt. 석회성 건염(M6521)', 'Lt. 외측 상과염(M771)'],
        calcificTendinitis,
        true,
        []
      ),
      ['Lt. 외측 상과염(M771)', '석회성 건염(M6521)']
    );
  });

  it('updates directions or clears the selected diagnosis without affecting other body parts', () => {
    assert.deepEqual(
      replaceBodyPartPreset(
        ['석회성 건염(M6521)', 'Rt. 족저 근막염(M722)'],
        calcificTendinitis,
        true,
        ['left', 'right']
      ),
      ['Rt. 족저 근막염(M722)', 'Lt. 석회성 건염(M6521)', 'Rt. 석회성 건염(M6521)']
    );
    assert.deepEqual(
      replaceBodyPartPreset(
        ['Lt. 석회성 건염(M6521)', 'Rt. 석회성 건염(M6521)', 'Rt. 족저 근막염(M722)'],
        calcificTendinitis,
        false
      ),
      ['Rt. 족저 근막염(M722)']
    );
  });

  it('removes an unchecked preset from both the selected and lower reusable lists', () => {
    const currentParts = ['Lt. 석회성 건염(M6521)', '사용자 직접 입력 부위'];
    const nextParts = replaceBodyPartPreset(currentParts, calcificTendinitis, false);

    assert.deepEqual(nextParts, ['사용자 직접 입력 부위']);
    assert.deepEqual(
      replaceBodyPartPresetOptions(currentParts, calcificTendinitis, nextParts),
      ['사용자 직접 입력 부위']
    );
  });

  it('replaces a generic preset option with its active laterality', () => {
    assert.deepEqual(
      replaceBodyPartPresetOptions(
        ['석회성 건염(M6521)', 'Rt. 족저 근막염(M722)'],
        calcificTendinitis,
        ['Lt. 석회성 건염(M6521)']
      ),
      ['Rt. 족저 근막염(M722)', 'Lt. 석회성 건염(M6521)']
    );
  });
});

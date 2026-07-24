import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
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

  it('returns stable modal sizing for single and split layouts', () => {
    assert.equal(getPatientHistoryModalLayout(1).maxWidth, 735);
    assert.equal(getPatientHistoryModalLayout(2).maxWidth, 1260);
    assert.equal(getPatientHistoryColumnWidths(1).length, 8);
    assert.equal(getPatientHistoryColumnWidths(2)[0], '16%');
  });
});

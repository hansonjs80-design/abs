import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeManualTherapyLogRow, normalizeManualTherapyLogRows } from '../manualTherapyLogUtils.js';

describe('manual therapy log normalization', () => {
  it('removes an active dose tag from patient names and restores the prescription for counting', () => {
    assert.deepEqual(
      normalizeManualTherapyLogRow(
        {
          patient_name: '한동균40',
          prescription: '',
          prescription_count: null,
        },
        ['40분', '60분']
      ),
      {
        patient_name: '한동균',
        prescription: '40분',
        prescription_count: 1,
      }
    );
  });

  it('keeps the new patient marker while removing a dose tag', () => {
    assert.equal(
      normalizeManualTherapyLogRow(
        { patient_name: '한동균40*', prescription: '' },
        ['40분', '60분']
      ).patient_name,
      '한동균*'
    );
  });

  it('does not revive a removed prescription dose tag', () => {
    const row = { patient_name: '한동균30', prescription: '' };
    assert.deepEqual(normalizeManualTherapyLogRow(row, ['40분', '60분']), row);
  });

  it('uses the current scheduler cell as source of truth when a synced row is stale', () => {
    assert.deepEqual(
      normalizeManualTherapyLogRows(
        [
          {
            patient_name: '한동균40',
            chart_number: '13015',
            visit_count: '32',
            prescription: '',
            prescription_count: null,
            body_part: '',
            scheduler_cell_key: '2026:05:0:4:2:0',
          },
        ],
        ['40분', '60분'],
        {
          year: 2026,
          month: 5,
          memos: {
            '0-4-2-0': {
              content: '13015/한동균40(30)',
              body_part: 'Lumbar',
            },
          },
        }
      ),
      [
        {
          patient_name: '한동균',
          chart_number: '13015',
          visit_count: '30',
          prescription: '40분',
          prescription_count: 1,
          body_part: 'Lumbar',
          scheduler_cell_key: '2026:05:0:4:2:0',
        },
      ]
    );
  });

  it('uses the scheduler cell prescription when the dose is not embedded in the name', () => {
    assert.deepEqual(
      normalizeManualTherapyLogRows(
        [
          {
            patient_name: '한동균',
            chart_number: '13015',
            visit_count: '32',
            prescription: '',
            prescription_count: null,
            body_part: '',
            scheduler_cell_key: '2026:05:0:4:2:0',
          },
        ],
        ['40분', '60분'],
        {
          year: 2026,
          month: 5,
          memos: {
            '0-4-2-0': {
              content: '13015/한동균(30)',
              prescription: '40분',
              body_part: 'Lumbar',
            },
          },
        }
      ),
      [
        {
          patient_name: '한동균',
          chart_number: '13015',
          visit_count: '30',
          prescription: '40분',
          prescription_count: 1,
          body_part: 'Lumbar',
          scheduler_cell_key: '2026:05:0:4:2:0',
        },
      ]
    );
  });
});

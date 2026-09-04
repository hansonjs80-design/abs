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

  it('uses configured dose tags to clean names and keeps new-patient state from the scheduler', () => {
    assert.deepEqual(
      normalizeManualTherapyLogRows(
        [
          {
            patient_name: '주한솔M*',
            chart_number: '12345',
            visit_count: '1',
            prescription: '도수 M',
            prescription_count: 1,
            scheduler_cell_key: '2026:07:0:1:2:0',
          },
        ],
        ['도수 M'],
        {
          year: 2026,
          month: 7,
          settings: {
            prescriptions: ['F/R'],
            manual_therapy_prescriptions: ['도수 M'],
            manual_therapy_dose_tags: { '도수 M': 'M' },
          },
          memos: {
            '0-1-2-0': {
              content: '12345/주한솔M(2)',
              prescription: '도수 M',
            },
          },
        }
      ),
      [
        {
          patient_name: '주한솔',
          chart_number: '12345',
          visit_count: '2',
          prescription: '도수 M',
          prescription_count: 1,
          scheduler_cell_key: '2026:07:0:1:2:0',
          body_part: '',
        },
      ]
    );
  });

  it('excludes stale shockwave rows even when an old log was marked as a new patient', () => {
    assert.deepEqual(
      normalizeManualTherapyLogRows(
        [
          {
            patient_name: '신소망*',
            prescription: 'F/R',
            scheduler_cell_key: '2026:07:0:1:2:0',
          },
        ],
        ['도수 M'],
        {
          year: 2026,
          month: 7,
          settings: {
            prescriptions: ['F/R'],
            manual_therapy_prescriptions: ['도수 M'],
            manual_therapy_dose_tags: { '도수 M': 'M' },
          },
          memos: {
            '0-1-2-0': {
              content: '12345/신소망*',
              prescription: 'F/R',
            },
          },
        }
      ),
      []
    );
  });

  it('excludes a stale scheduler log that is absent from the authoritative visible schedule', () => {
    assert.deepEqual(
      normalizeManualTherapyLogRows(
        [
          {
            patient_name: '김상희',
            prescription: '40분',
            source: 'scheduler',
            scheduler_cell_key: '2026:09:0:3:45:0',
          },
          {
            patient_name: '사용자입력',
            prescription: '40분',
            source: 'manual',
          },
        ],
        ['30분', '40분', '60분'],
        {
          year: 2026,
          month: 9,
          settings: {
            prescriptions: ['F/R'],
            manual_therapy_prescriptions: ['30분', '40분', '60분'],
          },
          memos: {},
          scheduleAuthoritative: true,
        }
      ),
      [
        {
          patient_name: '사용자입력',
          prescription: '40분',
          source: 'manual',
        },
      ]
    );
  });

  it('excludes a scheduler log when the visible schedule cell is no longer completed', () => {
    assert.deepEqual(
      normalizeManualTherapyLogRows(
        [
          {
            patient_name: '한동균',
            prescription: '40분',
            source: 'scheduler',
            scheduler_cell_key: '2026:09:0:3:49:0',
          },
        ],
        ['30분', '40분', '60분'],
        {
          year: 2026,
          month: 9,
          settings: {
            prescriptions: ['F/R'],
            manual_therapy_prescriptions: ['30분', '40분', '60분'],
          },
          memos: {
            '0-3-49-0': {
              content: '13015/한동균40(31)',
              bg_color: null,
              prescription: '40분',
            },
          },
          scheduleAuthoritative: true,
        }
      ),
      []
    );
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { isPTCalendarCountChangeRelevant, subscribePTCalendarCountChanges } from './ptCalendarCountUpdates.js';
import { PT_STAFF_COUNT_SETTINGS_RECORD } from './ptStaffCalendarCounts.js';
import { PT_MANUAL_COUNT_PREFIX } from './ptManualCountOverrides.js';

test('PT count notifications include only displayed dates and their manual overrides or scope settings', () => {
  const relevant = date => isPTCalendarCountChangeRelevant(date, '2026-10-01', '2026-10-31');
  for (const date of ['2026-10-01', '2026-10-31', PT_MANUAL_COUNT_PREFIX + '2026-10-15', PT_STAFF_COUNT_SETTINGS_RECORD]) {
    assert.equal(relevant(date), true);
  }
  for (const date of [undefined, null, {}, '2026-09-30', '2026-11-01', '2026-10-32',
    PT_MANUAL_COUNT_PREFIX + '2026-11-01', '__pt_shared_presets_v1__', '__pt_shared_column_formatting_v1__']) {
    assert.equal(relevant(date), false);
  }
});

test('count displays receive date broadcasts without subscribing to full PT record change payloads', () => {
  const handlers = [], calls = [];
  let subscribed = 0, refreshed = 0;
  const channel = {
    on(type, filter, callback) { calls.push({type,filter}); handlers.push(callback); return this; },
    subscribe() { subscribed++; },
  };
  const returned = subscribePTCalendarCountChanges({channel: () => channel}, '2026-10-01', '2026-10-31', () => refreshed++);
  assert.equal(returned, channel); assert.equal(subscribed, 1);
  assert.equal(calls[0].type, 'broadcast');
  assert.equal(calls.length, 3);
  assert.equal(calls[1].filter.filter, `date=eq.${PT_STAFF_COUNT_SETTINGS_RECORD}`);
  assert.equal(calls[2].filter.filter, `date=gte.${PT_MANUAL_COUNT_PREFIX}2026-10-01`);
  assert.ok('2026-10-10' < PT_MANUAL_COUNT_PREFIX + '2026-10-01', 'daily patient records cannot match the metadata filter');
  handlers[0]({payload:{date:'2026-10-10'}});
  handlers[0]({payload:{date:PT_STAFF_COUNT_SETTINGS_RECORD}});
  handlers[0]({payload:{date:'2026-09-10'}});
  handlers[0]({payload:{date:'__pt_shared_presets_v1__'}});
  handlers[0]();
  handlers[1]({new:{date:PT_STAFF_COUNT_SETTINGS_RECORD}});
  handlers[2]({new:{date:PT_MANUAL_COUNT_PREFIX + '2026-10-10'}});
  handlers[2]({new:{date:PT_MANUAL_COUNT_PREFIX + '2026-11-10'}});
  assert.equal(refreshed, 4);
});

test('count polling can still operate when the client has no realtime channel support', () => {
  assert.equal(subscribePTCalendarCountChanges({}, '2026-10-01', '2026-10-31', () => assert.fail()), null);
});

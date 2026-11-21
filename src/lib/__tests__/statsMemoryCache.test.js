import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, it } from 'node:test';

import {
  createStatsMemoryCache,
  findFreshCoveringRangeEntry,
  sliceDateRecordByRange,
} from '../statsMemoryCache.js';
import {
  clearCArmCache,
  getCachedCArmTemplateEntry,
  getCachedCArmYear,
  setCachedCArmTemplate,
  setCachedCArmYear,
  upsertCachedCArmRow,
} from '../cArmStatsCache.js';

afterEach(() => {
  clearCArmCache();
});

describe('statsMemoryCache utilities', () => {
  it('stores, returns, and expires entries according to ttlMs', () => {
    const cache = createStatsMemoryCache({ ttlMs: 1000 });
    cache.set('2026-11', { logs: [1, 2] }, 10000);
    assert.equal(cache.size(), 1);
    assert.deepEqual(cache.get('2026-11', 10500), { logs: [1, 2] });
    assert.deepEqual(cache.getEntry('2026-11', 11000), { value: { logs: [1, 2] }, updatedAt: 10000 });
    assert.equal(cache.get('2026-11', 11001), null);
    assert.equal(cache.size(), 0);
  });

  it('slices ISO-date-keyed records inclusively by [startDate, endDate]', () => {
    const source = {
      '2026-10-31': 10,
      '2026-11-01': 20,
      '2026-11-15': 30,
      '2026-11-30': 40,
      '2026-12-01': 50,
    };
    assert.deepEqual(sliceDateRecordByRange(source, '2026-11-01', '2026-11-30'), {
      '2026-11-01': 20,
      '2026-11-15': 30,
      '2026-11-30': 40,
    });
    assert.deepEqual(sliceDateRecordByRange(null, '2026-11-01', '2026-11-30'), {});
  });

  it('prefers fresh exact range matches, falls back to freshest covering range, and prunes expired entries', () => {
    const map = new Map();
    map.set('2026-01-01/2026-12-31', {
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      counts: { '2026-11-02': 3 },
      updatedAt: 5000,
    });
    map.set('2026-10-01/2026-11-30', {
      startDate: '2026-10-01',
      endDate: '2026-11-30',
      counts: { '2026-11-02': 5 },
      updatedAt: 9000,
    });
    map.set('2026-11-01/2026-11-30', {
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      counts: { '2026-11-02': 9 },
      updatedAt: 1000, // expired at now=10000 with ttl=4000
    });

    // Exact match is expired -> pruned, freshest covering entry (updatedAt: 9000) wins.
    const foundCovering = findFreshCoveringRangeEntry(map, '2026-11-01', '2026-11-30', 6000, 10000);
    assert.equal(foundCovering.exact, false);
    assert.equal(foundCovering.entry.updatedAt, 9000);
    assert.equal(map.has('2026-11-01/2026-11-30'), false);

    // Non-expired exact match beats newer covering range.
    map.set('2026-11-01/2026-11-30', {
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      counts: { '2026-11-02': 11 },
      updatedAt: 7000,
    });
    const foundExact = findFreshCoveringRangeEntry(map, '2026-11-01', '2026-11-30', 6000, 10000);
    assert.equal(foundExact.exact, true);
    assert.equal(foundExact.entry.counts['2026-11-02'], 11);
  });
});

describe('cArmStatsCache utilities', () => {
  it('distinguishes cached null template from cache miss and maintains sorted year records on save', () => {
    assert.equal(getCachedCArmYear(2026), null);
    assert.equal(getCachedCArmTemplateEntry(2026), null);

    setCachedCArmTemplate(2026, null);
    assert.deepEqual(getCachedCArmTemplateEntry(2026), { template: null });

    setCachedCArmYear(2026, [{ year: 2026, month: 3, revision: 1 }]);
    upsertCachedCArmRow({ year: 2026, month: 1, revision: 1 });
    upsertCachedCArmRow({ year: 2026, month: 3, revision: 2 });

    const records = getCachedCArmYear(2026);
    assert.deepEqual(records.map((r) => [r.month, r.revision]), [[1, 1], [3, 2]]);
    // Template cache clears after any month save so next-year templates stay fresh.
    assert.equal(getCachedCArmTemplateEntry(2026), null);
  });
});

describe('stats tab egress and loading optimizations', () => {
  it('lazy-loads settlement history and prefetches monthly therapists in shockwave, manual, and shinjang stats', async () => {
    const [shockwave, manualPage, manualSix, shinjang] = await Promise.all([
      readFile(new URL('../../components/shockwave/ShockwaveStatsView.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../pages/ManualTherapyStatsPage.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../components/shockwave/ManualTherapySixMonthStats.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../pages/ShinjangSprayStatsPage.jsx', import.meta.url), 'utf8'),
    ]);

    assert.match(shockwave, /if \(activeSection !== 'settlement'\) return;/);
    assert.match(shockwave, /prefetchStatsMonthlyTherapists\(/);
    assert.match(manualPage, /showRecentSummary && activeSection === 'settlement'/);
    assert.match(manualSix, /prefetchStatsMonthlyTherapists\(/);
    assert.match(shinjang, /prefetchStatsMonthlyTherapists\(/);
    assert.match(shinjang, /shinjangCurrentCache\.get\(currentMonthKey\)/);
  });

  it('reuses cached PT counts, skips polling historical PT ranges, and caches C-Arm year queries', async () => {
    const [ptView, ptHook, cArmPage, cArmRecent] = await Promise.all([
      readFile(new URL('../../components/calendar/PhysicalTherapyStatsView.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../hooks/usePTCalendarCounts.js', import.meta.url), 'utf8'),
      readFile(new URL('../../pages/CArmStatsPage.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../components/CArmRecentStats.jsx', import.meta.url), 'utf8'),
    ]);

    assert.match(ptView, /ptStatsYearCache/);
    assert.doesNotMatch(ptView, /loadHolidays\(currentYear, currentMonth, \{ force: true \}\)/);
    assert.match(ptHook, /findFreshCoveringRangeEntry/);
    assert.match(ptHook, /isHistoricalRange \? null : setInterval/);
    assert.match(cArmPage, /getCachedCArmYear/);
    assert.match(cArmPage, /upsertCachedCArmRow/);
    assert.match(cArmRecent, /getCachedCArmYear/);
  });
});

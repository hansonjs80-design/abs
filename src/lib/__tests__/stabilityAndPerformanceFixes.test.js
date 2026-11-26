import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fetchAllPaginatedRows } from '../scheduleStatsSyncUtils.js';
import { hasLegacyAppUserProfileChanged } from '../legacyAppUserAuth.js';
import { createStatsMemoryCache } from '../statsMemoryCache.js';

describe('stability and performance fixes', () => {
  it('fetchAllPaginatedRows fetches <pageSize in a single query and paginates >1000 rows without truncation', async () => {
    let singleCalls = 0;
    const smallResult = await fetchAllPaginatedRows(() => ({
      range(from, to) {
        singleCalls += 1;
        assert.equal(from, 0);
        assert.equal(to, 999);
        return Promise.resolve({
          data: [{ id: 1 }, { id: 2 }, { id: 3 }],
          error: null,
        });
      },
    }));
    assert.equal(singleCalls, 1);
    assert.equal(smallResult.length, 3);

    const totalRows = Array.from({ length: 2350 }, (_, index) => ({ id: index + 1 }));
    const seenRanges = [];
    const pagedResult = await fetchAllPaginatedRows(() => ({
      range(from, to) {
        seenRanges.push([from, to]);
        return Promise.resolve({
          data: totalRows.slice(from, to + 1),
          error: null,
        });
      },
    }), { pageSize: 1000 });

    assert.deepEqual(seenRanges, [
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    assert.equal(pagedResult.length, 2350);
    assert.equal(pagedResult[0].id, 1);
    assert.equal(pagedResult[2349].id, 2350);
  });

  it('fetchAllPaginatedRows throws on Supabase query error and supports non-range query mocks', async () => {
    await assert.rejects(
      () => fetchAllPaginatedRows(() => ({
        range() {
          return Promise.resolve({ data: null, error: new Error('DB read failed') });
        },
      })),
      /DB read failed/
    );

    const fallbackRows = await fetchAllPaginatedRows(() => Promise.resolve({
      data: [{ id: 'mock-1' }],
      error: null,
    }));
    assert.deepEqual(fallbackRows, [{ id: 'mock-1' }]);
  });

  it('hasLegacyAppUserProfileChanged detects permission and display_name updates regardless of key order', () => {
    const baseUser = {
      username: 'staff1',
      app_role: 'user',
      isAdmin: false,
      user_metadata: { name: '김치료' },
      app_permissions: {
        shockwave: true,
        combined_stats: true,
        manual_therapy_stats: false,
      },
    };
    const matchingProfile = {
      username: 'staff1',
      display_name: '김치료',
      role: 'user',
    };

    assert.equal(
      hasLegacyAppUserProfileChanged(baseUser, matchingProfile, {
        manual_therapy_stats: false,
        shockwave: true,
        combined_stats: true,
      }),
      false
    );

    assert.equal(
      hasLegacyAppUserProfileChanged(baseUser, matchingProfile, {
        shockwave: true,
        combined_stats: true,
        manual_therapy_stats: true,
      }),
      true
    );

    assert.equal(
      hasLegacyAppUserProfileChanged(
        baseUser,
        { ...matchingProfile, display_name: '김실장' },
        baseUser.app_permissions
      ),
      true
    );
  });

  it('clears stats memory caches on clinic-stats-cache-invalidate when registered for clinic-stats-updated', () => {
    const listeners = new Map();
    const prevWindow = globalThis.window;
    globalThis.window = {
      addEventListener(eventName, handler) {
        const list = listeners.get(eventName) || [];
        list.push(handler);
        listeners.set(eventName, list);
      },
    };

    try {
      const cache = createStatsMemoryCache({
        ttlMs: 60_000,
        invalidateEvents: ['clinic-stats-updated'],
      });
      cache.set('2026-11', { count: 10 }, 1000);
      assert.deepEqual(cache.get('2026-11', 1500), { count: 10 });

      const invalidateHandlers = listeners.get('clinic-stats-cache-invalidate') || [];
      assert.equal(invalidateHandlers.length, 1);
      invalidateHandlers[0]();
      assert.equal(cache.get('2026-11', 1500), null);
    } finally {
      globalThis.window = prevWindow;
    }
  });

  it('keeps hover decoupled from 5-week schedule grid memoization and coalesces deferred stats syncs', async () => {
    const [
      shockwaveViewSource,
      scheduleContextSource,
      dataGridSource,
      combinedStatsSource,
      shockwaveStatsSource,
      manualStatsSource,
      manualSixMonthSource,
      shinjangStatsSource,
    ] = await Promise.all([
      readFile(new URL('../../components/shockwave/ShockwaveView.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../contexts/ScheduleContext.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../components/shockwave/ShockwaveDataGrid.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../pages/CombinedStatsPage.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../components/shockwave/ShockwaveStatsView.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../pages/ManualTherapyStatsPage.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../components/shockwave/ManualTherapySixMonthStats.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../pages/ShinjangSprayStatsPage.jsx', import.meta.url), 'utf8'),
    ]);

    assert.doesNotMatch(shockwaveViewSource, /hoverCell\?\.rowIdx,\s*hoverCell\?\.weekIdx/);
    assert.match(shockwaveViewSource, /data-default-label=\{slotInfo\.label\}/);
    assert.match(shockwaveViewSource, /data-subslot-labels=\{subSlotLabelsAttr\}/);
    const weeksInitIndex = shockwaveViewSource.indexOf('useScheduleTimeSlots({');
    const activeRowEffectDepsIndex = shockwaveViewSource.indexOf('[hoverCell, selectedCell, editingCell, weeks,');
    assert.ok(
      weeksInitIndex > 0 && activeRowEffectDepsIndex > weeksInitIndex,
      'weeks must be initialized by useScheduleTimeSlots before active-row useEffect dependency array'
    );

    assert.match(scheduleContextSource, /scheduleStatsSyncForDates\(/);
    assert.match(scheduleContextSource, /defer:\s*Boolean\(deferStatsSync\)/);
    assert.match(scheduleContextSource, /addEventListener\('clinic-before-route-change',\s*flushAllPendingStatsSyncs\)/);

    assert.match(dataGridSource, /flat\[i\]\._rowIndex\s*=\s*i/);
    assert.match(dataGridSource, /Failed to apply stats row snapshot:/);

    for (const source of [
      combinedStatsSource,
      shockwaveStatsSource,
      manualStatsSource,
      manualSixMonthSource,
      shinjangStatsSource,
    ]) {
      assert.match(source, /fetchAllPaginatedRows/);
    }
  });
});

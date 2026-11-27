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

  it('keeps Ctrl/Cmd+F patient history modal opening decoupled from grid rebuilds and runs history + insurance lookups in parallel', async () => {
    const [
      shockwaveViewSource,
      patientHistoryActionsSource,
      insuranceUsageHookSource,
      insuranceUsageUtilsSource,
    ] = await Promise.all([
      readFile(new URL('../../components/shockwave/ShockwaveView.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../components/shockwave/usePatientHistoryActions.js', import.meta.url), 'utf8'),
      readFile(new URL('../../components/shockwave/useInsuranceUsage.js', import.meta.url), 'utf8'),
      readFile(new URL('../insuranceUsageUtils.js', import.meta.url), 'utf8'),
    ]);

    // Stable ref-backed handlers prevent patientHistoryModalOpen from rebuilding 2,100 MemoizedCells
    assert.match(shockwaveViewSource, /const cellHandleKeyDown = useCallback\(/);
    assert.match(shockwaveViewSource, /const cellHandleEditKeyDown = useCallback\(/);
    assert.match(shockwaveViewSource, /pendingPatientRow:\s*pendingHistoryPatientRow/);

    // Parallel monthly therapist preload + ScheduleContext cache reuse in Ctrl+F fetch
    assert.match(patientHistoryActionsSource, /preloadMonthlyTherapistTargets\(\[\.\.\.earlyMonthlyTargets\.values\(\)\]\)/);
    assert.match(patientHistoryActionsSource, /requestRevision:\s*requestId/);

    // No 600-query month-wide eager background prefetch loop; uses cached calendar & localRowsByPatient
    assert.doesNotMatch(insuranceUsageHookSource, /while \(active && queue\.length\) await loadPatient/);
    assert.match(insuranceUsageHookSource, /const localRowsByPatient = useMemo\(/);
    assert.match(insuranceUsageUtilsSource, /function getCachedInsuranceCalendar\(/);
  });

  it('loads CombinedStatsPage current month with zero history DB queries, parallel T=0 schedule prefetch, and 100% identical numbers', async (t) => {
    const [
      { supabase },
      { generateShockwaveCalendar },
      { TREATMENT_COMPLETE_BG },
      {
        collectCompletedShockwaveScheduleRowsForMonth,
        syncMonthShockwaveScheduleToStats,
      },
      {
        collectCompletedManualScheduleRowsForMonth,
        syncMonthManualTherapyScheduleToStats,
      },
      { normalizeManualTherapyLogRows },
      { buildCombinedStatsMonthSummary },
      {
        clearStatsScheduleSourceCache,
        prefetchScheduleRowsForStatsMonth,
        prefetchStatsMonthlyTherapists,
      },
      combinedStatsPageSource,
      scheduleContextSource,
    ] = await Promise.all([
      import('../supabaseClient.js'),
      import('../calendarUtils.js'),
      import('../schedulerUtils.js'),
      import('../shockwaveSyncUtils.js'),
      import('../manualTherapyUtils.js'),
      import('../manualTherapyLogUtils.js'),
      import('../combinedStatsUtils.js'),
      import('../statsScheduleSourceUtils.js'),
      readFile(new URL('../../pages/CombinedStatsPage.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../contexts/ScheduleContext.jsx', import.meta.url), 'utf8'),
    ]);

    const weeks = generateShockwaveCalendar(2025, 9);
    const w1 = weeks.findIndex((days) => days.some((d) => d.isCurrentMonth && d.day === 2));
    const d1 = weeks[w1].findIndex((d) => d.isCurrentMonth && d.day === 2);
    const w2 = weeks.findIndex((days) => days.some((d) => d.isCurrentMonth && d.day === 10));
    const d2 = weeks[w2].findIndex((d) => d.isCurrentMonth && d.day === 10);

    const memos = {
      [`${w1}-${d1}-0-0`]: { content: '101/김신환*', prescription: 'F2.5', bg_color: TREATMENT_COMPLETE_BG },
      [`${w1}-${d1}-1-0`]: { content: '102/박재진(3)', prescription: '신장분사 2', bg_color: TREATMENT_COMPLETE_BG },
      [`${w1}-${d1}-2-1`]: { content: '103/이도수40*', prescription: '40분', bg_color: TREATMENT_COMPLETE_BG },
      [`${w2}-${d2}-0-1`]: { content: '104/최도수60(2)', prescription: '60분', bg_color: TREATMENT_COMPLETE_BG },
      [`${w2}-${d2}-1-0`]: { content: '105/정미완(1)', prescription: 'F2.5', bg_color: '#ffffff' },
    };
    const shockwaveTherapists = [{ name: '박치료', slot_index: 0 }, { name: '김도수', slot_index: 1 }];
    const manualTherapists = [{ name: '박치료', slot_index: 0 }, { name: '김도수', slot_index: 1 }];
    const monthlyShockwaveTherapists = [
      { slot_index: 0, therapist_name: '박치료', start_day: 1, end_day: 30 },
      { slot_index: 1, therapist_name: '김도수', start_day: 1, end_day: 30 },
    ];
    const monthlyManualTherapists = [
      { slot_index: 0, therapist_name: '박치료', start_day: 1, end_day: 30 },
      { slot_index: 1, therapist_name: '김도수', start_day: 1, end_day: 30 },
    ];
    const monthlyShinjangTherapists = [
      { slot_index: 0, therapist_name: '신장전담', start_day: 1, end_day: 30 },
    ];
    const settings = {
      prescriptions: ['F2.5', '신장분사 2'],
      manual_therapy_prescriptions: ['40분', '60분'],
      prescription_prices: { 'F2.5': 80000, '신장분사 2': 60000 },
      incentive_percentage: 7,
      manual_therapy_incentive_percentage: 15,
      monthly_settlement_settings: {
        '2025-09': {
          shockwave: {
            prescriptions: ['F2.5'],
            prescription_prices: { 'F2.5': 80000 },
            cryo_prescriptions: ['F2.5'],
            cryo_prices: { 'F2.5': 10000 },
            incentive_percentage: 7,
          },
          manual_therapy: {
            prescriptions: ['40분', '60분'],
            prescription_prices: { '40분': 100000, '60분': 150000 },
            incentive_percentage: 15,
          },
          shinjang_spray: {
            prescriptions: ['신장분사 2'],
            prescription_prices: { '신장분사 2': 60000 },
            cryo_prescriptions: ['신장분사 2'],
            cryo_prices: { '신장분사 2': 5000 },
            prescription_incentive_percentages: { '신장분사 2': 15 },
          },
        },
      },
    };

    let legacyQueries = 0;
    const fromMock = t.mock.method(supabase, 'from', (tableName) => {
      legacyQueries += 1;
      const historicalData = tableName === 'shockwave_patient_logs'
        ? [{ date: '2025-08-15', patient_name: '박재진', chart_number: '102', visit_count: '2', body_part: 'Rt Shoulder' }]
        : [];
      const query = {
        then: (resolve, reject) => Promise.resolve({ data: historicalData, error: null }).then(resolve, reject),
      };
      for (const method of ['select', 'eq', 'in', 'lt', 'gte', 'lte', 'range', 'order', 'or']) {
        query[method] = () => query;
      }
      return query;
    });

    const [legacySw, legacyMt] = await Promise.all([
      syncMonthShockwaveScheduleToStats({
        year: 2025,
        month: 9,
        memos,
        therapists: shockwaveTherapists,
        monthlyTherapists: monthlyShockwaveTherapists,
        settings,
        upToToday: true,
        scheduleAuthoritative: true,
        emitEvent: false,
        collectOnly: true,
      }),
      syncMonthManualTherapyScheduleToStats({
        year: 2025,
        month: 9,
        memos,
        therapists: manualTherapists,
        monthlyTherapists: monthlyManualTherapists,
        settings,
        upToToday: true,
        scheduleAuthoritative: true,
        emitEvent: false,
        collectOnly: true,
      }),
    ]);
    assert.ok(legacyQueries >= 8);

    let zeroQueryCount = 0;
    fromMock.mock.mockImplementation(() => {
      zeroQueryCount += 1;
      throw new Error('Zero-query collector must not touch Supabase');
    });

    const fastSwRows = collectCompletedShockwaveScheduleRowsForMonth({
      year: 2025,
      month: 9,
      memos,
      therapists: shockwaveTherapists,
      monthlyTherapists: monthlyShockwaveTherapists,
      settings,
      upToToday: true,
    });
    const fastMtRows = collectCompletedManualScheduleRowsForMonth({
      year: 2025,
      month: 9,
      memos,
      therapists: manualTherapists,
      monthlyTherapists: monthlyManualTherapists,
      settings,
      upToToday: true,
    });
    assert.equal(zeroQueryCount, 0);

    const normalizeOpts = { memos, year: 2025, month: 9, settings, scheduleAuthoritative: true };
    const baseSummaryParams = {
      year: 2025,
      month: 9,
      shockwaveTherapists,
      manualTherapists,
      monthlyShockwaveTherapists,
      monthlyManualTherapists,
      monthlyShinjangTherapists,
      settings,
      isAdmin: true,
      includeLogOnlyTherapists: false,
    };

    for (const applyCryoDeduction of [true, false]) {
      const expected = buildCombinedStatsMonthSummary({
        ...baseSummaryParams,
        shockwaveRows: legacySw.rebuiltRows,
        manualTherapyRows: normalizeManualTherapyLogRows(legacyMt.rebuiltRows, ['40분', '60분'], normalizeOpts),
        applyCryoDeduction,
      });
      const actual = buildCombinedStatsMonthSummary({
        ...baseSummaryParams,
        shockwaveRows: fastSwRows,
        manualTherapyRows: normalizeManualTherapyLogRows(fastMtRows, ['40분', '60분'], normalizeOpts),
        applyCryoDeduction,
      });
      assert.deepEqual(actual, expected);
    }

    // Shared cache & in-flight deduplication for schedule rows + monthly therapists
    clearStatsScheduleSourceCache();
    let scheduleFetchCount = 0;
    let rosterFetchCount = 0;
    fromMock.mock.mockImplementation((tableName) => {
      if (tableName === 'shockwave_schedules') scheduleFetchCount += 1;
      if (tableName === 'shockwave_monthly_therapists') rosterFetchCount += 1;
      const query = {
        then: (resolve, reject) => new Promise((r) => setTimeout(r, 5))
          .then(() => ({ data: [{ id: 1, year: 2025, month: 9, type: 'shockwave', slot_index: 0, therapist_name: '박치료', start_day: 1, end_day: 30 }], error: null }))
          .then(resolve, reject),
      };
      for (const method of ['select', 'eq', 'gte', 'range', 'order']) query[method] = () => query;
      return query;
    });

    const [rowsA, rowsB] = await Promise.all([
      prefetchScheduleRowsForStatsMonth({ year: 2025, month: 9, useSharedCache: true }),
      prefetchScheduleRowsForStatsMonth({ year: 2025, month: 9, useSharedCache: true }),
    ]);
    const rowsC = await prefetchScheduleRowsForStatsMonth({ year: 2025, month: 9, useSharedCache: true });
    assert.equal(scheduleFetchCount, 1);
    assert.deepEqual(rowsA, rowsB);
    assert.deepEqual(rowsA, rowsC);

    const cache1 = new Map();
    const cache2 = new Map();
    await Promise.all([
      prefetchStatsMonthlyTherapists({ minYear: 2025, rosterQueryCache: cache1, useSharedCache: true }),
      prefetchStatsMonthlyTherapists({ minYear: 2025, rosterQueryCache: cache2, useSharedCache: true }),
    ]);
    assert.equal(rosterFetchCount, 1);
    clearStatsScheduleSourceCache();

    // Source-level checks for CombinedStatsPage & ScheduleContext startup dedup
    assert.match(combinedStatsPageSource, /prefetchScheduleRowsForStatsMonth\(\{\s*year:\s*currentYear,\s*month:\s*currentMonth,\s*force\s*\}\)/);
    assert.match(combinedStatsPageSource, /collectCompletedShockwaveScheduleRowsForMonth\(/);
    assert.match(combinedStatsPageSource, /collectCompletedManualScheduleRowsForMonth\(/);
    assert.doesNotMatch(combinedStatsPageSource, /syncMonthShockwaveScheduleToStats/);
    assert.doesNotMatch(combinedStatsPageSource, /syncMonthManualTherapyScheduleToStats/);
    assert.match(combinedStatsPageSource, /Object\.defineProperty\(adjusted,\s*'withoutCryoDeduction'/);
    assert.match(scheduleContextSource, /therapistRosterLoadPromisesRef/);
    assert.match(scheduleContextSource, /shockwaveSettingsLoadPromiseRef/);
  });

  it('prevents unstyled or empty schedule cells from flashing on browser refresh before settings, staff memos, and grid sizes are ready', async () => {
    const [
      { isScheduleVisualViewReady, shouldKeepScheduleMounted },
      { resolveInitialSchedulerGridDeviceSettings },
      { resolveRemoteSchedulerTextSettings },
      shockwavePageSource,
      shockwaveViewSource,
      resizeHookSource,
      viewStateHookSource,
    ] = await Promise.all([
      import('../scheduleMonthLoadUtils.js'),
      import('../schedulerGridDeviceSettings.js'),
      import('../schedulerTextSettings.js'),
      readFile(new URL('../../pages/ShockwavePage.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../components/shockwave/ShockwaveView.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../components/shockwave/useScheduleResizeState.js', import.meta.url), 'utf8'),
      readFile(new URL('../../components/shockwave/useScheduleViewState.js', import.meta.url), 'utf8'),
    ]);

    const readyBase = {
      year: 2026,
      month: 11,
      shockwaveMemosLoadedKey: '2026-11',
      monthlyTherapistLoadedKey: '2026-11',
      visibleTherapistLoadedKey: '2026-11',
      staffMemosLoadedKey: '2026-11-adj',
      holidaysLoadedKey: '2026-11',
      shockwaveSettingsLoaded: true,
      therapistsLoaded: true,
    };
    assert.equal(isScheduleVisualViewReady(readyBase), true);
    assert.equal(isScheduleVisualViewReady({ ...readyBase, shockwaveSettingsLoaded: false }), false);
    assert.equal(isScheduleVisualViewReady({ ...readyBase, therapistsLoaded: false }), false);
    assert.equal(shouldKeepScheduleMounted({
      currentMonthReady: false,
      lastLoadedMonthKey: '',
      loadError: '',
    }), false);

    // Synchronous Frame-0 merge of missing width/height fields from already-loaded shockwaveSettings
    const gridResolved = resolveInitialSchedulerGridDeviceSettings({
      localSnapshot: {
        values: { timeColWidth: 64 },
        present: { timeColWidth: true },
        hasAny: true,
        hasAll: false,
      },
      monthlySettings: {
        device_settings: {
          'dev-1': { colRatios: [1.5, 1], dayColWidth: 220, rowHeight: 28, timeColWidth: 52 },
        },
      },
      identity: { deviceId: 'dev-1', legacyDeviceId: 'dev-1' },
    });
    assert.deepEqual(gridResolved.values, {
      colRatios: [1.5, 1],
      dayColWidth: 220,
      rowHeight: 28,
      timeColWidth: 64,
    });

    const textResolved = resolveRemoteSchedulerTextSettings(
      {
        device_text_settings: {
          'dev-1': { font_size: 15, header_height: 38, therapist_height: 34 },
        },
      },
      { deviceId: 'dev-1', legacyDeviceId: 'dev-1' }
    );
    assert.equal(textResolved.font_size, 15);
    assert.equal(textResolved.header_height, 38);
    assert.equal(textResolved.therapist_height, 34);

    assert.match(shockwavePageSource, /lastLoadedMonthKey:\s*effectiveLastReadyMonthKey/);
    assert.match(shockwavePageSource, /shockwaveSettingsLoaded:\s*shockwaveSettingsLoaded !== false/);
    assert.match(shockwavePageSource, /therapistsLoaded:\s*therapistsLoaded !== false/);
    assert.match(shockwaveViewSource, /useScheduleResizeState\(\{\s*colCount,\s*settings\s*\}\)/);
    assert.match(
      shockwaveViewSource,
      /if \(isScheduleMonthLoading \|\| isDeviceSettingsLoading \|\| isTextSettingsLoading\) return null;/
    );
    assert.match(resizeHookSource, /hasCompleteLocalSchedulerGridDeviceSettings/);
    assert.match(viewStateHookSource, /resolveRemoteSchedulerTextSettings/);
  });

  it('transitions months cleanly without leftover previous-month cells or CSS background fade ghosts', async () => {
    const [
      shockwavePageSource,
      shockwaveViewSource,
      scheduleCellSource,
      scheduleContextSource,
      shockwaveCssSource,
    ] = await Promise.all([
      readFile(new URL('../../pages/ShockwavePage.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../components/shockwave/ShockwaveView.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../components/shockwave/ShockwaveScheduleCell.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../contexts/ScheduleContext.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../styles/shockwave.css', import.meta.url), 'utf8'),
    ]);

    // ShockwavePage waits for exact target-month staffMemos, holidays, and visibleMonthlyTherapists
    assert.match(shockwavePageSource, /staffMemosLoadedKey === currentStaffViewKey/);
    assert.match(shockwavePageSource, /holidaysLoadedKey === currentMonthKey/);
    assert.match(shockwavePageSource, /monthlyTherapistVisibleLoadKeys\?\.shockwave === currentMonthKey/);
    assert.match(shockwavePageSource, /memos=\{currentMonthReady \? shockwaveMemos : EMPTY_STAFF_MEMOS\}/);

    // ShockwaveView keys week containers by year-month so previous month DOM nodes never morph/linger,
    // and skips rendering incomplete month grids while loading
    assert.match(shockwaveViewSource, /key=\{`\$\{currentYear\}-\$\{currentMonth\}-\$\{weekIdx\}`\}/);
    assert.match(
      shockwaveViewSource,
      /if \(isScheduleMonthLoading \|\| isDeviceSettingsLoading \|\| isTextSettingsLoading\) return null;/
    );

    // No CSS background fade transition on .sw-cell or .sw-day-header-cell that causes old colors to linger
    assert.match(shockwaveCssSource, /\.sw-cell\s*\{[^}]*transition:\s*none;/s);
    assert.match(shockwaveCssSource, /\.sw-day-header-cell\s*\{[^}]*transition:\s*none;/s);

    // MemoizedCell re-renders when monthly prescription colors change across months
    assert.match(
      scheduleCellSource,
      /if \(prevProps\.effectivePrescriptionColors !== nextProps\.effectivePrescriptionColors\) return false;/
    );

    // ScheduleContext clears uncached month state immediately and preloads ±2 view months (±3 raw months)
    assert.match(scheduleContextSource, /const auxiliaryWindowMonths = \[-3, -2, -1, 0, 1, 2, 3\]\.map/);
    assert.match(scheduleContextSource, /mergeLoadedStaffMonthResults\(fulfilledStaffEntries,\s*\{\s*commitState:\s*false\s*\}\)/);
    assert.match(scheduleContextSource, /loadHolidaysRangeShared\(year,\s*month,\s*\{\s*commitState:\s*false\s*\}\)/);
  });
});

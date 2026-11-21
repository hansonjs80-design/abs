import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fetchPTCalendarCounts } from '../lib/ptStaffCalendarCounts';
import { loadPTManualCountOverrides, savePTManualCountOverride } from '../lib/ptManualCountOverrides';
import { subscribePTCalendarCountChanges } from '../lib/ptCalendarCountUpdates';
import { getTodayKST } from '../lib/calendarUtils';
import {
  findFreshCoveringRangeEntry,
  sliceDateRecordByRange,
} from '../lib/statsMemoryCache';

const CURRENT_PT_COUNTS_CACHE_TTL_MS = 60 * 1000;
const HISTORICAL_PT_COUNTS_CACHE_TTL_MS = 5 * 60 * 1000;
const ptCountsRangeCache = new Map();

function getTodayISO() {
  const today = getTodayKST();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function getPTCountsCacheTtlMs(endDate) {
  return endDate < getTodayISO()
    ? HISTORICAL_PT_COUNTS_CACHE_TTL_MS
    : CURRENT_PT_COUNTS_CACHE_TTL_MS;
}

function readCachedPTCounts(startDate, endDate, { readOnly = false } = {}) {
  const match = findFreshCoveringRangeEntry(
    ptCountsRangeCache,
    startDate,
    endDate,
    getPTCountsCacheTtlMs(endDate)
  );
  if (!match) return null;

  const { exact, entry } = match;
  if (!readOnly && entry.readOnly) return null;

  const range = `${startDate}/${endDate}`;
  if (exact) {
    return {
      counts: entry.counts,
      settings: entry.settings,
      overrides: entry.overrides,
      range,
      error: false,
    };
  }
  return {
    counts: sliceDateRecordByRange(entry.counts, startDate, endDate),
    settings: entry.settings,
    overrides: sliceDateRecordByRange(entry.overrides, startDate, endDate),
    range,
    error: false,
  };
}

export function usePTCalendarCounts(startDate, endDate, { readOnly = false } = {}) {
  const range = `${startDate}/${endDate}`;
  const [snapshot, setSnapshot] = useState(() => (
    readCachedPTCounts(startDate, endDate, { readOnly })
    || { counts: {}, settings: null, range: '', error: false }
  ));
  const revisionRef = useRef(0);
  const invalidatedRef = useRef(new Set());
  const refreshRef = useRef(null);
  const lastVisibilityRefreshAtRef = useRef(0);
  const saveManualOverride = useCallback(async (date, memoKey, content, sourceCount) => {
    if (readOnly) return false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    revisionRef.current++;
    try {
      const override = await savePTManualCountOverride(supabase, date, memoKey, content, sourceCount, controller.signal);
      revisionRef.current++;
      for (const entry of ptCountsRangeCache.values()) {
        if (entry && entry.startDate <= date && entry.endDate >= date) {
          entry.overrides = { ...entry.overrides, [date]: override };
        }
      }
      setSnapshot(previous => ({ ...previous, overrides: { ...previous.overrides, [date]: override } }));
      return true;
    } catch { return false; }
    finally { clearTimeout(timeout); }
  }, [readOnly]);
  useEffect(() => {
    let disposed = false;
    let busy = false;
    let rerun = false;
    let controller;
    let notificationTimer;
    const isHistoricalRange = endDate < getTodayISO();
    const pollIntervalMs = readOnly ? 120000 : 30000;

    const refresh = async ({ force = false } = {}) => {
      if (disposed || document.visibilityState === 'hidden') return;
      if (!force) {
        const cached = readCachedPTCounts(startDate, endDate, { readOnly });
        if (cached) {
          setSnapshot(cached);
          return;
        }
      }
      if (busy) { rerun = true; return; }
      busy = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const revision = revisionRef.current;
      try {
        const result = await fetchPTCalendarCounts(supabase, startDate, endDate, controller.signal);
        const manual = result.settings?.enabled
          ? await loadPTManualCountOverrides(supabase, startDate, endDate, result.counts, controller.signal, invalidatedRef.current, { persistInvalidations: !readOnly })
          : { overrides: {}, delayed: false };
        if (revision !== revisionRef.current) { rerun = true; return; }
        const nextSnapshot = { ...result, overrides: manual.overrides, range, error: manual.delayed };
        if (!manual.delayed) {
          ptCountsRangeCache.set(range, {
            startDate,
            endDate,
            counts: result.counts,
            settings: result.settings,
            overrides: manual.overrides,
            readOnly,
            updatedAt: Date.now(),
          });
        }
        if (!disposed) setSnapshot(nextSnapshot);
      } catch {
        // Keep the last verified display on transient network errors.
        if (!disposed) setSnapshot(previous => ({ ...previous, error: true }));
      } finally {
        clearTimeout(timeout);
        busy = false;
        if (rerun && !disposed) { rerun = false; void refresh({ force: true }); }
      }
    };
    const channel = subscribePTCalendarCountChanges(supabase, startDate, endDate, () => {
      clearTimeout(notificationTimer);
      notificationTimer = setTimeout(() => {
        ptCountsRangeCache.clear();
        void refresh({ force: true });
      }, 150);
    });
    refreshRef.current = refresh;
    const timer = isHistoricalRange ? null : setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void refresh({ force: true });
      }
    }, pollIntervalMs);
    const handleVisibilityRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastVisibilityRefreshAtRef.current < 30000) return;
      lastVisibilityRefreshAtRef.current = now;
      void refresh();
    };
    const handleOnlineRefresh = () => {
      void refresh({ force: true });
    };
    document.addEventListener('visibilitychange', handleVisibilityRefresh);
    window.addEventListener('online', handleOnlineRefresh);

    const initialCached = readCachedPTCounts(startDate, endDate, { readOnly });
    if (initialCached) {
      setSnapshot(initialCached);
    } else {
      void refresh({ force: true });
    }
    return () => {
      disposed = true;
      if (refreshRef.current === refresh) refreshRef.current = null;
      controller?.abort();
      clearTimeout(notificationTimer);
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
      window.removeEventListener('online', handleOnlineRefresh);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [startDate, endDate, range, readOnly]);
  const refresh = useCallback(() => { void refreshRef.current?.({ force: true }); }, []);
  const currentSnapshot = snapshot.range === range
    ? snapshot
    : (readCachedPTCounts(startDate, endDate, { readOnly }) || { counts: {}, settings: null, error: snapshot.error });
  const isLoaded = snapshot.range === range || currentSnapshot.range === range;
  return { ...currentSnapshot, loading: !isLoaded && !snapshot.error, saveManualOverride, refresh };
}

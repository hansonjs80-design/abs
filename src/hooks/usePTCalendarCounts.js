import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fetchPTCalendarCounts } from '../lib/ptStaffCalendarCounts';
import { loadPTManualCountOverrides, savePTManualCountOverride } from '../lib/ptManualCountOverrides';

export function usePTCalendarCounts(startDate, endDate, { readOnly = false } = {}) {
  const [snapshot, setSnapshot] = useState({ counts: {}, settings: null, range: '', error: false });
  const range = `${startDate}/${endDate}`;
  const revisionRef = useRef(0);
  const invalidatedRef = useRef(new Set());
  const refreshRef = useRef(null);
  const saveManualOverride = useCallback(async (date, memoKey, content, sourceCount) => {
    if (readOnly) return false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    revisionRef.current++;
    try {
      const override = await savePTManualCountOverride(supabase, date, memoKey, content, sourceCount, controller.signal);
      revisionRef.current++;
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
    const refresh = async () => {
      if (disposed || document.visibilityState === 'hidden') return;
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
        if (!disposed) setSnapshot({ ...result, overrides: manual.overrides, range, error: manual.delayed });
      } catch {
        // Keep the last verified display on transient network errors.
        if (!disposed) setSnapshot(previous => ({ ...previous, error: true }));
      } finally {
        clearTimeout(timeout);
        busy = false;
        if (rerun && !disposed) { rerun = false; void refresh(); }
      }
    };
    const channel = supabase.channel?.('pt-live-updates-v1')
      .on('broadcast', { event: 'changed' }, () => { void refresh(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pt_daily_records' }, () => { void refresh(); });
    channel?.subscribe();
    refreshRef.current = refresh;
    const timer = setInterval(() => { void refresh(); }, 10000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    void refresh();
    return () => {
      disposed = true;
      if (refreshRef.current === refresh) refreshRef.current = null;
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [startDate, endDate, range, readOnly]);
  const refresh = useCallback(() => { void refreshRef.current?.(); }, []);
  return { ...(snapshot.range === range ? snapshot : { counts: {}, settings: null, error: snapshot.error }), loading: snapshot.range !== range && !snapshot.error, saveManualOverride, refresh };
}

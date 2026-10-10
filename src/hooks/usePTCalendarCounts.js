import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fetchPTCalendarCounts } from '../lib/ptStaffCalendarCounts';

export function usePTCalendarCounts(startDate, endDate) {
  const [snapshot, setSnapshot] = useState({ counts: {}, settings: null, range: '', error: false });
  const range = `${startDate}/${endDate}`;
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
      try {
        const result = await fetchPTCalendarCounts(supabase, startDate, endDate, controller.signal);
        if (!disposed) setSnapshot({ ...result, range, error: false });
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
    const timer = setInterval(() => { void refresh(); }, 10000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    void refresh();
    return () => {
      disposed = true;
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [startDate, endDate, range]);
  return snapshot.range === range ? snapshot : { counts: {}, settings: null, error: snapshot.error };
}

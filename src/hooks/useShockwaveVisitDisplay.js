import { buildShockwaveVisitScheduleRows } from '../lib/shockwaveVisitScheduleRows';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fetchShockwaveVisitHistory } from '../lib/shockwaveVisitHistoryRepository';
import { buildShockwaveVisitDisplay } from '../lib/shockwaveVisitDisplay';

export default function useShockwaveVisitDisplay(rows, settings, year, month, enabled = true) {
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState(null);
  const [retryKey, setRetryKey] = useState(0);
  const scope = useMemo(() => {
    const charts = [...new Set(rows.map((row) => String(row.chart_number || '').trim()).filter(Boolean))].sort();
    return JSON.stringify({ charts, needsNames: rows.some((row) => !String(row.chart_number || '').trim()), startDate: `${year}-${String(month).padStart(2, '0')}-01`, lastDate: enabled && rows.length ? new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) : '' });
  }, [rows, year, month, enabled]);
  useEffect(() => {
    let cancelled = false;
    const { charts, needsNames, startDate, lastDate } = JSON.parse(scope);
    if (!lastDate) return undefined;
    const load = async () => {
      const data = await fetchShockwaveVisitHistory(supabase, rows, { charts, needsNames, startDate, lastDate }, year, () => cancelled);
      if (!cancelled && data) { setResult({ scope, ...data }); setFailure(null); }

    };
    load().catch((error) => {
      if (!cancelled) {
        setResult(null);
        setFailure({ scope, retryKey });
        console.error('신장분사 회차 조회 실패:', error);
      }
    });
    return () => { cancelled = true; };
  }, [scope, rows, year, retryKey]);
  const display = useMemo(() => {
    if (result?.scope !== scope) return { byRow: {}, latestByRow: {} };
    const { lastDate } = JSON.parse(scope);
    const scheduleRows = buildShockwaveVisitScheduleRows(result.schedules, settings, lastDate);
    return buildShockwaveVisitDisplay(rows, [...scheduleRows, ...result.history], settings);
  }, [result, rows, scope, settings]);
  const hasError = failure?.scope === scope && failure?.retryKey === retryKey;
  return { ...display, isLoading: enabled && rows.length > 0 && result?.scope !== scope && !hasError, hasError, retry: () => setRetryKey((key) => key + 1) };
}

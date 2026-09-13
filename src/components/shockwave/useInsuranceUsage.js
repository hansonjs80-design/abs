import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { fetchInsurancePatientRecords } from '../../lib/insuranceUsageRepository';
import {
  buildInsuranceRecords, getInsurancePatient, getInsuranceUsage,
  localInsuranceScheduleRows, overlayInsuranceScheduleRows,
} from '../../lib/insuranceUsageUtils';

export default function useInsuranceUsage({ logs, hoverRow, memos, year, month, settings }) {
  const patientsKey = JSON.stringify([...new Set([...logs, hoverRow].filter(Boolean)
    .map((row) => getInsurancePatient(row).key).filter(Boolean))].sort());
  const prefetchKey = JSON.stringify([...new Set(Object.values(memos || {})
    .map((row) => getInsurancePatient(row).key).filter(Boolean))].sort());
  const targetKey = JSON.stringify([hoverRow?.year, hoverRow?.month, hoverRow?.week_index, hoverRow?.day_index, hoverRow?.row_index, hoverRow?.col_index, logs.length]);
  const [loaded, setLoaded] = useState({});
  const cacheRef = useRef(new Map());
  const pendingRef = useRef(new Map());
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const loadPatient = useCallback((key) => {
    const cached = cacheRef.current.get(key);
    if (cached && Date.now() - cached.time < 60000) return Promise.resolve(cached);
    if (pendingRef.current.has(key)) return pendingRef.current.get(key);
    const [chart, name] = JSON.parse(key);
    const promise = fetchInsurancePatientRecords(supabase, { chart, name })
      .then((data) => {
        const result = { data, time: Date.now(), error: false };
        cacheRef.current.set(key, result);
        if (mountedRef.current) setLoaded((prev) => ({ ...prev, [key]: result }));
        return result;
      }).catch(() => {
        if (mountedRef.current) setLoaded((prev) => ({ ...prev, [key]: { error: true } }));
      }).finally(() => pendingRef.current.delete(key));
    pendingRef.current.set(key, promise);
    return promise;
  }, []);
  useEffect(() => {
    JSON.parse(patientsKey).forEach(loadPatient);
  }, [patientsKey, targetKey, loadPatient, memos]);
  useEffect(() => {
    let active = true;
    const queue = JSON.parse(prefetchKey);
    const worker = async () => {
      while (active && queue.length) await loadPatient(queue.shift());
    };
    // Warm visible patients without waiting for the first hover. Limit background concurrency.
    const timer = setTimeout(() => { worker(); worker(); }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [prefetchKey, loadPatient]);
  const records = useMemo(() => {
    const keys = JSON.parse(patientsKey);
    if (!keys.length) return [];
    const patients = new Set(keys);
    return buildInsuranceRecords({
      scheduleRows: overlayInsuranceScheduleRows(
        keys.flatMap((key) => loaded[key]?.data?.scheduleRows || []),
        localInsuranceScheduleRows(memos, year, month)
      ).filter((row) => patients.has(getInsurancePatient(row).key)),
      historyLogs: keys.flatMap((key) => loaded[key]?.data?.historyLogs || []), settings,
    });
  }, [loaded, patientsKey, memos, year, month, settings]);
  const getStatus = (row) => {
    const key = getInsurancePatient(row).key;
    if (!key) return '—';
    return loaded[key]?.error ? '조회 실패' : loaded[key]?.data ? '—' : '조회 중';
  };
  const getUsage = (row, category) => {
    const entry = loaded[getInsurancePatient(row).key];
    if (!entry?.data || entry.error) return null;
    if (row.schedule_cell_key && !row.scheduler_cell_key) {
      const [week_index, day_index, row_index, col_index] = row.schedule_cell_key.split('-').map(Number);
      return getInsuranceUsage(records, { ...row, year, month, week_index, day_index, row_index, col_index }, settings, category);
    }
    return getInsuranceUsage(records, row, settings, category);
  };
  return {
    logs: logs.map((row) => ({ ...row, insuranceUsage: getUsage(row), insuranceUsageStatus: getStatus(row) })),
    hoverUsage: hoverRow ? getUsage(hoverRow) : null,
    hoverUsages: hoverRow ? ['shockwave', 'manual'].map((category) => getUsage(hoverRow, category))
      .filter((usage) => usage?.hasHistory) : [],
    hoverStatus: hoverRow ? getStatus(hoverRow) : '',
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { fetchInsurancePatientRecords } from '../../lib/insuranceUsageRepository';
import {
  buildInsuranceRecords, getInsurancePatient, getInsuranceUsage,
  localInsuranceScheduleRows, overlayInsuranceScheduleRows,
} from '../../lib/insuranceUsageUtils';
import { getExplicitVisitSuffix } from '../../lib/schedulerCellTextUtils';

const INSURANCE_CACHE_TTL_MS = 5 * 60 * 1000;
const INSURANCE_ERROR_CACHE_TTL_MS = 15 * 1000;

export default function useInsuranceUsage({ logs, hoverRow, memos, year, month, settings }) {
  const patientsKey = JSON.stringify([...new Set([...logs, hoverRow].filter(Boolean)
    .map((row) => getInsurancePatient(row).key).filter(Boolean))].sort());
  const prefetchKey = JSON.stringify([...new Set(Object.values(memos || {})
    // Empty/future cells cannot have a usage value yet. Prioritize cells whose
    // visit mark can actually show insurance usage when the cursor reaches them.
    .filter((row) => Boolean(getExplicitVisitSuffix(row?.content || '')))
    .map((row) => getInsurancePatient(row).key).filter(Boolean))].sort());
  const [loaded, setLoaded] = useState({});
  const cacheRef = useRef(new Map());
  const pendingRef = useRef(new Map());
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const loadPatient = useCallback((key, { publish = true } = {}) => {
    const publishResult = (result) => {
      if (publish && mountedRef.current) {
        setLoaded((previous) => (previous[key] === result ? previous : { ...previous, [key]: result }));
      }
      return result;
    };
    const cached = cacheRef.current.get(key);
    const cacheTtl = cached?.error ? INSURANCE_ERROR_CACHE_TTL_MS : INSURANCE_CACHE_TTL_MS;
    if (cached && Date.now() - cached.time < cacheTtl) return Promise.resolve(publishResult(cached));
    if (pendingRef.current.has(key)) return pendingRef.current.get(key).then(publishResult);
    const [chart, name] = JSON.parse(key);
    const promise = fetchInsurancePatientRecords(supabase, { chart, name })
      .then((data) => {
        const result = { data, time: Date.now(), error: false };
        cacheRef.current.set(key, result);
        return result;
      }).catch(() => {
        const result = { error: true, time: Date.now() };
        cacheRef.current.set(key, result);
        return result;
      }).finally(() => pendingRef.current.delete(key));
    pendingRef.current.set(key, promise);
    return promise.then(publishResult);
  }, []);
  useEffect(() => {
    JSON.parse(patientsKey).forEach((key) => loadPatient(key));
  }, [patientsKey, loadPatient]);
  useEffect(() => {
    let active = true;
    const queue = JSON.parse(prefetchKey);
    const worker = async () => {
      while (active && queue.length) await loadPatient(queue.shift());
    };
    // Keep prefetch invisible to interaction: it populates only the cache, while
    // a hovered patient publishes its result immediately. Starting after the
    // first paint also avoids competing with the initial scheduler render.
    const timer = setTimeout(() => { worker(); worker(); }, 80);
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
    let key = getInsurancePatient(row).key;
    if (!key) {
      const keys = JSON.parse(patientsKey);
      if (keys.length === 1) key = keys[0];
    }
    if (!key) return '—';
    return loaded[key]?.error ? '조회 실패' : loaded[key]?.data ? '—' : '조회 중';
  };
  const getUsage = (row, category) => {
    let patientKey = getInsurancePatient(row).key;
    if (!patientKey) {
      const keys = JSON.parse(patientsKey);
      if (keys.length === 1) patientKey = keys[0];
    }
    const entry = loaded[patientKey];
    if (!entry?.data || entry.error) return null;
    const effectiveYear = Number(row.year || (row.date && String(row.date).slice(0, 4)) || year);
    const effectiveMonth = Number(row.month || (row.date && String(row.date).slice(5, 7)) || month);
    if (row.schedule_cell_key && !row.scheduler_cell_key) {
      const [week_index, day_index, row_index, col_index] = row.schedule_cell_key.split('-').map(Number);
      return getInsuranceUsage(records, { ...row, year: effectiveYear, month: effectiveMonth, week_index, day_index, row_index, col_index }, settings, category);
    }
    return getInsuranceUsage(records, { ...row, year: effectiveYear, month: effectiveMonth }, settings, category);
  };
  return {
    logs: logs.map((row) => ({ ...row, insuranceUsage: getUsage(row), insuranceUsageStatus: getStatus(row) })),
    hoverUsage: hoverRow ? getUsage(hoverRow) : null,
    hoverUsages: hoverRow ? ['shockwave', 'manual'].map((category) => getUsage(hoverRow, category))
      .filter((usage) => usage?.hasHistory) : [],
    hoverStatus: hoverRow ? getStatus(hoverRow) : '',
  };
}

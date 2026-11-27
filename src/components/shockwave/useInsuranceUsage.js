import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { fetchInsurancePatientRecords } from '../../lib/insuranceUsageRepository';
import {
  buildInsuranceRecords, getInsurancePatient, getInsuranceUsage,
  localInsuranceScheduleRows, overlayInsuranceHistorySchedules,
} from '../../lib/insuranceUsageUtils';

const INSURANCE_CACHE_TTL_MS = 5 * 60 * 1000;
const INSURANCE_ERROR_CACHE_TTL_MS = 15 * 1000;
const HOVER_LOAD_DEBOUNCE_MS = 65;

export default function useInsuranceUsage({
  logs,
  hoverRow,
  pendingPatientRow = null,
  memos,
  year,
  month,
  settings,
  historyRevision = 0,
}) {
  const hoverPatientKey = useMemo(
    () => (hoverRow ? getInsurancePatient(hoverRow).key : ''),
    [hoverRow]
  );
  const historyPatientsKey = useMemo(() => JSON.stringify([...new Set(
    [...logs, pendingPatientRow]
      .filter(Boolean)
      .map((row) => getInsurancePatient(row).key)
      .filter(Boolean)
  )].sort()), [logs, pendingPatientRow]);
  const historyPatients = useMemo(() => new Set(JSON.parse(historyPatientsKey)), [historyPatientsKey]);
  const patientsKey = useMemo(() => JSON.stringify([...new Set(
    [...historyPatients, hoverPatientKey].filter(Boolean)
  )].sort()), [historyPatients, hoverPatientKey]);
  const localRowsByPatient = useMemo(() => {
    const grouped = new Map();
    localInsuranceScheduleRows(memos, year, month).forEach((row) => {
      const pKey = getInsurancePatient(row).key;
      if (!pKey) return;
      if (!grouped.has(pKey)) grouped.set(pKey, []);
      grouped.get(pKey).push(row);
    });
    return grouped;
  }, [memos, year, month]);
  const [loaded, setLoaded] = useState({});
  const cacheRef = useRef(new Map());
  const pendingRef = useRef(new Map());
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const loadPatient = useCallback(function loadPatient(key, { publish = true, freshness = 0 } = {}) {
    const publishResult = (result) => {
      if (publish && mountedRef.current) {
        setLoaded((previous) => (previous[key] === result ? previous : { ...previous, [key]: result }));
      }
      return result;
    };
    const cached = cacheRef.current.get(key);
    const cacheTtl = cached?.error ? INSURANCE_ERROR_CACHE_TTL_MS : INSURANCE_CACHE_TTL_MS;
    if (cached && (!freshness || cached.freshness === freshness) && Date.now() - cached.time < cacheTtl) return Promise.resolve(publishResult(cached));
    const pending = pendingRef.current.get(key);
    if (pending) {
      if (freshness && pending.freshness !== freshness) {
        return pending.promise.then(() => loadPatient(key, { publish, freshness }));
      }
      return pending.promise.then(publishResult);
    }
    const [chart, name] = JSON.parse(key);
    const promise = fetchInsurancePatientRecords(supabase, { chart, name })
      .then((data) => {
        const result = { data, time: Date.now(), error: false, freshness };
        cacheRef.current.set(key, result);
        return result;
      }).catch(() => {
        const result = { error: true, time: Date.now(), freshness };
        cacheRef.current.set(key, result);
        return result;
      }).finally(() => pendingRef.current.delete(key));
    pendingRef.current.set(key, { promise, freshness });
    return promise.then(publishResult);
  }, []);
  useEffect(() => {
    historyPatients.forEach((key) => {
      loadPatient(key, { freshness: historyRevision });
    });
  }, [historyPatients, historyRevision, loadPatient]);
  useEffect(() => {
    if (!hoverPatientKey || historyPatients.has(hoverPatientKey)) return undefined;
    const cached = cacheRef.current.get(hoverPatientKey);
    const cacheTtl = cached?.error ? INSURANCE_ERROR_CACHE_TTL_MS : INSURANCE_CACHE_TTL_MS;
    if (cached && Date.now() - cached.time < cacheTtl) {
      loadPatient(hoverPatientKey, { freshness: 0 });
      return undefined;
    }
    const timer = setTimeout(() => {
      loadPatient(hoverPatientKey, { freshness: 0 });
    }, HOVER_LOAD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [hoverPatientKey, historyPatients, loadPatient]);
  const records = useMemo(() => {
    const keys = JSON.parse(patientsKey);
    if (!keys.length) return [];
    const patients = new Set(keys);
    const modalLogsByPatient = new Map();
    if (Array.isArray(logs) && logs.length > 0) {
      logs.forEach((row) => {
        const pKey = getInsurancePatient(row).key;
        if (pKey && patients.has(pKey)) {
          if (!modalLogsByPatient.has(pKey)) modalLogsByPatient.set(pKey, []);
          modalLogsByPatient.get(pKey).push(row);
        }
      });
    }
    const historyLogs = keys.flatMap((key) => {
      if (modalLogsByPatient.has(key)) {
        return modalLogsByPatient.get(key);
      }
      return loaded[key]?.data?.historyLogs || [];
    });
    const matchedLocalRows = keys.flatMap((key) => localRowsByPatient.get(key) || []);
    return buildInsuranceRecords({
      scheduleRows: overlayInsuranceHistorySchedules(
        keys.flatMap((key) => loaded[key]?.data?.scheduleRows || []),
        logs,
        matchedLocalRows
      ).filter((row) => patients.has(getInsurancePatient(row).key)),
      historyLogs, settings,
    });
  }, [loaded, patientsKey, localRowsByPatient, settings, logs]);
  const getStatus = useCallback((row) => {
    let key = getInsurancePatient(row).key;
    if (!key) {
      const keys = JSON.parse(patientsKey);
      if (keys.length === 1) key = keys[0];
    }
    if (!key) return '—';
    if (historyRevision && historyPatients.has(key) && loaded[key]?.freshness !== historyRevision) return '조회 중';
    return loaded[key]?.error ? '조회 실패' : loaded[key]?.data ? '—' : '조회 중';
  }, [loaded, patientsKey, historyPatients, historyRevision]);
  const getUsage = useCallback((row, category) => {
    let patientKey = getInsurancePatient(row).key;
    if (!patientKey) {
      const keys = JSON.parse(patientsKey);
      if (keys.length === 1) patientKey = keys[0];
    }
    const entry = loaded[patientKey];
    if (historyRevision && historyPatients.has(patientKey) && entry?.freshness !== historyRevision) return null;
    if (!entry?.data || entry.error) return null;
    const effectiveYear = Number(row.year || (row.date && String(row.date).slice(0, 4)) || year);
    const effectiveMonth = Number(row.month || (row.date && String(row.date).slice(5, 7)) || month);
    if (row.schedule_cell_key && !row.scheduler_cell_key) {
      const [week_index, day_index, row_index, col_index] = row.schedule_cell_key.split('-').map(Number);
      return getInsuranceUsage(records, { ...row, year: effectiveYear, month: effectiveMonth, week_index, day_index, row_index, col_index }, settings, category);
    }
    return getInsuranceUsage(records, { ...row, year: effectiveYear, month: effectiveMonth }, settings, category);
  }, [loaded, patientsKey, records, settings, year, month, historyPatients, historyRevision]);
  const enrichedLogs = useMemo(() => logs.map((row) => ({
    ...row, insuranceUsage: getUsage(row), insuranceUsageStatus: getStatus(row),
  })), [logs, getUsage, getStatus]);
  return {
    logs: enrichedLogs,
    hoverUsage: hoverRow ? getUsage(hoverRow) : null,
    hoverUsages: hoverRow ? ['shockwave', 'manual'].map((category) => getUsage(hoverRow, category))
      .filter((usage) => usage?.hasHistory) : [],
    hoverStatus: hoverRow ? getStatus(hoverRow) : '',
  };
}

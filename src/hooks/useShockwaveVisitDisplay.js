import { buildScheduleRowsBySchedulerCellKey, getSchedulerLinkedLogQueryTargets, getScheduleRowSchedulerCellKey } from '../lib/schedulerHistoryCandidateUtils';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { normalizeInsuranceRecord, getInsurancePatient } from '../lib/insuranceUsageUtils';
import { getExplicitVisitSuffix } from '../lib/schedulerCellTextUtils';
import { readAllInsuranceRows } from '../lib/insuranceUsageRepository';
import { buildShockwaveVisitDisplay } from '../lib/shockwaveVisitDisplay';

export default function useShockwaveVisitDisplay(rows, settings, year, month, enabled = true) {
  const [result, setResult] = useState(null);
  const scope = useMemo(() => {
    const charts = [...new Set(rows.map((row) => String(row.chart_number || '').trim()).filter(Boolean))].sort();
    return JSON.stringify({ charts, needsNames: rows.some((row) => !String(row.chart_number || '').trim()), lastDate: enabled && rows.length ? new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) : '' });
  }, [rows, year, month, enabled]);
  useEffect(() => {
    let cancelled = false;
    const { charts, needsNames, lastDate } = JSON.parse(scope);
    if (!lastDate) return undefined;
    const load = async () => {
      const batches = needsNames ? [null] : Array.from({ length: Math.ceil(charts.length / 100) }, (_, i) => charts.slice(i * 100, (i + 1) * 100));
      const histories = await Promise.all(['shockwave_patient_logs', 'manual_therapy_patient_logs'].map(async (table) => {
        const history = [];
        for (const batch of batches) {
          for (let offset = 0; ; offset += 1000) {
            let query = supabase.from(table).select('id,date,patient_name,chart_number,prescription,body_part,visit_count,scheduler_cell_key')
              .lte('date', lastDate).order('date').order('id').range(offset, offset + 999);
            if (batch) query = query.in('chart_number', batch);
            const { data, error } = await query;
            if (error) throw error;
            if (cancelled) return [];
            history.push(...data.map((row) => ({ ...row, _table: table })));
            if (data.length < 1000) break;
          }
        }
        return history;
      }));
      const schedules = [];
      const terms = charts.length && !needsNames ? charts : [...new Set(rows.map((row) => row.patient_name?.replace(/\*/g, '').trim()).filter(Boolean))];
      for (let index = 0; index < terms.length; index += 30) {
        const filter = terms.slice(index, index + 30).map((term) => {
          const escaped = term.replace(/[\\%_]/g, '\\$&').replace(/"/g, '\\"');
          return `content.ilike."%${escaped}%"`;
        }).join(',');
        const fetched = await readAllInsuranceRows(() => supabase.from('shockwave_schedules')
          .select('id,year,month,week_index,day_index,row_index,col_index,content,prescription,body_part,merge_span,bg_color,updated_at')
          .or(filter).lte('year', year).order('id'));
        schedules.push(...fetched);
        if (cancelled) return;
      }
      // Resolve linked cells even if their patient/content changed after a log was saved.
      for (const target of getSchedulerLinkedLogQueryTargets(histories.flat())) {
        const linkedRows = await readAllInsuranceRows(() => supabase.from('shockwave_schedules')
          .select('id,year,month,week_index,day_index,row_index,col_index,content,prescription,body_part,merge_span,bg_color,updated_at')
          .eq('year', target.year).eq('month', target.month)
          .in('week_index', target.weekIndexes).in('day_index', target.dayIndexes)
          .in('row_index', target.rowIndexes).in('col_index', target.colIndexes).order('id'));
        schedules.push(...linkedRows);
        if (cancelled) return;
      }
      if (!cancelled) setResult({ scope, history: histories.flat(), schedules });
    };
    load().catch((error) => {
      if (!cancelled) {
        setResult(null);
        console.error('신장분사 회차 조회 실패:', error);
      }
    });
    return () => { cancelled = true; };
  }, [scope, rows, year]);
  return useMemo(() => {
    if (result?.scope !== scope) return { byRow: {}, latestByRow: {} };
    const { lastDate } = JSON.parse(scope);
    const scheduleRows = [...buildScheduleRowsBySchedulerCellKey(result.schedules).values()].flatMap((row) => {
      const record = normalizeInsuranceRecord(row, settings);
      if (!record) return [{ scheduler_cell_key: getScheduleRowSchedulerCellKey(row), _schedule: true, _excluded: true }];
      if (record.date > lastDate) return [];
      const patient = getInsurancePatient(row);
      return [{ ...row, date: record.date, prescription: record.prescription, chart_number: patient.chart, patient_name: patient.name,
        visit_count: getExplicitVisitSuffix(row.content).replace(/[()]/g, ''), scheduler_cell_key: record.key, _schedule: true, _excluded: record.excluded }];
    });
    return buildShockwaveVisitDisplay(rows, [...scheduleRows, ...result.history], settings);
  }, [result, rows, scope, settings]);
}

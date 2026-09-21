import { getSchedulerLinkedLogQueryTargets } from './schedulerHistoryCandidateUtils.js';
import { readAllInsuranceRows } from './insuranceUsageRepository.js';

export async function fetchShockwaveVisitHistory(client, rows, { charts, needsNames, startDate, lastDate }, year, isCancelled = () => false) {
  const batches = needsNames ? [null] : Array.from({ length: Math.ceil(charts.length / 100) }, (_, i) => charts.slice(i * 100, (i + 1) * 100));
  const histories = await Promise.all(['shockwave_patient_logs', 'manual_therapy_patient_logs'].map(async (table) => {
    const history = [];
    for (const batch of batches) {
      for (let offset = 0; ; offset += 1000) {
        let query = client.from(table).select('id,date,patient_name,chart_number,prescription,body_part,visit_count,scheduler_cell_key')
          .lte('date', lastDate).order('date').order('id').range(offset, offset + 999);
        if (startDate) query = query.gte('date', startDate);
        if (batch) query = query.in('chart_number', batch);
        const { data, error } = await query;
        if (error) throw error;
        if (isCancelled()) return [];
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
    const fetched = await readAllInsuranceRows(() => client.from('shockwave_schedules')
      .select('id,year,month,week_index,day_index,row_index,col_index,content,prescription,body_part,merge_span,bg_color,updated_at')
      .or(filter).eq('year', year).eq('month', Number(lastDate.slice(5, 7))).order('id'));
    schedules.push(...fetched);
    if (isCancelled()) return null;
  }
  // Resolve linked cells even if their patient/content changed after a log was saved.
  for (const target of getSchedulerLinkedLogQueryTargets(histories.flat())) {
    const linkedRows = await readAllInsuranceRows(() => client.from('shockwave_schedules')
      .select('id,year,month,week_index,day_index,row_index,col_index,content,prescription,body_part,merge_span,bg_color,updated_at')
      .eq('year', target.year).eq('month', target.month)
      .in('week_index', target.weekIndexes).in('day_index', target.dayIndexes)
      .in('row_index', target.rowIndexes).in('col_index', target.colIndexes).order('id'));
    schedules.push(...linkedRows);
    if (isCancelled()) return null;
  }

  return { history: histories.flat(), schedules };
}

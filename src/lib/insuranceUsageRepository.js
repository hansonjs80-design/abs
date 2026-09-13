import { getInsurancePatient } from './insuranceUsageUtils.js';

// Read-only, paginated queries. Never infer zero usage from a failed/partial read.
export async function readAllInsuranceRows(makeQuery, pageSize = 500) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await makeQuery().range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('실비 소진 내역을 조회하지 못했습니다.');
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

export async function fetchInsurancePatientRecords(client, { chart, name }) {
  if (!chart || !name) return { scheduleRows: [], historyLogs: [] };
  const term = chart.replace(/[%_\\]/g, '\\$&');
  const [scheduleRows, shockwave, manual] = await Promise.all([
    readAllInsuranceRows(() => client.from('shockwave_schedules')
      .select('id,year,month,week_index,day_index,row_index,col_index,content,prescription,merge_span,bg_color')
      .ilike('content', `%${term}%`).order('id', { ascending: true })),
    ...['shockwave_patient_logs', 'manual_therapy_patient_logs'].map((table) => readAllInsuranceRows(() => client.from(table)
      .select('id,patient_name,chart_number,date,prescription,visit_count,source,scheduler_cell_key')
      .eq('chart_number', chart).order('id', { ascending: true }))),
  ]);
  const patientKey = JSON.stringify([chart, name]);
  const matches = (row) => getInsurancePatient(row).key === patientKey;
  return { scheduleRows: scheduleRows.filter(matches), historyLogs: [
    ...shockwave.map((row) => ({ ...row, type: 'shockwave' })),
    ...manual.map((row) => ({ ...row, type: 'manual' })),
  ].filter(matches) };
}

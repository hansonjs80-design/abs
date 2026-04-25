import fs from 'fs';

const envFile = fs.readFileSync('.env', 'utf-8');
const env = {};
envFile.split('\n').forEach(line => {
  const [k, v] = line.split('=');
  if (k && v) env[k.trim()] = v.trim();
});

const url = env['VITE_SUPABASE_URL'];
const key = env['VITE_SUPABASE_KEY'];

async function run() {
  console.log("Fetching logs for 2025-11...");
  const res = await fetch(`${url}/rest/v1/shockwave_patient_logs?date=gte.2025-11-01&date=lte.2025-11-30&select=*`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  const data = await res.json();
  console.log("Logs in Nov:", data.map(d => `${d.date} | ${d.patient_name} | source: ${d.source}`).join('\n'));

  console.log("\nFetching schedules for 2025-11...");
  const res2 = await fetch(`${url}/rest/v1/shockwave_schedules?year=eq.2025&month=eq.11&select=*`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  const data2 = await res2.json();
  console.log("Schedules in Nov:", data2.filter(d => d.content || d.bg_color).map(d => `Week ${d.week_index} Day ${d.day_index} Row ${d.row_index} Col ${d.col_index} | ${d.content} | ${d.bg_color}`).join('\n'));
}
run();

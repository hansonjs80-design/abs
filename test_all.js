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
  const res = await fetch(`${url}/rest/v1/shockwave_schedules?select=year,month`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  const data = await res.json();
  const uniqueMonths = new Set(data.map(d => `${d.year}-${d.month}`));
  console.log("Months with Shockwave schedules:", Array.from(uniqueMonths));

  const res2 = await fetch(`${url}/rest/v1/manual_therapy_schedules?select=year,month`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  const data2 = await res2.json();
  const uniqueMonths2 = new Set(data2.map(d => `${d.year}-${d.month}`));
  console.log("Months with Manual Therapy schedules:", Array.from(uniqueMonths2));
  
  const logsRes = await fetch(`${url}/rest/v1/shockwave_patient_logs?select=date`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  const logsData = await logsRes.json();
  const logDates = new Set(logsData.map(d => d.date.substring(0, 7)));
  console.log("Months with Shockwave logs:", Array.from(logDates));
}
run();

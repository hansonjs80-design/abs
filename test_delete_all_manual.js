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
  console.log("Deleting all source=manual from shockwave_patient_logs...");
  const res = await fetch(`${url}/rest/v1/shockwave_patient_logs?source=eq.manual`, {
    method: 'DELETE',
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  console.log("Delete status:", res.status, res.statusText);

  console.log("Deleting all source=manual from manual_therapy_patient_logs...");
  const res2 = await fetch(`${url}/rest/v1/manual_therapy_patient_logs?source=eq.manual`, {
    method: 'DELETE',
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  console.log("Delete status:", res2.status, res2.statusText);
}
run();

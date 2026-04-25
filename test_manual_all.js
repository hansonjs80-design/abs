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
  const res = await fetch(`${url}/rest/v1/shockwave_patient_logs?source=eq.manual&select=id`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  const data = await res.json();
  console.log("Total manual shockwave logs:", data.length);

  const res2 = await fetch(`${url}/rest/v1/manual_therapy_patient_logs?source=eq.manual&select=id`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  const data2 = await res2.json();
  console.log("Total manual therapy logs:", data2.length);
}
run();

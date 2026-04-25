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
  const res = await fetch(`${url}/rest/v1/shockwave_patient_logs?date=eq.2025-11-06&select=id`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  const data = await res.json();
  console.log("IDs to delete:", data.map(d => d.id));

  if (data.length > 0) {
    const ids = data.map(d => d.id);
    const deleteRes = await fetch(`${url}/rest/v1/shockwave_patient_logs?id=in.(${ids.join(',')})`, {
      method: 'DELETE',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
    });
    console.log("Delete status:", deleteRes.status, deleteRes.statusText);
    const deleteText = await deleteRes.text();
    console.log("Delete response:", deleteText);
  }
}
run();

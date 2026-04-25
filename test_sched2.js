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
  const res = await fetch(`${url}/rest/v1/shockwave_schedules?year=eq.2026&month=eq.4&select=*`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  const data = await res.json();
  const d04 = data.find(d => d.memos && JSON.stringify(d.memos).includes('이기원'));
  if (d04) {
    const memos = typeof d04.memos === 'string' ? JSON.parse(d04.memos) : d04.memos;
    for (const [k, v] of Object.entries(memos)) {
       if (JSON.stringify(v).includes('이기원') || k.startsWith('0-5-')) {
           console.log(k, v);
       }
    }
  }
}
run();

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
  data.forEach(d => {
    const memosStr = typeof d.memos === 'string' ? d.memos : JSON.stringify(d.memos);
    if (memosStr && memosStr.includes('7068')) {
      console.log(`Found in year ${d.year} month ${d.month} week ${d.week_index} day ${d.day_index}`);
      const memos = typeof d.memos === 'string' ? JSON.parse(d.memos) : d.memos;
      for (const [k, v] of Object.entries(memos)) {
         if (k.startsWith(`${d.week_index}-${d.day_index}-`)) {
            console.log(k, JSON.stringify(v));
         }
      }
    }
  });
}
run();

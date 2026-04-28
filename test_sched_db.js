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
  // Find the exact day: 2026. 04. 04 (Saturday)
  // April 1, 2026 is a Wednesday.
  // April 4, 2026 is a Saturday.
  // In the calendar, week 0 is March 29 - April 4.
  // April 4 is Week 0, Day 6 (if Sunday is 0) or Day 5 (if Monday is 0).
  // The user's code probably uses Day 6 for Saturday.
  const d04 = data.find(d => d.year === 2026 && d.month === 4 && d.week_index === 0 && d.day_index === 6);
  if (d04) {
    const memos = typeof d04.memos === 'string' ? JSON.parse(d04.memos) : d04.memos;
    for (const [k, v] of Object.entries(memos)) {
        console.log(k, JSON.stringify(v));
    }
  } else {
    console.log("No data for Week 0 Day 6");
  }
}
run();

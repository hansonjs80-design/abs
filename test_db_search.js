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
  
  for (const day of data) {
    if (!day.memos) continue;
    const memos = typeof day.memos === 'string' ? JSON.parse(day.memos) : day.memos;
    for (const [k, v] of Object.entries(memos)) {
        if (v.content && (v.content.includes('이기원') || v.content.includes('오다영'))) {
            console.log("Found in day:", day.week_index, day.day_index);
            for (let i = 0; i < 15; i++) {
                const cellKey = `${day.week_index}-${day.day_index}-${i}-0`;
                const cell = memos[cellKey];
                if (cell) {
                    console.log(`Row ${i}:`, JSON.stringify({ content: cell.content, merge_span: cell.merge_span }));
                } else {
                    console.log(`Row ${i}: null`);
                }
            }
            return;
        }
    }
  }
  console.log("Not found in schedules.");
}
run();

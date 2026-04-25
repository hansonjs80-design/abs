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
  const res = await fetch(`${url}/rest/v1/shockwave_schedules?select=*`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  const data = await res.json();
  data.forEach(d => {
     const memosStr = typeof d.memos === 'string' ? d.memos : JSON.stringify(d.memos);
     if (memosStr && memosStr.includes('이기원')) {
         console.log(`Found in year ${d.year} month ${d.month}`);
         const memos = typeof d.memos === 'string' ? JSON.parse(d.memos) : d.memos;
         for (const [k, v] of Object.entries(memos)) {
             // 2026-04-04 is Week 0, Day 5. Col 0 is "주한솔", Col 1 is "신수민", Col 2 is "김경숙"? Wait, in the image, "김" is Col 2.
             if (k.startsWith('0-5-0')) {
                 console.log(k, v);
             }
         }
     }
  });
}
run();

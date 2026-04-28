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
  const schedules = await res.json();
  
  let totalFixed = 0;

  for (const schedule of schedules) {
    if (!schedule.memos) continue;
    
    let memosObj = typeof schedule.memos === 'string' ? JSON.parse(schedule.memos) : schedule.memos;
    let modified = false;

    for (const [cellKey, cellData] of Object.entries(memosObj)) {
      if (cellData && cellData.merge_span && cellData.merge_span.mergedInto) {
        const masterKey = cellData.merge_span.mergedInto;
        const masterData = memosObj[masterKey];
        
        let isInvalid = false;
        if (!masterData || !masterData.merge_span || masterData.merge_span.rowSpan <= 1) {
          isInvalid = true;
        } else {
          const [w, d, r, c] = cellKey.split('-').map(Number);
          const [mw, md, mr, mc] = masterKey.split('-').map(Number);
          if (mw === w && md === d && mc === c) {
            const endRow = mr + (masterData.merge_span.rowSpan || 1) - 1;
            if (r < mr || r > endRow) {
              isInvalid = true;
            }
          } else {
            isInvalid = true;
          }
        }

        if (isInvalid) {
          cellData.merge_span.mergedInto = null;
          modified = true;
          totalFixed++;
        }
      }
    }

    if (modified) {
      // Upsert back
      const updateRes = await fetch(`${url}/rest/v1/shockwave_schedules?id=eq.${schedule.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ memos: memosObj })
      });
      if (!updateRes.ok) {
         console.log("Failed to update:", schedule.id, await updateRes.text());
      }
    }
  }
  console.log(`Database cleanup complete. Fixed ${totalFixed} invalid merge references.`);
}
run();

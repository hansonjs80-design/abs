import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import { buildCrossMonthMirroredPayloads } from './src/lib/calendarUtils.js';

let env = '';
if (fs.existsSync('.env')) env = fs.readFileSync('.env', 'utf-8');

let supabaseUrl = '';
let supabaseKey = '';
for (const line of env.split('\n')) {
  if (line.startsWith('VITE_SUPABASE_URL=')) supabaseUrl = line.split('=')[1].trim();
  if (line.startsWith('VITE_SUPABASE_KEY=')) supabaseKey = line.split('=')[1].trim();
}
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const upsertData = {
    year: 2026, month: 4, week_index: 4, day_index: 3, row_index: 31, col_index: 0,
    content: 'Test 31',
    updated_at: new Date().toISOString(),
    merge_span: undefined
  };

  const upsertPayloads = buildCrossMonthMirroredPayloads([upsertData]);
  console.log("Upsert Payloads:", upsertPayloads);

  const { data, error } = await supabase
    .from('shockwave_schedules')
    .upsert(upsertPayloads, {
      onConflict: 'year,month,week_index,day_index,row_index,col_index'
    })
    .select();

  console.log("Error:", error);
  console.log("Inserted length:", data ? data.length : 0);
  
  if (data) {
     const m4 = data.find(d => d.month === 4);
     const m5 = data.find(d => d.month === 5);
     console.log("Has m4?", !!m4, "Has m5?", !!m5);
  }
}

test();

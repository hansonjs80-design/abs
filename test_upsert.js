import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

let env = '';
if (fs.existsSync('.env.local')) env = fs.readFileSync('.env.local', 'utf-8');
else if (fs.existsSync('.env')) env = fs.readFileSync('.env', 'utf-8');

let supabaseUrl = '';
let supabaseKey = '';
for (const line of env.split('\n')) {
  if (line.startsWith('VITE_SUPABASE_URL=')) supabaseUrl = line.split('=')[1].trim();
  if (line.startsWith('VITE_SUPABASE_ANON_KEY=')) supabaseKey = line.split('=')[1].trim();
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const payload1 = {
    year: 2026, month: 4, week_index: 4, day_index: 3, row_index: 2, col_index: 1, content: 'Test1'
  };
  const payload2 = {
    year: 2026, month: 5, week_index: 0, day_index: 3, row_index: 2, col_index: 1, content: 'Test1'
  };

  const { data, error } = await supabase
    .from('shockwave_schedules')
    .upsert([payload1, payload2], {
      onConflict: 'year,month,week_index,day_index,row_index,col_index'
    })
    .select();

  console.log("Error:", error);
  console.log("Data:", data);
}

test();

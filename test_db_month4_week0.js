import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

let env = '';
if (fs.existsSync('.env')) env = fs.readFileSync('.env', 'utf-8');

let supabaseUrl = '';
let supabaseKey = '';
for (const line of env.split('\n')) {
  if (line.startsWith('VITE_SUPABASE_URL=')) supabaseUrl = line.split('=')[1].trim();
  if (line.startsWith('VITE_SUPABASE_KEY=')) supabaseKey = line.split('=')[1].trim();
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase
    .from('shockwave_schedules')
    .select('week_index, day_index, row_index, col_index, content')
    .eq('year', 2026)
    .eq('month', 4)
    .neq('content', '')
    .not('content', 'is', null);

  console.log("All non-empty data in Month 4:");
  data.forEach(r => {
    console.log(`Week ${r.week_index}, Day ${r.day_index}, Row ${r.row_index}, Col ${r.col_index}: ${r.content}`);
  });
}
check();

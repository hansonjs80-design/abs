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
  const { data: m4Data } = await supabase
    .from('shockwave_schedules')
    .select('content, merge_span')
    .eq('year', 2026).eq('month', 4).eq('week_index', 4).eq('day_index', 3).eq('row_index', 4).eq('col_index', 1);

  console.log("Month 4 Row 4 Col 1:", m4Data);
  
  const { data: m5Data } = await supabase
    .from('shockwave_schedules')
    .select('content, merge_span')
    .eq('year', 2026).eq('month', 5).eq('week_index', 0).eq('day_index', 3).eq('row_index', 4).eq('col_index', 1);

  console.log("Month 5 Row 4 Col 1:", m5Data);
}
check();

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
  const { data } = await supabase
    .from('shockwave_schedules')
    .select('week_index, day_index, row_index, col_index, content, merge_span')
    .eq('year', 2026)
    .eq('month', 4)
    .eq('week_index', 4)
    .eq('day_index', 3)
    .not('content', 'is', null);

  console.log(data);
}
check();

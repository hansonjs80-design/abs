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
  const { data: m4 } = await supabase
    .from('shockwave_schedules')
    .select('row_index, col_index, content')
    .eq('year', 2026).eq('month', 4).eq('week_index', 4).eq('day_index', 3)
    .order('row_index').order('col_index');
    
  const { data: m5 } = await supabase
    .from('shockwave_schedules')
    .select('row_index, col_index, content')
    .eq('year', 2026).eq('month', 5).eq('week_index', 0).eq('day_index', 3)
    .order('row_index').order('col_index');

  const m4Map = {}; m4.forEach(r => { if(r.content) m4Map[`${r.row_index}-${r.col_index}`] = r.content; });
  const m5Map = {}; m5.forEach(r => { if(r.content) m5Map[`${r.row_index}-${r.col_index}`] = r.content; });

  console.log("Month 4 (April calendar):", m4Map);
  console.log("Month 5 (May calendar):", m5Map);
}
check();

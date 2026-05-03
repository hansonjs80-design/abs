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
    .select('*')
    .eq('year', 2026)
    .eq('month', 4);

  const memoMap4 = {};
  (m4Data || []).forEach(item => {
    const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
    memoMap4[key] = item;
  });

  console.log("Is 4-3-4-1 (April 30th Row 4 Col 1) present in Month 4?:", !!memoMap4['4-3-4-1']);
  if (memoMap4['4-3-4-1']) console.log("Content:", memoMap4['4-3-4-1'].content);
  
  const { data: m5Data } = await supabase
    .from('shockwave_schedules')
    .select('*')
    .eq('year', 2026)
    .eq('month', 5);

  const memoMap5 = {};
  (m5Data || []).forEach(item => {
    const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
    memoMap5[key] = item;
  });

  console.log("Is 0-3-4-1 (April 30th Row 4 Col 1) present in Month 5?:", !!memoMap5['0-3-4-1']);
  if (memoMap5['0-3-4-1']) console.log("Content:", memoMap5['0-3-4-1'].content);
}
check();

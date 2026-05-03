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
    .select('*')
    .eq('year', 2026)
    .eq('month', 4)
    .order('week_index', { ascending: true })
    .order('day_index', { ascending: true })
    .order('row_index', { ascending: true })
    .order('col_index', { ascending: true });

  const memoMap = {};
  (data || []).forEach(item => {
    const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
    memoMap[key] = item;
  });

  console.log("Number of items in DB for month 4:", data?.length);
  console.log("Has 4-3-4-1 (14501/조아라)?", !!memoMap['4-3-4-1']);
  console.log("Has 4-3-6-0 (14364/박문정)?", !!memoMap['4-3-6-0']);
  console.log("Has 4-1-18-1 (14364/박문정)?", !!memoMap['4-1-18-1']);
}
check();

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
    .select('week_index,day_index,row_index,col_index,content,prescription,merge_span,bg_color')
    .eq('year', 2026)
    .eq('month', 6)
    .eq('week_index', 2)
    .eq('day_index', 5)
    .order('row_index')
    .order('col_index');

  if (error) {
    console.error("Error fetching schedules:", error);
  } else {
    console.log("June 20, 2026 (Saturday) schedules:");
    data.forEach(s => {
      console.log(`Row ${s.row_index}, Col ${s.col_index}: Content="${s.content}", Prescription="${s.prescription}", MergeSpan=${JSON.stringify(s.merge_span)}`);
    });
  }
}

check();

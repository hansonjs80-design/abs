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
    .select('row_index,col_index,content,prescription,merge_span')
    .eq('year', 2026)
    .eq('month', 6)
    .eq('week_index', 1)
    .eq('day_index', 4)
    .eq('col_index', 0)
    .order('row_index');

  if (error) {
    console.error(error);
  } else {
    console.log("June 12, 2026 (Friday) Ju Han-sol column schedules:");
    data.forEach(s => {
      console.log(`Row ${s.row_index}: Content="${s.content}", Prescription="${s.prescription}", MergeSpan=${JSON.stringify(s.merge_span)}`);
    });
  }
}

check();

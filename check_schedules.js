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
    .select('week_index,day_index,row_index,col_index,content,prescription,merge_span')
    .eq('year', 2026)
    .eq('month', 6)
    .order('week_index')
    .order('day_index')
    .order('row_index')
    .order('col_index');

  if (error) {
    console.error("Error fetching schedules:", error);
  } else {
    // 6월 22일 월요일은 week_index: 3 (4주차), day_index: 0 (월요일)
    const mondaySchedules = data.filter(s => s.week_index === 3 && s.day_index === 0 && s.content !== '');
    console.log("Monday June 22 schedules:");
    mondaySchedules.forEach(s => {
      console.log(`Row ${s.row_index}, Col ${s.col_index}: Content="${s.content}", Prescription="${s.prescription}", MergeSpan=${JSON.stringify(s.merge_span)}`);
    });
  }
}

check();

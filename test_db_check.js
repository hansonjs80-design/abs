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
    .select('*')
    .eq('year', 2026)
    .eq('month', 4)
    .eq('week_index', 4)
    .eq('day_index', 3);
  
  console.log("April 30th (month=4) in DB:");
  data.forEach(row => {
    if (row.content) console.log(`Row ${row.row_index}, Col ${row.col_index}: ${row.content}`);
  });

  const { data: mayData } = await supabase
    .from('shockwave_schedules')
    .select('*')
    .eq('year', 2026)
    .eq('month', 5)
    .eq('week_index', 0)
    .eq('day_index', 3);
  
  console.log("\nApril 30th (month=5) in DB:");
  mayData.forEach(row => {
    if (row.content) console.log(`Row ${row.row_index}, Col ${row.col_index}: ${row.content}`);
  });
}

check();

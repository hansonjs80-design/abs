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
    .order('updated_at', { ascending: false })
    .limit(3);
  
  console.log("Most recent updates in DB:");
  data.forEach(row => {
    console.log(`Month ${row.month}, Row ${row.row_index}, Col ${row.col_index}: ${row.content} (updated_at: ${row.updated_at})`);
  });
}

check();

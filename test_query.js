import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase
    .from('shockwave_schedules')
    .select('year, month, week_index, day_index, content')
    .ilike('content', '%조다슬%');

  if (error) {
    console.error('Error:', error);
  } else {
    console.log(`Found ${data.length} records in shockwave_schedules`);
    console.log(data);
  }
}
run();

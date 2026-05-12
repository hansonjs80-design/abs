import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data: schedules } = await supabase
    .from('shockwave_schedules')
    .select('year,month,week_index,day_index,row_index,col_index,bg_color,content')
    .neq('bg_color', null)
    .limit(10);
  
  console.log("Schedules with bg_color:", schedules.map(s => ({...s, bg_color: s.bg_color})));

  const { data: stats } = await supabase
    .from('shockwave_patient_logs')
    .select('id,scheduler_cell_key,patient_name,date')
    .limit(5);

  console.log("Stats sample:", stats);
}

check();

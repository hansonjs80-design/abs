import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.log("Missing Supabase config");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase
    .from('shockwave_patient_logs')
    .select('*')
    .gte('date', '2025-11-01')
    .lte('date', '2025-11-30')
    .order('date');

  console.log('Error:', error);
  console.log('Count:', data?.length);
  console.log('Data:', JSON.stringify(data, null, 2));
}

run();

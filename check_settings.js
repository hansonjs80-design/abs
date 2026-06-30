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
    .from('shockwave_settings')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    console.error("Error fetching settings:", error);
  } else {
    console.log("Settings id:", data.id);
    console.log("Interval minutes:", data.interval_minutes);
    console.log("Time label interval:", data.time_label_interval_minutes);
    console.log("Manual therapy duration minutes:", data.manual_therapy_duration_minutes);
    console.log("Duration minutes:", data.duration_minutes);
  }
}

check();

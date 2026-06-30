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

async function run() {
  console.log("Updating shockwave_settings to 20 minutes interval...");
  const { error } = await supabase
    .from('shockwave_settings')
    .update({
      interval_minutes: 20,
      time_label_interval_minutes: 20
    })
    .eq('id', '00000000-0000-0000-0000-000000000000');

  if (error) {
    console.error("Error updating settings:", error);
  } else {
    console.log("Successfully updated settings to 20 minutes!");
  }
}

run();

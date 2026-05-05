const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envContent = fs.readFileSync('.env', 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  if (line && line.includes('=')) {
    const parts = line.split('=');
    env[parts[0]] = parts.slice(1).join('=').trim();
  }
});

const url = env['VITE_SUPABASE_URL'];
const key = env['VITE_SUPABASE_ANON_KEY'];

const supabase = createClient(url, key);

async function run() {
  const { data, error } = await supabase
    .from('shockwave_schedules')
    .select('year, month, week_index, day_index, content')
    .ilike('content', '%조다슬%');

  if (error) {
    console.error('Error:', error);
  } else {
    console.log(`Found ${data.length} records in shockwave_schedules for 조다슬`);
    console.log(data);
  }
}
run();

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const lines = fs.readFileSync('.env', 'utf-8').split('\n');
let url = '', key = '';
for (const line of lines) {
  if (line.startsWith('VITE_SUPABASE_URL=')) url = line.split('=')[1];
  if (line.startsWith('VITE_SUPABASE_KEY=')) key = line.split('=')[1];
}

const supabase = createClient(url, key);

async function test() {
  const { data, error } = await supabase.from('shockwave_therapists').select('*');
  console.log('Error:', error);
  console.log('Data:', data);
}
test();

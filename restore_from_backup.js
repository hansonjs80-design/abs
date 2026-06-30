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
  const rawData = fs.readFileSync('backup_2026_06.json', 'utf-8');
  const backupSchedules = JSON.parse(rawData);

  console.log(`Loaded ${backupSchedules.length} schedules from backup.`);

  console.log("Deleting all current June 2026 schedules from DB...");
  const { error: deleteErr } = await supabase
    .from('shockwave_schedules')
    .delete()
    .eq('year', 2026)
    .eq('month', 6);

  if (deleteErr) {
    console.error("Delete error:", deleteErr);
    return;
  }
  console.log("Deleted current June 2026 schedules.");

  console.log("Restoring schedules from backup file...");
  const chunkSize = 100;
  for (let i = 0; i < backupSchedules.length; i += chunkSize) {
    const chunk = backupSchedules.slice(i, i + chunkSize);
    const sanitizedChunk = chunk.map(item => {
      const copy = { ...item };
      return copy;
    });

    const { error: insertErr } = await supabase
      .from('shockwave_schedules')
      .insert(sanitizedChunk);

    if (insertErr) {
      console.error("Insert error at chunk", i, insertErr);
      return;
    }
  }

  console.log("Restoration from backup completed successfully!");
}

run();

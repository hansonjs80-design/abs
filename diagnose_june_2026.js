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

async function diagnose() {
  console.log("Fetching all schedules for 2026-06...");
  
  let allSchedules = [];
  let page = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('shockwave_schedules')
      .select('*')
      .eq('year', 2026)
      .eq('month', 6)
      .range(page * 1000, (page + 1) * 1000 - 1);
      
    if (error) {
      console.error(error);
      return;
    }
    if (data) allSchedules.push(...data);
    if (!data || data.length < 1000) hasMore = false;
    page++;
  }
  
  console.log(`Fetched ${allSchedules.length} schedules.`);

  const prescriptions = new Set();
  const rowSpans = new Set();
  const sampleMap = {};

  allSchedules.forEach(item => {
    if (item.prescription) {
      prescriptions.add(item.prescription);
      const span = item.merge_span?.rowSpan || 1;
      const key = `${item.prescription}-${span}`;
      if (!sampleMap[key]) {
        sampleMap[key] = {
          content: item.content,
          rowSpan: span,
          mergedInto: item.merge_span?.mergedInto
        };
      }
    }
    if (item.merge_span && item.merge_span.rowSpan !== undefined) {
      rowSpans.add(item.merge_span.rowSpan);
    }
  });

  console.log("\nUnique Prescriptions in June 2026:");
  console.log(Array.from(prescriptions));

  console.log("\nUnique rowSpan values in June 2026:");
  console.log(Array.from(rowSpans));

  console.log("\nSamples of prescription + rowSpan combinations:");
  console.log(sampleMap);
}

diagnose();

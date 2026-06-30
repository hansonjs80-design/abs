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
  // 2026년 6월 4일 목요일 (week_index = 1, day_index = 3)의 col_index = 0 (주한솔) 데이터 쿼리
  const { data, error } = await supabase
    .from('shockwave_schedules')
    .select('*')
    .eq('year', 2026)
    .eq('month', 6)
    .eq('week_index', 1)
    .eq('day_index', 3)
    .order('col_index', { ascending: true })
    .order('row_index', { ascending: true });

  if (error) {
    console.error("Error query:", error);
    process.exit(1);
  }

  console.log("=== Thursday Week 1 Day 3 Col 0 Schedules ===");
  console.log(JSON.stringify(data.filter(item => item.content.trim() !== ''), null, 2));
  
  // 전체 데이터도 요약 출력
  console.log("\n=== All Slot Rows for Thursday Col 0 ===");
  data.forEach(item => {
    console.log(`Row ${item.row_index}: Content="${item.content}", Prescription="${item.prescription}", merge_span=${JSON.stringify(item.merge_span)}`);
  });
}

run();

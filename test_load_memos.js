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

function shouldKeepShockwaveMemo(memo) {
  if (!memo) return false;
  if (memo.content && memo.content.trim() !== '') return true;
  if (memo.bg_color) return true;
  if (memo.body_part) return true;
  if (memo.prescription) return true;
  if (memo.merge_span && (memo.merge_span.rowSpan > 1 || memo.merge_span.colSpan > 1 || memo.merge_span.mergedInto)) return true;
  return false;
}

async function check() {
  const year = 2026;
  const month = 4;
  
  const { data, error } = await supabase
    .from('shockwave_schedules')
    .select('*')
    .eq('year', year)
    .eq('month', month);

  const memoMap = {};
  (data || []).forEach(item => {
    const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
    memoMap[key] = item;
  });

  const prev = {
    // Fake May data
    '0-3-4-1': { year: 2026, month: 5, week_index: 0, day_index: 3, row_index: 4, col_index: 1, content: '14501/조아라(2)' }
  };

  const next = { ...memoMap };
  Object.entries(prev || {}).forEach(([key, memo]) => {
    if (memo?.year !== year || memo?.month !== month) return;
    if (next[key]) return;
    if (shouldKeepShockwaveMemo(memo)) next[key] = memo;
  });

  console.log("Is 4-3-4-1 present in next?", !!next['4-3-4-1']);
  if (next['4-3-4-1']) {
    console.log("Content:", next['4-3-4-1'].content);
  } else {
    console.log("WHY IS IT NOT IN NEXT?!");
  }
}
check();

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
  const { data, error } = await supabase
    .from('shockwave_schedules')
    .select('*')
    .eq('year', 2026)
    .eq('month', 6);

  if (error) {
    console.error(error);
    process.exit(1);
  }

  // 동일한 week_index, day_index, col_index 에서 content가 비어있지 않은 레코드들을 분석
  const keyMap = new Map();
  const duplicates = [];

  data.forEach(item => {
    if (!item.content.trim()) return;
    
    // 치료사 열, 날짜, 내용이 동일한 경우 체크
    // (예약 시간이 다른데 내용이 같은 것은 연달아 예약한 경우일 수 있으므로 제외)
    // 치료사 열, 날짜, 시간(row_index)까지 완전히 똑같은 것은 UNIQUE 제약 조건 때문에 DB에 존재할 수 없음
    // 그렇다면 사용자가 말한 중복 셀은:
    // "도수치료가 병합되었는데, 병합된 아래 셀들에 텍스트가 지워지지 않고 그대로 남아서 중복되어 보이는 경우" 일 것임
    const mergeSpan = item.merge_span || {};
    
    if (mergeSpan.mergedInto) {
      // 병합된 하위 셀인데 content가 들어있는 경우!
      // 이것이 바로 렌더링 상의 중복 셀의 원인입니다!
      duplicates.push({
        type: 'merged-with-content',
        item
      });
    }
  });

  console.log(`=== Found ${duplicates.length} abnormal cells (merged cell with content) ===`);
  duplicates.forEach(({ type, item }) => {
    console.log(`Abnormal Cell: Key=${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}, Content="${item.content}", mergedInto="${item.merge_span.mergedInto}"`);
  });

  if (duplicates.length > 0) {
    console.log("\nFixing abnormal cells (clearing content of merged-into cells)...");
    
    const updates = duplicates.map(({ item }) => ({
      ...item,
      content: '', // content를 빈 값으로 청소
      prescription: null,
      body_part: null,
      bg_color: null
    }));

    const { error: updateError } = await supabase
      .from('shockwave_schedules')
      .upsert(updates, { onConflict: 'year,month,week_index,day_index,row_index,col_index' });

    if (updateError) {
      console.error("Error fixing cells:", updateError);
    } else {
      console.log("Successfully cleared duplicate content in merged cells!");
    }
  }
}

run();

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// 1. Supabase 환경변수 로드
let env = '';
if (fs.existsSync('.env')) env = fs.readFileSync('.env', 'utf-8');

let supabaseUrl = '';
let supabaseKey = '';
for (const line of env.split('\n')) {
  if (line.startsWith('VITE_SUPABASE_URL=')) supabaseUrl = line.split('=')[1].trim();
  if (line.startsWith('VITE_SUPABASE_KEY=')) supabaseKey = line.split('=')[1].trim();
}

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase URL or Key not found in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 2. mergedInto 키 변환 헬퍼 함수 (예: "1-3-4-0" -> "1-3-8-0")
function scaleMergedIntoKey(mergedInto, scale = 2) {
  if (!mergedInto || typeof mergedInto !== 'string') return mergedInto;
  const parts = mergedInto.split('-');
  if (parts.length === 4) {
    const r = Number(parts[2]);
    if (Number.isFinite(r)) {
      parts[2] = String(r * scale);
    }
  }
  return parts.join('-');
}

async function migrate() {
  console.log("1. Fetching 2026-06 schedules from database...");
  
  let allData = [];
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
      console.error("Error fetching data:", error);
      process.exit(1);
    }
    
    if (data) allData.push(...data);
    if (!data || data.length < 1000) hasMore = false;
    page++;
  }

  console.log(`Fetched ${allData.length} records.`);
  
  // 3. 백업 저장
  fs.writeFileSync('backup_2026_06.json', JSON.stringify(allData, null, 2));
  console.log("Backup saved to backup_2026_06.json");

  // 4. 데이터 스케일링 마이그레이션 (20분 -> 10분이므로 2배)
  const SCALE = 2;
  const migratedData = allData.map(item => {
    const newItem = { ...item };
    
    // row_index 2배 증가
    newItem.row_index = item.row_index * SCALE;
    
    // merge_span 보정
    if (item.merge_span) {
      const newMergeSpan = { ...item.merge_span };
      
      if (typeof newMergeSpan.rowSpan === 'number') {
        newMergeSpan.rowSpan = newMergeSpan.rowSpan * SCALE;
      }
      
      if (newMergeSpan.mergedInto) {
        newMergeSpan.mergedInto = scaleMergedIntoKey(newMergeSpan.mergedInto, SCALE);
      }
      
      newItem.merge_span = newMergeSpan;
    }
    
    // id, created_at, updated_at 등은 기존 값 유지 (insert 시 충돌 없도록 id는 제거)
    delete newItem.id;
    delete newItem.created_at;
    delete newItem.updated_at;
    
    return newItem;
  });

  console.log("2. Deleting old 2026-06 records from database...");
  const { error: deleteError } = await supabase
    .from('shockwave_schedules')
    .delete()
    .eq('year', 2026)
    .eq('month', 6);

  if (deleteError) {
    console.error("Error deleting old records:", deleteError);
    process.exit(1);
  }
  console.log("Old records deleted.");

  console.log("3. Inserting migrated records...");
  
  // 일괄 삽입 (크기가 클 수 있으므로 200개씩 청크 단위로 나누어 삽입)
  const chunkSize = 200;
  for (let i = 0; i < migratedData.length; i += chunkSize) {
    const chunk = migratedData.slice(i, i + chunkSize);
    const { error: insertError } = await supabase
      .from('shockwave_schedules')
      .insert(chunk);

    if (insertError) {
      console.error(`Error inserting chunk at index ${i}:`, insertError);
      console.log("Restoring backup...");
      // 실패 시 복구
      const backupData = JSON.parse(fs.readFileSync('backup_2026_06.json', 'utf-8'));
      const cleanBackup = backupData.map(b => {
        const temp = { ...b };
        delete temp.id;
        delete temp.created_at;
        delete temp.updated_at;
        return temp;
      });
      await supabase.from('shockwave_schedules').insert(cleanBackup);
      console.log("Backup restored successfully.");
      process.exit(1);
    }
  }

  console.log("Migration completed successfully! All records scaled for 10-minute slot settings.");
}

migrate();

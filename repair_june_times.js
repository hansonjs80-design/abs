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
      .order('id')
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

  // Group by week_index-day_index
  const dateGroups = {};
  allSchedules.forEach(item => {
    const key = `${item.week_index}-${item.day_index}`;
    if (!dateGroups[key]) dateGroups[key] = [];
    dateGroups[key].push(item);
  });

  const targetDatesToMigrate = [];

  for (const [dateKey, items] of Object.entries(dateGroups)) {
    const itemsWithTime = items.filter(item => item.merge_span?.meta?.reservation_time);
    
    if (itemsWithTime.length === 0) {
      // Check max row_index and rowSpan patterns
      const maxRowIndex = Math.max(...items.map(item => item.row_index));
      const has10MinSpan = items.some(item => {
        const presc = item.prescription || '';
        const span = item.merge_span?.rowSpan || 1;
        return (presc.includes('40분') && span === 4) || (presc.includes('60분') && span === 6);
      });

      if (maxRowIndex >= 27 || has10MinSpan) {
        console.log(`Date ${dateKey} classified as 10-min because max row_index is ${maxRowIndex} or has 10-min spans.`);
        targetDatesToMigrate.push(dateKey);
      }
      continue;
    }

    let score10 = 0;
    let score20 = 0;

    itemsWithTime.forEach(item => {
      const resTime = item.merge_span.meta.reservation_time;
      const [hh, mm] = resTime.split(':').map(Number);
      const targetMinutes = hh * 60 + mm;
      
      const time10 = 9 * 60 + item.row_index * 10;
      const time20 = 9 * 60 + item.row_index * 20;

      score10 += Math.abs(targetMinutes - time10);
      score20 += Math.abs(targetMinutes - time20);
    });

    const avgDiff10 = score10 / itemsWithTime.length;
    const avgDiff20 = score20 / itemsWithTime.length;

    console.log(`Date ${dateKey}: avgDiff10 = ${avgDiff10.toFixed(1)} mins, avgDiff20 = ${avgDiff20.toFixed(1)} mins`);

    if (avgDiff10 < avgDiff20 && avgDiff10 < 15 && avgDiff20 > 25) {
      console.log(`-> Date ${dateKey} classified as 10-min standard.`);
      targetDatesToMigrate.push(dateKey);
    } else {
      console.log(`-> Date ${dateKey} classified as 20-min standard.`);
    }
  }

  console.log(`\nFound ${targetDatesToMigrate.length} dates to migrate to 20-min intervals:`, targetDatesToMigrate);

  if (targetDatesToMigrate.length === 0) {
    console.log("No dates need migration.");
    return;
  }

  const toUpsert = [];
  const toDelete = [];

  for (const dateKey of targetDatesToMigrate) {
    const items = dateGroups[dateKey];
    const idsToDelete = items.map(item => item.id).filter(Boolean);
    toDelete.push(...idsToDelete);

    const scale = 0.5;
    const migratedSchedules = items.map(item => {
      const newItem = { ...item };
      newItem.row_index = Math.round(item.row_index * scale);
      
      if (item.merge_span) {
        const newMergeSpan = { ...item.merge_span };
        if (typeof newMergeSpan.rowSpan === 'number') {
          if (item.merge_span.rowSpan === 1) {
            newMergeSpan.rowSpan = 1;
          } else {
            newMergeSpan.rowSpan = Math.max(1, Math.round(newMergeSpan.rowSpan * scale));
          }
        }
        if (newMergeSpan.mergedInto) {
          const parts = newMergeSpan.mergedInto.split('-');
          if (parts.length === 4) {
            const r = Number(parts[2]);
            if (Number.isFinite(r)) {
              parts[2] = String(Math.round(r * scale));
            }
          }
          newMergeSpan.mergedInto = parts.join('-');
        }
        newItem.merge_span = newMergeSpan;
      }
      
      delete newItem.id;
      delete newItem.created_at;
      delete newItem.updated_at;
      return newItem;
    });

    toUpsert.push(...migratedSchedules);
  }

  console.log(`\nMigration execution:`);
  console.log(`- Dates to migrate: ${targetDatesToMigrate.length}`);
  console.log(`- Records to delete: ${toDelete.length}`);
  console.log(`- Records to insert: ${toUpsert.length}`);

  if (toDelete.length > 0) {
    console.log("Deleting old 10-min standard records...");
    const chunkSize = 100;
    for (let i = 0; i < toDelete.length; i += chunkSize) {
      const chunk = toDelete.slice(i, i + chunkSize);
      const { error } = await supabase
        .from('shockwave_schedules')
        .delete()
        .in('id', chunk);
      if (error) {
        console.error("Delete error:", error);
        return;
      }
    }
    console.log("Deleted successfully.");
  }

  if (toUpsert.length > 0) {
    console.log("De-duplicating migrated records to prevent key conflicts...");
    const uniqueUpsertMap = new Map();
    toUpsert.forEach(item => {
      const key = `${item.year}-${item.month}-${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
      const existing = uniqueUpsertMap.get(key);
      if (!existing) {
        uniqueUpsertMap.set(key, item);
      } else {
        const existingHasContent = existing.content && existing.content.trim() !== '';
        const itemHasContent = item.content && item.content.trim() !== '';
        
        if (!existingHasContent && itemHasContent) {
          uniqueUpsertMap.set(key, item);
        } else if (existingHasContent && itemHasContent) {
          console.warn(`[Conflict] Merging duplicate content on same cell: ${key}. Existing: "${existing.content}", New: "${item.content}"`);
          existing.content = `${existing.content} / ${item.content}`;
          if (item.prescription) {
            existing.prescription = existing.prescription ? `${existing.prescription}/${item.prescription}` : item.prescription;
          }
        }
      }
    });
    
    const uniqueUpsert = Array.from(uniqueUpsertMap.values());
    console.log(`De-duplicated from ${toUpsert.length} to ${uniqueUpsert.length} records.`);

    console.log("Inserting migrated 20-min standard records...");
    const chunkSize = 100;
    for (let i = 0; i < uniqueUpsert.length; i += chunkSize) {
      const chunk = uniqueUpsert.slice(i, i + chunkSize);
      const sanitizedChunk = chunk.map(item => {
        const copy = { ...item };
        delete copy.id;
        copy.updated_at = new Date().toISOString();
        return copy;
      });

      const { error } = await supabase
        .from('shockwave_schedules')
        .upsert(sanitizedChunk, {
          onConflict: 'year,month,week_index,day_index,row_index,col_index'
        });
      if (error) {
        console.error("Upsert error:", error);
        return;
      }
    }
    console.log("Upserted successfully.");
  }

  console.log("Migration complete.");
}

run();

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

  // Group by week_index-day_index-col_index
  const groups = {};
  allSchedules.forEach(item => {
    const gkey = `${item.week_index}-${item.day_index}-${item.col_index}`;
    if (!groups[gkey]) groups[gkey] = [];
    groups[gkey].push(item);
  });

  const toUpsert = [];
  const toDelete = [];

  for (const [gkey, items] of Object.entries(groups)) {
    const [w, d, c] = gkey.split('-').map(Number);
    
    // Find master cells (those that have content or prescription and are not mergedInto another cell)
    const masters = items.filter(item => {
      const isMerged = item.merge_span?.mergedInto;
      const hasContent = item.content && item.content.trim() !== '';
      const hasPresc = item.prescription && item.prescription.trim() !== '';
      return !isMerged && (hasContent || hasPresc);
    });

    const activeMerges = new Map(); // row_index -> master key string
    
    masters.forEach(m => {
      let rSpan = 1;
      const presc = m.prescription || '';
      if (presc.includes('40분')) {
        rSpan = 2;
      } else if (presc.includes('60분')) {
        rSpan = 3;
      } else {
        rSpan = 1;
      }

      const updatedMergeSpan = {
        rowSpan: rSpan,
        colSpan: 1,
        mergedInto: null,
        meta: m.merge_span?.meta || {}
      };
      
      toUpsert.push({
        ...m,
        merge_span: updatedMergeSpan
      });

      // Register the span of sub-cells that should be merged
      for (let offset = 1; offset < rSpan; offset++) {
        const subRow = m.row_index + offset;
        activeMerges.set(subRow, `${w}-${d}-${m.row_index}-${c}`);
      }
    });

    // Check all non-master items in the group
    items.forEach(item => {
      const isMaster = masters.some(m => m.row_index === item.row_index);
      if (isMaster) return;

      const expectedMergedInto = activeMerges.get(item.row_index);
      
      if (expectedMergedInto) {
        // This cell should be merged into a master
        const currentMergedInto = item.merge_span?.mergedInto;
        if (currentMergedInto !== expectedMergedInto) {
          toUpsert.push({
            ...item,
            content: '',
            prescription: null,
            bg_color: null,
            merge_span: {
              rowSpan: 1,
              colSpan: 1,
              mergedInto: expectedMergedInto,
              meta: {}
            }
          });
        }
      } else {
        // This cell should NOT be merged, and has no content (since it's a non-master)
        // We delete it from the database to keep it sparse and clean
        toDelete.push(item.id);
      }
    });

    // If there are required sub-merged cells but they don't exist in DB, create them
    for (const [subRow, masterKey] of activeMerges.entries()) {
      const exists = items.some(item => item.row_index === subRow);
      if (!exists) {
        toUpsert.push({
          year: 2026,
          month: 6,
          week_index: w,
          day_index: d,
          row_index: subRow,
          col_index: c,
          content: '',
          prescription: null,
          bg_color: null,
          merge_span: {
            rowSpan: 1,
            colSpan: 1,
            mergedInto: masterKey,
            meta: {}
          }
        });
      }
    }
  }

  console.log(`\nDry Run results:`);
  console.log(`- To Upsert: ${toUpsert.length}`);
  console.log(`- To Delete: ${toDelete.length}`);

  if (toDelete.length > 0) {
    console.log("Deleting orphaned/incorrect cells...");
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
    console.log("Upserting corrected master and merged cells...");
    const chunkSize = 100;
    for (let i = 0; i < toUpsert.length; i += chunkSize) {
      const chunk = toUpsert.slice(i, i + chunkSize);
      const sanitizedChunk = chunk.map(item => {
        const copy = { ...item };
        delete copy.id;
        delete copy.created_at;
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

  console.log("Restoration complete. Re-diagnosing to confirm...");
  await diagnose();
}

async function diagnose() {
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
  
  const sampleMap = {};
  allSchedules.forEach(item => {
    if (item.prescription) {
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
  });

  console.log("Diagnostics after restoration:");
  console.log(sampleMap);
}

run();

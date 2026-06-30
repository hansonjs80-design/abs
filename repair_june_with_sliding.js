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

  // 1. Group backup items by date (week_index-day_index-col_index)
  const groups = {};
  backupSchedules.forEach(item => {
    // Only process rows that have meaningful content
    const hasContent = item.content && item.content.trim() !== '';
    const hasPresc = item.prescription && item.prescription.trim() !== '';
    const isMerged = item.merge_span?.mergedInto;
    
    // We only migrate master cells (non-merged cells with content) first
    // We will regenerate mergedInto cells based on the new rowSpans later
    if (!isMerged && (hasContent || hasPresc)) {
      const gkey = `${item.week_index}-${item.day_index}-${item.col_index}`;
      if (!groups[gkey]) groups[gkey] = [];
      groups[gkey].push(item);
    }
  });

  const migratedMasters = [];
  const scale = 0.5;

  // 2. Perform scaling and sliding conflict resolution for master cells
  for (const [gkey, items] of Object.entries(groups)) {
    // Sort items by original row_index to preserve chronological order
    items.sort((a, b) => a.row_index - b.row_index);

    const occupiedRows = new Set(); // Set of row indices already occupied in the new grid

    items.forEach(item => {
      // Calculate preferred target row
      let targetRow = Math.round(item.row_index * scale);
      
      // Determine rowSpan under 20-min interval
      let rSpan = 1;
      const presc = item.prescription || '';
      if (presc.includes('40분')) {
        rSpan = 2;
      } else if (presc.includes('60분')) {
        rSpan = 3;
      }

      // Check if targetRow and its span overlap with any already occupied rows.
      // If it does, slide targetRow down until a free slot of size rSpan is found.
      const isRangeOccupied = (row, span) => {
        for (let r = row; r < row + span; r++) {
          if (occupiedRows.has(r)) return true;
        }
        return false;
      };

      while (isRangeOccupied(targetRow, rSpan)) {
        console.log(`[Slide] Row collision at Week ${item.week_index}, Day ${item.day_index}, Col ${item.col_index}: Moving "${item.content}" from Row ${targetRow} down.`);
        targetRow++;
      }

      // Mark the resolved range as occupied
      for (let r = targetRow; r < targetRow + rSpan; r++) {
        occupiedRows.add(r);
      }

      // Build migrated master record
      const newItem = { ...item };
      newItem.row_index = targetRow;
      
      // Re-normalize merge_span to reflect new rowSpan
      newItem.merge_span = {
        rowSpan: rSpan,
        colSpan: 1,
        mergedInto: null,
        meta: item.merge_span?.meta || {}
      };
      
      // Correct reservation_time metadata if present to match the new grid row time
      // 09:00 + targetRow * 20 minutes
      const totalMins = 9 * 60 + targetRow * 20;
      const hh = String(Math.floor(totalMins / 60)).padStart(2, '0');
      const mm = String(totalMins % 60).padStart(2, '0');
      const newTimeStr = `${hh}:${mm}`;
      
      if (newItem.merge_span.meta?.reservation_time) {
        newItem.merge_span.meta.reservation_time = newTimeStr;
      }

      delete newItem.id;
      delete newItem.created_at;
      delete newItem.updated_at;
      
      migratedMasters.push(newItem);
    });
  }

  // 3. Clear current June 2026 database completely
  console.log("\nClearing shockwave_schedules for June 2026...");
  const { error: deleteErr } = await supabase
    .from('shockwave_schedules')
    .delete()
    .eq('year', 2026)
    .eq('month', 6);
  if (deleteErr) {
    console.error("Delete error:", deleteErr);
    return;
  }
  console.log("Database cleared.");

  // 4. Insert resolved master cells
  console.log(`Inserting ${migratedMasters.length} resolved master cells...`);
  const chunkSize = 100;
  for (let i = 0; i < migratedMasters.length; i += chunkSize) {
    const chunk = migratedMasters.slice(i, i + chunkSize);
    const sanitizedChunk = chunk.map(item => {
      const copy = { ...item };
      copy.updated_at = new Date().toISOString();
      return copy;
    });

    const { error: insertErr } = await supabase
      .from('shockwave_schedules')
      .upsert(sanitizedChunk, {
        onConflict: 'year,month,week_index,day_index,row_index,col_index'
      });
    if (insertErr) {
      console.error("Insert error:", insertErr);
      return;
    }
  }
  console.log("Upserted master cells successfully.");
}

run();

# Goal
Implement the exact Excel-like visual group layout for `ShockwaveStatsView.jsx` matching the uploaded image, supporting dynamic therapist header columns, and in-cell editing that updates the database appropriately.

## Steps
1. Add `prescription_count` (integer) to `public.shockwave_patient_logs` in `supabase_schema.sql` so we can store '1', '2' etc.
2. Modify `ShockwaveStatsView.jsx` SQL queries and upsert logic to include `prescription_count`. Update the legacy parser as well to read the actual number (`cells[idx].v`).
3. Redesign the HTML `table` in `ShockwaveStatsView.jsx`:
   - Nested `thead`:
     - TR1: `Title` (colspan equal to all data columns)
     - TR2: `날짜`, `이름`, `차트번호`, `회차`, `부위` (rowspan=3), then `[Therapist Name] (XX건)` (colspan=3 for each), `총건수` (rowspan=2)
     - TR3: `F1.5`, `F/Rdc`, `F/R` (repeated per therapist), `[총합]` (for 총건수)
     - TR4: Column-wise sums. `0`, `6`, `34`...
   - `tbody`:
     - Map `groupedLogs`.
     - First row of a date group gets `rowSpan={groupSize}` for `날짜` and `총건수`.
     - For each log, loop over active `therapists`. Inside, loop over `['F1.5', 'F/R DC', 'F/R']`.
     - Render `td` with input. Bound to `log.prescription_count || ''` if `log.therapist_name === t.name && log.prescription === p_type`.
     - If user edits this cell, set `therapist_name = t.name, prescription = p_type, prescription_count = value`.
4. Style adjustments exactly matching the table in the image (border thickness, purple/green background colors).

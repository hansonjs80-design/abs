import { supabase } from './src/lib/supabaseClient.js';
async function test() {
  const { data: st } = await supabase.from('shockwave_therapists').select('name').order('slot_index');
  const { data: mt } = await supabase.from('manual_therapy_therapists').select('name').order('slot_index');
  console.log('Shockwave Therapists:', st.map(x => x.name));
  console.log('Manual Therapists:', mt.map(x => x.name));
}
test();

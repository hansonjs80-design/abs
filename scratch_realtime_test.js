import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

console.log('Testing Realtime subscription...');

const channel = supabase.channel('test-channel')
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'shockwave_schedules' },
    (payload) => {
      console.log('Received payload:', payload);
    }
  )
  .subscribe((status) => {
    console.log('Subscription status:', status);
    
    if (status === 'SUBSCRIBED') {
      console.log('Attempting to trigger an event by inserting/updating...');
      // Insert a dummy row
      supabase.from('shockwave_schedules').insert({
        year: 2099, month: 1, week_index: 0, day_index: 0, row_index: 0, col_index: 0, content: 'TEST'
      }).then(({error}) => {
        if(error) console.error('Insert error:', error);
        
        setTimeout(() => {
          supabase.from('shockwave_schedules').delete().eq('year', 2099).then(() => {
            setTimeout(() => process.exit(0), 1000);
          });
        }, 1000);
      });
    }
  });

setTimeout(() => {
  console.log('Timeout reached. Exiting.');
  process.exit(0);
}, 5000);

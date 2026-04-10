import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;

const createStubQuery = () => {
  const response = Promise.resolve({ data: [], error: null });
  const chain = {
    then: response.then.bind(response),
    catch: response.catch.bind(response),
  };
  const chainable = ['select', 'insert', 'upsert', 'update', 'delete', 'limit', 'order', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'match', 'like', 'ilike', 'single'];
  chainable.forEach((method) => {
    chain[method] = () => chain;
  });
  return chain;
};

const createStubAuth = () => {
  const session = { data: { session: null } };
  return {
    getSession: () => Promise.resolve(session),
    onAuthStateChange: (callback) => {
      callback('INITIAL', { session: null });
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
    signInWithPassword: () => Promise.resolve({ data: { user: null, session: null }, error: null }),
    signUp: () => Promise.resolve({ data: { user: null, session: null }, error: null }),
    signOut: () => Promise.resolve({ error: null }),
  };
};

const createStubSupabase = () => ({
  from: () => createStubQuery(),
  auth: createStubAuth(),
});

if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase 환경변수가 설정되지 않았습니다. 충격파 스케줄러는 실행되지 않으며 더미 결과를 제공합니다.');
}

export const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : createStubSupabase();

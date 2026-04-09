import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

const AuthContext = createContext();
const DEV_LOGIN_STORAGE_KEY = 'dev-auth-user';
const DEV_LOGIN_ID = 'admin';
const DEV_LOGIN_PASSWORD = '1';

const readStoredDevUser = () => {
  try {
    const savedUser = localStorage.getItem(DEV_LOGIN_STORAGE_KEY);
    return savedUser ? JSON.parse(savedUser) : null;
  } catch {
    return null;
  }
};

const writeStoredDevUser = (user) => {
  try {
    localStorage.setItem(DEV_LOGIN_STORAGE_KEY, JSON.stringify(user));
  } catch {}
};

const clearStoredDevUser = () => {
  try {
    localStorage.removeItem(DEV_LOGIN_STORAGE_KEY);
  } catch {}
};

const createDevUser = () => ({
  id: 'local-admin',
  email: DEV_LOGIN_ID,
  user_metadata: { name: '관리자' },
  app_metadata: { provider: 'local-dev' },
  isLocalDevUser: true,
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (!isMounted) return;
        if (session?.user) {
          setUser(session.user);
          return;
        }

        const savedDevUser = readStoredDevUser();
        if (savedDevUser) {
          setUser(savedDevUser);
          return;
        }

        setUser(null);
      })
      .catch((error) => {
        console.error('Failed to restore auth session:', error);
        if (!isMounted) return;
        setUser(readStoredDevUser());
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email, password) => {
    if (email === DEV_LOGIN_ID && password === DEV_LOGIN_PASSWORD) {
      const devUser = createDevUser();
      writeStoredDevUser(devUser);
      setUser(devUser);
      return { user: devUser, session: null };
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  const signUp = async (email, password, metadata = {}) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: metadata }
    });
    if (error) throw error;
    return {
      ...data,
      emailConfirmationRequired: Boolean(data?.user && !data?.session),
    };
  };

  const signOut = async () => {
    clearStoredDevUser();
    if (user?.isLocalDevUser) {
      setUser(null);
      return;
    }

    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

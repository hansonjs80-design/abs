import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  ADMIN_USERNAME,
  DEFAULT_ADMIN_PASSWORD,
  createDefaultPermissions,
  normalizePermissions,
  normalizeUsername,
} from '../lib/authPermissions';

const AuthContext = createContext();
const DEV_LOGIN_STORAGE_KEY = 'dev-auth-user';

const clearStoredDevUser = () => {
  try {
    sessionStorage.removeItem(DEV_LOGIN_STORAGE_KEY);
    localStorage.removeItem(DEV_LOGIN_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private browsing or restricted contexts.
  }
};

const readStoredDevUser = () => {
  try {
    localStorage.removeItem(DEV_LOGIN_STORAGE_KEY);
    return sessionStorage.getItem(DEV_LOGIN_STORAGE_KEY);
  } catch {
    return null;
  }
};

const writeStoredDevUser = (user) => {
  try {
    sessionStorage.setItem(DEV_LOGIN_STORAGE_KEY, JSON.stringify(user));
    localStorage.removeItem(DEV_LOGIN_STORAGE_KEY);
  } catch {
    // Keep login usable even when storage persistence is blocked.
  }
};

const createAppUser = (row) => ({
  id: `app-${row.id || row.username}`,
  username: row.username,
  email: row.username,
  user_metadata: { name: row.display_name || row.username },
  app_metadata: { provider: 'app-users' },
  app_permissions: normalizePermissions(row.permissions, row),
  app_role: row.role || 'user',
  isAdmin: row.role === 'admin' || row.username === ADMIN_USERNAME,
  isLocalDevUser: true,
});

const createBootstrapAdminUser = () => createAppUser({
  id: 'local-admin',
  username: ADMIN_USERNAME,
  display_name: '관리자',
  role: 'admin',
  permissions: createDefaultPermissions(),
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const stored = readStoredDevUser();
      if (stored) {
        setUser(JSON.parse(stored));
      }
    } catch (err) {
      console.warn('Failed to restore dev user session:', err);
      clearStoredDevUser();
    }
    setLoading(false);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        setUser(session.user);
        return;
      }
      if (event === 'SIGNED_OUT') {
        // Only clear user if they are a supabase auth user
        setUser(prev => prev?.isLocalDevUser ? prev : null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email, password) => {
    const username = normalizeUsername(email);
    const normalizedPassword = String(password || '').trim();

    try {
      const { data, error } = await supabase
        .from('app_users')
        .select('*')
        .eq('username', username)
        .eq('is_active', true)
        .limit(1)
        .single();

      if (data && !Array.isArray(data)) {
        if (String(data.password || '') !== normalizedPassword) {
          throw new Error('Invalid login credentials');
        }
        const appUser = createAppUser(data);
        writeStoredDevUser(appUser);
        setUser(appUser);
        return { user: appUser, session: null };
      }

      if (error && error.code !== 'PGRST116') {
        console.warn('App user login lookup failed:', error.message || error);
      }
    } catch (err) {
      if (err?.message === 'Invalid login credentials') throw err;
      console.warn('App user login failed, falling back to Supabase auth:', err);
    }

    if (username === ADMIN_USERNAME && normalizedPassword === DEFAULT_ADMIN_PASSWORD) {
      const adminUser = createBootstrapAdminUser();
      writeStoredDevUser(adminUser);
      setUser(adminUser);
      return { user: adminUser, session: null };
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email: username, password: normalizedPassword });
    if (error) throw error;
    if (data?.user) setUser(data.user);
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

  const refreshStoredUser = (nextUser) => {
    setUser(nextUser);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, refreshStoredUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  normalizePermissions,
  normalizeUsername,
} from '../lib/authPermissions';
import {
  authenticateLegacyAppUser,
  loadActiveLegacyAppUserProfile,
} from '../lib/legacyAppUserAuth';

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
  isAdmin: row.role === 'admin',
  isLocalDevUser: true,
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const restoreSession = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data?.session?.user) {
          if (!cancelled) setUser(data.session.user);
          return;
        }

        const stored = readStoredDevUser();
        if (!stored) return;
        const storedUser = JSON.parse(stored);
        const username = normalizeUsername(storedUser?.username || storedUser?.email);
        const profile = await loadActiveLegacyAppUserProfile({
          supabaseClient: supabase,
          username,
        });
        if (!profile) {
          clearStoredDevUser();
          return;
        }
        const restoredUser = createAppUser(profile);
        writeStoredDevUser(restoredUser);
        if (!cancelled) setUser(restoredUser);
      } catch (err) {
        console.warn('Failed to restore user session:', err);
        clearStoredDevUser();
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    restoreSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user) {
        clearStoredDevUser();
        setUser(session.user);
        return;
      }
      if (event === 'SIGNED_OUT') {
        setUser(prev => prev?.isLocalDevUser ? prev : null);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email, password) => {
    const username = normalizeUsername(email);
    const normalizedPassword = String(password ?? '');
    if (!username || !normalizedPassword) {
      throw new Error('Invalid login credentials');
    }

    let supabaseAuthError = null;
    if (username.includes('@')) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: username,
        password: normalizedPassword,
      });
      if (!error && data?.user) {
        clearStoredDevUser();
        setUser(data.user);
        return data;
      }
      supabaseAuthError = error;
    }

    try {
      const profile = await authenticateLegacyAppUser({
        supabaseClient: supabase,
        username,
        password: normalizedPassword,
      });
      const appUser = createAppUser(profile);
      writeStoredDevUser(appUser);
      setUser(appUser);
      return { user: appUser, session: null };
    } catch (legacyError) {
      if (legacyError?.message !== 'Invalid login credentials') {
        console.warn('Legacy app user login failed:', legacyError);
      }
      throw supabaseAuthError || new Error('Invalid login credentials');
    }
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
    if (nextUser?.isLocalDevUser) writeStoredDevUser(nextUser);
    setUser(nextUser);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, refreshStoredUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

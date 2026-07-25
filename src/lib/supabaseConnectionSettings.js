export const SUPABASE_CONNECTION_STORAGE_KEY = 'abs.supabaseConnection.v1';

const EMPTY_CONNECTION = Object.freeze({
  url: '',
  anonKey: '',
});

const getBrowserStorage = () => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const normalizeText = (value) => String(value ?? '').trim();

const readJwtRole = (key) => {
  const payload = normalizeText(key).split('.')[1];
  if (!payload || typeof globalThis.atob !== 'function') return '';

  try {
    const normalizedPayload = payload
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return normalizeText(JSON.parse(globalThis.atob(normalizedPayload))?.role).toLowerCase();
  } catch {
    return '';
  }
};

export const normalizeSupabaseConnection = (connection = {}) => ({
  url: normalizeText(connection.url).replace(/\/+$/, ''),
  anonKey: normalizeText(connection.anonKey),
});

export const getBuildSupabaseConnection = (env = import.meta.env || {}) => normalizeSupabaseConnection({
  url: env.VITE_SUPABASE_URL,
  anonKey: env.VITE_SUPABASE_KEY
    || env.VITE_SUPABASE_ANON_KEY
    || env.VITE_SUPABASE_PUBLISHABLE_KEY,
});

export const validateSupabaseConnection = (connection = {}) => {
  const value = normalizeSupabaseConnection(connection);
  const errors = {};

  if (!value.url) {
    errors.url = 'Supabase 프로젝트 URL을 입력해 주세요.';
  } else {
    try {
      const parsedUrl = new URL(value.url);
      const isLocalServer = ['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        errors.url = 'http 또는 https 주소만 사용할 수 있습니다.';
      } else if (parsedUrl.protocol !== 'https:' && !isLocalServer) {
        errors.url = '외부 Supabase 서버는 https 주소를 입력해 주세요.';
      } else if (parsedUrl.username || parsedUrl.password) {
        errors.url = '주소에는 사용자 이름이나 비밀번호를 포함할 수 없습니다.';
      }
    } catch {
      errors.url = '올바른 Supabase 프로젝트 URL을 입력해 주세요.';
    }
  }

  if (!value.anonKey) {
    errors.anonKey = '공개용 anon/publishable key를 입력해 주세요.';
  } else {
    const loweredKey = value.anonKey.toLowerCase();
    const jwtRole = readJwtRole(value.anonKey);
    if (
      loweredKey.includes('service_role')
      || loweredKey.startsWith('sb_secret_')
      || loweredKey.startsWith('sb-secret-')
      || jwtRole === 'service_role'
    ) {
      errors.anonKey = 'service_role 또는 secret key는 사용할 수 없습니다. 공개용 key만 입력해 주세요.';
    } else if (value.anonKey.length < 20) {
      errors.anonKey = '키가 너무 짧습니다. Supabase의 공개용 anon/publishable key를 확인해 주세요.';
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value,
  };
};

const readStoredConnection = (storage) => {
  if (!storage) return { exists: false, value: null, error: null };

  try {
    const rawValue = storage.getItem(SUPABASE_CONNECTION_STORAGE_KEY);
    if (!rawValue) return { exists: false, value: null, error: null };
    return {
      exists: true,
      value: JSON.parse(rawValue),
      error: null,
    };
  } catch (error) {
    return {
      exists: true,
      value: null,
      error,
    };
  }
};

export const loadSupabaseConnectionSettings = ({
  storage = getBrowserStorage(),
  defaults = getBuildSupabaseConnection(),
} = {}) => {
  const normalizedDefaults = normalizeSupabaseConnection(defaults || EMPTY_CONNECTION);
  const stored = readStoredConnection(storage);
  const storedValidation = validateSupabaseConnection(stored.value || EMPTY_CONNECTION);
  const useStoredConnection = stored.exists && !stored.error && storedValidation.valid;

  return {
    connection: useStoredConnection ? storedValidation.value : normalizedDefaults,
    defaults: normalizedDefaults,
    source: useStoredConnection ? 'device' : 'build',
    hasStoredOverride: stored.exists,
    storedOverrideValid: useStoredConnection,
  };
};

export const saveSupabaseConnectionSettings = (
  connection,
  storage = getBrowserStorage(),
) => {
  if (!storage) {
    throw new Error('이 브라우저에서는 연결 설정을 저장할 수 없습니다.');
  }

  const validation = validateSupabaseConnection(connection);
  if (!validation.valid) {
    const error = new Error('Supabase 연결 설정을 확인해 주세요.');
    error.validationErrors = validation.errors;
    throw error;
  }

  storage.setItem(SUPABASE_CONNECTION_STORAGE_KEY, JSON.stringify({
    ...validation.value,
    updatedAt: new Date().toISOString(),
  }));

  return validation.value;
};

export const clearSupabaseConnectionSettings = (storage = getBrowserStorage()) => {
  if (!storage) {
    throw new Error('이 브라우저에서는 연결 설정을 복원할 수 없습니다.');
  }
  storage.removeItem(SUPABASE_CONNECTION_STORAGE_KEY);
};

export const hasSupabaseConnectionOverride = (storage = getBrowserStorage()) => (
  readStoredConnection(storage).exists
);

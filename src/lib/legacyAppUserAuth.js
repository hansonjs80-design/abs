const INVALID_LOGIN_ERROR = 'Invalid login credentials';

function createInvalidLoginError() {
  return new Error(INVALID_LOGIN_ERROR);
}

async function digestText(value) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  if (globalThis.crypto?.subtle) {
    return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  }

  let hash = 2166136261;
  bytes.forEach((byte) => {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  });
  return new Uint8Array([
    hash & 0xff,
    (hash >>> 8) & 0xff,
    (hash >>> 16) & 0xff,
    (hash >>> 24) & 0xff,
  ]);
}

export async function legacyPasswordsMatch(storedPassword, candidatePassword) {
  const [storedDigest, candidateDigest] = await Promise.all([
    digestText(storedPassword),
    digestText(candidatePassword),
  ]);
  if (storedDigest.length !== candidateDigest.length) return false;

  let difference = 0;
  for (let index = 0; index < storedDigest.length; index += 1) {
    difference |= storedDigest[index] ^ candidateDigest[index];
  }
  return difference === 0;
}

function isMissingRpcFunctionError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === 'PGRST202' || code === '42883' || message.includes('authenticate_app_user');
}

export async function authenticateLegacyAppUser({
  supabaseClient,
  username,
  password,
} = {}) {
  if (!supabaseClient || !username || password == null || password === '') {
    throw createInvalidLoginError();
  }

  if (typeof supabaseClient.rpc === 'function') {
    const { data: rpcData, error: rpcError } = await supabaseClient.rpc('authenticate_app_user', {
      p_username: username,
      p_password: String(password),
    });
    if (!rpcError) {
      const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      if (!row || !row.username) throw createInvalidLoginError();
      const { password: _password, ...profile } = row;
      return profile;
    }
    if (!isMissingRpcFunctionError(rpcError)) {
      throw rpcError;
    }
  }

  const { data, error } = await supabaseClient
    .from('app_users')
    .select('id, username, password, display_name, role, permissions, is_active')
    .eq('username', username)
    .eq('is_active', true)
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  if (!data || Array.isArray(data)) throw createInvalidLoginError();

  const matches = await legacyPasswordsMatch(data.password, password);
  if (!matches) throw createInvalidLoginError();

  const { password: _password, ...profile } = data;
  return profile;
}

export async function loadActiveLegacyAppUserProfile({
  supabaseClient,
  username,
} = {}) {
  if (!supabaseClient || !username) return null;
  const { data, error } = await supabaseClient
    .from('app_users')
    .select('id, username, display_name, role, permissions, is_active')
    .eq('username', username)
    .eq('is_active', true)
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data && !Array.isArray(data) ? data : null;
}

export function hasLegacyAppUserProfileChanged(currentUser, profile, normalizedPermissions) {
  if (!currentUser || !profile) return false;
  const verifiedRole = profile.role || 'user';
  const verifiedIsAdmin = verifiedRole === 'admin';
  const nextDisplayName = profile.display_name || profile.username || '';
  const currentDisplayName = currentUser.user_metadata?.name || '';

  if (currentUser.app_role !== verifiedRole || Boolean(currentUser.isAdmin) !== verifiedIsAdmin) {
    return true;
  }
  if (currentDisplayName !== nextDisplayName) {
    return true;
  }

  const currentPerms = currentUser.app_permissions && typeof currentUser.app_permissions === 'object'
    ? currentUser.app_permissions
    : {};
  const nextPerms = normalizedPermissions && typeof normalizedPermissions === 'object'
    ? normalizedPermissions
    : {};
  const allKeys = new Set([...Object.keys(currentPerms), ...Object.keys(nextPerms)]);
  for (const key of allKeys) {
    if (Boolean(currentPerms[key]) !== Boolean(nextPerms[key])) {
      return true;
    }
  }
  return false;
}

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10;

function getDocument(documentArg) {
  if (documentArg) return documentArg;
  return typeof document === 'undefined' ? null : document;
}

export function writeCookieBackup(key, value, documentArg) {
  const browserDocument = getDocument(documentArg);
  if (!browserDocument) return;
  try {
    const expiresAt = new Date(Date.now() + COOKIE_MAX_AGE_SECONDS * 1000);
    browserDocument.cookie = [
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
      `expires=${expiresAt.toUTCString()}`,
      `max-age=${COOKIE_MAX_AGE_SECONDS}`,
      'path=/',
      'SameSite=Lax',
    ].join('; ');
  } catch {
    // Cookie backup is best-effort; localStorage can still remain available.
  }
}

export function readCookieBackup(key, documentArg) {
  const browserDocument = getDocument(documentArg);
  if (!browserDocument) return null;
  try {
    const encodedName = `${encodeURIComponent(key)}=`;
    const cookie = String(browserDocument.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(encodedName));
    return cookie ? decodeURIComponent(cookie.slice(encodedName.length)) : null;
  } catch {
    return null;
  }
}

export function readStorageValueWithCookieBackup(key, storage, documentArg) {
  let stored = null;
  if (storage) {
    try {
      stored = storage.getItem(key);
    } catch {
      stored = null;
    }
  }
  if (stored !== null && stored !== '') return stored;

  const backup = readCookieBackup(key, documentArg);
  if (backup === null || backup === '') return null;
  if (storage) {
    try {
      storage.setItem(key, backup);
    } catch {
      // Return the cookie value even if localStorage is temporarily unavailable.
    }
  }
  return backup;
}

export function writeStorageValueWithCookieBackup(key, value, storage, documentArg) {
  const serialized = String(value);
  if (storage) {
    try {
      storage.setItem(key, serialized);
    } catch {
      // Cookie backup below can still preserve the value.
    }
  }
  writeCookieBackup(key, serialized, documentArg);
  return serialized;
}

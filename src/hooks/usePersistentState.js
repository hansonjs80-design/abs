import { useState, useEffect, useRef, useCallback } from 'react';

function setCookieBackup(key, value) {
  if (typeof document === 'undefined') return;
  try {
    const maxAge = 60 * 60 * 24 * 365 * 10; // 10 years
    document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax`;
  } catch {
    // Ignored
  }
}

function getCookieBackup(key) {
  if (typeof document === 'undefined') return null;
  try {
    const name = encodeURIComponent(key) + "=";
    const decodedCookie = decodeURIComponent(document.cookie);
    const ca = decodedCookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i].trim();
      if (c.indexOf(name) === 0) {
        return c.substring(name.length, c.length);
      }
    }
  } catch {
    // Ignored
  }
  return null;
}

export function usePersistentNumber(key, initialValue, min = 0) {
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') return initialValue;
    try {
      let stored = window.localStorage.getItem(key);
      
      // LocalStorage 데이터 유실 시 쿠키 백업에서 복원 시도
      if (stored === null || stored === '') {
        const backup = getCookieBackup(key);
        if (backup !== null && backup !== '') {
          stored = backup;
          window.localStorage.setItem(key, stored);
        }
      }

      if (stored !== null && stored !== '') {
        const num = Number(stored);
        if (Number.isFinite(num)) {
          return Math.max(min, num);
        }
      }
    } catch {
      // Ignored
    }
    return initialValue;
  });

  const valueRef = useRef(value);

  const setPersistentValue = useCallback((newValue) => {
    setValue(prev => {
      const next = typeof newValue === 'function' ? newValue(prev) : newValue;
      valueRef.current = next;
      if (typeof window !== 'undefined') {
        try {
          if (Number.isFinite(next)) {
            const strVal = String(next);
            window.localStorage.setItem(key, strVal);
            setCookieBackup(key, strVal);
          }
        } catch {
          // Ignored
        }
      }
      return next;
    });
  }, [key]);

  // Sync on mount/key change just in case, but rely on setPersistentValue mostly
  useEffect(() => {
    valueRef.current = value;
    if (typeof window !== 'undefined') {
      try {
        if (Number.isFinite(value)) {
          const strVal = String(value);
          window.localStorage.setItem(key, strVal);
          setCookieBackup(key, strVal);
        }
      } catch {
        // Ignored
      }
    }
  }, [key, value]);

  return [value, setPersistentValue, valueRef];
}

export function usePersistentJson(key, initialValue) {
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') return initialValue;
    try {
      let stored = window.localStorage.getItem(key);

      // LocalStorage 데이터 유실 시 쿠키 백업에서 복원 시도
      if (stored === null || stored === '') {
        const backup = getCookieBackup(key);
        if (backup !== null && backup !== '') {
          stored = backup;
          window.localStorage.setItem(key, stored);
        }
      }

      if (stored !== null) {
        const parsed = JSON.parse(stored);
        if (parsed) return parsed;
      }
    } catch {
      // Ignored
    }
    return initialValue;
  });

  const valueRef = useRef(value);

  const setPersistentValue = useCallback((newValue) => {
    setValue(prev => {
      const next = typeof newValue === 'function' ? newValue(prev) : newValue;
      valueRef.current = next;
      if (typeof window !== 'undefined') {
        try {
          const strVal = JSON.stringify(next);
          window.localStorage.setItem(key, strVal);
          setCookieBackup(key, strVal);
        } catch {
          // Ignored
        }
      }
      return next;
    });
  }, [key]);

  useEffect(() => {
    valueRef.current = value;
    if (typeof window !== 'undefined') {
      try {
        const strVal = JSON.stringify(value);
        window.localStorage.setItem(key, strVal);
        setCookieBackup(key, strVal);
      } catch {
        // Ignored
      }
    }
  }, [key, value]);

  return [value, setPersistentValue, valueRef];
}

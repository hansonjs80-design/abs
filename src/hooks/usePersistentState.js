import { useState, useEffect, useRef, useCallback } from 'react';

export function usePersistentNumber(key, initialValue, min = 0) {
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') return initialValue;
    try {
      const stored = window.localStorage.getItem(key);
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
            window.localStorage.setItem(key, String(next));
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
          window.localStorage.setItem(key, String(value));
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
      const stored = window.localStorage.getItem(key);
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
          window.localStorage.setItem(key, JSON.stringify(next));
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
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Ignored
      }
    }
  }, [key, value]);

  return [value, setPersistentValue, valueRef];
}

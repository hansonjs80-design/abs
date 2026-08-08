import { useState, useRef, useCallback } from 'react';
import {
  readStorageValueWithCookieBackup,
  writeStorageValueWithCookieBackup,
} from '../lib/browserStorageBackup';

export function usePersistentNumber(key, initialValue, min = 0) {
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') return initialValue;
    try {
      const stored = readStorageValueWithCookieBackup(key, window.localStorage);

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
  valueRef.current = value; // 렌더링 시점에 항상 최신 값 업데이트 유지

  const setPersistentValue = useCallback((newValue) => {
    setValue(prev => {
      const next = typeof newValue === 'function' ? newValue(prev) : newValue;
      valueRef.current = next;
      if (typeof window !== 'undefined') {
        try {
          if (Number.isFinite(next)) {
            const strVal = String(next);
            writeStorageValueWithCookieBackup(key, strVal, window.localStorage);
          }
        } catch {
          // Ignored
        }
      }
      return next;
    });
  }, [key]);

  return [value, setPersistentValue, valueRef];
}

export function usePersistentJson(key, initialValue) {
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') return initialValue;
    try {
      const stored = readStorageValueWithCookieBackup(key, window.localStorage);

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
  valueRef.current = value; // 렌더링 시점에 항상 최신 값 업데이트 유지

  const setPersistentValue = useCallback((newValue) => {
    setValue(prev => {
      const next = typeof newValue === 'function' ? newValue(prev) : newValue;
      valueRef.current = next;
      if (typeof window !== 'undefined') {
        try {
          const strVal = JSON.stringify(next);
          writeStorageValueWithCookieBackup(key, strVal, window.localStorage);
        } catch {
          // Ignored
        }
      }
      return next;
    });
  }, [key]);

  return [value, setPersistentValue, valueRef];
}

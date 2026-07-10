import { useState, useRef, useCallback } from 'react';

function setCookieBackup(key, value) {
  if (typeof document === 'undefined') return;
  try {
    const d = new Date();
    d.setTime(d.getTime() + (365 * 24 * 60 * 60 * 1000 * 10)); // 10 years
    const expires = "expires=" + d.toUTCString();
    // max-age와 expires를 함께 명시하여 구형 브라우저 및 특정 OS 크롬 환경에서도 세션 쿠키로 오인받지 않도록 보장
    document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}; ${expires}; path=/`;
  } catch {
    // Ignored
  }
}

function getCookieBackup(key) {
  if (typeof document === 'undefined') return null;
  try {
    const name = encodeURIComponent(key) + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i].trim();
      if (c.indexOf(name) === 0) {
        // 개별 타겟 값만 안전하게 디코딩하여 다른 쿠키 인코딩 에러 간섭 차단
        return decodeURIComponent(c.substring(name.length));
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
  valueRef.current = value; // 렌더링 시점에 항상 최신 값 업데이트 유지

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
  valueRef.current = value; // 렌더링 시점에 항상 최신 값 업데이트 유지

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

  return [value, setPersistentValue, valueRef];
}

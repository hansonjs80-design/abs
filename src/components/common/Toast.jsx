import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { DEVICE_SETTINGS_SYNC_EVENT } from '../../lib/shockwaveSettingsJsonSync';

const ToastContext = createContext();
const DEFAULT_TOAST_DURATION_MS = 3500;
const ALLOWED_TOAST_TYPES = new Set(['success', 'error', 'warning', 'info']);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextToastIdRef = useRef(0);
  const timersRef = useRef(new Map());

  const removeToast = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(id);
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback((message, type = 'info', duration = DEFAULT_TOAST_DURATION_MS) => {
    const text = String(message || '').trim();
    if (!text) return null;

    const id = ++nextToastIdRef.current;
    const normalizedType = ALLOWED_TOAST_TYPES.has(type) ? type : 'info';
    setToasts((prev) => [...prev.slice(-4), { id, message: text, type: normalizedType }]);

    const safeDuration = Number.isFinite(Number(duration)) && Number(duration) > 0
      ? Number(duration)
      : DEFAULT_TOAST_DURATION_MS;
    const timer = setTimeout(() => removeToast(id), safeDuration);
    timersRef.current.set(id, timer);
    return id;
  }, [removeToast]);

  useEffect(() => {
    const handleDeviceSettingsSync = (event) => {
      if (event?.detail?.status !== 'error') return;
      addToast(
        '기기별 화면 설정을 서버에 저장하지 못했습니다. 로컬 설정은 유지되며 잠시 후 다시 조정하면 재시도됩니다.',
        'error',
        6000
      );
    };
    window.addEventListener(DEVICE_SETTINGS_SYNC_EVENT, handleDeviceSettingsSync);
    return () => window.removeEventListener(DEVICE_SETTINGS_SYNC_EVENT, handleDeviceSettingsSync);
  }, [addToast]);

  useEffect(() => () => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="toast-container" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            className={`toast toast-${toast.type}`}
            onClick={() => removeToast(toast.id)}
            aria-label={`${toast.message} 알림 닫기`}
          >
            {toast.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

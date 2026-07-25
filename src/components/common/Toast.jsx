import {
  createContext,
  useCallback,
  useContext,
} from 'react';

const ToastContext = createContext();

export function ToastProvider({ children }) {
  const addToast = useCallback(() => null, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

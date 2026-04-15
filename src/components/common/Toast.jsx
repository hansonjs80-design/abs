import { createContext, useContext } from 'react';

const ToastContext = createContext();

export function ToastProvider({ children }) {
  const addToast = () => {};

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

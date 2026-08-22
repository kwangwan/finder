import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, Loader2 } from '../utils/icons';

const ToastContext = createContext(null);

const DEFAULT_DURATION = 2400;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());
  const idCounterRef = useRef(0);

  const dismissToast = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const scheduleAutoDismiss = useCallback((id, duration) => {
    const existing = timersRef.current.get(id);
    if (existing) clearTimeout(existing);
    if (!duration) return; // duration 0/undefined => stays until updated/dismissed
    const timer = setTimeout(() => dismissToast(id), duration);
    timersRef.current.set(id, timer);
  }, [dismissToast]);

  // type: 'info' | 'success' | 'warning' | 'error' | 'loading'
  // duration: ms before auto-dismiss; 0 = stays open until updateToast/dismissToast is called
  const showToast = useCallback((message, { type = 'success', duration = DEFAULT_DURATION, id } = {}) => {
    const toastId = id ?? `toast-${++idCounterRef.current}`;
    setToasts(prev => {
      const withoutExisting = prev.filter(t => t.id !== toastId);
      return [...withoutExisting, { id: toastId, message, type }];
    });
    scheduleAutoDismiss(toastId, duration);
    return toastId;
  }, [scheduleAutoDismiss]);

  const updateToast = useCallback((id, { message, type, duration = DEFAULT_DURATION } = {}) => {
    setToasts(prev => prev.map(t => t.id === id
      ? { ...t, ...(message !== undefined ? { message } : {}), ...(type !== undefined ? { type } : {}) }
      : t));
    scheduleAutoDismiss(id, duration);
  }, [scheduleAutoDismiss]);

  const getIcon = (type) => {
    switch (type) {
      case 'success': return <CheckCircle2 size={17} color="var(--accent-emerald)" />;
      case 'error': return <AlertCircle size={17} color="var(--accent-rose)" />;
      case 'warning': return <AlertTriangle size={17} color="var(--accent-amber)" />;
      case 'loading': return <Loader2 size={17} className="spin" color="var(--accent-primary)" />;
      case 'info':
      default: return <Info size={17} color="var(--accent-primary)" />;
    }
  };

  return (
    <ToastContext.Provider value={{ showToast, updateToast, dismissToast }}>
      {children}

      <div className="toast-stack" aria-live="polite">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast-item toast-${toast.type}`} onClick={() => dismissToast(toast.id)}>
            {getIcon(toast.type)}
            <span className="toast-message">{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

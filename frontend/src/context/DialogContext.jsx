import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { 
  AlertCircle, 
  CheckCircle2, 
  HelpCircle, 
  AlertTriangle, 
  X,
  Info
} from 'lucide-react';

const DialogContext = createContext(null);

export function DialogProvider({ children }) {
  const [dialogState, setDialogState] = useState(null);
  const resolveRef = useRef(null);

  const showAlert = useCallback(({ 
    title = '알림', 
    message = '', 
    type = 'info', // 'info' | 'success' | 'warning' | 'error'
    confirmText = '확인' 
  }) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setDialogState({
        mode: 'alert',
        title,
        message,
        type,
        confirmText
      });
    });
  }, []);

  const showConfirm = useCallback(({ 
    title = '확인', 
    message = '', 
    type = 'warning', // 'warning' | 'danger' | 'info'
    confirmText = '확인', 
    cancelText = '취소' 
  }) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setDialogState({
        mode: 'confirm',
        title,
        message,
        type,
        confirmText,
        cancelText
      });
    });
  }, []);

  const handleConfirm = () => {
    if (resolveRef.current) {
      resolveRef.current(true);
      resolveRef.current = null;
    }
    setDialogState(null);
  };

  const handleCancel = () => {
    if (resolveRef.current) {
      resolveRef.current(false);
      resolveRef.current = null;
    }
    setDialogState(null);
  };

  // Keyboard shortcut listener (Enter = confirm, Escape = cancel)
  useEffect(() => {
    if (!dialogState) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialogState]);

  const getIcon = () => {
    if (!dialogState) return null;
    switch (dialogState.type) {
      case 'success':
        return <CheckCircle2 size={24} color="var(--accent-emerald)" />;
      case 'danger':
      case 'error':
        return <AlertCircle size={24} color="var(--accent-rose)" />;
      case 'warning':
        return <AlertTriangle size={24} color="var(--accent-amber)" />;
      case 'info':
      default:
        return <Info size={24} color="var(--accent-primary)" />;
    }
  };

  return (
    <DialogContext.Provider value={{ showAlert, showConfirm }}>
      {children}

      {/* Global Dialog Modal */}
      {dialogState && (
        <div className="modal-overlay" onClick={handleCancel} style={{ zIndex: 9999 }}>
          <div 
            className="modal-content" 
            onClick={e => e.stopPropagation()}
            style={{ 
              maxWidth: 420, 
              padding: 0,
              overflow: 'hidden',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)'
            }}
          >
            <div style={{ padding: '1.25rem 1.25rem 0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem' }}>
                <div style={{
                  padding: '0.5rem',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: dialogState.type === 'danger' || dialogState.type === 'error'
                    ? 'rgba(239, 68, 68, 0.12)'
                    : dialogState.type === 'warning'
                    ? 'rgba(245, 158, 11, 0.12)'
                    : dialogState.type === 'success'
                    ? 'rgba(16, 185, 129, 0.12)'
                    : 'rgba(59, 130, 246, 0.12)',
                  flexShrink: 0
                }}>
                  {getIcon()}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ 
                    fontSize: '1.05rem', 
                    fontWeight: 700, 
                    color: 'var(--text-primary)',
                    marginBottom: '0.4rem'
                  }}>
                    {dialogState.title}
                  </h3>
                  <div style={{ 
                    fontSize: '0.875rem', 
                    color: 'var(--text-secondary)', 
                    lineHeight: 1.5,
                    whiteSpace: 'pre-line' 
                  }}>
                    {dialogState.message}
                  </div>
                </div>

                <button 
                  className="btn-icon" 
                  onClick={handleCancel}
                  style={{ padding: '0.2rem', color: 'var(--text-muted)' }}
                  title="닫기 (ESC)"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div style={{ 
              padding: '0.85rem 1.25rem', 
              backgroundColor: 'var(--bg-tertiary)', 
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex', 
              justifyContent: 'flex-end', 
              gap: '0.5rem' 
            }}>
              {dialogState.mode === 'confirm' && (
                <button 
                  type="button" 
                  className="btn-secondary" 
                  onClick={handleCancel}
                  style={{ minWidth: 72 }}
                >
                  {dialogState.cancelText || '취소'}
                </button>
              )}
              <button 
                type="button" 
                className={dialogState.type === 'danger' ? 'btn-danger' : 'btn-primary'} 
                onClick={handleConfirm}
                autoFocus
                style={{ 
                  minWidth: 72,
                  ...(dialogState.type === 'danger' ? {
                    backgroundColor: 'var(--accent-rose)',
                    color: '#fff',
                    border: 'none',
                    padding: '0.5rem 1rem',
                    borderRadius: 'var(--radius-md)',
                    fontWeight: 600,
                    cursor: 'pointer'
                  } : {})
                }}
              >
                {dialogState.confirmText || '확인'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useDialog must be used within a DialogProvider');
  }
  return context;
}

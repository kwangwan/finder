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

  const renderMessageContent = (rawMessage) => {
    if (!rawMessage) return null;
    const lines = rawMessage.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return null;

    const mainPrompt = lines[0];
    const subNotes = lines.slice(1);

    const renderFormattedText = (text) => {
      const parts = text.split(/(['"][^'"]+['"])/g);
      return parts.map((part, index) => {
        if ((part.startsWith("'") && part.endsWith("'")) || (part.startsWith('"') && part.endsWith('"'))) {
          const cleanName = part.slice(1, -1);
          return (
            <strong 
              key={index}
              style={{ 
                color: 'var(--text-primary)',
                backgroundColor: 'var(--bg-tertiary)',
                padding: '0.15rem 0.45rem',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                wordBreak: 'break-all',
                fontWeight: 600,
                display: 'inline',
                margin: '0 2px'
              }}
            >
              {cleanName}
            </strong>
          );
        }
        return <span key={index}>{part}</span>;
      });
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.2rem' }}>
        <div style={{ 
          fontSize: '0.925rem', 
          color: 'var(--text-secondary)', 
          lineHeight: 1.6,
          wordBreak: 'break-word'
        }}>
          {renderFormattedText(mainPrompt)}
        </div>

        {subNotes.length > 0 && (
          <div style={{
            padding: '0.75rem 0.95rem',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--bg-tertiary)',
            border: '1px solid var(--border-subtle)',
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.55rem',
            lineHeight: 1.55
          }}>
            <Info size={15} style={{ marginTop: 2, flexShrink: 0, color: 'var(--text-muted)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {subNotes.map((note, idx) => (
                <div key={idx}>{renderFormattedText(note)}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
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
              maxWidth: 480, 
              width: '92vw',
              padding: 0,
              overflow: 'hidden',
              borderRadius: 'var(--radius-lg)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px var(--border-medium)'
            }}
          >
            <div style={{ padding: '1.5rem 1.5rem 1.15rem' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{
                  padding: '0.65rem',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: dialogState.type === 'danger' || dialogState.type === 'error'
                    ? 'rgba(239, 68, 68, 0.12)'
                    : dialogState.type === 'warning'
                    ? 'rgba(245, 158, 11, 0.12)'
                    : dialogState.type === 'success'
                    ? 'rgba(16, 185, 129, 0.12)'
                    : 'rgba(59, 130, 246, 0.12)',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  {getIcon()}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.45rem' }}>
                    <h3 style={{ 
                      fontSize: '1.1rem', 
                      fontWeight: 700, 
                      color: 'var(--text-primary)',
                      margin: 0
                    }}>
                      {dialogState.title}
                    </h3>
                    <button 
                      className="btn-icon" 
                      onClick={handleCancel}
                      style={{ padding: '0.25rem', color: 'var(--text-muted)' }}
                      title="닫기 (ESC)"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {renderMessageContent(dialogState.message)}
                </div>
              </div>
            </div>

            <div style={{ 
              padding: '0.95rem 1.5rem', 
              backgroundColor: 'var(--bg-tertiary)', 
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex', 
              justifyContent: 'flex-end', 
              gap: '0.65rem' 
            }}>
              {dialogState.mode === 'confirm' && (
                <button 
                  type="button" 
                  className="btn-secondary" 
                  onClick={handleCancel}
                  style={{ minWidth: 78, padding: '0.55rem 1rem' }}
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
                  minWidth: 84,
                  padding: '0.55rem 1.15rem',
                  fontWeight: 600,
                  ...(dialogState.type === 'danger' ? {
                    backgroundColor: 'var(--accent-rose)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
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

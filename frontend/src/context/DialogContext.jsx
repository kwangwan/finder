import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { 
  AlertCircle, 
  CheckCircle2, 
  HelpCircle, 
  AlertTriangle, 
  X,
  Info,
  FileText,
  Folder,
  Trash2
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

    // Extract quoted target item name (e.g. '개인정보처리_동의서_우광완.pdf' or "Folder")
    const quoteMatch = mainPrompt.match(/^['"]([^'"]+)['"]\s*(.*)$/);
    const targetItemName = quoteMatch ? quoteMatch[1] : null;
    const promptRemaining = quoteMatch ? quoteMatch[2] : mainPrompt;
    const isFolder = targetItemName && (mainPrompt.includes('폴더') || targetItemName.includes('/'));

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginTop: '0.35rem' }}>
        {targetItemName ? (
          <>
            {/* 1. Prompt Question */}
            <div style={{ 
              fontSize: '0.975rem', 
              fontWeight: 600,
              color: 'var(--text-primary)', 
              lineHeight: 1.5
            }}>
              {promptRemaining ? (
                <span>선택한 {promptRemaining}</span>
              ) : (
                <span>이 항목을 처리하시겠습니까?</span>
              )}
            </div>

            {/* 2. Target Item Card */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)'
            }}>
              <div style={{
                width: 34,
                height: 34,
                borderRadius: 'var(--radius-sm)',
                backgroundColor: isFolder ? 'rgba(59, 130, 246, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                {isFolder ? (
                  <Folder size={18} color="var(--accent-primary)" />
                ) : (
                  <FileText size={18} color="var(--accent-rose)" />
                )}
              </div>
              <div style={{
                flex: 1,
                minWidth: 0,
                fontSize: '0.88rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
                wordBreak: 'break-all',
                lineHeight: 1.4
              }}>
                {targetItemName}
              </div>
            </div>
          </>
        ) : (
          <div style={{ 
            fontSize: '0.95rem', 
            color: 'var(--text-primary)', 
            lineHeight: 1.6,
            wordBreak: 'break-word',
            fontWeight: 500
          }}>
            {mainPrompt}
          </div>
        )}

        {/* 3. Sub-Notes / Warning callout */}
        {subNotes.length > 0 && (
          <div style={{
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--bg-tertiary)',
            border: '1px solid var(--border-subtle)',
            fontSize: '0.82rem',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.6rem',
            lineHeight: 1.55
          }}>
            <Info size={15} style={{ marginTop: 2, flexShrink: 0, color: 'var(--text-muted)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {subNotes.map((note, idx) => (
                <div key={idx}>{note}</div>
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
              maxWidth: 500, 
              width: '92vw',
              padding: 0,
              overflow: 'hidden',
              borderRadius: 'var(--radius-lg)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px var(--border-medium)',
              animation: 'mediaModalPop 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
          >
            <div style={{ padding: '1.75rem 1.75rem 1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.1rem' }}>
                <div style={{
                  width: 44,
                  height: 44,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: dialogState.type === 'danger' || dialogState.type === 'error'
                    ? 'rgba(239, 68, 68, 0.14)'
                    : dialogState.type === 'warning'
                    ? 'rgba(245, 158, 11, 0.14)'
                    : dialogState.type === 'success'
                    ? 'rgba(16, 185, 129, 0.14)'
                    : 'rgba(59, 130, 246, 0.14)',
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
                      fontSize: '1.15rem', 
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
              padding: '1rem 1.75rem', 
              backgroundColor: 'var(--bg-tertiary)', 
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex', 
              justifyContent: 'flex-end', 
              gap: '0.75rem' 
            }}>
              {dialogState.mode === 'confirm' && (
                <button 
                  type="button" 
                  className="btn-secondary" 
                  onClick={handleCancel}
                  style={{ minWidth: 84, padding: '0.6rem 1.15rem', fontSize: '0.875rem' }}
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
                  minWidth: 90,
                  padding: '0.6rem 1.35rem',
                  fontWeight: 600,
                  fontSize: '0.875rem',
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

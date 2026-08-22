import React, { useState } from 'react';
import {
  Download,
  UploadCloud,
  FolderArchive,
  CheckCircle2,
  AlertCircle,
  RotateCw,
  X,
  ChevronDown,
  ChevronUp,
  File,
  Loader2,
  Trash2
} from '../../utils/icons';

export default function TransferManager({
  transfers = [],
  onRetry,
  onCancel,
  onClearCompleted,
  isOpen = true,
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (!transfers || transfers.length === 0) {
    return null;
  }

  const activeCount = transfers.filter(t => t.status === 'running' || t.status === 'pending').length;
  const completedCount = transfers.filter(t => t.status === 'completed').length;
  const errorCount = transfers.filter(t => t.status === 'error').length;

  const totalProgress = transfers.length > 0
    ? Math.round(transfers.reduce((acc, t) => acc + (t.percent || 0), 0) / transfers.length)
    : 0;

  return (
    <div className="transfer-manager-container" style={{
      position: 'fixed',
      bottom: '1.5rem',
      right: '1.5rem',
      width: isCollapsed ? '320px' : '400px',
      maxWidth: 'calc(100vw - 3rem)',
      background: 'var(--bg-secondary)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: '0 12px 36px rgba(0, 0, 0, 0.35)',
      border: '1px solid var(--border-subtle)',
      zIndex: 9999,
      overflow: 'hidden',
      transition: 'all 0.25s ease-in-out',
      fontFamily: 'inherit',
    }}>
      {/* Header */}
      <div 
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{
          padding: '0.85rem 1rem',
          background: 'var(--bg-tertiary)',
          borderBottom: isCollapsed ? 'none' : '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {activeCount > 0 ? (
            <div style={{ position: 'relative' }}>
              <Loader2 size={18} color="var(--accent-primary)" className="animate-spin" />
            </div>
          ) : errorCount > 0 ? (
            <AlertCircle size={18} color="#ef4444" />
          ) : (
            <CheckCircle2 size={18} color="#10b981" />
          )}

          <div>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {activeCount > 0
                ? `${activeCount}개 항목 전송 중 (${totalProgress}%)`
                : errorCount > 0
                ? `${errorCount}개 전송 실패`
                : `${completedCount}개 전송 완료`}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {completedCount > 0 && !activeCount && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClearCompleted && onClearCompleted();
              }}
              title="완료 항목 정리"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                borderRadius: '4px',
              }}
            >
              <Trash2 size={14} />
            </button>
          )}

          <div style={{ color: 'var(--text-muted)' }}>
            {isCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </div>
      </div>

      {/* Transfer List */}
      {!isCollapsed && (
        <div style={{
          maxHeight: '280px',
          overflowY: 'auto',
          padding: '0.5rem 0',
        }}>
          {transfers.map((item) => {
            const isError = item.status === 'error';
            const isDone = item.status === 'completed';
            const isRunning = item.status === 'running' || item.status === 'pending';

            return (
              <div
                key={item.id}
                style={{
                  padding: '0.6rem 1rem',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  transition: 'background 0.15s',
                }}
              >
                {/* Type Icon */}
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: 'var(--radius-md)',
                  background: isError 
                    ? 'rgba(239, 68, 68, 0.15)' 
                    : isDone 
                    ? 'rgba(16, 185, 129, 0.15)' 
                    : 'rgba(59, 130, 246, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  color: isError ? '#ef4444' : isDone ? '#10b981' : 'var(--accent-primary)',
                }}>
                  {item.type === 'zip_download' ? (
                    <FolderArchive size={16} />
                  ) : item.type === 'download' ? (
                    <Download size={16} />
                  ) : (
                    <UploadCloud size={16} />
                  )}
                </div>

                {/* Info & Progress */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {item.name}
                  </div>

                  <div style={{
                    fontSize: '0.72rem',
                    color: isError ? '#ef4444' : 'var(--text-muted)',
                    marginTop: '2px',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.statusText || (isDone ? '완료됨' : isError ? '오류 발생' : '전송 중...')}
                    </span>
                    <span>{item.percent || 0}%</span>
                  </div>

                  {/* Progress Bar */}
                  <div style={{
                    height: '4px',
                    background: 'var(--border-subtle)',
                    borderRadius: '2px',
                    marginTop: '4px',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${item.percent || 0}%`,
                      background: isError 
                        ? '#ef4444' 
                        : isDone 
                        ? '#10b981' 
                        : 'linear-gradient(90deg, var(--accent-primary), #8b5cf6)',
                      transition: 'width 0.2s ease-out',
                    }} />
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {isError && (
                    <button
                      onClick={() => onRetry && onRetry(item)}
                      title="재시도 (다시 전송)"
                      style={{
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        color: '#ef4444',
                        borderRadius: 'var(--radius-sm)',
                        padding: '4px 8px',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                      }}
                    >
                      <RotateCw size={12} />
                      <span>재시도</span>
                    </button>
                  )}

                  {isRunning && onCancel && (
                    <button
                      onClick={() => onCancel(item.id)}
                      title="취소"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

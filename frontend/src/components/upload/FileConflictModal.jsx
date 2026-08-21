import React, { useState } from 'react';
import { AlertTriangle, X, Replace, Copy, Ban } from 'lucide-react';

const ACTIONS = [
  { key: 'replace', label: '대체', icon: Replace },
  { key: 'keep', label: '둘 다 유지', icon: Copy },
  { key: 'skip', label: '업로드 안 함', icon: Ban },
];

/**
 * Shown when one or more files being uploaded share a name with a file
 * already in the target folder. Lets the user resolve each conflict
 * individually, or apply one choice to all of them at once.
 */
export default function FileConflictModal({ isOpen, conflicts = [], onCancel, onConfirm }) {
  const [decisions, setDecisions] = useState(() => Object.fromEntries(conflicts.map((_, i) => [i, 'keep'])));

  if (!isOpen) return null;

  const setAll = (action) => {
    setDecisions(Object.fromEntries(conflicts.map((_, i) => [i, action])));
  };

  const handleConfirm = () => {
    onConfirm(conflicts.map((c, i) => ({ ...c, action: decisions[i] })));
  };

  return (
    <div className="modal-overlay" onClick={onCancel} style={{ zIndex: 1060 }}>
      <div
        className="modal-content"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{
          padding: '1.15rem 1.25rem',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <AlertTriangle size={19} color="#f59e0b" />
            <h2 style={{ fontSize: '1.02rem', fontWeight: 700 }}>동일한 이름의 파일 {conflicts.length}개</h2>
          </div>
          <button className="btn-icon" onClick={onCancel} title="닫기">
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '0.9rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.6rem', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>전체 적용</span>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {ACTIONS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                className="btn-secondary"
                onClick={() => setAll(key)}
                style={{ fontSize: '0.78rem', padding: '0.35rem 0.7rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: '0.5rem 1.25rem', overflowY: 'auto', flex: 1 }}>
          {conflicts.map((c, i) => (
            <div key={i} style={{
              padding: '0.75rem 0',
              borderBottom: i < conflicts.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.75rem'
            }}>
              <span style={{
                fontSize: '0.85rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                minWidth: 0
              }} title={c.file.name}>
                {c.file.name}
              </span>
              <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
                {ACTIONS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setDecisions(prev => ({ ...prev, [i]: key }))}
                    title={label}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      padding: '0.3rem 0.55rem',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${decisions[i] === key ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                      background: decisions[i] === key ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                      color: decisions[i] === key ? 'var(--accent-primary)' : 'var(--text-muted)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <Icon size={12} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', padding: '1rem 1.25rem', borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <button type="button" className="btn-secondary" onClick={onCancel} style={{ height: 38, padding: '0 1.2rem', fontSize: '0.85rem' }}>
            취소
          </button>
          <button type="button" className="btn-primary" onClick={handleConfirm} style={{ height: 38, padding: '0 1.5rem', fontSize: '0.85rem', fontWeight: 700 }}>
            적용하고 업로드
          </button>
        </div>
      </div>
    </div>
  );
}

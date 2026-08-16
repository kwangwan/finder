import React, { useState, useEffect, useRef } from 'react';
import { Edit3, Palette, X, Check, Folder, FileText } from 'lucide-react';
import { useDialog } from '../../context/DialogContext';

const FOLDER_COLORS = [
  { label: '파랑 (기본)', value: '#3b82f6' },
  { label: '에메랄드', value: '#10b981' },
  { label: '보라', value: '#8b5cf6' },
  { label: '주황', value: '#f59e0b' },
  { label: '로즈', value: '#f43f5e' },
  { label: '사이언', value: '#06b6d4' },
  { label: '핑크', value: '#ec4899' },
  { label: '그레이', value: '#64748b' }
];

export default function RenameModal({
  isOpen,
  item, // { id, name, color, type: 'folder' | 'file' }
  onClose,
  onRename
}) {
  const { showAlert } = useDialog();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen && item) {
      setName(item.name || '');
      setColor(item.color || '#3b82f6');
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          const lastDot = item.name.lastIndexOf('.');
          if (item.type === 'file' && lastDot > 0) {
            inputRef.current.setSelectionRange(0, lastDot);
          } else {
            inputRef.current.select();
          }
        }
      }, 50);
    }
  }, [isOpen, item]);

  if (!isOpen || !item) return null;

  const isFolder = item.type === 'folder';

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      await showAlert({
        title: '입력 오류',
        message: '이름을 입력해주세요.',
        type: 'warning'
      });
      return;
    }

    if (trimmed === item.name && (!isFolder || color === item.color)) {
      onClose();
      return;
    }

    setIsSubmitting(true);
    try {
      await onRename(item.id, trimmed, item.type, isFolder ? color : undefined);
      onClose();
    } catch (err) {
      await showAlert({
        title: '수정 실패',
        message: '변경 사항을 저장하지 못했습니다: ' + err.message,
        type: 'error'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1050 }}>
      <div 
        className="modal-content" 
        onClick={e => e.stopPropagation()} 
        style={{ 
          maxWidth: 480, 
          padding: '2rem',
          borderRadius: 'var(--radius-xl)',
          boxShadow: '0 24px 56px rgba(0, 0, 0, 0.5)',
          background: 'var(--bg-secondary)'
        }}
      >
        {/* Header */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'flex-start', 
          justifyContent: 'space-between', 
          marginBottom: '1.5rem', 
          borderBottom: '1px solid var(--border-subtle)', 
          paddingBottom: '1.25rem' 
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: isFolder ? `${color}20` : 'rgba(59, 130, 246, 0.12)',
              border: `1px solid ${isFolder ? `${color}50` : 'rgba(59, 130, 246, 0.25)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isFolder ? color : 'var(--accent-primary)',
              flexShrink: 0
            }}>
              {isFolder ? <Folder size={22} /> : <FileText size={22} />}
            </div>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                {isFolder ? '폴더 정보 및 색상 변경' : '파일 이름 변경'}
              </h3>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.4 }}>
                {isFolder ? '폴더의 이름과 표시 색상을 변경합니다.' : '파일의 새로운 이름을 입력하세요.'}
              </p>
            </div>
          </div>
          <button 
            className="btn-icon" 
            onClick={onClose} 
            title="닫기 (ESC)"
            style={{ width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.45rem' }}>
              {isFolder ? '폴더 이름' : '파일 이름'}
            </label>
            <input
              ref={inputRef}
              type="text"
              className="input-primary"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={isFolder ? '폴더 이름을 입력하세요' : '파일 이름을 입력하세요'}
              required
              disabled={isSubmitting}
            />
          </div>

          {isFolder && (
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.65rem' }}>
                <Palette size={15} color="var(--accent-primary)" />
                <span>폴더 테마 색상 선택</span>
              </label>
              <div style={{ 
                display: 'flex', 
                gap: '0.65rem', 
                flexWrap: 'wrap',
                background: 'var(--bg-tertiary)',
                padding: '0.85rem 1rem',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-subtle)'
              }}>
                {FOLDER_COLORS.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColor(c.value)}
                    title={c.label}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      backgroundColor: c.value,
                      border: color === c.value ? '2px solid #ffffff' : '2px solid transparent',
                      boxShadow: color === c.value ? `0 0 10px ${c.value}cc, 0 0 0 2px ${c.value}` : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      transform: color === c.value ? 'scale(1.1)' : 'scale(1)'
                    }}
                  >
                    {color === c.value && <Check size={16} color="#fff" strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', marginTop: '0.5rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}>
            <button 
              type="button" 
              className="btn-secondary" 
              onClick={onClose} 
              disabled={isSubmitting}
              style={{ height: 38, padding: '0 1.2rem', fontSize: '0.85rem' }}
            >
              취소
            </button>
            <button 
              type="submit" 
              className="btn-primary" 
              disabled={isSubmitting || !name.trim()}
              style={{ height: 38, padding: '0 1.5rem', fontSize: '0.85rem', fontWeight: 700 }}
            >
              {isSubmitting ? '저장 중...' : '변경사항 저장'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

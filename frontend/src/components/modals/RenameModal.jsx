import React, { useState, useEffect, useRef } from 'react';
import { Edit3, Palette, X, Check } from 'lucide-react';
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
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 420, padding: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Edit3 size={20} color="var(--accent-primary)" />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {isFolder ? '폴더 정보 수정' : '파일 이름 변경'}
            </h3>
          </div>
          <button className="btn-icon" onClick={onClose} title="닫기 (ESC)">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
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
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.45rem' }}>
                <Palette size={14} />
                <span>폴더 색상</span>
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {FOLDER_COLORS.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColor(c.value)}
                    title={c.label}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      backgroundColor: c.value,
                      border: color === c.value ? '2px solid #fff' : '2px solid transparent',
                      boxShadow: color === c.value ? '0 0 8px ' + c.value : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {color === c.value && <Check size={14} color="#fff" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={isSubmitting}>
              취소
            </button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? '저장 중...' : '저장'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


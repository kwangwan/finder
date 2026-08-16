import React, { useState, useEffect, useRef } from 'react';
import { Edit3, X } from 'lucide-react';
import { useDialog } from '../../context/DialogContext';

export default function RenameModal({
  isOpen,
  item, // { id, name, type: 'folder' | 'file' }
  onClose,
  onRename
}) {
  const { showAlert } = useDialog();
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen && item) {
      setName(item.name || '');
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          // If file with extension, select filename part before extension
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

    if (trimmed === item.name) {
      onClose();
      return;
    }

    setIsSubmitting(true);
    try {
      await onRename(item.id, trimmed, item.type);
      onClose();
    } catch (err) {
      await showAlert({
        title: '이름 변경 실패',
        message: '이름을 변경하지 못했습니다: ' + err.message,
        type: 'error'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFolder = item.type === 'folder';

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1050 }}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 420, padding: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Edit3 size={20} color="var(--accent-primary)" />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {isFolder ? '폴더 이름 변경' : '파일 이름 변경'}
            </h3>
          </div>
          <button className="btn-icon" onClick={onClose} title="닫기 (ESC)">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
              새로운 {isFolder ? '폴더명' : '파일명'}
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

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={isSubmitting}>
              취소
            </button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? '변경 중...' : '이름 변경'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

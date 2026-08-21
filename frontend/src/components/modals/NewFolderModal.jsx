import React, { useState, useEffect } from 'react';
import { FolderPlus, X, Palette, Check } from 'lucide-react';
import { useDialog } from '../../context/DialogContext';
import Select from '../common/Select';

// Helper to flatten nested folder tree for dropdown options with indentations
function flattenFolderTree(nodeList, depth = 0) {
  let result = [];
  for (const node of (nodeList || [])) {
    const indent = '\u00A0\u00A0\u00A0'.repeat(depth) + (depth > 0 ? '└ ' : '');
    result.push({
      id: node.id,
      name: node.name,
      displayName: `${indent}${node.name}`,
      depth
    });
    if (node.children && node.children.length > 0) {
      result = result.concat(flattenFolderTree(node.children, depth + 1));
    }
  }
  return result;
}

const COLOR_OPTIONS = [
  { label: '파랑 (기본)', value: '#3b82f6' },
  { label: '에메랄드', value: '#10b981' },
  { label: '보라', value: '#8b5cf6' },
  { label: '주황', value: '#f59e0b' },
  { label: '로즈', value: '#f43f5e' },
  { label: '사이언', value: '#06b6d4' },
  { label: '핑크', value: '#ec4899' },
  { label: '그레이', value: '#64748b' }
];

export default function NewFolderModal({
  isOpen,
  onClose,
  parentFolderId,
  folders = [],
  onCreate
}) {
  const { showAlert } = useDialog();
  const [name, setName] = useState('');
  const [selectedParent, setSelectedParent] = useState(parentFolderId || '');
  const [color, setColor] = useState('#3b82f6');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedParent(parentFolderId || '');
      setName('');
    }
  }, [isOpen, parentFolderId]);

  if (!isOpen) return null;

  const flatFolders = flattenFolderTree(folders);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      await onCreate({
        name: name.trim(),
        parent_id: selectedParent || null,
        color
      });
      setName('');
      onClose();
    } catch (err) {
      await showAlert({
        title: '폴더 생성 실패',
        message: '폴더를 생성하지 못했습니다: ' + err.message,
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
              backgroundColor: `${color}20`,
              border: `1px solid ${color}50`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: color,
              flexShrink: 0
            }}>
              <FolderPlus size={22} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                새 폴더 만들기
              </h2>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.4 }}>
                문서와 노트를 체계적으로 분류할 폴더를 생성합니다.
              </p>
            </div>
          </div>
          <button 
            className="btn-icon" 
            onClick={onClose}
            style={{ width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="닫기"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.45rem' }}>
              폴더 이름 *
            </label>
            <input
              type="text"
              autoFocus
              className="input-primary"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="예: 프로젝트 기획서, AI 리서치..."
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.45rem' }}>
              상위 폴더 위치
            </label>
            <Select
              value={selectedParent}
              onChange={setSelectedParent}
              options={[
                { value: '', label: '(최상위 루트 폴더)' },
                ...flatFolders.map(f => ({ value: f.id, label: f.displayName })),
              ]}
            />
          </div>

          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.65rem' }}>
              <Palette size={15} color="var(--accent-primary)" />
              <span>폴더 테마 색상</span>
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
              {COLOR_OPTIONS.map(c => (
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

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', marginTop: '0.5rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}>
            <button 
              type="button" 
              className="btn-secondary" 
              onClick={onClose}
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
              {isSubmitting ? '생성 중...' : '폴더 생성'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

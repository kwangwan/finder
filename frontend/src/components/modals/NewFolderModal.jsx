import React, { useState, useEffect } from 'react';
import { FolderPlus, X } from 'lucide-react';
import { useDialog } from '../../context/DialogContext';

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

  const colorOptions = [
    '#3b82f6', // Blue
    '#8b5cf6', // Purple
    '#ec4899', // Pink
    '#10b981', // Emerald
    '#f59e0b', // Amber
    '#ef4444', // Red
    '#06b6d4', // Cyan
  ];

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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 450 }}>
        <div style={{
          padding: '1.25rem',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <FolderPlus size={20} color="var(--accent-primary)" />
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>새 폴더 만들기</h2>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
              폴더 이름
            </label>
            <input
              type="text"
              autoFocus
              className="editor-title-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="예: 프로젝트 기획서, AI 리서치..."
              style={{
                width: '100%',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '0.6rem 0.8rem',
                fontSize: '0.95rem'
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
              상위 폴더 위치
            </label>
            <select
              value={selectedParent}
              onChange={e => setSelectedParent(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '0.55rem 0.8rem',
                outline: 'none',
                fontSize: '0.85rem'
              }}
            >
              <option value="">(최상위 루트 폴더)</option>
              {flatFolders.map(f => (
                <option key={f.id} value={f.id}>
                  {f.displayName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
              폴더 색상
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {colorOptions.map(c => (
                <div
                  key={c}
                  onClick={() => setColor(c)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    backgroundColor: c,
                    cursor: 'pointer',
                    border: color === c ? '2px solid white' : '2px solid transparent',
                    boxShadow: color === c ? '0 0 0 2px ' + c : 'none'
                  }}
                />
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              취소
            </button>
            <button type="submit" className="btn-primary" disabled={isSubmitting || !name.trim()}>
              {isSubmitting ? '생성 중...' : '폴더 생성'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

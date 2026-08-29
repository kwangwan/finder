import React, { useState } from 'react';
import { 
  Folder as FolderIcon, 
  FolderInput, 
  X, 
  Home, 
  Check, 
  Search,
  Loader2
} from '../../utils/icons';
import { folderIconColor } from '../../utils/folderColors';

function flattenFolderTree(nodeList, depth = 0) {
  let result = [];
  for (const node of (nodeList || [])) {
    result.push({
      id: node.id,
      name: node.name,
      color: node.color,
      depth
    });
    if (node.children && node.children.length > 0) {
      result = result.concat(flattenFolderTree(node.children, depth + 1));
    }
  }
  return result;
}

export default function MoveFilesModal({
  isOpen,
  onClose,
  fileIds = [],
  filenames = [],
  folders = [],
  currentFolderId = null,
  onConfirmMove
}) {
  const [selectedTargetId, setSelectedTargetId] = useState(currentFolderId || null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const flattened = flattenFolderTree(folders);
  const filteredFolders = searchQuery.trim()
    ? flattened.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase().trim()))
    : flattened;

  const handleMove = async () => {
    setIsSubmitting(true);
    try {
      await onConfirmMove(selectedTargetId);
      onClose();
    } catch (err) {
      console.error('Batch move error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isSameFolder = selectedTargetId === currentFolderId;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal-content" 
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 480 }}
      >
        {/* Header */}
        <div style={{
          padding: '1.1rem 1.25rem',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <FolderInput size={20} color="var(--accent-primary)" />
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700 }}>
              {fileIds.length > 1 ? `${fileIds.length}개 파일 이동` : '파일 이동'}
            </h2>
          </div>
          <button className="btn-icon" onClick={onClose} disabled={isSubmitting}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Target description */}
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            선택한 <strong>{fileIds.length}개</strong>의 파일을 이동할 대상 위치를 선택하세요:
          </div>

          {/* Quick Search */}
          {flattened.length > 5 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '0.4rem 0.75rem',
              gap: '0.5rem',
            }}>
              <Search size={14} color="var(--text-muted)" />
              <input
                type="text"
                placeholder="폴더 이름 검색..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
                  width: '100%',
                }}
              />
            </div>
          )}

          {/* Folder List Picker */}
          <div style={{
            maxHeight: '260px',
            overflowY: 'auto',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '0.4rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px'
          }}>
            {/* Root Option */}
            <div
              onClick={() => setSelectedTargetId(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.55rem 0.75rem',
                borderRadius: 'var(--radius-sm)',
                background: selectedTargetId === null ? 'var(--accent-primary)' : 'transparent',
                color: selectedTargetId === null ? 'var(--on-accent)' : 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: 600,
                transition: 'background 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Home size={16} />
                <span>홈 (최상위 폴더)</span>
              </div>
              {selectedTargetId === null && <Check size={16} />}
            </div>

            {/* Folder Tree Options */}
            {filteredFolders.map(folder => {
              const isSelected = selectedTargetId === folder.id;
              const indentPadding = folder.depth * 18;

              return (
                <div
                  key={folder.id}
                  onClick={() => setSelectedTargetId(folder.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.5rem 0.75rem',
                    paddingLeft: `${12 + indentPadding}px`,
                    borderRadius: 'var(--radius-sm)',
                    background: isSelected ? 'var(--accent-primary)' : 'transparent',
                    color: isSelected ? 'var(--on-accent)' : 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: '0.84rem',
                    fontWeight: isSelected ? 600 : 500,
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                    <FolderIcon 
                      size={15} 
                      color={isSelected ? 'var(--on-accent)' : folderIconColor(folder)}
                      style={{ flexShrink: 0 }} 
                    />
                    <span title={folder.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {folder.name}
                    </span>
                  </div>
                  {isSelected && <Check size={15} />}
                </div>
              );
            })}

            {filteredFolders.length === 0 && searchQuery && (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                일치하는 폴더가 없습니다.
              </div>
            )}
          </div>

          {isSameFolder && (
            <div style={{ fontSize: '0.75rem', color: 'var(--accent-amber)', marginTop: -4 }}>
              * 이미 현재 폴더 위치입니다. 다른 폴더를 선택하세요.
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0.85rem 1.25rem',
          borderTop: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-tertiary)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '0.5rem'
        }}>
          <button 
            type="button" 
            className="btn-secondary" 
            onClick={onClose} 
            disabled={isSubmitting}
          >
            취소
          </button>
          <button 
            type="button" 
            className="btn-primary" 
            onClick={handleMove}
            disabled={isSubmitting || isSameFolder}
            style={{ minWidth: 80 }}
          >
            {isSubmitting ? (
              <Loader2 size={16} className="animate-spin" style={{ margin: '0 auto' }} />
            ) : (
              '이동'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

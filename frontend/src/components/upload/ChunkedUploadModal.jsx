import React, { useState, useRef, useEffect } from 'react';
import { 
  UploadCloud, 
  X, 
  File, 
  CheckCircle2, 
  AlertCircle, 
  HardDrive, 
  Folder,
  ShieldCheck
} from 'lucide-react';
import { uploadFileChunked } from '../../api';

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

export default function ChunkedUploadModal({
  isOpen,
  onClose,
  activeWorkspaceId,
  currentFolderId,
  folders = [],
  onUploadSuccess,
  initialFiles = []
}) {
  const [selectedFolder, setSelectedFolder] = useState(currentFolderId || '');
  const [queue, setQueue] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const dragCounter = useRef(0);

  useEffect(() => {
    if (isOpen) {
      setSelectedFolder(currentFolderId || '');
      if (initialFiles && initialFiles.length > 0) {
        handleFiles(initialFiles);
      }
    } else {
      setQueue([]);
      setIsDragging(false);
      dragCounter.current = 0;
    }
  }, [isOpen, initialFiles]);

  if (!isOpen) return null;

  const handleFiles = (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const newItems = Array.from(fileList).map(file => ({
      id: Math.random().toString(36).substring(7),
      file,
      name: file.name,
      size: file.size,
      percent: 0,
      statusText: '대기 중...',
      status: 'pending', // 'pending' | 'uploading' | 'completed' | 'error'
    }));

    setQueue(prev => [...prev, ...newItems]);
    // Start uploading queue
    newItems.forEach(item => startUpload(item));
  };

  const startUpload = async (item) => {
    updateItem(item.id, { status: 'uploading', statusText: '업로드 중...' });

    try {
      await uploadFileChunked(item.file, selectedFolder || null, activeWorkspaceId || null, ({ percent, status }) => {
        updateItem(item.id, { percent, statusText: status });
      });

      updateItem(item.id, { percent: 100, status: 'completed', statusText: '완료됨' });
      onUploadSuccess();
    } catch (err) {
      console.error('Upload failed:', err);
      updateItem(item.id, { status: 'error', statusText: '업로드 실패: ' + err.message });
    }
  };

  const updateItem = (id, updates) => {
    setQueue(prev => prev.map(it => it.id === id ? { ...it, ...updates } : it));
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 580 }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <UploadCloud size={20} color="var(--accent-primary)" />
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>파일 업로드</h2>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Target Folder Selection */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Folder size={15} /> 저장 폴더:
            </label>
            <select
              value={selectedFolder}
              onChange={e => setSelectedFolder(e.target.value)}
              style={{
                flex: 1,
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '0.4rem 0.6rem',
                outline: 'none',
                fontSize: '0.85rem'
              }}
            >
              <option value="">(최상위 루트)</option>
              {flattenFolderTree(folders).map(f => (
                <option key={f.id} value={f.id}>
                  {f.displayName}
                </option>
              ))}
            </select>
          </div>

          {/* Dropzone */}
          <div 
            className={`dropzone ${isDragging ? 'active' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={e => {
              e.preventDefault();
              dragCounter.current += 1;
              setIsDragging(true);
            }}
            onDragOver={e => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={e => {
              e.preventDefault();
              dragCounter.current -= 1;
              if (dragCounter.current <= 0) {
                setIsDragging(false);
                dragCounter.current = 0;
              }
            }}
            onDrop={e => {
              e.preventDefault();
              setIsDragging(false);
              dragCounter.current = 0;
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleFiles(e.dataTransfer.files);
              }
            }}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              multiple 
              style={{ display: 'none' }} 
              onChange={e => handleFiles(e.target.files)} 
            />
            <UploadCloud size={38} color="var(--accent-primary)" style={{ margin: '0 auto 0.5rem', display: 'block' }} />
            <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
              파일을 여기에 끌어다 놓거나 클릭하여 선택
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
              PDF, Markdown, 이미지, 텍스트, 아카이브 등 모든 파일 지원
            </div>
          </div>

          {/* Queue List */}
          {queue.length > 0 && (
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                업로드 목록 ({queue.length})
              </div>
              {queue.map(item => (
                <div key={item.id} style={{
                  padding: '0.6rem 0.8rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: '0.5rem',
                  border: '1px solid var(--border-subtle)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.name}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {formatFileSize(item.size)}
                    </span>
                  </div>

                  <div className="progress-bar-wrap">
                    <div 
                      className="progress-bar-fill" 
                      style={{ 
                        width: `${item.percent}%`,
                        background: item.status === 'error' ? 'var(--accent-rose)' : undefined
                      }} 
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.72rem' }}>
                    <span style={{ color: item.status === 'error' ? 'var(--accent-rose)' : 'var(--text-muted)' }}>
                      {item.statusText}
                    </span>
                    <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {item.percent}%
                    </span>
                  </div>
                </div>
              ))}
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
          <button className="btn-secondary" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

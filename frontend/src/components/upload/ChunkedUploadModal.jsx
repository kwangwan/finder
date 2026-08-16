import React, { useState, useRef, useEffect } from 'react';
import { 
  UploadCloud, 
  X, 
  File, 
  CheckCircle2, 
  AlertCircle, 
  Folder,
  FolderPlus,
  RotateCw,
  Loader2
} from 'lucide-react';
import { uploadFileChunked, ensureFolderPath } from '../../api';

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

// Recursive entry traversal for drag and drop folder trees
async function traverseFileSystemEntry(entry, path = '') {
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file((file) => {
        file.relativePath = path ? `${path}/${file.name}` : file.name;
        resolve([file]);
      }, () => resolve([]));
    });
  } else if (entry.isDirectory) {
    const dirReader = entry.createReader();
    const currentPath = path ? `${path}/${entry.name}` : entry.name;
    return new Promise((resolve) => {
      const allFiles = [];
      const readEntries = () => {
        dirReader.readEntries(async (entries) => {
          if (!entries || entries.length === 0) {
            resolve(allFiles);
          } else {
            for (const childEntry of entries) {
              const childFiles = await traverseFileSystemEntry(childEntry, currentPath);
              allFiles.push(...childFiles);
            }
            readEntries();
          }
        }, () => resolve(allFiles));
      };
      readEntries();
    });
  }
  return [];
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
  const folderInputRef = useRef(null);
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
    const newItems = Array.from(fileList).map(file => {
      const relPath = file.relativePath || file.webkitRelativePath || '';
      return {
        id: Math.random().toString(36).substring(7),
        file,
        name: file.name,
        relativePath: relPath,
        size: file.size,
        percent: 0,
        statusText: '대기 중...',
        status: 'pending', // 'pending' | 'uploading' | 'completed' | 'error'
      };
    });

    setQueue(prev => [...prev, ...newItems]);
    // Start uploading queue
    newItems.forEach(item => startUpload(item));
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    dragCounter.current = 0;

    const items = e.dataTransfer.items;
    if (items && items.length > 0 && items[0].webkitGetAsEntry) {
      const entries = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.webkitGetAsEntry) {
          const entry = item.webkitGetAsEntry();
          if (entry) entries.push(entry);
        }
      }

      const allFiles = [];
      for (const entry of entries) {
        const files = await traverseFileSystemEntry(entry);
        allFiles.push(...files);
      }

      if (allFiles.length > 0) {
        handleFiles(allFiles);
        return;
      }
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const startUpload = async (item) => {
    updateItem(item.id, { status: 'uploading', statusText: '업로드 준비 중...' });

    try {
      let targetFolderId = selectedFolder || null;

      // If file has relative path (from folder upload), ensure folder hierarchy exists
      if (item.relativePath && item.relativePath.includes('/')) {
        const pathParts = item.relativePath.split('/');
        pathParts.pop(); // Remove filename
        const folderPath = pathParts.join('/');
        
        if (folderPath && activeWorkspaceId) {
          updateItem(item.id, { statusText: `폴더 구조 확인 중 (${folderPath})...` });
          const ensured = await ensureFolderPath(activeWorkspaceId, selectedFolder || null, folderPath);
          targetFolderId = ensured.folder_id;
        }
      }

      updateItem(item.id, { statusText: '파일 전송 중...' });

      await uploadFileChunked(item.file, targetFolderId, activeWorkspaceId || null, ({ percent, status }) => {
        updateItem(item.id, { percent, statusText: status });
      });

      updateItem(item.id, { percent: 100, status: 'completed', statusText: '완료됨' });
      onUploadSuccess && onUploadSuccess();
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
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
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
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>파일 / 폴더 업로드</h2>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Target Folder Selection */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Folder size={15} /> 기본 저장 위치:
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
            onDrop={handleDrop}
            style={{
              padding: '2rem 1.5rem',
              textAlign: 'center',
              border: isDragging ? '2px dashed var(--accent-primary)' : '2px dashed var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              background: isDragging ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-tertiary)',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              multiple 
              style={{ display: 'none' }} 
              onChange={e => handleFiles(e.target.files)} 
            />
            <input 
              type="file" 
              ref={folderInputRef} 
              webkitdirectory="true" 
              directory="" 
              multiple 
              style={{ display: 'none' }} 
              onChange={e => handleFiles(e.target.files)} 
            />

            <UploadCloud size={38} color="var(--accent-primary)" style={{ margin: '0 auto 0.5rem', display: 'block' }} />
            <div style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--text-primary)' }}>
              파일 또는 폴더를 여기에 끌어다 놓으세요
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
              폴더 통째로 드래그 시 하위 계층 구조가 그대로 유지되어 자동 생성됩니다.
            </div>

            {/* Selection Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', marginTop: '1.25rem' }}>
              <button 
                type="button" 
                className="btn-secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                style={{ fontSize: '0.82rem', padding: '0.45rem 0.9rem' }}
              >
                <File size={15} />
                <span>파일 선택</span>
              </button>

              <button 
                type="button" 
                className="btn-secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  folderInputRef.current?.click();
                }}
                style={{ fontSize: '0.82rem', padding: '0.45rem 0.9rem' }}
              >
                <FolderPlus size={15} />
                <span>폴더 선택</span>
              </button>
            </div>
          </div>

          {/* Queue List */}
          {queue.length > 0 && (
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                업로드 대기열 ({queue.length})
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', maxWidth: '75%', overflow: 'hidden' }}>
                      {item.relativePath && item.relativePath.includes('/') ? (
                        <Folder size={14} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
                      ) : (
                        <File size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                      )}
                      <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.relativePath || item.name}>
                        {item.relativePath || item.name}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {formatFileSize(item.size)}
                      </span>
                      {item.status === 'error' && (
                        <button
                          onClick={() => startUpload(item)}
                          title="재시도"
                          style={{
                            background: 'rgba(239, 68, 68, 0.15)',
                            border: 'none',
                            color: '#ef4444',
                            borderRadius: '4px',
                            padding: '2px 6px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '2px',
                            fontSize: '0.7rem'
                          }}
                        >
                          <RotateCw size={11} />
                          <span>재시도</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="progress-bar-wrap">
                    <div 
                      className="progress-bar-fill" 
                      style={{ 
                        width: `${item.percent}%`,
                        background: item.status === 'error' ? '#ef4444' : item.status === 'completed' ? '#10b981' : undefined
                      }} 
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.72rem', marginTop: 3 }}>
                    <span style={{ color: item.status === 'error' ? '#ef4444' : item.status === 'completed' ? '#10b981' : 'var(--text-muted)' }}>
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

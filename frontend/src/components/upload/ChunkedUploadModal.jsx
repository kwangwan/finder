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
  Loader2,
  Trash2,
  Check
} from 'lucide-react';

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
  uploadManager,
  initialFiles = []
}) {
  const [selectedFolder, setSelectedFolder] = useState(currentFolderId || '');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const dragCounter = useRef(0);

  const {
    queue = [],
    isUploading,
    activeCount,
    completedCount,
    errorCount,
    totalProgress,
    addFilesToQueue,
    removeItem,
    retryItem,
    clearCompleted,
    clearAll
  } = uploadManager || {};

  useEffect(() => {
    if (isOpen) {
      setSelectedFolder(currentFolderId || '');
      if (initialFiles && initialFiles.length > 0 && addFilesToQueue) {
        addFilesToQueue(initialFiles, currentFolderId, activeWorkspaceId);
      }
    } else {
      setIsDragging(false);
      dragCounter.current = 0;
    }
  }, [isOpen, initialFiles, currentFolderId, activeWorkspaceId, addFilesToQueue]);

  if (!isOpen) return null;

  const handleFiles = (fileList) => {
    if (!fileList || fileList.length === 0) return;
    if (addFilesToQueue) {
      addFilesToQueue(fileList, selectedFolder, activeWorkspaceId);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    dragCounter.current = 0;

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
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

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content upload-modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 620, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{
          padding: '1.15rem 1.25rem',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <UploadCloud size={20} color="var(--accent-primary)" />
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700 }}>파일 / 폴더 업로드</h2>
            {isUploading && (
              <span className="upload-header-active-badge">
                <Loader2 size={12} className="spin-anim" /> {activeCount}개 전송 중
              </span>
            )}
          </div>
          <button className="btn-icon" onClick={onClose} title="닫기 (업로드는 백그라운드에서 계속 진행됩니다)">
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto', flex: 1 }}>
          {/* Target Folder Selection */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
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
              padding: '1.75rem 1.25rem',
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

            <UploadCloud size={34} color="var(--accent-primary)" style={{ margin: '0 auto 0.4rem', display: 'block' }} />
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              파일 또는 폴더를 여기에 끌어다 놓으세요
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
              폴더 통째로 드래그 시 하위 계층 구조가 그대로 유지되어 자동 생성됩니다.
            </div>

            {/* Selection Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', marginTop: '1rem' }}>
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
            <div style={{ marginTop: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  업로드 내역 ({queue.length}) · {totalProgress}%
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {completedCount > 0 && (
                    <button 
                      type="button"
                      className="upload-clear-btn" 
                      onClick={clearCompleted}
                    >
                      완료 항목 정리 ({completedCount})
                    </button>
                  )}
                  {!isUploading && (
                    <button 
                      type="button"
                      className="upload-clear-btn danger" 
                      onClick={clearAll}
                    >
                      전체 비우기
                    </button>
                  )}
                </div>
              </div>

              <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {queue.map(item => (
                  <div key={item.id} style={{
                    padding: '0.55rem 0.75rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', maxWidth: '75%', overflow: 'hidden' }}>
                        {item.relativePath && item.relativePath.includes('/') ? (
                          <Folder size={14} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
                        ) : (
                          <File size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                        )}
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>
                          {item.name}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {formatFileSize(item.size)}
                        </span>
                        {item.status === 'completed' && <CheckCircle2 size={15} color="#10b981" />}
                        {item.status === 'uploading' && (
                          <Loader2 size={14} className="spin-anim" color="var(--accent-primary)" />
                        )}
                        {item.status === 'error' && (
                          <button 
                            type="button"
                            className="btn-icon" 
                            onClick={() => retryItem && retryItem(item.id, activeWorkspaceId)}
                            title="재시도"
                            style={{ width: 22, height: 22, padding: 0 }}
                          >
                            <RotateCw size={13} color="#ef4444" />
                          </button>
                        )}
                        {item.status !== 'uploading' && (
                          <button
                            type="button"
                            className="btn-icon"
                            onClick={() => removeItem && removeItem(item.id)}
                            title="항목 제거"
                            style={{ width: 22, height: 22, padding: 0 }}
                          >
                            <Trash2 size={13} color="var(--text-muted)" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Progress Bar & Status Text */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ flex: 1, height: 5, background: 'rgba(255, 255, 255, 0.08)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${item.percent || (item.status === 'completed' ? 100 : 0)}%`,
                          background: item.status === 'error' ? '#ef4444' : item.status === 'completed' ? '#10b981' : 'var(--accent-primary)',
                          transition: 'width 0.2s ease'
                        }} />
                      </div>
                      <span style={{ fontSize: '0.7rem', color: item.status === 'error' ? '#ef4444' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {item.status === 'uploading' ? `${item.percent || 0}%` : item.statusText}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0.85rem 1.25rem',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--bg-tertiary)',
          flexShrink: 0
        }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {isUploading ? '창을 닫아도 업로드는 백그라운드에서 유지됩니다.' : '모든 작업이 준비되었습니다.'}
          </div>
          <button 
            type="button"
            className="btn-primary" 
            onClick={onClose}
          >
            {isUploading ? '백그라운드로 계속' : '확인'}
          </button>
        </div>
      </div>
    </div>
  );
}

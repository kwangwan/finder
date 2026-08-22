import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  X,
  File as FileIcon,
  CheckCircle2,
  AlertCircle, 
  Folder, 
  FolderPlus, 
  RotateCw, 
  Loader2,
  Trash2,
  Square,
  Ban,
  Check
} from '../../utils/icons';

import { extractFilesFromDataTransfer, openDirectoryPicker } from '../../utils/fileUploadUtils';
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

export default function ChunkedUploadModal({
  isOpen,
  onClose,
  activeWorkspaceId,
  currentFolderId,
  folders = [],
  workspaces = [],
  uploadManager
}) {
  const workspaceName = (wsId) => workspaces.find(w => w.id === wsId)?.name || '알 수 없는 워크스페이스';
  const [selectedFolder, setSelectedFolder] = useState(currentFolderId || '');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const dragCounter = useRef(0);

  const {
    queue = [],
    isUploading,
    isCheckingConflicts,
    activeCount,
    completedCount,
    errorCount,
    totalProgress,
    checkAndQueueFiles,
    cancelUpload,
    cancelAll,
    removeItem,
    retryItem,
    retryAll,
    clearCompleted,
    clearAll
  } = uploadManager || {};

  useEffect(() => {
    if (isOpen) {
      setSelectedFolder(currentFolderId || '');
    } else {
      setIsDragging(false);
      dragCounter.current = 0;
    }
  }, [isOpen, currentFolderId]);

  if (!isOpen) return null;

  // The conflict check (same-name-file dialog) lives in useUploadManager so
  // it also covers dropping a folder directly onto the explorer view, not
  // just this modal's own drop zone / pickers.
  const handleFiles = (fileList) => {
    if (fileList && fileList.length > 0 && checkAndQueueFiles) {
      checkAndQueueFiles(fileList, selectedFolder, activeWorkspaceId);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    dragCounter.current = 0;

    const files = await extractFilesFromDataTransfer(e.dataTransfer);
    if (files && files.length > 0) {
      handleFiles(files);
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
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700 }}>파일 및 폴더 업로드</h2>
            {isCheckingConflicts && (
              <span className="upload-header-active-badge">
                <Loader2 size={12} className="spin" /> 중복 파일 확인 중...
              </span>
            )}
            {isUploading && (
              <span className="upload-header-active-badge">
                <Loader2 size={12} className="spin" /> {activeCount}개 전송 중
              </span>
            )}
          </div>
          <button className="btn-icon" onClick={onClose} title="닫기 (업로드는 백그라운드에서 유지됩니다)">
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '1.25rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Target Folder Selector */}
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
              업로드 대상 폴더
            </label>
            <Select
              value={selectedFolder}
              onChange={setSelectedFolder}
              options={[
                { value: '', label: '🏠 홈 (기본 위치)' },
                ...flattenFolderTree(folders).map(f => ({ value: f.id, label: f.displayName })),
              ]}
            />
          </div>

          {/* Drag & Drop Upload Zone */}
          <div
            className={`upload-drop-zone ${isDragging ? 'dragging' : ''}`}
            onDragEnter={(e) => {
              e.preventDefault();
              dragCounter.current++;
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              dragCounter.current--;
              if (dragCounter.current === 0) setIsDragging(false);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${isDragging ? 'var(--accent-primary)' : 'var(--border-medium)'}`,
              borderRadius: 'var(--radius-lg)',
              padding: '2rem 1.5rem',
              textAlign: 'center',
              backgroundColor: isDragging ? 'rgba(59, 130, 246, 0.06)' : 'var(--bg-tertiary)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              position: 'relative'
            }}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              multiple 
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleFiles(Array.from(e.target.files));
                }
                e.target.value = '';
              }} 
            />
            <input 
              type="file" 
              ref={folderInputRef} 
              style={{ display: 'none' }} 
              webkitdirectory="" 
              mozdirectory=""
              directory="" 
              multiple 
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  const files = Array.from(e.target.files).map(f => {
                    if (!f.relativePath && f.webkitRelativePath) {
                      f.relativePath = f.webkitRelativePath;
                    }
                    return f;
                  });
                  handleFiles(files);
                }
                e.target.value = '';
              }} 
            />

            <div style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              backgroundColor: 'rgba(59, 130, 246, 0.12)',
              color: 'var(--accent-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 0.75rem'
            }}>
              <UploadCloud size={24} />
            </div>

            <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
              파일 또는 폴더를 이곳으로 드래그하세요
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
              하위 폴더 계층 구조가 그대로 유지되어 자동 업로드됩니다.
            </div>

            {/* Quick Action Buttons */}
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
                <FileIcon size={15} />
                <span>파일 선택</span>
              </button>

              <button 
                type="button" 
                className="btn-secondary"
                onClick={async (e) => {
                  e.stopPropagation();
                  const files = await openDirectoryPicker(folderInputRef);
                  if (files && files.length > 0) {
                    handleFiles(files);
                  }
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
                  {isUploading && (
                    <button 
                      type="button"
                      className="upload-clear-btn danger" 
                      onClick={cancelAll}
                      style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                      title="진행 중인 모든 업로드 중단"
                    >
                      전체 중단
                    </button>
                  )}
                  {errorCount > 0 && (
                    <button
                      type="button"
                      className="upload-clear-btn"
                      onClick={retryAll}
                      title="실패/취소된 모든 파일 재시도"
                    >
                      일괄 재시도 ({errorCount})
                    </button>
                  )}
                  {completedCount > 0 && (
                    <button
                      type="button"
                      className="upload-clear-btn"
                      onClick={clearCompleted}
                    >
                      완료 정리 ({completedCount})
                    </button>
                  )}
                  {!isUploading && (
                    <button 
                      type="button"
                      className="upload-clear-btn danger" 
                      onClick={clearAll}
                    >
                      목록 비우기
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', maxWidth: '72%', overflow: 'hidden' }}>
                        {item.relativePath && item.relativePath.includes('/') ? (
                          <Folder size={14} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
                        ) : (
                          <FileIcon size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                        )}
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>
                          {item.name}
                        </span>
                        {item.activeWorkspaceId && item.activeWorkspaceId !== activeWorkspaceId && (
                          <span
                            title={`업로드 대상 워크스페이스: ${workspaceName(item.activeWorkspaceId)}`}
                            style={{
                              flexShrink: 0,
                              fontSize: '0.68rem',
                              fontWeight: 600,
                              color: 'var(--accent-primary)',
                              background: 'rgba(59, 130, 246, 0.12)',
                              border: '1px solid rgba(59, 130, 246, 0.3)',
                              borderRadius: 'var(--radius-full)',
                              padding: '0.05rem 0.5rem',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {workspaceName(item.activeWorkspaceId)}
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {formatFileSize(item.size)}
                        </span>
                        {item.status === 'completed' && <CheckCircle2 size={15} color="#10b981" />}
                        {item.status === 'uploading' && (
                          <button
                            type="button"
                            className="btn-icon"
                            onClick={() => cancelUpload && cancelUpload(item.id)}
                            title="업로드 중단"
                            style={{ width: 22, height: 22, padding: 0, color: '#ef4444' }}
                          >
                            <Square size={12} fill="#ef4444" />
                          </button>
                        )}
                        {item.status === 'canceled' && (
                          <button 
                            type="button"
                            className="btn-icon" 
                            onClick={() => retryItem && retryItem(item.id)}
                            title="다시 시도"
                            style={{ width: 22, height: 22, padding: 0 }}
                          >
                            <RotateCw size={13} color="var(--accent-amber)" />
                          </button>
                        )}
                        {item.status === 'error' && (
                          <button 
                            type="button"
                            className="btn-icon" 
                            onClick={() => retryItem && retryItem(item.id)}
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
                          background: item.status === 'error' || item.status === 'canceled' ? '#ef4444' : item.status === 'completed' ? '#10b981' : 'var(--accent-primary)',
                          transition: 'width 0.2s ease'
                        }} />
                      </div>
                      <span style={{ fontSize: '0.7rem', color: item.status === 'error' || item.status === 'canceled' ? '#ef4444' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {item.statusText}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

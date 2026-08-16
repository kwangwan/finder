import React, { useState, useEffect } from 'react';
import { 
  Trash2, 
  RotateCcw, 
  AlertTriangle, 
  Folder as FolderIcon, 
  FileText, 
  Image as ImageIcon, 
  FileCode, 
  File, 
  RefreshCw,
  Search,
  Clock,
  Info,
  ExternalLink,
  Calendar
} from 'lucide-react';
import { listTrash, deletePermanentFile, deletePermanentFolder, emptyTrash, restoreFile, restoreFolder, getThumbnailUrl } from '../../api';
import { useDialog } from '../../context/DialogContext';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function TrashExplorer({
  activeWorkspace,
  currentUser,
  onOpenMediaPreview,
  onRefreshParent,
}) {
  const { showAlert, showConfirm } = useDialog();
  const [trashData, setTrashData] = useState({ folders: [], files: [], total_count: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState(null);

  const isOwnerOrAdmin = currentUser?.is_admin || 
    activeWorkspace?.owner_id === currentUser?.id || 
    activeWorkspace?.role === 'owner' || 
    activeWorkspace?.role === 'admin';

  const loadTrash = async () => {
    if (!activeWorkspace?.id) {
      setTrashData({ folders: [], files: [], total_count: 0 });
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const data = await listTrash(activeWorkspace.id);
      setTrashData(data);
    } catch (err) {
      await showAlert({
        title: '휴지통 조회 실패',
        message: '휴지통 데이터를 불러오지 못했습니다: ' + err.message,
        type: 'error'
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTrash();
  }, [activeWorkspace?.id]);

  const handleRestoreFile = async (file) => {
    setActionLoadingId(file.id);
    try {
      await restoreFile(file.id);
      await loadTrash();
      if (onRefreshParent) onRefreshParent();
      await showAlert({
        title: '복구 완료',
        message: `'${file.name}' 파일이 성공적으로 복구되었습니다.`,
        type: 'success'
      });
    } catch (err) {
      await showAlert({
        title: '복구 실패',
        message: '파일 복구 중 오류가 발생했습니다: ' + err.message,
        type: 'error'
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRestoreFolder = async (folder) => {
    setActionLoadingId(folder.id);
    try {
      await restoreFolder(folder.id);
      await loadTrash();
      if (onRefreshParent) onRefreshParent();
      await showAlert({
        title: '복구 완료',
        message: `'${folder.name}' 폴더와 하위 파일들이 성공적으로 복구되었습니다.`,
        type: 'success'
      });
    } catch (err) {
      await showAlert({
        title: '복구 실패',
        message: '폴더 복구 중 오류가 발생했습니다: ' + err.message,
        type: 'error'
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDeletePermanentFile = async (file) => {
    const confirmed = await showConfirm({
      title: '파일 영구 삭제',
      message: `'${file.name}' 파일을 완전히 영구 삭제하시겠습니까?\n저장소에서 파일과 AI 인덱싱 데이터가 완전히 지워지며 절대 복구할 수 없습니다.`,
      type: 'danger',
      confirmText: '영구 삭제',
      cancelText: '취소'
    });
    if (!confirmed) return;

    setActionLoadingId(file.id);
    try {
      await deletePermanentFile(file.id);
      await loadTrash();
      if (onRefreshParent) onRefreshParent();
    } catch (err) {
      await showAlert({
        title: '영구 삭제 실패',
        message: '파일 삭제 중 오류가 발생했습니다: ' + err.message,
        type: 'error'
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDeletePermanentFolder = async (folder) => {
    const confirmed = await showConfirm({
      title: '폴더 영구 삭제',
      message: `'${folder.name}' 폴더 및 하위 모든 파일/문서를 완전히 영구 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
      type: 'danger',
      confirmText: '영구 삭제',
      cancelText: '취소'
    });
    if (!confirmed) return;

    setActionLoadingId(folder.id);
    try {
      await deletePermanentFolder(folder.id);
      await loadTrash();
      if (onRefreshParent) onRefreshParent();
    } catch (err) {
      await showAlert({
        title: '영구 삭제 실패',
        message: '폴더 삭제 중 오류가 발생했습니다: ' + err.message,
        type: 'error'
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleEmptyTrash = async () => {
    if (trashData.total_count === 0) return;

    const confirmed = await showConfirm({
      title: '휴지통 비우기',
      message: '휴지통의 모든 파일 및 폴더를 영구적으로 삭제하시겠습니까?\n삭제된 모든 지식과 데이터는 즉시 파기되며 복구할 수 없습니다.',
      type: 'danger',
      confirmText: '휴지통 비우기',
      cancelText: '취소'
    });
    if (!confirmed) return;

    setIsLoading(true);
    try {
      await emptyTrash(activeWorkspace?.id || null);
      await loadTrash();
      if (onRefreshParent) onRefreshParent();
      await showAlert({
        title: '휴지통 비우기 완료',
        message: '휴지통이 성공적으로 비워졌습니다.',
        type: 'success'
      });
    } catch (err) {
      await showAlert({
        title: '휴지통 비우기 실패',
        message: '휴지통을 비우지 못했습니다: ' + err.message,
        type: 'error'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const filteredFolders = trashData.folders.filter(f => 
    f.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredFiles = trashData.files.filter(f => 
    f.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getFileIcon = (file) => {
    if (file.is_markdown || file.name.endsWith('.md')) return <FileText size={20} color="var(--accent-primary)" />;
    if (file.file_type === 'pdf') return <FileText size={20} color="var(--accent-rose)" />;
    if (file.file_type === 'image') return <ImageIcon size={20} color="var(--accent-emerald)" />;
    if (file.file_type === 'code') return <FileCode size={20} color="var(--accent-purple)" />;
    return <File size={20} color="var(--text-muted)" />;
  };

  return (
    <div className="explorer-container">
      {/* 30-Day Auto Purge Notification Banner */}
      <div className="trash-notice-banner">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
          <div className="trash-notice-icon" style={{ marginTop: 2 }}>
            <Clock size={20} color="var(--accent-amber)" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: 4 }}>
              휴지통 보관 및 영구 삭제 정책 안내
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
              • <strong>자동 정리</strong>: 휴지통 항목은 30일 후 자동 영구 삭제되며, 기간 내에는 누구나 원래 위치로 복구할 수 있습니다.<br />
              • <strong>영구 삭제 권한</strong>: 자신이 올린 파일은 작성자가 언제든 직접 영구 삭제할 수 있으며, 타인이 올린 파일의 영구 삭제 및 휴지통 전체 비우기는 워크스페이스 소유자/관리자만 가능합니다.
            </div>
          </div>
        </div>
      </div>

      {/* Header & Toolbar */}
      <div className="explorer-header" style={{ marginTop: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Trash2 size={22} color="var(--accent-rose)" />
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              휴지통
            </h2>
            <span className="badge" style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--accent-rose)', fontWeight: 700 }}>
              {trashData.total_count}개 항목
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button 
            className="btn-icon" 
            onClick={loadTrash} 
            title="새로고침"
            disabled={isLoading}
          >
            <RefreshCw size={16} className={isLoading ? 'spin' : ''} />
          </button>

          {trashData.total_count > 0 && isOwnerOrAdmin && (
            <button
              className="btn-danger"
              onClick={handleEmptyTrash}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '0.4rem 0.75rem',
                fontSize: '0.82rem',
                background: 'rgba(239, 68, 68, 0.15)',
                color: 'var(--accent-rose)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: 'var(--radius-md)',
                fontWeight: 600,
                cursor: 'pointer'
              }}
              title="휴지통 전체 비우기 (소유자 및 관리자 전용)"
            >
              <Trash2 size={15} />
              <span>휴지통 비우기</span>
            </button>
          )}
        </div>
      </div>

      {/* Search Input if items exist */}
      {trashData.total_count > 0 && (
        <div style={{ maxWidth: 400, marginBottom: '1.5rem', position: 'relative' }}>
          <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input
            type="text"
            placeholder="삭제된 항목 검색..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              paddingLeft: '2.25rem',
              paddingRight: '0.75rem',
              paddingTop: '0.55rem',
              paddingBottom: '0.55rem',
              fontSize: '0.85rem',
              fontFamily: 'var(--font-sans)',
              color: 'var(--text-primary)',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              outline: 'none',
              transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
            }}
            onFocus={e => {
              e.target.style.borderColor = 'var(--accent-primary)';
              e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.15)';
            }}
            onBlur={e => {
              e.target.style.borderColor = 'var(--border-subtle)';
              e.target.style.boxShadow = 'none';
            }}
          />
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div style={{ padding: '3rem 0', textAlign: 'center', color: 'var(--text-muted)' }}>
          <RefreshCw size={28} className="spin" style={{ margin: '0 auto 0.75rem' }} />
          <div>휴지통 데이터를 불러오는 중입니다...</div>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && trashData.total_count === 0 && (
        <div className="empty-state" style={{ padding: '4rem 1rem', textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
            <Trash2 size={32} color="var(--text-muted)" />
          </div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
            휴지통이 비어 있습니다
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: 360, margin: '0 auto' }}>
            삭제된 파일 및 폴더가 여기에 안전하게 보관됩니다. 30일 동안 보관 후 영구 삭제됩니다.
          </p>
        </div>
      )}

      {/* 1. Trashed Folders */}
      {!isLoading && filteredFolders.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
            삭제된 폴더 ({filteredFolders.length})
          </div>
          <div className="trash-list">
            {filteredFolders.map(folder => {
              const isMyFolder = folder.created_by && folder.created_by === currentUser?.id;
              const canPurgeFolder = isOwnerOrAdmin || isMyFolder;

              return (
                <div key={folder.id} className="trash-list-item">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 0 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-sm)', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <FolderIcon size={20} color={folder.color || 'var(--accent-primary)'} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {folder.name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2, flexWrap: 'wrap' }}>
                        <span className="badge-days">{folder.days_remaining}일 후 자동 삭제</span>
                        {isMyFolder && (
                          <span style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            color: 'var(--accent-primary)',
                            background: 'rgba(59, 130, 246, 0.12)',
                            padding: '1px 5px',
                            borderRadius: '4px',
                            border: '1px solid rgba(59, 130, 246, 0.25)'
                          }}>
                            내가 생성함
                          </span>
                        )}
                        <span>• {formatDate(folder.trashed_at)}</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <button 
                      className="btn-icon" 
                      onClick={() => handleRestoreFolder(folder)}
                      title="원래 위치로 복구"
                      disabled={actionLoadingId === folder.id}
                    >
                      <RotateCcw size={15} color="var(--accent-emerald)" />
                    </button>
                    {canPurgeFolder && (
                      <button 
                        className="btn-icon" 
                        onClick={() => handleDeletePermanentFolder(folder)}
                        title={isMyFolder ? "영구 삭제 (내가 생성한 폴더)" : "영구 삭제 (소유자/관리자)"}
                        disabled={actionLoadingId === folder.id}
                      >
                        <Trash2 size={15} color="var(--accent-rose)" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. Trashed Files */}
      {!isLoading && filteredFiles.length > 0 && (
        <div>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
            삭제된 파일 & 문서 ({filteredFiles.length})
          </div>
          <div className="trash-list">
            {filteredFiles.map(file => {
              const isMyFile = file.created_by && file.created_by === currentUser?.id;
              const canPurgeFile = isOwnerOrAdmin || isMyFile;

              return (
                <div key={file.id} className="trash-list-item">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 0 }}>
                    {file.thumbnail_url ? (
                      <img 
                        src={file.thumbnail_url} 
                        alt="" 
                        style={{ width: 36, height: 36, borderRadius: 'var(--radius-sm)', objectFit: 'cover', background: 'var(--bg-tertiary)', flexShrink: 0 }}
                      />
                    ) : (
                      <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-sm)', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {getFileIcon(file)}
                      </div>
                    )}

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.name}>
                        {file.name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2, flexWrap: 'wrap' }}>
                        <span className="badge-days">{file.days_remaining}일 후 자동 삭제</span>
                        {isMyFile && (
                          <span style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            color: 'var(--accent-primary)',
                            background: 'rgba(59, 130, 246, 0.12)',
                            padding: '1px 5px',
                            borderRadius: '4px',
                            border: '1px solid rgba(59, 130, 246, 0.25)'
                          }}>
                            내가 올림
                          </span>
                        )}
                        <span>{formatBytes(file.size_bytes)}</span>
                        {file.folder_name && <span>• 폴더: {file.folder_name}</span>}
                        <span>• {formatDate(file.trashed_at)}</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <button 
                      className="btn-icon" 
                      onClick={() => handleRestoreFile(file)}
                      title="원래 위치로 복구"
                      disabled={actionLoadingId === file.id}
                    >
                      <RotateCcw size={15} color="var(--accent-emerald)" />
                    </button>
                    {canPurgeFile && (
                      <button 
                        className="btn-icon" 
                        onClick={() => handleDeletePermanentFile(file)}
                        title={isMyFile ? "영구 삭제 (내가 올린 파일)" : "영구 삭제 (소유자/관리자)"}
                        disabled={actionLoadingId === file.id}
                      >
                        <Trash2 size={15} color="var(--accent-rose)" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

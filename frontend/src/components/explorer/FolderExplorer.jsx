import React, { useState, useRef, useEffect } from 'react';
import { 
  Folder as FolderIcon, 
  FolderPlus, 
  FileText, 
  FileCode, 
  Image as ImageIcon, 
  FileArchive, 
  File, 
  Download, 
  Trash2, 
  Star, 
  UploadCloud, 
  ChevronRight, 
  ChevronLeft,
  Plus, 
  ExternalLink, 
  Table, 
  Film,
  Eye,
  Sparkles,
  MoreHorizontal,
  Home,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FileImage,
  MoreVertical,
  ChevronsLeft,
  ChevronsRight,
  CheckSquare,
  Square,
  FolderInput,
  X,
  Filter,
  RefreshCw,
  Info,
  Loader2
} from '../../utils/icons';
import { downloadFileChunked, getThumbnailUrl, clearMediaToken, ensureMediaToken } from '../../api';
import { extractFilesFromDataTransfer } from '../../utils/fileUploadUtils';
import { useDialog } from '../../context/DialogContext';
import Select from '../common/Select';
import FileInfoModal from '../modals/FileInfoModal';

function getPageNumbers(currentPage, totalPages) {
  if (!totalPages || totalPages <= 1) return [1];
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, '...', totalPages];
  }
  if (currentPage >= totalPages - 3) {
    return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
}

export default function FolderExplorer({
  workspaceName = '',
  theme = 'dark',
  isLoading = false,
  activeView = 'all',
  onSelectView,
  currentFolder,
  subfolders = [],
  files = [],
  folderPath = [],
  onSelectFolder,
  onOpenFile,
  onOpenMediaPreview,
  onNewNote,
  onNewFolder,
  onOpenUpload,
  onDeleteFile,
  onToggleFavorite,
  onDropFiles,
  onFolderContextMenu,
  onFileContextMenu,
  onBackgroundContextMenu,
  onDownloadFolder,
  onDownloadFile,
  onOpenMoveModal,
  onBatchDownload,
  onBatchDelete,
  onDirectMoveFiles,
  hasOpenWindows = false,
  hasNewFiles = false,
  onRefreshNewFiles,
  sortBy = 'updated_at',
  onSortByChange,
  sortOrder = 'desc',
  onToggleSortOrder,
  currentPage = 1,
  onPageChange,
  pageSize = 20,
  onPageSizeChange,
  paginationMeta = null,
  uploadManager = null,
}) {
  const { showAlert } = useDialog();
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState([]);
  const [infoFile, setInfoFile] = useState(null);
  const [removingIds, setRemovingIds] = useState(new Set());
  // Cards fading out are hidden from the grid as soon as the fade finishes,
  // rather than waiting on the server round-trip (moveToTrashFile + refreshFiles)
  // to actually drop them from `files` — otherwise the faded card's now-empty
  // grid slot sits there for however long that network call takes, then
  // collapses abruptly once `files` updates, which reads as a jarring delayed
  // layout jump (most visible on slower mobile connections).
  const [hiddenIds, setHiddenIds] = useState(new Set());
  // Guards the "새 문서" buttons: onNewNote does a create + refresh round-trip
  // with no visual feedback of its own, so a slow network made it easy to
  // double-click and create two documents without realizing the first click
  // had registered at all.
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const handleCreateNote = async () => {
    if (isCreatingNote || !onNewNote) return;
    setIsCreatingNote(true);
    try {
      await onNewNote();
    } finally {
      setIsCreatingNote(false);
    }
  };

  // Prune ids that have actually left `files` (real deletion confirmed) so
  // this Set doesn't grow forever across a long session.
  useEffect(() => {
    setHiddenIds(prev => {
      if (prev.size === 0) return prev;
      const stillPresent = new Set(files.map(f => f.id));
      const next = new Set([...prev].filter(id => stillPresent.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [files]);

  const [downloadProgress, setDownloadProgress] = useState(null); // { fileId, percent, status }
  const [isBreadcrumbOpen, setIsBreadcrumbOpen] = useState(false);
  const breadcrumbRef = useRef(null);

  // Clear selection when folder changes
  useEffect(() => {
    setSelectedFileIds([]);
  }, [currentFolder?.id, activeView]);

  // Close breadcrumb dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (breadcrumbRef.current && !breadcrumbRef.current.contains(e.target)) {
        setIsBreadcrumbOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleFileSelection = (fileId, e) => {
    if (e) e.stopPropagation();
    setSelectedFileIds(prev =>
      prev.includes(fileId) ? prev.filter(id => id !== fileId) : [...prev, fileId]
    );
  };

  const isImageOrVideo = (file) => {
    if (!file) return false;
    const type = (file.file_type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    return type === 'image' || type === 'video' || name.match(/\.(png|jpe?g|gif|webp|svg|bmp|ico|mp4|webm|ogg|mov)$/i);
  };

  const isMarkdownFile = (file) => {
    if (!file) return false;
    const name = (file.name || '').toLowerCase();
    return file.is_markdown === true || name.endsWith('.md') || name.endsWith('.markdown');
  };

  const isPreviewableFile = (file) => {
    if (!file) return false;
    if (isMarkdownFile(file)) return false;
    const type = (file.file_type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    return type === 'image' || type === 'video' || type === 'pdf' || type === 'docx' || type === 'xlsx' || type === 'archive' ||
           name.match(/\.(pdf|png|jpe?g|gif|webp|svg|bmp|ico|mp4|webm|ogg|mov|avi|mkv|docx|doc|xlsx|xls|csv|zip|tar|gz|7z)$/i);
  };

  const getFileIcon = (file) => {
    if (file.is_markdown || file.name.endsWith('.md')) return <FileText size={16} color="var(--accent-primary)" />;
    if (file.file_type === 'pdf' || file.name.endsWith('.pdf')) return <FileText size={16} color="var(--accent-rose)" />;
    if (file.file_type === 'docx' || file.name.endsWith('.docx') || file.name.endsWith('.doc')) return <FileText size={16} color="#2563eb" />;
    if (file.file_type === 'xlsx' || file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) return <Table size={16} color="var(--accent-emerald)" />;
    if (file.file_type === 'image' || file.name.match(/\.(png|jpe?g|gif|webp|svg)$/i)) return <ImageIcon size={16} color="var(--accent-emerald)" />;
    if (file.file_type === 'video' || file.name.match(/\.(mp4|webm|mov)$/i)) return <Film size={16} color="var(--accent-primary)" />;
    if (file.file_type === 'code') return <FileCode size={16} color="#8b5cf6" />;
    if (file.file_type === 'archive') return <FileArchive size={16} color="var(--accent-amber)" />;
    return <File size={16} color="var(--text-secondary)" />;
  };

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  };

  // Resilient Range Download
  const handleDownload = async (file, e) => {
    if (e) e.stopPropagation();
    try {
      if (file.s3_key) {
        setDownloadProgress({ fileId: file.id, percent: 5, status: '다운로드 준비 중...' });
        await downloadFileChunked(
          file.id,
          file.name,
          file.size_bytes,
          ({ percent, status }) => {
            setDownloadProgress({ fileId: file.id, percent, status });
          }
        );
        setTimeout(() => setDownloadProgress(null), 1500);
      } else if (file.content) {
        const blob = new Blob([file.content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      await showAlert({
        title: '다운로드 실패',
        message: '파일을 다운로드하지 못했습니다: ' + err.message,
        type: 'error'
      });
      setDownloadProgress(null);
    }
  };

  const dragCounter = useRef(0);

  const handleDragEnter = (e) => {
    e.preventDefault();
    dragCounter.current += 1;
    setIsDragOver(true);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      setIsDragOver(false);
      dragCounter.current = 0;
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragOver(false);
    dragCounter.current = 0;
    const extractedFiles = await extractFilesFromDataTransfer(e.dataTransfer);
    if (extractedFiles && extractedFiles.length > 0) {
      onDropFiles(extractedFiles);
    }
  };

  const handleCardClick = (file, e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      toggleFileSelection(file.id, e);
      return;
    }
    if (onOpenFile) {
      onOpenFile(file);
    }
  };

  const sortedSubfolders = [...subfolders].sort((a, b) => {
    if (sortBy === 'name') {
      return sortOrder === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
    } else if (sortBy === 'created_at') {
      const diff = new Date(a.created_at || 0) - new Date(b.created_at || 0);
      return sortOrder === 'asc' ? diff : -diff;
    } else if (sortBy === 'updated_at') {
      const diff = new Date(a.updated_at || 0) - new Date(b.updated_at || 0);
      return sortOrder === 'asc' ? diff : -diff;
    } else if (sortBy === 'size_bytes') {
      return sortOrder === 'asc' ? (a.file_count || 0) - (b.file_count || 0) : (b.file_count || 0) - (a.file_count || 0);
    }
    return 0;
  });

  // paginationMeta comes from the backend's PagedFileResponse — total_count,
  // not total_items. Falling back to files.length (this page's loaded count)
  // when paginationMeta is unavailable, not files.length + subfolders.length;
  // this represents the file list's total, matching what pagination governs.
  const totalItemCount = paginationMeta?.total_count ?? files.length;
  const totalPages = paginationMeta?.total_pages || Math.ceil(totalItemCount / pageSize) || 1;

  return (
    <div 
      className={`folder-explorer ${isDragOver ? 'drag-over' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Download Floating Progress Bar */}
      {downloadProgress && (
        <div className="download-progress-bar">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
            <span style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-primary)' }}>
              {downloadProgress.status || '다운로드 중...'}
            </span>
            <span style={{ fontSize: '0.78rem', color: 'var(--accent-primary)', fontWeight: 700 }}>
              {downloadProgress.percent}%
            </span>
          </div>
          <div style={{ width: '100%', height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${downloadProgress.percent}%`, height: '100%', background: 'var(--accent-primary)', transition: 'width 0.2s ease' }} />
          </div>
        </div>
      )}

      {/* Explorer Header: Breadcrumb & Actions */}
      <div className="explorer-header">
        <div className="breadcrumb-nav">
          <span
            className={`breadcrumb-item ${(!currentFolder && activeView === 'all') ? 'active' : ''}`}
            onClick={() => {
              if (onSelectView) onSelectView('all');
              else if (onSelectFolder) onSelectFolder(null);
            }}
            title="홈"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}
          >
            <Home size={15} />
            <span>홈</span>
          </span>

          {activeView === 'notes' ? (
            <>
              <ChevronRight size={13} className="breadcrumb-sep" />
              <span className="breadcrumb-item active" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <FileText size={14} color="var(--accent-primary)" />
                <span>문서</span>
              </span>
            </>
          ) : activeView === 'favorites' ? (
            <>
              <ChevronRight size={13} className="breadcrumb-sep" />
              <span className="breadcrumb-item active" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Star size={14} color="var(--accent-amber)" fill="var(--accent-amber)" />
                <span>즐겨찾기</span>
              </span>
            </>
          ) : folderPath.length <= 3 ? (
            folderPath.map(f => (
              <React.Fragment key={f.id}>
                <ChevronRight size={13} className="breadcrumb-sep" />
                <span 
                  className={`breadcrumb-item ${f.id === currentFolder?.id ? 'active' : ''}`}
                  onClick={() => onSelectFolder(f.id)}
                  title={f.name}
                >
                  {f.name}
                </span>
              </React.Fragment>
            ))
          ) : (
            <>
              {/* Ellipsis Dropdown for intermediate ancestor folders */}
              <ChevronRight size={13} className="breadcrumb-sep" />
              <div ref={breadcrumbRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <button
                  className="breadcrumb-ellipsis-btn"
                  onClick={() => setIsBreadcrumbOpen(prev => !prev)}
                  title="이전 상위 폴더 목록"
                >
                  <MoreHorizontal size={14} />
                </button>
                {isBreadcrumbOpen && (
                  <div className="breadcrumb-dropdown">
                    <div style={{ padding: '0.35rem 0.65rem', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                      상위 폴더 경로
                    </div>
                    {folderPath.slice(0, folderPath.length - 2).map(f => (
                      <div
                        key={f.id}
                        className="breadcrumb-dropdown-item"
                        title={f.name}
                        onClick={() => {
                          setIsBreadcrumbOpen(false);
                          onSelectFolder(f.id);
                        }}
                      >
                        <FolderIcon size={14} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
                        <span className="breadcrumb-dropdown-item-name">{f.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Show last 2 folders in trail */}
              {folderPath.slice(folderPath.length - 2).map(f => (
                <React.Fragment key={f.id}>
                  <ChevronRight size={13} className="breadcrumb-sep" />
                  <span 
                    className={`breadcrumb-item ${f.id === currentFolder?.id ? 'active' : ''}`}
                    onClick={() => onSelectFolder(f.id)}
                    title={f.name}
                  >
                    {f.name}
                  </span>
                </React.Fragment>
              ))}
            </>
          )}
        </div>

        {/* Action Buttons */}
        <div className="explorer-actions">
          {activeView === 'notes' ? (
            <button className="btn-primary explorer-btn" onClick={handleCreateNote} disabled={isCreatingNote} title="새 문서 작성">
              {isCreatingNote ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
              <span>새 문서</span>
            </button>
          ) : activeView === 'favorites' ? (
            <button 
              className="btn-secondary explorer-btn" 
              onClick={() => {
                if (onSelectView) onSelectView('all');
                else if (onSelectFolder) onSelectFolder(null);
              }} 
              title="모든 파일 탐색"
            >
              <Home size={15} />
              <span>모든 파일 둘러보기</span>
            </button>
          ) : (
            <>
              {currentFolder && (
                <button 
                  className="btn-secondary explorer-btn" 
                  onClick={() => onDownloadFolder && onDownloadFolder(currentFolder)} 
                  title="현재 폴더 전체를 ZIP으로 다운로드"
                >
                  <FileArchive size={15} />
                  <span className="hide-mobile">ZIP 다운로드</span>
                </button>
              )}
              <button className="btn-secondary explorer-btn" onClick={onOpenUpload} title="파일 및 폴더 업로드">
                <UploadCloud size={15} />
                <span className="hide-mobile">업로드</span>
              </button>
              <button className="btn-secondary explorer-btn" onClick={() => onNewFolder && onNewFolder(currentFolder?.id)} title="현재 경로에 새 폴더 생성">
                <FolderPlus size={15} />
                <span className="hide-mobile">새 폴더</span>
              </button>
              <button className="btn-primary explorer-btn" onClick={handleCreateNote} disabled={isCreatingNote} title="새 문서 작성">
                {isCreatingNote ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
                <span className="hide-mobile">새 문서</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Explorer Secondary Toolbar: Sort & Count Controls */}
      <div className="explorer-toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div className="explorer-toolbar-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {files.length > 0 && (
            <button
              type="button"
              className="btn-icon"
              style={{ fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)', padding: '3px 8px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}
              onClick={() => {
                if (selectedFileIds.length === files.length) {
                  setSelectedFileIds([]);
                } else {
                  setSelectedFileIds(files.map(f => f.id));
                }
              }}
            >
              {selectedFileIds.length === files.length ? <CheckSquare size={14} color="var(--accent-primary)" /> : <Square size={14} />}
              <span>{selectedFileIds.length === files.length ? '전체 해제' : '다중 선택'}</span>
            </button>
          )}
        </div>

        <div className="explorer-toolbar-right">
          <div className="sort-control-group">
            <span className="sort-label hide-mobile">
              <ArrowUpDown size={13} />
              <span>정렬:</span>
            </span>
            <Select
              className="sort-select"
              value={sortBy}
              onChange={(v) => onSortByChange && onSortByChange(v)}
              title="정렬 기준"
              style={{ width: 160 }}
              options={[
                { value: 'updated_at', label: '최근 수정일순' },
                { value: 'created_at', label: '생성일순' },
                { value: 'name', label: '이름순 (가나다/ABC)' },
                { value: 'file_type', label: '종류순 (확장자)' },
                { value: 'size_bytes', label: '크기순 (용량)' },
              ]}
            />
            <button
              className={`sort-order-btn ${sortOrder === 'asc' ? 'active' : ''}`}
              onClick={() => onToggleSortOrder && onToggleSortOrder()}
              title={sortOrder === 'asc' ? '오름차순 (클릭시 내림차순)' : '내림차순 (클릭시 오름차순)'}
            >
              {sortOrder === 'asc' ? '▲ 오름차순' : '▼ 내림차순'}
            </button>
          </div>
        </div>
      </div>

      {/* A file in this folder was added, edited, or removed elsewhere (e.g.
          an upload still running, or a document someone edited) — refresh is
          manual so the current page's files don't keep getting silently
          bumped onto later pages as changed items sort to the top. */}
      {hasNewFiles && (
        <button
          type="button"
          onClick={onRefreshNewFiles}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            width: '100%',
            margin: '0 0 1.25rem 0',
            padding: '0.7rem 1.25rem',
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: 'var(--radius-lg)',
            color: 'var(--accent-emerald)',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: 'pointer',
            textAlign: 'left'
          }}
        >
          <RefreshCw size={15} />
          새로운 변경 사항이 있습니다 · 새로고침
        </button>
      )}

      {/* Loading Skeleton State */}
      {isLoading ? (
        <div style={{ marginTop: '1.25rem' }}>
          {/* Subfolders Skeleton */}
          <div style={{ marginBottom: '2rem' }}>
            <div className="skeleton-box" style={{ width: 100, height: 16, marginBottom: '0.85rem' }} />
            <div className="grid-folders">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="skeleton-box" style={{ height: 48, borderRadius: 'var(--radius-md)' }} />
              ))}
            </div>
          </div>
          {/* Files Skeleton */}
          <div>
            <div className="skeleton-box" style={{ width: 140, height: 16, marginBottom: '0.85rem' }} />
            <div className="grid-cards">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="skeleton-box" style={{ height: 160, borderRadius: 'var(--radius-md)' }} />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* 1. Subfolders Section (Only in all/folder view) */}
          {activeView !== 'notes' && activeView !== 'favorites' && sortedSubfolders.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
                폴더 ({sortedSubfolders.length})
              </div>
          <div className="grid-folders">
            {sortedSubfolders.map(sub => (
              <div 
                key={sub.id} 
                className="folder-card"
                onClick={() => onSelectFolder(sub.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (onFolderContextMenu) onFolderContextMenu(e, sub);
                }}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes('application/json')) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }
                }}
                onDrop={(e) => {
                  const dataStr = e.dataTransfer.getData('application/json');
                  if (dataStr) {
                    try {
                      const parsed = JSON.parse(dataStr);
                      if (parsed.type === 'kb_files' && parsed.fileIds && parsed.fileIds.length > 0) {
                        e.preventDefault();
                        e.stopPropagation();
                        onDirectMoveFiles && onDirectMoveFiles(parsed.fileIds, sub.id);
                        setSelectedFileIds([]);
                      }
                    } catch (err) {}
                  }
                }}
              >
                <FolderIcon size={20} color={sub.color || 'var(--accent-primary)'} />
                <span title={sub.name} style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {sub.name}
                </span>

                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {sub.file_count > 0 && (
                    <span className="menu-badge">{sub.file_count}</span>
                  )}
                  <button
                    className="btn-icon"
                    style={{ padding: '3px', opacity: 0.7 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDownloadFolder && onDownloadFolder(sub);
                    }}
                    title="폴더를 ZIP으로 다운로드"
                  >
                    <FileArchive size={14} color="var(--text-muted)" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2. Files Grid Section */}
      <div>
        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
          {activeView === 'notes' ? `문서 (${totalItemCount})` : activeView === 'favorites' ? `즐겨찾기 항목 (${totalItemCount})` : `문서 및 파일 (${totalItemCount})`}
        </div>

        {files.length === 0 && (activeView === 'notes' || activeView === 'favorites' || sortedSubfolders.length === 0) ? (
          activeView === 'notes' ? (
            <div style={{
              padding: '4rem 2rem',
              textAlign: 'center',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              border: '1px dashed var(--border-medium)',
              margin: '0.5rem 0'
            }}>
              <div style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1.25rem'
              }}>
                <FileText size={28} color="var(--accent-primary)" />
              </div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                작성된 문서가 없습니다
              </h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', maxWidth: 420, margin: '0 auto 1.5rem', lineHeight: 1.6 }}>
                아이디어, 메모, 지식을 자유롭게 작성하고 AI 검색으로 빠르게 찾아보세요.
              </p>
              <button className="btn-primary" onClick={handleCreateNote} disabled={isCreatingNote} style={{ padding: '0.6rem 1.35rem', margin: '0 auto' }}>
                {isCreatingNote ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
                <span>새 문서 작성</span>
              </button>
            </div>
          ) : activeView === 'favorites' ? (
            <div style={{
              padding: '4rem 2rem',
              textAlign: 'center',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              border: '1px dashed var(--border-medium)',
              margin: '0.5rem 0'
            }}>
              <div style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1.25rem'
              }}>
                <Star size={28} color="var(--accent-amber)" fill="var(--accent-amber)" />
              </div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                즐겨찾기한 항목이 없습니다
              </h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', maxWidth: 420, margin: '0 auto 1.5rem', lineHeight: 1.6 }}>
                자주 확인하는 중요한 문서나 폴더 카드의 별표(★) 아이콘을 클릭하여 즐겨찾기에 추가해보세요.
              </p>
              <button 
                className="btn-secondary" 
                onClick={() => {
                  if (onSelectView) onSelectView('all');
                  else if (onSelectFolder) onSelectFolder(null);
                }} 
                style={{ padding: '0.6rem 1.35rem', margin: '0 auto' }}
              >
                <Home size={15} />
                <span>모든 파일 둘러보기</span>
              </button>
            </div>
          ) : (
            <div style={{
              padding: '4rem 2rem',
              textAlign: 'center',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              border: '1px dashed var(--border-medium)',
              margin: '0.5rem 0'
            }}>
              <div style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                backgroundColor: 'var(--bg-secondary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1.25rem',
                border: '1px solid var(--border-subtle)'
              }}>
                <FolderPlus size={28} color="var(--text-muted)" />
              </div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                {currentFolder ? `'${currentFolder.name}' 폴더가 비어 있습니다` : '저장된 항목이 없습니다'}
              </h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', maxWidth: 420, margin: '0 auto 1.5rem', lineHeight: 1.6 }}>
                새 문서를 작성하거나 미디어 파일을 드래그하여 업로드하세요.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                <button className="btn-primary" onClick={handleCreateNote} disabled={isCreatingNote} style={{ padding: '0.6rem 1.25rem' }}>
                  {isCreatingNote ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
                  <span>새 문서 작성</span>
                </button>
                <button className="btn-secondary" onClick={onOpenUpload} style={{ padding: '0.6rem 1.25rem' }}>
                  <UploadCloud size={16} />
                  <span>파일 업로드</span>
                </button>
              </div>
            </div>
          )
        ) : (
          <div className="grid-cards">
            {files.filter(file => !hiddenIds.has(file.id)).map(file => {
              const isSelected = selectedFileIds.includes(file.id);
              const previewable = isPreviewableFile(file);
              const hasVisualThumb = isImageOrVideo(file) || file.thumbnail_url || file.thumbnail_s3_key;

              return (
                <div
                  key={file.id}
                  className={`file-card ${isSelected ? 'selected' : ''} ${removingIds.has(file.id) ? 'is-removing' : ''}`}
                  draggable={true}
                  onDragStart={(e) => {
                    const ids = selectedFileIds.includes(file.id) ? selectedFileIds : [file.id];
                    e.dataTransfer.setData('application/json', JSON.stringify({ type: 'kb_files', fileIds: ids }));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={(e) => handleCardClick(file, e)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onFileContextMenu) onFileContextMenu(e, file);
                  }}
                  style={{
                    outline: isSelected ? '2px solid var(--accent-primary)' : undefined,
                    background: isSelected ? 'rgba(59, 130, 246, 0.08)' : undefined,
                  }}
                >
                  <div className="file-card-top">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minHeight: 30, minWidth: 0, flexShrink: 0 }}>
                      <div 
                        onClick={(e) => toggleFileSelection(file.id, e)}
                        title="선택"
                        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, flexShrink: 0 }}
                      >
                        {isSelected ? (
                          <CheckSquare size={16} color="var(--accent-primary)" />
                        ) : (
                          <Square size={16} color="var(--text-muted)" style={{ opacity: 0.5 }} />
                        )}
                      </div>

                      <div className="file-icon-wrap" style={{ flexShrink: 0 }}>
                        {getFileIcon(file)}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                      <button
                        className="btn-icon card-action-btn" 
                        onClick={(e) => { e.stopPropagation(); onToggleFavorite(file); }}
                        title="즐겨찾기"
                      >
                        <Star
                          size={14}
                          color={file.is_favorite ? 'var(--accent-amber)' : 'var(--text-muted)'}
                          fill={file.is_favorite ? 'var(--accent-amber)' : 'none'}
                        />
                      </button>
                      <button 
                        className="btn-icon card-action-btn" 
                        onClick={(e) => handleDownload(file, e)}
                        title="다운로드"
                      >
                        <Download size={14} />
                      </button>
                      <button
                        className="btn-icon card-action-btn"
                        onClick={(e) => { e.stopPropagation(); setInfoFile(file); }}
                        title="파일 정보"
                      >
                        <Info size={14} />
                      </button>
                      <button
                        className="btn-icon card-action-btn"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!onDeleteFile) return;
                          await onDeleteFile(file.id, () => new Promise((resolve) => {
                            setRemovingIds(new Set([file.id]));
                            setTimeout(() => {
                              setHiddenIds(prev => new Set([...prev, file.id]));
                              resolve();
                            }, 220);
                          }));
                          setRemovingIds(new Set());
                        }}
                        title="삭제"
                      >
                        <Trash2 size={14} color="var(--accent-rose)" />
                      </button>
                    </div>
                  </div>

                  {hasVisualThumb ? (
                    <div 
                      className="file-card-thumbnail" 
                      onClick={(e) => { e.stopPropagation(); onOpenMediaPreview(file); }}
                      title="클릭하여 미리보기"
                    >
                      <img
                        src={getThumbnailUrl(file.id)}
                        alt={file.name}
                        loading="lazy"
                        onError={async (e) => {
                          // A thumbnail request can 401 if the cached media
                          // token happened to expire right as this rendered
                          // (e.g. a page-wide refresh right when a backend
                          // under heavy upload load was too slow to renew
                          // it in time) — force a fresh token and retry once
                          // before giving up, instead of hiding permanently.
                          const img = e.currentTarget;
                          if (img.dataset.retriedToken) {
                            img.parentElement.style.display = 'none';
                            return;
                          }
                          img.dataset.retriedToken = '1';
                          clearMediaToken();
                          await ensureMediaToken();
                          img.src = getThumbnailUrl(file.id);
                        }}
                      />
                      <div className="thumbnail-overlay">
                        <Eye size={16} color="#fff" />
                      </div>
                    </div>
                  ) : (
                    <div 
                      className="file-card-doc-preview"
                      onClick={(e) => {
                        if (previewable) {
                          e.stopPropagation();
                          onOpenMediaPreview(file);
                        }
                      }}
                      title={previewable ? "클릭하여 미리보기 열기" : "클릭하여 문서 편집"}
                    >
                      {file.file_type === 'pdf' || file.name.toLowerCase().endsWith('.pdf') ? (
                        <div className="doc-preview-placeholder" style={{ color: 'var(--accent-rose)' }}>
                          <FileText size={24} style={{ opacity: 0.8 }} />
                          <span style={{ fontSize: '0.74rem', fontWeight: 600 }}>PDF 문서 뷰어</span>
                        </div>
                      ) : file.file_type === 'docx' || file.name.match(/\.(docx|doc)$/i) ? (
                        <div className="doc-preview-placeholder" style={{ color: '#2563eb' }}>
                          <FileText size={24} style={{ opacity: 0.8 }} />
                          <span style={{ fontSize: '0.74rem', fontWeight: 600 }}>Word 문서 뷰어</span>
                        </div>
                      ) : file.file_type === 'xlsx' || file.name.match(/\.(xlsx|xls|csv)$/i) ? (
                        <div className="doc-preview-placeholder" style={{ color: 'var(--accent-emerald)' }}>
                          <Table size={24} style={{ opacity: 0.8 }} />
                          <span style={{ fontSize: '0.74rem', fontWeight: 600 }}>스프레드시트 뷰어</span>
                        </div>
                      ) : file.content ? (
                        <div className="doc-preview-text">
                          {file.content.slice(0, 160).replace(/[#*`_~>-]/g, '').trim() || '내용이 비어있는 문서입니다.'}
                        </div>
                      ) : (
                        <div className="doc-preview-placeholder">
                          <FileText size={22} style={{ opacity: 0.35 }} />
                          <span>{file.is_markdown || !file.file_type ? '문서' : `${file.file_type.toUpperCase()} 문서`}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="file-card-title" title={file.name}>
                    {file.name}
                  </div>

                  <div className="file-card-meta">
                    <div className="file-card-meta-left">
                      <span>{formatFileSize(file.size_bytes)}</span>
                      <span>•</span>
                      <span>{formatDate(file.updated_at || file.created_at)}</span>
                    </div>
                    {file.is_embedded && (
                      <span 
                        className="badge-embedded" 
                        title="AI 지식 검색 연동 완료"
                      >
                        <Sparkles size={10} />
                        <span>임베딩됨</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Batch Action Bar */}
      {selectedFileIds.length > 0 && (
        <div className={`batch-floating-bar ${hasOpenWindows ? 'has-open-windows' : ''}`} style={{
          position: 'fixed',
          bottom: hasOpenWindows ? '6.5rem' : '2rem',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-lg)',
          padding: '0.65rem 1.25rem',
          boxShadow: '0 14px 40px rgba(0, 0, 0, 0.45)',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          zIndex: 9000,
          maxWidth: 'calc(100vw - 1.5rem)',
          flexWrap: 'wrap',
          justifyContent: 'center',
          transition: 'bottom 0.2s ease',
        }}>
          <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
            <CheckSquare size={16} color="var(--accent-primary)" />
            <span>{selectedFileIds.length}개 선택됨</span>
          </div>

          <div className="hide-mobile" style={{ height: '18px', width: '1px', background: 'var(--border-subtle)' }} />

          <button
            type="button"
            className="btn-secondary"
            title={selectedFileIds.length === files.length ? '선택 해제' : '전체 선택'}
            onClick={() => {
              if (selectedFileIds.length === files.length) {
                setSelectedFileIds([]);
              } else {
                setSelectedFileIds(files.map(f => f.id));
              }
            }}
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap' }}
          >
            {selectedFileIds.length === files.length ? <Square size={14} /> : <CheckSquare size={14} />}
            <span className="hide-mobile">{selectedFileIds.length === files.length ? '선택 해제' : '전체 선택'}</span>
          </button>

          <button
            type="button"
            className="btn-primary"
            title="폴더로 이동"
            onClick={() => onOpenMoveModal && onOpenMoveModal(selectedFileIds)}
            style={{ padding: '0.4rem 0.85rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap' }}
          >
            <FolderInput size={15} />
            <span className="hide-mobile">폴더로 이동</span>
          </button>

          <button
            type="button"
            className="btn-secondary"
            title="ZIP 다운로드"
            onClick={() => onBatchDownload && onBatchDownload(selectedFileIds)}
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap' }}
          >
            <Download size={15} />
            <span className="hide-mobile">ZIP 다운로드</span>
          </button>

          <button
            type="button"
            className="btn-secondary"
            title="삭제"
            onClick={async () => {
              if (!onBatchDelete) return;
              const idsToDelete = [...selectedFileIds];
              const proceeded = await onBatchDelete(idsToDelete, () => new Promise((resolve) => {
                setRemovingIds(new Set(idsToDelete));
                setTimeout(() => {
                  setHiddenIds(prev => new Set([...prev, ...idsToDelete]));
                  resolve();
                }, 220);
              }));
              if (proceeded !== false) {
                setSelectedFileIds([]);
              }
              setRemovingIds(new Set());
            }}
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--accent-rose)', whiteSpace: 'nowrap' }}
          >
            <Trash2 size={15} />
            <span className="hide-mobile">삭제</span>
          </button>

          <button
            type="button"
            className="btn-icon batch-bar-close"
            onClick={() => setSelectedFileIds([])}
            title="선택 닫기"
          >
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>
      )}
      </>
      )}

      {/* 3. Pagination Controls */}
      {paginationMeta && (totalPages > 1 || totalItemCount > 10) && (
        <div className="pagination-container">
          <div className="pagination-info hide-mobile">
            <span>
              전체 <strong>{totalItemCount}</strong>개 중{' '}
              <strong>{totalItemCount > 0 ? (currentPage - 1) * pageSize + 1 : 0}</strong>-
              <strong>{Math.min(currentPage * pageSize, totalItemCount)}</strong> 표시
            </span>
          </div>

          <div className="pagination-pages">
            <button
              className="btn-pagination-nav"
              disabled={currentPage <= 1}
              onClick={() => onPageChange && onPageChange(currentPage - 1)}
              title="이전 페이지"
            >
              <ChevronLeft size={15} />
              <span>이전</span>
            </button>

            {getPageNumbers(currentPage, totalPages).map((p, idx) => (
              p === '...' ? (
                <span key={`ellipsis-${idx}`} className="pagination-ellipsis">...</span>
              ) : (
                <button
                  key={`page-${p}`}
                  className={`btn-pagination-page ${currentPage === p ? 'active' : ''}`}
                  onClick={() => onPageChange && onPageChange(p)}
                >
                  {p}
                </button>
              )
            ))}

            <button
              className="btn-pagination-nav"
              disabled={currentPage >= totalPages}
              onClick={() => onPageChange && onPageChange(currentPage + 1)}
              title="다음 페이지"
            >
              <span>다음</span>
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="pagination-size-select">
            <Select
              value={pageSize}
              onChange={(v) => onPageSizeChange && onPageSizeChange(Number(v))}
              title="페이지당 표시 개수"
              style={{ width: 110 }}
              options={[
                { value: 10, label: '10개씩' },
                { value: 20, label: '20개씩' },
                { value: 50, label: '50개씩' },
                { value: 100, label: '100개씩' },
              ]}
            />
          </div>
        </div>
      )}

      <FileInfoModal file={infoFile} onClose={() => setInfoFile(null)} />
    </div>
  );
}

function varRadiusFull() {
  return '9999px';
}

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
  ChevronsRight
} from 'lucide-react';
import { downloadFileChunked, getThumbnailUrl } from '../../api';
import { useDialog } from '../../context/DialogContext';

export default function FolderExplorer({
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
  sortBy = 'updated_at',
  onSortByChange,
  sortOrder = 'desc',
  onToggleSortOrder,
  currentPage = 1,
  onPageChange,
  pageSize = 20,
  onPageSizeChange,
  paginationMeta = null,
}) {
  const { showAlert } = useDialog();
  const [isDragOver, setIsDragOver] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(null); // { fileId, percent, status }
  const [isBreadcrumbOpen, setIsBreadcrumbOpen] = useState(false);
  const breadcrumbRef = useRef(null);

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

  const isMediaFile = (file) => {
    return file.file_type === 'image' || 
           file.file_type === 'video' || 
           file.name.match(/\.(png|jpe?g|gif|webp|svg|bmp|ico|mp4|webm|ogg|mov)$/i);
  };

  const getFileIcon = (file) => {
    if (file.is_markdown || file.name.endsWith('.md')) return <FileText size={22} color="var(--accent-primary)" />;
    if (file.file_type === 'pdf' || file.name.endsWith('.pdf')) return <FileText size={22} color="var(--accent-rose)" />;
    if (file.file_type === 'docx' || file.name.endsWith('.docx') || file.name.endsWith('.doc')) return <FileText size={22} color="#2563eb" />;
    if (file.file_type === 'xlsx' || file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) return <Table size={22} color="var(--accent-emerald)" />;
    if (file.file_type === 'image' || file.name.match(/\.(png|jpe?g|gif|webp|svg)$/i)) return <ImageIcon size={22} color="var(--accent-emerald)" />;
    if (file.file_type === 'video' || file.name.match(/\.(mp4|webm|mov)$/i)) return <Film size={22} color="var(--accent-primary)" />;
    if (file.file_type === 'code') return <FileCode size={22} color="#8b5cf6" />;
    if (file.file_type === 'archive') return <FileArchive size={22} color="var(--accent-amber)" />;
    return <File size={22} color="var(--text-secondary)" />;
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
    e.stopPropagation();
    if (onDownloadFile) {
      onDownloadFile(file, e);
      return;
    }
    try {
      if (file.s3_key) {
        setDownloadProgress({ fileId: file.id, percent: 10, status: '다운로드 준비 중...' });
        await downloadFileChunked(file.id, file.name, file.size_bytes, ({ percent, status }) => {
          setDownloadProgress({ fileId: file.id, percent, status });
        });
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

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    dragCounter.current = 0;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onDropFiles(e.dataTransfer.files);
    }
  };

  const handleCardClick = (file) => {
    if (isMediaFile(file) && onOpenMediaPreview) {
      onOpenMediaPreview(file);
    } else {
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

  const getPageNumbers = (current, total) => {
    if (!total || total <= 1) return [1];
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    if (current <= 4) {
      return [1, 2, 3, 4, 5, '...', total];
    }
    if (current >= total - 3) {
      return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
    }
    return [1, '...', current - 1, current, current + 1, '...', total];
  };

  const totalItemCount = paginationMeta?.total_count ?? files.length;
  const totalPages = paginationMeta?.total_pages ?? 1;

  return (
    <div 
      className={`folder-explorer ${isDragOver ? 'drag-over' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onContextMenu={(e) => {
        if (e.target.closest('.file-card') || e.target.closest('.folder-card')) return;
        e.preventDefault();
        if (onBackgroundContextMenu) onBackgroundContextMenu(e);
      }}
    >
      {/* Download Progress Banner */}
      {downloadProgress && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-medium)',
          borderRadius: 'var(--radius-md)',
          padding: '1rem 1.25rem',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 1000,
          minWidth: 300,
          backdropFilter: 'blur(8px)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
            <span>다운로드 진행 중</span>
            <span style={{ color: 'var(--accent-primary)' }}>{downloadProgress.percent}%</span>
          </div>
          <div style={{
            height: 6,
            backgroundColor: 'var(--bg-tertiary)',
            borderRadius: 'var(--radius-full)',
            overflow: 'hidden',
            marginBottom: 6
          }}>
            <div style={{
              height: '100%',
              width: `${downloadProgress.percent}%`,
              backgroundColor: 'var(--accent-primary)',
              transition: 'width 0.2s ease'
            }} />
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {downloadProgress.status}
          </div>
        </div>
      )}

      {/* Drag & Drop Visual Overlay */}
      {isDragOver && (
        <div className="drag-overlay">
          <div className="drag-overlay-box">
            <UploadCloud size={48} color="var(--accent-primary)" />
            <div style={{ fontSize: '1.2rem', fontWeight: 700, marginTop: '1rem' }}>
              파일 또는 폴더를 여기에 놓아 업로드
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 4 }}>
              폴더 통째로 드래그 시 하위 계층 구조가 그대로 유지되어 자동 생성됩니다.
            </div>
          </div>
        </div>
      )}

      {/* Breadcrumb Header & Actions Toolbar */}
      <div className="explorer-header">
        <div className="breadcrumb-nav">
          <span 
            className={`breadcrumb-item ${!currentFolder ? 'active' : ''}`}
            onClick={() => onSelectFolder(null)}
            title="최상위 루트 저장소"
          >
            <Home size={14} style={{ marginRight: 3, verticalAlign: 'middle' }} />
            <span>루트</span>
          </span>

          {folderPath.length <= 3 ? (
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
                        onClick={() => {
                          setIsBreadcrumbOpen(false);
                          onSelectFolder(f.id);
                        }}
                      >
                        <FolderIcon size={14} color="var(--accent-primary)" />
                        <span>{f.name}</span>
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
            <span className="hide-mobile">파일/폴더 업로드</span>
          </button>
          <button className="btn-secondary explorer-btn" onClick={() => onNewFolder(currentFolder?.id)} title="새 하위 폴더">
            <FolderPlus size={15} />
            <span className="hide-mobile">새 폴더</span>
          </button>
          <button className="btn-primary explorer-btn" onClick={onNewNote} title="새 마크다운 노트 작성">
            <Plus size={15} />
            <span className="hide-mobile">새 노트</span>
          </button>
        </div>
      </div>

      {/* Explorer Secondary Toolbar: Sort & Count Controls */}
      <div className="explorer-toolbar">
        <div className="explorer-toolbar-left">
          <span className="explorer-item-count">
            전체 <strong>{totalItemCount}</strong>개 항목
          </span>
        </div>

        <div className="explorer-toolbar-right">
          <div className="sort-control-group">
            <span className="sort-label hide-mobile">
              <ArrowUpDown size={13} />
              <span>정렬:</span>
            </span>
            <select
              className="sort-select"
              value={sortBy}
              onChange={(e) => onSortByChange && onSortByChange(e.target.value)}
              title="정렬 기준"
            >
              <option value="updated_at">최근 수정일순</option>
              <option value="created_at">생성일순</option>
              <option value="name">이름순 (가나다/ABC)</option>
              <option value="file_type">종류순 (확장자)</option>
              <option value="size_bytes">크기순 (용량)</option>
            </select>
            <button
              className={`sort-order-btn ${sortOrder === 'asc' ? 'active' : ''}`}
              onClick={onToggleSortOrder}
              title={sortOrder === 'asc' ? '오름차순 (클릭시 내림차순)' : '내림차순 (클릭시 오름차순)'}
            >
              {sortOrder === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
              <span className="sort-order-text hide-mobile">{sortOrder === 'asc' ? '오름차순' : '내림차순'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 1. Subfolders Section */}
      {sortedSubfolders.length > 0 && (
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
              >
                <FolderIcon size={20} color={sub.color || 'var(--accent-primary)'} />
                <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
          문서 및 파일 ({files.length})
        </div>

        {files.length === 0 && sortedSubfolders.length === 0 ? (
          <div style={{
            padding: '4rem 2rem',
            textAlign: 'center',
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            border: '1px dashed var(--border-medium)'
          }}>
            <FileText size={44} color="var(--text-muted)" style={{ margin: '0 auto 1rem', display: 'block' }} />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              저장된 항목이 없습니다
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', maxWidth: 400, margin: '0.5rem auto 1.5rem' }}>
              새 마크다운 문서를 작성하거나 이미지/동영상/문서 파일을 드래그하여 업로드하세요.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button className="btn-primary" onClick={onNewNote}>
                <Plus size={16} />
                <span>새 노트 작성</span>
              </button>
              <button className="btn-secondary" onClick={onOpenUpload}>
                <UploadCloud size={16} />
                <span>파일 업로드</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="grid-cards">
            {files.map(file => {
              const hasMedia = isMediaFile(file);

              return (
                <div 
                  key={file.id} 
                  className="file-card"
                  onClick={() => handleCardClick(file)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onFileContextMenu) onFileContextMenu(e, file);
                  }}
                >
                  <div className="file-card-top">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <div className="file-icon-wrap">
                        {getFileIcon(file)}
                      </div>
                      {file.is_embedded && (
                        <span 
                          className="badge-embedded" 
                          title="AI 지식 검색 연동 완료"
                        >
                          <Sparkles size={11} />
                          <span>임베딩됨</span>
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '0.2rem' }}>
                      {hasMedia && (
                        <button
                          className="btn-icon"
                          onClick={(e) => { e.stopPropagation(); onOpenMediaPreview(file); }}
                          title="미디어 미리보기"
                        >
                          <Eye size={15} color="var(--accent-primary)" />
                        </button>
                      )}
                      <button 
                        className="btn-icon" 
                        onClick={(e) => { e.stopPropagation(); onToggleFavorite(file); }}
                        title="즐겨찾기"
                      >
                        <Star 
                          size={15} 
                          color={file.is_favorite ? 'var(--accent-amber)' : 'var(--text-muted)'} 
                          fill={file.is_favorite ? 'var(--accent-amber)' : 'none'} 
                        />
                      </button>
                      <button 
                        className="btn-icon" 
                        onClick={(e) => handleDownload(file, e)}
                        title="다운로드"
                      >
                        <Download size={15} />
                      </button>
                      <button 
                        className="btn-icon" 
                        onClick={(e) => { e.stopPropagation(); onDeleteFile(file.id); }}
                        title="삭제"
                      >
                        <Trash2 size={15} color="var(--accent-rose)" />
                      </button>
                    </div>
                  </div>

                  {(file.thumbnail_url || file.thumbnail_s3_key || hasMedia) && (
                    <div 
                      className="file-card-thumbnail" 
                      onClick={(e) => { e.stopPropagation(); onOpenMediaPreview(file); }}
                      title="클릭하여 미리보기"
                    >
                      <img 
                        src={getThumbnailUrl(file.id)} 
                        alt={file.name} 
                        loading="lazy" 
                        onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }}
                      />
                      <div className="thumbnail-overlay">
                        <Eye size={16} color="#fff" />
                      </div>
                    </div>
                  )}

                  <div className="file-card-title" title={file.name}>
                    {file.name}
                  </div>

                  <div className="file-card-meta">
                    <span>{formatFileSize(file.size_bytes)}</span>
                    <span>{formatDate(file.updated_at || file.created_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange && onPageSizeChange(Number(e.target.value))}
              title="페이지당 표시 개수"
            >
              <option value={10}>10개씩</option>
              <option value={20}>20개씩</option>
              <option value={50}>50개씩</option>
              <option value={100}>100개씩</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

function varRadiusFull() {
  return '9999px';
}

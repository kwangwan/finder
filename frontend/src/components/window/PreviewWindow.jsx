import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SuggestionMenuController, getDefaultReactSlashMenuItems } from '@blocknote/react';
import { filterSuggestionItems } from '@blocknote/core';
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import {
  X,
  Minus,
  Maximize2,
  Minimize2,
  Download,
  Copy,
  Check,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Sparkles,
  FileText,
  Film,
  Image as ImageIcon,
  Table,
  FileCode,
  File,
  Eye,
  Music,
  ExternalLink,
  RefreshCw,
  Sun,
  Moon,
  Layers,
  Loader2,
  Clock,
  Star,
  Trash2,
  Paperclip
} from '../../utils/icons';
import { getMediaPreviewUrl, downloadFileChunked, getFileDetail } from '../../api';
import { useNoteEditor, BN_THEME, blocksToMarkdownTableSafe } from '../../hooks/useNoteEditor';
import AttachExistingFileModal from '../editor/AttachExistingFileModal';
import VersionHistoryModal from '../editor/VersionHistoryModal';
import VideoPlayer from '../common/VideoPlayer';

export default function PreviewWindow({
  windowState,
  onClose,
  onMinimize,
  onMaximize,
  onFocus,
  onPositionChange,
  onSizeChange,
  onUpdateWindowFile,
  onToggleFavorite,
  onDeleteFile,
  activeWorkspaceId,
  currentUser
}) {
  const { id, file, isMinimized, isMaximized, position, size, zIndex } = windowState;

  const [fileDetail, setFileDetail] = useState(file);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [mediaUrl, setMediaUrl] = useState(null);
  const [copied, setCopied] = useState(false);

  // Image viewer controls
  const [zoomLevel, setZoomLevel] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const [bgMode, setBgMode] = useState('checkerboard'); // 'checkerboard' | 'light' | 'dark'

  // Dragging & Resizing state
  const windowRef = useRef(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, posX: position.x, posY: position.y });
  const isResizingRef = useRef(false);
  const resizeStartRef = useRef({ mouseX: 0, mouseY: 0, width: size.width, height: size.height });
  // Toggled only at drag/resize start & end (not on every mousemove) so the
  // maximize/restore transition below can be gated off during a live
  // drag/resize without re-rendering per mousemove.
  const [isInteracting, setIsInteracting] = useState(false);

  // Minimize plays a shrink-toward-dock animation before the window actually
  // unmounts, since the parent flips isMinimized to true immediately.
  const [minimizePhase, setMinimizePhase] = useState('none'); // 'none' | 'closing' | 'hidden'
  const prevIsMinimizedRef = useRef(isMinimized);
  useEffect(() => {
    if (isMinimized && !prevIsMinimizedRef.current) {
      setMinimizePhase('closing');
      prevIsMinimizedRef.current = isMinimized;
      const t = setTimeout(() => setMinimizePhase('hidden'), 220);
      return () => clearTimeout(t);
    }
    if (!isMinimized) {
      setMinimizePhase('none');
    }
    prevIsMinimizedRef.current = isMinimized;
  }, [isMinimized]);

  // Load detailed content if text/markdown/code document without content
  useEffect(() => {
    if (!file) return;

    const url = getMediaPreviewUrl(file.id);
    setMediaUrl(url);

    const fileNameLower = file.name?.toLowerCase() || '';
    const isDoc = file.file_type === 'docx' || file.file_type === 'xlsx' || file.file_type === 'text' ||
                  file.file_type === 'code' || file.is_markdown ||
                  fileNameLower.match(/\.(docx|doc|xlsx|xls|csv|txt|json|py|js|html|css|md|yaml|yml|ts|jsx|tsx|sh)$/i);

    if (isDoc && (!file.content || file.content.length < 5)) {
      setIsLoadingContent(true);
      getFileDetail(file.id)
        .then((detail) => setFileDetail(detail))
        .catch((err) => console.error('Failed to load file details:', err))
        .finally(() => setIsLoadingContent(false));
    } else {
      setFileDetail(file);
    }
  }, [file]);

  // File type detection
  const fileNameLower = file.name?.toLowerCase() || '';
  const isVideo = file.file_type === 'video' || fileNameLower.match(/\.(mp4|webm|ogg|mov|avi|mkv)$/i);
  const isAudio = file.file_type === 'audio' || fileNameLower.match(/\.(mp3|wav|ogg|m4a|aac|flac)$/i);
  const isImage = file.file_type === 'image' || fileNameLower.match(/\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i);
  const isPdf = file.file_type === 'pdf' || fileNameLower.endsWith('.pdf');
  const isExcel = file.file_type === 'xlsx' || fileNameLower.match(/\.(xlsx|xls|csv)$/i);
  const isDocx = file.file_type === 'docx' || fileNameLower.match(/\.(docx|doc)$/i);
  const isMarkdown = file.is_markdown || fileNameLower.endsWith('.md') || fileNameLower.endsWith('.markdown');
  const isTextOrCode = file.file_type === 'text' || file.file_type === 'code' || isMarkdown || 
                       fileNameLower.match(/\.(txt|json|py|js|html|css|yaml|yml|ts|jsx|tsx|sh|sql|xml|env)$/i);

  const displayContent = fileDetail?.content || file.content || '';

  // Opening a note's preview window now IS its (live, collaborative) editor
  // — there is no separate read-only mode or dedicated edit page anymore.
  // `enabled` also waits out the content-prefetch above so the collaborative
  // bootstrap always seeds from the note's real content, never a stale/
  // partial `file` object passed in at window-open time (e.g. from a file
  // list response that omits `content`).
  const noteEditor = useNoteEditor({
    file: fileDetail,
    activeWorkspaceId,
    currentUser,
    enabled: isMarkdown && !isLoadingContent,
    onFileUpdated: (updated) => onUpdateWindowFile(id, updated)
  });

  // Copy text content — for a live note, copy its current (possibly
  // unsaved-to-disk-but-already-in-the-editor) markdown rather than the
  // last-saved snapshot.
  const handleCopyContent = () => {
    const content = isMarkdown && noteEditor.editor
      ? blocksToMarkdownTableSafe(noteEditor.editor, noteEditor.editor.document)
      : displayContent;
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    downloadFileChunked(file.id, file.name, file.size_bytes);
  };

  // Format file size
  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Header icon
  const getHeaderIcon = () => {
    if (isMarkdown) return <FileText size={15} color="var(--accent-primary)" />;
    if (isVideo) return <Film size={15} color="var(--accent-primary)" />;
    if (isAudio) return <Music size={15} color="var(--accent-primary)" />;
    if (isImage) return <ImageIcon size={15} color="var(--accent-emerald)" />;
    if (isPdf) return <FileText size={15} color="var(--accent-rose)" />;
    if (isExcel) return <Table size={15} color="var(--accent-emerald)" />;
    if (isDocx) return <FileText size={15} color="#2563eb" />;
    if (isTextOrCode) return <FileCode size={15} color="var(--accent-amber)" />;
    return <File size={15} color="var(--text-secondary)" />;
  };

  // ==========================================
  // Mouse & Touch Dragging (Window Movement)
  // ==========================================
  const handleDragStart = (e) => {
    if (isMaximized) return;
    if (typeof window !== 'undefined' && window.innerWidth <= 768) return; // Fixed on mobile
    if (e.target.closest('.window-action-btn') || e.target.closest('.window-os-controls') || e.target.closest('.window-header-actions')) return;
    // The title input already has its own mousedown handler (handleTitleMouseDown)
    // that decides between dragging and editing — if it let this bubble up here
    // (i.e. the input was already focused, mid-edit), don't also start a drag.
    if (e.target.closest('.window-title-input') && document.activeElement === e.target) return;

    onFocus(id);
    isDraggingRef.current = true;
    setIsInteracting(true);
    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;

    dragStartRef.current = {
      mouseX: clientX,
      mouseY: clientY,
      posX: position.x,
      posY: position.y
    };

    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
    window.addEventListener('touchmove', handleDragMove, { passive: false });
    window.addEventListener('touchend', handleDragEnd);
  };

  const handleDragMove = useCallback((e) => {
    if (!isDraggingRef.current) return;
    if (e.cancelable) e.preventDefault();

    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;

    const deltaX = clientX - dragStartRef.current.mouseX;
    const deltaY = clientY - dragStartRef.current.mouseY;

    const screenW = window.innerWidth;
    const screenH = window.innerHeight;

    const newX = Math.max(0, Math.min(screenW - 120, dragStartRef.current.posX + deltaX));
    const newY = Math.max(48, Math.min(screenH - 80, dragStartRef.current.posY + deltaY));

    onPositionChange(id, { x: newX, y: newY });
  }, [id, onPositionChange]);

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
    setIsInteracting(false);
    window.removeEventListener('mousemove', handleDragMove);
    window.removeEventListener('mouseup', handleDragEnd);
    window.removeEventListener('touchmove', handleDragMove);
    window.removeEventListener('touchend', handleDragEnd);
  }, [handleDragMove]);

  // The editable title input spans most of the header's width, leaving too
  // little bare header area to grab for dragging. Mirror how a real OS
  // title-bar rename field behaves: mousedown on the (not-yet-focused) input
  // starts a drag like anywhere else on the header, and only actually
  // focuses the input for editing if the pointer never really moved (a
  // plain click, not a drag). Once the input IS focused, this is skipped
  // entirely — normal text-editing clicks just place the caret.
  const handleTitleMouseDown = (e) => {
    const input = e.currentTarget;
    if (document.activeElement === input) return; // already editing — normal caret click
    if (typeof window !== 'undefined' && window.innerWidth <= 768) return; // let mobile just focus normally
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    handleDragStart(e);
    const onUp = (upEvent) => {
      window.removeEventListener('mouseup', onUp);
      if (Math.abs(upEvent.clientX - startX) < 4 && Math.abs(upEvent.clientY - startY) < 4) {
        input.focus();
      }
    };
    window.addEventListener('mouseup', onUp);
  };

  // ==========================================
  // Mouse & Touch Resizing (all 4 edges + all 4 corners)
  // ==========================================
  const RESIZE_MIN_WIDTH = 320;
  const RESIZE_MIN_HEIGHT = 240;
  const resizeDirRef = useRef('se');

  const handleResizeStart = (dir) => (e) => {
    if (isMaximized) return;
    if (typeof window !== 'undefined' && window.innerWidth <= 768) return; // Disabled on mobile
    e.stopPropagation();
    onFocus(id);
    isResizingRef.current = true;
    resizeDirRef.current = dir;
    setIsInteracting(true);

    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;

    resizeStartRef.current = {
      mouseX: clientX,
      mouseY: clientY,
      width: size.width,
      height: size.height,
      posX: position.x,
      posY: position.y
    };

    window.addEventListener('mousemove', handleResizeMove);
    window.addEventListener('mouseup', handleResizeEnd);
    window.addEventListener('touchmove', handleResizeMove, { passive: false });
    window.addEventListener('touchend', handleResizeEnd);
  };

  const handleResizeMove = useCallback((e) => {
    if (!isResizingRef.current) return;
    if (e.cancelable) e.preventDefault();

    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;

    const deltaX = clientX - resizeStartRef.current.mouseX;
    const deltaY = clientY - resizeStartRef.current.mouseY;
    const dir = resizeDirRef.current;
    const start = resizeStartRef.current;

    let newW = start.width;
    let newH = start.height;
    let newX = start.posX;
    let newY = start.posY;

    if (dir.includes('e')) {
      const maxW = window.innerWidth - start.posX - 10;
      newW = Math.max(RESIZE_MIN_WIDTH, Math.min(maxW, start.width + deltaX));
    }
    if (dir.includes('s')) {
      const maxH = window.innerHeight - start.posY - 10;
      newH = Math.max(RESIZE_MIN_HEIGHT, Math.min(maxH, start.height + deltaY));
    }
    if (dir.includes('w')) {
      // Right edge stays fixed — only the left edge (position.x) and width move.
      const rightEdge = start.posX + start.width;
      let proposedX = Math.max(0, start.posX + deltaX);
      let proposedW = rightEdge - proposedX;
      if (proposedW < RESIZE_MIN_WIDTH) {
        proposedW = RESIZE_MIN_WIDTH;
        proposedX = rightEdge - RESIZE_MIN_WIDTH;
      }
      newX = proposedX;
      newW = proposedW;
    }
    if (dir.includes('n')) {
      // Bottom edge stays fixed — only the top edge (position.y) and height move.
      const bottomEdge = start.posY + start.height;
      let proposedY = Math.max(48, start.posY + deltaY);
      let proposedH = bottomEdge - proposedY;
      if (proposedH < RESIZE_MIN_HEIGHT) {
        proposedH = RESIZE_MIN_HEIGHT;
        proposedY = bottomEdge - RESIZE_MIN_HEIGHT;
      }
      newY = proposedY;
      newH = proposedH;
    }

    onSizeChange(id, { width: newW, height: newH });
    if (dir.includes('w') || dir.includes('n')) {
      onPositionChange(id, { x: newX, y: newY });
    }
  }, [id, onSizeChange, onPositionChange]);

  const handleResizeEnd = useCallback(() => {
    isResizingRef.current = false;
    setIsInteracting(false);
    window.removeEventListener('mousemove', handleResizeMove);
    window.removeEventListener('mouseup', handleResizeEnd);
    window.removeEventListener('touchmove', handleResizeMove);
    window.removeEventListener('touchend', handleResizeEnd);
  }, [handleResizeMove]);

  // Image pan & zoom handlers
  const handleImageMouseDown = (e) => {
    if (zoomLevel <= 1) return;
    e.preventDefault();
    setIsPanning(true);
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleImageMouseMove = (e) => {
    if (!isPanning || zoomLevel <= 1) return;
    setPan({
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y
    });
  };

  const handleImageMouseUp = () => {
    setIsPanning(false);
  };

  const getContainerBgStyle = () => {
    if (isVideo || isPdf) return { backgroundColor: '#090d16' };
    if (!isImage) return { backgroundColor: 'var(--bg-primary)' };
    if (bgMode === 'light') return { backgroundColor: '#ffffff' };
    if (bgMode === 'dark') return { backgroundColor: '#0f141c' };
    return {
      backgroundColor: '#232936',
      backgroundImage: `
        linear-gradient(45deg, #1b202c 25%, transparent 25%), 
        linear-gradient(-45deg, #1b202c 25%, transparent 25%), 
        linear-gradient(45deg, transparent 75%, #1b202c 75%), 
        linear-gradient(-45deg, transparent 75%, #1b202c 75%)
      `,
      backgroundSize: '20px 20px',
      backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
    };
  };

  if (minimizePhase === 'hidden') return null;

  const isMinimizingOut = minimizePhase === 'closing';
  // Transform-origin defaults to the box's own center, so translate+scale
  // together land the box's center at (target + size/2), not at target —
  // for a wide window that drifts the shrink point noticeably off-center.
  // Anchoring at the top-left corner makes the translate target exactly the
  // final box's top-left, so we can center the shrunk box precisely by
  // offsetting for its own (post-scale) size.
  const MINIMIZE_SCALE = 0.05;
  let dockTargetX = 0;
  let dockTargetY = 0;
  if (typeof document !== 'undefined') {
    const dockRect = document.querySelector('.os-desktop-dock')?.getBoundingClientRect();
    const centerX = dockRect ? dockRect.left + dockRect.width / 2 : window.innerWidth / 2;
    const centerY = dockRect ? dockRect.top + dockRect.height / 2 : window.innerHeight - 32;
    dockTargetX = centerX - (size.width * MINIMIZE_SCALE) / 2;
    dockTargetY = centerY - (size.height * MINIMIZE_SCALE) / 2;
  }

  return (
    <div
      ref={windowRef}
      className={`os-preview-window ${isMaximized ? 'is-maximized' : ''} ${isMinimizingOut ? 'is-minimizing' : ''}`}
      style={{
        transformOrigin: 'top left',
        transform: isMinimizingOut
          ? `translate3d(${dockTargetX}px, ${dockTargetY}px, 0) scale(${MINIMIZE_SCALE})`
          : `translate3d(${position.x}px, ${position.y}px, 0)`,
        width: `${size.width}px`,
        height: `${size.height}px`,
        opacity: isMinimizingOut ? 0 : 1,
        zIndex,
        transition: isMinimizingOut
          ? 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease'
          : (isInteracting ? 'box-shadow 0.2s ease' : 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1), width 0.22s cubic-bezier(0.4, 0, 0.2, 1), height 0.22s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s ease'),
      }}
      onMouseDown={() => onFocus(id)}
      onTouchStart={() => onFocus(id)}
    >
      {/* Window Title Bar */}
      <div 
        className="os-window-header"
        onMouseDown={handleDragStart}
        onTouchStart={handleDragStart}
        onDoubleClick={() => onMaximize(id)}
      >
        {/* Left: Title Information */}
        <div className="window-title-box" title={file.name}>
          <div className="window-file-icon">
            {getHeaderIcon()}
          </div>
          {isMarkdown ? (
            <input
              type="text"
              className="window-title-input"
              value={noteEditor.title}
              onChange={noteEditor.handleTitleChange}
              onMouseDown={handleTitleMouseDown}
              placeholder="문서 제목을 입력하세요..."
            />
          ) : (
            <span className="window-title-text">{file.name}</span>
          )}
          {isMarkdown && (
            <span
              className="window-save-status"
              style={{
                color: noteEditor.saveStatus === 'saved' ? 'var(--accent-emerald)' : (noteEditor.saveStatus === 'unsaved' && noteEditor.saveError ? 'var(--accent-rose)' : 'var(--accent-amber)')
              }}
              title={noteEditor.saveStatus === 'unsaved' && noteEditor.saveError ? `저장 실패: ${noteEditor.saveError}` : undefined}
            >
              {noteEditor.saveStatus === 'saved' ? '● 저장됨' : (noteEditor.saveStatus === 'saving' ? '⟳ 저장 중' : (noteEditor.saveError ? '⚠ 저장 실패' : '○ 미저장'))}
            </span>
          )}
          {isMarkdown && noteEditor.syncStatus === 'error' && (
            <span className="window-save-status" style={{ color: 'var(--accent-rose)' }} title="실시간 동기화 서버에 연결할 수 없습니다. 이 브라우저에서만 편집이 저장됩니다.">
              ⚠ 동기화 실패
            </span>
          )}
          {isMarkdown && noteEditor.isUploadingImage && (
            <span className="window-save-status" style={{ color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Loader2 size={11} className="spin" /> 업로드 중
            </span>
          )}
          {file.is_embedded && (
            <span className="badge-embedded-tiny" title="AI 임베딩 완료">
              <Sparkles size={9} />
              <span>AI</span>
            </span>
          )}
        </div>

        {/* Right: Actions & OS Window Controls */}
        <div className="window-header-actions">
          {/* Note Editor Buttons: History, Favorite, Delete, Markdown/PDF Export */}
          {isMarkdown && (
            <>
              <button
                type="button"
                className="window-action-btn icon-only"
                onClick={(e) => { e.stopPropagation(); noteEditor.setIsHistoryModalOpen(true); }}
                title="문서 히스토리"
              >
                <Clock size={13} />
              </button>
              <button
                type="button"
                className="window-action-btn icon-only"
                onClick={(e) => { e.stopPropagation(); onToggleFavorite(fileDetail || file); }}
                title="즐겨찾기 토글"
              >
                <Star size={13} color={file.is_favorite ? '#f59e0b' : undefined} fill={file.is_favorite ? '#f59e0b' : 'none'} />
              </button>
              <button
                type="button"
                className="window-action-btn icon-only"
                onClick={(e) => { e.stopPropagation(); onDeleteFile(file.id); }}
                title="문서 삭제"
              >
                <Trash2 size={13} color="var(--accent-rose)" />
              </button>
              <button
                type="button"
                className="window-action-btn icon-only"
                onClick={(e) => { e.stopPropagation(); noteEditor.handleExportMarkdown(); }}
                title="마크다운 다운로드 (.md)"
              >
                <Download size={13} />
              </button>
              <button
                type="button"
                className="window-action-btn"
                disabled={noteEditor.isExportingPdf}
                onClick={(e) => { e.stopPropagation(); noteEditor.handleExportPdf(); }}
                title="PDF로 내보내기 / 인쇄"
              >
                {noteEditor.isExportingPdf ? (
                  <Loader2 size={13} className="spin" color="var(--accent-rose)" />
                ) : (
                  <FileText size={13} color="var(--accent-rose)" />
                )}
                <span>PDF</span>
              </button>
            </>
          )}

          {/* Copy Button for Text/Markdown/Code */}
          {isTextOrCode && (
            <button
              type="button"
              className="window-action-btn icon-only"
              onClick={(e) => {
                e.stopPropagation();
                handleCopyContent();
              }}
              title="내용 복사"
            >
              {copied ? <Check size={13} color="var(--accent-emerald)" /> : <Copy size={13} />}
            </button>
          )}

          {/* Image Toolbar Controls */}
          {isImage && (
            <>
              <button
                type="button"
                className="window-action-btn icon-only"
                onClick={(e) => {
                  e.stopPropagation();
                  setZoomLevel(prev => Math.min(prev + 0.25, 4));
                }}
                title="확대"
              >
                <ZoomIn size={13} />
              </button>
              <button
                type="button"
                className="window-action-btn icon-only"
                onClick={(e) => {
                  e.stopPropagation();
                  setZoomLevel(prev => Math.max(prev - 0.25, 0.5));
                }}
                title="축소"
              >
                <ZoomOut size={13} />
              </button>
              <button
                type="button"
                className="window-action-btn icon-only"
                onClick={(e) => {
                  e.stopPropagation();
                  setRotation(prev => (prev + 90) % 360);
                }}
                title="90도 회전"
              >
                <RotateCw size={13} />
              </button>
              <button
                type="button"
                className="window-action-btn icon-only"
                onClick={(e) => {
                  e.stopPropagation();
                  setBgMode(prev => prev === 'checkerboard' ? 'dark' : prev === 'dark' ? 'light' : 'checkerboard');
                }}
                title="배경 모드 전환"
              >
                <Layers size={13} />
              </button>
            </>
          )}

          {/* Download Button */}
          <button
            type="button"
            className="window-action-btn icon-only"
            onClick={(e) => {
              e.stopPropagation();
              handleDownload();
            }}
            title="다운로드"
          >
            <Download size={13} />
          </button>

          <div className="window-header-divider" />

          {/* Standard OS Control Icons (Minimize, Maximize/Restore, Close) */}
          <div className="window-os-controls">
            <button 
              type="button"
              className="window-control-icon-btn"
              onClick={(e) => { e.stopPropagation(); onMinimize(id); }}
              title="최소화"
            >
              <Minus size={13} />
            </button>
            <button 
              type="button"
              className="window-control-icon-btn hide-mobile"
              onClick={(e) => { e.stopPropagation(); onMaximize(id); }}
              title={isMaximized ? "이전 크기로 복원" : "최대화"}
            >
              {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
            <button 
              type="button"
              className="window-control-icon-btn close-btn"
              onClick={(e) => { e.stopPropagation(); onClose(id); }}
              title="닫기"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div 
        className="os-window-body"
        style={getContainerBgStyle()}
      >
        {isLoadingContent ? (
          <div className="os-window-loading">
            <RefreshCw size={24} className="spin-anim" color="var(--accent-primary)" />
            <span>내용을 불러오는 중...</span>
          </div>
        ) : isImage ? (
          <div 
            className="os-image-viewport"
            onMouseDown={handleImageMouseDown}
            onMouseMove={handleImageMouseMove}
            onMouseUp={handleImageMouseUp}
            onMouseLeave={handleImageMouseUp}
            style={{ cursor: zoomLevel > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default' }}
          >
            <img
              src={mediaUrl}
              alt={file.name}
              style={{
                transform: `scale(${zoomLevel}) rotate(${rotation}deg) translate(${pan.x / zoomLevel}px, ${pan.y / zoomLevel}px)`,
                transition: isPanning ? 'none' : 'transform 0.15s ease'
              }}
            />
          </div>
        ) : isVideo ? (
          <div className="os-video-viewport" style={{ width: '100%', height: '100%', padding: '0.5rem' }}>
            <VideoPlayer
              src={mediaUrl}
              file={file}
              onDownload={handleDownload}
              autoPlay={false}
            />
          </div>
        ) : isAudio ? (
          <div className="os-audio-viewport">
            <Music size={48} color="var(--accent-primary)" style={{ marginBottom: '1.25rem' }} />
            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>
              {file.name}
            </div>
            <audio controls src={mediaUrl} style={{ width: '85%', maxWidth: 420 }} />
          </div>
        ) : isPdf ? (
          <div className="os-pdf-viewport">
            <iframe 
              src={`${mediaUrl}#toolbar=1&navpanes=0`} 
              title={file.name}
              width="100%" 
              height="100%" 
              style={{ border: 'none' }}
            />
          </div>
        ) : isMarkdown ? (
          <div className="window-note-editor-body">
            {(isLoadingContent || noteEditor.isContentLoading) && (
              <div className="editor-loading-overlay">
                <Loader2 size={20} className="spin" color="var(--accent-primary)" />
                <span>내용을 불러오는 중...</span>
              </div>
            )}
            {noteEditor.editor && (
              <div className="editor-pane-blocknote">
                <BlockNoteView editor={noteEditor.editor} theme={BN_THEME} onChange={noteEditor.handleEditorChange} slashMenu={false}>
                  <SuggestionMenuController
                    triggerCharacter="/"
                    getItems={async (query) => filterSuggestionItems(
                      [
                        ...getDefaultReactSlashMenuItems(noteEditor.editor),
                        {
                          title: '보관함 파일 첨부',
                          onItemClick: () => {
                            insertOrUpdateBlockForSlashMenu(noteEditor.editor, { type: 'paragraph' });
                            noteEditor.setIsAttachModalOpen(true);
                          },
                          aliases: ['file', 'attach', '파일', '첨부', '보관함'],
                          group: '미디어',
                          icon: <Paperclip size={18} />,
                          subtext: '보관함에 이미 저장된 파일을 첨부합니다'
                        }
                      ],
                      query
                    )}
                  />
                </BlockNoteView>
              </div>
            )}

            <AttachExistingFileModal
              isOpen={noteEditor.isAttachModalOpen}
              onClose={() => noteEditor.setIsAttachModalOpen(false)}
              onInsertMarkdown={noteEditor.handleInsertAttachedFile}
            />
            <VersionHistoryModal
              fileId={file.id}
              isOpen={noteEditor.isHistoryModalOpen}
              onClose={() => noteEditor.setIsHistoryModalOpen(false)}
              onRestored={noteEditor.handleVersionRestored}
            />
          </div>
        ) : isTextOrCode ? (
          <div className="os-code-viewport">
            <pre>
              <code>{displayContent || '내용이 없습니다.'}</code>
            </pre>
          </div>
        ) : isDocx || isExcel ? (
          <div className="os-office-viewport">
            <div style={{ textAlign: 'center', maxWidth: 400 }}>
              {isExcel ? <Table size={48} color="var(--accent-emerald)" style={{ margin: '0 auto 12px' }} /> : <FileText size={48} color="#2563eb" style={{ margin: '0 auto 12px' }} />}
              <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)', marginBottom: 8 }}>
                {file.name}
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 18, lineHeight: 1.4 }}>
                스프레드시트 및 Office 문서는 외부 애플리케이션으로 편집하거나 다운로드하여 확인하실 수 있습니다.
              </div>
              <button 
                type="button" 
                className="btn-primary" 
                onClick={handleDownload}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: '0 auto' }}
              >
                <Download size={15} />
                <span>파일 다운로드 ({formatFileSize(file.size_bytes)})</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="os-office-viewport">
            <File size={48} color="var(--text-muted)" style={{ margin: '0 auto 12px', display: 'block' }} />
            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)', marginBottom: 6 }}>
              {file.name}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>
              {formatFileSize(file.size_bytes)}
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={handleDownload}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: '0 auto', flex: 'none' }}
            >
              <Download size={15} />
              <span>다운로드</span>
            </button>
          </div>
        )}
      </div>

      {/* Footer Meta Bar */}
      <div className="os-window-footer">
        <div className="footer-left">
          <span>{formatFileSize(file.size_bytes)}</span>
          {file.created_at && (
            <>
              <span>•</span>
              <span>{new Date(file.updated_at || file.created_at).toLocaleDateString()}</span>
            </>
          )}
        </div>
        {isTextOrCode && displayContent && (
          <div className="footer-right">
            <span>{displayContent.length.toLocaleString()} 자</span>
          </div>
        )}
      </div>

      {/* Resize Handles — all 4 edges + all 4 corners */}
      {!isMaximized && (
        <>
          <div className="os-resize-edge edge-n" onMouseDown={handleResizeStart('n')} onTouchStart={handleResizeStart('n')} title="드래그하여 크기 조절" />
          <div className="os-resize-edge edge-s" onMouseDown={handleResizeStart('s')} onTouchStart={handleResizeStart('s')} title="드래그하여 크기 조절" />
          <div className="os-resize-edge edge-e" onMouseDown={handleResizeStart('e')} onTouchStart={handleResizeStart('e')} title="드래그하여 크기 조절" />
          <div className="os-resize-edge edge-w" onMouseDown={handleResizeStart('w')} onTouchStart={handleResizeStart('w')} title="드래그하여 크기 조절" />
          <div className="os-resize-edge edge-nw" onMouseDown={handleResizeStart('nw')} onTouchStart={handleResizeStart('nw')} title="드래그하여 크기 조절" />
          <div className="os-resize-edge edge-ne" onMouseDown={handleResizeStart('ne')} onTouchStart={handleResizeStart('ne')} title="드래그하여 크기 조절" />
          <div className="os-resize-edge edge-sw" onMouseDown={handleResizeStart('sw')} onTouchStart={handleResizeStart('sw')} title="드래그하여 크기 조절" />
          <div
            className="os-window-resize-handle edge-se"
            onMouseDown={handleResizeStart('se')}
            onTouchStart={handleResizeStart('se')}
            title="드래그하여 크기 조절"
          />
        </>
      )}
    </div>
  );
}

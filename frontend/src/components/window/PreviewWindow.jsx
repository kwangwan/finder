import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWindowChrome } from '../../hooks/useWindowChrome';
import { SuggestionMenuController, getDefaultReactSlashMenuItems } from '@blocknote/react';
import { filterSuggestionItems } from '@blocknote/core';
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import { BlockNoteView } from '@blocknote/mantine';
import BoardPane from '../board/BoardPane';
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
import FileLinksPanel, { useFileLinks } from './FileLinksPanel';
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
  onOpenFile,
  activeWorkspaceId,
  currentUser,
  externalRefreshToken = { n: 0, keys: null },
  onFileRenamed = null,
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

  // Bumped whenever this window changes what it is joined to, so the strip
  // above the body reloads without waiting for the next open.
  const [linksToken, setLinksToken] = useState(0);

  const windowRef = useRef(null);

  // Dragging and eight-way resizing live in a shared hook, so this window and
  // the folder window cannot drift apart on clamping or touch handling.
  // isInteracting is toggled only at drag/resize start & end (not per
  // mousemove) so the maximize/restore transition can be gated off during a
  // live drag without re-rendering on every move.
  const { isInteracting, handleDragStart, handleResizeStart } = useWindowChrome({
    id, position, size, isMaximized, onFocus, onPositionChange, onSizeChange,
  });

  // Minimize plays a shrink-toward-dock animation before the window actually
  // unmounts, since the parent flips isMinimized to true immediately.
  //
  // A window that is *already* minimized when it appears — every minimized
  // window after a page is reloaded, since the taskbar remembers them — has no
  // shrinking to do and starts hidden. Starting it at 'none' drew it open over
  // the desktop, and its own minimize button then did nothing at all: the
  // state it would have set was the state it was already in, so nothing
  // changed and nothing re-rendered.
  const [minimizePhase, setMinimizePhase] = useState(isMinimized ? 'hidden' : 'none'); // 'none' | 'closing' | 'hidden'
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

  // Load detailed content if text/markdown/code document without content.
  //
  // Deliberately keyed on file?.id, NOT the whole `file` object — a
  // markdown note's `file` gets a fresh object reference on every autosave
  // (onUpdateWindowFile, so favorite/rename/etc. can update in place without
  // a global "active file"). If this effect re-ran on every such update, an
  // early autosave of a still-short note (e.g. a just-started bullet list,
  // content like "* " — under the 5-char threshold) would flip
  // isLoadingContent back to true mid-edit. That both (a) swaps the whole
  // window body over to the generic "내용을 불러오는 중" spinner, unmounting
  // the live BlockNoteView, and (b) — via `enabled: isMarkdown &&
  // !isLoadingContent` in the PreviewWindow -> useNoteEditor wiring — tears
  // down and recreates the Yjs doc/provider, whose fresh bootstrap then
  // re-parses whatever (possibly stale-by-then) markdown the refetch
  // returned and replaces the live blocks with it, discarding/corrupting
  // anything typed since. Only ever fetch full content once per window,
  // when it's first opened — after that, the collaborative Yjs doc (once
  // bootstrapped) is the only source of truth for a note's live content.
  useEffect(() => {
    if (!file) return;

    const url = getMediaPreviewUrl(file.id);
    setMediaUrl(url);

    const fileNameLower = file.name?.toLowerCase() || '';
    const isDoc = file.file_type === 'docx' || file.file_type === 'xlsx' || file.file_type === 'text' ||
                  file.file_type === 'code' || file.is_markdown ||
                  fileNameLower.match(/\.(docx|doc|xlsx|xls|csv|txt|json|py|js|html|css|md|yaml|yml|ts|jsx|tsx|sh)$/i);

    // A caller may hand over a partial file — search results open a window
    // from the search hit alone, which carries no size and no content. With
    // nothing to identify the file by, every type check below falls through
    // and even an image renders as the generic "download this file" panel.
    // Fetch the real record whenever the essentials are missing.
    const isIncomplete = !file.name || !file.file_type || file.size_bytes === undefined;

    if (isIncomplete || (isDoc && (!file.content || file.content.length < 5))) {
      setIsLoadingContent(true);
      getFileDetail(file.id)
        .then((detail) => setFileDetail(detail))
        .catch((err) => console.error('Failed to load file details:', err))
        .finally(() => setIsLoadingContent(false));
    } else {
      setFileDetail(file);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id]);

  // Clicking a picture in a document opens the file it came from, so the way
  // documents and files are joined can be walked in both directions instead
  // of only being listed. Selection inside the editor is left untouched — no
  // preventDefault, so resizing and captions still work.
  const handleAttachmentClick = (e) => {
    const media = e.target.closest?.('img, video, audio');
    const src = media?.currentSrc || media?.src || media?.querySelector?.('source')?.src;
    const found = src && String(src).match(/\/storage\/(?:preview|download)\/([0-9a-fA-F-]{36})/);
    if (found) onOpenFile?.({ id: found[1] });
  };

  // Everything below renders from the fetched record, overlaid with whatever
  // the window's own copy holds — that copy is the live one (updateWindowFile
  // patches it on save/rename/favorite) but may start out partial, so the
  // fetched detail supplies the fields it lacks rather than the other way
  // round. Spreading `file` last is safe precisely because a partial object
  // only carries the keys it actually has.
  const resolvedFile = { ...fileDetail, ...file };

  // File type detection
  const fileNameLower = resolvedFile.name?.toLowerCase() || '';
  const isVideo = resolvedFile.file_type === 'video' || fileNameLower.match(/\.(mp4|webm|ogg|mov|avi|mkv)$/i);
  const isAudio = resolvedFile.file_type === 'audio' || fileNameLower.match(/\.(mp3|wav|ogg|m4a|aac|flac)$/i);
  const isImage = resolvedFile.file_type === 'image' || fileNameLower.match(/\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i);
  const isPdf = resolvedFile.file_type === 'pdf' || fileNameLower.endsWith('.pdf');
  const isExcel = resolvedFile.file_type === 'xlsx' || fileNameLower.match(/\.(xlsx|xls|csv)$/i);
  const isDocx = resolvedFile.file_type === 'docx' || fileNameLower.match(/\.(docx|doc)$/i);
  const isBoard = resolvedFile.file_type === 'board';
  const isMarkdown = !isBoard && (resolvedFile.is_markdown || fileNameLower.endsWith('.md') || fileNameLower.endsWith('.markdown'));
  const isTextOrCode = resolvedFile.file_type === 'text' || resolvedFile.file_type === 'code' || isMarkdown ||
                       fileNameLower.match(/\.(txt|json|py|js|html|css|yaml|yml|ts|jsx|tsx|sh|sql|xml|env)$/i);

  const displayContent = resolvedFile.content || '';

  // Opening a note's preview window now IS its (live, collaborative) editor
  // — there is no separate read-only mode or dedicated edit page anymore.
  // `enabled` also waits out the content-prefetch above so the collaborative
  // bootstrap always seeds from the note's real content, never a stale/
  // partial `file` object passed in at window-open time (e.g. from a file
  // list response that omits `content`).
  // The last title we told the rest of the app about, so an autosave that
  // changed only the body does not set every list reloading.
  const renamedNameRef = useRef(file?.name || '');
  const titleInputRef = useRef(null);

  const noteEditor = useNoteEditor({
    file: fileDetail,
    activeWorkspaceId,
    currentUser,
    enabled: isMarkdown && !isLoadingContent,
    onFileUpdated: (updated) => {
      onUpdateWindowFile(id, updated);
      // The title of a 할 일's document is the 할 일's own name, so every
      // other view showing it — the 일정 tab, the board this row belongs
      // to — is told rather than left showing the old one.
      if (updated?.name && updated.name !== renamedNameRef.current) {
        renamedNameRef.current = updated.name;
        onFileRenamed?.(updated.id || file?.id, updated.name);
      }
    }
  });

  // This document renamed somewhere else — its 할 일 renamed in the 일정 탭 or
  // on its board. Left alone while the field is being typed in: the person
  // holding the caret is the one deciding the title.
  useEffect(() => {
    const name = file?.name;
    if (!isMarkdown || !name || name === noteEditor.title) return;
    if (document.activeElement === titleInputRef.current) return;
    renamedNameRef.current = name;
    noteEditor.adoptExternalTitle(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.name, isMarkdown]);

  const links = useFileLinks(file?.id, linksToken);

  // An attachment that has been deleted or thrown away is called out where it
  // sits in the document, not only in the strip above it — otherwise a
  // picture simply stops being there and the document reads as if it never
  // had one. Marked on the rendered element, so the document's own content is
  // never rewritten by what happened to a file.
  useEffect(() => {
    const root = windowRef.current?.querySelector('.editor-pane-blocknote');
    if (!root) return;
    const state = new Map((links?.attachments || []).map((a) => [a.id, a.state]));
    root.querySelectorAll('[data-att-state]').forEach((el) => {
      el.removeAttribute('data-att-state');
      el.closest('.bn-block-content')?.removeAttribute('data-att-state');
    });
    root.querySelectorAll('img, video, audio').forEach((el) => {
      const src = el.currentSrc || el.src || el.querySelector?.('source')?.src || '';
      const found = String(src).match(/\/storage\/(?:preview|download)\/([0-9a-fA-F-]{36})/);
      const found_state = found ? state.get(found[1]) : null;
      if (!found_state || found_state === 'ok') return;
      el.setAttribute('data-att-state', found_state);
      el.closest('.bn-block-content')?.setAttribute('data-att-state', found_state);
    });
  }, [links, noteEditor.isContentLoading]);

  // A save is when what the document points at can have changed, so the
  // connections are re-read then rather than on every keystroke.
  useEffect(() => {
    if (noteEditor.saveStatus === 'saved') setLinksToken((n) => n + 1);
  }, [noteEditor.saveStatus]);

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
    downloadFileChunked(resolvedFile.id, resolvedFile.name, resolvedFile.size_bytes);
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
        <div className="window-title-box" title={resolvedFile.name}>
          <div className="window-file-icon">
            {getHeaderIcon()}
          </div>
          {isMarkdown ? (
            <input
              ref={titleInputRef}
              type="text"
              className="window-title-input"
              value={noteEditor.title}
              onChange={noteEditor.handleTitleChange}
              onMouseDown={handleTitleMouseDown}
              placeholder="문서 제목을 입력하세요..."
            />
          ) : (
            <span className="window-title-text">{resolvedFile.name}</span>
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
                <Star size={13} color={resolvedFile.is_favorite ? '#f59e0b' : undefined} fill={resolvedFile.is_favorite ? '#f59e0b' : 'none'} />
              </button>
              {/* A 할 일's document is deleted from the 할 일, so the button
                  that cannot work is not offered — the server refuses it
                  either way, but being told after clicking is worse. */}
              <button
                type="button"
                className="window-action-btn icon-only"
                disabled={!!links?.board_task}
                onClick={(e) => { e.stopPropagation(); if (!links?.board_task) onDeleteFile(resolvedFile.id); }}
                title={links?.board_task
                  ? '이 문서는 일정의 할 일에 연결되어 있어 일정에서 할 일을 삭제해야 합니다'
                  : '문서 삭제'}
              >
                <Trash2 size={13} color={links?.board_task ? 'var(--text-muted)' : 'var(--accent-rose)'} />
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

          {/* A board has no stored file behind it — its rows live in the
              database — so downloading it would hand back nothing. */}
          {!isBoard && (
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
          )}

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

      {/* What this file is joined to — the documents holding it, what it
          holds, and the 할 일 it belongs to. Above the body so a connection is
          visible without hunting for it, and collapsible for when it is not
          what the window was opened for. */}
      {!isBoard && (
        <FileLinksPanel links={links} isDocument={isMarkdown} onOpenFile={onOpenFile} />
      )}

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
        ) : isBoard ? (
          // A board is a file like any other, so it opens the same way a
          // document does — moved, copied, trashed and found identically.
          <BoardPane
            file={resolvedFile}
            onDirty={() => onUpdateWindowFile(id, { updated_at: new Date().toISOString() })}
            onRenamed={(name) => { onUpdateWindowFile(id, { name }); onFileRenamed?.(file?.id, name); }}
            // A 할 일's name is the title of the document it owns, so a rename
            // here is a rename of that document — the same news as one made in
            // the document's own window, sent the same way.
            onTaskRenamed={(documentId, name) => onFileRenamed?.(documentId, name)}
            refreshToken={externalRefreshToken}
            onOpenDocument={onOpenFile}
          />
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
              alt={resolvedFile.name}
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
              {resolvedFile.name}
            </div>
            <audio controls src={mediaUrl} style={{ width: '85%', maxWidth: 420 }} />
          </div>
        ) : isPdf ? (
          <div className="os-pdf-viewport">
            <iframe 
              src={`${mediaUrl}#toolbar=1&navpanes=0`} 
              title={resolvedFile.name}
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
              <div className="editor-pane-blocknote" onClick={handleAttachmentClick}>
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
              workspaceId={resolvedFile.workspace_id || activeWorkspaceId}
              onClose={() => noteEditor.setIsAttachModalOpen(false)}
              onInsertFile={(picked) => { noteEditor.handleInsertExistingFile(picked); setLinksToken((n) => n + 1); }}
            />
            <VersionHistoryModal
              fileId={resolvedFile.id}
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
                {resolvedFile.name}
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
                <span>파일 다운로드 ({formatFileSize(resolvedFile.size_bytes)})</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="os-office-viewport">
            <File size={48} color="var(--text-muted)" style={{ margin: '0 auto 12px', display: 'block' }} />
            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)', marginBottom: 6 }}>
              {resolvedFile.name}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>
              {formatFileSize(resolvedFile.size_bytes)}
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
          {/* A 일정 has no stored file behind it — its 할 일 rows live in the
              database — so the footer said "0 B" about something that has no
              size at all. */}
          {!isBoard && <span>{formatFileSize(resolvedFile.size_bytes)}</span>}
          {resolvedFile.created_at && (
            <>
              {!isBoard && <span>•</span>}
              <span>{new Date(resolvedFile.updated_at || resolvedFile.created_at).toLocaleDateString()}</span>
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

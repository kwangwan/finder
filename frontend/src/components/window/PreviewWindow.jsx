import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  X, 
  Minus,
  Maximize2, 
  Minimize2,
  Download, 
  Edit3,
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
  Layers
} from 'lucide-react';
import { getMediaPreviewUrl, downloadFileChunked, getFileDetail } from '../../api';

export default function PreviewWindow({
  windowState,
  onClose,
  onMinimize,
  onMaximize,
  onFocus,
  onPositionChange,
  onSizeChange,
  onEditFile
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

  // Load detailed content if text/markdown/code document without content
  useEffect(() => {
    if (!file) return;

    const url = getMediaPreviewUrl(file.id);
    setMediaUrl(url);

    const fileNameLower = file.name?.toLowerCase() || '';
    const isDoc = file.file_type === 'docx' || file.file_type === 'xlsx' || file.file_type === 'text' || 
                  file.file_type === 'code' || file.file_type === 'markdown' ||
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
  const isMarkdown = file.file_type === 'markdown' || fileNameLower.endsWith('.md') || fileNameLower.endsWith('.markdown');
  const isTextOrCode = file.file_type === 'text' || file.file_type === 'code' || isMarkdown || 
                       fileNameLower.match(/\.(txt|json|py|js|html|css|yaml|yml|ts|jsx|tsx|sh|sql|xml|env)$/i);

  const displayContent = fileDetail?.content || file.content || '';

  // Copy text content
  const handleCopyContent = () => {
    if (!displayContent) return;
    navigator.clipboard.writeText(displayContent);
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
    if (e.target.closest('.window-action-btn') || e.target.closest('.window-traffic-lights')) return;

    onFocus(id);
    isDraggingRef.current = true;
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
    window.removeEventListener('mousemove', handleDragMove);
    window.removeEventListener('mouseup', handleDragEnd);
    window.removeEventListener('touchmove', handleDragMove);
    window.removeEventListener('touchend', handleDragEnd);
  }, [handleDragMove]);

  // ==========================================
  // Mouse & Touch Resizing
  // ==========================================
  const handleResizeStart = (e) => {
    if (isMaximized) return;
    e.stopPropagation();
    onFocus(id);
    isResizingRef.current = true;

    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;

    resizeStartRef.current = {
      mouseX: clientX,
      mouseY: clientY,
      width: size.width,
      height: size.height
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

    const minW = 320;
    const minH = 240;
    const maxW = window.innerWidth - position.x - 10;
    const maxH = window.innerHeight - position.y - 10;

    const newW = Math.max(minW, Math.min(maxW, resizeStartRef.current.width + deltaX));
    const newH = Math.max(minH, Math.min(maxH, resizeStartRef.current.height + deltaY));

    onSizeChange(id, { width: newW, height: newH });
  }, [id, position.x, position.y, onSizeChange]);

  const handleResizeEnd = useCallback(() => {
    isResizingRef.current = false;
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

  if (isMinimized) return null;

  return (
    <div
      ref={windowRef}
      className={`os-preview-window ${isMaximized ? 'is-maximized' : ''}`}
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        width: `${size.width}px`,
        height: `${size.height}px`,
        zIndex
      }}
      onMouseDown={() => onFocus(id)}
      onTouchStart={() => onFocus(id)}
    >
      {/* Title Bar (macOS Window Header) */}
      <div 
        className="os-window-header"
        onMouseDown={handleDragStart}
        onTouchStart={handleDragStart}
        onDoubleClick={() => onMaximize(id)}
      >
        {/* Traffic Light Buttons */}
        <div className="window-traffic-lights">
          <button 
            type="button"
            className="traffic-light-btn close"
            onClick={(e) => { e.stopPropagation(); onClose(id); }}
            title="닫기 (Close)"
          >
            <X size={9} />
          </button>
          <button 
            type="button"
            className="traffic-light-btn minimize"
            onClick={(e) => { e.stopPropagation(); onMinimize(id); }}
            title="최소화 (Minimize)"
          >
            <Minus size={9} />
          </button>
          <button 
            type="button"
            className="traffic-light-btn maximize"
            onClick={(e) => { e.stopPropagation(); onMaximize(id); }}
            title={isMaximized ? "복원 (Restore)" : "최대화 (Maximize)"}
          >
            {isMaximized ? <Minimize2 size={9} /> : <Maximize2 size={9} />}
          </button>
        </div>

        {/* Title Information */}
        <div className="window-title-box" title={file.name}>
          <div className="window-file-icon">
            {getHeaderIcon()}
          </div>
          <span className="window-title-text">{file.name}</span>
          {file.is_embedded && (
            <span className="badge-embedded-tiny" title="AI 임베딩 완료">
              <Sparkles size={9} />
              <span>AI</span>
            </span>
          )}
        </div>

        {/* Action Buttons in Header / Right */}
        <div className="window-header-actions">
          {/* Edit Button for Markdown / Text */}
          {isTextOrCode && onEditFile && (
            <button
              type="button"
              className="window-action-btn edit-btn"
              onClick={(e) => {
                e.stopPropagation();
                onEditFile(fileDetail || file);
              }}
              title="에디터에서 수정하기"
            >
              <Edit3 size={13} />
              <span>수정</span>
            </button>
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
          <div className="os-video-viewport">
            <video 
              controls 
              autoPlay={false}
              src={mediaUrl}
              style={{ width: '100%', maxHeight: '100%', objectFit: 'contain' }}
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
          <div className="os-markdown-viewport markdown-body">
            {displayContent ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {displayContent}
              </ReactMarkdown>
            ) : (
              <div className="empty-content-placeholder">
                <FileText size={32} style={{ opacity: 0.4, margin: '0 auto 8px', display: 'block' }} />
                <span>문서 내용이 비어있습니다. 상단 '수정' 버튼을 눌러 내용을 작성해보세요.</span>
              </div>
            )}
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
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: '0 auto' }}
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

      {/* Bottom-Right Resize Handle */}
      {!isMaximized && (
        <div 
          className="os-window-resize-handle"
          onMouseDown={handleResizeStart}
          onTouchStart={handleResizeStart}
          title="드래그하여 크기 조절"
        />
      )}
    </div>
  );
}

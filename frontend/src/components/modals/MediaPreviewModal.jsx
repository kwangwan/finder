import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  X, 
  Download, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  RotateCw,
  RefreshCw,
  Maximize2, 
  FileText, 
  Film, 
  Image as ImageIcon,
  ExternalLink,
  Table,
  FileCode,
  Sun,
  Moon,
  Grid,
  Loader2
} from '../../utils/icons';
import { getMediaPreviewUrl, downloadFileChunked, getFileDetail } from '../../api';
import VideoPlayer from '../common/VideoPlayer';

export default function MediaPreviewModal({
  isOpen,
  onClose,
  file
}) {
  const [mediaUrl, setMediaUrl] = useState(null);
  const [fileDetail, setFileDetail] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const [bgMode, setBgMode] = useState('checkerboard'); // 'checkerboard' | 'light' | 'dark'
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen && file) {
      setZoomLevel(1);
      setRotation(0);
      setPan({ x: 0, y: 0 });
      setError('');
      setIsLoading(false);
      setIsImageLoaded(false);
      const url = getMediaPreviewUrl(file.id);
      setMediaUrl(url);

      const isDocType = file.file_type === 'docx' || file.file_type === 'xlsx' || file.file_type === 'text' || 
                        file.name.match(/\.(docx|doc|xlsx|xls|csv|txt|json|py|js|html|css|md)$/i);
      
      if (isDocType && !file.content) {
        setIsLoading(true);
        getFileDetail(file.id)
          .then(detail => setFileDetail(detail))
          .catch(err => console.error('Failed to load file text detail:', err))
          .finally(() => setIsLoading(false));
      } else {
        setFileDetail(file);
      }
    } else {
      setMediaUrl(null);
      setFileDetail(null);
      setIsImageLoaded(false);
      setZoomLevel(1);
      setRotation(0);
      setPan({ x: 0, y: 0 });
    }
  }, [isOpen, file?.id]);

  if (!isOpen || !file) return null;

  const fileNameLower = file.name.toLowerCase();
  const isVideo = file.file_type === 'video' || fileNameLower.match(/\.(mp4|webm|ogg|mov|avi|mkv)$/i);
  const isImage = file.file_type === 'image' || fileNameLower.match(/\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i);
  const isPdf = file.file_type === 'pdf' || fileNameLower.endsWith('.pdf');
  const isExcel = file.file_type === 'xlsx' || fileNameLower.match(/\.(xlsx|xls|csv)$/i);
  const isDocx = file.file_type === 'docx' || fileNameLower.match(/\.(docx|doc)$/i);
  const isTextOrCode = file.file_type === 'text' || file.file_type === 'code' || file.is_markdown || fileNameLower.match(/\.(txt|json|py|js|html|css|md|yaml|yml|ts|jsx|tsx)$/i);

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const handleDownload = () => {
    downloadFileChunked(file.id, file.name, file.size_bytes);
  };

  const getContainerBgStyle = () => {
    if (isVideo || isPdf) return { backgroundColor: '#05080f' };
    if (!isImage) return { backgroundColor: 'var(--bg-primary)' };
    if (bgMode === 'light') return { backgroundColor: '#ffffff' };
    if (bgMode === 'dark') return { backgroundColor: '#0f141c' };
    // Checkerboard pattern for transparent PNG / SVG / GIF
    return {
      backgroundColor: '#232936',
      backgroundImage: `
        linear-gradient(45deg, #1b202c 25%, transparent 25%), 
        linear-gradient(-45deg, #1b202c 25%, transparent 25%), 
        linear-gradient(45deg, transparent 75%, #1b202c 75%), 
        linear-gradient(-45deg, transparent 75%, #1b202c 75%)
      `,
      backgroundSize: '24px 24px',
      backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0px'
    };
  };

  const getHeaderIcon = () => {
    if (isVideo) return <Film size={20} color="var(--accent-primary)" />;
    if (isImage) return <ImageIcon size={20} color="var(--accent-emerald)" />;
    if (isPdf) return <FileText size={20} color="var(--accent-rose)" />;
    if (isExcel) return <Table size={20} color="var(--accent-emerald)" />;
    if (isDocx) return <FileText size={20} color="#2563eb" />;
    return <File size={20} color="var(--text-secondary)" />;
  };

  const displayContent = fileDetail?.content || file.content;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1100, backgroundColor: 'rgba(0, 0, 0, 0.85)' }}>
      <div 
        className="modal-content media-preview-content" 
        onClick={e => e.stopPropagation()} 
        style={{ 
          maxWidth: isVideo || isPdf ? 960 : 880, 
          width: '95vw', 
          maxHeight: '92vh', 
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-medium)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)'
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.75rem 1.25rem',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-tertiary)',
          gap: '0.75rem'
        }}>
          {/* Left Title & Meta */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0, flex: 1, overflow: 'hidden' }}>
            <div style={{ flexShrink: 0 }}>
              {getHeaderIcon()}
            </div>
            <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
              <div style={{ 
                fontSize: '0.92rem', 
                fontWeight: 700, 
                color: 'var(--text-primary)', 
                whiteSpace: 'nowrap', 
                textOverflow: 'ellipsis', 
                overflow: 'hidden',
                lineHeight: 1.3
              }}>
                {file.name}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', gap: '0.75rem', whiteSpace: 'nowrap' }}>
                <span>{formatFileSize(file.size_bytes)}</span>
                <span>{new Date(file.created_at || file.updated_at || Date.now()).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Right Action Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
            {isImage && (
              <>
                {/* Background Mode Toggle */}
                <div className="hide-mobile" style={{ display: 'flex', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', padding: 2, marginRight: '0.2rem', border: '1px solid var(--border-subtle)' }}>
                  <button 
                    className="btn-icon" 
                    onClick={() => setBgMode('checkerboard')}
                    title="투명 격자 배경 (기본)"
                    style={{ 
                      padding: 4, 
                      borderRadius: 'var(--radius-sm)', 
                      background: bgMode === 'checkerboard' ? 'var(--bg-tertiary)' : 'transparent',
                      color: bgMode === 'checkerboard' ? 'var(--accent-primary)' : 'var(--text-muted)'
                    }}
                  >
                    <Grid size={14} />
                  </button>
                  <button 
                    className="btn-icon" 
                    onClick={() => setBgMode('light')}
                    title="밝은 흰색 배경"
                    style={{ 
                      padding: 4, 
                      borderRadius: 'var(--radius-sm)', 
                      background: bgMode === 'light' ? 'var(--bg-tertiary)' : 'transparent',
                      color: bgMode === 'light' ? 'var(--accent-primary)' : 'var(--text-muted)'
                    }}
                  >
                    <Sun size={14} />
                  </button>
                  <button 
                    className="btn-icon" 
                    onClick={() => setBgMode('dark')}
                    title="어두운 배경"
                    style={{ 
                      padding: 4, 
                      borderRadius: 'var(--radius-sm)', 
                      background: bgMode === 'dark' ? 'var(--bg-tertiary)' : 'transparent',
                      color: bgMode === 'dark' ? 'var(--accent-primary)' : 'var(--text-muted)'
                    }}
                  >
                    <Moon size={14} />
                  </button>
                </div>

                {/* Rotation Controls */}
                <div className="hide-mobile" style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', padding: 2, border: '1px solid var(--border-subtle)' }}>
                  <button 
                    className="btn-icon" 
                    onClick={() => setRotation(r => (r - 90 + 360) % 360)}
                    title="반시계 방향 90° 회전"
                    style={{ padding: 4 }}
                  >
                    <RotateCcw size={14} />
                  </button>
                  <button 
                    className="btn-icon" 
                    onClick={() => setRotation(r => (r + 90) % 360)}
                    title="시계 방향 90° 회전"
                    style={{ padding: 4 }}
                  >
                    <RotateCw size={14} />
                  </button>
                </div>

                {/* Zoom Controls */}
                <div className="hide-mobile" style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', padding: '2px 4px', border: '1px solid var(--border-subtle)', gap: '2px' }}>
                  <button 
                    className="btn-icon" 
                    onClick={() => setZoomLevel(prev => Math.max(Number((prev - 0.25).toFixed(2)), 0.25))}
                    title="축소 (마우스 휠 가능)"
                    style={{ padding: 3 }}
                  >
                    <ZoomOut size={14} />
                  </button>
                  <span style={{ fontSize: '0.74rem', minWidth: 38, textAlign: 'center', fontWeight: 600, color: 'var(--text-muted)', userSelect: 'none' }}>
                    {Math.round(zoomLevel * 100)}%
                  </span>
                  <button 
                    className="btn-icon" 
                    onClick={() => setZoomLevel(prev => Math.min(Number((prev + 0.25).toFixed(2)), 4.0))}
                    title="확대 (마우스 휠 가능)"
                    style={{ padding: 3 }}
                  >
                    <ZoomIn size={14} />
                  </button>
                </div>

                {/* Reset Zoom/Rotate */}
                {(zoomLevel !== 1 || rotation !== 0 || pan.x !== 0 || pan.y !== 0) && (
                  <button 
                    className="btn-icon hide-mobile" 
                    onClick={() => {
                      setZoomLevel(1);
                      setRotation(0);
                      setPan({ x: 0, y: 0 });
                    }}
                    title="배율 및 회전 초기화"
                    style={{ color: 'var(--accent-primary)', padding: 4 }}
                  >
                    <RefreshCw size={14} />
                  </button>
                )}
              </>
            )}

            <button 
              className="btn-secondary" 
              onClick={handleDownload}
              style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem' }}
              title="파일 다운로드"
            >
              <Download size={14} />
              <span className="hide-mobile">다운로드</span>
            </button>

            <button className="btn-icon" onClick={onClose} title="닫기 (ESC)">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Media Content Body */}
        <div 
          onMouseDown={(e) => {
            if (isImage && (zoomLevel > 1 || rotation !== 0)) {
              setIsDragging(true);
              dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
            }
          }}
          onMouseMove={(e) => {
            if (isDragging) {
              setPan({
                x: e.clientX - dragStartRef.current.x,
                y: e.clientY - dragStartRef.current.y
              });
            }
          }}
          onMouseUp={() => setIsDragging(false)}
          onMouseLeave={() => setIsDragging(false)}
          onWheel={(e) => {
            if (isImage) {
              e.preventDefault();
              const delta = e.deltaY < 0 ? 0.15 : -0.15;
              setZoomLevel(prev => Math.min(Math.max(Number((prev + delta).toFixed(2)), 0.25), 4));
            }
          }}
          style={{
            flex: 1,
            minHeight: 440,
            height: isImage ? '75vh' : 'auto',
            maxHeight: 'calc(92vh - 80px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            position: 'relative',
            padding: (isPdf || isVideo) ? 0 : '1.5rem',
            transition: 'background-color 0.25s ease',
            userSelect: isDragging ? 'none' : 'auto',
            ...getContainerBgStyle()
          }}
        >
          {isLoading && (
            <div style={{ color: 'var(--accent-primary)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Loader2 size={18} className="spin" /> 문서 불러오는 중...
            </div>
          )}

          {error && (
            <div style={{ color: 'var(--accent-rose)', fontSize: '0.875rem' }}>
              {error}
            </div>
          )}

          {!isLoading && !error && (
            <>
              {isVideo ? (
                <div style={{ width: '100%', height: '70vh', padding: '0.25rem' }}>
                  <VideoPlayer
                    src={mediaUrl}
                    file={file}
                    onDownload={handleDownload}
                    autoPlay
                  />
                </div>
              ) : isPdf ? (
                <iframe
                  src={mediaUrl}
                  title={file.name}
                  style={{
                    width: '100%',
                    height: '75vh',
                    border: 'none',
                    backgroundColor: '#fff'
                  }}
                />
              ) : isImage ? (
                <>
                  {!isImageLoaded && (
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.85rem',
                      color: 'var(--text-muted)',
                      zIndex: 2,
                      animation: 'fadeIn 0.2s ease'
                    }}>
                      <div style={{
                        width: 48,
                        height: 48,
                        borderRadius: '50%',
                        backgroundColor: 'var(--bg-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
                        border: '1px solid var(--border-subtle)'
                      }}>
                        <Loader2 size={24} color="var(--accent-primary)" className="spin" />
                      </div>
                      <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>
                        고화질 이미지 불러오는 중...
                      </span>
                    </div>
                  )}
                  <img
                    src={mediaUrl}
                    alt={file.name}
                    draggable={false}
                    onLoad={() => setIsImageLoaded(true)}
                    onError={() => {
                      setIsImageLoaded(true);
                      setError('이미지를 불러오지 못했습니다.');
                    }}
                    style={{
                      maxWidth: '90%',
                      maxHeight: '70vh',
                      transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${isImageLoaded ? zoomLevel : 0.94})`,
                      transformOrigin: 'center center',
                      opacity: isImageLoaded ? 1 : 0,
                      transition: isDragging ? 'none' : 'opacity 0.35s ease, transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                      objectFit: 'contain',
                      borderRadius: 'var(--radius-sm)',
                      boxShadow: isImageLoaded ? '0 10px 30px rgba(0, 0, 0, 0.35)' : 'none',
                      pointerEvents: isImageLoaded ? 'auto' : 'none',
                      cursor: (zoomLevel > 1 || rotation !== 0) ? (isDragging ? 'grabbing' : 'grab') : 'default',
                      userSelect: 'none'
                    }}
                  />
                </>
              ) : (isDocx || isExcel || isTextOrCode) && displayContent ? (
                <div style={{
                  width: '100%',
                  height: '100%',
                  maxHeight: '72vh',
                  overflowY: 'auto',
                  padding: '1.5rem 2rem',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  textAlign: 'left'
                }}>
                  <div className="markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {displayContent}
                    </ReactMarkdown>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                  <FileText size={48} style={{ opacity: 0.4, margin: '0 auto 1rem' }} />
                  <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                    미리보기를 직접 지원하지 않는 형식입니다.
                  </div>
                  <p style={{ fontSize: '0.82rem', marginBottom: '1.25rem' }}>
                    상단의 <strong>[다운로드]</strong> 버튼을 눌러 원본 파일을 확인하실 수 있습니다.
                  </p>
                  <button className="btn-primary" onClick={handleDownload} style={{ margin: '0 auto' }}>
                    <Download size={15} />
                    <span>파일 다운로드</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}


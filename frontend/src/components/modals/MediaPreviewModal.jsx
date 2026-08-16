import React, { useState, useEffect } from 'react';
import { 
  X, 
  Download, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  Maximize2, 
  FileText, 
  Film, 
  Image as ImageIcon,
  ExternalLink,
  Calendar,
  User,
  HardDrive,
  Sun,
  Moon,
  Grid
} from 'lucide-react';
import { getMediaPreviewUrl, downloadFileChunked } from '../../api';

export default function MediaPreviewModal({
  isOpen,
  onClose,
  file
}) {
  const [mediaUrl, setMediaUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [bgMode, setBgMode] = useState('checkerboard'); // 'checkerboard' | 'light' | 'dark'
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen && file) {
      setZoomLevel(1);
      setError('');
      setIsLoading(false);
      const url = getMediaPreviewUrl(file.id);
      setMediaUrl(url);
    } else {
      setMediaUrl(null);
    }
  }, [isOpen, file?.id]);

  if (!isOpen || !file) return null;

  const isVideo = file.file_type === 'video' || file.name.match(/\.(mp4|webm|ogg|mov|avi|mkv)$/i);
  const isImage = file.file_type === 'image' || file.name.match(/\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i);

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
    if (isVideo) return { backgroundColor: '#000000' };
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

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1100, backgroundColor: 'rgba(0, 0, 0, 0.85)' }}>
      <div 
        className="modal-content" 
        onClick={e => e.stopPropagation()} 
        style={{ 
          maxWidth: isVideo ? 920 : 860, 
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
          padding: '0.85rem 1.25rem',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-tertiary)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', overflow: 'hidden' }}>
            {isVideo ? (
              <Film size={20} color="var(--accent-primary)" />
            ) : (
              <ImageIcon size={20} color="var(--accent-emerald)" />
            )}
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                {file.name}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', gap: '0.75rem' }}>
                <span>{formatFileSize(file.size_bytes)}</span>
                <span>{new Date(file.created_at || file.updated_at).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {isImage && (
              <>
                {/* Background Mode Toggle */}
                <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', padding: 2, marginRight: '0.4rem', border: '1px solid var(--border-subtle)' }}>
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

                <button 
                  className="btn-icon" 
                  onClick={() => setZoomLevel(prev => Math.min(prev + 0.25, 3))}
                  title="확대"
                >
                  <ZoomIn size={16} />
                </button>
                <button 
                  className="btn-icon" 
                  onClick={() => setZoomLevel(prev => Math.max(prev - 0.25, 0.5))}
                  title="축소"
                >
                  <ZoomOut size={16} />
                </button>
                <button 
                  className="btn-icon" 
                  onClick={() => setZoomLevel(1)}
                  title="원래 크기"
                >
                  <RotateCcw size={15} />
                </button>
              </>
            )}

            <button 
              className="btn-secondary" 
              onClick={handleDownload}
              style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem' }}
              title="파일 다운로드"
            >
              <Download size={14} />
              <span>다운로드</span>
            </button>

            <button className="btn-icon" onClick={onClose} title="닫기">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Media Content Body */}
        <div style={{
          flex: 1,
          minHeight: 360,
          maxHeight: 'calc(92vh - 120px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'auto',
          position: 'relative',
          padding: '1.5rem',
          ...getContainerBgStyle()
        }}>
          {isLoading && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              미디어 로딩 중...
            </div>
          )}

          {error && (
            <div style={{ color: 'var(--accent-rose)', fontSize: '0.875rem' }}>
              {error}
            </div>
          )}

          {!isLoading && !error && mediaUrl && (
            <>
              {isVideo ? (
                <video
                  controls
                  autoPlay
                  playsInline
                  style={{
                    maxWidth: '100%',
                    maxHeight: '70vh',
                    borderRadius: 'var(--radius-sm)',
                    outline: 'none'
                  }}
                  src={mediaUrl}
                >
                  브라우저가 비디오 재생을 지원하지 않습니다.
                </video>
              ) : isImage ? (
                <img
                  src={mediaUrl}
                  alt={file.name}
                  style={{
                    maxWidth: zoomLevel === 1 ? '100%' : 'none',
                    maxHeight: zoomLevel === 1 ? '72vh' : 'none',
                    transform: `scale(${zoomLevel})`,
                    transformOrigin: 'center center',
                    transition: 'transform 0.15s ease',
                    objectFit: 'contain',
                    borderRadius: 'var(--radius-sm)'
                  }}
                />
              ) : (
                <div style={{ color: 'var(--text-muted)' }}>
                  미리보기를 지원하지 않는 형식입니다.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

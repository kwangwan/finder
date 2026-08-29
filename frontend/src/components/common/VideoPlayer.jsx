import React, { useState, useRef } from 'react';
import { Film, Play, Download, AlertCircle, Volume2, Sparkles } from '../../utils/icons';
import { getThumbnailUrl } from '../../api';

export default function VideoPlayer({
  src,
  file,
  onDownload,
  autoPlay = false,
  className = '',
  style = {}
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const videoRef = useRef(null);

  const thumbnailUrl = file?.thumbnail_s3_key || file?.thumbnail_url
    ? (file.thumbnail_url || getThumbnailUrl(file.id))
    : null;

  const formatFileSize = (bytes) => {
    if (!bytes) return '';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const handleLoadedData = () => {
    setIsLoading(false);
    setIsError(false);
  };

  const handleError = (e) => {
    setIsLoading(false);
    setIsError(true);
    setErrorMessage('브라우저에서 직접 재생할 수 없는 코덱이거나 파일이 손상되었습니다.');
  };

  const handleWaiting = () => {
    setIsLoading(true);
  };

  const handlePlaying = () => {
    setIsLoading(false);
  };

  return (
    <div 
      className={`video-player-container ${className}`}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#07090e',
        borderRadius: 'var(--radius-lg, 12px)',
        overflow: 'hidden',
        boxShadow: '0 12px 36px -8px rgba(0, 0, 0, 0.6)',
        ...style
      }}
    >
      {/* Background blurred poster effect */}
      {thumbnailUrl && (
        <div 
          style={{
            position: 'absolute',
            inset: -20,
            backgroundImage: `url(${thumbnailUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(30px) brightness(0.25)',
            opacity: 0.7,
            zIndex: 0,
            pointerEvents: 'none'
          }}
        />
      )}

      {/* Main HTML5 Video Element */}
      <video
        ref={videoRef}
        src={src}
        poster={thumbnailUrl || undefined}
        controls
        autoPlay={autoPlay}
        playsInline
        preload="metadata"
        onLoadedData={handleLoadedData}
        onCanPlay={handleLoadedData}
        onError={handleError}
        onWaiting={handleWaiting}
        onPlaying={handlePlaying}
        style={{
          width: '100%',
          height: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          position: 'relative',
          zIndex: 1,
          outline: 'none',
          opacity: isError ? 0 : 1,
          transition: 'opacity 0.25s ease'
        }}
      >
        브라우저가 비디오 재생을 지원하지 않습니다.
      </video>

      {/* Loading & Buffering Overlay.
          Styled entirely from theme tokens (see .media-loading-* in
          index.css) rather than the hardcoded blue/purple glow it used to
          carry, which clashed badly with the matrix theme's green-on-black
          palette. The indicator is a row of stepping bars instead of a
          rotating icon inside a circle: matrix squares off every corner
          globally, so the round glow and the circular badge came out as
          mismatched squares there, and a smooth continuous spin reads wrong
          against a pixel-art look. Bars are rectangular and step discretely,
          so they suit matrix and the dark/light themes equally. */}
      {isLoading && !isError && (
        <div className="media-loading-overlay">
          <div className="media-loading-bars" aria-hidden="true">
            <span /><span /><span /><span />
          </div>

          <div className="media-loading-title">동영상 스트리밍 로딩 중...</div>

          {file && (
            <div className="media-loading-meta">
              <span className="media-loading-filename">{file.name}</span>
              {file.size_bytes && (
                <>
                  <span>•</span>
                  <span className="media-loading-size">{formatFileSize(file.size_bytes)}</span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Error & Codec Fallback Overlay */}
      {isError && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 3,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            backgroundColor: 'rgba(10, 13, 20, 0.92)',
            backdropFilter: 'blur(16px)',
            textAlign: 'center'
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              backgroundColor: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '1rem',
              color: 'var(--accent-rose, #ef4444)'
            }}
          >
            <AlertCircle size={28} />
          </div>

          <h4 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc', marginBottom: '0.4rem' }}>
            동영상을 재생할 수 없습니다
          </h4>
          <p style={{ fontSize: '0.82rem', color: '#94a3b8', maxWidth: 360, lineHeight: 1.5, marginBottom: '1.25rem' }}>
            {errorMessage} 원본 파일을 다운로드하여 전용 미디어 플레이어에서 재생해보세요.
          </p>

          {onDownload && (
            <button
              type="button"
              className="btn-primary"
              onClick={onDownload}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.55rem 1.25rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                flex: 'none'
              }}
            >
              <Download size={15} />
              <span>원본 동영상 다운로드</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

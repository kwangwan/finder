import React, { useEffect, useRef, useState } from 'react';
import { Film, Play, Download, AlertCircle, Volume2, Sparkles } from '../../utils/icons';
import { getThumbnailUrl } from '../../api';

const RECOVERY_ATTEMPTS = 3;

export default function VideoPlayer({
  src,
  file,
  onDownload,
  // Asked for a URL that works when this one stops working. Returns the new
  // one, or null when it has already been tried.
  onRecoverSrc,
  // Told when something actually loaded, so the caller knows its recovery
  // worked and may try again the next time this happens.
  onLoaded,
  autoPlay = false,
  className = '',
  style = {},
  // Handed the <video> itself, so a caller can send it to a moment — the one
  // where a particular face was found, say.
  onElement = null
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const videoRef = useRef(null);
  const attach = (node) => {
    videoRef.current = node;
    onElement?.(node);
  };

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

  // Where playback was when the source failed, so recovering does not send
  // the viewer back to the beginning of a long video.
  const resumeRef = useRef(null);

  // How many times a video that stopped is given another go before the file
  // is blamed. Reset by anything actually loading, so a long viewing is not
  // spending a budget it filled hours ago.
  const attemptsRef = useRef(0);

  const handleLoadedData = () => {
    setIsLoading(false);
    setIsError(false);
    attemptsRef.current = 0;
    onLoaded?.();
    const resume = resumeRef.current;
    resumeRef.current = null;
    if (resume && videoRef.current) {
      if (resume.time > 0) videoRef.current.currentTime = resume.time;
      if (resume.playing) videoRef.current.play().catch(() => {});
    }
  };

  /**
   * A video that stops playing has not necessarily got anything wrong with it.
   *
   * A media element reports one thing — "cannot play" — for an expired token,
   * a connection that dropped, a range the server refused, and a codec it
   * genuinely does not understand. Only `error.code` tells them apart, and
   * only one of those four is the file's fault:
   *
   * - ABORTED is not a failure at all. It is what the element says when the
   *   source is changed under it or the window it lives in goes away, and
   *   answering it used to spend the single retry the next real failure
   *   needed — so a video opened after another one had just been closed
   *   announced itself as unplayable on its first hiccup.
   * - DECODE means the bytes arrived and could not be made sense of. That is
   *   worth saying out loud, and worth saying accurately.
   * - Everything else is the way in, not the file: asked for again, a few
   *   times, picking up where playback left off.
   */
  const handleError = async () => {
    const video = videoRef.current;
    const code = video?.error?.code;
    if (code === 1 /* MEDIA_ERR_ABORTED */) return;

    const decodeFailed = code === 3 /* MEDIA_ERR_DECODE */;
    if (!decodeFailed && attemptsRef.current < RECOVERY_ATTEMPTS) {
      attemptsRef.current += 1;
      const at = video?.currentTime || 0;
      const wasPlaying = !!video && !video.paused && !video.ended;
      resumeRef.current = { time: at, playing: wasPlaying || autoPlay };
      setIsLoading(true);
      setIsError(false);
      const fresh = await onRecoverSrc?.();
      // A fresh address reloads through the effect below. The same address is
      // worth trying again too — what failed was the journey, not the file —
      // after a pause that grows with each attempt.
      if (!fresh) {
        window.setTimeout(() => { videoRef.current?.load(); }, 600 * attemptsRef.current);
      }
      return;
    }

    setIsLoading(false);
    setIsError(true);
    setErrorMessage(decodeFailed
      ? '영상이 손상되었거나 브라우저가 지원하지 않는 코덱입니다.'
      : '영상을 불러오지 못했습니다. 연결이 끊겼거나 서버가 영상을 보내지 못했습니다.');
  };

  // A new source that arrived after a failure has to actually be loaded: the
  // element gives up on the old one and does not reload on its own.
  useEffect(() => {
    if (videoRef.current && resumeRef.current) videoRef.current.load();
  }, [src]);

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
        ref={attach}
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
          carry, so it belongs to whichever theme is on. */}
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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, MapPin, Camera, Clock, Download, Maximize2 } from '../../utils/icons';
import VideoPlayer from '../common/VideoPlayer';
import { getMediaPreviewUrl, getThumbnailUrl, ensureMediaToken, clearMediaToken } from '../../api';

/**
 * One photograph, with the room to be looked at.
 *
 * Everything that is not the picture gets out of the way: the chrome fades
 * after a few still seconds and comes back on the first movement, and what it
 * says when it is there is only what the picture cannot — the day, the place,
 * the camera. Black surround, no frame, no shadow: the photograph provides
 * the colour.
 */

function fullDate(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${weekday}) ${hh}:${mm}`;
}

function coordinateText(lat, lon) {
  if (lat == null || lon == null) return null;
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}°${ns} ${Math.abs(lon).toFixed(4)}°${ew}`;
}

const IDLE_MS = 2600;

export default function GalleryLightbox({
  item,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onShowOnMap,
  onDownload,
}) {
  const [src, setSrc] = useState(() => (item ? getMediaPreviewUrl(item.id) : null));
  const [isChromeVisible, setChromeVisible] = useState(true);
  const [isLoaded, setLoaded] = useState(false);
  const idleTimer = useRef(null);
  const retriedRef = useRef(false);

  // A fresh address for a picture whose token has run out — the same recovery
  // the rest of the app does, kept to one attempt so a genuinely missing file
  // does not loop.
  const recoverSrc = useCallback(async () => {
    if (!item || retriedRef.current) return null;
    retriedRef.current = true;
    clearMediaToken();
    await ensureMediaToken();
    const fresh = getMediaPreviewUrl(item.id);
    setSrc(fresh);
    return fresh;
  }, [item]);

  useEffect(() => {
    if (!item) return;
    retriedRef.current = false;
    setLoaded(false);
    setSrc(getMediaPreviewUrl(item.id));
  }, [item?.id]);

  const wake = useCallback(() => {
    setChromeVisible(true);
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setChromeVisible(false), IDLE_MS);
  }, []);

  useEffect(() => {
    wake();
    return () => { if (idleTimer.current) window.clearTimeout(idleTimer.current); };
  }, [item?.id, wake]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowLeft') { wake(); onPrev(); }
      else if (event.key === 'ArrowRight') { wake(); onNext(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext, wake]);

  // A swipe on a phone is the same gesture as an arrow key on a desk.
  const touchStart = useRef(null);
  const onTouchStart = (e) => { touchStart.current = e.touches[0]?.clientX ?? null; };
  const onTouchEnd = (e) => {
    const start = touchStart.current;
    const end = e.changedTouches[0]?.clientX;
    touchStart.current = null;
    if (start == null || end == null) return;
    const moved = end - start;
    if (Math.abs(moved) < 60) return;
    wake();
    if (moved > 0) onPrev(); else onNext();
  };

  if (!item) return null;

  const when = fullDate(item.taken_at || item.created_at);
  const where = coordinateText(item.latitude, item.longitude);
  const isVideo = item.file_type === 'video';

  return (
    <div
      className={`gal-light ${isChromeVisible ? 'chrome-on' : 'chrome-off'}`}
      onMouseMove={wake}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
    >
      <div className="gal-light-stage" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {isVideo ? (
          <div className="gal-light-video">
            <VideoPlayer
              src={src}
              file={{ id: item.id, name: item.name, size_bytes: item.size_bytes }}
              autoPlay
              onRecoverSrc={recoverSrc}
              onLoaded={() => { retriedRef.current = false; setLoaded(true); }}
              onDownload={() => onDownload?.(item)}
            />
          </div>
        ) : (
          <>
            {/* The thumbnail is already in the browser's cache from the grid,
                so it stands in — blurred, at full size — while the real file
                arrives. The picture is never a blank rectangle. */}
            {!isLoaded && item.has_thumbnail && (
              <img className="gal-light-blur" src={getThumbnailUrl(item.id)} alt="" aria-hidden="true" />
            )}
            <img
              className={`gal-light-img ${isLoaded ? 'is-loaded' : ''}`}
              src={src}
              alt={item.name}
              onLoad={() => setLoaded(true)}
              onError={recoverSrc}
              draggable={false}
            />
          </>
        )}
      </div>

      <button type="button" className="gal-light-close" onClick={onClose} title="닫기 (Esc)">
        <X size={20} />
      </button>

      {hasPrev && (
        <button type="button" className="gal-light-nav prev" onClick={() => { wake(); onPrev(); }} title="이전 (←)">
          <ChevronLeft size={26} />
        </button>
      )}
      {hasNext && (
        <button type="button" className="gal-light-nav next" onClick={() => { wake(); onNext(); }} title="다음 (→)">
          <ChevronRight size={26} />
        </button>
      )}

      <footer className="gal-light-foot">
        <div className="gal-light-meta">
          <span className="gal-light-name">{item.name}</span>
          <span className="gal-light-facts">
            {when && <span><Clock size={12} /> {when}</span>}
            {item.camera && <span><Camera size={12} /> {item.camera}</span>}
            {where && (
              <button type="button" className="gal-light-place" onClick={() => onShowOnMap?.(item)} title="지도에서 보기">
                <MapPin size={12} /> {where}
              </button>
            )}
            {item.width && item.height && <span><Maximize2 size={12} /> {item.width} × {item.height}</span>}
          </span>
        </div>
        <button type="button" className="gal-light-download" onClick={() => onDownload?.(item)} title="원본 내려받기">
          <Download size={15} />
        </button>
      </footer>
    </div>
  );
}

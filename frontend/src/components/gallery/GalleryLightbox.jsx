import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  X, ChevronLeft, ChevronRight, MapPin, Camera, Clock, Download, Maximize2, Users, UploadCloud,
  ExternalLink,
} from '../../utils/icons';
import VideoPlayer from '../common/VideoPlayer';
import {
  getMediaPreviewUrl, getThumbnailUrl, ensureMediaToken, clearMediaToken, getFacesInItem,
} from '../../api';

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
  onSearchFace,
  onOpenInWindow,
}) {
  const [src, setSrc] = useState(() => (item ? getMediaPreviewUrl(item.id) : null));
  const [isChromeVisible, setChromeVisible] = useState(true);
  const [isLoaded, setLoaded] = useState(false);
  const idleTimer = useRef(null);
  const retriedRef = useRef(false);
  const [faces, setFaces] = useState([]);
  const [scanned, setScanned] = useState(true);
  const [frame, setFrame] = useState(null);
  const imageRef = useRef(null);
  const stageRef = useRef(null);
  const videoRef = useRef(null);
  // Which sighting of a face in a film is being looked at. A film's faces are
  // each at a moment, so one of them is on screen at a time — the one whose
  // moment the film has been sent to.
  const [shownFace, setShownFace] = useState(null);
  const [videoFrame, setVideoFrame] = useState(null);

  // Where the picture actually is inside the <video>. The element is filled by
  // `contain`, so the picture is letterboxed and the element's rectangle is
  // not the picture's — a box placed as a percentage of the element misses by
  // however thick the black bars are.
  //
  // The box is drawn *inside the player*, so these offsets and the box are in
  // one coordinate space. Measuring across two nested wrappers was the earlier
  // mistake: the numbers were each correct and belonged to different frames.
  const measureVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const scale = Math.min(video.clientWidth / video.videoWidth,
                           video.clientHeight / video.videoHeight);
    const width = video.videoWidth * scale;
    const height = video.videoHeight * scale;
    setVideoFrame({
      left: video.offsetLeft + (video.clientWidth - width) / 2,
      top: video.offsetTop + (video.clientHeight - height) / 2,
      width,
      height,
    });
  }, []);

  useEffect(() => {
    if (!shownFace) return undefined;
    const video = videoRef.current;
    measureVideo();
    // Again once the film has actually arrived at the moment and after any
    // reflow: the size is not known until there is a picture.
    const again = () => measureVideo();
    window.addEventListener('resize', again);
    video?.addEventListener('seeked', again);
    video?.addEventListener('loadedmetadata', again);
    const timer = window.setTimeout(again, 120);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', again);
      video?.removeEventListener('seeked', again);
      video?.removeEventListener('loadedmetadata', again);
    };
  }, [shownFace, measureVideo]);

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

  // Who is in this one. Asked for separately and quietly: the picture must
  // not wait on it, and a library that has not been looked at yet simply has
  // nothing to draw.
  useEffect(() => {
    if (!item) return undefined;
    let cancelled = false;
    setFaces([]);
    setScanned(true);
    setShownFace(null);
    getFacesInItem(item.id)
      .then((data) => {
        if (cancelled) return;
        setFaces(data.faces || []);
        setScanned(data.scanned !== false);
      })
      .catch(() => { if (!cancelled) setFaces([]); });
    return () => { cancelled = true; };
  }, [item?.id]);

  const measure = useCallback(() => {
    const image = imageRef.current;
    if (!image) return;
    // offsetWidth rather than getBoundingClientRect: the picture fades in
    // with a slight scale, and the rect would be measured mid-animation —
    // leaving every face box a percent or two adrift. These are layout
    // numbers, which the transform does not touch.
    setFrame({
      left: image.offsetLeft,
      top: image.offsetTop,
      width: image.offsetWidth,
      height: image.offsetHeight,
    });
  }, []);

  // The window can change size under an open picture.
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

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
  const onTouchStart = (e) => {
    // Any touch brings the chrome back. The only thing that woke it was
    // mouse movement, which a phone never reports, and the swipe handler below
    // returns early on a tap — so on a phone, once the close button and the
    // caption had faded, nothing could be done to ask for them again.
    wake();
    touchStart.current = e.touches[0]?.clientX ?? null;
  };
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

  const hasTakenAt = !!item.taken_at;
  const when = fullDate(item.taken_at || item.created_at);
  const where = coordinateText(item.latitude, item.longitude);
  const isVideo = item.file_type === 'video';

  return (
    <div
      className={`gal-light ${isVideo ? 'is-video' : ''} ${isChromeVisible ? 'chrome-on' : 'chrome-off'}`}
      onMouseMove={wake}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
    >
      <div
        className="gal-light-stage"
        ref={stageRef}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        {isVideo ? (
          <div className="gal-light-video">
            <VideoPlayer
              src={src}
              file={{ id: item.id, name: item.name, size_bytes: item.size_bytes }}
              autoPlay
              onRecoverSrc={recoverSrc}
              onLoaded={() => { retriedRef.current = false; setLoaded(true); }}
              onDownload={() => onDownload?.(item)}
              onElement={(node) => { videoRef.current = node; }}
              overlay={shownFace && videoFrame ? (
                <div className="gal-face-pane is-on-video" style={videoFrame}>
                  <button
                    type="button"
                    className="gal-face-box"
                    style={{
                      left: `${shownFace.box[0] * 100}%`,
                      top: `${shownFace.box[1] * 100}%`,
                      width: `${shownFace.box[2] * 100}%`,
                      height: `${shownFace.box[3] * 100}%`,
                    }}
                    onClick={(e) => { e.stopPropagation(); onSearchFace?.(shownFace, item); }}
                    title="이 사람이 나온 사진 찾기"
                  >
                    <span className="gal-face-hint"><Users size={11} /> 이 사람 찾기</span>
                  </button>
                </div>
              ) : null}
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
              ref={imageRef}
              className={`gal-light-img ${isLoaded ? 'is-loaded' : ''}`}
              src={src}
              alt={item.name}
              onLoad={() => { setLoaded(true); measure(); }}
              onError={recoverSrc}
              draggable={false}
            />
            {/* The faces, over exactly where the picture ended up. A photograph
                is letterboxed inside the window, so the boxes — which are
                fractions of the photograph — are laid on a pane matched to the
                picture's own rectangle, measured rather than assumed. */}
            {isLoaded && isChromeVisible && faces.length > 0 && frame && (
              <div className="gal-face-pane" style={frame}>
                {faces.map((face) => (
                  <button
                    key={face.id}
                    type="button"
                    className="gal-face-box"
                    style={{
                      left: `${face.box[0] * 100}%`,
                      top: `${face.box[1] * 100}%`,
                      width: `${face.box[2] * 100}%`,
                      height: `${face.box[3] * 100}%`,
                    }}
                    onClick={(e) => { e.stopPropagation(); onSearchFace?.(face, item); }}
                    title="이 사람이 나온 사진 찾기"
                  >
                    <span className="gal-face-hint"><Users size={11} /> 이 사람 찾기</span>
                  </button>
                ))}
              </div>
            )}
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
            {when && (
              hasTakenAt ? (
                <span><Clock size={12} /> {when}</span>
              ) : (
                <span
                  className="gal-light-undated"
                  title="이 파일에는 촬영 정보가 없어, 올린 날짜를 기준으로 정렬합니다"
                >
                  <UploadCloud size={12} /> 올린 날짜 {when}
                </span>
              )
            )}
            {item.camera && <span><Camera size={12} /> {item.camera}</span>}
            {where && (
              <button type="button" className="gal-light-place" onClick={() => onShowOnMap?.(item)} title="지도에서 보기">
                <MapPin size={12} /> {where}
              </button>
            )}
            {item.width && item.height && <span><Maximize2 size={12} /> {item.width} × {item.height}</span>}
            {faces.length > 0 && !isVideo && (
              <span title="사진 위의 얼굴을 누르면 같은 사람을 찾습니다">
                <Users size={12} /> {faces.length}명
              </span>
            )}
            {faces.length > 0 && isVideo && (
              <span className="gal-light-people">
                <Users size={12} /> {faces.length}명
                {faces.map((face, index) => (
                  <button
                    key={face.id}
                    type="button"
                    className={shownFace?.id === face.id ? 'is-on' : ''}
                    title="이 사람이 나온 순간으로"
                    onClick={() => {
                      setShownFace(face);
                      const video = videoRef.current;
                      if (video && face.frame_time != null) {
                        video.pause();
                        video.currentTime = face.frame_time;
                        // The rest is handled by the `seeked` listener.
                      }
                    }}
                  >
                    {face.frame_time == null
                      ? `${index + 1}번째`
                      : `${Math.floor(face.frame_time / 60)}:${String(Math.floor(face.frame_time % 60)).padStart(2, '0')}`}
                  </button>
                ))}
              </span>
            )}
            {!scanned && (
              <span title="이 사진은 아직 얼굴을 찾기 전입니다">
                <Users size={12} /> 얼굴 찾는 중
              </span>
            )}
          </span>
        </div>
        <div className="gal-light-acts">
          {onOpenInWindow && (
            <button
              type="button"
              onClick={() => onOpenInWindow(item)}
              title="새 창으로 열기"
            >
              <ExternalLink size={15} />
            </button>
          )}
          <button type="button" onClick={() => onDownload?.(item)} title="원본 내려받기">
            <Download size={15} />
          </button>
        </div>
      </footer>
    </div>
  );
}

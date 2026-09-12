import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Play, MapPin, ImageOff } from '../../utils/icons';
import { getThumbnailUrl } from '../../api';

/**
 * The library, laid out the way photographs want to be laid out.
 *
 * Not a grid of squares. A square crop throws away the decision somebody made
 * when they framed the shot, and a wall of identical tiles reads as inventory
 * rather than as a memory. Each row here is filled with photos at their own
 * proportions and then scaled until it spans the width exactly — so a
 * panorama is long, a portrait is tall, and the eye has something to move
 * along.
 *
 * Months are the only division. A photo library has no folders worth showing
 * here; what it has is Augusts.
 */

const TARGET_ROW_HEIGHT = 204;
const GAP = 4;
// A shape to fall back on when a file never recorded its own. Videos often
// have not, and a tile that guesses 4:3 is less wrong than a tile that
// collapses.
const DEFAULT_RATIO = 4 / 3;

function ratioOf(item) {
  if (item.width && item.height) return item.width / item.height;
  return item.file_type === 'video' ? 16 / 9 : DEFAULT_RATIO;
}

/**
 * Fill rows to the width, then scale each row to fit it exactly.
 *
 * The classic justified layout: add photos to a row until they are taller
 * than wanted at full width, then shrink that row until it fits. The last row
 * is left at its natural height rather than stretched, because a final row of
 * three photos blown up to the width of twelve looks like a mistake.
 */
function layoutRows(items, containerWidth) {
  if (!containerWidth || containerWidth < 120) return [];
  const rows = [];
  let current = [];
  let ratioSum = 0;

  items.forEach((item) => {
    const ratio = ratioOf(item);
    current.push({ item, ratio });
    ratioSum += ratio;
    const gaps = GAP * (current.length - 1);
    const height = (containerWidth - gaps) / ratioSum;
    if (height <= TARGET_ROW_HEIGHT) {
      rows.push({ items: current, height });
      current = [];
      ratioSum = 0;
    }
  });

  if (current.length) {
    const gaps = GAP * (current.length - 1);
    const natural = (containerWidth - gaps) / ratioSum;
    rows.push({ items: current, height: Math.min(natural, TARGET_ROW_HEIGHT) });
  }
  return rows;
}

function monthLabel(iso) {
  if (!iso) return '날짜 없음';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '날짜 없음';
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

function monthKey(item) {
  const iso = item.taken_at || item.created_at;
  if (!iso) return 'unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function dayLabel(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${weekday})`;
}

/**
 * Which date is being shown, and whether it is the photograph's own.
 *
 * A file that carries no capture time is placed in the timeline by the day it
 * was uploaded, because a photograph with no date at all is worse than one
 * dated approximately. But the two are not the same fact, and showing an
 * upload date in the place of a capture date without saying so tells the
 * viewer something untrue about their own library.
 */
function dateOf(item) {
  const taken = !!item.taken_at;
  return {
    iso: item.taken_at || item.created_at,
    taken,
    note: taken ? null : '올린 날짜',
  };
}

function Tile({ item, width, height, onOpen }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const when = dateOf(item);

  return (
    <button
      type="button"
      className={`gal-tile ${loaded ? 'is-loaded' : ''}`}
      style={{ width, height }}
      onClick={() => onOpen(item)}
      title={when.taken ? item.name : `${item.name}\n촬영 정보가 없어 올린 날짜로 정렬됩니다`}
    >
      {item.has_thumbnail && !failed ? (
        <img
          src={getThumbnailUrl(item.id)}
          alt={item.name}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="gal-tile-blank"><ImageOff size={18} /></div>
      )}

      {item.file_type === 'video' && (
        <span className="gal-tile-play" aria-hidden="true"><Play size={13} /></span>
      )}

      {/* Shown on hover only, and only what the photograph does not say for
          itself: when, and whether it knows where it was. */}
      <span className="gal-tile-caption">
        <span>
          {dayLabel(when.iso)}
          {when.note && <em className="gal-tile-note">{when.note}</em>}
        </span>
        {item.latitude != null && <MapPin size={11} aria-label="위치 있음" />}
      </span>
    </button>
  );
}

export default function GalleryGrid({
  items,
  onOpen,
  onReachEnd,
  isLoadingMore,
  hasMore,
  emptyMessage = '아직 사진이 없습니다.',
}) {
  const containerRef = useRef(null);
  const sentinelRef = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Loads the next page before the last one is finished, so scrolling never
  // stops at a wall of empty space.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onReachEnd?.();
    }, { rootMargin: '900px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onReachEnd, hasMore, items.length]);

  const months = useMemo(() => {
    const groups = [];
    let currentKey = null;
    items.forEach((item) => {
      const key = monthKey(item);
      if (key !== currentKey) {
        groups.push({ key, label: monthLabel(item.taken_at || item.created_at), items: [] });
        currentKey = key;
      }
      groups[groups.length - 1].items.push(item);
    });
    return groups.map((group) => ({ ...group, rows: layoutRows(group.items, width) }));
  }, [items, width]);

  return (
    <div className="gal-grid" ref={containerRef}>
      {months.map((group) => (
        <section key={group.key} className="gal-month">
          <header className="gal-month-head">
            <h3>{group.label}</h3>
            <span>{group.items.length.toLocaleString()}</span>
          </header>
          {group.rows.map((row, rowIndex) => (
            <div className="gal-row" key={rowIndex} style={{ height: row.height, gap: GAP }}>
              {row.items.map(({ item, ratio }) => (
                <Tile
                  key={item.id}
                  item={item}
                  width={Math.max(40, row.height * ratio)}
                  height={row.height}
                  onOpen={onOpen}
                />
              ))}
            </div>
          ))}
        </section>
      ))}

      {!items.length && !isLoadingMore && (
        <div className="gal-empty">{emptyMessage}</div>
      )}

      <div ref={sentinelRef} className="gal-sentinel">
        {isLoadingMore && <span className="gal-loading">불러오는 중…</span>}
      </div>
    </div>
  );
}

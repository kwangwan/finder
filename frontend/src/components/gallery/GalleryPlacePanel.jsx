import React, { useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, Loader2 } from '../../utils/icons';
import { getThumbnailUrl } from '../../api';

/**
 * Everything photographed around one point, by the day it happened.
 *
 * A place on a map is rarely one visit. The same corner is a first trip, a
 * second one two years later, and an afternoon last month — and what makes
 * that readable is the days, not a wall of thumbnails. So the panel is a
 * timeline: a heading for each day, the photographs of that day under it, and
 * the next page pulled in as it is scrolled rather than stopping at whatever
 * the first request happened to hold.
 */

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function dayKey(item) {
  const iso = item.taken_at || item.created_at;
  if (!iso) return 'unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function dayLabel(item) {
  const iso = item.taken_at || item.created_at;
  if (!iso) return '날짜 없음';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '날짜 없음';
  const year = date.getFullYear() === new Date().getFullYear() ? '' : `${date.getFullYear()}년 `;
  return `${year}${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAYS[date.getDay()]})`;
}

export default function GalleryPlacePanel({ place, onBack, onOpen, onLoadMore }) {
  const sentinelRef = useRef(null);
  const hasMore = place.page < place.totalPages;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onLoadMore?.();
    }, { rootMargin: '300px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, place.items.length]);

  const days = useMemo(() => {
    const groups = [];
    let current = null;
    place.items.forEach((item) => {
      const key = dayKey(item);
      if (!current || current.key !== key) {
        current = { key, label: dayLabel(item), items: [] };
        groups.push(current);
      }
      current.items.push(item);
    });
    return groups;
  }, [place.items]);

  const span = (() => {
    if (!place.first) return null;
    const from = place.first.slice(0, 7).replace('-', '.');
    const to = place.last ? place.last.slice(0, 7).replace('-', '.') : from;
    return from === to ? from : `${from} – ${to}`;
  })();

  return (
    <>
      <div className="gal-map-side-head">
        <button type="button" className="gal-place-back" onClick={onBack}>
          <ChevronLeft size={13} /> 연도별로
        </button>
        <strong>이 장소의 사진</strong>
        <span>
          {place.loading && !place.items.length ? '찾는 중…' : `${place.total.toLocaleString()}개`}
          {span && !place.loading && ` · ${span}`}
        </span>
      </div>

      <div className="gal-place-scroll">
        {days.map((day) => (
          <section key={day.key} className="gal-place-day">
            <header>
              <h4>{day.label}</h4>
              <span>{day.items.length}</span>
            </header>
            <div className="gal-place-grid">
              {day.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="gal-place-tile"
                  onClick={() => onOpen(item)}
                  title={`${item.name}\n${(item.taken_at || item.created_at || '').slice(0, 10)}`}
                >
                  <img src={getThumbnailUrl(item.id)} alt={item.name} loading="lazy" />
                  {item.file_type === 'video' && <span className="gal-place-play" />}
                </button>
              ))}
            </div>
          </section>
        ))}

        {!place.loading && !place.items.length && (
          <p className="gal-place-empty">이 자리에는 사진이 없습니다.</p>
        )}

        <div ref={sentinelRef} className="gal-place-more">
          {(place.loading && place.items.length > 0) && (
            <span><Loader2 size={12} className="spin" /> 더 불러오는 중…</span>
          )}
          {!place.loading && hasMore && (
            <button type="button" onClick={() => onLoadMore?.()}>더 보기</button>
          )}
        </div>
      </div>
    </>
  );
}

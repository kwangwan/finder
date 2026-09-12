import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, X, LayoutGrid, Map as MapIcon, Image as ImageIcon, Film, Loader2, MapPin,
} from '../../utils/icons';
import {
  listGalleryItems, getGallerySummary, getGalleryMap, getFileDownloadUrl,
} from '../../api';
import GalleryGrid from './GalleryGrid';
import GalleryLightbox from './GalleryLightbox';
import GalleryMap from './GalleryMap';
import TimelineRail from './TimelineRail';

/**
 * 갤러리 — the whole library, by when and by where.
 *
 * Three things are kept apart on purpose: what is being looked for (the
 * filters), what the library looks like as a whole (the summary, which is one
 * grouped count and never changes as you scroll), and the page of photographs
 * currently in hand. Scrolling asks for the next page; changing a filter
 * starts again from the first. Nothing here ever holds the whole library in
 * memory, because on this library that would be eleven thousand records and
 * on the next one it will be a hundred thousand.
 *
 * The search box searches names and cameras — a phone model is how somebody
 * finds "the ones from the old camera" — and it waits for a pause in typing
 * before asking.
 */

const PAGE_SIZE = 80;

function useDebounced(value, delay = 320) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

function readUrlState() {
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      mode: params.get('gmode') === 'map' ? 'map' : 'grid',
      year: params.get('gyear') ? Number(params.get('gyear')) : null,
      month: params.get('gmonth') ? Number(params.get('gmonth')) : null,
      kind: ['image', 'video'].includes(params.get('gkind')) ? params.get('gkind') : 'all',
      q: params.get('gq') || '',
    };
  } catch (e) {
    return { mode: 'grid', year: null, month: null, kind: 'all', q: '' };
  }
}

export default function GalleryExplorer({ workspaceId, workspaceName, theme }) {
  const initial = useMemo(readUrlState, []);
  const [mode, setMode] = useState(initial.mode);
  const [kind, setKind] = useState(initial.kind);
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [queryText, setQueryText] = useState(initial.q);
  const q = useDebounced(queryText);

  const [summary, setSummary] = useState(null);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setLoading] = useState(true);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const [clusters, setClusters] = useState([]);
  const [mapView, setMapView] = useState(null);
  const [focusPoint, setFocusPoint] = useState(null);
  const [openIndex, setOpenIndex] = useState(-1);

  const requestId = useRef(0);
  const filters = useMemo(() => ({ q, kind, year, month }), [q, kind, year, month]);

  // The address bar carries the view, so a reload — or a link sent to
  // somebody — comes back to the same year in the same mode.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const set = (key, value) => {
        if (value === null || value === undefined || value === '' || value === 'all' || value === 'grid') {
          url.searchParams.delete(key);
        } else {
          url.searchParams.set(key, String(value));
        }
      };
      set('gmode', mode);
      set('gyear', year);
      set('gmonth', month);
      set('gkind', kind);
      set('gq', q);
      window.history.replaceState({}, '', url);
    } catch (e) { /* the view still works without the address bar agreeing */ }
  }, [mode, year, month, kind, q]);

  // The shape of the library, for the rail and the header. Deliberately not
  // narrowed by year or month: the rail has to keep showing the years you are
  // not currently in, or there is no way back to them.
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    getGallerySummary(workspaceId, { q, kind })
      .then((data) => { if (!cancelled) setSummary(data); })
      .catch(() => { if (!cancelled) setSummary(null); });
    return () => { cancelled = true; };
  }, [workspaceId, q, kind]);

  const loadPage = useCallback(async (nextPage, replace) => {
    if (!workspaceId) return;
    const id = ++requestId.current;
    if (replace) setLoading(true); else setLoadingMore(true);
    try {
      const data = await listGalleryItems(workspaceId, {
        ...filters, page: nextPage, page_size: PAGE_SIZE, sort: 'newest',
      });
      if (id !== requestId.current) return;   // a newer request already answered
      setItems((prev) => (replace ? data.items : [...prev, ...data.items]));
      setTotalCount(data.total_count);
      setTotalPages(data.total_pages);
      setPage(data.page);
      setError(null);
    } catch (e) {
      if (id === requestId.current) setError(e.message || '갤러리를 불러오지 못했습니다.');
    } finally {
      if (id === requestId.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [workspaceId, filters]);

  useEffect(() => { loadPage(1, true); }, [loadPage]);

  useEffect(() => {
    if (mode !== 'map' || !workspaceId || !mapView) return;
    let cancelled = false;
    getGalleryMap(workspaceId, { ...filters, zoom: mapView.zoom, bbox: mapView.bbox })
      .then((data) => { if (!cancelled) setClusters(data.clusters); })
      .catch(() => { if (!cancelled) setClusters([]); });
    return () => { cancelled = true; };
  }, [mode, workspaceId, filters, mapView]);

  const loadMore = useCallback(() => {
    if (isLoadingMore || isLoading) return;
    if (page >= totalPages) return;
    loadPage(page + 1, false);
  }, [isLoadingMore, isLoading, page, totalPages, loadPage]);

  const openAt = (item) => setOpenIndex(items.findIndex((i) => i.id === item.id));
  const step = (delta) => {
    setOpenIndex((current) => {
      const next = current + delta;
      if (next < 0 || next >= items.length) return current;
      // Opening the last few of a page pulls the next one in, so arrowing
      // through a year never stops at a page boundary.
      if (next > items.length - 6) loadMore();
      return next;
    });
  };

  const download = (item) => {
    const url = getFileDownloadUrl(item.id);
    const link = document.createElement('a');
    link.href = url;
    link.download = item.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const showOnMap = (item) => {
    if (item.latitude == null) return;
    setOpenIndex(-1);
    setMode('map');
    setFocusPoint({ latitude: item.latitude, longitude: item.longitude });
  };

  const periodLabel = year ? `${year}년${month ? ` ${month}월` : ''}` : '전체 기간';
  const placed = summary?.placed_count || 0;

  return (
    <main className="gal-root">
      <header className="gal-head">
        <div className="gal-head-title">
          <h1>갤러리</h1>
          <p>
            {workspaceName && <span className="gal-ws">{workspaceName}</span>}
            {summary ? (
              <>
                <span>사진 {summary.image_count.toLocaleString()}</span>
                <span>영상 {summary.video_count.toLocaleString()}</span>
                {placed > 0 && (
                  <span title="위치가 기록된 사진과 영상">
                    <MapPin size={11} /> {placed.toLocaleString()}
                  </span>
                )}
                {summary.first_taken_at && (
                  <span className="gal-span">
                    {summary.first_taken_at.slice(0, 7).replace('-', '.')} – {summary.last_taken_at.slice(0, 7).replace('-', '.')}
                  </span>
                )}
              </>
            ) : <span>&nbsp;</span>}
          </p>
        </div>

        <div className="gal-tools">
          <div className="gal-search">
            <Search size={14} />
            <input
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="이름이나 카메라로 찾기"
              aria-label="갤러리 검색"
            />
            {queryText && (
              <button type="button" onClick={() => setQueryText('')} title="지우기"><X size={13} /></button>
            )}
          </div>

          <div className="gal-seg" role="group" aria-label="종류">
            <button type="button" className={kind === 'all' ? 'is-on' : ''} onClick={() => setKind('all')}>전체</button>
            <button type="button" className={kind === 'image' ? 'is-on' : ''} onClick={() => setKind('image')} title="사진만">
              <ImageIcon size={13} />
            </button>
            <button type="button" className={kind === 'video' ? 'is-on' : ''} onClick={() => setKind('video')} title="영상만">
              <Film size={13} />
            </button>
          </div>

          <div className="gal-seg" role="group" aria-label="보기 방식">
            <button type="button" className={mode === 'grid' ? 'is-on' : ''} onClick={() => setMode('grid')} title="사진으로 보기">
              <LayoutGrid size={13} />
            </button>
            <button type="button" className={mode === 'map' ? 'is-on' : ''} onClick={() => setMode('map')} title="지도로 보기">
              <MapIcon size={13} />
            </button>
          </div>
        </div>
      </header>

      {(year || month || q || kind !== 'all') && (
        <div className="gal-filterbar">
          <span className="gal-chip-label">{periodLabel}</span>
          <span className="gal-chip-count">{totalCount.toLocaleString()}개</span>
          <button
            type="button"
            className="gal-chip-clear"
            onClick={() => { setYear(null); setMonth(null); setQueryText(''); setKind('all'); }}
          >
            조건 지우기
          </button>
        </div>
      )}

      <div className={`gal-body ${mode === 'map' ? 'is-map' : ''}`}>
        {mode === 'map' ? (
          <>
            <GalleryMap
              clusters={clusters}
              theme={theme}
              focus={focusPoint}
              onBoundsChange={setMapView}
              onOpenCluster={(cluster) => setFocusPoint({ latitude: cluster.latitude, longitude: cluster.longitude })}
            />
            <aside className="gal-map-side">
              <div className="gal-map-side-head">
                <strong>{periodLabel}</strong>
                <span>위치가 남아 있는 {placed.toLocaleString()}개</span>
              </div>
              <TimelineRail months={summary?.months} year={year} month={month}
                            onPick={({ year: y, month: m }) => { setYear(y); setMonth(m); }} />
            </aside>
          </>
        ) : (
          <>
            <div className="gal-scroll">
              {isLoading ? (
                <div className="gal-loading-full"><Loader2 size={18} className="spin" /> 불러오는 중…</div>
              ) : error ? (
                <div className="gal-empty">{error}</div>
              ) : (
                <GalleryGrid
                  items={items}
                  onOpen={openAt}
                  onReachEnd={loadMore}
                  isLoadingMore={isLoadingMore}
                  hasMore={page < totalPages}
                  emptyMessage={q || year ? '조건에 맞는 사진이 없습니다.' : '이 워크스페이스에는 아직 사진이 없습니다.'}
                />
              )}
            </div>
            <TimelineRail months={summary?.months} year={year} month={month}
                          onPick={({ year: y, month: m }) => { setYear(y); setMonth(m); }} />
          </>
        )}
      </div>

      {openIndex >= 0 && items[openIndex] && (
        <GalleryLightbox
          item={items[openIndex]}
          onClose={() => setOpenIndex(-1)}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          hasPrev={openIndex > 0}
          hasNext={openIndex < items.length - 1 || page < totalPages}
          onShowOnMap={showOnMap}
          onDownload={download}
        />
      )}
    </main>
  );
}

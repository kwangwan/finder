import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, X, LayoutGrid, Map as MapIcon, Image as ImageIcon, Film, Loader2, MapPin, Users,
  ArrowRight, ChevronLeft,
} from '../../utils/icons';
import {
  listGalleryItems, getGallerySummary, getGalleryMap, getFileDownloadUrl,
  getFaceMatches, getThumbnailUrl, getFaceIndexStatus, getGalleryPath, getGalleryPlace,
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

export default function GalleryExplorer({ workspaceId, workspaceName, theme, language }) {
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
  // A face search is its own thing, not a filter: it has no year, no month
  // and no map, and leaving it is going back to the library rather than
  // clearing a box. Held beside the ordinary state so that going back does
  // not have to reload what was already there.
  const [faceSearch, setFaceSearch] = useState(null);
  const [faceStatus, setFaceStatus] = useState(null);
  // The map's two extras: the trail of a chosen period, and whichever place
  // is currently being looked into.
  const [showPath, setShowPath] = useState(false);
  const [path, setPath] = useState(null);
  const [place, setPlace] = useState(null);

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

  // How far the face index has got. Asked once on arrival and then every
  // half minute only while it is still behind — a library that has been
  // looked at needs no ticker.
  useEffect(() => {
    if (!workspaceId) return undefined;
    let cancelled = false;
    let timer = null;
    const ask = async () => {
      try {
        const data = await getFaceIndexStatus(workspaceId);
        if (cancelled) return;
        setFaceStatus(data);
        if (data.pending > 0) timer = setTimeout(ask, 30000);
      } catch (e) {
        if (!cancelled) setFaceStatus(null);
      }
    };
    ask();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [workspaceId]);

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

  const searchByFace = useCallback(async (face, fromItem) => {
    setOpenIndex(-1);
    setFaceSearch({ face, fromItem, items: [], total: 0, page: 0, totalPages: 0, loading: true });
    try {
      const data = await getFaceMatches(workspaceId, face.id, 1, PAGE_SIZE);
      setFaceSearch({
        face, fromItem, items: data.items, total: data.total_count,
        page: data.page, totalPages: data.total_pages, loading: false,
      });
    } catch (e) {
      setFaceSearch({ face, fromItem, items: [], total: 0, page: 0, totalPages: 0,
                      loading: false, error: e.message });
    }
  }, [workspaceId]);

  const loadMoreFaces = useCallback(async () => {
    if (!faceSearch || faceSearch.loading || faceSearch.page >= faceSearch.totalPages) return;
    setFaceSearch((s) => ({ ...s, loading: true }));
    try {
      const data = await getFaceMatches(workspaceId, faceSearch.face.id, faceSearch.page + 1, PAGE_SIZE);
      setFaceSearch((s) => ({
        ...s, items: [...s.items, ...data.items], page: data.page,
        totalPages: data.total_pages, loading: false,
      }));
    } catch (e) {
      setFaceSearch((s) => ({ ...s, loading: false }));
    }
  }, [workspaceId, faceSearch]);

  useEffect(() => {
    if (mode !== 'map' || !showPath || !workspaceId) { setPath(null); return undefined; }
    let cancelled = false;
    getGalleryPath(workspaceId, filters)
      .then((data) => { if (!cancelled) setPath(data); })
      .catch(() => { if (!cancelled) setPath(null); });
    return () => { cancelled = true; };
  }, [mode, showPath, workspaceId, filters]);

  const openPlace = useCallback(async (latitude, longitude, radiusKm) => {
    setPlace({ latitude, longitude, loading: true, items: [], total: 0 });
    setFocusPoint({ latitude, longitude, zoom: radiusKm <= 0.5 ? 16 : 13 });
    try {
      const data = await getGalleryPlace(workspaceId, latitude, longitude, {
        ...filters, radius_km: radiusKm, page_size: 40,
      });
      setPlace({
        latitude, longitude, loading: false, items: data.items, total: data.total_count,
        first: data.first_taken_at, last: data.last_taken_at,
      });
    } catch (e) {
      setPlace({ latitude, longitude, loading: false, items: [], total: 0, error: e.message });
    }
  }, [workspaceId, filters]);

  const loadMore = useCallback(() => {
    if (isLoadingMore || isLoading) return;
    if (page >= totalPages) return;
    loadPage(page + 1, false);
  }, [isLoadingMore, isLoading, page, totalPages, loadPage]);

  const shown = faceSearch ? faceSearch.items : (place && mode === 'map' ? place.items : items);
  const openAt = (item) => setOpenIndex(shown.findIndex((i) => i.id === item.id));
  const step = (delta) => {
    setOpenIndex((current) => {
      const next = current + delta;
      if (next < 0 || next >= shown.length) return current;
      // Opening the last few of a page pulls the next one in, so arrowing
      // through a year never stops at a page boundary.
      if (next > shown.length - 6) (faceSearch ? loadMoreFaces : loadMore)();
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
          <div className="gal-head-line">
            <ImageIcon size={18} color="var(--accent-primary)" />
            <h1>갤러리</h1>
            {summary && <span className="gal-head-count">{summary.total_count.toLocaleString()}개</span>}
          </div>
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
                {faceStatus && faceStatus.pending > 0 && (
                  <span
                    className="gal-indexing"
                    title="사진 속 얼굴을 찾는 중입니다. 끝나면 사진 위의 얼굴을 눌러 같은 사람을 찾을 수 있습니다."
                  >
                    <Users size={11} /> 얼굴 찾는 중 {Math.floor((faceStatus.scanned / Math.max(1, faceStatus.total)) * 100)}%
                  </span>
                )}
                {summary.undated_count > 0 && (
                  <span
                    className="gal-undated"
                    title="촬영 정보가 없어 올린 날짜를 기준으로 놓인 항목입니다"
                  >
                    촬영일 없음 {summary.undated_count.toLocaleString()}
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
            <div className="gal-map-wrap">
              <GalleryMap
                clusters={clusters}
                theme={theme}
                language={language}
                path={showPath ? path?.points : null}
                focus={focusPoint}
                onBoundsChange={setMapView}
                onOpenCluster={(cluster) => openPlace(cluster.latitude, cluster.longitude,
                  Math.max(0.4, (mapView?.zoom || 6) >= 12 ? 0.5 : 12))}
                onPickPathPoint={(id) => {
                  const point = path?.points?.find((p) => p.id === id);
                  if (point) openPlace(point.latitude, point.longitude, 0.3);
                }}
              />
              <div className="gal-map-tools">
                {/* Not "이동 순서". That would claim these photographs were
                    taken by one person moving between the places, and a
                    workspace is filled by several people at once — two
                    consecutive photographs can be two people in two cities.
                    What the line actually joins is the order they were taken
                    in, which is all it says now. */}
                <button
                  type="button"
                  className={`gal-map-toggle ${showPath ? 'is-on' : ''}`}
                  onClick={() => setShowPath((v) => !v)}
                  title={'사진이 찍힌 시간 순서대로 이은 선입니다.\n'
                    + '여러 사람이 올린 사진이라면 한 사람의 이동 경로가 아닙니다.'}
                >
                  <ArrowRight size={13} />
                  <span>촬영 시간순</span>
                </button>
                {showPath && path && (
                  <span className="gal-map-note">
                    사진 {path.total_count.toLocaleString()}장
                    {path.sampled && ` 중 ${path.points.length.toLocaleString()}장`}
                    {' '}· 찍힌 시간 순서로 이음
                  </span>
                )}
              </div>
            </div>

            <aside className="gal-map-side">
              {place ? (
                <>
                  <div className="gal-map-side-head">
                    <button type="button" className="gal-place-back" onClick={() => setPlace(null)}>
                      <ChevronLeft size={13} /> 연도별로
                    </button>
                    <strong>이 장소의 사진</strong>
                    <span>
                      {place.loading ? '찾는 중…' : `${place.total.toLocaleString()}개`}
                      {place.first && !place.loading && (
                        ` · ${place.first.slice(0, 7).replace('-', '.')}`
                        + (place.last.slice(0, 7) !== place.first.slice(0, 7)
                          ? ` – ${place.last.slice(0, 7).replace('-', '.')}` : '')
                      )}
                    </span>
                  </div>
                  <div className="gal-place-grid">
                    {place.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="gal-place-tile"
                        onClick={() => openAt(item)}
                        title={`${item.name}\n${(item.taken_at || '').slice(0, 10)}`}
                      >
                        <img src={getThumbnailUrl(item.id)} alt={item.name} loading="lazy" />
                        {item.file_type === 'video' && <span className="gal-place-play" />}
                      </button>
                    ))}
                    {!place.loading && !place.items.length && (
                      <p className="gal-place-empty">이 자리에는 사진이 없습니다.</p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="gal-map-side-head">
                    <strong>{periodLabel}</strong>
                    <span>위치가 남아 있는 {placed.toLocaleString()}개</span>
                  </div>
                  <TimelineRail months={summary?.months} year={year} month={month}
                                onPick={({ year: y, month: m }) => { setYear(y); setMonth(m); setPlace(null); }} />
                </>
              )}
            </aside>
          </>
        ) : faceSearch ? (
          <div className="gal-scroll">
            <div className="gal-face-bar">
              <span className="gal-face-chip">
                <img
                  src={getThumbnailUrl(faceSearch.fromItem.id)}
                  alt=""
                  style={{
                    // The thumbnail, pushed around so the face fills the circle.
                    objectPosition: `${faceSearch.face.box[0] * 100 + faceSearch.face.box[2] * 50}% `
                      + `${faceSearch.face.box[1] * 100 + faceSearch.face.box[3] * 50}%`,
                    transform: `scale(${Math.min(4, Math.max(1.6, 0.55 / Math.max(0.06, faceSearch.face.box[2])))})`,
                  }}
                />
              </span>
              <div className="gal-face-said">
                <strong>이 사람이 나온 사진</strong>
                <span>
                  {faceSearch.loading && !faceSearch.items.length
                    ? '찾는 중…'
                    : `${faceSearch.total.toLocaleString()}개를 찾았습니다`}
                </span>
              </div>
              <button type="button" className="gal-face-back" onClick={() => setFaceSearch(null)}>
                <X size={13} /> 갤러리로 돌아가기
              </button>
            </div>
            <GalleryGrid
              items={faceSearch.items}
              onOpen={openAt}
              onReachEnd={loadMoreFaces}
              isLoadingMore={faceSearch.loading}
              hasMore={faceSearch.page < faceSearch.totalPages}
              emptyMessage={faceSearch.loading ? '찾는 중…' : '이 사람이 나온 다른 사진을 찾지 못했습니다.'}
            />
          </div>
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

      {openIndex >= 0 && shown[openIndex] && (
        <GalleryLightbox
          item={shown[openIndex]}
          onClose={() => setOpenIndex(-1)}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          hasPrev={openIndex > 0}
          hasNext={openIndex < shown.length - 1 || (faceSearch
            ? faceSearch.page < faceSearch.totalPages
            : page < totalPages)}
          onShowOnMap={showOnMap}
          onDownload={download}
          onSearchFace={searchByFace}
        />
      )}
    </main>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, X, LayoutGrid, Map as MapIcon, Image as ImageIcon, Film, Loader2, Users,
} from '../../utils/icons';
import {
  listGalleryItems, getGallerySummary, getGalleryMap, getFileDownloadUrl,
  getFaceMatches, getThumbnailUrl, getFaceIndexStatus, getGalleryPath, getGalleryPlace,
  listGalleryUploaders, listGalleryCameras, listGalleryFolders,
} from '../../api';
import GalleryGrid from './GalleryGrid';
import GalleryLightbox from './GalleryLightbox';
import GalleryMap from './GalleryMap';
import TimelineRail from './TimelineRail';
import GalleryPlacePanel from './GalleryPlacePanel';
import { Dropdown, Popover } from '../board/controls';
import { ChevronDown, SlidersHorizontal, Info } from '../../utils/icons';

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

/**
 * Several of a short, fixed list.
 *
 * A handful of values that never change — the three cameras a family owns —
 * is a list to choose from, not a word to type into a search box and hope. And
 * it has to be several: "the two phones, not the old one" is the actual
 * question, and picking one at a time cannot ask it.
 */
function MultiPick({ label, allLabel, options, values, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const chosen = options.filter((o) => values.includes(o.value));
  const summary = chosen.length === 0
    ? allLabel
    : chosen.length === 1 ? chosen[0].short : `${label} ${chosen.length}개`;

  const toggle = (value) => {
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  };

  return (
    <span className="ui-dd gal-pick" ref={ref}>
      <button
        type="button"
        className={`ui-dd-btn ${chosen.length ? 'is-set' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ui-dd-label">{summary}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} className="ui-dd-menu">
          <span role="listbox" aria-multiselectable="true">
            <button type="button" role="option" aria-selected={!chosen.length}
                    className={!chosen.length ? 'on' : ''} onClick={() => onChange([])}>
              <span>{allLabel}</span>
            </button>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={values.includes(o.value)}
                className={values.includes(o.value) ? 'on' : ''}
                onClick={() => toggle(o.value)}
              >
                <span>{o.label}</span>
              </button>
            ))}
          </span>
        </Popover>
      )}
    </span>
  );
}

/**
 * A filter with only one possible answer.
 *
 * Hidden, these made the panel a different shape in every workspace — one
 * library offered "올린 사람", the next offered "카메라", and neither said why.
 * Shown but not pressable, the panel is always the same panel, and the one
 * value says something worth knowing on its own: that everything here came
 * from one person, or off one camera.
 */
function LonePick({ label, hint }) {
  return (
    <span className="ui-dd">
      <button type="button" className="ui-dd-btn" disabled title={hint}>
        <span className="ui-dd-label">{label}</span>
      </button>
    </span>
  );
}

const PAGE_SIZE = 80;

/** Whether this is a screen with no room to lay things side by side. */
function useNarrow(query = '(max-width: 900px)') {
  const [narrow, setNarrow] = useState(() => {
    try { return window.matchMedia(query).matches; } catch (e) { return false; }
  });
  useEffect(() => {
    let media;
    try { media = window.matchMedia(query); } catch (e) { return undefined; }
    const listen = () => setNarrow(media.matches);
    listen();
    media.addEventListener('change', listen);
    return () => media.removeEventListener('change', listen);
  }, [query]);
  return narrow;
}

function useDebounced(value, delay = 320) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/**
 * One press of a dot goes one step closer, not all the way in.
 *
 * It used to fly straight to street level from wherever you were: a dot over
 * the Pacific became a junction with nothing around it, and the sense of
 * where that was in the world was gone. Stepping in keeps the ground you came
 * from on screen — a country becomes a province, a province becomes a city —
 * and pressing the same dot again goes another step. The steps are larger
 * when far out, where two zoom levels change little, and smaller when close,
 * where they change everything.
 */
function stepIn(currentZoom) {
  const from = Number.isFinite(currentZoom) ? currentZoom : 5;
  const step = from < 5 ? 3 : from < 9 ? 2.5 : from < 13 ? 2 : 1.5;
  return Math.min(from + step, 16.5);
}

/**
 * How much ground "this place" covers at a given zoom.
 *
 * Matched to what the map will be showing once it has moved, so the panel
 * beside it lists the photographs somebody can actually see rather than
 * everything within an arbitrary two kilometres.
 */
function placeRadiusKm(zoom) {
  if (zoom < 6) return 220;
  if (zoom < 8) return 80;
  if (zoom < 10) return 30;
  if (zoom < 12) return 10;
  if (zoom < 14) return 4;
  if (zoom < 16) return 1.5;
  return 0.6;
}

function readUrlState() {
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      mode: params.get('gmode') === 'map' ? 'map' : 'grid',
      year: params.get('gyear') ? Number(params.get('gyear')) : null,
      month: params.get('gmonth') ? Number(params.get('gmonth')) : null,
      kind: ['image', 'video'].includes(params.get('gkind')) ? params.get('gkind') : 'all',
      uploader: params.get('guploader') || '',
      camera: params.get('gcam') ? params.get('gcam').split('|').filter(Boolean) : [],
      folder: params.get('gfolder') || '',
      placed: ['yes', 'no'].includes(params.get('gplaced')) ? params.get('gplaced') : '',
      q: params.get('gq') || '',
    };
  } catch (e) {
    return { mode: 'grid', year: null, month: null, kind: 'all', uploader: '',
             camera: [], folder: '', placed: '', q: '' };
  }
}

export default function GalleryExplorer({
  workspaceId, workspaceName, theme, language, userId, onOpenInWindow, focusRequest,
}) {
  const initial = useMemo(readUrlState, []);
  const [mode, setMode] = useState(initial.mode);
  const [kind, setKind] = useState(initial.kind);
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [uploader, setUploader] = useState(initial.uploader);
  const [uploaders, setUploaders] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [folders, setFolders] = useState([]);
  const [folder, setFolder] = useState(initial.folder);
  const [camera, setCamera] = useState(initial.camera);
  const [hasPlace, setHasPlace] = useState(initial.placed);
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
  // Which photograph is open, by id — so it survives a reload, can be sent
  // to somebody, and can be closed by the back button.
  const [openId, setOpenId] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('gphoto') || null; }
    catch (e) { return null; }
  });
  // A face search is its own thing, not a filter: it has no year, no month
  // and no map, and leaving it is going back to the library rather than
  // clearing a box. Held beside the ordinary state so that going back does
  // not have to reload what was already there.
  const [faceSearch, setFaceSearch] = useState(null);
  // Newest first, like the rest of the gallery — the grid's month headings
  // assume it. "닮은 순" is still there for anyone who wants the surest first.
  const [faceSort, setFaceSort] = useState('newest');
  const [faceStatus, setFaceStatus] = useState(null);
  // The map's two extras: the trail of a chosen period, and whichever place
  // is currently being looked into.

  const [path, setPath] = useState(null);
  const [place, setPlace] = useState(null);

  const narrow = useNarrow();
  // On a narrow screen the counts and the filters each live behind a button:
  // one to ask what is here, one to narrow it.
  const [showFacts, setShowFacts] = useState(false);
  const [filterSheet, setFilterSheet] = useState(false);
  const [sheetTall, setSheetTall] = useState(false);
  const gripFrom = useRef(null);
  const factsRef = useRef(null);

  /**
   * A filter belongs to the library it was set on, and to the person who set it.
   *
   * Carrying them across workspaces is how the gallery came to say "7개" at the
   * top and show nothing underneath — an uploader and a camera from another
   * library match nothing here, and the header's counts were not narrowed by
   * all of them, so the two disagreed with no way to see why.
   *
   * Dropping them on every switch would have been the other wrong answer: come
   * back to a library you were half-way through reading and you are at the
   * beginning again. They are kept instead, one set per workspace per account,
   * and the one belonging to wherever you have just arrived is put back.
   */
  const filterScope = `gallery:filters:${userId || 'me'}:${workspaceId || 'none'}`;
  const scopeRef = useRef(filterScope);
  const firstWorkspaceRef = useRef(true);

  useEffect(() => {
    // Only ever writes under the workspace the current state actually belongs
    // to; on the render where the workspace changes, this is not yet it.
    if (!workspaceId || scopeRef.current !== filterScope) return;
    try {
      window.localStorage.setItem(filterScope, JSON.stringify({
        year, month, kind, uploader, camera, folder, hasPlace, q: queryText,
      }));
    } catch (e) { /* a browser that will not remember still works */ }
  }, [filterScope, workspaceId, year, month, kind, uploader, camera, folder, hasPlace, queryText]);

  useEffect(() => {
    // The first arrival keeps whatever the address bar asked for — a link
    // somebody sent has to open on what it names.
    if (firstWorkspaceRef.current) {
      firstWorkspaceRef.current = false;
      scopeRef.current = filterScope;
      return;
    }
    let saved = null;
    try { saved = JSON.parse(window.localStorage.getItem(filterScope) || 'null'); }
    catch (e) { saved = null; }
    scopeRef.current = filterScope;
    setYear(saved?.year ?? null);
    setMonth(saved?.month ?? null);
    setKind(saved?.kind ?? 'all');
    setUploader(saved?.uploader ?? '');
    setCamera(Array.isArray(saved?.camera) ? saved.camera : []);
    setFolder(saved?.folder ?? '');
    setHasPlace(saved?.hasPlace ?? '');
    setQueryText(saved?.q ?? '');
    setPlace(null);
    setFaceSearch(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Somewhere else asked for a place to be shown — a window's 상세 정보, say.
  useEffect(() => {
    if (!focusRequest) return;
    setMode('map');
    setPlace(null);
    setOpenId(null);
    setFocusPoint({ latitude: focusRequest.latitude, longitude: focusRequest.longitude });
  }, [focusRequest]);

  const requestId = useRef(0);
  const filters = useMemo(() => ({
    q, kind, year, month, uploader: uploader || null,
    camera: camera.length ? camera.join('|') : null,
    folder: folder || null,
    placed: hasPlace || null,
  }), [q, kind, year, month, uploader, camera, folder, hasPlace]);

  // The address bar carries the view, so a reload — or a link sent to
  // somebody — comes back to the same year in the same mode. Each change is
  // pushed rather than replaced, which is what makes the back button walk
  // back through them; the first write of a session replaces, so arriving at
  // the gallery does not leave a duplicate entry behind.
  const wroteUrlRef = useRef(false);
  const applyingHistoryRef = useRef(false);

  useEffect(() => {
    if (applyingHistoryRef.current) { applyingHistoryRef.current = false; return; }
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
      set('guploader', uploader);
      set('gcam', camera.join('|'));
      set('gfolder', folder);
      set('gplaced', hasPlace);
      set('gq', q);
      set('gphoto', openId);
      const first = !wroteUrlRef.current;
      // Marked before the early return: the first run of this effect happens
      // on arrival and usually writes nothing, and if that run did not count
      // as "the first", the viewer's first real choice would replace the
      // entry they arrived on — and the back button would jump straight out
      // of the app instead of returning to the library.
      wroteUrlRef.current = true;
      if (url.toString() === window.location.href) return;
      if (first) window.history.replaceState({}, '', url);
      else window.history.pushState({}, '', url);
    } catch (e) { /* the view still works without the address bar agreeing */ }
  }, [mode, year, month, kind, uploader, camera, folder, hasPlace, q, openId]);

  /**
   * Going back inside the gallery.
   *
   * The address already says which year, which mode and which photograph is
   * open, so stepping back is a matter of reading it — and of not writing it
   * again on the way, which would push a new entry for the place just left.
   */
  useEffect(() => {
    const onPopState = () => {
      try {
        const params = new URLSearchParams(window.location.search);
        applyingHistoryRef.current = true;
        setMode(params.get('gmode') === 'map' ? 'map' : 'grid');
        setYear(params.get('gyear') ? Number(params.get('gyear')) : null);
        setMonth(params.get('gmonth') ? Number(params.get('gmonth')) : null);
        setKind(['image', 'video'].includes(params.get('gkind')) ? params.get('gkind') : 'all');
        setUploader(params.get('guploader') || '');
        setQueryText(params.get('gq') || '');
        setOpenId(params.get('gphoto') || null);
        setFaceSearch(null);
      } catch (e) { /* an address we cannot read is left alone */ }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!workspaceId) return undefined;
    let cancelled = false;
    listGalleryUploaders(workspaceId)
      .then((data) => { if (!cancelled) setUploaders(data.items || []); })
      .catch(() => { if (!cancelled) setUploaders([]); });
    listGalleryCameras(workspaceId)
      .then((data) => { if (!cancelled) setCameras(data.items || []); })
      .catch(() => { if (!cancelled) setCameras([]); });
    listGalleryFolders(workspaceId)
      .then((data) => { if (!cancelled) setFolders(data.items || []); })
      .catch(() => { if (!cancelled) setFolders([]); });
    return () => { cancelled = true; };
  }, [workspaceId]);

  // The shape of the library, for the rail and the header. Deliberately not
  // narrowed by year or month: the rail has to keep showing the years you are
  // not currently in, or there is no way back to them.
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    getGallerySummary(workspaceId, {
      q, kind, uploader: uploader || null,
      camera: camera.length ? camera.join('|') : null,
      placed: hasPlace || null,
    })
      .then((data) => { if (!cancelled) setSummary(data); })
      .catch(() => { if (!cancelled) setSummary(null); });
    return () => { cancelled = true; };
  }, [workspaceId, q, kind, uploader, camera, hasPlace]);

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
      // A failed request is not the same as an empty map. Emptying it on any
      // error is how a single refused zoom level made every dot disappear;
      // keeping what was drawn leaves the view a moment stale at worst.
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mode, workspaceId, filters, mapView]);

  const searchByFace = useCallback(async (face, fromItem, how = faceSort) => {
    setOpenId(null);
    setFaceSearch({ face, fromItem, items: [], total: 0, page: 0, totalPages: 0, loading: true });
    try {
      const data = await getFaceMatches(workspaceId, face.id, 1, PAGE_SIZE, how, filters);
      setFaceSearch({
        face, fromItem, items: data.items, total: data.total_count,
        page: data.page, totalPages: data.total_pages, loading: false,
      });
    } catch (e) {
      setFaceSearch({ face, fromItem, items: [], total: 0, page: 0, totalPages: 0,
                      loading: false, error: e.message });
    }
  }, [workspaceId, faceSort, filters]);

  const loadMoreFaces = useCallback(async () => {
    if (!faceSearch || faceSearch.loading || faceSearch.page >= faceSearch.totalPages) return;
    setFaceSearch((s) => ({ ...s, loading: true }));
    try {
      const data = await getFaceMatches(workspaceId, faceSearch.face.id, faceSearch.page + 1, PAGE_SIZE, faceSort, filters);
      setFaceSearch((s) => ({
        ...s, items: [...s.items, ...data.items], page: data.page,
        totalPages: data.total_pages, loading: false,
      }));
    } catch (e) {
      setFaceSearch((s) => ({ ...s, loading: false }));
    }
  }, [workspaceId, faceSearch, faceSort, filters]);

  useEffect(() => {
    // Always, on the map. The line is how the map says "in this order" — a
    // switch for it made the order an extra somebody had to know to ask for,
    // and the map without it is just dots that happen to be near each other.
    if (mode !== 'map' || !workspaceId) { setPath(null); return undefined; }
    let cancelled = false;
    getGalleryPath(workspaceId, filters)
      .then((data) => { if (!cancelled) setPath(data); })
      .catch(() => { if (!cancelled) setPath(null); });
    return () => { cancelled = true; };
  }, [mode, workspaceId, filters]);

  const PLACE_PAGE = 60;

  /**
   * Open one dot on the map.
   *
   * `bounds` is the ground that dot actually covers, which the map endpoint
   * sends with it. Asking by that rather than by a radius around its centre
   * is the difference between "the photographs this dot is made of" and
   * "everything within a few kilometres" — a dot holding a single photograph
   * used to answer with a hundred from the dots beside it.
   */
  /**
   * Open what is at one point, in the panel beside the map.
   *
   * It does not move the map unless it is asked to, and that is the point.
   * Pressing a dot used to zoom a step in, which changed how every *other* dot
   * on the screen was grouped — so wanting to look at the one next door meant
   * finding it again in a regrouping that had just happened underneath the
   * cursor. Reading a dot and rearranging the map are two different wishes;
   * only the second one is worth moving the ground for, and it now has its own
   * button. Following an arrow still moves, because going somewhere is what it
   * was asked to do, and even then it keeps the height it was given.
   */
  const openPlace = useCallback(async (latitude, longitude, {
    zoom: atZoom, bounds, move = false, sampleId = null, stay = null,
  } = {}) => {
    const zoom = atZoom ?? 14;
    const radiusKm = placeRadiusKm(zoom);
    const area = bounds ? { bbox: bounds.join(',') } : { radius_km: radiusKm };
    // Arriving along the trail is asking about a stay, not a place. Home is one
    // place and a hundred visits; the dot that was clicked was one of them.
    if (stay) { area.date_from = stay.from; area.date_to = stay.to; }
    const base = { latitude, longitude, radiusKm, bounds: bounds || null, sampleId, stay };
    setPlace({ ...base, loading: true, items: [], total: 0, page: 0, totalPages: 0 });
    if (move) setFocusPoint({ latitude, longitude, zoom });
    try {
      const data = await getGalleryPlace(workspaceId, latitude, longitude, {
        ...filters, ...area, page: 1, page_size: PLACE_PAGE,
      });
      setPlace({
        ...base, loading: false, items: data.items,
        total: data.total_count, placeTotal: data.place_total_count ?? data.total_count,
        page: data.page, totalPages: data.total_pages,
        first: data.first_taken_at, last: data.last_taken_at,
      });
    } catch (e) {
      setPlace({ ...base, loading: false, items: [], total: 0, page: 0, totalPages: 0, error: e.message });
    }
  }, [workspaceId, filters]);

  /**
   * The rest of this place, a page at a time.
   *
   * A corner somebody has returned to for years holds more photographs than
   * any first request should carry, so the panel starts with a page and
   * grows as it is scrolled — the same bargain the main grid makes.
   */
  const loadMorePlace = useCallback(async () => {
    if (!place || place.loading || place.page >= place.totalPages) return;
    setPlace((current) => ({ ...current, loading: true }));
    try {
      const data = await getGalleryPlace(workspaceId, place.latitude, place.longitude, {
        ...filters,
        ...(place.bounds ? { bbox: place.bounds.join(',') } : { radius_km: place.radiusKm }),
        // The next page has to be a page of the same question.
        ...(place.stay ? { date_from: place.stay.from, date_to: place.stay.to } : {}),
        page: place.page + 1, page_size: PLACE_PAGE,
      });
      setPlace((current) => (current && current.latitude === place.latitude ? {
        ...current,
        items: [...current.items, ...data.items],
        page: data.page,
        totalPages: data.total_pages,
        loading: false,
      } : current));
    } catch (e) {
      setPlace((current) => (current ? { ...current, loading: false } : current));
    }
  }, [workspaceId, filters, place]);

  const loadMore = useCallback(() => {
    if (isLoadingMore || isLoading) return;
    if (page >= totalPages) return;
    loadPage(page + 1, false);
  }, [isLoadingMore, isLoading, page, totalPages, loadPage]);

  const shown = faceSearch ? faceSearch.items : (place && mode === 'map' ? place.items : items);
  const openIndex = openId ? shown.findIndex((i) => i.id === openId) : -1;
  const openAt = (item) => setOpenId(item.id);
  const step = (delta) => {
    const next = openIndex + delta;
    if (next < 0 || next >= shown.length) return;
    // Opening the last few of a page pulls the next one in, so arrowing
    // through a year never stops at a page boundary.
    if (next > shown.length - 6) (faceSearch ? loadMoreFaces : loadMore)();
    setOpenId(shown[next].id);
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
    setOpenId(null);
    setMode('map');
    setFocusPoint({ latitude: item.latitude, longitude: item.longitude });
  };

  const periodLabel = year ? `${year}년${month ? ` ${month}월` : ''}` : '전체 기간';
  const uploaderName = uploader ? uploaders.find((p) => p.id === uploader)?.name : null;
  const placed = summary?.placed_count || 0;

  /**
   * What is in here, and how much of it.
   *
   * Six facts laid across the top read as clutter on any screen, and on a
   * phone they read as most of the screen. They are worth having and they
   * are not worth being looked at every time, which is what (i) is for.
   */
  const facts = (
    <div className="gal-facts-list">
      {workspaceName && <span className="gal-ws">{workspaceName}</span>}
      {summary ? (
        <>
          <span>사진 {summary.image_count.toLocaleString()}</span>
          <span>영상 {summary.video_count.toLocaleString()}</span>
          {faceStatus && faceStatus.pending > 0 && (
            <span
              className="gal-indexing"
              title="사진 속 얼굴을 찾는 중입니다. 끝나면 사진 위의 얼굴을 눌러 같은 사람을 찾을 수 있습니다."
            >
              <Users size={11} /> 얼굴 찾는 중 {Math.floor((faceStatus.scanned / Math.max(1, faceStatus.total)) * 100)}%
            </span>
          )}
          {summary.first_taken_at && (
            <span className="gal-span">
              {summary.first_taken_at.slice(0, 7).replace('-', '.')} – {summary.last_taken_at.slice(0, 7).replace('-', '.')}
            </span>
          )}
        </>
      ) : <span>&nbsp;</span>}
    </div>
  );

  // Changing what is being looked for while this person's photographs are on
  // screen asks the same question again, narrowed. Before, the filters sat
  // there doing nothing, which reads as a filter that is broken.
  const askedFaceRef = useRef(null);
  useEffect(() => {
    if (!faceSearch?.face) { askedFaceRef.current = null; return; }
    const asked = `${faceSearch.face.id}:${JSON.stringify(filters)}:${faceSort}`;
    if (askedFaceRef.current === asked) return;
    if (askedFaceRef.current === null) { askedFaceRef.current = asked; return; }
    askedFaceRef.current = asked;
    searchByFace(faceSearch.face, faceSearch.fromItem, faceSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, faceSort, faceSearch?.face?.id]);

  const activeFilters = [q, kind !== 'all', uploader, camera.length, folder, hasPlace]
    .filter(Boolean).length;

  // Everything currently narrowing the library, in words — so an empty screen
  // can say what emptied it.
  const narrowings = [
    year ? `${year}년${month ? ` ${month}월` : ''}` : null,
    q ? `"${q}"` : null,
    kind === 'image' ? '사진만' : kind === 'video' ? '영상만' : null,
    uploader ? uploaders.find((p) => p.id === uploader)?.name : null,
    camera.length ? (camera.length === 1 ? camera[0] : `카메라 ${camera.length}대`) : null,
    folder ? folders.find((f) => f.id === folder)?.name : null,
    hasPlace === 'yes' ? '지도에 있는 것' : hasPlace === 'no' ? '위치 없는 것' : null,
  ].filter(Boolean);

  const clearFilters = () => {
    setYear(null); setMonth(null); setQueryText(''); setKind('all');
    setUploader(''); setCamera([]); setFolder(''); setHasPlace('');
  };

  const filterControls = (
    <>
            <div className="gal-search">
              <Search size={14} />
              <input
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder="파일 이름으로 찾기"
                aria-label="갤러리 검색"
              />
              {queryText && (
                <button type="button" onClick={() => setQueryText('')} title="지우기"><X size={13} /></button>
              )}
            </div>

            {/* Icons alone were a row in a toolbar, where a tooltip could explain
                them. In a dialog with room on every line they say what they are. */}
            <div className="gal-seg gal-kind" role="group" aria-label="종류">
              <button type="button" className={kind === 'all' ? 'is-on' : ''} onClick={() => setKind('all')}>
                전체
              </button>
              <button type="button" className={kind === 'image' ? 'is-on' : ''} onClick={() => setKind('image')}>
                <ImageIcon size={13} /> 사진
              </button>
              <button type="button" className={kind === 'video' ? 'is-on' : ''} onClick={() => setKind('video')}>
                <Film size={13} /> 영상
              </button>
            </div>

            {uploaders.length === 1 && (
              <LonePick
                label={`${uploaders[0].name} · ${uploaders[0].count.toLocaleString()}`}
                hint="이 워크스페이스에 사진을 올린 사람은 한 명입니다"
              />
            )}
            {uploaders.length > 1 && (
              <Dropdown
                value={uploader}
                label="올린 사람으로 거르기"
                options={[
                  { value: '', label: `올린 사람 전체` },
                  ...uploaders.map((person, index) => ({
                    value: person.id,
                    label: `${person.name}${index === 0 ? ' (나)' : ''} · ${person.count.toLocaleString()}`,
                  })),
                ]}
                onChange={(value) => { setUploader(value); setPlace(null); }}
              />
            )}

            {cameras.length <= 1 && (
              <LonePick
                label={cameras.length
                  ? `${cameras[0].name} · ${cameras[0].count.toLocaleString()}`
                  : '카메라 정보 없음'}
                hint={cameras.length
                  ? '이 워크스페이스의 사진은 모두 한 기기로 찍혔습니다'
                  : '이 워크스페이스의 사진에는 어떤 기기로 찍었는지가 남아 있지 않습니다'}
              />
            )}
            {cameras.length > 1 && (
              <MultiPick
                label="카메라"
                allLabel="카메라 전체"
                values={camera}
                options={cameras.map((c) => ({
                  value: c.name,
                  short: c.name,
                  label: `${c.name} · ${c.count.toLocaleString()}`,
                }))}
                onChange={(next) => { setCamera(next); setPlace(null); }}
              />
            )}

            {folders.length > 1 && (
              <Dropdown
                value={folder}
                label="폴더로 거르기"
                options={[
                  { value: '', label: '폴더 전체' },
                  ...folders.map((f) => ({
                    value: f.id,
                    label: `${f.name} · ${f.count.toLocaleString()}`,
                  })),
                ]}
                onChange={(value) => { setFolder(value); setPlace(null); }}
              />
            )}

            <Dropdown
              value={hasPlace}
              label="위치로 거르기"
              options={[
                { value: '', label: '위치 상관없이' },
                { value: 'yes', label: '지도에 있는 것' },
                { value: 'no', label: '위치 없는 것' },
              ]}
              onChange={(value) => { setHasPlace(value); setPlace(null); }}
            />

    </>
  );

  return (
    <main className="gal-root">
      <header className="gal-head">
        <div className="gal-head-title">
          <div className="gal-head-line">
            <ImageIcon size={18} color="var(--accent-primary)" />
            <h1>갤러리</h1>
            {summary && <span className="gal-head-count">{summary.total_count.toLocaleString()}개</span>}
            {summary && (
              <span className="gal-facts" ref={factsRef}>
                <button
                  type="button"
                  className={`gal-facts-open ${showFacts ? 'is-on' : ''}`}
                  aria-expanded={showFacts}
                  aria-label="이 갤러리에 무엇이 얼마나 있는지"
                  onClick={() => setShowFacts((v) => !v)}
                >
                  <Info size={14} />
                </button>
                {showFacts && (
                  <Popover anchorRef={factsRef} onClose={() => setShowFacts(false)} className="gal-facts-pop">
                    {facts}
                  </Popover>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Switching between the photographs and the map is what this page is
            for; narrowing which photographs is a thing you occasionally do to
            it. Lined up together they read as five equal buttons, and the one
            that matters disappears among them. So the views stand alone and
            everything else is behind one button that says how many are on —
            on a wide screen as much as a narrow one, because being lost in a
            row is not a problem only phones have. */}
        <div className="gal-tools">
          <button
            type="button"
            className={`gal-filter-open ${activeFilters ? "is-set" : ""}`}
            onClick={() => setFilterSheet(true)}
          >
            <SlidersHorizontal size={13} />
            <span className="gal-filter-word">필터</span>
            {activeFilters > 0 && <span className="gal-filter-n">{activeFilters}</span>}
          </button>
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

      {/* Everything that narrows the library, on a screen with no room for it
          in a row. Closing is the same as applying: the list behind it has
          already been changing as each one was chosen. */}
      {filterSheet && (
        <div className="gal-sheet-back" onClick={() => setFilterSheet(false)} role="presentation">
          <div className="gal-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="필터">
            <header>
              <strong>필터</strong>
              <button type="button" onClick={() => setFilterSheet(false)} aria-label="닫기">
                <X size={16} />
              </button>
            </header>
            <div className="gal-sheet-body">{filterControls}</div>
            <footer>
              <button type="button" className="gal-sheet-clear" onClick={clearFilters} disabled={!activeFilters}>
                모두 지우기
              </button>
              <button type="button" className="gal-sheet-done" onClick={() => setFilterSheet(false)}>
                {totalCount.toLocaleString()}개 보기
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* A face search answers a question that has no year, no map and no
          period, so it takes the screen whichever view asked it. It used to be
          tested after the map, which meant pressing "이 사람 찾기" on a
          photograph opened from the map ran the search and then drew the map
          over it — from the outside, a button that did nothing. Leaving the
          search puts the map back exactly as it was. */}
      <div className={`gal-body ${mode === 'map' && !faceSearch ? 'is-map' : ''}`}>
        {faceSearch ? (
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
              <div className="gal-seg gal-face-sort" role="group" aria-label="정렬">
                {[['newest', '최신순'], ['oldest', '오래된 순'], ['closest', '닮은 순']].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={faceSort === value ? 'is-on' : ''}
                    onClick={() => {
                      if (faceSort === value) return;
                      setFaceSort(value);
                      searchByFace(faceSearch.face, faceSearch.fromItem, value);
                    }}
                  >
                    {label}
                  </button>
                ))}
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
        ) : mode === 'map' ? (
          <>
            <div className="gal-map-wrap">
              <GalleryMap
                clusters={clusters}
                theme={theme}
                language={language}
                path={path?.points}
                focus={focusPoint}
                onBoundsChange={setMapView}
                selectedId={place?.sampleId || null}
                onOpenCluster={(cluster) => openPlace(cluster.latitude, cluster.longitude, {
                  zoom: mapView?.zoom, bounds: cluster.bounds, sampleId: cluster.sample_id,
                })}
                // Reading a dot and rearranging the map are two gestures, so
                // they are two gestures: one press reads, two goes closer.
                onZoomCluster={(cluster) => setFocusPoint({
                  latitude: cluster.latitude,
                  longitude: cluster.longitude,
                  zoom: stepIn(mapView?.zoom),
                })}
                onPickPathPoint={(stop) => openPlace(stop.latitude, stop.longitude, {
                  zoom: mapView?.zoom, bounds: stop.bounds, sampleId: stop.id, stay: stop.stay,
                })}
                // Following an arrow is going where it points, at the height
                // you are already looking from — not diving into it.
                onFollowLeg={(stop) => openPlace(stop.latitude, stop.longitude, {
                  zoom: mapView?.zoom || 13, bounds: stop.bounds, sampleId: stop.id,
                  stay: stop.stay, move: true,
                })}
              />
            </div>

            <aside className={`gal-map-side ${narrow && sheetTall ? 'is-tall' : ''}`}>
              {/* On a phone this is a sheet over the map, and a sheet that is
                  one size is the wrong size twice: too short to look through
                  photographs, too tall to see where they were taken. The grip
                  moves it between the two — pulled or tapped, because a grip
                  that only answers to a drag looks like decoration. */}
              {narrow && (
                <button
                  type="button"
                  className="gal-sheet-grip"
                  aria-label={sheetTall ? '지도 보기' : '사진 크게 보기'}
                  aria-expanded={sheetTall}
                  onClick={() => setSheetTall((v) => !v)}
                  onTouchStart={(e) => { gripFrom.current = e.touches[0]?.clientY ?? null; }}
                  onTouchEnd={(e) => {
                    const from = gripFrom.current;
                    const to = e.changedTouches[0]?.clientY;
                    gripFrom.current = null;
                    if (from == null || to == null || Math.abs(to - from) < 24) return;
                    e.preventDefault();          // a drag is not also a tap
                    setSheetTall(to < from);
                  }}
                />
              )}
              {place ? (
                <GalleryPlacePanel
                  place={place}
                  onBack={() => setPlace(null)}
                  onOpen={openAt}
                  onLoadMore={loadMorePlace}
                  // The same ground, without the days — the place rather than
                  // the visit.
                  onShowWholePlace={() => openPlace(place.latitude, place.longitude, {
                    zoom: mapView?.zoom, bounds: place.bounds, sampleId: place.sampleId,
                  })}
                />
              ) : (
                <>
                  <div className="gal-map-side-head">
                    <strong>{periodLabel}{uploaderName ? ` · ${uploaderName}` : ''}</strong>
                    <span>위치가 남아 있는 {placed.toLocaleString()}개</span>
                  </div>
                  <TimelineRail months={summary?.months} year={year} month={month}
                                onPick={({ year: y, month: m }) => { setYear(y); setMonth(m); setPlace(null); }} />
                </>
              )}
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
                  // Empty because of what was asked, or empty because there is
                  // nothing — those are different sentences, and the first one
                  // has to say which narrowing is doing it.
                  emptyMessage={narrowings.length
                    ? `${narrowings.join(' · ')} 조건에 맞는 사진이 없습니다.`
                    : '이 워크스페이스에는 아직 사진이 없습니다.'}
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
          onClose={() => setOpenId(null)}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          hasPrev={openIndex > 0}
          hasNext={openIndex < shown.length - 1 || (faceSearch
            ? faceSearch.page < faceSearch.totalPages
            : page < totalPages)}
          onShowOnMap={showOnMap}
          onDownload={download}
          onSearchFace={searchByFace}
          onOpenInWindow={onOpenInWindow && ((item) => { setOpenId(null); onOpenInWindow(item); })}
        />
      )}
    </main>
  );
}

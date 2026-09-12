import React, { useCallback, useEffect, useRef, useState } from 'react';
// Named imports: this build of maplibre-gl has no default export.
import { Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl';
// The worker, built as a worker rather than copied as a file.
//
// Two things were wrong before. Maplibre finds its worker by looking for a
// fixed name *beside its own module*, which after bundling means /assets/,
// where nothing of that name exists — so it 404s, no worker starts, not a
// single tile is requested, and the map is a black rectangle that reports no
// error at all. Handing it a URL fixed that. But `?url` only copies the one
// file, and that file's first line imports `./maplibre-gl-shared.mjs` beside
// it — which was never emitted either, so the worker died the moment it
// loaded and the map stayed exactly as black.
//
// `?worker&url` builds the worker with its imports folded in, so what is
// served is a worker that can actually run alone.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(maplibreWorkerUrl);
import { getThumbnailUrl } from '../../api';

/**
 * Where the photographs were taken, and — when a period is chosen — the order
 * they were taken in.
 *
 * The server sends squares of the world with a count and one photo from each,
 * never the photos themselves: eleven thousand pins are not a map, they are a
 * smear. A dot therefore means "this many, around here", and it wears one of
 * its own photographs so a place is recognisable before it is read.
 *
 * The base map is vector rather than raster for one reason that matters here:
 * the labels are data, so they can be drawn in the reader's own language.
 * Raster tiles arrive with the names already painted on in whatever the local
 * language happens to be, which on a map of six years of travelling means a
 * different alphabet every few hundred kilometres.
 */

// OpenFreeMap: OpenStreetMap data, served as vector tiles, no key and no
// account. The two styles are chosen to sit behind photographs rather than
// compete with them.
const STYLE_URL = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/positron',
};

const LANGUAGE_FIELD = {
  ko: 'name:ko', en: 'name:en', ja: 'name:ja', zh: 'name:zh',
};

/**
 * The colours of a journey: the first photograph's green, through the blue the
 * rest of the map already uses, to the last one's orange. The same two ends as
 * the start and finish dots, so the line and the dots are saying one thing.
 */
const PATH_RAMP = ['#7ee787', '#8ab4ff', '#ffa657'];
const ARROW_STEPS = 7;

function mixHex(from, to, ratio) {
  const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [ar, ag, ab] = parse(from);
  const [br, bg, bb] = parse(to);
  const channel = (a, b) => Math.round(a + (b - a) * ratio).toString(16).padStart(2, '0');
  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`;
}

function rampColor(t) {
  const at = Math.min(1, Math.max(0, t));
  return at <= 0.5
    ? mixHex(PATH_RAMP[0], PATH_RAMP[1], at * 2)
    : mixHex(PATH_RAMP[1], PATH_RAMP[2], (at - 0.5) * 2);
}

/**
 * One arrowhead, drawn pointing right — which is the direction a symbol placed
 * on a line is turned to face. Dark edge first, colour over it, so the same
 * arrow holds up on a pale basemap and a dark one.
 */
function arrowImage(color) {
  const size = 26;
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = size * scale;
  canvas.height = size * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const chevron = (width, stroke) => {
    ctx.beginPath();
    ctx.moveTo(9, 7.5);
    ctx.lineTo(17, 13);
    ctx.lineTo(9, 18.5);
    ctx.lineWidth = width;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  };
  chevron(6, 'rgba(0,0,0,0.5)');
  chevron(2.8, color);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function ensureArrowImages(map) {
  for (let i = 0; i < ARROW_STEPS; i += 1) {
    const id = `gal-arrow-${i}`;
    // A change of theme throws the style away and the images with it, so this
    // asks every time and adds only what is missing.
    if (!map.hasImage(id)) {
      map.addImage(id, arrowImage(rampColor(i / (ARROW_STEPS - 1))), { pixelRatio: 2 });
    }
  }
}

// How far a step bows away from the straight line between its two
// photographs, as a fraction of that distance, and how finely the bow is
// drawn.
const ARC_BOW = 0.075;
const ARC_STEPS = 16;

/**
 * The line for one step, bowed to the left of the way it is going.
 *
 * Straight lines cannot say a round trip. Go from a hotel to a temple and come
 * back, and on a map zoomed out far enough the two steps lie exactly on top of
 * one another — one arrow over another arrow pointing the opposite way, which
 * reads as neither. Bowing every step consistently to its left separates them
 * on its own: the way out and the way back bow apart, and what was an
 * unreadable overlap becomes a narrow loop with an arrow on each side.
 *
 * The bow is a fraction of the step's own length, so a walk between two
 * streets stays as straight as it looks, and only a real distance curves.
 */
function bowedLeg(from, to) {
  // Longitude is worth less than latitude away from the equator; without this
  // the bow leans and a north-south step curves more than an east-west one.
  const cos = Math.max(0.2, Math.cos(((from[1] + to[1]) / 2) * (Math.PI / 180)));
  const dx = (to[0] - from[0]) * cos;
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (!length) return null;   // two photographs in one spot: a step with no direction
  const reach = 2 * ARC_BOW * length;   // the apex lands at half the control point
  const cx = (from[0] + to[0]) / 2 + ((-dy / length) * reach) / cos;
  const cy = (from[1] + to[1]) / 2 + (dx / length) * reach;
  const coordinates = [];
  for (let i = 0; i <= ARC_STEPS; i += 1) {
    const t = i / ARC_STEPS;
    const inv = 1 - t;
    coordinates.push([
      inv * inv * from[0] + 2 * inv * t * cx + t * t * to[0],
      inv * inv * from[1] + 2 * inv * t * cy + t * t * to[1],
    ]);
  }
  return coordinates;
}

function clusterElement(cluster, isLarge, onClick) {
  const count = cluster.count;
  const size = count > 500 ? 74 : count > 100 ? 62 : count > 20 ? 54 : 44;
  const label = count > 999 ? `${Math.round(count / 1000)}k` : count;
  const element = document.createElement('div');
  element.className = 'gal-cluster';
  element.style.width = `${size}px`;
  element.style.height = `${size}px`;
  element.innerHTML = `
    <div class="gal-cluster-inner ${isLarge ? 'is-large' : ''}" style="width:${size}px;height:${size}px">
      ${cluster.sample_id ? `<img src="${getThumbnailUrl(cluster.sample_id)}" alt="" loading="lazy" />` : ''}
      <span class="gal-cluster-count">${label}</span>
    </div>`;
  element.addEventListener('click', (e) => { e.stopPropagation(); onClick(cluster); });
  return element;
}

export default function GalleryMap({
  clusters,
  theme,
  language,
  path,
  focus,
  onBoundsChange,
  onOpenCluster,
  onPickPathPoint,
}) {
  const holderRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const styleRef = useRef(theme === 'light' ? 'light' : 'dark');
  const [ready, setReady] = useState(false);
  const [styleEpoch, setStyleEpoch] = useState(0);

  const report = useCallback(() => {
    const map = mapRef.current;
    if (!map || !onBoundsChange) return;
    const b = map.getBounds();
    onBoundsChange({
      zoom: Math.round(map.getZoom()),
      bbox: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]
        .map((v) => v.toFixed(5)).join(','),
    });
  }, [onBoundsChange]);

  useEffect(() => {
    if (mapRef.current || !holderRef.current) return undefined;
    const map = new MapLibreMap({
      container: holderRef.current,
      style: STYLE_URL[theme === 'light' ? 'light' : 'dark'],
      center: [127.9, 36.5],
      zoom: 5,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    mapRef.current = map;

    // Ready means "the style is up", which is what everything below needs
    // before it can add a layer or ask for one. `load` is not reliable for
    // that on its own: it waits for the first render too, and a map built
    // into a box that has not been laid out yet can sit there loaded and
    // never announce it — which left the basemap stuck on whichever theme it
    // started in, because the effect that swaps it was still waiting.
    const markReady = () => setReady(true);
    map.on('styledata', markReady);
    map.on('load', () => { markReady(); report(); });
    map.on('moveend', report);
    map.on('error', (e) => {
      // A basemap that will not load is worth one line in the console rather
      // than a silent black rectangle — the photographs still have their
      // coordinates, and the markers still draw.
      console.warn('[Gallery map]', e?.error?.message || e);
    });

    // The panel beside the map and the app's own sidebar both change this
    // container's width without the window ever resizing, and a map that is
    // not told simply leaves the new space blank.
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(holderRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // Built once. Re-creating it on a filter change would throw the viewer
    // back to Korea mid-journey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Place names in the reader's own language. The tiles carry every language
  // OpenStreetMap has for a place, so this is a matter of asking for the right
  // field and falling back when a village has no name in it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const field = LANGUAGE_FIELD[language] || LANGUAGE_FIELD.en;
    const expression = ['coalesce', ['get', field], ['get', 'name:latin'], ['get', 'name']];
    map.getStyle().layers.forEach((layer) => {
      if (layer.layout && 'text-field' in layer.layout) {
        try {
          map.setLayoutProperty(layer.id, 'text-field', expression);
        } catch (e) { /* a layer that will not take it keeps what it had */ }
      }
    });
  }, [language, ready, styleEpoch]);

  // A change of theme means a different basemap. Only a *change*: calling
  // setStyle during the first load throws away the style the constructor is
  // still fetching, and the map ends up with no sources at all — no tiles are
  // ever requested and the canvas stays black.
  useEffect(() => {
    const map = mapRef.current;
    const wanted = theme === 'light' ? 'light' : 'dark';
    if (!map || !ready || styleRef.current === wanted) return;
    styleRef.current = wanted;
    map.setStyle(STYLE_URL[wanted]);
    // Everything this component added — the trail, the stops — belongs to the
    // old style and is gone with it, so the effects that own them are asked
    // to run again.
    map.once('styledata', () => setStyleEpoch((n) => n + 1));
  }, [theme, ready]);

  // The clusters.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    const biggest = clusters.reduce((max, c) => Math.max(max, c.count), 0);
    clusters.forEach((cluster) => {
      const element = clusterElement(
        cluster,
        cluster.count >= biggest * 0.6 && biggest > 4,
        (c) => onOpenCluster?.(c),
      );
      const marker = new Marker({ element, anchor: 'center' })
        .setLngLat([cluster.longitude, cluster.latitude])
        .addTo(map);
      markersRef.current.push(marker);
    });
  }, [clusters, onOpenCluster]);

  /**
   * The photographs of this period, joined in the order they were taken.
   *
   * Not a route, and not one person's movement — a workspace is filled by
   * several people, so two consecutive photographs can be two of them in two
   * countries. All this line claims is the sequence, which is a fact about the
   * photographs rather than a guess about anybody.
   *
   * That sequence now has a direction you can see. A bare line between dots
   * only says "these two belong together"; an arrowhead on each step says
   * which one came first, which is the thing the line was drawn for. The
   * colour carries the same reading at a glance for anyone not counting
   * arrowheads: the journey begins in the green of the first dot and ends in
   * the orange of the last.
   *
   * Drawn faintly, with the stops on top, so what reads first is still where
   * the pictures are.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    ensureArrowImages(map);

    const points = (path || []).filter((p) => p.latitude != null);
    const legs = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const coordinates = bowedLeg(
        [points[i].longitude, points[i].latitude],
        [points[i + 1].longitude, points[i + 1].latitude],
      );
      if (!coordinates) continue;
      const t = points.length > 2 ? i / (points.length - 2) : 0;
      legs.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: { color: rampColor(t), arrow: `gal-arrow-${Math.round(t * (ARROW_STEPS - 1))}` },
      });
    }
    const line = { type: 'FeatureCollection', features: legs };
    const stops = {
      type: 'FeatureCollection',
      features: points.map((p, index) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
        properties: { id: p.id, order: index, first: index === 0, last: index === points.length - 1 },
      })),
    };

    const setData = (id, data) => {
      const source = map.getSource(id);
      if (source) source.setData(data);
      else map.addSource(id, { type: 'geojson', data });
    };
    setData('gal-path', line);
    setData('gal-stops', stops);

    if (!map.getLayer('gal-path-line')) {
      map.addLayer({
        id: 'gal-path-line',
        type: 'line',
        source: 'gal-path',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['to-color', ['get', 'color']],
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.1, 10, 2.2, 16, 3],
          'line-opacity': 0.5,
        },
      });
    }
    if (!map.getLayer('gal-path-arrow')) {
      map.addLayer({
        id: 'gal-path-arrow',
        type: 'symbol',
        source: 'gal-path',
        layout: {
          // One arrow per step, at the top of its bow. Spacing along the line
          // would put none at all on a short step and a row of them on a long
          // one; this way every step says its direction exactly once.
          'symbol-placement': 'line-center',
          'icon-image': ['get', 'arrow'],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 10, 0.68, 16, 0.85],
          'icon-rotation-alignment': 'map',
          // An arrow turned over to stay upright is an arrow pointing the
          // wrong way. It must be free to face west.
          'icon-keep-upright': false,
          // Where a year's worth of steps crowds into one town, the map drops
          // the arrows that would land on each other rather than drawing a
          // blot; zooming in gives them back.
          'icon-allow-overlap': false,
          'icon-padding': 2,
        },
        paint: { 'icon-opacity': 0.95 },
      });
    }
    if (!map.getLayer('gal-stops-dot')) {
      map.addLayer({
        id: 'gal-stops-dot',
        type: 'circle',
        source: 'gal-stops',
        paint: {
          'circle-radius': ['case', ['any', ['get', 'first'], ['get', 'last']], 5.5, 3.2],
          'circle-color': ['case', ['get', 'first'], '#7ee787', ['get', 'last'], '#ffa657', '#8ab4ff'],
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(0,0,0,0.55)',
          'circle-opacity': 0.95,
        },
      });
      map.on('click', 'gal-stops-dot', (e) => {
        const feature = e.features?.[0];
        if (feature) onPickPathPoint?.(feature.properties.id);
      });
      map.on('mouseenter', 'gal-stops-dot', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'gal-stops-dot', () => { map.getCanvas().style.cursor = ''; });
    }
  }, [path, ready, styleEpoch, onPickPathPoint]);

  // Asked to show one particular place.
  useEffect(() => {
    if (!focus || !mapRef.current) return;
    // The caller has already decided how far in this press should go (see
    // stepIn in GalleryExplorer); this only refuses to zoom *out*, so that
    // pressing a dot never takes ground away.
    mapRef.current.flyTo({
      center: [focus.longitude, focus.latitude],
      zoom: Math.max(mapRef.current.getZoom(), focus.zoom || 13),
      duration: 1100,
      essential: true,
    });
  }, [focus]);

  return <div className="gal-map" ref={holderRef} />;
}

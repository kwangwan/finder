import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getThumbnailUrl } from '../../api';

/**
 * Where the photographs were taken.
 *
 * The server sends squares of the world with a count and one photo from each,
 * never the photos themselves — eleven thousand pins are not a map, they are
 * a smear — and it re-sends them whenever the view changes, because how
 * coarse a square should be depends entirely on how far away you are
 * standing. A dot therefore means "this many, around here", and it wears one
 * of its own photographs so that a place on the map is recognisable before it
 * is read.
 *
 * The tiles are deliberately quiet ones. A full-colour road map competes with
 * the photographs for attention and wins, which is the wrong way round.
 */

// OpenStreetMap's own tiles: no key, no account, no watermark. (CARTO's dark
// basemap wanted an API key and stamped "API KEY REQUIRED" across every tile.)
// They are bright and colourful as drawn, which would shout over the
// photographs — so the dark theme inverts and cools them in CSS instead of
// fetching a second set of tiles. See .gal-map[data-tint="dark"] in index.css.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '© OpenStreetMap';

function clusterIcon(cluster, isLarge) {
  const count = cluster.count;
  const size = count > 500 ? 78 : count > 100 ? 66 : count > 20 ? 56 : 46;
  const label = count > 999 ? `${Math.round(count / 1000)}k` : count;
  const thumb = cluster.sample_id ? getThumbnailUrl(cluster.sample_id) : null;
  return L.divIcon({
    className: 'gal-cluster',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `
      <div class="gal-cluster-inner ${isLarge ? 'is-large' : ''}" style="width:${size}px;height:${size}px">
        ${thumb ? `<img src="${thumb}" alt="" loading="lazy" />` : ''}
        <span class="gal-cluster-count">${label}</span>
      </div>`,
  });
}

export default function GalleryMap({ clusters, theme, onBoundsChange, onOpenCluster, focus }) {
  const holderRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const tileRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (mapRef.current || !holderRef.current) return undefined;
    const map = L.map(holderRef.current, {
      zoomControl: false,
      attributionControl: true,
      worldCopyJump: true,
      minZoom: 2,
    }).setView([36.5, 127.9], 6);

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setReady(true);

    const report = () => {
      const b = map.getBounds();
      onBoundsChange?.({
        zoom: map.getZoom(),
        bbox: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]
          .map((v) => v.toFixed(5)).join(','),
      });
    };
    map.on('moveend zoomend', report);
    report();

    return () => {
      map.off('moveend zoomend', report);
      map.remove();
      mapRef.current = null;
    };
    // Set up once: the map keeps its own position, and re-creating it would
    // throw the viewer back to Korea every time a filter changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    if (tileRef.current) return;
    tileRef.current = L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(mapRef.current);
    tileRef.current.bringToBack();
  }, [ready]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    const biggest = clusters.reduce((max, c) => Math.max(max, c.count), 0);
    clusters.forEach((cluster) => {
      const marker = L.marker([cluster.latitude, cluster.longitude], {
        icon: clusterIcon(cluster, cluster.count >= biggest * 0.6 && biggest > 4),
        riseOnHover: true,
      });
      marker.on('click', () => onOpenCluster?.(cluster));
      marker.addTo(layer);
    });
  }, [clusters, onOpenCluster]);

  // Asked to show one particular place — from a photo's own coordinates.
  useEffect(() => {
    if (!focus || !mapRef.current) return;
    mapRef.current.flyTo([focus.latitude, focus.longitude], Math.max(mapRef.current.getZoom(), 13), {
      duration: 0.8,
    });
  }, [focus]);

  return <div className="gal-map" data-tint={theme === 'light' ? 'light' : 'dark'} ref={holderRef} />;
}

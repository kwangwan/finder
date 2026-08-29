import { useCallback, useEffect, useRef, useState } from 'react';

// How far the pointer must travel before a press becomes a selection drag.
// Without it every click on empty space would start a zero-size marquee, and a
// click that lands a pixel off would read as a drag rather than a click.
const DRAG_THRESHOLD_PX = 5;

// Edge band and speed for auto-scrolling while dragging past the visible area,
// so a selection can extend beyond what currently fits on screen.
const AUTOSCROLL_EDGE_PX = 48;
const AUTOSCROLL_MAX_SPEED_PX = 18;

function findScrollParent(node) {
  let el = node?.parentElement;
  while (el && el !== document.body) {
    const { overflowY } = window.getComputedStyle(el);
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

function intersects(a, b) {
  return !(b.left > a.right || b.right < a.left || b.top > a.bottom || b.bottom < a.top);
}

/**
 * Windows-Explorer-style rubber-band selection.
 *
 * Items opt in by carrying `data-select-id` and `data-select-kind`
 * ("file" | "folder"); the hook reads the DOM at drag time rather than being
 * handed a list, so it stays correct as the grid paginates, filters or
 * re-sorts without anything having to keep a parallel list of rectangles in
 * sync with what is actually rendered.
 *
 * onChange receives the ids the band currently covers. Holding ctrl/cmd/shift
 * adds to whatever was selected when the drag began instead of replacing it.
 * Desktop only — a touch drag is a scroll, not a selection.
 */
export function useMarqueeSelection({ containerRef, onChange, onClearSelection, enabled = true }) {
  const [rect, setRect] = useState(null);
  const stateRef = useRef(null);
  // Kept in refs so the move/up listeners, which are bound once per drag, never
  // close over a stale version of a caller's handler.
  const onChangeRef = useRef(onChange);
  const onClearRef = useRef(onClearSelection);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onClearRef.current = onClearSelection; }, [onClearSelection]);

  const applySelection = useCallback((band) => {
    const container = containerRef.current;
    if (!container) return;
    const files = [];
    const folders = [];
    container.querySelectorAll('[data-select-id]').forEach((el) => {
      if (!intersects(band, el.getBoundingClientRect())) return;
      (el.dataset.selectKind === 'folder' ? folders : files).push(el.dataset.selectId);
    });
    onChangeRef.current?.(files, folders, stateRef.current?.additive === true);
  }, [containerRef]);

  const handleMouseDown = useCallback((e) => {
    if (!enabled || e.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;
    // Only empty space starts a band. Pressing on a card must stay available
    // for click-to-open and for HTML5 drag-and-drop, which a marquee would
    // otherwise swallow.
    if (e.target.closest('[data-select-id], button, a, input, select, textarea, [role="button"]')) return;

    stateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      additive: e.ctrlKey || e.metaKey || e.shiftKey,
      moved: false,
      scroller: findScrollParent(container),
      pointerY: e.clientY,
    };

    const bandFrom = (x, y) => ({
      left: Math.min(stateRef.current.startX, x),
      right: Math.max(stateRef.current.startX, x),
      top: Math.min(stateRef.current.startY, y),
      bottom: Math.max(stateRef.current.startY, y),
    });

    let raf = null;
    const autoScroll = () => {
      const st = stateRef.current;
      if (!st) return;
      const scroller = st.scroller;
      const bounds = scroller === document.scrollingElement || scroller === document.documentElement
        ? { top: 0, bottom: window.innerHeight }
        : scroller.getBoundingClientRect();

      let delta = 0;
      if (st.pointerY < bounds.top + AUTOSCROLL_EDGE_PX) {
        delta = -Math.min(AUTOSCROLL_MAX_SPEED_PX, (bounds.top + AUTOSCROLL_EDGE_PX - st.pointerY) / 3);
      } else if (st.pointerY > bounds.bottom - AUTOSCROLL_EDGE_PX) {
        delta = Math.min(AUTOSCROLL_MAX_SPEED_PX, (st.pointerY - (bounds.bottom - AUTOSCROLL_EDGE_PX)) / 3);
      }

      if (delta) {
        scroller.scrollTop += delta;
        // The band is in viewport coordinates, so scrolling moves the content
        // under a fixed anchor: shift the anchor by the same amount to keep
        // the band covering the region the user actually dragged over.
        st.startY -= delta;
        const band = bandFrom(st.pointerX ?? st.startX, st.pointerY);
        setRect(band);
        applySelection(band);
      }
      raf = requestAnimationFrame(autoScroll);
    };

    const onMove = (ev) => {
      const st = stateRef.current;
      if (!st) return;
      st.pointerX = ev.clientX;
      st.pointerY = ev.clientY;

      if (!st.moved) {
        if (Math.abs(ev.clientX - st.startX) < DRAG_THRESHOLD_PX && Math.abs(ev.clientY - st.startY) < DRAG_THRESHOLD_PX) return;
        st.moved = true;
        // Text selection would otherwise fight the band and leave the page
        // highlighted blue behind it.
        document.body.style.userSelect = 'none';
        raf = requestAnimationFrame(autoScroll);
      }

      const band = bandFrom(ev.clientX, ev.clientY);
      setRect(band);
      applySelection(band);
    };

    const onUp = () => {
      const st = stateRef.current;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (raf) cancelAnimationFrame(raf);
      document.body.style.userSelect = '';
      // A press on empty space that never became a drag is a plain background
      // click, which in Explorer means "deselect everything".
      if (st && !st.moved && !st.additive) onClearRef.current?.();
      stateRef.current = null;
      setRect(null);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [enabled, containerRef, applySelection]);

  useEffect(() => () => {
    document.body.style.userSelect = '';
  }, []);

  return { onMouseDown: handleMouseDown, marqueeRect: rect };
}

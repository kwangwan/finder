import { useCallback, useRef, useState } from 'react';

// Kept in step with useWindowManager's own clamps, which re-fit windows when
// the viewport shrinks; a window that could be resized past these would be
// snapped back the next time the browser was resized.
export const RESIZE_MIN_WIDTH = 320;
export const RESIZE_MIN_HEIGHT = 240;

// Leaves the window's header below the topbar, so a window can never be
// dragged or resized into a position where its own title bar is unreachable.
const MIN_TOP = 48;

/**
 * Dragging and eight-direction resizing for a floating window.
 *
 * Shared by every window kind (file preview, folder browser) so they behave
 * identically — the alternative was a second copy of this logic per window
 * type, which is exactly where subtle differences in clamping and touch
 * handling creep in.
 *
 * Both are no-ops on mobile, where windows are laid out full-bleed and fixed.
 */
export function useWindowChrome({
  id,
  position,
  size,
  isMaximized,
  onFocus,
  onPositionChange,
  onSizeChange,
  // Selector for header regions that must not start a drag (buttons etc.).
  ignoreDragSelector = '.window-action-btn, .window-os-controls, .window-header-actions',
}) {
  // Drives the transition swap: animating width/height while the pointer is
  // driving them makes the window lag behind the cursor.
  const [isInteracting, setIsInteracting] = useState(false);

  const isDraggingRef = useRef(false);
  const isResizingRef = useRef(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });
  const resizeStartRef = useRef({ mouseX: 0, mouseY: 0, width: 0, height: 0, posX: 0, posY: 0 });
  const resizeDirRef = useRef('se');

  const isMobile = () => typeof window !== 'undefined' && window.innerWidth <= 768;
  const pointOf = (e) => (e.type.includes('touch')
    ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
    : { x: e.clientX, y: e.clientY });

  const handleDragMove = useCallback((e) => {
    if (!isDraggingRef.current) return;
    if (e.cancelable) e.preventDefault();
    const { x: clientX, y: clientY } = pointOf(e);

    const deltaX = clientX - dragStartRef.current.mouseX;
    const deltaY = clientY - dragStartRef.current.mouseY;

    // Always leaves a grabbable strip on screen, however far the window is
    // dragged towards an edge.
    const newX = Math.max(0, Math.min(window.innerWidth - 120, dragStartRef.current.posX + deltaX));
    const newY = Math.max(MIN_TOP, Math.min(window.innerHeight - 80, dragStartRef.current.posY + deltaY));

    onPositionChange(id, { x: newX, y: newY });
  }, [id, onPositionChange]);

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
    setIsInteracting(false);
    window.removeEventListener('mousemove', handleDragMove);
    window.removeEventListener('mouseup', handleDragEnd);
    window.removeEventListener('touchmove', handleDragMove);
    window.removeEventListener('touchend', handleDragEnd);
  }, [handleDragMove]);

  const handleDragStart = useCallback((e) => {
    if (isMaximized || isMobile()) return;
    if (ignoreDragSelector && e.target.closest(ignoreDragSelector)) return;
    // The title input has its own mousedown handler deciding between dragging
    // and editing; once it is focused (mid-edit) this must not also drag.
    if (e.target.closest('.window-title-input') && document.activeElement === e.target) return;

    onFocus(id);
    isDraggingRef.current = true;
    setIsInteracting(true);
    const { x: clientX, y: clientY } = pointOf(e);
    dragStartRef.current = { mouseX: clientX, mouseY: clientY, posX: position.x, posY: position.y };

    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
    window.addEventListener('touchmove', handleDragMove, { passive: false });
    window.addEventListener('touchend', handleDragEnd);
  }, [id, isMaximized, ignoreDragSelector, onFocus, position.x, position.y, handleDragMove, handleDragEnd]);

  const handleResizeMove = useCallback((e) => {
    if (!isResizingRef.current) return;
    if (e.cancelable) e.preventDefault();
    const { x: clientX, y: clientY } = pointOf(e);

    const start = resizeStartRef.current;
    const deltaX = clientX - start.mouseX;
    const deltaY = clientY - start.mouseY;
    const dir = resizeDirRef.current;

    let newW = start.width;
    let newH = start.height;
    let newX = start.posX;
    let newY = start.posY;

    if (dir.includes('e')) {
      newW = Math.max(RESIZE_MIN_WIDTH, Math.min(window.innerWidth - start.posX - 10, start.width + deltaX));
    }
    if (dir.includes('s')) {
      newH = Math.max(RESIZE_MIN_HEIGHT, Math.min(window.innerHeight - start.posY - 10, start.height + deltaY));
    }
    if (dir.includes('w')) {
      // Right edge stays fixed — only the left edge (position.x) and width move.
      const rightEdge = start.posX + start.width;
      let proposedX = Math.max(0, start.posX + deltaX);
      let proposedW = rightEdge - proposedX;
      if (proposedW < RESIZE_MIN_WIDTH) {
        proposedW = RESIZE_MIN_WIDTH;
        proposedX = rightEdge - RESIZE_MIN_WIDTH;
      }
      newX = proposedX;
      newW = proposedW;
    }
    if (dir.includes('n')) {
      // Bottom edge stays fixed — only the top edge (position.y) and height move.
      const bottomEdge = start.posY + start.height;
      let proposedY = Math.max(MIN_TOP, start.posY + deltaY);
      let proposedH = bottomEdge - proposedY;
      if (proposedH < RESIZE_MIN_HEIGHT) {
        proposedH = RESIZE_MIN_HEIGHT;
        proposedY = bottomEdge - RESIZE_MIN_HEIGHT;
      }
      newY = proposedY;
      newH = proposedH;
    }

    onSizeChange(id, { width: newW, height: newH });
    if (dir.includes('w') || dir.includes('n')) {
      onPositionChange(id, { x: newX, y: newY });
    }
  }, [id, onSizeChange, onPositionChange]);

  const handleResizeEnd = useCallback(() => {
    isResizingRef.current = false;
    setIsInteracting(false);
    window.removeEventListener('mousemove', handleResizeMove);
    window.removeEventListener('mouseup', handleResizeEnd);
    window.removeEventListener('touchmove', handleResizeMove);
    window.removeEventListener('touchend', handleResizeEnd);
  }, [handleResizeMove]);

  const handleResizeStart = useCallback((dir) => (e) => {
    if (isMaximized || isMobile()) return;
    e.stopPropagation();
    onFocus(id);
    isResizingRef.current = true;
    resizeDirRef.current = dir;
    setIsInteracting(true);

    const { x: clientX, y: clientY } = pointOf(e);
    resizeStartRef.current = {
      mouseX: clientX, mouseY: clientY,
      width: size.width, height: size.height,
      posX: position.x, posY: position.y,
    };

    window.addEventListener('mousemove', handleResizeMove);
    window.addEventListener('mouseup', handleResizeEnd);
    window.addEventListener('touchmove', handleResizeMove, { passive: false });
    window.addEventListener('touchend', handleResizeEnd);
  }, [id, isMaximized, onFocus, size.width, size.height, position.x, position.y, handleResizeMove, handleResizeEnd]);

  return { isInteracting, handleDragStart, handleResizeStart };
}

// The eight grab regions, in the order the CSS expects them.
export const RESIZE_DIRECTIONS = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'];

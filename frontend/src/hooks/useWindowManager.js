import { useState, useCallback, useRef, useEffect } from 'react';

const RESIZE_MIN_X = 0;
const RESIZE_MIN_Y = 48; // keeps the header below the topbar, matching handleDragMove's clamp
const RESIZE_EDGE_MARGIN = 10;
const RESIZE_MIN_WIDTH = 320;
const RESIZE_MIN_HEIGHT = 240;

// Re-fits one window's position/size into a (possibly-shrunk) viewport so it
// can never end up dragged/resized off-screen and unreachable after the
// browser window itself is resized.
function fitWindowToViewport(win, screenWidth, screenHeight, isMobile) {
  if (win.isMaximized) {
    const pad = isMobile ? 4 : 12;
    const topPad = isMobile ? 54 : 58;
    const bottomPad = isMobile ? 70 : 64;
    return {
      ...win,
      position: { x: pad, y: topPad },
      size: {
        width: Math.max(RESIZE_MIN_WIDTH, screenWidth - pad * 2),
        height: Math.max(RESIZE_MIN_HEIGHT, screenHeight - topPad - bottomPad)
      }
    };
  }

  const maxWidth = Math.max(RESIZE_MIN_WIDTH, screenWidth - RESIZE_EDGE_MARGIN * 2);
  const maxHeight = Math.max(RESIZE_MIN_HEIGHT, screenHeight - RESIZE_EDGE_MARGIN * 2);
  const width = Math.min(win.size.width, maxWidth);
  const height = Math.min(win.size.height, maxHeight);

  const maxX = Math.max(RESIZE_MIN_X, screenWidth - width - RESIZE_EDGE_MARGIN);
  const maxY = Math.max(RESIZE_MIN_Y, screenHeight - height - RESIZE_EDGE_MARGIN);
  const x = Math.min(Math.max(RESIZE_MIN_X, win.position.x), maxX);
  const y = Math.min(Math.max(RESIZE_MIN_Y, win.position.y), maxY);

  if (x === win.position.x && y === win.position.y && width === win.size.width && height === win.size.height) {
    return win;
  }
  return { ...win, position: { x, y }, size: { width, height } };
}

export function useWindowManager() {
  const [windows, setWindows] = useState([]);
  const nextZIndexRef = useRef(100);
  const resizeFrameRef = useRef(null);

  useEffect(() => {
    const handleViewportResize = () => {
      if (resizeFrameRef.current) return;
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;
        const isMobile = screenWidth <= 768;
        setWindows((prev) => {
          if (prev.length === 0) return prev;
          return prev.map((w) => fitWindowToViewport(w, screenWidth, screenHeight, isMobile));
        });
      });
    };

    window.addEventListener('resize', handleViewportResize);
    return () => {
      window.removeEventListener('resize', handleViewportResize);
      if (resizeFrameRef.current) cancelAnimationFrame(resizeFrameRef.current);
    };
  }, []);

  const getInitialPositionAndSize = useCallback((index, file) => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const screenHeight = typeof window !== 'undefined' ? window.innerHeight : 800;

    if (isMobile) {
      const pad = 8;
      const topPad = 56;
      return {
        position: { x: pad, y: topPad },
        size: { 
          width: screenWidth - pad * 2, 
          height: Math.min(screenHeight - topPad - 95, 620) 
        }
      };
    }

    // Default desktop dimensions
    const isMedia = file?.file_type === 'video' || file?.file_type === 'pdf' || file?.name?.match(/\.(mp4|webm|pdf)$/i);
    const defaultWidth = isMedia ? Math.min(screenWidth * 0.65, 880) : Math.min(screenWidth * 0.52, 700);
    const defaultHeight = isMedia ? Math.min(screenHeight * 0.72, 600) : Math.min(screenHeight * 0.65, 540);

    // Cascading offset from center
    const cascadeOffset = (index % 6) * 24;
    const baseX = Math.max(40, (screenWidth - defaultWidth) / 2);
    const baseY = Math.max(65, (screenHeight - defaultHeight) / 2 - 20);

    const initialX = Math.max(20, Math.min(screenWidth - defaultWidth - 20, baseX + cascadeOffset));
    const initialY = Math.max(55, Math.min(screenHeight - defaultHeight - 55, baseY + cascadeOffset));

    return {
      position: { x: initialX, y: initialY },
      size: { width: defaultWidth, height: defaultHeight }
    };
  }, []);

  const openWindow = useCallback((file) => {
    if (!file || !file.id) return;

    setWindows((prev) => {
      const existingIdx = prev.findIndex((w) => w.id === file.id);
      nextZIndexRef.current += 1;
      const topZ = nextZIndexRef.current;

      if (existingIdx !== -1) {
        // If window is already open, focus and un-minimize it
        return prev.map((w, idx) => {
          if (idx === existingIdx) {
            return {
              ...w,
              file: { ...w.file, ...file },
              isMinimized: false,
              zIndex: topZ
            };
          }
          return w;
        });
      }

      // Add new window with cascade positioning
      const { position, size } = getInitialPositionAndSize(prev.length, file);
      const newWin = {
        id: file.id,
        file,
        isMinimized: false,
        isMaximized: false,
        prevPosition: position,
        prevSize: size,
        position,
        size,
        zIndex: topZ
      };

      return [...prev, newWin];
    });
  }, [getInitialPositionAndSize]);

  const closeWindow = useCallback((fileId) => {
    setWindows((prev) => prev.filter((w) => w.id !== fileId));
  }, []);

  const closeAllWindows = useCallback(() => {
    setWindows([]);
  }, []);

  const minimizeWindow = useCallback((fileId) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === fileId ? { ...w, isMinimized: true } : w))
    );
  }, []);

  const restoreWindow = useCallback((fileId) => {
    nextZIndexRef.current += 1;
    const topZ = nextZIndexRef.current;

    setWindows((prev) =>
      prev.map((w) =>
        w.id === fileId
          ? { ...w, isMinimized: false, zIndex: topZ }
          : w
      )
    );
  }, []);

  const toggleMinimize = useCallback((fileId) => {
    setWindows((prev) => {
      const target = prev.find((w) => w.id === fileId);
      if (!target) return prev;

      if (target.isMinimized) {
        nextZIndexRef.current += 1;
        const topZ = nextZIndexRef.current;
        return prev.map((w) =>
          w.id === fileId ? { ...w, isMinimized: false, zIndex: topZ } : w
        );
      } else {
        return prev.map((w) =>
          w.id === fileId ? { ...w, isMinimized: true } : w
        );
      }
    });
  }, []);

  const toggleMaximize = useCallback((fileId) => {
    setWindows((prev) =>
      prev.map((w) => {
        if (w.id !== fileId) return w;

        if (w.isMaximized) {
          // Restore previous position and size
          return {
            ...w,
            isMaximized: false,
            position: w.prevPosition || w.position,
            size: w.prevSize || w.size
          };
        } else {
          // Save previous geometry and maximize
          const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
          const pad = isMobile ? 4 : 12;
          const topPad = isMobile ? 54 : 58;
          const bottomPad = isMobile ? 70 : 64;

          const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
          const screenHeight = typeof window !== 'undefined' ? window.innerHeight : 800;

          return {
            ...w,
            isMaximized: true,
            prevPosition: w.position,
            prevSize: w.size,
            position: { x: pad, y: topPad },
            size: {
              width: screenWidth - pad * 2,
              height: screenHeight - topPad - bottomPad
            }
          };
        }
      })
    );
  }, []);

  const focusWindow = useCallback((fileId) => {
    nextZIndexRef.current += 1;
    const topZ = nextZIndexRef.current;

    setWindows((prev) =>
      prev.map((w) => (w.id === fileId ? { ...w, zIndex: topZ } : w))
    );
  }, []);

  const updateWindowPosition = useCallback((fileId, position) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === fileId ? { ...w, position, isMaximized: false } : w))
    );
  }, []);

  const updateWindowSize = useCallback((fileId, size) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === fileId ? { ...w, size, isMaximized: false } : w))
    );
  }, []);

  // Patches a single open window's own file object in place (e.g. after a
  // note autosaves, its favorite is toggled, or it's renamed) — lets a
  // window update itself without a global "currently active file" state,
  // now that any number of note windows can be open/editing at once.
  const updateWindowFile = useCallback((fileId, patch) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === fileId ? { ...w, file: { ...w.file, ...patch } } : w))
    );
  }, []);

  return {
    windows,
    openWindow,
    closeWindow,
    closeAllWindows,
    minimizeWindow,
    restoreWindow,
    toggleMinimize,
    toggleMaximize,
    focusWindow,
    updateWindowPosition,
    updateWindowSize,
    updateWindowFile
  };
}

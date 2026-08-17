import React from 'react';
import PreviewWindow from './PreviewWindow';
import WindowTaskbar from './WindowTaskbar';

export default function WindowManager({
  windowManager,
  onEditFile
}) {
  const {
    windows,
    closeWindow,
    closeAllWindows,
    minimizeWindow,
    toggleMinimize,
    toggleMaximize,
    focusWindow,
    updateWindowPosition,
    updateWindowSize
  } = windowManager;

  if (!windows || windows.length === 0) return null;

  return (
    <div className="os-window-manager-root">
      {/* 1. All Open Windows */}
      {windows.map((win) => (
        <PreviewWindow
          key={win.id}
          windowState={win}
          onClose={closeWindow}
          onMinimize={minimizeWindow}
          onMaximize={toggleMaximize}
          onFocus={focusWindow}
          onPositionChange={updateWindowPosition}
          onSizeChange={updateWindowSize}
          onEditFile={(file) => {
            if (onEditFile) {
              onEditFile(file);
              closeWindow(file.id);
            }
          }}
        />
      ))}

      {/* 2. Desktop Dock & Mobile Floating Action Button */}
      <WindowTaskbar
        windows={windows}
        onFocusWindow={focusWindow}
        onToggleMinimize={toggleMinimize}
        onCloseWindow={closeWindow}
        onCloseAllWindows={closeAllWindows}
        onMinimizeAllWindows={() => {
          windows.forEach((w) => {
            if (!w.isMinimized) minimizeWindow(w.id);
          });
        }}
      />
    </div>
  );
}

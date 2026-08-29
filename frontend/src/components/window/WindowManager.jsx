import React from 'react';
import PreviewWindow from './PreviewWindow';
import WindowTaskbar from './WindowTaskbar';

export default function WindowManager({
  windowManager,
  onToggleFavorite,
  onDeleteFile,
  activeWorkspaceId,
  currentUser
}) {
  const {
    windows,
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
          onUpdateWindowFile={updateWindowFile}
          onToggleFavorite={onToggleFavorite}
          onDeleteFile={onDeleteFile}
          activeWorkspaceId={activeWorkspaceId}
          currentUser={currentUser}
        />
      ))}

      {/* 2. Desktop Dock & Mobile Floating Action Button */}
      <WindowTaskbar
        windows={windows}
        onRestoreWindow={restoreWindow}
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

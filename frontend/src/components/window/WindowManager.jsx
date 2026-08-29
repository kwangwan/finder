import React from 'react';
import PreviewWindow from './PreviewWindow';
import FolderWindow from './FolderWindow';
import WindowTaskbar from './WindowTaskbar';

export default function WindowManager({
  windowManager,
  workspaces = [],
  onToggleFavorite,
  onDeleteFile,
  activeWorkspaceId,
  currentUser,
  onFileContextMenu,
  onFolderContextMenu,
  onBackgroundContextMenu,
  clipboard,
  onClipboardCut,
  onClipboardCopy,
  onClipboardPaste,
  onTransferItems,
  onUploadFiles,
  onUndo,
  externalRefreshToken = { n: 0, keys: null }
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
    updateWindowFile,
    openWindow,
    navigateFolderWindow
  } = windowManager;

  if (!windows || windows.length === 0) return null;

  return (
    <div className="os-window-manager-root">
      {/* 1. All Open Windows */}
      {windows.map((win) => (win.kind === 'folder' ? (
        <FolderWindow
          key={win.id}
          windowState={win}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onClose={closeWindow}
          onMinimize={minimizeWindow}
          onMaximize={toggleMaximize}
          onFocus={focusWindow}
          onPositionChange={updateWindowPosition}
          onSizeChange={updateWindowSize}
          onNavigate={navigateFolderWindow}
          onOpenFile={openWindow}
          onFileContextMenu={onFileContextMenu}
          onFolderContextMenu={onFolderContextMenu}
          onBackgroundContextMenu={onBackgroundContextMenu}
          clipboard={clipboard}
          onClipboardCut={onClipboardCut}
          onClipboardCopy={onClipboardCopy}
          onClipboardPaste={onClipboardPaste}
          onTransferItems={onTransferItems}
          onUploadFiles={onUploadFiles}
          onUndo={onUndo}
          externalRefreshToken={externalRefreshToken}
        />
      ) : (
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
      )))}

      {/* 2. Desktop Dock & Mobile Floating Action Button */}
      <WindowTaskbar
        windows={windows}
        workspaces={workspaces}
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

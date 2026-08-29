import React, { useState } from 'react';
import { 
  Layers, 
  X, 
  Minus, 
  FileText, 
  Film, 
  Music, 
  Image as ImageIcon, 
  FileCode, 
  File, 
  Table, 
  Check,
  Maximize2,
  Grid,
  Folder as FolderIcon
} from '../../utils/icons';
import { getThumbnailUrl, clearMediaToken, ensureMediaToken } from '../../api';

export default function WindowTaskbar({
  windows,
  workspaces = [],
  onRestoreWindow,
  onToggleMinimize,
  onCloseWindow,
  onCloseAllWindows,
  onMinimizeAllWindows
}) {
  const [isMobileSwitcherOpen, setIsMobileSwitcherOpen] = useState(false);
  // Files whose thumbnail failed to load. A thumbnail can legitimately be
  // missing — a video's is generated asynchronously after upload, and some
  // images never get one — so those fall back to the icon preview instead of
  // leaving an empty card.
  const [thumbFailed, setThumbFailed] = useState(() => new Set());

  if (!windows || windows.length === 0) return null;

  // Active (focused) window
  const activeWindow = [...windows].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0))[0];

  const getFileIcon = (file) => {
    if (!file) return <File size={14} />;
    const name = (file.name || '').toLowerCase();
    const type = (file.file_type || '').toLowerCase();

    if (file.is_markdown || name.endsWith('.md')) return <FileText size={14} color="var(--accent-primary)" />;
    if (type === 'video' || name.match(/\.(mp4|webm|mov|avi|mkv)$/i)) return <Film size={14} color="var(--accent-primary)" />;
    if (type === 'audio' || name.match(/\.(mp3|wav|ogg|m4a|flac)$/i)) return <Music size={14} color="var(--accent-primary)" />;
    if (type === 'image' || name.match(/\.(png|jpe?g|gif|webp|svg|bmp)$/i)) return <ImageIcon size={14} color="var(--accent-emerald)" />;
    if (type === 'pdf' || name.endsWith('.pdf')) return <FileText size={14} color="var(--accent-rose)" />;
    if (name.match(/\.(xlsx|xls|csv)$/i)) return <Table size={14} color="var(--accent-emerald)" />;
    if (name.match(/\.(docx|doc)$/i)) return <FileText size={14} color="#2563eb" />;
    if (name.match(/\.(js|jsx|ts|tsx|json|html|css|py|sql|sh|yaml|yml)$/i)) return <FileCode size={14} color="var(--accent-amber)" />;
    return <File size={14} color="var(--text-secondary)" />;
  };

  // Tabs are grouped by the workspace their file belongs to. Windows stay
  // open across a workspace switch, so an ungrouped grid mixed files from
  // several workspaces with nothing to tell them apart — two identically
  // named files in different workspaces were indistinguishable.
  const groupedWindows = (() => {
    const nameById = new Map((workspaces || []).map(w => [w.id, w.name]));
    const groups = new Map();
    for (const win of windows) {
      const wsId = win.kind === 'folder' ? (win.workspaceId || null) : (win.file?.workspace_id || null);
      if (!groups.has(wsId)) {
        groups.set(wsId, {
          id: wsId,
          // A file with no workspace predates workspaces or sits outside
          // one; it still has to appear somewhere.
          name: wsId ? (nameById.get(wsId) || '알 수 없는 워크스페이스') : '워크스페이스 없음',
          windows: [],
        });
      }
      groups.get(wsId).windows.push(win);
    }
    return [...groups.values()];
  })();

  // Images and videos get a real thumbnail; everything else keeps the text
  // snippet or icon. thumbnail_s3_key is the authoritative signal (a video's
  // is generated asynchronously after upload, so it can legitimately be
  // absent for a while), with a type check as a fallback for file objects
  // that came from a listing without it.
  const hasThumbnail = (file) => {
    if (!file) return false;
    if (file.thumbnail_s3_key || file.thumbnail_url) return true;
    const type = (file.file_type || '').toLowerCase();
    return type === 'image' || type === 'video';
  };

  // Folder windows carry no file record, so everything the dock renders goes
  // through these rather than reaching into win.file directly.
  const isFolderWin = (win) => win.kind === 'folder';
  const winName = (win) => (isFolderWin(win) ? (win.folderName || '홈') : win.file?.name || '');
  const winIcon = (win) => (isFolderWin(win)
    ? <FolderIcon size={13} color="var(--accent-primary)" />
    : getFileIcon(win.file));

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <>
      {/* =========================================================================
          1. Unified Bottom Taskbar Dock (Desktop & Mobile)
          ========================================================================= */}
      <div className="os-desktop-dock" role="navigation" aria-label="작업 표시줄">
        <div className="dock-container">
          {/* Brand / Tab Switcher Trigger Button */}
          <button 
            type="button"
            className="dock-brand-btn" 
            onClick={() => setIsMobileSwitcherOpen(prev => !prev)}
            title="탭 관리자 열기"
          >
            <div className="dock-brand-icon">
              <Layers size={14} color="var(--accent-primary)" />
              {windows.length > 0 && (
                <span className="dock-count-badge">{windows.length}</span>
              )}
            </div>
            <span className="dock-mobile-label">탭 {windows.length}개</span>
          </button>

          <div className="dock-divider" />

          {/* Desktop Tabs List */}
          <div className="dock-tabs-list">
            {windows.map((win) => {
              const isActive = activeWindow?.id === win.id && !win.isMinimized;
              return (
                <div
                  key={win.id}
                  className={`dock-tab-item ${isActive ? 'is-active' : ''} ${win.isMinimized ? 'is-minimized' : ''}`}
                  onClick={() => onToggleMinimize(win.id)}
                  title={`${winName(win)} (${win.isMinimized ? '최소화됨 - 클릭하여 복원' : '클릭하여 최소화'})`}
                >
                  <span className="dock-tab-icon">{winIcon(win)}</span>
                  <span className="dock-tab-title">{winName(win)}</span>
                  <button
                    type="button"
                    className="dock-tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseWindow(win.id);
                    }}
                    title="닫기"
                  >
                    <X size={11} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Global Window Actions */}
          <div className="dock-actions">
            <button
              type="button"
              className="dock-action-btn hide-mobile"
              onClick={onMinimizeAllWindows}
              title="모든 창 최소화"
            >
              <Minus size={13} />
            </button>
            <button
              type="button"
              className="dock-action-btn"
              onClick={onCloseAllWindows}
              title="모든 창 닫기"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* =========================================================================
          2. Mobile Chrome-style Tab Switcher Grid Overlay
          ========================================================================= */}
      {isMobileSwitcherOpen && (
        <div className="os-chrome-tab-switcher-overlay">
          <div className="os-chrome-tab-switcher-header">
            <div className="tab-switcher-title-box">
              <Layers size={18} color="var(--accent-primary)" />
              <span className="tab-switcher-title">열린 탭 ({windows.length})</span>
            </div>
            <div className="tab-switcher-header-actions">
              <button
                type="button"
                className="switcher-btn-secondary"
                onClick={() => {
                  onCloseAllWindows();
                  setIsMobileSwitcherOpen(false);
                }}
              >
                모두 닫기
              </button>
              <button
                type="button"
                className="switcher-btn-close"
                onClick={() => setIsMobileSwitcherOpen(false)}
                title="닫기"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="os-chrome-tab-switcher-body">
            {groupedWindows.map((group) => (
            <section key={group.id || 'none'} className="chrome-tab-group">
              {/* Only label the groups when there is more than one — a single
                  workspace needs no heading telling the user where they are. */}
              {groupedWindows.length > 1 && (
                <div className="chrome-tab-group-title">
                  <span>{group.name}</span>
                  <span className="menu-badge">{group.windows.length}</span>
                </div>
              )}
            <div className="chrome-tab-grid">
              {group.windows.map((win) => {
                const isActive = activeWindow?.id === win.id && !win.isMinimized;
                return (
                  <div
                    key={win.id}
                    className={`chrome-tab-card ${isActive ? 'is-active' : ''} ${win.isMinimized ? 'is-minimized' : ''}`}
                    onClick={() => {
                      // Must clear isMinimized, not just raise z-index — this
                      // grid is the only way to reach a minimized window's
                      // tab on mobile (.dock-tabs-list, the per-window tab
                      // list, is hidden below 768px).
                      onRestoreWindow(win.id);
                      setIsMobileSwitcherOpen(false);
                    }}
                  >
                    {/* Card Header */}
                    <div className="tab-card-header">
                      <div className="tab-card-title-box">
                        <span className="tab-card-icon">{winIcon(win)}</span>
                        <span className="tab-card-name">{winName(win)}</span>
                      </div>
                      <button
                        type="button"
                        className="tab-card-close-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCloseWindow(win.id);
                          if (windows.length <= 1) {
                            setIsMobileSwitcherOpen(false);
                          }
                        }}
                        title="탭 닫기"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    {/* Card Preview Thumbnail / Snippet Body */}
                    <div className="tab-card-preview">
                      {isFolderWin(win) ? (
                        <div className="tab-card-empty-preview">
                          <FolderIcon size={22} color="var(--accent-primary)" />
                          <span>{winName(win)}</span>
                        </div>
                      ) : hasThumbnail(win.file) && !thumbFailed.has(win.file.id) ? (
                        <img
                          className="tab-card-thumb"
                          src={win.file.thumbnail_url || getThumbnailUrl(win.file.id)}
                          alt=""
                          loading="lazy"
                          onError={async (e) => {
                            // A thumbnail 401s when the cached media token
                            // expired just as this rendered, and an <img>
                            // never retries on its own. Force a fresh token
                            // and retry once — the same recovery the file
                            // grid already does — before falling back to the
                            // icon, which would otherwise be permanent for
                            // what is only a transient token problem.
                            const img = e.currentTarget;
                            if (!img.dataset.retriedToken) {
                              img.dataset.retriedToken = '1';
                              clearMediaToken();
                              await ensureMediaToken();
                              img.src = getThumbnailUrl(win.file.id);
                              return;
                            }
                            setThumbFailed(prev => {
                              if (prev.has(win.file.id)) return prev;
                              const next = new Set(prev);
                              next.add(win.file.id);
                              return next;
                            });
                          }}
                        />
                      ) : win.file.content ? (
                        <div className="tab-card-text-preview">
                          {win.file.content.slice(0, 180)}
                        </div>
                      ) : (
                        <div className="tab-card-empty-preview">
                          {getFileIcon(win.file)}
                          <span>{win.file.name}</span>
                        </div>
                      )}
                    </div>

                    {/* Card Footer */}
                    <div className="tab-card-footer">
                      <span>{isFolderWin(win) ? '폴더' : formatFileSize(win.file.size_bytes)}</span>
                      <span className="tab-status-tag">
                        {win.isMinimized ? '최소화됨' : isActive ? '현재 보는 중' : '열림'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            </section>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

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
  Sparkles,
  Grid
} from '../../utils/icons';

export default function WindowTaskbar({
  windows,
  onFocusWindow,
  onToggleMinimize,
  onCloseWindow,
  onCloseAllWindows,
  onMinimizeAllWindows
}) {
  const [isMobileSwitcherOpen, setIsMobileSwitcherOpen] = useState(false);

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
                  title={`${win.file.name} (${win.isMinimized ? '최소화됨 - 클릭하여 복원' : '클릭하여 최소화'})`}
                >
                  <span className="dock-tab-icon">{getFileIcon(win.file)}</span>
                  <span className="dock-tab-title">{win.file.name}</span>
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
            <div className="chrome-tab-grid">
              {windows.map((win) => {
                const isActive = activeWindow?.id === win.id && !win.isMinimized;
                return (
                  <div
                    key={win.id}
                    className={`chrome-tab-card ${isActive ? 'is-active' : ''} ${win.isMinimized ? 'is-minimized' : ''}`}
                    onClick={() => {
                      onFocusWindow(win.id);
                      setIsMobileSwitcherOpen(false);
                    }}
                  >
                    {/* Card Header */}
                    <div className="tab-card-header">
                      <div className="tab-card-title-box">
                        <span className="tab-card-icon">{getFileIcon(win.file)}</span>
                        <span className="tab-card-name">{win.file.name}</span>
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
                      {win.file.content ? (
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
                      <span>{formatFileSize(win.file.file_size || win.file.size)}</span>
                      {win.file.is_embedded && (
                        <span className="badge-embedded-tiny">
                          <Sparkles size={8} /> AI
                        </span>
                      )}
                      <span className="tab-status-tag">
                        {win.isMinimized ? '최소화됨' : isActive ? '현재 보는 중' : '열림'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

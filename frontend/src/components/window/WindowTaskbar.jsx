import React, { useState, useEffect } from 'react';
import { 
  Layers, 
  X, 
  Maximize2, 
  Minimize2, 
  FileText, 
  Film, 
  Image as ImageIcon, 
  Music, 
  Table, 
  FileCode, 
  File, 
  ChevronUp, 
  ChevronDown,
  Sparkles,
  Eye,
  Minus
} from 'lucide-react';

export default function WindowTaskbar({
  windows = [],
  onFocusWindow,
  onToggleMinimize,
  onCloseWindow,
  onCloseAllWindows,
  onMinimizeAllWindows
}) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Close mobile drawer if no windows
  useEffect(() => {
    if (windows.length === 0) {
      setIsMobileMenuOpen(false);
    }
  }, [windows.length]);

  if (!windows || windows.length === 0) return null;

  const getHeaderIcon = (file) => {
    const fileNameLower = file.name?.toLowerCase() || '';
    if (file.file_type === 'video' || fileNameLower.match(/\.(mp4|webm|ogg|mov)$/i)) {
      return <Film size={14} color="var(--accent-primary)" />;
    }
    if (file.file_type === 'image' || fileNameLower.match(/\.(png|jpe?g|gif|webp|svg)$/i)) {
      return <ImageIcon size={14} color="var(--accent-emerald)" />;
    }
    if (file.file_type === 'pdf' || fileNameLower.endsWith('.pdf')) {
      return <FileText size={14} color="var(--accent-rose)" />;
    }
    if (file.file_type === 'xlsx' || fileNameLower.match(/\.(xlsx|xls|csv)$/i)) {
      return <Table size={14} color="var(--accent-emerald)" />;
    }
    if (file.file_type === 'markdown' || fileNameLower.endsWith('.md')) {
      return <FileText size={14} color="var(--accent-primary)" />;
    }
    if (file.file_type === 'code' || fileNameLower.match(/\.(json|py|js|html|css|ts|jsx|tsx)$/i)) {
      return <FileCode size={14} color="var(--accent-amber)" />;
    }
    return <File size={14} color="var(--text-secondary)" />;
  };

  const activeWindowsCount = windows.filter(w => !w.isMinimized).length;
  const minimizedWindowsCount = windows.filter(w => w.isMinimized).length;

  return (
    <>
      {/* =========================================================================
          1. Desktop Floating Taskbar Dock (Bottom Center)
          ========================================================================= */}
      <div className="os-desktop-dock hide-mobile">
        <div className="dock-container">
          <div className="dock-brand-icon" title={`${windows.length}개의 열린 창`}>
            <Layers size={16} color="var(--accent-primary)" />
            <span className="dock-count-badge">{windows.length}</span>
          </div>

          <div className="dock-divider" />

          {/* Window Tabs */}
          <div className="dock-tabs-list">
            {windows.map((win) => {
              const isMinimized = win.isMinimized;
              return (
                <div
                  key={win.id}
                  className={`dock-tab-item ${isMinimized ? 'is-minimized' : 'is-active'}`}
                  onClick={() => onToggleMinimize(win.id)}
                  title={`${win.file.name} (${isMinimized ? '최소화됨 - 클릭하여 복원' : '활성화됨 - 클릭하여 최소화'})`}
                >
                  <div className="dock-tab-icon">
                    {getHeaderIcon(win.file)}
                  </div>
                  <span className="dock-tab-title">{win.file.name}</span>

                  <button
                    type="button"
                    className="dock-tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseWindow(win.id);
                    }}
                    title="창 닫기"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="dock-divider" />

          {/* Dock Global Actions */}
          <div className="dock-actions">
            <button
              type="button"
              className="dock-action-btn"
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
          2. Mobile Floating Action Button (FAB) & Staggered Drawer
          ========================================================================= */}
      <div className="os-mobile-fab-container show-mobile">
        {/* Floating Circular Toggle Button */}
        <button
          type="button"
          className={`os-mobile-fab-btn ${isMobileMenuOpen ? 'active' : ''}`}
          onClick={() => setIsMobileMenuOpen(prev => !prev)}
          title="열린 창 관리"
        >
          <Layers size={20} />
          <span className="mobile-fab-badge">{windows.length}</span>
        </button>

        {/* Backdrop for Mobile Drawer */}
        {isMobileMenuOpen && (
          <div 
            className="os-mobile-drawer-overlay"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Animated Staggered Card Stack Drawer */}
        {isMobileMenuOpen && (
          <div className="os-mobile-drawer-sheet animate-slide-up">
            <div className="mobile-drawer-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Layers size={16} color="var(--accent-primary)" />
                <span style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                  열린 창 관리 ({windows.length})
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onCloseAllWindows}
                  style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem', height: 26 }}
                >
                  전체 닫기
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => setIsMobileMenuOpen(false)}
                  style={{ width: 26, height: 26 }}
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            <div className="mobile-drawer-list">
              {windows.map((win, idx) => {
                const isMinimized = win.isMinimized;
                return (
                  <div
                    key={win.id}
                    className={`mobile-drawer-card ${isMinimized ? 'is-minimized' : 'is-active'}`}
                    onClick={() => {
                      onFocusWindow(win.id);
                      if (isMinimized) {
                        onToggleMinimize(win.id);
                      }
                      setIsMobileMenuOpen(false);
                    }}
                    style={{ animationDelay: `${idx * 0.04}s` }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                      <div className="drawer-card-icon">
                        {getHeaderIcon(win.file)}
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="drawer-card-title">
                          {win.file.name}
                        </div>
                        <div className="drawer-card-meta">
                          {isMinimized ? '최소화됨 (탭하여 열기)' : '현재 활성화됨'}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleMinimize(win.id);
                        }}
                        style={{ width: 28, height: 28 }}
                        title={isMinimized ? '복원' : '최소화'}
                      >
                        {isMinimized ? <Maximize2 size={13} color="var(--accent-primary)" /> : <Minus size={13} />}
                      </button>
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCloseWindow(win.id);
                        }}
                        style={{ width: 28, height: 28, color: 'var(--accent-rose)' }}
                        title="닫기"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

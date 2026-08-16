import React, { useState, useRef, useEffect } from 'react';
import { 
  Search, 
  Menu, 
  Sun, 
  Moon, 
  FilePlus, 
  UploadCloud, 
  ShieldCheck, 
  LogOut, 
  Mail,
  MoreHorizontal,
  Folder,
  User as UserIcon,
  HardDrive
} from 'lucide-react';

const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

export default function TopBar({
  currentUser,
  onToggleSidebar,
  onOpenSearch,
  onNewNote,
  onOpenUpload,
  onOpenInvitations,
  currentFolder,
  currentFile,
  theme,
  onToggleTheme,
  onNavigateHome,
  onOpenAdmin,
  onLogout
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const quotaBytes = currentUser?.storage_quota_bytes || 100 * 1024 * 1024 * 1024;
  const usedBytes = currentUser?.storage_used_bytes || 0;
  const quotaPercent = Math.min(100, ((usedBytes / quotaBytes) * 100).toFixed(2));

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="btn-icon" onClick={onToggleSidebar} title="사이드바 열기/닫기">
          <Menu size={18} />
        </button>

        <span className="topbar-brand" onClick={onNavigateHome} title="홈으로 이동">
          Finder
        </span>
      </div>

      {/* Center Search Trigger */}
      <div className="topbar-center">
        <div className="search-trigger" onClick={onOpenSearch}>
          <Search size={15} color="var(--accent-primary)" />
          <span className="search-text">지식 검색 (시맨틱 & 키워드)...</span>
          <span className="shortcut-badge">⌘K</span>
        </div>
      </div>

      {/* Right Controls */}
      <div className="topbar-right">
        {/* Mobile Search Icon Button */}
        <button 
          className="btn-icon mobile-search-btn" 
          onClick={onOpenSearch} 
          title="지식 검색 (⌘K)"
        >
          <Search size={17} />
        </button>

        {/* Theme Toggle Button */}
        <button 
          className="btn-icon hide-mobile" 
          onClick={onToggleTheme} 
          title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>

        {/* User Profile & More Actions Dropdown */}
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button 
            className="user-menu-trigger"
            onClick={() => setIsMenuOpen(prev => !prev)}
            title="사용자 메뉴 & 설정"
          >
            {currentUser?.picture ? (
              <img
                src={currentUser.picture}
                alt={currentUser.name}
                className="user-avatar"
              />
            ) : (
              <div className="user-avatar-fallback">
                {(currentUser?.name || currentUser?.email || 'U')[0].toUpperCase()}
              </div>
            )}
            <MoreHorizontal size={14} color="var(--text-muted)" />
          </button>

          {/* User & Options Dropdown Menu */}
          {isMenuOpen && (
            <div className="user-dropdown-menu">
              {/* User Profile Header */}
              <div className="dropdown-user-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  {currentUser?.picture ? (
                    <img src={currentUser.picture} alt="" style={{ width: 34, height: 34, borderRadius: '50%' }} />
                  ) : (
                    <div className="user-avatar-fallback" style={{ width: 34, height: 34, fontSize: '0.95rem' }}>
                      {(currentUser?.name || currentUser?.email || 'U')[0].toUpperCase()}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {currentUser?.name || currentUser?.email?.split('@')[0]}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {currentUser?.email}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  <span className={`role-badge ${currentUser?.is_admin ? 'admin' : 'member'}`}>
                    {currentUser?.is_admin ? '최고 관리자' : '정회원'}
                  </span>
                </div>

                {/* Storage Quota Usage Bar */}
                <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.65rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <HardDrive size={12} color="var(--accent-primary)" /> 저장 공간
                    </span>
                    <span style={{ fontWeight: 600 }}>{formatBytes(usedBytes)} / {formatBytes(quotaBytes)}</span>
                  </div>
                  <div style={{ height: 4, background: 'var(--bg-secondary)', borderRadius: 2, overflow: 'hidden' }}>
                    <div 
                      style={{ 
                        height: '100%', 
                        width: `${Math.max(1, Math.min(100, (usedBytes / quotaBytes) * 100))}%`, 
                        backgroundColor: (usedBytes / quotaBytes) > 0.9 ? 'var(--accent-rose)' : 'var(--accent-primary)',
                        transition: 'width 0.3s ease'
                      }} 
                    />
                  </div>
                </div>
              </div>

              <div className="dropdown-divider" />

              {/* Menu Items */}
              <div className="dropdown-menu-list">
                <button 
                  className="dropdown-item" 
                  onClick={() => {
                    setIsMenuOpen(false);
                    onOpenInvitations();
                  }}
                >
                  <Mail size={15} color="var(--accent-primary)" />
                  <span>초대 및 멤버 관리</span>
                </button>

                {currentUser?.is_admin && (
                  <button 
                    className="dropdown-item" 
                    onClick={() => {
                      setIsMenuOpen(false);
                      onOpenAdmin();
                    }}
                  >
                    <ShieldCheck size={15} color="var(--accent-emerald)" />
                    <span>최고 관리자 대시보드</span>
                  </button>
                )}

                <button 
                  className="dropdown-item" 
                  onClick={() => {
                    setIsMenuOpen(false);
                    onToggleTheme();
                  }}
                >
                  {theme === 'dark' ? <Sun size={15} color="var(--accent-amber)" /> : <Moon size={15} color="var(--accent-purple)" />}
                  <span>{theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}</span>
                </button>

                <div className="dropdown-divider" />

                <button 
                  className="dropdown-item danger" 
                  onClick={() => {
                    setIsMenuOpen(false);
                    onLogout();
                  }}
                >
                  <LogOut size={15} color="var(--accent-rose)" />
                  <span>로그아웃</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

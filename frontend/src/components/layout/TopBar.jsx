import React, { useState, useRef, useEffect } from 'react';
import ProfileModal from '../modals/ProfileModal';
import {
  Search,
  ChevronsRight,
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
  HardDrive,
  Edit3,
  Check,
  Camera,
  Loader2,
  X,
} from '../../utils/icons';

const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

export default function TopBar({
  currentUser,
  isSidebarCollapsed,
  onToggleSidebar,
  onOpenSearch,
  onNewNote,
  onOpenUpload,
  onOpenInvitations,
  currentFolder,
  theme,
  onToggleTheme,
  onNavigateHome,
  onOpenAdmin,
  onLogout,
  onUserUpdated
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // Name, handle, photo and language all live in the profile dialog now:
  // squeezed onto one line of a dropdown, nobody could tell which of them the
  // rest of the app was showing them by.
  const [isProfileOpen, setIsProfileOpen] = useState(false);

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
        {isSidebarCollapsed && (
          <>
            <button className="btn-icon" onClick={onToggleSidebar} title="사이드바 펼치기">
              <ChevronsRight size={16} />
            </button>
            <span className="topbar-brand" onClick={onNavigateHome} title="홈으로 이동">
              Finder
            </span>
          </>
        )}
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

        {/* Two themes, so one button: it shows what it will switch to, and
            switches. A menu of two things a click away is a menu too many. */}
        <button
          className="btn-icon theme-toggle-btn"
          onClick={onToggleTheme}
          title={theme === 'dark' ? '라이트 테마로 전환' : '다크 테마로 전환'}
          aria-label={theme === 'dark' ? '라이트 테마로 전환' : '다크 테마로 전환'}
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
                <div className="tb-identity">
                  <span className="tb-identity-photo">
                    {currentUser?.picture
                      ? <img src={currentUser.picture} alt={currentUser?.name || ''} />
                      : <span className="tb-identity-fallback">{(currentUser?.name || currentUser?.email || 'U')[0].toUpperCase()}</span>}
                  </span>
                  <span className="tb-identity-text">
                    {/* One person, written as one thing: the name, qualified by
                        the handle everything else shows them by. */}
                    <span className="tb-identity-name">{currentUser?.name || currentUser?.email?.split('@')[0]}</span>
                    <span className="tb-identity-handle">@{currentUser?.username || '아이디 없음'}</span>
                    <span className="tb-identity-email">{currentUser?.email}</span>
                  </span>
                </div>

                <button type="button" className="btn-secondary tb-profile-btn" onClick={() => { setIsMenuOpen(false); setIsProfileOpen(true); }}>
                  <UserIcon size={13} /><span>프로필 편집</span>
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  <span className={`role-badge ${currentUser?.is_superadmin ? 'admin' : 'member'}`}>
                    {currentUser?.is_superadmin ? '최고 관리자' : '정회원'}
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

                {currentUser?.is_superadmin && (
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

      <ProfileModal
        isOpen={isProfileOpen}
        currentUser={currentUser}
        onClose={() => setIsProfileOpen(false)}
        onUserUpdated={onUserUpdated}
      />
    </header>
  );
}

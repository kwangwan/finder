import React, { useState, useRef, useEffect } from 'react';
import { updateMyName, uploadAvatar } from '../../api';
import { useDialog } from '../../context/DialogContext';
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
  Palette,
  Monitor,
  Edit3,
  Check,
  Camera,
  Loader2,
  X
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
  onSetTheme,
  onNavigateHome,
  onOpenAdmin,
  onLogout,
  onUserUpdated
}) {
  const { showAlert } = useDialog();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSavingAvatar, setIsSavingAvatar] = useState(false);
  const avatarRef = useRef(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);

  const saveName = async () => {
    const next = nameDraft.trim();
    if (!next || next === (currentUser?.name || '')) { setIsEditingName(false); return; }
    setIsSavingName(true);
    setNameError('');
    try {
      const res = await updateMyName(next);
      onUserUpdated?.({ ...currentUser, name: res.name });
      setIsEditingName(false);
    } catch (e) {
      // Names are unique service-wide, so a clash is the expected failure and
      // is shown in place rather than as a dialog over the menu.
      setNameError(e.message);
    } finally {
      setIsSavingName(false);
    }
  };
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
                  {/* The photo everyone else sees beside this person's name on
                      a task, so it is changed where the name is changed. */}
                  <div className="avatar-edit">
                    {currentUser?.picture ? (
                      <img src={currentUser.picture} alt="" style={{ width: 34, height: 34, borderRadius: '50%' }} />
                    ) : (
                      <div className="user-avatar-fallback" style={{ width: 34, height: 34, fontSize: '0.95rem' }}>
                        {(currentUser?.name || currentUser?.email || 'U')[0].toUpperCase()}
                      </div>
                    )}
                    <button
                      type="button"
                      className="avatar-edit-btn"
                      title={isSavingAvatar ? '올리는 중...' : '프로필 사진 변경'}
                      disabled={isSavingAvatar}
                      onClick={() => avatarRef.current?.click()}
                    >
                      {isSavingAvatar ? <Loader2 size={11} className="spin" /> : <Camera size={11} />}
                    </button>
                    <input
                      ref={avatarRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      style={{ display: 'none' }}
                      onChange={async (e) => {
                        const picked = e.target.files?.[0];
                        e.target.value = '';
                        if (!picked) return;
                        setIsSavingAvatar(true);
                        try {
                          const res = await uploadAvatar(picked);
                          onUserUpdated?.({ ...currentUser, picture: res.picture });
                        } catch (err) {
                          await showAlert({ title: '사진을 바꾸지 못했습니다', message: err.message, type: 'error' });
                        } finally {
                          setIsSavingAvatar(false);
                        }
                      }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isEditingName ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input
                          className="input-field"
                          value={nameDraft}
                          onChange={(e) => { setNameDraft(e.target.value); setNameError(''); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setIsEditingName(false); }}
                          maxLength={60}
                          autoFocus
                          style={{ padding: '0.25rem 0.4rem', fontSize: '0.82rem', minWidth: 0, flex: 1 }}
                        />
                        <button type="button" className="btn-icon" onClick={saveName} disabled={isSavingName} title="저장">
                          <Check size={14} />
                        </button>
                        <button type="button" className="btn-icon" onClick={() => setIsEditingName(false)} title="취소">
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {currentUser?.name || currentUser?.email?.split('@')[0]}
                        </div>
                        <button
                          type="button"
                          className="btn-icon"
                          style={{ padding: 2, flexShrink: 0 }}
                          title="이름 변경"
                          onClick={() => { setNameDraft(currentUser?.name || ''); setNameError(''); setIsEditingName(true); }}
                        >
                          <Edit3 size={12} />
                        </button>
                      </div>
                    )}
                    {nameError && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--accent-rose)', marginTop: 2 }}>{nameError}</div>
                    )}
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {currentUser?.email}
                    </div>
                  </div>
                </div>

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

                <div style={{ padding: '0.6rem 0.85rem 0.35rem', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Palette size={13} />
                  <span>테마</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, padding: '0.2rem 0.75rem 0.6rem' }}>
                  {[
                    { id: 'system', label: '시스템', Icon: Monitor },
                    { id: 'dark', label: '다크', Icon: Moon },
                    { id: 'light', label: '라이트', Icon: Sun }
                  ].map(t => {
                    const isActive = theme === t.id;
                    const IconComponent = t.Icon;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          if (onSetTheme) onSetTheme(t.id);
                          else onToggleTheme();
                        }}
                        style={{
                          height: 34,
                          padding: '0 0.25rem',
                          background: isActive ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                          color: isActive ? 'var(--on-accent)' : 'var(--text-secondary)',
                          border: isActive ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-md)',
                          fontSize: '0.72rem',
                          fontWeight: isActive ? 700 : 500,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 4,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <IconComponent size={13} style={{ flexShrink: 0 }} />
                        <span>{t.label}</span>
                      </button>
                    );
                  })}
                </div>

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

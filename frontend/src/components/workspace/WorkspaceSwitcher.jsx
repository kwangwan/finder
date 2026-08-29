import React, { useState, useRef, useEffect } from 'react';
import { 
  Briefcase, 
  ChevronDown, 
  Check, 
  Plus, 
  Settings, 
  Crown, 
  ShieldCheck, 
  User, 
  Code, 
  Palette, 
  Globe, 
  BookOpen, 
  Layers
} from '../../utils/icons';

const ICON_MAP = {
  briefcase: Briefcase,
  code: Code,
  palette: Palette,
  globe: Globe,
  book: BookOpen,
  layers: Layers,
};

export default function WorkspaceSwitcher({
  workspaces = [],
  activeWorkspace,
  isLoading = false,
  onSelectWorkspace,
  onOpenCreateWorkspace,
  onOpenWorkspaceSettings,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const ActiveIcon = (activeWorkspace?.icon && ICON_MAP[activeWorkspace.icon]) || Briefcase;

  if (isLoading && !activeWorkspace) {
    return (
      <div style={{
        width: '100%',
        height: 48,
        borderRadius: 'var(--radius-md)',
        backgroundColor: 'var(--bg-tertiary)',
        border: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        padding: '0.6rem 0.75rem',
        gap: '0.6rem'
      }}>
        <div className="skeleton-box" style={{ width: 28, height: 28, borderRadius: 'var(--radius-sm)' }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="skeleton-box" style={{ width: '65%', height: 14 }} />
          <div className="skeleton-box" style={{ width: '40%', height: 10 }} />
        </div>
      </div>
    );
  }

  return (
    <div ref={dropdownRef} style={{ position: 'relative', width: '100%' }}>
      {/* Active Workspace Button */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.6rem 0.75rem',
          backgroundColor: 'var(--bg-tertiary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
          color: 'var(--text-primary)',
          transition: 'var(--transition-fast)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', overflow: 'hidden' }}>
          <div style={{
            width: 28,
            height: 28,
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--accent-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--on-accent)',
            flexShrink: 0
          }}>
            <ActiveIcon size={16} />
          </div>
          <div style={{ textAlign: 'left', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{
              fontSize: '0.875rem',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              overflow: 'hidden',
              lineHeight: 1.25
            }}>
              {activeWorkspace?.name || '워크스페이스 선택'}
            </div>
            {activeWorkspace && (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.2 }}>
                {/* The shared workspace has no membership rows — everyone
                    belongs to it implicitly — so a count read from them says
                    "1명" no matter how many people actually use it. */}
                {activeWorkspace.is_shared ? '멤버 · 모든 이용자' : `멤버 ${activeWorkspace.member_count || 1}명`}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <ChevronDown size={15} color="var(--text-muted)" style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }} />
        </div>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            width: '100%',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 1000,
            padding: '0.4rem',
            overflow: 'hidden'
          }}
        >
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', padding: '0.4rem 0.5rem 0.2rem' }}>
            내 워크스페이스 목록
          </div>

          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {workspaces.map((ws) => {
              const WsIcon = (ws.icon && ICON_MAP[ws.icon]) || Briefcase;
              const isSelected = activeWorkspace?.id === ws.id;

              return (
                <div
                  key={ws.id}
                  onClick={() => {
                    onSelectWorkspace(ws);
                    setIsOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.5rem 0.6rem',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: isSelected ? 'var(--bg-tertiary)' : 'transparent',
                    cursor: 'pointer',
                    marginBottom: 2,
                    transition: 'var(--transition-fast)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
                    <div style={{
                      width: 22,
                      height: 22,
                      borderRadius: 4,
                      backgroundColor: isSelected ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: isSelected ? '#fff' : 'var(--text-secondary)',
                      flexShrink: 0
                    }}>
                      <WsIcon size={13} />
                    </div>
                    <span style={{
                      fontSize: '0.82rem',
                      fontWeight: isSelected ? 700 : 500,
                      color: 'var(--text-primary)',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                      overflow: 'hidden'
                    }}>
                      {ws.name}
                    </span>
                  </div>

                  {isSelected && <Check size={14} color="var(--accent-primary)" />}
                </div>
              );
            })}
          </div>

          {/* Action Divider */}
          <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '0.4rem 0', paddingTop: '0.3rem' }}>
            <button
              onClick={() => {
                setIsOpen(false);
                onOpenWorkspaceSettings();
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.45rem 0.6rem',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                fontSize: '0.8rem',
                cursor: 'pointer',
                textAlign: 'left'
              }}
            >
              <Settings size={14} />
              <span>워크스페이스 관리 & 멤버 초대</span>
            </button>

            <button
              onClick={() => {
                setIsOpen(false);
                onOpenCreateWorkspace();
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.45rem 0.6rem',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'transparent',
                border: 'none',
                color: 'var(--accent-primary)',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'left'
              }}
            >
              <Plus size={14} />
              <span>새 워크스페이스 만들기</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

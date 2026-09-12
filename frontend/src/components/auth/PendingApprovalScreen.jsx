import React, { useState } from 'react';
import { Clock, RefreshCw, LogOut } from '../../utils/icons';
import { getMe, logout } from '../../api';

export default function PendingApprovalScreen({ user, onApproved, onLogout }) {
  const [isChecking, setIsChecking] = useState(false);

  const checkStatus = async () => {
    setIsChecking(true);
    try {
      const refreshedUser = await getMe();
      if (refreshedUser && (refreshedUser.is_approved || refreshedUser.is_superadmin)) {
        onApproved(refreshedUser);
      }
    } catch (err) {
      console.error('Status check error:', err);
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      width: '100vw',
      backgroundColor: 'var(--bg-primary)',
      padding: '1.5rem'
    }}>
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        borderRadius: 'var(--radius-lg)',
        padding: '2.5rem 2rem',
        maxWidth: 560,
        width: '100%',
        boxShadow: 'var(--shadow-lg)',
        textAlign: 'center',
        backdropFilter: 'blur(16px)'
      }}>
        {/* Status Icon */}
        <div style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: 'rgba(245, 158, 11, 0.15)',
          border: '2px solid rgba(245, 158, 11, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 1.5rem',
          color: 'var(--accent-amber)'
        }}>
          <Clock size={32} />
        </div>

        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
          관리자 승인 대기 중
        </h1>
        
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
          <strong>{user?.name || user?.email}</strong> 님의 계정이 정상 등록되었습니다.<br />
          본 시스템(Project Run : Finder)은 비공개 보안 환경으로, 관리자가 승인한 후 접근하실 수 있습니다.
        </p>

        {/* Account Info Pill */}
        <div style={{
          background: 'var(--bg-tertiary)',
          borderRadius: 'var(--radius-md)',
          padding: '0.85rem 1rem',
          marginBottom: '1.5rem',
          fontSize: '0.85rem',
          textAlign: 'left',
          border: '1px solid var(--border-subtle)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: 'var(--text-muted)' }}>이메일 계정</span>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{user?.email}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>승인 상태</span>
            <span style={{ color: 'var(--accent-amber)', fontWeight: 700 }}>대기 중 (Pending)</span>
          </div>
        </div>

        {/* What happens next, said to the person waiting — not to whoever
            built this. The panel here used to print the SQL statement that
            approves an account, with a copy button, to anybody who had just
            signed up: the table, the column, and the exact thing to ask for. */}
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
          관리자가 승인하면 바로 이용하실 수 있습니다. 승인되었다면 아래에서 다시 확인해 주세요.
        </p>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
          <button 
            className="btn-primary" 
            onClick={checkStatus} 
            disabled={isChecking}
            style={{ padding: '0.65rem 1.25rem' }}
          >
            <RefreshCw size={16} className={isChecking ? 'spin-anim' : ''} />
            <span>{isChecking ? '확인 중...' : '승인 상태 다시 확인'}</span>
          </button>

          <button 
            className="btn-secondary" 
            onClick={onLogout}
            style={{ padding: '0.65rem 1rem' }}
          >
            <LogOut size={16} />
            <span>로그아웃</span>
          </button>
        </div>
      </div>
    </div>
  );
}
